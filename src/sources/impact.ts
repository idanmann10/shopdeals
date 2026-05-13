/**
 * Impact.com PromoCodes source adapter.
 *
 * Endpoint (flat — no per-campaign nesting):
 *   GET https://api.impact.com/Mediapartners/{SID}/PromoCodes?Page=N&PageSize=200
 *
 * Enumerates every joined campaign at once; the API also supports
 * `?CampaignId=N` filtering if we ever need per-campaign pulls.
 *
 * Pagination: the response includes `@numpages` and (when there's another
 * page) `@nextpageuri`. We follow `@nextpageuri` until it's missing/empty
 * rather than incrementing the page number ourselves — Impact's docs say
 * the value already encodes the right page-size and any filters from the
 * initial request.
 *
 * Auth: HTTP Basic (`Authorization: Basic ${base64(SID:TOKEN)}`),
 * `Accept: application/json` to coerce JSON instead of the legacy XML.
 *
 * Rate limiting: on a 429, read `Retry-After` (seconds), sleep, retry once.
 * If the retry also returns 429 we abort the page rather than infinite-loop.
 *
 * Promo code record (per Impact JSON):
 *   Id, Code, Description, StartDate, EndDate, LandingPageUrl, CampaignName,
 *   AdvertiserName, CampaignId, CountryCodes (string[]).
 */
import { z } from 'zod';
import { env } from '../lib/env.ts';
import { log } from '../lib/log.ts';
import {
  parseDiscountFromText,
  sleep,
  slugify,
  toDate,
  type RawDealInput,
  type SourceAdapter,
} from './common.ts';

const ImpactPromoCodeSchema = z
  .object({
    Id: z.union([z.string(), z.number()]).nullish(),
    Code: z.string().nullish(),
    Description: z.string().nullish(),
    StartDate: z.string().nullish(),
    EndDate: z.string().nullish(),
    LandingPageUrl: z.string().nullish(),
    CampaignName: z.string().nullish(),
    AdvertiserName: z.string().nullish(),
    CampaignId: z.union([z.string(), z.number()]).nullish(),
    PromoType: z.string().nullish(),
    CountryCodes: z.array(z.string()).nullish(),
  })
  .passthrough();

const ImpactPromoCodesResponseSchema = z
  .object({
    PromoCodes: z.array(ImpactPromoCodeSchema).nullish(),
    '@numpages': z.union([z.string(), z.number()]).nullish(),
    '@nextpageuri': z.string().nullish(),
    '@page': z.union([z.string(), z.number()]).nullish(),
    '@total': z.union([z.string(), z.number()]).nullish(),
  })
  .passthrough();

export type ImpactPromoCode = z.infer<typeof ImpactPromoCodeSchema>;

export interface ImpactAdapterOptions {
  accountSid?: string;
  authToken?: string;
  pageSize?: number;
  fetchImpl?: typeof fetch;
  maxPages?: number;
}

const IMPACT_BASE = 'https://api.impact.com';

interface ImpactPage {
  promoCodes: ImpactPromoCode[];
  nextPageUri: string | undefined;
}

export class ImpactAdapter implements SourceAdapter {
  readonly network = 'impact' as const;

  private readonly accountSid: string;
  private readonly authToken: string;
  private readonly pageSize: number;
  private readonly fetchImpl: typeof fetch;
  private readonly maxPages: number;

  constructor(opts: ImpactAdapterOptions = {}) {
    const e = (() => {
      try {
        return env();
      } catch {
        return undefined;
      }
    })();
    this.accountSid = opts.accountSid ?? e?.IMPACT_ACCOUNT_SID ?? '';
    this.authToken = opts.authToken ?? e?.IMPACT_AUTH_TOKEN ?? '';
    this.pageSize = Math.max(1, Math.min(1000, opts.pageSize ?? 200));
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.maxPages = Math.max(1, opts.maxPages ?? 200);
  }

  isConfigured(): boolean {
    return this.accountSid.length > 0 && this.authToken.length > 0;
  }

  async *fetch(): AsyncIterable<RawDealInput> {
    if (!this.isConfigured()) {
      log.warn({ network: this.network }, 'Impact adapter not configured; nothing to fetch');
      return;
    }

    const firstUrl =
      `${IMPACT_BASE}/Mediapartners/${encodeURIComponent(this.accountSid)}/PromoCodes` +
      `?Page=1&PageSize=${this.pageSize}`;
    let nextUrl: string | undefined = firstUrl;

    for (let page = 1; page <= this.maxPages; page += 1) {
      if (!nextUrl) return;
      const result = await this.fetchPromoCodesPage(nextUrl);
      if (result === null) return;

      for (const pc of result.promoCodes) {
        const mapped = mapImpactPromoCode(pc);
        if (mapped) yield mapped;
      }

      if (!result.nextPageUri) {
        log.debug(
          { network: this.network, page, count: result.promoCodes.length },
          'Impact: no @nextpageuri, stopping'
        );
        return;
      }
      // `@nextpageuri` is typically a path like
      // `/Mediapartners/IRAX.../PromoCodes?Page=2&PageSize=200`. Resolve it
      // against the API base so the next iteration can GET it directly.
      nextUrl = resolveImpactNextUri(result.nextPageUri, IMPACT_BASE);
    }
  }

  private authHeader(): string {
    const token = Buffer.from(`${this.accountSid}:${this.authToken}`, 'utf8').toString('base64');
    return `Basic ${token}`;
  }

  private async fetchPromoCodesPage(url: string): Promise<ImpactPage | null> {
    const json = await this.fetchJsonWithRetry(url);
    if (!json) return null;
    const parsed = ImpactPromoCodesResponseSchema.safeParse(json);
    if (!parsed.success) {
      log.error(
        { network: this.network, url, issues: parsed.error.issues.slice(0, 3) },
        'Impact: invalid promocodes response shape'
      );
      return null;
    }
    return {
      promoCodes: parsed.data.PromoCodes ?? [],
      nextPageUri:
        typeof parsed.data['@nextpageuri'] === 'string' &&
        parsed.data['@nextpageuri'].length > 0
          ? parsed.data['@nextpageuri']
          : undefined,
    };
  }

  /**
   * GET a single Impact URL, retrying once on HTTP 429 with the server's
   * advertised `Retry-After`. Returns the parsed JSON body or `null` on
   * any unrecoverable error.
   */
  private async fetchJsonWithRetry(url: string): Promise<unknown | null> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 30_000);
      try {
        const res = await this.fetchImpl(url, {
          headers: {
            Authorization: this.authHeader(),
            Accept: 'application/json',
          },
          signal: controller.signal,
        });
        if (res.status === 429) {
          if (attempt === 0) {
            const retryAfter = parseRetryAfterSeconds(res.headers.get('Retry-After'));
            log.warn(
              { network: this.network, url, retryAfterSec: retryAfter },
              'Impact: 429 rate-limited, sleeping before single retry'
            );
            await sleep(Math.max(0, retryAfter * 1000));
            continue;
          }
          // Second 429 — abort this page rather than spin.
          log.error(
            { network: this.network, url },
            'Impact: 429 again after retry, aborting page'
          );
          return null;
        }
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          log.error(
            { network: this.network, url, status: res.status, body: body.slice(0, 200) },
            'Impact: non-2xx response'
          );
          return null;
        }
        return (await res.json()) as unknown;
      } catch (err) {
        log.error(
          {
            network: this.network,
            url,
            err: err instanceof Error ? err.message : String(err),
          },
          'Impact: fetch failed'
        );
        return null;
      } finally {
        clearTimeout(t);
      }
    }
    return null;
  }
}

function parseRetryAfterSeconds(value: string | null): number {
  if (!value) return 1;
  const n = Number(value);
  if (Number.isFinite(n) && n >= 0) return Math.min(60, n);
  // RFC 7231 also allows an HTTP-date; fall back to a small default.
  const t = Date.parse(value);
  if (!Number.isNaN(t)) {
    const delta = Math.round((t - Date.now()) / 1000);
    return Math.max(0, Math.min(60, delta));
  }
  return 1;
}

function resolveImpactNextUri(uri: string, base: string): string {
  try {
    return new URL(uri, base).toString();
  } catch {
    return uri;
  }
}

export function mapImpactPromoCode(pc: ImpactPromoCode): RawDealInput | null {
  const code = (pc.Code ?? '').trim();
  const campaignId = String(pc.CampaignId ?? '').trim();

  // Build a stable source id. Impact's promo code records sometimes lack a
  // numeric id, so we fall back to campaign+code which is unique per campaign.
  const rawId = pc.Id !== undefined && pc.Id !== null ? String(pc.Id).trim() : '';
  const sourceId = rawId.length > 0 ? rawId : `${campaignId}:${code}`;
  if (sourceId === ':' || sourceId.length === 0) return null;

  const advertiserName = (pc.AdvertiserName ?? pc.CampaignName ?? '').trim();
  if (!advertiserName) return null;

  const description = (pc.Description ?? '').trim();
  const title = (description.length > 0 ? description : `${advertiserName} promo`).slice(0, 512);

  const promoType = (pc.PromoType ?? '').toLowerCase();
  const kind: RawDealInput['kind'] =
    code.length > 0 || promoType === 'promocode' ? 'code' : 'sale';

  const parsed = parseDiscountFromText(description);
  const startsAt = toDate(pc.StartDate);
  const expiresAt = toDate(pc.EndDate);

  const geoScope = (pc.CountryCodes ?? [])
    .map((s) => (s ?? '').trim().toUpperCase())
    .filter((s) => /^[A-Z]{2}$/.test(s));

  const out: RawDealInput = {
    sourceNetwork: 'impact',
    sourceId,
    merchant: {
      slug: slugify(advertiserName),
      displayName: advertiserName,
    },
    kind,
    title,
    discountType: parsed.discountType ?? 'unknown',
    sourceMeta: {
      raw: pc,
      ...(campaignId ? { campaignId } : {}),
    },
  };
  if (code.length > 0) out.code = code;
  if (description.length > 0) out.description = description;
  if (parsed.discountValueBps !== undefined) out.discountValueBps = parsed.discountValueBps;
  if (parsed.discountValueCents !== undefined) out.discountValueCents = parsed.discountValueCents;
  if (geoScope.length > 0) out.geoScope = geoScope;
  if (startsAt) out.startsAt = startsAt;
  if (expiresAt) out.expiresAt = expiresAt;
  if (pc.LandingPageUrl) out.deeplink = pc.LandingPageUrl;
  out.attributionSource = 'impact';
  return out;
}
