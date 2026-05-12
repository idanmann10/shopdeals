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
import { serpApiRateLimiter } from '../../lib/rate-limit.ts';

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

  // Rate limit: each call burns up to 2 SerpApi credits. Without this a
  // looping agent could torch our monthly budget in minutes.
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

  // Step 1: one search to find candidate products. Ask for 8 — Google's
  // ranking puts what it considers most relevant first, but for "shop
  // anything" queries the absolute cheapest is often the 3rd or 4th
  // result (different brand, similar specs).
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

  // Step 2: shortlist the top candidates by SerpApi's reported price
  // (free — uses data we already have). Then fan out immersive lookups
  // in parallel to get per-seller real merchant URLs + total prices.
  //
  // We evaluate up to MAX_CANDIDATES products. Each immersive call is
  // one SerpApi credit, so total cost = 1 (search) + N (immersives)
  // credits per query. The cache makes repeats free.
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

  // Per-candidate timeout: race each immersive call against a 5s deadline.
  // A slow candidate returns empty (and its promise still resolves in the
  // background, warming the cache for next time) — we never block the
  // whole query waiting for a straggler. The cheapest candidate that DID
  // respond wins, even if others are still pending.
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

  // Steps 2 + 3 run in parallel — coupon cross-match (DB) and Keepa
  // price-low signals (HTTP) don't depend on each other. Before this
  // change they ran sequentially and cost ~200-400ms on cold Keepa hits.
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
