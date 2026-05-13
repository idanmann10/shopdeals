import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
} from '@modelcontextprotocol/sdk/types.js';
import { ZodError } from 'zod';
import { log } from '../lib/log.ts';
import type { McpContext } from './context.ts';
import { tools, toolByName } from './tools/index.ts';
import { structured } from './structured.ts';
import { toToolInputSchema } from './zod-to-json.ts';

export type { McpContext } from './context.ts';

const SERVER_INFO = {
  name: 'shopdeals',
  version: '0.1.0',
} as const;

/**
 * Build a fresh MCP `Server` instance bound to the given per-request context.
 *
 * One Server per request — the context (db, clientHash, scopes) is captured in
 * the handler closures so tools never need a mutable global. This also keeps
 * the StreamableHTTP transport stateless-friendly.
 */
export function buildMcpServer(ctx: McpContext): Server {
  const server = new Server(SERVER_INFO, {
    capabilities: {
      tools: { listChanged: false },
    },
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: toToolInputSchema(t.inputSchema),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: rawArgs } = request.params;
    const tool = toolByName[name];
    if (!tool) {
      throw new McpError(ErrorCode.MethodNotFound, `unknown tool: ${name}`);
    }

    let parsed: unknown;
    try {
      parsed = tool.inputSchema.parse(rawArgs ?? {});
    } catch (err) {
      if (err instanceof ZodError) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `invalid arguments for ${name}: ${err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
        );
      }
      throw err;
    }

    const startedAt = Date.now();
    try {
      const result = await tool.handler(parsed as never, ctx);
      log.info(
        { tool: name, clientHash: ctx.clientHash, durationMs: Date.now() - startedAt },
        'mcp.tool.ok',
      );
      return structured(result);
    } catch (err) {
      log.warn(
        {
          tool: name,
          clientHash: ctx.clientHash,
          durationMs: Date.now() - startedAt,
          err: err instanceof Error ? { message: err.message, name: err.name } : err,
        },
        'mcp.tool.err',
      );
      if (err instanceof McpError) throw err;
      throw new McpError(
        ErrorCode.InternalError,
        err instanceof Error ? err.message : 'tool handler failed',
      );
    }
  });

  return server;
}
