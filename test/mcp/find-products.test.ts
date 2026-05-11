/**
 * find_products tests. Verifies:
 *  - returns a `note` and empty results when SerpApi isn't configured
 *  - propagates a friendly note when SerpApi search fails (no throw)
 *  - cross-matches active code-kind deals from the DB onto each result by
 *    merchant slug
 *  - applies the affiliate rewriter to outbound buyLinks
 */
import { describe, expect, it, vi } from 'vitest';
import {
  handler,
  inputSchema,
} from '../../src/mcp/tools/find-products.ts';
import type { McpContext } from '../../src/mcp/context.ts';
import type { Db } from '../../src/db/client.ts';
import { createAffiliateRewriter } from '../../src/lib/affiliate.ts';
import type { ShoppingResult, SerpApiClient } from '../../src/lib/serpapi.ts';

function stubSerpApi(results: ShoppingResult[], failWith?: Error): SerpApiClient {
  return {
    isConfigured: () => true,
    search: vi.fn(async () => {
      if (failWith) throw failWith;
      return results;
    }),
  } as unknown as SerpApiClient;
}

function unconfiguredSerpApi(): SerpApiClient {
  return { isConfigured: () => false, search: vi.fn() } as unknown as SerpApiClient;
}

function dbWithCodes(codesBySlug: Record<string, Array<{ code: string; title: string; id: string }>>): Db {
  // The handler builds a single chain: db.select(...).from(deals)
  //   .innerJoin(merchants, ...).where(and(...)).limit(200) -> rows.
  // Return one flattened array combining every slug's rows.
  const rows = Object.entries(codesBySlug).flatMap(([slug, cs]) =>
    cs.map((c) => ({ slug, code: c.code, title: c.title, id: c.id })),
  );
  const chain: Record<string, unknown> = {};
  const passthrough = (): unknown => chain;
  for (const m of ['from', 'innerJoin', 'where', 'limit']) chain[m] = vi.fn(passthrough);
  chain['then'] = (resolve: (v: unknown) => unknown) => resolve(rows);
  return { select: vi.fn(() => chain) } as unknown as Db;
}

describe('find_products', () => {
  it('returns a note when SerpApi is not configured', async () => {
    const ctx: McpContext = {
      db: dbWithCodes({}),
      clientHash: 't',
      scopes: ['deals:read'],
      serpapi: unconfiguredSerpApi(),
    };
    const result = await handler(inputSchema.parse({ query: 'airpods' }), ctx);
    expect(result.results).toEqual([]);
    expect(result.note).toMatch(/disabled/);
  });

  it('returns a soft note when SerpApi throws', async () => {
    const ctx: McpContext = {
      db: dbWithCodes({}),
      clientHash: 't',
      scopes: ['deals:read'],
      serpapi: stubSerpApi([], new Error('rate limited')),
    };
    const result = await handler(inputSchema.parse({ query: 'airpods' }), ctx);
    expect(result.results).toEqual([]);
    expect(result.note).toMatch(/temporarily unavailable/);
  });

  it('cross-matches coupons by merchant slug', async () => {
    const shopping: ShoppingResult[] = [
      {
        title: 'AirPods Pro 2',
        link: 'https://www.amazon.com/dp/B0D1XD1ZV3',
        merchantName: 'Amazon',
        merchantSlug: 'amazon',
        priceCents: 18900,
      },
      {
        title: 'AirPods Pro 2',
        link: 'https://www.bestbuy.com/site/123',
        merchantName: 'Best Buy',
        merchantSlug: 'best-buy',
        priceCents: 19900,
      },
    ];
    const ctx: McpContext = {
      db: dbWithCodes({
        amazon: [{ code: 'SAVE60', title: '20% off audio', id: 'd-1' }],
        // best-buy has no code in our catalog
      }),
      clientHash: 't',
      scopes: ['deals:read'],
      serpapi: stubSerpApi(shopping),
      affiliate: createAffiliateRewriter({ amazonAssociatesTag: 'snapai-20' }),
    };
    const result = await handler(inputSchema.parse({ query: 'airpods' }), ctx);
    expect(result.results).toHaveLength(2);
    expect(result.results[0]!.codes).toEqual([
      { code: 'SAVE60', title: '20% off audio', dealId: 'd-1' },
    ]);
    expect(result.results[1]!.codes).toBeUndefined();
    // Amazon buyLink is affiliate-wrapped.
    expect(result.results[0]!.buyLink).toContain('tag=snapai-20');
    // Best Buy URL is unchanged (no affiliate wrap for them yet).
    expect(result.results[1]!.buyLink).toBe('https://www.bestbuy.com/site/123');
  });

  it('rejects when deals:read scope is missing', async () => {
    const ctx: McpContext = {
      db: dbWithCodes({ amazon: [{ code: 'X', title: 't', id: 'i' }] }),
      clientHash: 't',
      scopes: [],
      serpapi: stubSerpApi([
        {
          title: 'X',
          link: 'https://amazon.com/dp/B0X',
          merchantName: 'Amazon',
          merchantSlug: 'amazon',
        },
      ]),
    };
    await expect(handler(inputSchema.parse({ query: 'foo' }), ctx)).rejects.toMatchObject({
      code: -32600,
    });
  });
});
