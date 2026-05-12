/**
 * CouponAPI.org adapter.
 *
 * Source: paid coupon feed (free 7-day trial, $49/mo basic). 362k coupons,
 * 15k stores, 82 affiliate networks. Docs:
 * https://couponapi.org/help/knowledgebase.php?article=59
 *
 * Endpoint: GET https://couponapi.org/api/getIncrementalFeed/
 *
 * Auth: API_KEY query param.
 *
 * Watermarking is server-side: the API tracks per-key extraction state and
 * each call returns only offers that have changed since the last successful
 * call (new / updated / suspended). We don't manage our own cursor.
 *
 * Sample response shape:
 *   {
 *     "result": true,
 *     "offers": [
 *       { "offer_id": 12345, "title": "...", "status": "new",
 *         "code": "SAVE20", "store": "Acme", "end_date": "2024-12-31",
 *         "affiliate_link": "https://...", ... },
 *       ...
 *     ]
 *   }
 *
 * Suspended offers are still returned but with `status='suspended'`. We
 * yield them through the adapter so the lifecycle sweep's source-network
 * staleness pass can deactivate them on the next tick. (Alternatively we
 * could filter them here and rely entirely on the sweep — but downstream
 * we want to know they were actively dropped vs. just absent.)
 */
import { z } from 'zod';
import { env } from '../lib/env.ts';
import { log } from '../lib/log.ts';
import {
  parseDiscountFromText,
  slugify,
  toDate,
  type RawDealInput,
  type SourceAdapter,
} from './common.ts';

const DEFAULT_BASE_URL = 'https://couponapi.org/api/getIncrementalFeed/';

const CouponSchema = z
  .object({
    // CouponAPI uses `offer_id`; we also accept `id` for forward-compat.
    offer_id: z.union([z.string(), z.number()]).nullish(),
    id: z.union([z.string(), z.number()]).nullish(),
    title: z.string().nullish(),
    description: z.string().nullish(),
    code: z.string().nullish(),
    coupon_code: z.string().nullish(),
    affiliate_link: z.string().nullish(),
    smartLink: z.string().nullish(),
    url: z.string().nullish(),
    store: z.string().nullish(),
    store_id: z.union([z.string(), z.number()]).nullish(),
    store_url: z.string().nullish(),
    store_image: z.string().nullish(),
    image: z.string().nullish(),
    image_url: z.string().nullish(),
    categories: z.union([z.string(), z.array(z.string())]).nullish(),
    category_name: z.string().nullish(),
    start_date: z.string().nullish(),
    end_date: z.string().nullish(),
    /** "new" | "updated" | "suspended" | "active" — varies by feed mode. */
    status: z.string().nullish(),
    country: z.union([z.string(), z.array(z.string())]).nullish(),
    cashback_link: z.string().nullish(),
    deeplink_source: z.string().nullish(),
  })
  .passthrough();

export type CouponApiCoupon = z.infer<typeof CouponSchema>;

const ResponseSchema = z
  .object({
    result: z.union([z.boolean(), z.string()]).optional(),
    offers: z.array(CouponSchema).optional(),
    // Some endpoints return `data: [...]` instead of `offers: [...]`. Accept both.
    data: z.array(CouponSchema).optional(),
    // CouponAPI returns the new server-side watermark in some responses.
    last_extract: z.union([z.number(), z.string()]).nullish(),
    error: z.string().nullish(),
  })
  .passthrough();

export interface CouponApiAdapterOptions {
  apiKey?: string;
  /** Full URL including path (e.g. `https://couponapi.org/api/getIncrementalFeed/`). */
  endpoint?: string;
  fetchImpl?: typeof fetch;
  /**
   * Unix timestamp (seconds). When supplied, passed as `last_extract`. Skip
   * to let the server use its own watermark.
   */
  lastExtract?: number;
  /**
   * When true, passes `off_record=1` so the server-side watermark is not
   * advanced. Use in dev / one-off pulls. Production cron should set
   * `false` (the default) so the next run only returns deltas.
   */
  offRecord?: boolean;
  /** Optional country filter, e.g. 'US'. */
  country?: string;
  timeoutMs?: number;
}

export class CouponApiAdapter implements SourceAdapter {
  /**
   * We re-use the `manual` enum value (no migration cost). The downstream
   * `attributionSource='couponapi'` field still lets us filter by source.
   */
  readonly network = 'manual' as const;

  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly lastExtract: number | undefined;
  private readonly offRecord: boolean;
  private readonly country: string | undefined;
  private readonly timeoutMs: number;

  constructor(opts: CouponApiAdapterOptions = {}) {
    const e = (() => {
      try {
        return env() as unknown as Record<string, string | undefined>;
      } catch {
        return undefined;
      }
    })();
    this.apiKey = opts.apiKey ?? e?.['COUPONAPI_KEY'] ?? '';
    this.endpoint = opts.endpoint ?? e?.['COUPONAPI_BASE_URL'] ?? DEFAULT_BASE_URL;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.lastExtract = opts.lastExtract;
    this.offRecord = opts.offRecord ?? false;
    this.country = opts.country ?? e?.['COUPONAPI_COUNTRY'] ?? undefined;
    this.timeoutMs = opts.timeoutMs ?? 60_000;
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async *fetch(): AsyncIterable<RawDealInput> {
    if (!this.isConfigured()) return;

    const params = new URLSearchParams({
      API_KEY: this.apiKey,
      format: 'json',
    });
    if (this.lastExtract !== undefined) params.set('last_extract', String(this.lastExtract));
    if (this.offRecord) params.set('off_record', '1');
    if (this.country) params.set('country', this.country);

    const url = `${this.endpoint}${this.endpoint.includes('?') ? '&' : '?'}${params.toString()}`;

    let parsed: z.infer<typeof ResponseSchema>;
    try {
      parsed = await fetchFeed(url, this.fetchImpl, this.timeoutMs);
    } catch (err) {
      log.error(
        { err: err instanceof Error ? err.message : String(err) },
        'couponapi: feed fetch failed',
      );
      return;
    }

    if (parsed.error) {
      log.error({ error: parsed.error }, 'couponapi: server returned error');
      return;
    }

    const coupons = parsed.offers ?? parsed.data ?? [];
    if (coupons.length === 0) {
      log.info('couponapi: empty incremental delta');
      return;
    }

    let yielded = 0;
    let suspended = 0;
    for (const c of coupons) {
      const mapped = mapCoupon(c);
      if (mapped === null) {
        if ((c.status ?? '').toLowerCase() === 'suspended') suspended += 1;
        continue;
      }
      yielded += 1;
      yield mapped;
    }
    log.info(
      { yielded, suspended, total: coupons.length },
      'couponapi: incremental delta processed',
    );
  }
}

async function fetchFeed(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<z.infer<typeof ResponseSchema>> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${res.statusText}${body ? `: ${body.slice(0, 200)}` : ''}`);
    }
    const json = (await res.json()) as unknown;
    return ResponseSchema.parse(json);
  } finally {
    clearTimeout(t);
  }
}

/**
 * Quality gate: drop rows that look like landing-page placeholders rather
 * than real, actionable offers. CouponAPI returns a long tail of "Halloween
 * Decorations Main LP" / "Nike logo black [NEW]" rows that have no code,
 * no parseable discount, and no expiration — these poison search results
 * and the find_best_deal ranker if we let them through.
 *
 * Rule: keep the row if ANY of:
 *   - it has a `code` (a real coupon code makes it actionable)
 *   - the parser can extract a numeric discount (% or $ value)
 *   - the row has an explicit end_date (an actual offer with a deadline)
 *   - the title obviously announces a savings amount ("save $", "off", "% off")
 *
 * Everything else is a landing-page slot we can't surface honestly.
 */
function isQualityRow(c: CouponApiCoupon, code: string, title: string): boolean {
  if (code) return true;
  if (c.end_date && c.end_date.trim().length > 0) return true;
  const text = `${title} ${c.description ?? ''}`.toLowerCase();
  if (/\b\d{1,3}\s*%\s*off\b/.test(text)) return true;
  if (/\$\s*\d{1,4}(?:\.\d{1,2})?\s*off\b/.test(text)) return true;
  if (/\bsave\s+(?:\$|up\s+to|\d)/.test(text)) return true;
  if (/\bfree\s+(?:shipping|gift|trial)\b/.test(text)) return true;
  if (/\bbuy\s+\d.*get\s+\d|bogo\b/.test(text)) return true;
  return false;
}

/**
 * Map a CouponAPI offer to our canonical `RawDealInput`. Returns null when
 * the offer is missing the minimum we need, is marked suspended, or fails
 * the quality gate above.
 */
export function mapCoupon(c: CouponApiCoupon): RawDealInput | null {
  const offerId = String(c.offer_id ?? c.id ?? '').trim();
  if (!offerId) return null;

  const storeName = (c.store ?? '').trim();
  if (!storeName) return null;

  const status = (c.status ?? '').toLowerCase();
  if (status === 'suspended' || status === 'expired' || status === 'inactive' || status === 'deleted') {
    return null;
  }

  const code = (c.code ?? c.coupon_code ?? '').trim();
  const titleRaw = (c.title ?? c.description ?? '').trim();
  const title = titleRaw || `${storeName} offer`;

  if (!isQualityRow(c, code, title)) return null;

  const parsed = parseDiscountFromText(`${title} ${c.description ?? ''}`);

  const categories = normalizeCategories(c.categories ?? c.category_name);
  const countries = normalizeCountries(c.country);
  const domain = extractHost(c.store_url ?? '');

  const sourceMeta: Record<string, unknown> = {
    raw: { offer_id: c.offer_id ?? c.id, store_id: c.store_id },
  };
  if (c.deeplink_source) sourceMeta['deeplinkSource'] = c.deeplink_source;
  if (c.cashback_link) sourceMeta['cashbackLink'] = c.cashback_link;
  const storeImage = c.store_image ?? c.image ?? c.image_url;
  if (storeImage) sourceMeta['storeImage'] = storeImage;

  const out: RawDealInput = {
    sourceNetwork: 'manual',
    sourceId: `couponapi:${offerId}`,
    merchant: {
      slug: slugify(storeName),
      displayName: storeName,
      ...(domain ? { domains: [domain] } : {}),
      ...(categories ? { categories } : {}),
      ...(countries ? { countries } : {}),
      ...(c.store_url ? { homepageUrl: c.store_url } : {}),
    },
    kind: code ? 'code' : 'sale',
    title: title.slice(0, 512),
    discountType: parsed.discountType ?? 'unknown',
    attributionSource: 'couponapi',
    sourceMeta,
  };
  if (code) out.code = code;
  if (c.description) out.description = c.description;
  if (parsed.discountValueBps !== undefined) out.discountValueBps = parsed.discountValueBps;
  if (parsed.discountValueCents !== undefined) out.discountValueCents = parsed.discountValueCents;
  if (countries && countries.length > 0) out.geoScope = countries;
  const startsAt = toDate(c.start_date);
  if (startsAt) out.startsAt = startsAt;
  const expiresAt = toDate(c.end_date);
  if (expiresAt) out.expiresAt = expiresAt;
  const deeplink = c.affiliate_link ?? c.smartLink ?? c.url;
  if (deeplink) out.deeplink = deeplink;
  return out;
}

function normalizeCategories(v: unknown): string[] | undefined {
  if (!v) return undefined;
  const raw = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [];
  const out = raw
    .map((s) => String(s).trim().toLowerCase())
    .filter((s) => s.length > 0);
  return out.length > 0 ? Array.from(new Set(out)) : undefined;
}

function normalizeCountries(v: unknown): string[] | undefined {
  if (!v) return undefined;
  const raw = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,\s]+/) : [];
  const out = raw
    .map((s) => String(s).trim().toUpperCase())
    .filter((s) => /^[A-Z]{2}$/.test(s));
  return out.length > 0 ? Array.from(new Set(out)) : undefined;
}

function extractHost(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase() || undefined;
  } catch {
    return undefined;
  }
}
