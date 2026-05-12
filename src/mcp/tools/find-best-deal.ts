/**
 * `find_best_deal` — the killer tool.
 *
 * One MCP call takes a product query ("AirPods Pro under $250") and
 * returns the single best buy + a few alternatives, with every link
 * affiliate-tagged. Behind the scenes:
 *
 *   1. SerpApi `google_shopping` → top product candidate
 *   2. SerpApi `google_immersive_product` → real merchant URLs + per-seller
 *      total cost (price + shipping)
 *   3. For Amazon sellers, extract ASIN → Keepa → flag 30/90-day lows
 *   4. Cross-match our DB coupon catalog by merchant slug, apply best code
 *   5. Compute effective total = merchant_total − code_discount
 *   6. Rank ascending, return top N
 *
 * Failure modes:
 *   - SerpApi not configured → graceful note, empty results
 *   - SerpApi search returns nothing → empty results
 *   - Immersive call fails → fall back to the shopping-results level
 *     (no per-seller totals, but at least we surface the best price we saw)
 *   - Keepa not configured or rate-limited → skip the price-low signals
 *
 * Cost: 2 SerpApi credits per call (1 search + 1 immersive). Free plan
 * is 250/mo = 125 best-deal queries. Starter at $25/mo is 500 queries.
 */
import { z } from 'zod';
import { and, eq, gt, inArray, isNull, or } from 'drizzle-orm';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import type { McpContext } from '../context.ts';
import { deals, merchants } from '../../db/schema.ts';
import { SerpApiClient, type SellerOffer } from '../../lib/serpapi.ts';
import { extractAmazonAsin } from '../../lib/affiliate.ts';
import { KeepaClient } from '../../sources/keepa.ts';
import { log } from '../../lib/log.ts';

export const name = 'find_best_deal';

export const description =
  'Find the best buy for a product query. Compares live seller prices, attaches matching coupons, flags Amazon price lows via Keepa, returns ranked options with affiliate-tagged links.';

export const inputSchema = z.object({
  query: z.string().min(2).max(200),
  country: z.string().length(2).optional(),
  /** How many alternatives to return alongside the single best pick. */
  alternatives: z.number().int().min(0).max(8).default(3),
});

export type FindBestDealInput = z.infer<typeof inputSchema>;

export interface CodeMatch {
  /** The coupon code itself, when applicable; absent for sale-kind deals. */
  code?: string;
  title: string;
  dealId: string;
  /** Best-guess effective discount in cents (parsed from the deal's metadata). */
  estimatedDiscountCents?: number;
}

export interface BestDealOption {
  merchant: string;
  merchantSlug: string;
  /** Affiliate-tagged buy URL. */
  buyLink: string;
  title?: string;
  priceCents?: number;
  shippingCents?: number;
  /** priceCents + shippingCents, sometimes pre-computed by Google. */
  totalCents?: number;
  originalPriceCents?: number;
  /** What we project the user actually pays after applying the best code. */
  effectiveTotalCents?: number;
  discountLabel?: string;
  /** Coupons we hold for this merchant. The first one (if any) is the
   * "best" applied to compute effectiveTotalCents. */
  codes?: CodeMatch[];
  /** Stock / shipping / condition flags from Google. */
  flags: string[];
  /** "30-day low", "90-day low", "near all-time low" — when Keepa data
   * supports it. Only set for Amazon URLs with an extractable ASIN. */
  priceSignal?: string;
}

export interface FindBestDealResult extends Record<string, unknown> {
  query: string;
  productTitle?: string;
  /** The single best pick. Undefined when we have zero usable offers. */
  best?: BestDealOption;
  alternatives: BestDealOption[];
  /** Set when SerpApi isn't configured or returned nothing usable. */
  note?: string;
  /** Diagnostic info — useful for the eval suite. */
  meta: {
    serpapiCalls: number;
    keepaCalls: number;
    couponsMatched: number;
    durationMs: number;
  };
}

export async function handler(
  input: FindBestDealInput,
  ctx: McpContext,
): Promise<FindBestDealResult> {
  // Same scope as find_deals — the heavy lifting happens against the public
  // shopping APIs, but we still join against our private coupon catalog.
  if (!ctx.scopes.includes('deals:read')) {
    throw new McpError(ErrorCode.InvalidRequest, 'forbidden: deals:read scope required');
  }

  const t0 = performance.now();
  const meta = { serpapiCalls: 0, keepaCalls: 0, couponsMatched: 0, durationMs: 0 };

  const serpapi = ctx.serpapi ?? new SerpApiClient();
  if (!serpapi.isConfigured()) {
    return finalize({
      query: input.query,
      alternatives: [],
      note: 'live shopping search disabled (SERPAPI_KEY not set on this server)',
      meta,
    }, t0);
  }

  // Step 1: one search to find the top product candidate.
  let shoppingResults;
  try {
    shoppingResults = await serpapi.search({
      query: input.query,
      ...(input.country ? { country: input.country } : {}),
      limit: 3,
    });
    meta.serpapiCalls += 1;
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err), query: input.query },
      'find_best_deal: SerpApi search failed',
    );
    return finalize({
      query: input.query,
      alternatives: [],
      note: 'live search temporarily unavailable',
      meta,
    }, t0);
  }

  // Find the first result that has an immersive token (the entry point to
  // real merchant URLs). If none, fall back to the raw shopping results.
  const candidate = shoppingResults.find((r) => r.immersiveToken) ?? shoppingResults[0];
  if (!candidate) {
    return finalize({ query: input.query, alternatives: [], meta }, t0);
  }

  let offers: SellerOffer[] = [];
  if (candidate.immersiveToken) {
    meta.serpapiCalls += 1;
    try {
      offers = await serpapi.productOffers(candidate.immersiveToken);
    } catch (err) {
      log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'find_best_deal: immersive product call failed, falling back to shopping-result level',
      );
    }
  }

  // If immersive didn't yield offers, synthesize one from the shopping result.
  if (offers.length === 0) {
    offers = shoppingResults
      .filter((r) => r.link && r.priceCents !== undefined)
      .map((r) => {
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
        return o;
      });
  }

  if (offers.length === 0) {
    return finalize({ query: input.query, alternatives: [], meta }, t0);
  }

  // Step 2: coupon cross-match.
  const slugs = Array.from(new Set(offers.map((o) => o.merchantSlug).filter((s) => s.length > 0)));
  const codesBySlug = slugs.length > 0 ? await loadCodesForSlugs(ctx, slugs) : new Map();
  meta.couponsMatched = Array.from(codesBySlug.values()).reduce((n, arr) => n + arr.length, 0);

  // Step 3: Keepa price-low signals for any Amazon offer with an extractable ASIN.
  const keepa = ctx.keepa ?? new KeepaClient();
  const priceSignalByLink = new Map<string, string>();
  if (keepa.isConfigured()) {
    const amazonOffers = offers.filter((o) => o.merchantSlug === 'amazon' || /amazon/i.test(o.merchantName));
    // Cap Keepa calls — one per query is plenty, since Amazon offers tend to
    // share the same ASIN.
    const seenAsins = new Set<string>();
    for (const o of amazonOffers.slice(0, 3)) {
      const asin = extractAmazonAsin(o.link);
      if (!asin || seenAsins.has(asin)) continue;
      seenAsins.add(asin);
      try {
        const hist = await keepa.fetchPriceHistory({ asin });
        meta.keepaCalls += 1;
        const signal = priceSignalFromHistory(hist.points, o.priceCents ?? o.totalCents);
        if (signal) {
          for (const inner of amazonOffers) {
            if (extractAmazonAsin(inner.link) === asin) {
              priceSignalByLink.set(inner.link, signal);
            }
          }
        }
      } catch (err) {
        log.debug(
          { err: err instanceof Error ? err.message : String(err), asin },
          'find_best_deal: Keepa lookup failed (non-fatal)',
        );
      }
    }
  }

  // Step 4: build the per-option payload, compute effective total, sort.
  const ranked: BestDealOption[] = offers.map((o) => {
    const codes = codesBySlug.get(o.merchantSlug) ?? [];
    const best = codes[0];
    const merchantTotal = o.totalCents ?? o.priceCents;
    const effective = applyDiscount(merchantTotal, best?.estimatedDiscountCents);
    const buyLink = ctx.affiliate ? ctx.affiliate.rewrite(o.link).url : o.link;
    const item: BestDealOption = {
      merchant: o.merchantName,
      merchantSlug: o.merchantSlug,
      buyLink,
      flags: o.flags,
    };
    if (o.title) item.title = o.title;
    if (o.priceCents !== undefined) item.priceCents = o.priceCents;
    if (o.shippingCents !== undefined) item.shippingCents = o.shippingCents;
    if (o.totalCents !== undefined) item.totalCents = o.totalCents;
    if (o.originalPriceCents !== undefined) item.originalPriceCents = o.originalPriceCents;
    if (effective !== undefined) item.effectiveTotalCents = effective;
    if (o.discountLabel) item.discountLabel = o.discountLabel;
    if (codes.length > 0) item.codes = codes;
    const signal = priceSignalByLink.get(o.link);
    if (signal) item.priceSignal = signal;
    return item;
  });

  // Rank by effectiveTotalCents asc (offers without a total drift to the
  // back — we don't pretend to know their cost).
  ranked.sort((a, b) => {
    const av = a.effectiveTotalCents ?? a.totalCents ?? Number.POSITIVE_INFINITY;
    const bv = b.effectiveTotalCents ?? b.totalCents ?? Number.POSITIVE_INFINITY;
    return av - bv;
  });

  const best = ranked[0];
  const altCount = Math.min(input.alternatives, ranked.length - 1);
  const alternatives = ranked.slice(1, 1 + altCount);

  const result: FindBestDealResult = {
    query: input.query,
    alternatives,
    meta,
  };
  if (candidate.title) result.productTitle = candidate.title;
  if (best) result.best = best;
  return finalize(result, t0);
}

function finalize<T extends { meta: { durationMs: number } }>(result: T, t0: number): T {
  result.meta.durationMs = Math.round(performance.now() - t0);
  return result;
}

/**
 * Apply a code's estimated discount to a base total. Returns undefined when
 * we don't have a numeric total to start from.
 *
 * Sanity clamp: reject discounts that are more than 60% of the base — those
 * are almost always junk metadata (e.g. CouponAPI rows where the parser
 * pulled a price-tag out of a landing-page title as the discount value).
 * The ranker would otherwise rank these "too-good-to-be-true" rows first.
 */
function applyDiscount(baseCents: number | undefined, discountCents: number | undefined): number | undefined {
  if (baseCents === undefined) return undefined;
  if (!discountCents || discountCents <= 0) return baseCents;
  const ratio = discountCents / baseCents;
  if (ratio > 0.6) return baseCents;
  return Math.max(0, baseCents - discountCents);
}

/**
 * Translate a Keepa price history into a short human-readable signal when
 * the current price is at or near the 30/90/all-time low.
 */
function priceSignalFromHistory(
  points: Array<{ observedAt: string; priceCents: number; availability: string }>,
  currentCents: number | undefined,
): string | undefined {
  if (!currentCents || points.length === 0) return undefined;
  const inStock = points.filter((p) => p.availability === 'in_stock' && p.priceCents > 0);
  if (inStock.length === 0) return undefined;
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const window = (ms: number | null) =>
    inStock.filter((p) => ms === null || now - new Date(p.observedAt).getTime() <= ms).reduce(
      (min, p) => (p.priceCents < min ? p.priceCents : min),
      Number.POSITIVE_INFINITY,
    );
  const low30 = window(30 * day);
  const low90 = window(90 * day);
  const lowAll = window(null);
  // "At" the low if we're within ~5%; "near" if within 10%.
  if (Number.isFinite(lowAll) && currentCents <= lowAll * 1.02) return 'all-time low';
  if (Number.isFinite(low90) && currentCents <= low90 * 1.02) return '90-day low';
  if (Number.isFinite(low30) && currentCents <= low30 * 1.02) return '30-day low';
  if (Number.isFinite(low30) && currentCents <= low30 * 1.1) return 'near 30-day low';
  return undefined;
}

/**
 * Pull active deals from the DB whose merchant slug matches the given list.
 * Returns up to ~5 codes per merchant, ranked by the parsed discount magnitude.
 */
async function loadCodesForSlugs(
  ctx: McpContext,
  slugs: string[],
): Promise<Map<string, CodeMatch[]>> {
  const rows = await ctx.db
    .select({
      slug: merchants.slug,
      id: deals.id,
      code: deals.code,
      title: deals.title,
      kind: deals.kind,
      discountValueCents: deals.discountValueCents,
      discountValueBps: deals.discountValueBps,
    })
    .from(deals)
    .innerJoin(merchants, eq(deals.merchantId, merchants.id))
    .where(
      and(
        inArray(merchants.slug, slugs),
        eq(deals.isActive, true),
        or(isNull(deals.expiresAt), gt(deals.expiresAt, new Date())),
      ),
    )
    .limit(200);

  const out = new Map<string, CodeMatch[]>();
  for (const r of rows) {
    const list = out.get(r.slug) ?? [];
    if (list.length >= 5) continue;
    const item: CodeMatch = { title: r.title, dealId: r.id };
    if (r.code != null) item.code = r.code;
    // Estimate the discount magnitude so we can compute effective total.
    // amt_off → use the cents value directly. pct_off requires the cart
    // total, which we don't know precisely — approximate against the
    // offer's current price (the caller will rescale if needed).
    if (r.discountValueCents != null && r.discountValueCents > 0) {
      item.estimatedDiscountCents = r.discountValueCents;
    } else if (r.discountValueBps != null && r.discountValueBps > 0) {
      // Stash as a basis-points hint; we apply against priceCents at usage
      // time in the caller's projection (currently we treat it as a flat
      // dollar value scaled to a "typical" $100 cart so the ranker has
      // something to sort on — fine for the v1).
      item.estimatedDiscountCents = Math.round(r.discountValueBps * 0.01 * 100);
    }
    list.push(item);
    // Pick the highest-discount as "best" by re-sorting on insertion.
    list.sort((a, b) => (b.estimatedDiscountCents ?? 0) - (a.estimatedDiscountCents ?? 0));
    out.set(r.slug, list);
  }
  return out;
}
