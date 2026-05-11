/**
 * `find_products` — live Google Shopping search via SerpApi, with coupon
 * cross-matching against our deals catalog.
 *
 * The flow:
 *   1. SerpApi returns a list of product offers keyed by merchant.
 *   2. We collect every merchant slug across the results.
 *   3. One Drizzle query pulls every active `code`-kind deal whose merchant
 *      slug matches, grouped by slug.
 *   4. We attach the matching codes to each shopping result. An agent can
 *      now present "Best Buy: $189 (also: code SAVE20 from our catalog)."
 *   5. Every outbound link runs through `ctx.affiliate` so the commission
 *      comes back to us (Amazon Associates today; Skimlinks / Awin link
 *      converter as future env-gated rewriters).
 *
 * This is the single tool that turns the catalog from "what we cached" into
 * "anything on Google Shopping." It is also the tool that earns money:
 * every link in the response is a tagged affiliate URL.
 */
import { z } from 'zod';
import { and, eq, inArray, isNull, or, gt } from 'drizzle-orm';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import type { McpContext } from '../context.ts';
import { deals, merchants } from '../../db/schema.ts';
import { SerpApiClient, type ShoppingResult } from '../../lib/serpapi.ts';
import { log } from '../../lib/log.ts';

export const name = 'find_products';

export const description =
  'Live product search across Google Shopping. Returns the cheapest current offers, cross-matched with any active coupon codes we hold for that merchant. Buy links are affiliate-tagged.';

export const inputSchema = z.object({
  query: z.string().min(2).max(200),
  country: z.string().length(2).optional(),
  limit: z.number().int().min(1).max(20).default(8),
});

export type FindProductsInput = z.infer<typeof inputSchema>;

export interface FindProductsItem {
  title: string;
  merchant: string;
  merchantSlug: string;
  priceCents?: number;
  oldPriceCents?: number;
  /** Final link the agent should hand the user — affiliate-wrapped when applicable. */
  buyLink: string;
  rating?: number;
  reviews?: number;
  delivery?: string;
  thumbnail?: string;
  /** Working coupon codes from our catalog matched by merchant slug. */
  codes?: Array<{ code: string; title: string; dealId: string }>;
}

export interface FindProductsResult extends Record<string, unknown> {
  query: string;
  results: FindProductsItem[];
  /** Set when SerpApi isn't configured or search failed; result list will be empty. */
  note?: string;
}

export async function handler(
  input: FindProductsInput,
  ctx: McpContext,
): Promise<FindProductsResult> {
  const client = ctx.serpapi ?? new SerpApiClient();
  if (!client.isConfigured()) {
    return {
      query: input.query,
      results: [],
      note: 'live product search disabled (SERPAPI_KEY not set on this server)',
    };
  }

  let raw: ShoppingResult[];
  try {
    raw = await client.search({
      query: input.query,
      ...(input.country ? { country: input.country } : {}),
      limit: input.limit,
    });
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err), query: input.query },
      'find_products: SerpApi search failed',
    );
    return { query: input.query, results: [], note: 'live search temporarily unavailable' };
  }

  if (raw.length === 0) {
    return { query: input.query, results: [] };
  }

  // Cross-match: collect distinct merchant slugs in this result set, then
  // pull every active *code*-kind deal whose merchant slug matches.
  const slugs = Array.from(new Set(raw.map((r) => r.merchantSlug).filter((s) => s.length > 0)));
  const codesBySlug = slugs.length > 0 ? await loadCodesForSlugs(ctx, slugs) : new Map();

  const results: FindProductsItem[] = raw.map((r) => {
    const buyLink = ctx.affiliate ? ctx.affiliate.rewrite(r.link).url : r.link;
    const item: FindProductsItem = {
      title: r.title,
      merchant: r.merchantName,
      merchantSlug: r.merchantSlug,
      buyLink,
    };
    if (r.priceCents !== undefined) item.priceCents = r.priceCents;
    if (r.oldPriceCents !== undefined) item.oldPriceCents = r.oldPriceCents;
    if (r.rating !== undefined) item.rating = r.rating;
    if (r.reviews !== undefined) item.reviews = r.reviews;
    if (r.delivery !== undefined) item.delivery = r.delivery;
    if (r.thumbnail !== undefined) item.thumbnail = r.thumbnail;
    const matches = codesBySlug.get(r.merchantSlug);
    if (matches && matches.length > 0) {
      item.codes = matches.slice(0, 3);
    }
    return item;
  });

  return { query: input.query, results };
}

/**
 * Fetch active code-kind deals whose merchant slug is in `slugs`. Returns a
 * Map keyed by slug. Up to ~10 codes per merchant are surfaced.
 */
async function loadCodesForSlugs(
  ctx: McpContext,
  slugs: string[],
): Promise<Map<string, Array<{ code: string; title: string; dealId: string }>>> {
  // Throw a hard error from caller-side if scope is missing. Callers should
  // gate find_products on `deals:read` (same scope as find_deals).
  if (!ctx.scopes.includes('deals:read')) {
    throw new McpError(ErrorCode.InvalidRequest, 'forbidden: deals:read scope required');
  }

  const rows = await ctx.db
    .select({
      slug: merchants.slug,
      code: deals.code,
      title: deals.title,
      id: deals.id,
    })
    .from(deals)
    .innerJoin(merchants, eq(deals.merchantId, merchants.id))
    .where(
      and(
        inArray(merchants.slug, slugs),
        eq(deals.isActive, true),
        eq(deals.kind, 'code'),
        // Only show codes whose `code` column is actually populated.
        // (kind='code' should imply this but the schema permits null.)
        or(isNull(deals.expiresAt), gt(deals.expiresAt, new Date())),
      ),
    )
    .limit(200);

  const out = new Map<string, Array<{ code: string; title: string; dealId: string }>>();
  for (const r of rows) {
    if (!r.code) continue;
    const list = out.get(r.slug) ?? [];
    if (list.length >= 10) continue;
    list.push({ code: r.code, title: r.title, dealId: r.id });
    out.set(r.slug, list);
  }
  return out;
}
