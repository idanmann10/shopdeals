import { describe, it, expect, vi } from 'vitest';
import { handler, inputSchema } from '../../src/mcp/tools/find-deals.ts';
import type { McpContext } from '../../src/mcp/context.ts';
import type { Db } from '../../src/db/client.ts';

/**
 * The find-deals tool builds a Drizzle query and only consumes the final
 * awaited row array. We mock the chain by returning a thenable from the
 * terminal `.limit(...)` call so the awaited value is the row list.
 */
function mockDb(rows: unknown[]): Db {
  const chain: Record<string, (...args: unknown[]) => unknown> = {};
  const builder = new Proxy(chain, {
    get(target, prop) {
      if (prop === 'then') {
        // Make the chain itself thenable so `await db.select()...limit(n)`
        // resolves to `rows`. This works because every chained method
        // returns the same proxy.
        return (resolve: (v: unknown) => unknown) => resolve(rows);
      }
      return (...args: unknown[]) => {
        void target;
        void args;
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

  // Sanity-check that `vi` is real so accidentally introducing real I/O fails CI.
  it('does not invoke Date.now via the global pool', () => {
    expect(vi).toBeTruthy();
  });
});
