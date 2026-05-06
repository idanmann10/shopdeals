import { describe, it, expect } from 'vitest';
import { handler, inputSchema, REQUIRED_SCOPE } from '../../src/mcp/tools/get-price-history.ts';
import type { McpContext } from '../../src/mcp/context.ts';
import type { Db } from '../../src/db/client.ts';

/**
 * The handler issues a single Drizzle SELECT chain that ultimately resolves
 * to a row array. Tests that exercise the scope guard never reach the DB —
 * we still hand in a chainable proxy so type-correct destructuring works.
 */
function makeMockDb(rows: unknown[] = []): Db {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => unknown) => resolve(rows);
        }
        return () => proxy;
      },
    },
  );
  return proxy as Db;
}

function ctxWith(scopes: string[]): McpContext {
  return { db: makeMockDb(), clientHash: 'test', scopes };
}

describe('get_price_history tool', () => {
  it('throws InvalidRequest (-32600) when prices:read is missing', async () => {
    const ctx = ctxWith(['deals:read']);
    const input = inputSchema.parse({ asin: 'B0EXAMPLE0' });
    await expect(handler(input, ctx)).rejects.toMatchObject({
      // -32600 = JSON-RPC InvalidRequest; this is the correct error code for
      // a forbidden/unauthorized request that the SDK doesn't have a
      // dedicated `Forbidden` code for.
      code: -32600,
      message: expect.stringMatching(/prices:read/) as unknown as string,
    });
  });

  it('does NOT throw ConnectionClosed (-32000) for missing scope', async () => {
    // Regression test: the previous implementation used ConnectionClosed,
    // which the SDK treats as a transport disconnect signal. That would
    // tear down the client session for an authorization failure — wrong.
    const ctx = ctxWith([]);
    const input = inputSchema.parse({ productUrl: 'https://example.test/p/1' });
    await expect(handler(input, ctx)).rejects.toMatchObject({ code: -32600 });
    await expect(handler(input, ctx)).rejects.not.toMatchObject({ code: -32000 });
  });

  it('returns the no-history note when scope present and no rows', async () => {
    const ctx: McpContext = {
      db: makeMockDb([]),
      clientHash: 'test',
      scopes: [REQUIRED_SCOPE],
    };
    const result = await handler(inputSchema.parse({ asin: 'B0EXAMPLE0' }), ctx);
    expect(result.series).toEqual([]);
    expect(result.note).toBe('no history');
  });

  it('shapes rows into a series and computes lows when scope present', async () => {
    const rows = [
      { observedAt: new Date('2026-04-01T00:00:00Z'), priceCents: 1999, availability: 'in_stock' },
      { observedAt: new Date('2026-04-15T00:00:00Z'), priceCents: 1499, availability: 'in_stock' },
      { observedAt: new Date('2026-05-01T00:00:00Z'), priceCents: 1799, availability: 'in_stock' },
    ];
    const ctx: McpContext = {
      db: makeMockDb(rows),
      clientHash: 'test',
      scopes: [REQUIRED_SCOPE],
    };
    const result = await handler(inputSchema.parse({ asin: 'B0EXAMPLE0' }), ctx);
    expect(result.series).toHaveLength(3);
    expect(result.lowAllTime).toBe(1499);
    expect(result.current).toBe(1799);
  });
});
