/**
 * Regression test: no tool may return a `google.com/search` or
 * `google.com/shopping` URL as a buy link.
 *
 * A real Claude Desktop user hit this — `find_products` was returning
 * Google Shopping product-page URLs instead of merchant URLs, because the
 * tool used SerpApi's `product_link` field without the immersive follow-up.
 * Fixed in the same PR that added the immersive enrichment.
 *
 * This test guards the regression by:
 *   1. Driving each "buy link emitting" tool against an in-memory stack
 *   2. Walking the structuredContent for any string field that looks like
 *      a URL
 *   3. Asserting none of them resolve to a google.com search/shopping page
 *
 * The SerpApi stub returns a normal shopping result PLUS an immersive
 * response with real merchant URLs, so the tool has the data it needs to
 * pick the right one. If a future change accidentally surfaces the
 * `product_link` (or strips the immersive call), this fails.
 */
import { describe, expect, it, vi } from 'vitest';
import { handler as findProducts, inputSchema as findProductsInput } from '../../src/mcp/tools/find-products.ts';
import { handler as findBestDeal, inputSchema as findBestDealInput } from '../../src/mcp/tools/find-best-deal.ts';
import type { McpContext } from '../../src/mcp/context.ts';
import type { Db } from '../../src/db/client.ts';
import { createAffiliateRewriter } from '../../src/lib/affiliate.ts';
import type {
  SellerOffer,
  SerpApiClient,
  ShoppingResult,
} from '../../src/lib/serpapi.ts';
import { serpApiRateLimiter } from '../../src/lib/rate-limit.ts';

function stubSerpApi(results: ShoppingResult[], offers: SellerOffer[]): SerpApiClient {
  return {
    isConfigured: () => true,
    search: vi.fn(async () => results),
    productOffers: vi.fn(async () => offers),
  } as unknown as SerpApiClient;
}

function dbWithEmpty(): Db {
  const chain: Record<string, unknown> = {};
  const passthrough = (): unknown => chain;
  for (const m of ['from', 'innerJoin', 'where', 'limit', 'orderBy']) chain[m] = vi.fn(passthrough);
  chain['then'] = (resolve: (v: unknown) => unknown) => resolve([]);
  return { select: vi.fn(() => chain) } as unknown as Db;
}

/** Walk a value recursively and yield every string. */
function* walkStrings(v: unknown): Generator<string> {
  if (typeof v === 'string') yield v;
  else if (Array.isArray(v)) for (const item of v) yield* walkStrings(item);
  else if (v && typeof v === 'object') for (const k of Object.keys(v)) yield* walkStrings((v as Record<string, unknown>)[k]);
}

/** A URL counts as "bad" if it's a Google Shopping/search redirector page,
 * including the case where Skimlinks wrapped one (which would mean the tool
 * surfaced a Google URL upstream and we just shifted the problem). */
function isBadBuyLink(url: string): boolean {
  if (!/^https?:\/\//.test(url)) return false;
  // Direct google.com/search or shopping URL
  if (/google\.com\/(search|shopping)/i.test(url)) return true;
  // Skimlinks-wrapped google URL — the wrapped url= contains a google host
  const wrapped = url.match(/[?&]url=([^&]+)/);
  if (wrapped?.[1]) {
    try {
      const inner = decodeURIComponent(wrapped[1]);
      if (/google\.com\/(search|shopping)/i.test(inner)) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

describe('no tool leaks a google.com URL as a buy link', () => {
  it('find_products returns direct merchant URLs even when SerpApi gives Google product_link', async () => {
    serpApiRateLimiter.reset();
    const results: ShoppingResult[] = [
      {
        title: 'AirPods Pro',
        link: 'https://www.google.com/shopping/product/1234',
        merchantName: 'Best Buy',
        merchantSlug: 'best-buy',
        immersiveToken: 'TOK',
      },
    ];
    const offers: SellerOffer[] = [
      { merchantName: 'Best Buy', merchantSlug: 'best-buy', link: 'https://www.bestbuy.com/site/airpods/123', priceCents: 17999, totalCents: 17999, flags: [] },
    ];
    const ctx: McpContext = {
      db: dbWithEmpty(),
      clientHash: 'no-google-test-1',
      scopes: ['deals:read'],
      serpapi: stubSerpApi(results, offers),
      affiliate: createAffiliateRewriter({ amazonAssociatesTag: 'snapai-20', skimlinksPublisherId: '123456' }),
    };
    const out = await findProducts(findProductsInput.parse({ query: 'airpods' }), ctx);
    for (const s of walkStrings(out)) {
      if (s.startsWith('http')) expect(isBadBuyLink(s), `tool returned a Google URL: ${s}`).toBe(false);
    }
    expect(out.results.length).toBeGreaterThan(0);
  });

  it('find_best_deal returns direct merchant URLs', async () => {
    serpApiRateLimiter.reset();
    const results: ShoppingResult[] = [
      {
        title: 'AirPods Pro',
        link: 'https://www.google.com/shopping/product/1234',
        merchantName: 'Best Buy',
        merchantSlug: 'best-buy',
        immersiveToken: 'TOK',
      },
    ];
    const offers: SellerOffer[] = [
      { merchantName: 'Best Buy', merchantSlug: 'best-buy', link: 'https://www.bestbuy.com/site/airpods/123', priceCents: 17999, totalCents: 17999, flags: [] },
      { merchantName: 'Amazon', merchantSlug: 'amazon', link: 'https://www.amazon.com/dp/B0EXAMPLE0', priceCents: 18999, totalCents: 18999, flags: [] },
    ];
    const ctx: McpContext = {
      db: dbWithEmpty(),
      clientHash: 'no-google-test-2',
      scopes: ['deals:read'],
      serpapi: stubSerpApi(results, offers),
      affiliate: createAffiliateRewriter({ amazonAssociatesTag: 'snapai-20', skimlinksPublisherId: '123456' }),
    };
    const out = await findBestDeal(findBestDealInput.parse({ query: 'airpods' }), ctx);
    for (const s of walkStrings(out)) {
      if (s.startsWith('http')) expect(isBadBuyLink(s), `tool returned a Google URL: ${s}`).toBe(false);
    }
    expect(out.best).toBeDefined();
  });
});
