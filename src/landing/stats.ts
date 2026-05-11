/**
 * Live numbers shown on the landing page header / stats strip.
 *
 * The query is one round-trip — three correlated counts in a single CTE.
 * Failure modes are swallowed and replaced with zeros: a landing page that
 * renders with `—` placeholders is better than a 500 when the DB is
 * momentarily unreachable.
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { log } from '../lib/log.ts';
import type { LandingData } from './page.ts';

export async function loadLandingStats(database: Db): Promise<LandingData> {
  try {
    const result = await database.execute<{
      deal_count: number | string | null;
      merchant_count: number | string | null;
      last_ingest_hours_ago: number | string | null;
    }>(sql`
      SELECT
        (SELECT count(*) FROM deals WHERE is_active = true) AS deal_count,
        (SELECT count(DISTINCT merchant_id) FROM deals WHERE is_active = true) AS merchant_count,
        (SELECT EXTRACT(EPOCH FROM (now() - max(finished_at))) / 3600
           FROM ingest_runs WHERE status = 'completed') AS last_ingest_hours_ago
    `);
    const row = (result as unknown as { rows?: unknown[] }).rows?.[0] as
      | { deal_count: unknown; merchant_count: unknown; last_ingest_hours_ago: unknown }
      | undefined;
    if (!row) return {};
    const stats: LandingData = {
      dealCount: toNumber(row.deal_count) ?? 0,
      merchantCount: toNumber(row.merchant_count) ?? 0,
    };
    const hours = toNumber(row.last_ingest_hours_ago);
    if (hours !== undefined && hours >= 0) stats.lastIngestHoursAgo = hours;
    return stats;
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'landing stats query failed; rendering with zeros',
    );
    return {};
  }
}

function toNumber(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}
