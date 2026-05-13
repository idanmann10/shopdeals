/**
 * `redeem_link` — wrap any merchant URL through `ctx.affiliate.rewrite`,
 * report which program got applied (Amazon Associates / Skimlinks / noop),
 * and when the merchant is in our catalog, surface the top active code so
 * the agent can hint at it inline.
 *
 * Privacy: only the URL is read — never the user's identity or payment info.
 * The affiliate ID is bound to the server, not the agent.
 */
import { z } from 'zod';
import { and, eq, inArray } from 'drizzle-orm';
import type { McpContext } from '../context.ts';
import { deals, merchants } from '../../db/schema.ts';
import { dealIsActive } from '../../db/predicates.ts';
import { urlToMerchantSlug } from './get-code-for-url.ts';
import { requireScope } from '../scope.ts';
import type { CodeRef } from './types.ts';

export const name = 'redeem_link';

export const description =
  'Wrap a merchant URL with our affiliate tracking. Hand the agent a buy-ready link that earns commission when the user purchases. Also hints whether we hold any active coupon codes for that merchant.';

export const inputSchema = z.object({
  url: z.string().url().max(2048),
});

export type RedeemLinkInput = z.infer<typeof inputSchema>;

export interface RedeemLinkResult extends Record<string, unknown> {
  /** The original URL the agent passed in. */
  inputUrl: string;
  /** The URL the agent should hand the user. May be unchanged. */
  buyLink: string;
  /** Which affiliate program got applied: `amazon-associates`, `skimlinks`, or `noop`. */
  applied: 'amazon-associates' | 'skimlinks' | 'noop';
  /** Pretty merchant name from our catalog, when known. */
  merchant?: string;
  /** Catalog slug we matched on. */
  merchantSlug?: string;
  /** Quick yes/no — do we have active codes for this merchant right now? */
  hasActiveCodes: boolean;
  /** When `hasActiveCodes` is true, the top code so the agent can surface it inline. */
  topCode?: CodeRef;
}

export async function handler(
  input: RedeemLinkInput,
  ctx: McpContext,
): Promise<RedeemLinkResult> {
  requireScope(ctx, 'deals:read');

  // Always rewrite, even for URLs not in our catalog — Skimlinks covers
  // the long tail.
  const rewriter = ctx.affiliate;
  const { url: buyLink, applied } = rewriter
    ? rewriter.rewrite(input.url)
    : { url: input.url, applied: 'noop' as const };

  const extracted = urlToMerchantSlug(input.url);
  const result: RedeemLinkResult = {
    inputUrl: input.url,
    buyLink,
    applied: applied ?? 'noop',
    hasActiveCodes: false,
  };

  if (!extracted) return result;

  const candidateSlugs = Array.from(new Set([extracted.slug, extracted.host, extracted.host.replace(/\./g, '-')]));

  const rows = await ctx.db
    .select({
      slug: merchants.slug,
      merchantName: merchants.displayName,
      dealId: deals.id,
      code: deals.code,
      title: deals.title,
    })
    .from(deals)
    .innerJoin(merchants, eq(deals.merchantId, merchants.id))
    .where(
      and(
        inArray(merchants.slug, candidateSlugs),
        eq(deals.kind, 'code'),
        dealIsActive(),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (row) {
    if (row.merchantName) result.merchant = row.merchantName;
    result.merchantSlug = row.slug;
    if (row.code) {
      result.hasActiveCodes = true;
      result.topCode = { code: row.code, title: row.title, dealId: row.dealId };
    }
  }

  return result;
}
