/**
 * Deal lifecycle sweep. Runs immediately after each ingest pass.
 *
 * Three independent passes, each one a single UPDATE:
 *
 *   1. `markExpiredDeals` — flips `is_active=false` for any deal whose
 *      `expires_at` is in the past. Cheap; covered by the `deals_expires_idx`.
 *
 *   2. `markStaleDeals` — flips `is_active=false` for any deal from a
 *      network whose most recent **successful** ingest run was completed
 *      after the deal's `updated_at` (with a small grace window to handle
 *      paginated runs). This catches deals that quietly disappeared from
 *      the affiliate feed without an explicit expiry.
 *
 *      Importantly, this sweep does NOT fire for a network when there is
 *      no recent completed run — so a network that's been down for a day
 *      doesn't nuke its entire deal inventory.
 *
 *   3. `markFailingDeals` — flips `is_active=false` for any deal whose
 *      observed `success_rate` has cratered after at least `minSamples`
 *      telemetry reports. This is what "remove bad codes" looks like in
 *      practice: enough agents told us it didn't work, take it down.
 *
 * Manual / telemetry-sourced rows are exempt from passes 2 — those tables
 * aren't fed by an external feed cron, so their staleness doesn't mean
 * "vendor dropped it."
 */

import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { deals } from '../db/schema.ts';
import { log } from '../lib/log.ts';

export const DEFAULT_STALE_GRACE_HOURS = 6;
export const DEFAULT_FAILING_THRESHOLD = 0.2;
export const DEFAULT_FAILING_MIN_SAMPLES = 5;

export interface LifecycleOptions {
  /**
   * A deal is stale if its `updated_at` is older than the latest successful
   * ingest_run for its source network, minus this grace window. A larger
   * window forgives slow paginated runs but lets dead deals linger longer.
   */
  staleGraceHours?: number;
  /**
   * Deactivate deals whose observed success_rate is below this fraction
   * AND have at least `failingMinSamples` telemetry reports. 0–1.
   */
  failingThreshold?: number;
  failingMinSamples?: number;
}

export interface LifecycleResult {
  expired: number;
  stale: number;
  failing: number;
}

/**
 * Run all three lifecycle passes. Each pass is independent — a failure in
 * one doesn't roll back the others. Counts of newly-deactivated rows are
 * returned; callers typically just log them.
 */
export async function runLifecyclePass(
  db: Db,
  opts: LifecycleOptions = {},
): Promise<LifecycleResult> {
  const expired = await markExpiredDeals(db);
  const stale = await markStaleDeals(db, opts.staleGraceHours ?? DEFAULT_STALE_GRACE_HOURS);
  const failing = await markFailingDeals(db, {
    threshold: opts.failingThreshold ?? DEFAULT_FAILING_THRESHOLD,
    minSamples: opts.failingMinSamples ?? DEFAULT_FAILING_MIN_SAMPLES,
  });
  log.info({ expired, stale, failing }, 'lifecycle sweep complete');
  return { expired, stale, failing };
}

/**
 * Pass 1: any deal with `expires_at < now()` is deactivated.
 */
export async function markExpiredDeals(db: Db): Promise<number> {
  const rows = await db
    .update(deals)
    .set({ isActive: false, updatedAt: sql`now()` })
    .where(sql`${deals.isActive} = true AND ${deals.expiresAt} IS NOT NULL AND ${deals.expiresAt} < now()`)
    .returning({ id: deals.id });
  return rows.length;
}

/**
 * Pass 2: deals whose source successfully ingested after they were last
 * touched are considered dropped. Grace window guards against very slow
 * paginated runs.
 *
 * The subquery picks `max(finished_at)` per `source_network` for runs in
 * `status='completed'`. If a source has no completed run at all (e.g.
 * brand-new network, or the network has been down indefinitely), the
 * comparison yields NULL and the row is left alone.
 */
export async function markStaleDeals(db: Db, graceHours: number): Promise<number> {
  const grace = Math.max(0, graceHours);
  const rows = await db
    .update(deals)
    .set({ isActive: false, updatedAt: sql`now()` })
    .where(
      sql`${deals.isActive} = true
        AND ${deals.sourceNetwork} NOT IN ('telemetry', 'manual')
        AND ${deals.updatedAt} < (
          SELECT max(finished_at) - make_interval(hours => ${grace})
          FROM ingest_runs
          WHERE ingest_runs.source_network = ${deals.sourceNetwork}
            AND ingest_runs.status = 'completed'
        )`,
    )
    .returning({ id: deals.id });
  return rows.length;
}

/**
 * Pass 3: telemetry-based bad-code removal. Once a code has at least
 * `minSamples` reports and a success rate below `threshold`, deactivate it.
 *
 * Note: a deal that's deactivated here can come back: an ingest run that
 * upserts it will flip `is_active` back true (the upsert SET clause writes
 * `excluded.is_active`). That's intentional — if the source still vouches
 * for the code, we let it back in. Persistent failures will get caught
 * again on the next telemetry-driven sweep.
 */
export async function markFailingDeals(
  db: Db,
  opts: { threshold: number; minSamples: number },
): Promise<number> {
  const threshold = Math.min(1, Math.max(0, opts.threshold));
  const minSamples = Math.max(1, Math.floor(opts.minSamples));
  const rows = await db
    .update(deals)
    .set({ isActive: false, updatedAt: sql`now()` })
    .where(
      sql`${deals.isActive} = true
        AND ${deals.successSampleCount} >= ${minSamples}
        AND ${deals.successRate} IS NOT NULL
        AND ${deals.successRate} < ${threshold}`,
    )
    .returning({ id: deals.id });
  return rows.length;
}
