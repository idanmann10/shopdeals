import { createHash } from 'node:crypto';
import { z } from 'zod';
import { and, asc, desc, eq, gt, sql } from 'drizzle-orm';
import type { McpContext } from '../context.ts';
import { prices } from '../../db/schema.ts';
import type { NewPrice } from '../../db/schema.ts';
import { KEEPA_DEFAULT_STALENESS_MS, KeepaClient } from '../../sources/keepa.ts';
import { log } from '../../lib/log.ts';
import { requireScope } from '../scope.ts';

export const name = 'get_price_history';

export const description =
  'Return observed price history for an Amazon ASIN or product URL with 30d, 90d, and all-time lows. ASIN queries auto-refresh from Keepa when cached data is >24h old. Requires prices:read.';

export const REQUIRED_SCOPE = 'prices:read';

export const inputSchema = z
  .object({
    asin: z.string().optional(),
    productUrl: z.string().url().optional(),
    days: z.number().int().min(1).max(3650).optional(),
  })
  .refine((v) => Boolean(v.asin) !== Boolean(v.productUrl), {
    message: 'exactly one of asin or productUrl is required',
  });

export type GetPriceHistoryInput = z.infer<typeof inputSchema>;

export interface PricePoint {
  t: string;
  priceCents: number;
  availability: string | null;
}

export interface GetPriceHistoryResult extends Record<string, unknown> {
  series: PricePoint[];
  low30d?: number;
  low90d?: number;
  lowAllTime?: number;
  current?: number;
  note?: string;
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export async function handler(
  input: GetPriceHistoryInput,
  ctx: McpContext,
): Promise<GetPriceHistoryResult> {
  requireScope(ctx, REQUIRED_SCOPE);

  // ASIN queries are Keepa-backed. Before reading the cache, check whether
  // the latest observation is older than the freshness window — if so, hit
  // Keepa, persist the new points, then fall through to the read below so
  // the same shaping logic runs over both fresh and historical rows.
  if (input.asin) {
    await maybeRefreshFromKeepa(input.asin, ctx);
  }

  const conditions = [] as Array<ReturnType<typeof eq>>;
  if (input.asin) {
    conditions.push(eq(prices.asin, input.asin));
  } else if (input.productUrl) {
    conditions.push(eq(prices.productKey, sha256Hex(input.productUrl)));
  }

  if (input.days != null) {
    conditions.push(
      gt(
        prices.observedAt,
        sql`now() - make_interval(days => ${input.days})` as unknown as Date,
      ),
    );
  }

  const rows = await ctx.db
    .select({
      observedAt: prices.observedAt,
      priceCents: prices.priceCents,
      availability: prices.availability,
    })
    .from(prices)
    .where(and(...conditions))
    .orderBy(asc(prices.observedAt))
    .limit(5000);

  if (rows.length === 0) {
    return { series: [], note: 'no history' };
  }

  const series: PricePoint[] = rows.map((r) => ({
    t: r.observedAt.toISOString(),
    priceCents: r.priceCents,
    availability: r.availability,
  }));

  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const lows = (windowMs: number | null): number | undefined => {
    const filtered =
      windowMs == null ? series : series.filter((p) => now - new Date(p.t).getTime() <= windowMs);
    if (filtered.length === 0) return undefined;
    return filtered.reduce((min, p) => (p.priceCents < min ? p.priceCents : min), filtered[0]!.priceCents);
  };

  const result: GetPriceHistoryResult = { series };
  const low30d = lows(30 * day);
  const low90d = lows(90 * day);
  const lowAllTime = lows(null);
  const last = series[series.length - 1];
  if (low30d !== undefined) result.low30d = low30d;
  if (low90d !== undefined) result.low90d = low90d;
  if (lowAllTime !== undefined) result.lowAllTime = lowAllTime;
  if (last) result.current = last.priceCents;
  return result;
}

/**
 * Check freshness for `asin`, and if stale (or empty), pull fresh history
 * from Keepa and persist it. Failures are logged but never thrown — the
 * surrounding handler will still serve whatever's already in the cache,
 * which is preferable to a 500 when Keepa is rate-limited.
 *
 * The freshness window matches Keepa's own cron cadence (≈hourly) but with
 * a generous 24h grace so we don't burn tokens on chatty agents.
 */
async function maybeRefreshFromKeepa(asin: string, ctx: McpContext): Promise<void> {
  const keepa = ctx.keepa ?? new KeepaClient();
  if (!keepa.isConfigured()) return;

  const normalized = asin.trim().toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(normalized)) return;

  const [latest] = await ctx.db
    .select({ observedAt: prices.observedAt })
    .from(prices)
    .where(eq(prices.asin, normalized))
    .orderBy(desc(prices.observedAt))
    .limit(1);

  if (latest && Date.now() - latest.observedAt.getTime() < KEEPA_DEFAULT_STALENESS_MS) {
    return;
  }

  let result: Awaited<ReturnType<KeepaClient['fetchPriceHistory']>>;
  try {
    result = await keepa.fetchPriceHistory({ asin: normalized });
  } catch (err) {
    log.warn(
      { asin: normalized, err: err instanceof Error ? err.message : String(err) },
      'Keepa fetch failed; serving cached price history',
    );
    return;
  }

  if (result.points.length === 0) return;

  // Avoid re-inserting overlap with whatever we already have. The `prices`
  // table has no unique constraint on (asin, observedAt), so cheap
  // de-duplication on the client side is the simplest safe option.
  const latestCachedMs = latest?.observedAt.getTime() ?? 0;
  const fresh = result.points.filter((p) => new Date(p.observedAt).getTime() > latestCachedMs);
  if (fresh.length === 0) return;

  const rows: NewPrice[] = fresh.map((p) => ({
    asin: normalized,
    productKey: normalized,
    observedAt: new Date(p.observedAt),
    priceCents: p.priceCents,
    currency: result.currency,
    availability: p.availability,
    source: 'keepa',
  }));

  try {
    await ctx.db.insert(prices).values(rows);
    log.info(
      { asin: normalized, inserted: rows.length, tokensLeft: result.tokensLeft },
      'Keepa price history refreshed',
    );
  } catch (err) {
    log.warn(
      { asin: normalized, err: err instanceof Error ? err.message : String(err) },
      'failed to persist Keepa price history',
    );
  }
}
