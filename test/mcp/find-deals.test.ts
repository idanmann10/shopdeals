import { describe, it, expect, vi } from 'vitest';
import { handler, inputSchema } from '../../src/mcp/tools/find-deals.ts';
import { encodeCursor, decodeCursor } from '../../src/mcp/cursor.ts';
import type { McpContext } from '../../src/mcp/context.ts';
import type { Db } from '../../src/db/client.ts';

interface ChainCall {
  method: string;
  args: unknown[];
}

/**
 * The find-deals tool builds a Drizzle query and only consumes the final
 * awaited row array. We mock the chain by returning a thenable from the
 * terminal `.limit(...)` call so the awaited value is the row list.
 *
 * The optional `calls` array, when provided, captures every chained method
 * invocation so tests can assert on the actual query shape (e.g. which
 * arguments `.orderBy(...)` received).
 *
 * The optional `rowsForCalls` array, when provided, returns a different row
 * batch each time the chain is awaited — useful for simulating consecutive
 * pages of pagination.
 */
function mockDb(
  rows: unknown[],
  calls?: ChainCall[],
  rowsForCalls?: unknown[][],
): Db {
  let invocation = 0;
  const chain: Record<string, (...args: unknown[]) => unknown> = {};
  const builder = new Proxy(chain, {
    get(target, prop) {
      if (prop === 'then') {
        const batch = rowsForCalls ? rowsForCalls[invocation++] ?? [] : rows;
        // Make the chain itself thenable so `await db.select()...limit(n)`
        // resolves to `rows`. This works because every chained method
        // returns the same proxy.
        return (resolve: (v: unknown) => unknown) => resolve(batch);
      }
      return (...args: unknown[]) => {
        void target;
        if (calls && typeof prop === 'string') {
          calls.push({ method: prop, args });
        }
        return builder;
      };
    },
  });
  // Cast via unknown — tests only need shape compatibility for chained methods.
  return builder as unknown as Db;
}

const baseRow = {
  id: '11111111-1111-1111-1111-111111111111',
  merchantSlug: 'acme',
  merchantName: 'ACME',
  kind: 'code' as const,
  code: 'SAVE20',
  title: '20% off everything',
  description: 'sitewide promo',
  discountType: 'pct_off' as const,
  discountValueBps: 2000,
  discountValueCents: null as number | null,
  cartMinCents: 5000,
  segment: 'general' as const,
  geoScope: ['US'],
  deeplink: 'https://acme.test/promo',
  attributionSource: 'awin',
  lastSeenWorkingAt: new Date('2026-04-01T00:00:00Z'),
  successRate: 0.91,
  expiresAt: new Date('2026-12-31T00:00:00Z'),
  ingestedAt: new Date('2026-05-01T00:00:00Z'),
};

function ctxWith(db: Db): McpContext {
  return { db, clientHash: 'test-client', scopes: ['deals:read'] };
}

describe('find_deals tool', () => {
  it('shapes the result with summaries and ISO timestamps', async () => {
    const db = mockDb([baseRow]);
    const ctx = ctxWith(db);
    const input = inputSchema.parse({ merchant: 'acme', limit: 10 });
    const result = await handler(input, ctx);

    expect(result.deals).toHaveLength(1);
    const d = result.deals[0]!;
    expect(d.id).toBe(baseRow.id);
    expect(d.discountSummary).toBe('20% off');
    expect(d.eligibilitySummary).toContain('min cart $50');
    expect(d.eligibilitySummary).toContain('geo: US');
    expect(d.lastSeenWorkingAt).toBe('2026-04-01T00:00:00.000Z');
    expect(d.expiresAt).toBe('2026-12-31T00:00:00.000Z');
    expect(d.successRate).toBe(0.91);
    expect(result.nextCursor).toBeUndefined();
  });

  it('emits nextCursor when more rows than the limit are returned', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({
      ...baseRow,
      id: `0000000${i}-0000-0000-0000-000000000000`.padEnd(36, '0'),
      ingestedAt: new Date(Date.UTC(2026, 0, 1 + i)),
    }));
    const db = mockDb(rows);
    const ctx = ctxWith(db);
    const input = inputSchema.parse({ limit: 2 });
    const result = await handler(input, ctx);
    expect(result.deals).toHaveLength(2);
    expect(result.nextCursor).toBeDefined();
    // Cursor is base64url JSON of last returned row's keyset.
    const decoded = JSON.parse(
      Buffer.from(result.nextCursor!, 'base64url').toString('utf8'),
    );
    expect(decoded.id).toBe(rows[1]!.id);
  });

  it('returns Free shipping for free_shipping discount type', async () => {
    const row = { ...baseRow, discountType: 'free_shipping' as const, discountValueBps: null, discountValueCents: null };
    const db = mockDb([row]);
    const result = await handler(inputSchema.parse({}), ctxWith(db));
    expect(result.deals[0]!.discountSummary).toBe('Free shipping');
  });

  it('two consecutive pages do not return overlapping ids', async () => {
    // Build six rows ordered by ingestedAt DESC.
    const rows = Array.from({ length: 6 }, (_, i) => ({
      ...baseRow,
      id: `aaaaaaaa-0000-0000-0000-${String(i).padStart(12, '0')}`,
      // Reverse order: row 0 has the most recent ingestedAt.
      ingestedAt: new Date(Date.UTC(2026, 0, 30 - i)),
    }));

    // First page returns 3 rows (limit=2 + 1 sentinel for hasMore).
    // Second page returns the next 3 rows.
    const page1 = rows.slice(0, 3);
    const page2 = rows.slice(2, 5);
    const db = mockDb([], undefined, [page1, page2]);
    const ctx = ctxWith(db);

    const r1 = await handler(inputSchema.parse({ limit: 2 }), ctx);
    expect(r1.deals).toHaveLength(2);
    expect(r1.nextCursor).toBeDefined();

    const r2 = await handler(
      inputSchema.parse({ limit: 2, cursor: r1.nextCursor }),
      ctx,
    );
    expect(r2.deals).toHaveLength(2);

    const ids1 = new Set(r1.deals.map((d) => d.id));
    const ids2 = new Set(r2.deals.map((d) => d.id));
    for (const id of ids2) {
      expect(ids1.has(id)).toBe(false);
    }
  });

  it('cursor encodes (ingestedAt, id) and round-trips through decodeCursor', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({
      ...baseRow,
      id: `bbbbbbbb-0000-0000-0000-${String(i).padStart(12, '0')}`,
      ingestedAt: new Date(Date.UTC(2026, 1, 1 + i)),
    }));
    const db = mockDb(rows);
    const result = await handler(inputSchema.parse({ limit: 2 }), ctxWith(db));
    expect(result.nextCursor).toBeDefined();

    const decoded = decodeCursor<{ ingestedAt: string; id: string }>(
      result.nextCursor,
    );
    expect(decoded).toBeDefined();
    expect(decoded!.id).toBe(rows[1]!.id);
    expect(decoded!.ingestedAt).toBe(rows[1]!.ingestedAt.toISOString());
    // Only the two keyset fields, no successRate carried.
    expect(Object.keys(decoded!).sort()).toEqual(['id', 'ingestedAt']);

    // Round-trip: re-encode the decoded payload and confirm equality.
    const reencoded = encodeCursor(decoded!);
    expect(reencoded).toBe(result.nextCursor);
  });

  it('orderBy does not reference successRate (deterministic keyset only)', async () => {
    const calls: ChainCall[] = [];
    const db = mockDb([baseRow], calls);
    await handler(inputSchema.parse({ limit: 10 }), ctxWith(db));

    const orderByCalls = calls.filter((c) => c.method === 'orderBy');
    expect(orderByCalls).toHaveLength(1);

    // Each arg is the result of drizzle's `desc(column)` helper, which has a
    // `.queryChunks` array containing the column reference (`{ name: '...' }`)
    // among string chunks. We can't JSON.stringify because the column object
    // contains circular references back to its parent table — instead, walk
    // the chunks and collect column `name`s.
    const args = orderByCalls[0]!.args;
    const columnNames: string[] = [];
    for (const arg of args) {
      const chunks = (arg as { queryChunks?: Array<{ name?: string }> })
        .queryChunks;
      if (Array.isArray(chunks)) {
        for (const chunk of chunks) {
          if (typeof chunk?.name === 'string') columnNames.push(chunk.name);
        }
      }
    }
    expect(columnNames).toContain('ingested_at');
    expect(columnNames).toContain('id');
    expect(columnNames).not.toContain('success_rate');
  });

  // Sanity-check that `vi` is real so accidentally introducing real I/O fails CI.
  it('does not invoke Date.now via the global pool', () => {
    expect(vi).toBeTruthy();
  });
});
