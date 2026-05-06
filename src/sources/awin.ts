/**
 * Awin Promotions API source adapter.
 *
 * Endpoint:
 *   GET https://api.awin.com/publishers/{AWIN_PUBLISHER_ID}/promotions/
 *     ?relationship=joined
 *     &type=voucher
 *     &status=active
 *     &pagination[currentPage]=N
 *     &pagination[pageSize]=100
 *
 * Auth: header `Authorization: Bearer {AWIN_API_TOKEN}`.
 *
 * Rate limit: 20 req/min/user. We serialize requests through `p-limit(1)`
 * and add a small delay between pages to stay well under the limit.
 */
import pLimit from 'p-limit';
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

const AwinAdvertiserSchema = z
  .object({
    id: z.union([z.string(), z.number()]).nullish(),
    name: z.string().nullish(),
  })
  .passthrough();

const AwinRegionSchema = z
  .object({
    countryCode: z.string().nullish(),
  })
  .passthrough();

const AwinVoucherSchema = z
  .object({
    code: z.string().nullish(),
  })
  .passthrough();

const AwinPromotionSchema = z
  .object({
    promotionId: z.union([z.string(), z.number()]),
    advertiser: AwinAdvertiserSchema.nullish(),
    title: z.string().nullish(),
    description: z.string().nullish(),
    voucher: AwinVoucherSchema.nullish(),
    type: z.string().nullish(),
    startDate: z.string().nullish(),
    endDate: z.string().nullish(),
    urlClickThrough: z.string().nullish(),
    regions: z.array(AwinRegionSchema).nullish(),
  })
  .passthrough();

const AwinResponseSchema = z
  .object({
    data: z.array(AwinPromotionSchema),
    pagination: z
      .object({
        total: z.number().nullish(),
        currentPage: z.number().nullish(),
        pageSize: z.number().nullish(),
      })
      .passthrough()
      .nullish(),
  })
  .passthrough();

export type AwinPromotion = z.infer<typeof AwinPromotionSchema>;

export interface AwinAdapterOptions {
  apiToken?: string;
  publisherId?: string;
  pageSize?: number;
  fetchImpl?: typeof fetch;
  /** ms to wait between pages; default 3500 to stay under 20/min. */
  delayBetweenPagesMs?: number;
  maxPages?: number;
}

const AWIN_BASE = 'https://api.awin.com';

export class AwinAdapter implements SourceAdapter {
  readonly network = 'awin' as const;

  private readonly apiToken: string;
  private readonly publisherId: string;
  private readonly pageSize: number;
  private readonly fetchImpl: typeof fetch;
  private readonly delayBetweenPagesMs: number;
  private readonly maxPages: number;
  private readonly limit: ReturnType<typeof pLimit>;

  constructor(opts: AwinAdapterOptions = {}) {
    const e = (() => {
      try {
        return env();
      } catch {
        return undefined;
      }
    })();
    this.apiToken = opts.apiToken ?? e?.AWIN_API_TOKEN ?? '';
    this.publisherId = opts.publisherId ?? e?.AWIN_PUBLISHER_ID ?? '';
    this.pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 100));
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.delayBetweenPagesMs = Math.max(0, opts.delayBetweenPagesMs ?? 3500);
    this.maxPages = Math.max(1, opts.maxPages ?? 200);
    this.limit = pLimit(1);
  }

  isConfigured(): boolean {
    return this.apiToken.length > 0 && this.publisherId.length > 0;
  }

  async *fetch(): AsyncIterable<RawDealInput> {
    if (!this.isConfigured()) {
      log.warn({ network: this.network }, 'Awin adapter not configured; nothing to fetch');
      return;
    }

    for (let page = 1; page <= this.maxPages; page += 1) {
      // Rate-limit serialize: only one page request can be in-flight at a time.
      const promotions = await this.limit(() => this.fetchPage(page));
      if (promotions === null) {
        // Page failed; log and continue to the next.
        if (page > 1) await sleep(this.delayBetweenPagesMs);
        continue;
      }
      if (promotions.length === 0) {
        log.debug({ network: this.network, page }, 'Awin: empty page, stopping');
        return;
      }

      for (const p of promotions) {
        const mapped = mapAwinPromotion(p);
        if (mapped) yield mapped;
      }

      if (promotions.length < this.pageSize) {
        log.debug(
          { network: this.network, page, count: promotions.length },
          'Awin: short page, stopping'
        );
        return;
      }

      // Respect the rate limit between pages.
      await sleep(this.delayBetweenPagesMs);
    }
  }

  private async fetchPage(page: number): Promise<AwinPromotion[] | null> {
    const url =
      `${AWIN_BASE}/publishers/${encodeURIComponent(this.publisherId)}/promotions/` +
      `?relationship=joined&type=voucher&status=active` +
      `&pagination[currentPage]=${page}&pagination[pageSize]=${this.pageSize}`;
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await this.fetchImpl(url, {
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        log.error(
          { network: this.network, page, status: res.status, body: body.slice(0, 200) },
          'Awin: page fetch returned non-2xx'
        );
        return null;
      }
      const json = (await res.json()) as unknown;
      const parsed = AwinResponseSchema.safeParse(json);
      if (!parsed.success) {
        log.error(
          { network: this.network, page, issues: parsed.error.issues.slice(0, 3) },
          'Awin: invalid response shape'
        );
        return null;
      }
      return parsed.data.data;
    } catch (err) {
      log.error(
        {
          network: this.network,
          page,
          err: err instanceof Error ? err.message : String(err),
        },
        'Awin: page fetch failed'
      );
      return null;
    } finally {
      clearTimeout(t);
    }
  }
}

export function mapAwinPromotion(p: AwinPromotion): RawDealInput | null {
  const sourceId = String(p.promotionId ?? '').trim();
  if (!sourceId) return null;

  const advertiserName = (p.advertiser?.name ?? '').trim();
  if (!advertiserName) return null;

  const code = (p.voucher?.code ?? '').trim();
  const title = (p.title ?? `${advertiserName} promotion`).trim().slice(0, 512);
  const typeStr = (p.type ?? '').toLowerCase();
  const kind: RawDealInput['kind'] =
    code.length > 0 || typeStr === 'voucher' ? 'code' : 'sale';

  const text = `${p.title ?? ''} ${p.description ?? ''}`.trim();
  const parsed = parseDiscountFromText(text);

  const startsAt = toDate(p.startDate);
  const expiresAt = toDate(p.endDate);

  const geoScope = (p.regions ?? [])
    .map((r) => (r.countryCode ?? '').trim().toUpperCase())
    .filter((s) => /^[A-Z]{2}$/.test(s));

  const out: RawDealInput = {
    sourceNetwork: 'awin',
    sourceId,
    merchant: {
      slug: slugify(advertiserName),
      displayName: advertiserName,
    },
    kind,
    title,
    discountType: parsed.discountType ?? 'unknown',
    sourceMeta: {
      raw: p,
      ...(p.advertiser?.id !== undefined && p.advertiser?.id !== null
        ? { advertiserId: String(p.advertiser.id) }
        : {}),
    },
  };
  if (code.length > 0) out.code = code;
  if (p.description) out.description = p.description;
  if (parsed.discountValueBps !== undefined) out.discountValueBps = parsed.discountValueBps;
  if (parsed.discountValueCents !== undefined) out.discountValueCents = parsed.discountValueCents;
  if (geoScope.length > 0) out.geoScope = geoScope;
  if (startsAt) out.startsAt = startsAt;
  if (expiresAt) out.expiresAt = expiresAt;
  if (p.urlClickThrough) out.deeplink = p.urlClickThrough;
  out.attributionSource = 'awin';
  return out;
}
