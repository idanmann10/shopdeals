/**
 * FMTC (FlexMyDeals) source adapter.
 *
 * FMTC publishes coupons via their Coupon API at
 * https://account.fmtc.co/cp/api. The exact response shape varies a little
 * by account, but the documented coupon record exposes:
 *   id, network, advertiserId, advertiserName, advertiserHomepage,
 *   code, label, type ("Code"|"Deal"|...), description, restrictions,
 *   startDate, endDate, exclusive, freshReachDate, deepLink,
 *   currency, country
 *
 * Pagination uses `?page=N&per_page=200`. We follow until the server returns
 * an empty array or `coupons` is missing.
 *
 * Auth is a query-param API key (`api_key=...`), per FMTC's docs.
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
    advertiserId: z.union([z.string(), z.number()]).nullish(),
    advertiserName: z.string().nullish(),
    advertiserHomepage: z.string().nullish(),
    code: z.string().nullish(),
    label: z.string().nullish(),
    type: z.string().nullish(),
    description: z.string().nullish(),
    restrictions: z.string().nullish(),
    startDate: z.string().nullish(),
    endDate: z.string().nullish(),
    exclusive: z.union([z.boolean(), z.number(), z.string()]).nullish(),
    freshReachDate: z.string().nullish(),
    deepLink: z.string().nullish(),
    currency: z.string().nullish(),
    country: z.string().nullish(),
  })
  .passthrough();

export type FmtcCoupon = z.infer<typeof FmtcCouponSchema>;

/**
 * FMTC sometimes wraps the array in `{ coupons: [...] }`, sometimes in
 * `{ data: [...] }`, and sometimes returns a bare array. Accept all three.
 */
const FmtcResponseSchema = z.union([
  z.object({ coupons: z.array(FmtcCouponSchema) }).passthrough(),
  z.object({ data: z.array(FmtcCouponSchema) }).passthrough(),
  z.array(FmtcCouponSchema),
]);

export interface FmtcAdapterOptions {
  baseUrl?: string;
  apiKey?: string;
  perPage?: number;
  /** Mostly for tests — inject a fetch impl. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Maximum pages to fetch in one run (safety cap). */
  maxPages?: number;
}

export class FmtcAdapter implements SourceAdapter {
  readonly network = 'fmtc' as const;

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly perPage: number;
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
    this.baseUrl = (opts.baseUrl ?? e?.FMTC_BASE_URL ?? 'https://account.fmtc.co/cp/api').replace(
      /\/+$/,
      ''
    );
    this.apiKey = opts.apiKey ?? e?.FMTC_API_KEY ?? '';
    this.perPage = Math.max(1, Math.min(500, opts.perPage ?? 200));
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

    for (let page = 1; page <= this.maxPages; page += 1) {
      const url = `${this.baseUrl}/coupons?api_key=${encodeURIComponent(
        this.apiKey
      )}&page=${page}&per_page=${this.perPage}`;
      let coupons: FmtcCoupon[];
      try {
        const res = await fetchJsonWithTimeout(
          url,
          { headers: { Accept: 'application/json' } },
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
        } else if ('coupons' in data && Array.isArray((data as { coupons?: unknown }).coupons)) {
          coupons = (data as { coupons: FmtcCoupon[] }).coupons;
        } else if ('data' in data && Array.isArray((data as { data?: unknown }).data)) {
          coupons = (data as { data: FmtcCoupon[] }).data;
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

      // Short-page heuristic: server returned fewer than per_page; assume done.
      if (coupons.length < this.perPage) {
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
 * Map a single FMTC coupon record to our canonical `RawDealInput` shape.
 * Returns `null` for records missing the bare-minimum fields (id, advertiser).
 */
export function mapFmtcCoupon(c: FmtcCoupon): RawDealInput | null {
  const sourceId = String(c.id ?? '').trim();
  if (!sourceId) return null;

  const advertiserName = (c.advertiserName ?? '').trim();
  if (!advertiserName) return null;

  const code = (c.code ?? '').trim();
  const titleRaw = (c.label ?? c.description ?? code ?? '').trim();
  const title = titleRaw.length > 0 ? titleRaw : `${advertiserName} offer`;

  const typeStr = (c.type ?? '').toLowerCase();
  const kind: RawDealInput['kind'] = code.length > 0 || typeStr === 'code' ? 'code' : 'sale';

  const text = `${c.label ?? ''} ${c.description ?? ''}`.trim();
  const parsed = parseDiscountFromText(text);

  const expiresAt = toDate(c.endDate);
  const startsAt = toDate(c.startDate);

  const countryStr = (c.country ?? '').trim();
  const geoScope =
    countryStr.length > 0
      ? countryStr
          .split(/[,\s]+/)
          .map((s) => s.toUpperCase())
          .filter((s) => /^[A-Z]{2}$/.test(s))
      : undefined;

  const advertiserDomain = extractHost(c.advertiserHomepage ?? '');

  const out: RawDealInput = {
    sourceNetwork: 'fmtc',
    sourceId,
    merchant: {
      slug: slugify(advertiserName),
      displayName: advertiserName,
      ...(advertiserDomain ? { domains: [advertiserDomain] } : {}),
      ...(c.advertiserHomepage ? { homepageUrl: c.advertiserHomepage } : {}),
    },
    kind,
    title: title.slice(0, 512),
    discountType: parsed.discountType ?? 'unknown',
    sourceMeta: {
      raw: c,
      ...(c.network ? { network: c.network } : {}),
      ...(c.advertiserId !== undefined && c.advertiserId !== null
        ? { advertiserId: String(c.advertiserId) }
        : {}),
      ...(c.exclusive !== undefined && c.exclusive !== null ? { exclusive: c.exclusive } : {}),
    },
  };
  if (code.length > 0) out.code = code;
  if (c.description) out.description = c.description;
  if (parsed.discountValueBps !== undefined) out.discountValueBps = parsed.discountValueBps;
  if (parsed.discountValueCents !== undefined) out.discountValueCents = parsed.discountValueCents;
  if (geoScope && geoScope.length > 0) out.geoScope = geoScope;
  if (startsAt) out.startsAt = startsAt;
  if (expiresAt) out.expiresAt = expiresAt;
  if (c.deepLink) out.deeplink = c.deepLink;
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
