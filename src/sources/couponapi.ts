/**
 * CouponAPI.org adapter.
 *
 * Source: paid feed (free 7-day trial, $49/mo basic) at couponapi.org. Covers
 * 362k coupons across 15k stores and 82 affiliate networks — the broadest
 * single-API coupon catalog we've found in this price range.
 *
 * The CouponAPI docs are behind their auth wall so the schema below is
 * inferred from the field list they advertise publicly:
 *
 *     id, title, description, coupon_code, affiliate_link, store,
 *     store_id, store_url, store_image, categories, start_date,
 *     end_date, status, country, deeplink_source, cashback_link
 *
 * We use `passthrough()` everywhere so an unexpected extra field never
 * blocks an ingest. Field-name remapping (e.g. their docs say `coupon_code`
 * vs. `code`) can be done by overriding the response schema in tests
 * without changing the adapter shape.
 *
 * Auth: API key is passed as `API_KEY` query param per their convention.
 * The "incremental" feed type returns only changes since the last sync,
 * which is what we want for cron — full feed is too heavy at 362k rows.
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

const DEFAULT_BASE_URL = 'https://couponapi.org/api/v2';

const CouponSchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    title: z.string().nullish(),
    description: z.string().nullish(),
    // CouponAPI uses both `coupon_code` and `code` in different docs;
    // accept either.
    coupon_code: z.string().nullish(),
    code: z.string().nullish(),
    // Affiliate link already carries our publisher id when the feed is
    // pulled with our key — no client-side rewriting needed.
    affiliate_link: z.string().nullish(),
    deeplink_source: z.string().nullish(),
    store: z.string().nullish(),
    store_id: z.union([z.string(), z.number()]).nullish(),
    store_url: z.string().nullish(),
    store_image: z.string().nullish(),
    categories: z.union([z.string(), z.array(z.string())]).nullish(),
    start_date: z.string().nullish(),
    end_date: z.string().nullish(),
    // Status can be "active" / "inactive" / "deleted" depending on feed type.
    status: z.string().nullish(),
    country: z.union([z.string(), z.array(z.string())]).nullish(),
    cashback_link: z.string().nullish(),
  })
  .passthrough();

export type CouponApiCoupon = z.infer<typeof CouponSchema>;

const ResponseSchema = z
  .object({
    result: z.union([z.boolean(), z.string()]).optional(),
    // Most common envelope: `{ result: true, offers: [...] }`. Some endpoints
    // return `{ data: [...] }`. Accept both.
    offers: z.array(CouponSchema).optional(),
    data: z.array(CouponSchema).optional(),
    // Pagination cursors when present.
    next_offset: z.union([z.number(), z.string()]).nullish(),
    has_more: z.boolean().nullish(),
  })
  .passthrough();

export interface CouponApiAdapterOptions {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Page size. CouponAPI caps at 1000. */
  pageSize?: number;
  /** Safety cap on pagination. */
  maxPages?: number;
  /** Optional country filter, e.g. 'US'. */
  country?: string;
  /** `incremental` (recommended) or `full`. */
  feedType?: 'incremental' | 'full';
  timeoutMs?: number;
}

export class CouponApiAdapter implements SourceAdapter {
  readonly network = 'manual' as const;
  // ^^ We re-use the existing `manual` enum value rather than minting a new
  // `couponapi` enum — keeps the migration cost zero. The actual
  // `attributionSource` field is set to `couponapi` so downstream filtering
  // by *source* still works. If we ever want a dedicated enum value, that's
  // a one-line schema bump + migration.

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly pageSize: number;
  private readonly maxPages: number;
  private readonly country: string | undefined;
  private readonly feedType: 'incremental' | 'full';
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
    this.baseUrl = (opts.baseUrl ?? e?.['COUPONAPI_BASE_URL'] ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.pageSize = Math.max(1, Math.min(1000, opts.pageSize ?? 500));
    this.maxPages = Math.max(1, opts.maxPages ?? 50);
    this.country = opts.country ?? e?.['COUPONAPI_COUNTRY'] ?? undefined;
    this.feedType = opts.feedType ?? 'incremental';
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async *fetch(): AsyncIterable<RawDealInput> {
    if (!this.isConfigured()) return;

    let offset = 0;
    for (let page = 0; page < this.maxPages; page += 1) {
      const params = new URLSearchParams({
        API_KEY: this.apiKey,
        format: 'json',
        type: this.feedType,
        limit: String(this.pageSize),
        offset: String(offset),
      });
      if (this.country) params.set('country', this.country);
      const url = `${this.baseUrl}/feed?${params.toString()}`;

      let parsed: z.infer<typeof ResponseSchema>;
      try {
        parsed = await fetchPage(url, this.fetchImpl, this.timeoutMs);
      } catch (err) {
        log.error(
          { err: err instanceof Error ? err.message : String(err), page },
          'couponapi: page fetch failed, stopping',
        );
        return;
      }

      const coupons = parsed.offers ?? parsed.data ?? [];
      if (coupons.length === 0) return;

      for (const c of coupons) {
        const mapped = mapCoupon(c);
        if (mapped) yield mapped;
      }

      // Stop conditions: explicit `has_more` flag, server-supplied next
      // offset, or a short page.
      if (parsed.has_more === false) return;
      if (coupons.length < this.pageSize) return;
      offset = typeof parsed.next_offset === 'number'
        ? parsed.next_offset
        : offset + this.pageSize;
    }
  }
}

async function fetchPage(
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
      throw new Error(`HTTP ${res.status} for ${url}${body ? `: ${body.slice(0, 200)}` : ''}`);
    }
    const json = (await res.json()) as unknown;
    return ResponseSchema.parse(json);
  } finally {
    clearTimeout(t);
  }
}

/**
 * Map a CouponAPI offer to our canonical `RawDealInput`. Returns null when
 * the coupon is missing the minimum we need (an id, a merchant name, and
 * a title).
 */
export function mapCoupon(c: CouponApiCoupon): RawDealInput | null {
  const sourceId = String(c.id ?? '').trim();
  if (!sourceId) return null;

  const storeName = (c.store ?? '').trim();
  if (!storeName) return null;

  const code = (c.coupon_code ?? c.code ?? '').trim();
  const titleRaw = (c.title ?? c.description ?? '').trim();
  const title = titleRaw || `${storeName} offer`;

  // Active by default; some incremental feeds tag deletions via status.
  const status = (c.status ?? '').toLowerCase();
  if (status === 'deleted' || status === 'inactive' || status === 'expired') {
    return null;
  }

  const parsed = parseDiscountFromText(`${title} ${c.description ?? ''}`);

  const categories = normalizeCategories(c.categories);
  const countries = normalizeCountries(c.country);
  const domain = extractHost(c.store_url ?? '');

  const sourceMeta: Record<string, unknown> = { raw: { id: c.id, store_id: c.store_id } };
  if (c.deeplink_source) sourceMeta['deeplinkSource'] = c.deeplink_source;
  if (c.cashback_link) sourceMeta['cashbackLink'] = c.cashback_link;
  if (c.store_image) sourceMeta['storeImage'] = c.store_image;

  const out: RawDealInput = {
    sourceNetwork: 'manual',
    sourceId: `couponapi:${sourceId}`,
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
  if (c.affiliate_link) out.deeplink = c.affiliate_link;
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
