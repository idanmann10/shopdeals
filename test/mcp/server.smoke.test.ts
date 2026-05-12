import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildMcpServer } from '../../src/mcp/server.ts';
import type { McpContext } from '../../src/mcp/context.ts';
import type { Db } from '../../src/db/client.ts';

/**
 * In-memory Drizzle stand-in. Each tool gets a tailored canned response keyed
 * off the *first* method name in the chain. We only need enough surface to
 * make the contract test green; the per-tool behavioural tests cover the
 * row-shaping logic in detail.
 */
function makeMockDb(): Db {
  // Universal chainable proxy that resolves to `[]` when awaited and supports
  // `.returning()` / terminal awaits anywhere in the chain.
  const makeProxy = (terminalValue: unknown[]): unknown => {
    const target = {};
    return new Proxy(target, {
      get(_t, prop) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => unknown) => resolve(terminalValue);
        }
        return () => makeProxy(terminalValue);
      },
    });
  };

  // Default to empty arrays — find_deals / list_merchants / get_price_history
  // all gracefully return empty result lists. get_deal will 404 and
  // report_code_result will 404 (deal not found), but those error paths are
  // covered by the dedicated tests; the smoke test just needs `tools/call` to
  // round-trip without crashing the protocol layer.
  const universal = makeProxy([]);
  return universal as Db;
}

function ctxWith(scopes: string[]): McpContext {
  return {
    db: makeMockDb(),
    clientHash: 'smoke-client',
    scopes,
  };
}

async function bootClientServer(ctx: McpContext) {
  const server = buildMcpServer(ctx);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'smoke', version: '0.0.0' }, { capabilities: {} });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client, server };
}

describe('MCP server smoke test', () => {
  it('lists exactly the declared tools with non-empty descriptions', async () => {
    const { client, server } = await bootClientServer(ctxWith(['deals:read', 'prices:read']));
    const list = await client.listTools();
    const names = list.tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'find_best_deal',
        'find_deals',
        'find_products',
        'get_code_for_url',
        'get_deal',
        'get_price_history',
        'list_merchants',
        'redeem_link',
        'report_code_result',
      ].sort(),
    );
    for (const t of list.tools) {
      expect(t.description?.length).toBeGreaterThan(0);
      expect(t.description!.length).toBeLessThanOrEqual(200);
      expect(t.inputSchema.type).toBe('object');
    }
    await client.close();
    await server.close();
  });

  it('calls find_deals and returns structured + text content', async () => {
    const { client, server } = await bootClientServer(ctxWith(['deals:read']));
    const res = await client.callTool({
      name: 'find_deals',
      arguments: { limit: 5 },
    });
    expect(Array.isArray(res.content)).toBe(true);
    expect(res.structuredContent).toBeDefined();
    const sc = res.structuredContent as { deals: unknown[] };
    expect(Array.isArray(sc.deals)).toBe(true);
    await client.close();
    await server.close();
  });

  it('calls list_merchants and returns merchants array', async () => {
    const { client, server } = await bootClientServer(ctxWith(['deals:read']));
    const res = await client.callTool({ name: 'list_merchants', arguments: {} });
    const sc = res.structuredContent as { merchants: unknown[] };
    expect(Array.isArray(sc.merchants)).toBe(true);
    await client.close();
    await server.close();
  });

  it('rejects get_price_history without prices:read scope', async () => {
    const { client, server } = await bootClientServer(ctxWith(['deals:read']));
    // Scope errors are surfaced as JSON-RPC errors (McpError) and the SDK
    // re-throws them on the client side. The error code must be
    // `InvalidRequest` (-32600), NOT `ConnectionClosed` (-32000) — the latter
    // is a transport-level signal that would tear down the session.
    await expect(
      client.callTool({
        name: 'get_price_history',
        arguments: { asin: 'B0EXAMPLE0' },
      }),
    ).rejects.toMatchObject({
      code: -32600,
      message: expect.stringMatching(/prices:read/) as unknown as string,
    });
    await client.close();
    await server.close();
  });

  it('returns price history note when scope present and no rows', async () => {
    const { client, server } = await bootClientServer(ctxWith(['prices:read']));
    const res = await client.callTool({
      name: 'get_price_history',
      arguments: { asin: 'B0EXAMPLE0' },
    });
    const sc = res.structuredContent as { series: unknown[]; note?: string };
    expect(sc.series).toEqual([]);
    expect(sc.note).toBe('no history');
    await client.close();
    await server.close();
  });

  it('rejects unknown tool names', async () => {
    const { client, server } = await bootClientServer(ctxWith(['deals:read']));
    await expect(
      client.callTool({ name: 'does_not_exist', arguments: {} }),
    ).rejects.toThrow();
    await client.close();
    await server.close();
  });

  it('rejects invalid arguments via Zod validation', async () => {
    const { client, server } = await bootClientServer(ctxWith(['deals:read']));
    // Bad input -> InvalidParams JSON-RPC error -> client throws.
    await expect(
      client.callTool({
        name: 'find_deals',
        arguments: { limit: 999 },
      }),
    ).rejects.toThrow(/invalid arguments/);
    await client.close();
    await server.close();
  });
});
