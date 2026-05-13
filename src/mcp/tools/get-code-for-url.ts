/**
 * `get_code_for_url` — closes the buy-side loop.
 *
 * The agent (or the user) has a merchant URL. They want to know: what code
 * applies HERE, RIGHT NOW. We extract the merchant from the URL's host,
 * look up active code-kind deals for that merchant in our catalog, and
 * return them ranked by parsed discount magnitude.
 *
 * This is what makes the agent able to *finish* a purchase, not just point
 * at one. Without this tool, the agent's only path to surfacing a code is
 * to first call find_deals / find_best_deal with the right merchant slug
 * — but it has to GUESS the slug, and the user often pastes URLs we never
 * surfaced.
 *
 * The merchant slug is derived from the URL host:
 *   amazon.com  / www.amazon.com  / smile.amazon.com  → amazon
 *   www.bestbuy.com                                    → bestbuy
 *   bestbuy.com                                        → bestbuy
 *   www.target.com / shop.target.com                   → target
 *
 * For Amazon URLs we additionally extract the ASIN so the agent can pass
 * it to `get_price_history` for a price-low signal without a second
 * round-trip.
 */
import { z } from 'zod';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { McpContext } from '../context.ts';
import { deals, merchants } from '../../db/schema.ts';
import { dealIsActive } from '../../db/predicates.ts';
import { extractAmazonAsin } from '../../lib/affiliate.ts';
import { discountSummary } from '../format.ts';
import { requireScope } from '../scope.ts';

export const name = 'get_code_for_url';

export const description =
  'Given any merchant URL (e.g. an amazon.com or bestbuy.com product/cart page), return the best active coupon codes we hold for that merchant. Use at checkout to apply savings.';

export const inputSchema = z.object({
  url: z.string().url().max(2048),
  /** Optional category hint to bias ranking when a merchant has many codes. */
  category: z.string().max(64).optional(),
  limit: z.number().int().min(1).max(10).default(5),
});

export type GetCodeForUrlInput = z.infer<typeof inputSchema>;

export interface CodeForUrlMatch {
  code: string;
  title: string;
  dealId: string;
  description?: string;
  discountSummary?: string;
  /** Affiliate-wrapped link to the deal's source page when available. */
  deeplink?: string;
  expiresAt?: string;
  /** Best-guess effective discount in cents (parsed from deal metadata). */
  estimatedDiscountCents?: number;
}

export interface GetCodeForUrlResult extends Record<string, unknown> {
  url: string;
  /** Host we extracted (e.g. `amazon.com`). Useful for debugging. */
  host: string;
  /** Slug we joined on (`amazon`, `bestbuy`, …). */
  merchantSlug: string;
  /** Human-readable merchant name if we have one in catalog. */
  merchantName?: string;
  /** When the host is Amazon, the parsed ASIN — convenient for get_price_history. */
  asin?: string;
  codes: CodeForUrlMatch[];
  /** Set when we couldn't extract a merchant from the URL. */
  note?: string;
}

/**
 * Map a URL host to our canonical merchant slug. Strips `www.`, `m.`,
 * regional subdomains (`uk.`, `us.`), and shopping-specific subdomains
 * (`smile.`, `shop.`).
 */
export function urlToMerchantSlug(rawUrl: string): { host: string; slug: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  const host = parsed.hostname.toLowerCase();
  // Strip common subdomains.
  let stripped = host
    .replace(/^(www\.|m\.|mobile\.|shop\.|smile\.|store\.|secure\.)+/, '')
    .replace(/^(us|uk|ca|au|de|fr|it|es|nl|jp|in|mx|br)\./, '');

  // Now collapse to "merchant" form. For `bestbuy.com` we want `bestbuy`.
  // For `amazon.co.uk` we want `amazon`. For `the-home-depot.com` we want
  // `the-home-depot`. The slug is everything up to the FIRST dot in the
  // stripped host.
  const slug = stripped.split('.')[0] ?? stripped;
  return { host: stripped, slug };
}

export async function handler(
  input: GetCodeForUrlInput,
  ctx: McpContext,
): Promise<GetCodeForUrlResult> {
  requireScope(ctx, 'deals:read');

  const extracted = urlToMerchantSlug(input.url);
  if (!extracted) {
    return {
      url: input.url,
      host: '',
      merchantSlug: '',
      codes: [],
      note: 'could not parse a merchant URL',
    };
  }
  const { host, slug } = extracted;

  // The merchant in our catalog might be stored under a different slug
  // (e.g. `the-home-depot` vs `homedepot.com`). Match against BOTH the
  // bare slug AND the full host (since CouponAPI stores stores as
  // `amazon.com`, `homedepot.com`, etc.).
  const candidateSlugs = Array.from(new Set([slug, host, host.replace(/\./g, '-')]));

  // Pull merchant rows + active code-kind deals.
  const rows = await ctx.db
    .select({
      slug: merchants.slug,
      merchantName: merchants.displayName,
      dealId: deals.id,
      code: deals.code,
      title: deals.title,
      description: deals.description,
      discountType: deals.discountType,
      discountValueCents: deals.discountValueCents,
      discountValueBps: deals.discountValueBps,
      expiresAt: deals.expiresAt,
      deeplink: deals.deeplink,
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
    .orderBy(sql`coalesce(${deals.successRate}, 0.5) desc`)
    .limit(input.limit * 2);

  const merchantName = rows[0]?.merchantName;
  const asin = extractAmazonAsin(input.url);

  // Build the rank: numeric discount first (clamped to "real" discounts),
  // then success_rate (already used by the SQL order-by), then title length
  // as a tiebreaker (shorter titles tend to be more actionable).
  const codes: CodeForUrlMatch[] = rows
    .filter((r) => r.code && r.code.trim().length > 0)
    .map((r) => {
      const item: CodeForUrlMatch = {
        code: r.code!.trim(),
        title: r.title,
        dealId: r.dealId,
      };
      if (r.description) item.description = r.description.slice(0, 600);
      if (ctx.affiliate && r.deeplink) {
        item.deeplink = ctx.affiliate.rewrite(r.deeplink).url;
      } else if (r.deeplink) {
        item.deeplink = r.deeplink;
      }
      if (r.expiresAt) item.expiresAt = r.expiresAt.toISOString();
      // Estimated discount.
      if (r.discountValueCents != null && r.discountValueCents > 0) {
        item.estimatedDiscountCents = r.discountValueCents;
      } else if (r.discountValueBps != null && r.discountValueBps > 0) {
        // bps-based: approximate against a $100 cart for ranking purposes.
        item.estimatedDiscountCents = Math.round(r.discountValueBps);
      }
      // Only surface a summary when we have enough metadata to make it
      // actionable — pct/amt require their value field, free_shipping is
      // self-describing. Other discount kinds (unknown / gift / tiered)
      // fall through and leave the field undefined.
      if (
        (r.discountType === 'pct_off' && r.discountValueBps) ||
        (r.discountType === 'amt_off' && r.discountValueCents) ||
        r.discountType === 'free_shipping'
      ) {
        item.discountSummary = discountSummary({
          discountType: r.discountType,
          discountValueBps: r.discountValueBps,
          discountValueCents: r.discountValueCents,
        });
      }
      return item;
    })
    .sort((a, b) => (b.estimatedDiscountCents ?? 0) - (a.estimatedDiscountCents ?? 0))
    .slice(0, input.limit);

  const result: GetCodeForUrlResult = {
    url: input.url,
    host,
    merchantSlug: rows[0]?.slug ?? slug,
    codes,
  };
  if (merchantName) result.merchantName = merchantName;
  if (asin) result.asin = asin;
  if (codes.length === 0 && rows.length === 0) {
    result.note = `no merchant '${slug}' found in catalog — try adding it via the CouponAPI dashboard`;
  } else if (codes.length === 0) {
    result.note = `we know the merchant ('${merchantName ?? slug}') but have no active codes right now`;
  }
  return result;
}
