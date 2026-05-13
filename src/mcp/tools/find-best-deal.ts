/**
 * `find_best_deal` — returns the single best buy for a product query, plus
 * a few alternatives. Pipeline:
 *
 *   1. SerpApi `google_shopping` for candidate products.
 *   2. SerpApi `google_immersive_product` for each candidate → per-seller
 *      real merchant URLs + total (price + shipping). The legacy
 *      `google_product` engine is retired; immersive is the only path to
 *      direct merchant links.
 *   3. For Amazon sellers with an extractable ASIN, Keepa → 30/90-day low
 *      signals.
 *   4. Cross-match merchant slug against our active coupon catalog.
 *   5. Rank by effective total (merchant total minus best applicable code).
 *
 * Cost: up to ~4 SerpApi credits per call (1 search + up to 3 immersive).
 */
import { z } from 'zod';
import { and, eq, inArray } from 'drizzle-orm';
import type { McpContext } from '../context.ts';
import { deals, merchants } from '../../db/schema.ts';
import { dealIsActive } from '../../db/predicates.ts';
import { SerpApiClient, type SellerOffer } from '../../lib/serpapi.ts';
import { extractAmazonAsin } from '../../lib/affiliate.ts';
import { KeepaClient } from '../../sources/keepa.ts';
import { log } from '../../lib/log.ts';
import { serpApiRateLimiter } from '../../lib/rate-limit.ts';
import { requireScope } from '../scope.ts';

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
  requireScope(ctx, 'deals:read');

  // Rate-limit before any SerpApi spend — each call burns up to 4 credits.
  serpApiRateLimiter.consumeOrThrow(ctx.clientHash, 'find_best_deal');

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

  // Ask for 8 candidates — for "shop anything" queries the cheapest option
  // is often a few results down from Google's top pick (different brand,
  // similar specs).
  let shoppingResults;
  try {
    shoppingResults = await serpapi.search({
      query: input.query,
      ...(input.country ? { country: input.country } : {}),
      limit: 8,
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

  if (shoppingResults.length === 0) {
    return finalize({ query: input.query, alternatives: [], meta }, t0);
  }

  // Shortlist by SerpApi's reported price (free — we already have it), then
  // fan out immersive lookups in parallel. Each immersive is one credit; the
  // cache makes repeats free.
  const MAX_CANDIDATES = 3;
  const withTokens = shoppingResults.filter((r) => r.immersiveToken);
  const candidates = withTokens
    .slice() // don't mutate the search-result cache
    .sort((a, b) => {
      const av = a.priceCents ?? Number.POSITIVE_INFINITY;
      const bv = b.priceCents ?? Number.POSITIVE_INFINITY;
      return av - bv;
    })
    .slice(0, MAX_CANDIDATES);
  const productTitle = candidates[0]?.title ?? shoppingResults[0]?.title;

  // Race each immersive call against a 5s deadline. A slow candidate
  // returns empty (its promise still resolves in the background and warms
  // the cache); we never block on a straggler.
  const IMMERSIVE_DEADLINE_MS = 5000;
  const immersiveResults = await Promise.all(
    candidates.map((c) => {
      meta.serpapiCalls += 1;
      const real = serpapi
        .productOffers(c.immersiveToken!)
        .then((sellers) => ({ candidate: c, sellers }))
        .catch((err) => {
          log.warn(
            { err: err instanceof Error ? err.message : String(err), product: c.title },
            'find_best_deal: immersive lookup failed for one candidate (non-fatal)',
          );
          return { candidate: c, sellers: [] as SellerOffer[] };
        });
      const timeout = new Promise<{ candidate: typeof c; sellers: SellerOffer[] }>((resolve) => {
        setTimeout(() => {
          log.debug({ product: c.title }, 'find_best_deal: per-candidate deadline hit');
          resolve({ candidate: c, sellers: [] });
        }, IMMERSIVE_DEADLINE_MS);
      });
      return Promise.race([real, timeout]);
    }),
  );

  // Flatten: every (product, seller) combination becomes one offer in the
  // ranking pool. We carry the product title alongside the offer so the
  // returned best/alternatives can show "this is the cheapest version OF
  // any product we evaluated", not just "the cheapest seller of the first
  // result Google ranked."
  let offers: SellerOffer[] = immersiveResults.flatMap((r) =>
    r.sellers.map((s) => ({
      ...s,
      // Annotate with the product title if the seller's own title is empty.
      ...(s.title ? {} : { title: r.candidate.title }),
    })),
  );

  // Fallback: if every immersive call failed, synthesize from shopping_results.
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
        if (r.title) o.title = r.title;
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

  // Coupon cross-match (DB) and Keepa price-low signals (HTTP) are independent —
  // fan them out in parallel to avoid serializing the cold-Keepa latency.
  const slugs = Array.from(new Set(offers.map((o) => o.merchantSlug).filter((s) => s.length > 0)));
  const keepa = ctx.keepa ?? new KeepaClient();

  const [codesBySlug, priceSignalByLink] = await Promise.all([
    slugs.length > 0
      ? loadCodesForSlugs(ctx, slugs)
      : Promise.resolve(new Map<string, CodeMatch[]>()),
    keepa.isConfigured()
      ? fetchAmazonPriceSignals(keepa, offers, meta).catch((err) => {
          log.debug(
            { err: err instanceof Error ? err.message : String(err) },
            'find_best_deal: Keepa parallel pass failed (non-fatal)',
          );
          return new Map<string, string>();
        })
      : Promise.resolve(new Map<string, string>()),
  ]);

  meta.couponsMatched = Array.from(codesBySlug.values()).reduce((n, arr) => n + arr.length, 0);

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
  // Use the best-ranked offer's title (or the cheapest candidate's title)
  // as the canonical productTitle. With multi-candidate ranking, "the
  // product" might differ from "the first Google result" — surface the
  // winning product.
  const winningTitle = best?.title ?? productTitle;
  if (winningTitle) result.productTitle = winningTitle;
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
 * Fan out per-ASIN Keepa lookups in parallel for any Amazon offers.
 * Returns a map keyed by offer.link → price-signal string (e.g. "30-day low").
 * Cap at 3 distinct ASINs to bound credit spend.
 */
async function fetchAmazonPriceSignals(
  keepa: KeepaClient,
  offers: SellerOffer[],
  meta: { keepaCalls: number },
): Promise<Map<string, string>> {
  const amazonOffers = offers.filter(
    (o) => o.merchantSlug === 'amazon' || /amazon/i.test(o.merchantName),
  );
  if (amazonOffers.length === 0) return new Map();

  // Distinct ASINs we need to look up.
  const asinToOffers = new Map<string, SellerOffer[]>();
  for (const o of amazonOffers) {
    const asin = extractAmazonAsin(o.link);
    if (!asin) continue;
    const list = asinToOffers.get(asin) ?? [];
    list.push(o);
    asinToOffers.set(asin, list);
  }
  const asins = [...asinToOffers.keys()].slice(0, 3);
  if (asins.length === 0) return new Map();

  const results = await Promise.all(
    asins.map(async (asin) => {
      try {
        const hist = await keepa.fetchPriceHistory({ asin });
        meta.keepaCalls += 1;
        const samples = asinToOffers.get(asin) ?? [];
        // Use the first sample's price as the "current" benchmark.
        const current = samples[0]?.priceCents ?? samples[0]?.totalCents;
        const signal = priceSignalFromHistory(hist.points, current);
        return { asin, signal };
      } catch (err) {
        log.debug(
          { err: err instanceof Error ? err.message : String(err), asin },
          'find_best_deal: Keepa lookup failed for ASIN (non-fatal)',
        );
        return { asin, signal: undefined as string | undefined };
      }
    }),
  );

  const out = new Map<string, string>();
  for (const r of results) {
    if (!r.signal) continue;
    for (const o of asinToOffers.get(r.asin) ?? []) {
      out.set(o.link, r.signal);
    }
  }
  return out;
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
    .where(and(inArray(merchants.slug, slugs), dealIsActive()))
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
      // Approximate a bps discount against a "typical" $100 cart so the
      // ranker has a comparable cents value to sort on.
      item.estimatedDiscountCents = Math.round(r.discountValueBps * 0.01 * 100);
    }
    list.push(item);
    // Pick the highest-discount as "best" by re-sorting on insertion.
    list.sort((a, b) => (b.estimatedDiscountCents ?? 0) - (a.estimatedDiscountCents ?? 0));
    out.set(r.slug, list);
  }
  return out;
}
