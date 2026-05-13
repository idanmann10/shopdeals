/**
 * `redeem_link` — wrap any merchant URL through our affiliate layer so the
 * agent's "buy" links earn commission even when WE didn't surface the deal.
 *
 * Why this matters: today, money flows only when find_deals / find_best_deal
 * / find_products return a buyLink that the user clicks. But agents
 * routinely encounter merchant URLs from other sources — user pastes a
 * Best Buy URL from a friend, the agent finds something on a forum and
 * wants to recommend it, etc. Without this tool, the agent has no way to
 * "shopdeals-ify" those URLs, so the commission goes to whoever owns the
 * original tracking (often nobody — i.e., revenue is left on the table).
 *
 * What it does:
 *   - Run the URL through `ctx.affiliate.rewrite` (same logic as
 *     find_best_deal / find_products).
 *   - Surface which program got applied (Amazon Associates / Skimlinks /
 *     no-op for community URLs).
 *   - When the merchant is in our catalog, hint at active codes via a
 *     `codeHint` field — the agent can call `get_code_for_url` for the
 *     full list.
 *
 * Privacy note: this tool only sees the URL, never the user's identity or
 * payment info. The affiliate ID is bound to the server, not the agent.
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

  // 1) Always-run: affiliate rewrite. This is the money path — works even
  // when the URL doesn't map to a merchant in our catalog (Skimlinks
  // covers thousands of long-tail merchants).
  const rewriter = ctx.affiliate;
  const { url: buyLink, applied } = rewriter
    ? rewriter.rewrite(input.url)
    : { url: input.url, applied: 'noop' as const };

  // 2) Catalog lookup: do we have a known merchant + active codes for this URL?
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
