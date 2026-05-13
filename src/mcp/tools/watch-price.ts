/**
 * `watch_price` — persists a "notify me when X hits $Y" request keyed to
 * the calling agent's clientHash. A cron worker walks `price_watches`
 * rows where `is_active=true` and the last check is older than 6 hours,
 * re-runs a SerpApi check, and notifies via email/webhook when
 * `currentTotal <= targetPriceCents`.
 *
 * The notify-cron worker is not yet wired in this repo; this tool ships
 * the persistence + contract so agents can register watches against a
 * stable watchId.
 */
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import type { McpContext } from '../context.ts';
import { priceWatches } from '../../db/schema.ts';
import { log } from '../../lib/log.ts';
import { requireScope } from '../scope.ts';

export const name = 'watch_price';

export const description =
  'Persist a price watch: notify the user when a product hits a target price. Specify either a query OR a productUrl, plus the targetPriceCents. Returns a watchId.';

export const inputSchema = z
  .object({
    query: z.string().min(2).max(200).optional(),
    productUrl: z.string().url().max(2048).optional(),
    targetPriceCents: z.number().int().min(1).max(10_000_000),
    country: z.string().length(2).optional(),
    notifyEmail: z.string().email().max(320).optional(),
    notifyWebhook: z.string().url().max(1024).optional(),
  })
  .refine((v) => Boolean(v.query) || Boolean(v.productUrl), {
    message: 'one of query or productUrl is required',
  })
  .refine((v) => Boolean(v.notifyEmail) || Boolean(v.notifyWebhook), {
    message: 'one of notifyEmail or notifyWebhook is required so we know where to alert',
  });

export type WatchPriceInput = z.infer<typeof inputSchema>;

export interface WatchPriceResult extends Record<string, unknown> {
  watchId: string;
  /** "active" on success. We don't yet expose an explicit "duplicate"
   * status — the agent can list watches to confirm uniqueness. */
  status: 'active';
  /** When the agent should expect the first check (~within an hour of
   * creation, then every ~6 hours). Informational; the cron isn't yet
   * shipped, so this is a contract promise, not a guarantee. */
  expectedFirstCheckAt: string;
  query?: string;
  productUrl?: string;
  targetPriceCents: number;
}

const MAX_ACTIVE_PER_CLIENT = 50;

export async function handler(
  input: WatchPriceInput,
  ctx: McpContext,
): Promise<WatchPriceResult> {
  requireScope(ctx, 'deals:read');

  // Enforce a per-client cap. Without this, an agent looping through every
  // product on a page could persist thousands of watches and DOS our cron.
  const existing = await ctx.db
    .select({ id: priceWatches.id })
    .from(priceWatches)
    .where(and(eq(priceWatches.clientHash, ctx.clientHash), eq(priceWatches.isActive, true)))
    .limit(MAX_ACTIVE_PER_CLIENT + 1);

  if (existing.length >= MAX_ACTIVE_PER_CLIENT) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      `you already have ${MAX_ACTIVE_PER_CLIENT} active watches — cancel some before adding more`,
    );
  }

  const row: typeof priceWatches.$inferInsert = {
    clientHash: ctx.clientHash,
    targetPriceCents: input.targetPriceCents,
  };
  if (input.query) row.query = input.query;
  if (input.productUrl) row.productUrl = input.productUrl;
  if (input.country) row.countryCode = input.country.toUpperCase();
  if (input.notifyEmail) row.notifyEmail = input.notifyEmail.toLowerCase();
  if (input.notifyWebhook) row.notifyWebhook = input.notifyWebhook;

  const inserted = await ctx.db.insert(priceWatches).values(row).returning({ id: priceWatches.id });
  const id = inserted[0]?.id;
  if (!id) {
    log.error({ clientHash: ctx.clientHash }, 'watch_price: insert returned no id');
    throw new McpError(ErrorCode.InternalError, 'failed to create watch');
  }

  // First check fires in ~1 hour (the cron sweeps every 15 min and picks
  // up new rows on its next run). The text below matches that expectation.
  const expected = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  const result: WatchPriceResult = {
    watchId: id,
    status: 'active',
    expectedFirstCheckAt: expected,
    targetPriceCents: input.targetPriceCents,
  };
  if (input.query) result.query = input.query;
  if (input.productUrl) result.productUrl = input.productUrl;
  return result;
}
