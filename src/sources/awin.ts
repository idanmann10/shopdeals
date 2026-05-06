/**
 * Awin Promotions API source adapter.
 *
 * Endpoint:
 *   POST https://api.awin.com/publisher/{AWIN_PUBLISHER_ID}/promotions
 *
 * Note: SINGULAR `publisher` (no `s`). The legacy `publishers/...` path on
 * GET is gone; the current Promotions service is POST-only with a JSON body.
 *
 * Auth: header `Authorization: ${AWIN_API_TOKEN}` — the **raw** token, NOT
 * `Bearer …`. Awin also accepts `?accessToken=...` as a query param; we send
 * both for resilience.
 *
 * Body shape:
 *   {
 *     "filters":    { "membership": "joined", "type": "voucher",
 *                     "regionCodes": ["US","GB","CA","AU","IE","NZ"] },
 *     "pagination": { "pageSize": 200 }
 *   }
 *
 * Pagination: `pagination.pageSize` clamped to [10, 200]. If Awin returns a
 * `pagination.cursor`, we forward it as `pagination.cursor` on the next
 * request. For v1 we still only request a single page of pageSize=200 — full
 * incremental sync via `lastUpdated` timestamps is a TODO.
 *
 * Rate limit: ~20 req/min/user, per Awin folklore. We funnel page requests
 * through `p-limit(1)` and sleep 3.5s between pages. Defensive depth.
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

const AwinRegionEntrySchema = z
  .object({
    countryCode: z.string().nullish(),
  })
  .passthrough();

const AwinRegionsSchema = z
  .object({
    all: z.boolean().nullish(),
    list: z.array(AwinRegionEntrySchema).nullish(),
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
    urlTracking: z.string().nullish(),
    regions: AwinRegionsSchema.nullish(),
  })
  .passthrough();

const AwinPaginationSchema = z
  .object({
    cursor: z.string().nullish(),
    pageSize: z.number().nullish(),
    total: z.number().nullish(),
  })
  .passthrough();

const AwinResponseSchema = z
  .object({
    data: z.array(AwinPromotionSchema),
    pagination: AwinPaginationSchema.nullish(),
  })
  .passthrough();

export type AwinPromotion = z.infer<typeof AwinPromotionSchema>;

export interface AwinAdapterOptions {
  apiToken?: string;
  publisherId?: string;
  pageSize?: number;
  /** Region codes Awin filters by (ISO-3166 alpha-2). */
  regionCodes?: string[];
  fetchImpl?: typeof fetch;
  /** ms to wait between pages; default 3500 to stay under 20/min. */
  delayBetweenPagesMs?: number;
  maxPages?: number;
}

const AWIN_BASE = 'https://api.awin.com';
const DEFAULT_REGIONS = ['US', 'GB', 'CA', 'AU', 'IE', 'NZ'];

interface AwinPage {
  promotions: AwinPromotion[];
  cursor: string | undefined;
}

export class AwinAdapter implements SourceAdapter {
  readonly network = 'awin' as const;

  private readonly apiToken: string;
  private readonly publisherId: string;
  private readonly pageSize: number;
  private readonly regionCodes: string[];
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
    // Awin's documented pageSize range is 10-200.
    this.pageSize = Math.max(10, Math.min(200, opts.pageSize ?? 200));
    this.regionCodes = opts.regionCodes && opts.regionCodes.length > 0
      ? opts.regionCodes
      : DEFAULT_REGIONS;
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

    let cursor: string | undefined;

    for (let page = 1; page <= this.maxPages; page += 1) {
      // Rate-limit serialize: only one page request can be in-flight at a time.
      const result = await this.limit(() => this.fetchPage(cursor));
      if (result === null) {
        // Page failed; log and stop — without a cursor we'd just loop on the
        // same first page forever.
        if (page > 1) await sleep(this.delayBetweenPagesMs);
        return;
      }
      const { promotions, cursor: nextCursor } = result;
      if (promotions.length === 0) {
        log.debug({ network: this.network, page }, 'Awin: empty page, stopping');
        return;
      }

      for (const p of promotions) {
        const mapped = mapAwinPromotion(p);
        if (mapped) yield mapped;
      }

      // No cursor returned: server signals end-of-stream.
      if (!nextCursor) {
        log.debug(
          { network: this.network, page, count: promotions.length },
          'Awin: no further cursor, stopping'
        );
        return;
      }
      cursor = nextCursor;

      // Respect the rate limit between pages.
      await sleep(this.delayBetweenPagesMs);
    }
  }

  private async fetchPage(cursor: string | undefined): Promise<AwinPage | null> {
    const qs = new URLSearchParams({ accessToken: this.apiToken });
    const url =
      `${AWIN_BASE}/publisher/${encodeURIComponent(this.publisherId)}/promotions?` +
      qs.toString();

    const body: {
      filters: { membership: string; type: string; regionCodes: string[] };
      pagination: { pageSize: number; cursor?: string };
    } = {
      filters: {
        membership: 'joined',
        type: 'voucher',
        regionCodes: this.regionCodes,
      },
      pagination: { pageSize: this.pageSize },
    };
    if (cursor) body.pagination.cursor = cursor;

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await this.fetchImpl(url, {
        method: 'POST',
        // Awin requires the raw token (no `Bearer ` prefix).
        headers: {
          Authorization: this.apiToken,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        log.error(
          { network: this.network, status: res.status, body: text.slice(0, 200) },
          'Awin: page fetch returned non-2xx'
        );
        return null;
      }
      const json = (await res.json()) as unknown;
      const parsed = AwinResponseSchema.safeParse(json);
      if (!parsed.success) {
        log.error(
          { network: this.network, issues: parsed.error.issues.slice(0, 3) },
          'Awin: invalid response shape'
        );
        return null;
      }
      const nextCursor =
        typeof parsed.data.pagination?.cursor === 'string' && parsed.data.pagination.cursor.length > 0
          ? parsed.data.pagination.cursor
          : undefined;
      return { promotions: parsed.data.data, cursor: nextCursor };
    } catch (err) {
      log.error(
        {
          network: this.network,
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

  // Region scope: when `regions.all` is true we represent it as ['*'] so the
  // upsert pipeline can distinguish "global" from "missing data".
  let geoScope: string[] = [];
  if (p.regions?.all === true) {
    geoScope = ['*'];
  } else {
    const list = p.regions?.list ?? [];
    geoScope = list
      .map((r) => (r.countryCode ?? '').trim().toUpperCase())
      .filter((s) => /^[A-Z]{2}$/.test(s));
  }

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
  if (p.urlTracking) out.deeplink = p.urlTracking;
  out.attributionSource = 'awin';
  return out;
}
