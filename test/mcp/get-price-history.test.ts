import { describe, it, expect, vi } from 'vitest';
import { handler, inputSchema, REQUIRED_SCOPE } from '../../src/mcp/tools/get-price-history.ts';
import type { McpContext } from '../../src/mcp/context.ts';
import type { Db } from '../../src/db/client.ts';
import { KeepaClient } from '../../src/sources/keepa.ts';

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

/**
 * Keepa-refresh path. Drizzle's chained builder is awkward to mock fully so
 * we hand-roll a recording DB that returns:
 *   - the "latest observation" row for the freshness probe (when configured)
 *   - the final selected rows for the response shaping
 * The order matters: the handler performs (a) latest-observation probe,
 * (b) insert when Keepa returns fresh points, (c) final select.
 */
describe('get_price_history Keepa refresh', () => {
  function makeRecordingDb(opts: {
    latestObservedAt: Date | null;
    finalRows: Array<{ observedAt: Date; priceCents: number; availability: string | null }>;
  }): { db: Db; inserted: unknown[] } {
    const inserted: unknown[] = [];
    let selectCall = 0;

    const insertChain = {
      values: vi.fn(async (rows: unknown) => {
        inserted.push(rows);
      }),
    };

    const buildSelectChain = (): unknown => {
      // Each top-level select() call hands back a fresh chain whose terminal
      // `.limit()` / awaited promise resolves to the appropriate rows.
      const currentCall = ++selectCall;
      const chain: Record<string, unknown> = {};
      const passthrough = (): unknown => chain;
      // Methods called along the chain.
      for (const m of ['from', 'where', 'orderBy', 'limit']) {
        chain[m] = vi.fn(passthrough);
      }
      // First select is the freshness probe; second is the main read.
      chain['then'] = (resolveCb: (v: unknown) => unknown): unknown => {
        if (currentCall === 1) {
          return resolveCb(opts.latestObservedAt ? [{ observedAt: opts.latestObservedAt }] : []);
        }
        return resolveCb(opts.finalRows);
      };
      return chain;
    };

    const db = {
      select: vi.fn(() => buildSelectChain()),
      insert: vi.fn(() => insertChain),
    } as unknown as Db;

    return { db, inserted };
  }

  function buildFakeFetch(body: unknown): typeof fetch {
    const impl = vi.fn(async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    return impl as unknown as typeof fetch;
  }

  const keepaFixture = {
    products: [
      {
        asin: 'B0EXAMPLE0',
        csv: [
          [7964640, 2499, 7972000, 2299, 7980000, 1899],
          null,
        ],
      },
    ],
    tokensLeft: 1180,
  };

  it('fetches Keepa and inserts when the cache is empty', async () => {
    const { db, inserted } = makeRecordingDb({
      latestObservedAt: null,
      finalRows: [
        { observedAt: new Date('2026-04-01T00:00:00Z'), priceCents: 2499, availability: 'in_stock' },
      ],
    });
    const keepa = new KeepaClient({ apiKey: 'k', fetchImpl: buildFakeFetch(keepaFixture) });
    const ctx: McpContext = { db, clientHash: 'test', scopes: [REQUIRED_SCOPE], keepa };

    const result = await handler(inputSchema.parse({ asin: 'B0EXAMPLE0' }), ctx);

    expect(inserted).toHaveLength(1);
    const rows = inserted[0] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(3);
    expect(rows[0]?.['asin']).toBe('B0EXAMPLE0');
    expect(rows[0]?.['source']).toBe('keepa');
    expect(rows[0]?.['productKey']).toBe('B0EXAMPLE0');
    expect(rows[0]?.['currency']).toBe('USD');
    expect(result.series).toHaveLength(1);
  });

  it('skips the Keepa call when the cache is fresh', async () => {
    const freshTimestamp = new Date(Date.now() - 60 * 60 * 1000); // 1h old
    const { db, inserted } = makeRecordingDb({
      latestObservedAt: freshTimestamp,
      finalRows: [
        { observedAt: freshTimestamp, priceCents: 1999, availability: 'in_stock' },
      ],
    });
    const fetchImpl = vi.fn();
    const keepa = new KeepaClient({ apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch });
    const ctx: McpContext = { db, clientHash: 'test', scopes: [REQUIRED_SCOPE], keepa };

    await handler(inputSchema.parse({ asin: 'B0EXAMPLE0' }), ctx);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(inserted).toHaveLength(0);
  });

  it('serves the cache when Keepa fails (no throw)', async () => {
    const staleTimestamp = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const { db, inserted } = makeRecordingDb({
      latestObservedAt: staleTimestamp,
      finalRows: [
        { observedAt: staleTimestamp, priceCents: 1499, availability: 'in_stock' },
      ],
    });
    const failingFetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: 'no tokens left' } }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const keepa = new KeepaClient({
      apiKey: 'k',
      fetchImpl: failingFetch as unknown as typeof fetch,
    });
    const ctx: McpContext = { db, clientHash: 'test', scopes: [REQUIRED_SCOPE], keepa };

    const result = await handler(inputSchema.parse({ asin: 'B0EXAMPLE0' }), ctx);
    expect(failingFetch).toHaveBeenCalledTimes(1);
    expect(inserted).toHaveLength(0);
    expect(result.series).toHaveLength(1);
    expect(result.current).toBe(1499);
  });

  it('skips the refresh entirely when no Keepa client is configured', async () => {
    const { db, inserted } = makeRecordingDb({
      latestObservedAt: null,
      finalRows: [],
    });
    const unconfigured = new KeepaClient({ apiKey: '' });
    const ctx: McpContext = {
      db,
      clientHash: 'test',
      scopes: [REQUIRED_SCOPE],
      keepa: unconfigured,
    };
    const result = await handler(inputSchema.parse({ asin: 'B0EXAMPLE0' }), ctx);
    expect(inserted).toHaveLength(0);
    expect(result.note).toBe('no history');
  });
});
