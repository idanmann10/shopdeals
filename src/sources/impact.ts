/**
 * Impact.com PromoCodes source adapter.
 *
 * We first list the publisher's joined Campaigns, then fetch each campaign's
 * PromoCodes:
 *   GET https://api.impact.com/Mediapartners/{SID}/Campaigns
 *     ?PageSize=100&Page=N
 *   GET https://api.impact.com/Mediapartners/{SID}/Campaigns/{id}/PromoCodes
 *
 * Auth: HTTP Basic with `IMPACT_ACCOUNT_SID:IMPACT_AUTH_TOKEN`. The API
 * returns JSON when `Accept: application/json` is set.
 *
 * Records have:
 *   Code, Description, StartDate, EndDate, LandingPageUrl, CampaignName,
 *   AdvertiserName, CampaignId, Id
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

const ImpactCampaignSchema = z
  .object({
    CampaignId: z.union([z.string(), z.number()]),
    CampaignName: z.string().nullish(),
    AdvertiserName: z.string().nullish(),
    AdvertiserId: z.union([z.string(), z.number()]).nullish(),
  })
  .passthrough();

const ImpactCampaignsResponseSchema = z
  .object({
    Campaigns: z.array(ImpactCampaignSchema).nullish(),
    '@page': z.union([z.string(), z.number()]).nullish(),
    '@total': z.union([z.string(), z.number()]).nullish(),
    '@numpages': z.union([z.string(), z.number()]).nullish(),
  })
  .passthrough();

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
  })
  .passthrough();

const ImpactPromoCodesResponseSchema = z
  .object({
    PromoCodes: z.array(ImpactPromoCodeSchema).nullish(),
  })
  .passthrough();

export type ImpactCampaign = z.infer<typeof ImpactCampaignSchema>;
export type ImpactPromoCode = z.infer<typeof ImpactPromoCodeSchema>;

export interface ImpactAdapterOptions {
  accountSid?: string;
  authToken?: string;
  pageSize?: number;
  fetchImpl?: typeof fetch;
  maxPages?: number;
}

const IMPACT_BASE = 'https://api.impact.com';

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
    this.pageSize = Math.max(1, Math.min(1000, opts.pageSize ?? 100));
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

    for (let page = 1; page <= this.maxPages; page += 1) {
      const campaigns = await this.fetchCampaigns(page);
      if (campaigns === null) continue;
      if (campaigns.length === 0) {
        log.debug({ network: this.network, page }, 'Impact: empty campaigns page, stopping');
        return;
      }

      for (const campaign of campaigns) {
        const promoCodes = await this.fetchPromoCodes(campaign);
        if (promoCodes === null) continue;
        for (const pc of promoCodes) {
          const mapped = mapImpactPromoCode(pc, campaign);
          if (mapped) yield mapped;
        }
      }

      if (campaigns.length < this.pageSize) {
        log.debug(
          { network: this.network, page, count: campaigns.length },
          'Impact: short campaigns page, stopping'
        );
        return;
      }
    }
  }

  private authHeader(): string {
    const token = Buffer.from(`${this.accountSid}:${this.authToken}`, 'utf8').toString('base64');
    return `Basic ${token}`;
  }

  private async fetchCampaigns(page: number): Promise<ImpactCampaign[] | null> {
    const url =
      `${IMPACT_BASE}/Mediapartners/${encodeURIComponent(this.accountSid)}/Campaigns` +
      `?PageSize=${this.pageSize}&Page=${page}`;
    const json = await this.fetchJson(url, `campaigns page ${page}`);
    if (!json) return null;
    const parsed = ImpactCampaignsResponseSchema.safeParse(json);
    if (!parsed.success) {
      log.error(
        { network: this.network, page, issues: parsed.error.issues.slice(0, 3) },
        'Impact: invalid campaigns response shape'
      );
      return null;
    }
    return parsed.data.Campaigns ?? [];
  }

  private async fetchPromoCodes(
    campaign: ImpactCampaign
  ): Promise<ImpactPromoCode[] | null> {
    const id = encodeURIComponent(String(campaign.CampaignId));
    const url =
      `${IMPACT_BASE}/Mediapartners/${encodeURIComponent(this.accountSid)}/Campaigns/${id}/PromoCodes`;
    const json = await this.fetchJson(url, `promocodes for campaign ${id}`);
    if (!json) return null;
    const parsed = ImpactPromoCodesResponseSchema.safeParse(json);
    if (!parsed.success) {
      log.error(
        {
          network: this.network,
          campaignId: id,
          issues: parsed.error.issues.slice(0, 3),
        },
        'Impact: invalid promocodes response shape'
      );
      return null;
    }
    return parsed.data.PromoCodes ?? [];
  }

  private async fetchJson(url: string, label: string): Promise<unknown | null> {
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
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        log.error(
          { network: this.network, label, status: res.status, body: body.slice(0, 200) },
          'Impact: non-2xx response'
        );
        return null;
      }
      return (await res.json()) as unknown;
    } catch (err) {
      log.error(
        {
          network: this.network,
          label,
          err: err instanceof Error ? err.message : String(err),
        },
        'Impact: fetch failed'
      );
      return null;
    } finally {
      clearTimeout(t);
    }
  }
}

export function mapImpactPromoCode(
  pc: ImpactPromoCode,
  campaign?: ImpactCampaign
): RawDealInput | null {
  const code = (pc.Code ?? '').trim();
  const campaignId = String(pc.CampaignId ?? campaign?.CampaignId ?? '').trim();

  // Build a stable source id. Impact's promo code records sometimes lack a
  // numeric id, so we fall back to campaign+code which is unique per campaign.
  const rawId = pc.Id !== undefined && pc.Id !== null ? String(pc.Id).trim() : '';
  const sourceId = rawId.length > 0 ? rawId : `${campaignId}:${code}`;
  if (sourceId === ':' || sourceId.length === 0) return null;

  const advertiserName = (
    pc.AdvertiserName ??
    campaign?.AdvertiserName ??
    pc.CampaignName ??
    campaign?.CampaignName ??
    ''
  ).trim();
  if (!advertiserName) return null;

  const description = (pc.Description ?? '').trim();
  const title = (description.length > 0 ? description : `${advertiserName} promo`).slice(0, 512);

  const promoType = (pc.PromoType ?? '').toLowerCase();
  const kind: RawDealInput['kind'] =
    code.length > 0 || promoType === 'promocode' ? 'code' : 'sale';

  const parsed = parseDiscountFromText(description);
  const startsAt = toDate(pc.StartDate);
  const expiresAt = toDate(pc.EndDate);

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
      ...(campaign?.AdvertiserId !== undefined && campaign?.AdvertiserId !== null
        ? { advertiserId: String(campaign.AdvertiserId) }
        : {}),
    },
  };
  if (code.length > 0) out.code = code;
  if (description.length > 0) out.description = description;
  if (parsed.discountValueBps !== undefined) out.discountValueBps = parsed.discountValueBps;
  if (parsed.discountValueCents !== undefined) out.discountValueCents = parsed.discountValueCents;
  if (startsAt) out.startsAt = startsAt;
  if (expiresAt) out.expiresAt = expiresAt;
  if (pc.LandingPageUrl) out.deeplink = pc.LandingPageUrl;
  out.attributionSource = 'impact';
  return out;
}
