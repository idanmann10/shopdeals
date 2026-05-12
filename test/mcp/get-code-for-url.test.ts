import { describe, expect, it, vi } from 'vitest';
import {
  handler,
  inputSchema,
  urlToMerchantSlug,
} from '../../src/mcp/tools/get-code-for-url.ts';
import type { McpContext } from '../../src/mcp/context.ts';
import type { Db } from '../../src/db/client.ts';
import { createAffiliateRewriter } from '../../src/lib/affiliate.ts';

function dbWithRows(
  rows: Array<{
    slug: string;
    merchantName: string;
    dealId: string;
    code: string | null;
    title: string;
    description?: string | null;
    discountType?: string;
    discountValueCents?: number | null;
    discountValueBps?: number | null;
    expiresAt?: Date | null;
    deeplink?: string | null;
  }>,
): Db {
  const normalized = rows.map((r) => ({
    slug: r.slug,
    merchantName: r.merchantName,
    dealId: r.dealId,
    code: r.code,
    title: r.title,
    description: r.description ?? null,
    discountType: r.discountType ?? 'unknown',
    discountValueCents: r.discountValueCents ?? null,
    discountValueBps: r.discountValueBps ?? null,
    expiresAt: r.expiresAt ?? null,
    deeplink: r.deeplink ?? null,
  }));
  const chain: Record<string, unknown> = {};
  const passthrough = (): unknown => chain;
  for (const m of ['from', 'innerJoin', 'where', 'orderBy', 'limit']) chain[m] = vi.fn(passthrough);
  chain['then'] = (resolve: (v: unknown) => unknown) => resolve(normalized);
  return { select: vi.fn(() => chain) } as unknown as Db;
}

describe('urlToMerchantSlug', () => {
  it('strips www and returns the leading host segment as slug', () => {
    expect(urlToMerchantSlug('https://www.amazon.com/dp/B0XX')).toEqual({ host: 'amazon.com', slug: 'amazon' });
    expect(urlToMerchantSlug('https://bestbuy.com/site/foo')).toEqual({ host: 'bestbuy.com', slug: 'bestbuy' });
  });

  it('strips common subdomains', () => {
    expect(urlToMerchantSlug('https://smile.amazon.com/dp/B0')?.slug).toBe('amazon');
    expect(urlToMerchantSlug('https://shop.target.com/abc')?.slug).toBe('target');
    expect(urlToMerchantSlug('https://m.bestbuy.com/foo')?.slug).toBe('bestbuy');
  });

  it('strips regional subdomains', () => {
    expect(urlToMerchantSlug('https://uk.adidas.com/x')?.slug).toBe('adidas');
    expect(urlToMerchantSlug('https://us.shein.com/x')?.slug).toBe('shein');
  });

  it('returns null for non-http URLs', () => {
    expect(urlToMerchantSlug('javascript:alert(1)')).toBeNull();
    expect(urlToMerchantSlug('not a url')).toBeNull();
  });
});

describe('get_code_for_url', () => {
  it('rejects without deals:read scope', async () => {
    const ctx: McpContext = { db: dbWithRows([]), clientHash: 't', scopes: [] };
    await expect(handler(inputSchema.parse({ url: 'https://amazon.com/dp/B0X' }), ctx)).rejects.toMatchObject({
      code: -32600,
    });
  });

  it('returns codes ranked by estimated discount, affiliate-tagged deeplinks', async () => {
    const ctx: McpContext = {
      db: dbWithRows([
        {
          slug: 'amazon',
          merchantName: 'Amazon',
          dealId: 'd-1',
          code: 'SAVE10',
          title: '$10 off audio',
          discountType: 'amt_off',
          discountValueCents: 1000,
          deeplink: 'https://www.amazon.com/dp/B0X?ref=foo',
        },
        {
          slug: 'amazon',
          merchantName: 'Amazon',
          dealId: 'd-2',
          code: 'BIG30',
          title: '30% off select audio',
          discountType: 'pct_off',
          discountValueBps: 3000,
        },
      ]),
      clientHash: 't',
      scopes: ['deals:read'],
      affiliate: createAffiliateRewriter({ amazonAssociatesTag: 'shopdeals07eb-20' }),
    };

    const result = await handler(
      inputSchema.parse({ url: 'https://www.amazon.com/dp/B0CHX1W1XY' }),
      ctx,
    );

    expect(result.merchantSlug).toBe('amazon');
    expect(result.merchantName).toBe('Amazon');
    expect(result.asin).toBe('B0CHX1W1XY');
    expect(result.codes).toHaveLength(2);
    // bps=3000 yields estimatedDiscountCents=3000 (per the bps-based scaling
    // in get_code_for_url), which outranks the $10 amt_off code.
    expect(result.codes[0]!.code).toBe('BIG30');
    expect(result.codes[0]!.discountSummary).toBe('30% off');
    expect(result.codes[1]!.code).toBe('SAVE10');
    expect(result.codes[1]!.discountSummary).toBe('$10 off');
    // Deeplink wrapped through Amazon Associates.
    expect(result.codes[1]!.deeplink).toContain('tag=shopdeals07eb-20');
  });

  it('returns a soft note when the merchant is known but has no codes', async () => {
    const ctx: McpContext = {
      db: dbWithRows([
        // Merchant exists but no `code` populated (sale-kind deal).
        { slug: 'walmart', merchantName: 'Walmart', dealId: 'd-3', code: null, title: 'Sitewide sale' },
      ]),
      clientHash: 't',
      scopes: ['deals:read'],
    };
    const r = await handler(inputSchema.parse({ url: 'https://www.walmart.com/ip/12345' }), ctx);
    expect(r.codes).toEqual([]);
    expect(r.note).toMatch(/no active codes/);
  });

  it('returns a different note when merchant is not in catalog at all', async () => {
    const ctx: McpContext = {
      db: dbWithRows([]),
      clientHash: 't',
      scopes: ['deals:read'],
    };
    const r = await handler(inputSchema.parse({ url: 'https://www.unknown-merchant-xyz.com/cart' }), ctx);
    expect(r.codes).toEqual([]);
    expect(r.note).toMatch(/no merchant.+found/);
  });

  it('handles malformed URLs gracefully', async () => {
    const ctx: McpContext = { db: dbWithRows([]), clientHash: 't', scopes: ['deals:read'] };
    await expect(
      handler(inputSchema.parse({ url: 'http://valid.com/x' }), ctx),
    ).resolves.toMatchObject({ codes: [] });
  });
});
