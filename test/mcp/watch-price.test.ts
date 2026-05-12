import { describe, expect, it, vi } from 'vitest';
import { handler, inputSchema } from '../../src/mcp/tools/watch-price.ts';
import type { McpContext } from '../../src/mcp/context.ts';
import type { Db } from '../../src/db/client.ts';

function dbWith(existing: number, insertedId: string | null = 'watch-1'): Db {
  // Two distinct chain returns: the .select() for the per-client count,
  // and the .insert() for the new row.
  let selectCalls = 0;
  const buildSelectChain = (): unknown => {
    selectCalls += 1;
    const chain: Record<string, unknown> = {};
    const passthrough = (): unknown => chain;
    for (const m of ['from', 'where', 'limit']) chain[m] = vi.fn(passthrough);
    chain['then'] = (resolve: (v: unknown) => unknown) =>
      resolve(Array.from({ length: existing }, (_, i) => ({ id: `w-${i}` })));
    return chain;
  };
  const insertChain = {
    values: vi.fn(() => insertChain),
    returning: vi.fn(async () => (insertedId ? [{ id: insertedId }] : [])),
  };
  return {
    select: vi.fn(() => buildSelectChain()),
    insert: vi.fn(() => insertChain),
    _selectCalls: () => selectCalls,
  } as unknown as Db;
}

describe('watch_price', () => {
  it('rejects without deals:read scope', async () => {
    const ctx: McpContext = { db: dbWith(0), clientHash: 't', scopes: [] };
    await expect(
      handler(inputSchema.parse({ query: 'airpods', targetPriceCents: 15000, notifyEmail: 'a@b.co' }), ctx),
    ).rejects.toMatchObject({ code: -32600 });
  });

  it('rejects when neither query nor productUrl is supplied', () => {
    expect(() =>
      inputSchema.parse({ targetPriceCents: 15000, notifyEmail: 'a@b.co' }),
    ).toThrow(/query or productUrl/);
  });

  it('rejects when no notification target is supplied', () => {
    expect(() =>
      inputSchema.parse({ query: 'airpods', targetPriceCents: 15000 }),
    ).toThrow(/notifyEmail or notifyWebhook/);
  });

  it('persists a watch and returns a watchId', async () => {
    const ctx: McpContext = {
      db: dbWith(0, 'watch-xyz'),
      clientHash: 'agent-123',
      scopes: ['deals:read'],
    };
    const result = await handler(
      inputSchema.parse({
        query: 'sony wh-1000xm5',
        targetPriceCents: 24999,
        notifyEmail: 'me@example.com',
      }),
      ctx,
    );
    expect(result.watchId).toBe('watch-xyz');
    expect(result.status).toBe('active');
    expect(result.targetPriceCents).toBe(24999);
    expect(result.query).toBe('sony wh-1000xm5');
  });

  it('rejects when the per-client active-watch cap is exceeded', async () => {
    const ctx: McpContext = {
      db: dbWith(50, 'never'),
      clientHash: 'spam-agent',
      scopes: ['deals:read'],
    };
    await expect(
      handler(
        inputSchema.parse({
          query: 'airpods',
          targetPriceCents: 15000,
          notifyEmail: 'me@example.com',
        }),
        ctx,
      ),
    ).rejects.toMatchObject({ code: -32600, message: expect.stringMatching(/cancel some/) });
  });
});
