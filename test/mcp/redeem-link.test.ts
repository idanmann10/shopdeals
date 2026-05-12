import { describe, expect, it, vi } from 'vitest';
import { handler, inputSchema } from '../../src/mcp/tools/redeem-link.ts';
import type { McpContext } from '../../src/mcp/context.ts';
import type { Db } from '../../src/db/client.ts';
import { createAffiliateRewriter } from '../../src/lib/affiliate.ts';

function dbWithRows(
  rows: Array<{ slug: string; merchantName: string; dealId: string; code: string | null; title: string }>,
): Db {
  const chain: Record<string, unknown> = {};
  const passthrough = (): unknown => chain;
  for (const m of ['from', 'innerJoin', 'where', 'limit']) chain[m] = vi.fn(passthrough);
  chain['then'] = (resolve: (v: unknown) => unknown) => resolve(rows);
  return { select: vi.fn(() => chain) } as unknown as Db;
}

describe('redeem_link', () => {
  it('rejects without deals:read scope', async () => {
    const ctx: McpContext = { db: dbWithRows([]), clientHash: 't', scopes: [] };
    await expect(
      handler(inputSchema.parse({ url: 'https://amazon.com/dp/B0X' }), ctx),
    ).rejects.toMatchObject({ code: -32600 });
  });

  it('amazon.com URL gets Amazon Associates tag + hints code when one exists', async () => {
    const ctx: McpContext = {
      db: dbWithRows([
        { slug: 'amazon', merchantName: 'Amazon', dealId: 'd-1', code: 'SAVE10', title: '$10 off' },
      ]),
      clientHash: 't',
      scopes: ['deals:read'],
      affiliate: createAffiliateRewriter({ amazonAssociatesTag: 'shopdeals07eb-20' }),
    };
    const r = await handler(inputSchema.parse({ url: 'https://www.amazon.com/dp/B0CHX1W1XY' }), ctx);
    expect(r.applied).toBe('amazon-associates');
    expect(r.buyLink).toContain('tag=shopdeals07eb-20');
    expect(r.merchant).toBe('Amazon');
    expect(r.merchantSlug).toBe('amazon');
    expect(r.hasActiveCodes).toBe(true);
    expect(r.topCode).toEqual({ code: 'SAVE10', title: '$10 off', dealId: 'd-1' });
  });

  it('non-amazon URL gets Skimlinks-wrapped when configured', async () => {
    const ctx: McpContext = {
      db: dbWithRows([]),
      clientHash: 't',
      scopes: ['deals:read'],
      affiliate: createAffiliateRewriter({ skimlinksPublisherId: '302900X1790925' }),
    };
    const r = await handler(inputSchema.parse({ url: 'https://www.bestbuy.com/site/airpods/123' }), ctx);
    expect(r.applied).toBe('skimlinks');
    expect(r.buyLink).toMatch(/go\.skimresources\.com\/\?id=302900X1790925/);
  });

  it('community URLs pass through unchanged with applied=noop', async () => {
    const ctx: McpContext = {
      db: dbWithRows([]),
      clientHash: 't',
      scopes: ['deals:read'],
      affiliate: createAffiliateRewriter({ skimlinksPublisherId: '302900X1790925' }),
    };
    const r = await handler(inputSchema.parse({ url: 'https://slickdeals.net/f/12345' }), ctx);
    expect(r.applied).toBe('noop');
    expect(r.buyLink).toBe('https://slickdeals.net/f/12345');
  });

  it('reports hasActiveCodes=false when merchant exists but no codes', async () => {
    const ctx: McpContext = {
      db: dbWithRows([
        // merchant exists, but the only deal has no `code` (sale-kind)
        { slug: 'target', merchantName: 'Target', dealId: 'd-x', code: null, title: 'Sale' },
      ]),
      clientHash: 't',
      scopes: ['deals:read'],
      affiliate: createAffiliateRewriter({ skimlinksPublisherId: '302900X1790925' }),
    };
    const r = await handler(inputSchema.parse({ url: 'https://www.target.com/p/foo' }), ctx);
    expect(r.merchant).toBe('Target');
    expect(r.hasActiveCodes).toBe(false);
    expect(r.topCode).toBeUndefined();
  });
});
