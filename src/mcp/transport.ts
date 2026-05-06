import type { Hono } from 'hono';
import type { Context } from 'hono';
import type { HttpBindings } from '@hono/node-server';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildMcpServer } from './server.ts';
import type { McpContext } from './context.ts';
import { log } from '../lib/log.ts';

export interface MountMcpOptions {
  path?: string;
  /**
   * Resolves the per-request McpContext. If it returns a `Response`, the
   * transport short-circuits and returns it unchanged (used by auth
   * middleware to issue 401s without ever reaching the MCP layer).
   */
  resolveContext: (c: Context) => Promise<McpContext | Response>;
}

type HonoBindings = { Bindings: HttpBindings };

/**
 * Mount the MCP Streamable HTTP transport at `opts.path` (default `/mcp`).
 *
 * Each request constructs a fresh Server + stateless transport bound to the
 * resolved context. We rely on `@hono/node-server`'s `HttpBindings` to access
 * the underlying Node `IncomingMessage`/`ServerResponse` because the SDK's
 * Node transport requires them. For environments without those bindings
 * (e.g., tests using app.fetch directly), the transport throws — the test
 * suite uses `InMemoryTransport` instead.
 */
export function mountMcp(app: Hono, opts: MountMcpOptions): void {
  const path = opts.path ?? '/mcp';

  const handle = async (c: Context<HonoBindings>): Promise<Response> => {
    const resolved = await opts.resolveContext(c);
    if (resolved instanceof Response) return resolved;

    const env = c.env;
    const incoming = env.incoming;
    const outgoing = env.outgoing;
    if (!incoming || !outgoing) {
      return c.json(
        { error: 'mcp transport requires @hono/node-server bindings' },
        500,
      );
    }

    // Stateless mode: omit `sessionIdGenerator` entirely (the SDK treats
    // an absent generator as stateless). The auth middleware does tenant
    // scoping; resumability isn't needed for our short tool calls.
    const transport = new StreamableHTTPServerTransport({});
    const server = buildMcpServer(resolved);

    try {
      // The SDK's StreamableHTTPServerTransport type widens its callback
      // setters with `| undefined` whereas the Transport interface declares
      // optional-without-undefined. Under exactOptionalPropertyTypes those
      // are incompatible at the public boundary, so we relax the cast here.
      await server.connect(transport as unknown as Parameters<typeof server.connect>[0]);

      // For POSTs with a JSON body Hono has already (potentially) read it.
      // The SDK supports a pre-parsed body via `parsedBody`. We pass undefined
      // and let the SDK read directly from the IncomingMessage.
      let parsedBody: unknown;
      if (c.req.method === 'POST') {
        const contentType = c.req.header('content-type') ?? '';
        if (contentType.includes('application/json')) {
          try {
            parsedBody = await c.req.json();
          } catch {
            parsedBody = undefined;
          }
        }
      }

      await transport.handleRequest(incoming, outgoing, parsedBody);
    } catch (err) {
      log.error(
        { err: err instanceof Error ? { message: err.message, stack: err.stack } : err },
        'mcp.transport.error',
      );
      if (!outgoing.headersSent) {
        outgoing.statusCode = 500;
        outgoing.setHeader('content-type', 'application/json');
        outgoing.end(JSON.stringify({ error: 'mcp transport error' }));
      }
    } finally {
      // Best-effort cleanup; the transport is request-scoped.
      try {
        await server.close();
      } catch {
        /* swallow */
      }
    }

    // We've written directly to `outgoing`. Return Hono's marker response so
    // it doesn't try to send anything else.
    return new Response(null);
  };

  app.all(path, handle as never);
}
