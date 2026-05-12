/**
 * SerpApi Google Shopping client.
 *
 * Used by the `find_products` MCP tool to fall back to live shopping
 * search when our cached deal catalog has nothing for the user's query.
 * One call = one search = one SerpApi credit (~$0.005 on the Starter plan).
 *
 * Endpoint: `https://serpapi.com/search?engine=google_shopping&q=...`
 *
 * Auth: `api_key` query param.
 *
 * Response shape (the bits we care about):
 *   {
 *     shopping_results: [
 *       { position, title, link, source, price, extracted_price,
 *         old_price, extracted_old_price, rating, reviews, thumbnail,
 *         delivery, second_hand_condition, ... }, ...
 *     ],
 *     search_metadata: { total_time_taken, ... },
 *     error?: "..."
 *   }
 *
 * We normalize down to a small `ShoppingResult` shape so the MCP tool
 * doesn't leak SerpApi's field names into agent-facing JSON.
 */
import { z } from 'zod';
import { env } from './env.ts';

const ShoppingResultSchema = z
  .object({
    position: z.number().optional(),
    title: z.string(),
    link: z.string().optional(),
    product_link: z.string().optional(),
    source: z.string().optional(),
    price: z.string().optional(),
    extracted_price: z.number().optional(),
    old_price: z.string().optional(),
    extracted_old_price: z.number().optional(),
    rating: z.number().optional(),
    reviews: z.number().optional(),
    thumbnail: z.string().optional(),
    delivery: z.string().optional(),
    product_id: z.string().optional(),
    // Token used by `google_immersive_product` to fetch the per-seller offer
    // page. This is the path to real merchant URLs (the old google_product
    // engine is dead — Google retired the service).
    immersive_product_page_token: z.string().optional(),
  })
  .passthrough();

const StoreOfferSchema = z
  .object({
    name: z.string(),
    logo: z.string().optional(),
    link: z.string(),
    title: z.string().optional(),
    price: z.string().optional(),
    extracted_price: z.number().optional(),
    original_price: z.string().optional(),
    extracted_original_price: z.number().optional(),
    shipping: z.string().optional(),
    shipping_extracted: z.number().optional(),
    total: z.string().optional(),
    extracted_total: z.number().optional(),
    discount: z.string().optional(),
    details_and_offers: z.array(z.string()).optional(),
  })
  .passthrough();

const ImmersiveProductSchema = z
  .object({
    product_results: z
      .object({
        title: z.string().optional(),
        brand: z.string().optional(),
        rating: z.number().optional(),
        reviews: z.number().optional(),
        price_range: z.string().optional(),
        thumbnails: z.array(z.string()).optional(),
        stores: z.array(StoreOfferSchema).optional(),
      })
      .passthrough()
      .optional(),
    error: z.string().optional(),
  })
  .passthrough();

const ResponseSchema = z
  .object({
    shopping_results: z.array(ShoppingResultSchema).optional(),
    error: z.string().optional(),
    search_metadata: z
      .object({ total_time_taken: z.number().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();

export interface ShoppingResult {
  title: string;
  /** Direct merchant URL (may need affiliate rewriting). */
  link: string;
  /** Merchant name as Google reports it ("amazon.com", "Best Buy", etc.). */
  merchantName: string;
  /** Normalized merchant slug for joining against the deals table. */
  merchantSlug: string;
  /** Current price in cents. */
  priceCents?: number;
  /** Strike-through "was" price in cents, when displayed. */
  oldPriceCents?: number;
  rating?: number;
  reviews?: number;
  thumbnail?: string;
  delivery?: string;
  position?: number;
  /**
   * Token for `google_immersive_product` follow-up. When present, the caller
   * can resolve real merchant URLs + per-seller pricing via
   * `client.productOffers(token)`.
   */
  immersiveToken?: string;
}

export interface SellerOffer {
  /** Merchant display name (e.g. "Best Buy", "Amazon", "eBay - seller123"). */
  merchantName: string;
  /** Normalized slug for joining against our deals table. */
  merchantSlug: string;
  /** Direct merchant URL — already a real URL, not a google.com redirect. */
  link: string;
  title?: string;
  logo?: string;
  /** Item price in cents (no shipping). */
  priceCents?: number;
  /** Strike-through "was" price in cents. */
  originalPriceCents?: number;
  /** Shipping cost in cents. 0 when explicitly free; undefined when unknown. */
  shippingCents?: number;
  /** priceCents + shippingCents (computed if Google doesn't supply directly). */
  totalCents?: number;
  /** Free-text discount the seller is advertising, e.g. "35% off". */
  discountLabel?: string;
  /** "In stock", "Pre-owned", "Free returns", etc. */
  flags: string[];
}

export interface SerpApiOptions {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
  /**
   * Cache size for `search` + `productOffers` (per-method LRU). Repeat
   * queries within `cacheTtlMs` skip the network and the SerpApi credit
   * entirely. Set to 0 to disable.
   */
  cacheSize?: number;
  /** Cache TTL in milliseconds. Default: 5 minutes. */
  cacheTtlMs?: number;
}

/** Tiny dependency-free LRU with TTL. Stores Promises so concurrent calls coalesce. */
class LruCache<V> {
  private readonly map = new Map<string, { value: V; expiresAt: number }>();
  constructor(private readonly maxSize: number, private readonly ttlMs: number) {}

  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt < Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    // Mark as recently used by reinserting.
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }

  set(key: string, value: V): void {
    if (this.maxSize <= 0) return;
    if (this.map.size >= this.maxSize) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  delete(key: string): void {
    this.map.delete(key);
  }
}

export interface SearchInput {
  query: string;
  /** ISO-3166 alpha-2. Defaults to `us`. */
  country?: string;
  /** Max results to return — capped at 100. */
  limit?: number;
}

export class SerpApiClient {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly searchCache: LruCache<Promise<ShoppingResult[]>>;
  private readonly offerCache: LruCache<Promise<SellerOffer[]>>;

  constructor(opts: SerpApiOptions = {}) {
    const e = (() => {
      try {
        return env() as unknown as Record<string, string | undefined>;
      } catch {
        return undefined;
      }
    })();
    this.apiKey = opts.apiKey ?? e?.['SERPAPI_KEY'] ?? '';
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.baseUrl = (opts.baseUrl ?? 'https://serpapi.com').replace(/\/+$/, '');
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    const cacheSize = opts.cacheSize ?? 256;
    const ttl = opts.cacheTtlMs ?? 5 * 60 * 1000;
    this.searchCache = new LruCache(cacheSize, ttl);
    this.offerCache = new LruCache(cacheSize, ttl);
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async search(input: SearchInput): Promise<ShoppingResult[]> {
    if (!this.isConfigured()) {
      throw new Error('SerpApi not configured (SERPAPI_KEY missing)');
    }
    const query = input.query.trim();
    if (!query) return [];
    const limit = Math.max(1, Math.min(100, input.limit ?? 20));
    const country = (input.country ?? 'us').toLowerCase();

    // Cache key: include the public-facing inputs but NOT the api key.
    // Storing the Promise means a second caller for the same key while
    // the first is still inflight piggybacks on the same network call.
    const key = `q=${query.toLowerCase()}|gl=${country}|num=${limit}`;
    const hit = this.searchCache.get(key);
    if (hit) return hit;

    const promise = this.doSearch(query, country, limit);
    this.searchCache.set(key, promise);
    // Evict on failure so the next caller retries instead of inheriting the
    // failed cached promise. Attach a `.catch` that re-throws but ALSO
    // swallows the rejection here so Node doesn't flag it as unhandled —
    // the original `promise` reference handed back to the caller still
    // rejects normally.
    promise.catch(() => {
      this.searchCache.delete(key);
    });
    return promise;
  }

  private async doSearch(query: string, country: string, limit: number): Promise<ShoppingResult[]> {
    const params = new URLSearchParams({
      engine: 'google_shopping',
      q: query,
      api_key: this.apiKey,
      gl: country,
      num: String(limit),
    });
    const body = await this.fetchJson(`${this.baseUrl}/search?${params.toString()}`);
    const parsed = ResponseSchema.parse(body);
    if (parsed.error) throw new Error(`SerpApi error: ${parsed.error}`);
    const results = parsed.shopping_results ?? [];
    return results
      .slice(0, limit)
      .map((r) => normalizeResult(r))
      .filter((r): r is ShoppingResult => r !== null);
  }

  /**
   * Follow-up call: given an `immersiveToken` from a `search()` result,
   * fetch the per-seller offer list with real merchant URLs. This is the
   * path to direct buy links (the legacy `google_product` engine was
   * retired by Google).
   *
   * Costs 1 SerpApi credit per call.
   */
  async productOffers(immersiveToken: string): Promise<SellerOffer[]> {
    if (!this.isConfigured()) {
      throw new Error('SerpApi not configured (SERPAPI_KEY missing)');
    }
    if (!immersiveToken) return [];

    const hit = this.offerCache.get(immersiveToken);
    if (hit) return hit;

    const promise = this.doProductOffers(immersiveToken);
    this.offerCache.set(immersiveToken, promise);
    promise.catch(() => {
      this.offerCache.delete(immersiveToken);
    });
    return promise;
  }

  private async doProductOffers(immersiveToken: string): Promise<SellerOffer[]> {
    const params = new URLSearchParams({
      engine: 'google_immersive_product',
      page_token: immersiveToken,
      api_key: this.apiKey,
    });
    const body = await this.fetchJson(`${this.baseUrl}/search.json?${params.toString()}`);
    const parsed = ImmersiveProductSchema.parse(body);
    if (parsed.error) throw new Error(`SerpApi error: ${parsed.error}`);
    const stores = parsed.product_results?.stores ?? [];
    return stores.map((s) => normalizeOffer(s)).filter((o): o is SellerOffer => o !== null);
  }

  private async fetchJson(url: string): Promise<unknown> {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`SerpApi HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      return await res.json();
    } finally {
      clearTimeout(t);
    }
  }
}

function normalizeOffer(s: z.infer<typeof StoreOfferSchema>): SellerOffer | null {
  if (!s.name || !s.link) return null;
  const priceCents = s.extracted_price !== undefined ? Math.round(s.extracted_price * 100) : undefined;
  const shippingCents = s.shipping_extracted !== undefined ? Math.round(s.shipping_extracted * 100) : undefined;
  let totalCents = s.extracted_total !== undefined ? Math.round(s.extracted_total * 100) : undefined;
  if (totalCents === undefined && priceCents !== undefined) {
    // If the API didn't pre-compute the total, do it ourselves.
    totalCents = priceCents + (shippingCents ?? 0);
  }
  const flags: string[] = [];
  if (s.details_and_offers) {
    for (const d of s.details_and_offers) {
      const lower = d.toLowerCase();
      if (lower.includes('in stock') || lower.includes('free shipping') || lower.includes('free returns')) {
        flags.push(d);
      } else if (lower.includes('pre-owned') || lower.includes('refurbished')) {
        flags.push(d);
      }
    }
  }
  const out: SellerOffer = {
    merchantName: prettifyMerchantName(s.name),
    merchantSlug: slugifyMerchantName(s.name),
    link: s.link,
    flags,
  };
  if (s.title !== undefined) out.title = s.title;
  if (s.logo !== undefined) out.logo = s.logo;
  if (priceCents !== undefined) out.priceCents = priceCents;
  if (s.extracted_original_price !== undefined) out.originalPriceCents = Math.round(s.extracted_original_price * 100);
  if (shippingCents !== undefined) out.shippingCents = shippingCents;
  if (totalCents !== undefined) out.totalCents = totalCents;
  if (s.discount !== undefined) out.discountLabel = s.discount;
  return out;
}

function normalizeResult(r: z.infer<typeof ShoppingResultSchema>): ShoppingResult | null {
  // Google sometimes splits link vs product_link; the merchant URL is `link`,
  // `product_link` is Google's own product page. We want the merchant.
  const link = r.link ?? r.product_link;
  if (!link || !r.title) return null;

  const merchantName = (r.source ?? '').trim() || hostFromUrl(link) || 'unknown';
  const merchantSlug = slugifyMerchantName(merchantName);

  const out: ShoppingResult = {
    title: r.title,
    link,
    merchantName: prettifyMerchantName(merchantName),
    merchantSlug,
  };
  if (r.extracted_price !== undefined) out.priceCents = Math.round(r.extracted_price * 100);
  if (r.extracted_old_price !== undefined) out.oldPriceCents = Math.round(r.extracted_old_price * 100);
  if (r.rating !== undefined) out.rating = r.rating;
  if (r.reviews !== undefined) out.reviews = r.reviews;
  if (r.thumbnail !== undefined) out.thumbnail = r.thumbnail;
  if (r.delivery !== undefined) out.delivery = r.delivery;
  if (r.position !== undefined) out.position = r.position;
  if (r.immersive_product_page_token !== undefined) out.immersiveToken = r.immersive_product_page_token;
  return out;
}

function hostFromUrl(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return undefined;
  }
}

function slugifyMerchantName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\.com$|\.co\.uk$|\.net$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function prettifyMerchantName(raw: string): string {
  const trimmed = raw.replace(/\.com$|\.co\.uk$|\.net$/i, '').trim();
  if (trimmed.toLowerCase() === 'amazon' || trimmed.toLowerCase() === 'amazon.com') return 'Amazon';
  if (trimmed.toLowerCase() === 'walmart' || trimmed.toLowerCase() === 'walmart.com') return 'Walmart';
  if (trimmed.toLowerCase().includes('best buy')) return 'Best Buy';
  return trimmed
    .split(/[\s_-]+/)
    .map((p) => (p.length === 0 ? '' : p[0]!.toUpperCase() + p.slice(1)))
    .join(' ');
}
