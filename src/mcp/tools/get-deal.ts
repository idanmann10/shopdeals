import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import type { McpContext } from '../context.ts';
import { deals, merchants } from '../../db/schema.ts';
import { discountSummary, eligibilitySummary } from '../format.ts';

export const name = 'get_deal';

export const description =
  'Fetch a single deal by id, including the full discount specification and the parent merchant record.';

export const inputSchema = z.object({
  dealId: z.string().uuid(),
});

export type GetDealInput = z.infer<typeof inputSchema>;

export interface GetDealResult extends Record<string, unknown> {
  deal: {
    id: string;
    kind: string;
    code: string | null;
    title: string;
    description: string | null;
    discountType: string;
    discountValueBps: number | null;
    discountValueCents: number | null;
    discountSummary: string;
    cartMinCents: number | null;
    skuScope: unknown;
    geoScope: string[];
    segment: string;
    stackRules: unknown;
    eligibilitySummary: string;
    startsAt: string | null;
    expiresAt: string | null;
    deeplink: string | null;
    attributionSource: string | null;
    sourceNetwork: string;
    lastSeenWorkingAt: string | null;
    successRate: number | null;
    successSampleCount: number;
    isActive: boolean;
    ingestedAt: string;
    updatedAt: string;
  };
  merchant: {
    id: string;
    slug: string;
    displayName: string;
    domains: string[];
    categories: string[];
    countries: string[];
    cashbackRateBps: number | null;
    attributionSource: string | null;
    verificationDifficulty: string;
    logoUrl: string | null;
    homepageUrl: string | null;
  };
}

export async function handler(
  input: GetDealInput,
  ctx: McpContext,
): Promise<GetDealResult> {
  const rows = await ctx.db
    .select({
      deal: deals,
      merchant: merchants,
    })
    .from(deals)
    .innerJoin(merchants, eq(deals.merchantId, merchants.id))
    .where(eq(deals.id, input.dealId))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new McpError(ErrorCode.InvalidParams, `deal not found: ${input.dealId}`);
  }

  const d = row.deal;
  const m = row.merchant;

  return {
    deal: {
      id: d.id,
      kind: d.kind,
      code: d.code,
      title: d.title,
      description: d.description,
      discountType: d.discountType,
      discountValueBps: d.discountValueBps,
      discountValueCents: d.discountValueCents,
      discountSummary: discountSummary(d),
      cartMinCents: d.cartMinCents,
      skuScope: d.skuScope ?? null,
      geoScope: d.geoScope,
      segment: d.segment,
      stackRules: d.stackRules ?? null,
      eligibilitySummary: eligibilitySummary(d),
      startsAt: d.startsAt?.toISOString() ?? null,
      expiresAt: d.expiresAt?.toISOString() ?? null,
      deeplink: d.deeplink,
      attributionSource: d.attributionSource,
      sourceNetwork: d.sourceNetwork,
      lastSeenWorkingAt: d.lastSeenWorkingAt?.toISOString() ?? null,
      successRate: d.successRate,
      successSampleCount: d.successSampleCount,
      isActive: d.isActive,
      ingestedAt: d.ingestedAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
    },
    merchant: {
      id: m.id,
      slug: m.slug,
      displayName: m.displayName,
      domains: m.domains,
      categories: m.categories,
      countries: m.countries,
      cashbackRateBps: m.cashbackRateBps,
      attributionSource: m.attributionSource,
      verificationDifficulty: m.verificationDifficulty,
      logoUrl: m.logoUrl,
      homepageUrl: m.homepageUrl,
    },
  };
}
