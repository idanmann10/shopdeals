import { createHash } from 'node:crypto';
import { z } from 'zod';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import type { McpContext } from '../context.ts';
import { prices } from '../../db/schema.ts';

export const name = 'get_price_history';

export const description =
  'Return observed price history for a product (Amazon ASIN or canonical product URL). Computes 30d, 90d and all-time lows. Requires the prices:read scope.';

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
  if (!ctx.scopes.includes(REQUIRED_SCOPE)) {
    // NOTE: previously raised `ErrorCode.ConnectionClosed` (-32000), which the
    // MCP SDK reserves for transport-level disconnects — clients react by
    // tearing down the session. `MethodNotFound` is also wrong (the method
    // exists; the caller just lacks scope). `InvalidRequest` (-32600) is the
    // closest semantic fit in the JSON-RPC error space the SDK exposes for
    // an authenticated-but-unauthorized request.
    throw new McpError(
      ErrorCode.InvalidRequest,
      `forbidden: ${REQUIRED_SCOPE} scope required`,
    );
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
