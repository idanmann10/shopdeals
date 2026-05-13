/**
 * `find_products` — live Google Shopping search via SerpApi, with coupon
 * cross-matching against our deals catalog.
 *
 * Flow:
 *   1. SerpApi `google_shopping` → top product candidate(s) with immersive
 *      product page tokens.
 *   2. For each product, follow up with SerpApi `google_immersive_product`
 *      to get the per-seller offer list with REAL merchant URLs (instead of
 *      Google Shopping product-page URLs that the agent would otherwise
 *      surface as buy links). This is the critical bit — without the
 *      follow-up, every buyLink lands on `google.com/search?ibp=oshop&...`
 *      and the user has to click through to the merchant themselves.
 *   3. Cross-match every offer's merchant slug against our active coupon
 *      catalog and attach codes inline.
 *   4. Run every outbound URL through `ctx.affiliate` so amazon.* URLs get
 *      our Associates tag and everything else gets Skimlinks-wrapped.
 *
 * For "what's the single best deal" queries, `find_best_deal` is the
 * dedicated tool — it returns one ranked answer instead of a flat list.
 * Agents should prefer it for that phrasing; this tool is the catalog view.
 */
import { z } from 'zod';
import { and, eq, inArray } from 'drizzle-orm';
import type { McpContext } from '../context.ts';
import { deals, merchants } from '../../db/schema.ts';
import { dealIsActive } from '../../db/predicates.ts';
import { SerpApiClient, type SellerOffer, type ShoppingResult } from '../../lib/serpapi.ts';
import { log } from '../../lib/log.ts';
import { serpApiRateLimiter } from '../../lib/rate-limit.ts';
import { requireScope } from '../scope.ts';
import type { CodeRef } from './types.ts';

export const name = 'find_products';

export const description =
  'Live shopping search across Google. Returns each merchant\'s direct buy link (not the Google product page), price, and any coupon we hold. For the single best pick, prefer find_best_deal.';

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
  /** Final link the agent should hand the user — direct merchant URL, affiliate-wrapped. */
  buyLink: string;
  rating?: number;
  reviews?: number;
  delivery?: string;
  thumbnail?: string;
  /** Working coupon codes from our catalog matched by merchant slug. */
  codes?: CodeRef[];
}

export interface FindProductsResult extends Record<string, unknown> {
  query: string;
  results: FindProductsItem[];
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

  // Rate limit: each call can burn up to 4 SerpApi credits (1 search + up
  // to 3 immersive). Without this a looping agent could blow the budget.
  serpApiRateLimiter.consumeOrThrow(ctx.clientHash, 'find_products');

  // Step 1: search. Ask for a small set since each immersive follow-up is
  // its own SerpApi credit. 3 candidates is enough variety; we'll fan their
  // sellers out into the response.
  let raw: ShoppingResult[];
  try {
    raw = await client.search({
      query: input.query,
      ...(input.country ? { country: input.country } : {}),
      limit: 3,
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

  // Step 2: enrich. For every shopping result that exposes an immersive
  // token, fetch its seller list in parallel. Each call yields direct
  // merchant URLs (rather than a Google Shopping product page).
  const offerLists = await Promise.all(
    raw.map(async (r) => {
      if (!r.immersiveToken) return null;
      try {
        return await client.productOffers(r.immersiveToken);
      } catch (err) {
        log.debug(
          { err: err instanceof Error ? err.message : String(err) },
          'find_products: immersive lookup failed for one candidate (non-fatal)',
        );
        return null;
      }
    }),
  );

  // Flatten + de-dupe by merchant slug. Each shopping_results entry might
  // map to several SellerOffers (one per merchant Google found). We want
  // the cheapest offer per merchant overall, capped at the user's limit.
  const bestPerSlug = new Map<string, SellerOffer>();
  for (let i = 0; i < raw.length; i++) {
    const offers = offerLists[i];
    if (offers && offers.length > 0) {
      for (const offer of offers) {
        const existing = bestPerSlug.get(offer.merchantSlug);
        if (
          !existing ||
          (offer.totalCents !== undefined &&
            (existing.totalCents === undefined || offer.totalCents < existing.totalCents))
        ) {
          bestPerSlug.set(offer.merchantSlug, offer);
        }
      }
    } else {
      // Fallback: if immersive failed, synthesize a SellerOffer from the
      // shopping_results row. This still uses Google's `product_link` —
      // suboptimal, but better than dropping the result.
      const r = raw[i]!;
      const o: SellerOffer = {
        merchantName: r.merchantName,
        merchantSlug: r.merchantSlug,
        link: r.link,
        flags: r.delivery ? [r.delivery] : [],
      };
      if (r.priceCents !== undefined) {
        o.priceCents = r.priceCents;
        o.totalCents = r.priceCents;
      }
      if (r.oldPriceCents !== undefined) o.originalPriceCents = r.oldPriceCents;
      const existing = bestPerSlug.get(o.merchantSlug);
      if (!existing) bestPerSlug.set(o.merchantSlug, o);
    }
  }

  const offers = Array.from(bestPerSlug.values())
    .sort((a, b) => {
      const av = a.totalCents ?? Number.POSITIVE_INFINITY;
      const bv = b.totalCents ?? Number.POSITIVE_INFINITY;
      return av - bv;
    })
    .slice(0, input.limit);

  if (offers.length === 0) {
    return { query: input.query, results: [] };
  }

  // Step 3: coupon cross-match.
  const slugs = Array.from(new Set(offers.map((o) => o.merchantSlug).filter((s) => s.length > 0)));
  const codesBySlug = slugs.length > 0 ? await loadCodesForSlugs(ctx, slugs) : new Map();

  const results: FindProductsItem[] = offers.map((o) => {
    const buyLink = ctx.affiliate ? ctx.affiliate.rewrite(o.link).url : o.link;
    const item: FindProductsItem = {
      title: o.title ?? raw[0]?.title ?? input.query,
      merchant: o.merchantName,
      merchantSlug: o.merchantSlug,
      buyLink,
    };
    if (o.priceCents !== undefined) item.priceCents = o.priceCents;
    if (o.originalPriceCents !== undefined) item.oldPriceCents = o.originalPriceCents;
    if (o.flags.length > 0) item.delivery = o.flags.join(' · ');
    const matches = codesBySlug.get(o.merchantSlug);
    if (matches && matches.length > 0) item.codes = matches.slice(0, 3);
    return item;
  });

  return { query: input.query, results };
}

async function loadCodesForSlugs(
  ctx: McpContext,
  slugs: string[],
): Promise<Map<string, CodeRef[]>> {
  requireScope(ctx, 'deals:read');

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
        eq(deals.kind, 'code'),
        dealIsActive(),
      ),
    )
    .limit(200);

  const out = new Map<string, CodeRef[]>();
  for (const r of rows) {
    if (!r.code) continue;
    const list = out.get(r.slug) ?? [];
    if (list.length >= 10) continue;
    list.push({ code: r.code, title: r.title, dealId: r.id });
    out.set(r.slug, list);
  }
  return out;
}
