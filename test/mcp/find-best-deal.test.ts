/**
 * find_best_deal tests. Covers:
 *  - returns a note when SerpApi isn't configured
 *  - search → immersive → ranking happy path with cross-matched codes
 *  - graceful degradation when immersive call fails (falls back to shopping-result level)
 *  - Amazon price-signal annotation when Keepa returns history
 *  - affiliate rewriting on each buy link
 *  - scope guard
 */
import { describe, expect, it, vi } from 'vitest';
import { handler, inputSchema } from '../../src/mcp/tools/find-best-deal.ts';
import type { McpContext } from '../../src/mcp/context.ts';
import type { Db } from '../../src/db/client.ts';
import { createAffiliateRewriter } from '../../src/lib/affiliate.ts';
import type {
  SellerOffer,
  SerpApiClient,
  ShoppingResult,
} from '../../src/lib/serpapi.ts';
import type { KeepaClient } from '../../src/sources/keepa.ts';

function stubSerpApi(opts: {
  results?: ShoppingResult[];
  offers?: SellerOffer[];
  searchError?: Error;
  offersError?: Error;
}): SerpApiClient {
  return {
    isConfigured: () => true,
    search: vi.fn(async () => {
      if (opts.searchError) throw opts.searchError;
      return opts.results ?? [];
    }),
    productOffers: vi.fn(async () => {
      if (opts.offersError) throw opts.offersError;
      return opts.offers ?? [];
    }),
  } as unknown as SerpApiClient;
}

function stubKeepa(points: Array<{ observedAt: string; priceCents: number; availability: string }> | null): KeepaClient {
  return {
    isConfigured: () => points !== null,
    fetchPriceHistory: vi.fn(async () => ({
      asin: 'B0X',
      domain: 1,
      currency: 'USD',
      points: points ?? [],
    })),
  } as unknown as KeepaClient;
}

function dbWithCodes(codesBySlug: Record<string, Array<{ code?: string; title: string; id: string; discountValueCents?: number }>>): Db {
  const rows = Object.entries(codesBySlug).flatMap(([slug, cs]) =>
    cs.map((c) => ({
      slug,
      id: c.id,
      code: c.code ?? null,
      title: c.title,
      kind: 'code',
      discountValueCents: c.discountValueCents ?? null,
      discountValueBps: null,
    })),
  );
  const chain: Record<string, unknown> = {};
  const passthrough = (): unknown => chain;
  for (const m of ['from', 'innerJoin', 'where', 'limit']) chain[m] = vi.fn(passthrough);
  chain['then'] = (resolve: (v: unknown) => unknown) => resolve(rows);
  return { select: vi.fn(() => chain) } as unknown as Db;
}

describe('find_best_deal', () => {
  it('returns a note when SerpApi is not configured', async () => {
    const ctx: McpContext = {
      db: dbWithCodes({}),
      clientHash: 't',
      scopes: ['deals:read'],
      serpapi: { isConfigured: () => false } as unknown as SerpApiClient,
    };
    const result = await handler(inputSchema.parse({ query: 'airpods' }), ctx);
    expect(result.best).toBeUndefined();
    expect(result.alternatives).toEqual([]);
    expect(result.note).toMatch(/disabled/);
  });

  it('rejects when deals:read scope is missing', async () => {
    const ctx: McpContext = {
      db: dbWithCodes({}),
      clientHash: 't',
      scopes: [],
      serpapi: stubSerpApi({}),
    };
    await expect(handler(inputSchema.parse({ query: 'airpods' }), ctx)).rejects.toMatchObject({
      code: -32600,
    });
  });

  it('ranks options by effective total ascending and surfaces the best buy', async () => {
    const results: ShoppingResult[] = [{
      title: 'Apple AirPods Pro',
      link: 'https://www.google.com/shopping/product/123',
      merchantName: 'Best Buy',
      merchantSlug: 'best-buy',
      immersiveToken: 'TOK123',
    }];
    const offers: SellerOffer[] = [
      { merchantName: 'Best Buy', merchantSlug: 'best-buy', link: 'https://www.bestbuy.com/x', priceCents: 19999, shippingCents: 0, totalCents: 19999, flags: [] },
      { merchantName: 'Amazon', merchantSlug: 'amazon', link: 'https://www.amazon.com/dp/B0EXAMPLE0', priceCents: 17999, shippingCents: 0, totalCents: 17999, flags: ['In stock'] },
      { merchantName: 'eBay', merchantSlug: 'ebay', link: 'https://www.ebay.com/x', priceCents: 18999, shippingCents: 1499, totalCents: 20498, flags: [] },
    ];
    const ctx: McpContext = {
      db: dbWithCodes({
        amazon: [{ code: 'SAVE10', title: '$10 off audio', id: 'd-1', discountValueCents: 1000 }],
      }),
      clientHash: 't',
      scopes: ['deals:read'],
      serpapi: stubSerpApi({ results, offers }),
      affiliate: createAffiliateRewriter({ amazonAssociatesTag: 'shopdeals07eb-20' }),
    };
    const result = await handler(inputSchema.parse({ query: 'airpods pro' }), ctx);

    expect(result.best?.merchant).toBe('Amazon');
    // 17999 − 1000 code = 16999 effective.
    expect(result.best?.effectiveTotalCents).toBe(16999);
    // Amazon link is affiliate-wrapped.
    expect(result.best?.buyLink).toContain('tag=shopdeals07eb-20');
    expect(result.best?.codes?.[0]?.code).toBe('SAVE10');
    // Alternatives are sorted by remaining effective total — Best Buy 19999 < eBay 20498.
    expect(result.alternatives.map((a) => a.merchant)).toEqual(['Best Buy', 'eBay']);
    expect(result.meta.serpapiCalls).toBe(2);
    expect(result.meta.couponsMatched).toBe(1);
  });

  it('falls back to shopping-result level when immersive call fails', async () => {
    const results: ShoppingResult[] = [{
      title: 'AirPods Pro',
      link: 'https://www.google.com/shopping/product/123',
      merchantName: 'Best Buy',
      merchantSlug: 'best-buy',
      priceCents: 19999,
      immersiveToken: 'TOK',
    }];
    const ctx: McpContext = {
      db: dbWithCodes({}),
      clientHash: 't',
      scopes: ['deals:read'],
      serpapi: stubSerpApi({ results, offersError: new Error('immersive failed') }),
    };
    const result = await handler(inputSchema.parse({ query: 'xx' }), ctx);
    expect(result.best?.merchant).toBe('Best Buy');
    expect(result.best?.priceCents).toBe(19999);
    expect(result.meta.serpapiCalls).toBe(2);
  });

  it('annotates Amazon options with a price signal from Keepa history', async () => {
    const results: ShoppingResult[] = [{
      title: 'AirPods Pro',
      link: 'https://www.google.com/shopping/product/123',
      merchantName: 'Amazon',
      merchantSlug: 'amazon',
      immersiveToken: 'TOK',
    }];
    const offers: SellerOffer[] = [
      { merchantName: 'Amazon', merchantSlug: 'amazon', link: 'https://www.amazon.com/dp/B0EXAMPLE0', priceCents: 17999, totalCents: 17999, flags: [] },
    ];
    const now = new Date();
    const points = [
      // History shows 17999 is at the all-time low.
      { observedAt: new Date(now.getTime() - 60 * 86_400_000).toISOString(), priceCents: 24999, availability: 'in_stock' },
      { observedAt: new Date(now.getTime() - 30 * 86_400_000).toISOString(), priceCents: 19999, availability: 'in_stock' },
      { observedAt: new Date(now.getTime() - 1 * 86_400_000).toISOString(), priceCents: 17999, availability: 'in_stock' },
    ];
    const ctx: McpContext = {
      db: dbWithCodes({}),
      clientHash: 't',
      scopes: ['deals:read'],
      serpapi: stubSerpApi({ results, offers }),
      keepa: stubKeepa(points),
    };
    const result = await handler(inputSchema.parse({ query: 'xx' }), ctx);
    expect(result.best?.priceSignal).toMatch(/low/i);
    expect(result.meta.keepaCalls).toBe(1);
  });

  it('returns empty when SerpApi yields zero shopping results', async () => {
    const ctx: McpContext = {
      db: dbWithCodes({}),
      clientHash: 't',
      scopes: ['deals:read'],
      serpapi: stubSerpApi({ results: [] }),
    };
    const result = await handler(inputSchema.parse({ query: 'made up product no one sells' }), ctx);
    expect(result.best).toBeUndefined();
    expect(result.alternatives).toEqual([]);
  });
});
