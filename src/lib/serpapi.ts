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
}

export interface SerpApiOptions {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
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

    const params = new URLSearchParams({
      engine: 'google_shopping',
      q: query,
      api_key: this.apiKey,
      gl: country,
      num: String(limit),
    });
    const url = `${this.baseUrl}/search?${params.toString()}`;

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), this.timeoutMs);
    let body: unknown;
    try {
      const res = await this.fetchImpl(url, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`SerpApi HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      body = await res.json();
    } finally {
      clearTimeout(t);
    }

    const parsed = ResponseSchema.parse(body);
    if (parsed.error) throw new Error(`SerpApi error: ${parsed.error}`);

    const results = parsed.shopping_results ?? [];
    return results
      .slice(0, limit)
      .map((r) => normalizeResult(r))
      .filter((r): r is ShoppingResult => r !== null);
  }
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
