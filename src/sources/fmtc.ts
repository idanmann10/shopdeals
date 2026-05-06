/**
 * FMTC source adapter (v3 API).
 *
 * Endpoint base: `https://s3.fmtc.co/api/v3/`. The full coupon listing lives
 * at `${base}/coupons` and uses snake_case fields throughout. Pagination is
 * driven by `?page=N&page_size=200`; the response includes a sibling
 * `meta`/`pagination` block with `current_page`, `last_page`, `total`, and
 * `per_page` so we can stop cleanly without falling back to short-page
 * heuristics.
 *
 * Auth: FMTC v3 historically accepted the API key as a query param
 * (`?api_key=...`). The published v3 spec is paywalled, so as a best-effort
 * we ALSO send `Authorization: Bearer ${apiKey}` — if v3 rejects the query
 * param the header will keep us authenticated. Both are fine to send; FMTC
 * has never been picky about extra headers.
 *
 * TODO(fmtc-v3): once we have first-hand access to the published v3 docs,
 * confirm whether the auth scheme is bearer-only or query-only and drop the
 * other to reduce log surface.
 *
 * Coupon record (snake_case, per v3):
 *   id, network, advertiser_id, advertiser_name, advertiser_homepage,
 *   coupon_code, label, type ("Code"|"Deal"|...), description, restrictions,
 *   start_date, end_date, exclusive, fresh_reach_date, deep_link, currency,
 *   country, coupon_code_on_page (bool), code_verified_at (ISO),
 *   link_verified_at (ISO).
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

/** Internal: fetch with timeout that accepts a pluggable fetch implementation. */
async function fetchJsonWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  fetchImpl: typeof fetch
): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { ...init, signal: controller.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `HTTP ${res.status} ${res.statusText} for ${url}${body ? `: ${body.slice(0, 200)}` : ''}`
      );
    }
    return res;
  } finally {
    clearTimeout(t);
  }
}

const FmtcCouponSchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    network: z.string().nullish(),
    advertiser_id: z.union([z.string(), z.number()]).nullish(),
    advertiser_name: z.string().nullish(),
    advertiser_homepage: z.string().nullish(),
    // v3 calls the code field `coupon_code`; keep `code` as a fallback for
    // any older deployment that still emits the legacy name.
    coupon_code: z.string().nullish(),
    code: z.string().nullish(),
    label: z.string().nullish(),
    type: z.string().nullish(),
    description: z.string().nullish(),
    restrictions: z.string().nullish(),
    start_date: z.string().nullish(),
    end_date: z.string().nullish(),
    exclusive: z.union([z.boolean(), z.number(), z.string()]).nullish(),
    fresh_reach_date: z.string().nullish(),
    deep_link: z.string().nullish(),
    currency: z.string().nullish(),
    country: z.string().nullish(),
    coupon_code_on_page: z.union([z.boolean(), z.number(), z.string()]).nullish(),
    code_verified_at: z.string().nullish(),
    link_verified_at: z.string().nullish(),
  })
  .passthrough();

export type FmtcCoupon = z.infer<typeof FmtcCouponSchema>;

const FmtcPaginationSchema = z
  .object({
    current_page: z.union([z.string(), z.number()]).nullish(),
    last_page: z.union([z.string(), z.number()]).nullish(),
    total: z.union([z.string(), z.number()]).nullish(),
    per_page: z.union([z.string(), z.number()]).nullish(),
  })
  .passthrough();

/**
 * FMTC v3 wraps the array in `{ data: [...], meta: {...} }` (Laravel-style
 * paginators). Older deployments occasionally use `{ coupons: [...] }` or a
 * bare array, so we still accept those for resilience.
 */
const FmtcResponseSchema = z.union([
  z
    .object({
      data: z.array(FmtcCouponSchema),
      meta: FmtcPaginationSchema.nullish(),
      pagination: FmtcPaginationSchema.nullish(),
    })
    .passthrough(),
  z
    .object({
      coupons: z.array(FmtcCouponSchema),
      meta: FmtcPaginationSchema.nullish(),
      pagination: FmtcPaginationSchema.nullish(),
    })
    .passthrough(),
  z.array(FmtcCouponSchema),
]);

export interface FmtcAdapterOptions {
  baseUrl?: string;
  apiKey?: string;
  pageSize?: number;
  /** Mostly for tests — inject a fetch impl. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Maximum pages to fetch in one run (safety cap). */
  maxPages?: number;
}

function toIntOrUndefined(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export class FmtcAdapter implements SourceAdapter {
  readonly network = 'fmtc' as const;

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly pageSize: number;
  private readonly fetchImpl: typeof fetch;
  private readonly maxPages: number;

  constructor(opts: FmtcAdapterOptions = {}) {
    const e = (() => {
      try {
        return env();
      } catch {
        return undefined;
      }
    })();
    this.baseUrl = (opts.baseUrl ?? e?.FMTC_BASE_URL ?? 'https://s3.fmtc.co/api/v3/').replace(
      /\/+$/,
      ''
    );
    this.apiKey = opts.apiKey ?? e?.FMTC_API_KEY ?? '';
    this.pageSize = Math.max(1, Math.min(500, opts.pageSize ?? 200));
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.maxPages = Math.max(1, opts.maxPages ?? 200);
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async *fetch(): AsyncIterable<RawDealInput> {
    if (!this.isConfigured()) {
      log.warn({ network: this.network }, 'FMTC adapter not configured; nothing to fetch');
      return;
    }

    let lastPage: number | undefined;

    for (let page = 1; page <= this.maxPages; page += 1) {
      const url = `${this.baseUrl}/coupons?api_key=${encodeURIComponent(
        this.apiKey
      )}&page=${page}&page_size=${this.pageSize}`;
      let coupons: FmtcCoupon[];
      try {
        const res = await fetchJsonWithTimeout(
          url,
          {
            headers: {
              Accept: 'application/json',
              // Best-effort: also pass the key as a bearer header. See file
              // header for rationale; safe to send both.
              Authorization: `Bearer ${this.apiKey}`,
            },
          },
          30_000,
          this.fetchImpl
        );
        const body = (await res.json()) as unknown;
        const parsed = FmtcResponseSchema.safeParse(body);
        if (!parsed.success) {
          log.error(
            { network: this.network, page, issues: parsed.error.issues.slice(0, 3) },
            'FMTC: invalid response shape, stopping'
          );
          return;
        }
        const data = parsed.data;
        if (Array.isArray(data)) {
          coupons = data as FmtcCoupon[];
        } else if ('data' in data && Array.isArray((data as { data?: unknown }).data)) {
          coupons = (data as { data: FmtcCoupon[] }).data;
          const meta =
            (data as { meta?: unknown; pagination?: unknown }).meta ??
            (data as { meta?: unknown; pagination?: unknown }).pagination;
          if (meta && typeof meta === 'object') {
            lastPage = toIntOrUndefined((meta as { last_page?: unknown }).last_page) ?? lastPage;
          }
        } else if ('coupons' in data && Array.isArray((data as { coupons?: unknown }).coupons)) {
          coupons = (data as { coupons: FmtcCoupon[] }).coupons;
          const meta =
            (data as { meta?: unknown; pagination?: unknown }).meta ??
            (data as { meta?: unknown; pagination?: unknown }).pagination;
          if (meta && typeof meta === 'object') {
            lastPage = toIntOrUndefined((meta as { last_page?: unknown }).last_page) ?? lastPage;
          }
        } else {
          coupons = [];
        }
      } catch (err) {
        log.error(
          { network: this.network, page, err: err instanceof Error ? err.message : String(err) },
          'FMTC: page fetch failed, continuing to next page'
        );
        continue;
      }

      if (coupons.length === 0) {
        log.debug({ network: this.network, page }, 'FMTC: empty page, stopping');
        return;
      }

      for (const coupon of coupons) {
        const mapped = mapFmtcCoupon(coupon);
        if (mapped) yield mapped;
      }

      // Prefer the server-reported `last_page` to decide when to stop. Fall
      // back to the short-page heuristic if no metadata was present.
      if (lastPage !== undefined && page >= lastPage) {
        log.debug(
          { network: this.network, page, lastPage },
          'FMTC: reached last_page from pagination metadata, stopping'
        );
        return;
      }
      if (lastPage === undefined && coupons.length < this.pageSize) {
        log.debug(
          { network: this.network, page, count: coupons.length },
          'FMTC: short page, stopping'
        );
        return;
      }
    }
  }
}

/**
 * Map a single FMTC v3 coupon record to our canonical `RawDealInput` shape.
 * Returns `null` for records missing the bare-minimum fields (id, advertiser).
 */
export function mapFmtcCoupon(c: FmtcCoupon): RawDealInput | null {
  const sourceId = String(c.id ?? '').trim();
  if (!sourceId) return null;

  const advertiserName = (c.advertiser_name ?? '').trim();
  if (!advertiserName) return null;

  const code = (c.coupon_code ?? c.code ?? '').trim();
  const titleRaw = (c.label ?? c.description ?? code ?? '').trim();
  const title = titleRaw.length > 0 ? titleRaw : `${advertiserName} offer`;

  const typeStr = (c.type ?? '').toLowerCase();
  const kind: RawDealInput['kind'] = code.length > 0 || typeStr === 'code' ? 'code' : 'sale';

  const text = `${c.label ?? ''} ${c.description ?? ''}`.trim();
  const parsed = parseDiscountFromText(text);

  const startsAt = toDate(c.start_date);
  const expiresAt = toDate(c.end_date);

  const countryStr = (c.country ?? '').trim();
  const geoScope =
    countryStr.length > 0
      ? countryStr
          .split(/[,\s]+/)
          .map((s) => s.toUpperCase())
          .filter((s) => /^[A-Z]{2}$/.test(s))
      : undefined;

  const advertiserDomain = extractHost(c.advertiser_homepage ?? '');

  const sourceMeta: Record<string, unknown> = { raw: c };
  if (c.network) sourceMeta['network'] = c.network;
  if (c.advertiser_id !== undefined && c.advertiser_id !== null) {
    sourceMeta['advertiserId'] = String(c.advertiser_id);
  }
  if (c.exclusive !== undefined && c.exclusive !== null) {
    sourceMeta['exclusive'] = c.exclusive;
  }
  if (c.coupon_code_on_page !== undefined && c.coupon_code_on_page !== null) {
    sourceMeta['couponCodeOnPage'] = c.coupon_code_on_page;
  }
  if (c.code_verified_at) sourceMeta['codeVerifiedAt'] = c.code_verified_at;
  if (c.link_verified_at) sourceMeta['linkVerifiedAt'] = c.link_verified_at;
  if (c.fresh_reach_date) sourceMeta['freshReachDate'] = c.fresh_reach_date;

  const out: RawDealInput = {
    sourceNetwork: 'fmtc',
    sourceId,
    merchant: {
      slug: slugify(advertiserName),
      displayName: advertiserName,
      ...(advertiserDomain ? { domains: [advertiserDomain] } : {}),
      ...(c.advertiser_homepage ? { homepageUrl: c.advertiser_homepage } : {}),
    },
    kind,
    title: title.slice(0, 512),
    discountType: parsed.discountType ?? 'unknown',
    sourceMeta,
  };
  if (code.length > 0) out.code = code;
  if (c.description) out.description = c.description;
  if (parsed.discountValueBps !== undefined) out.discountValueBps = parsed.discountValueBps;
  if (parsed.discountValueCents !== undefined) out.discountValueCents = parsed.discountValueCents;
  if (geoScope && geoScope.length > 0) out.geoScope = geoScope;
  if (startsAt) out.startsAt = startsAt;
  if (expiresAt) out.expiresAt = expiresAt;
  if (c.deep_link) out.deeplink = c.deep_link;
  out.attributionSource = 'fmtc';
  return out;
}

function extractHost(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url.trim());
    return u.hostname.replace(/^www\./i, '').toLowerCase() || undefined;
  } catch {
    return undefined;
  }
}
