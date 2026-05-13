/**
 * Records API usage on each successful request.
 *
 *   - Inserts an `apiUsage` row after `next()` completes.
 *   - `tool` comes from `c.var.mcpTool` if the MCP transport set it; otherwise the route path.
 *   - `units` comes from `TOOL_UNITS[tool]` (defaults to 1).
 *   - Anonymous-in-dev requests are skipped so we don't pollute usage.
 *   - Non-2xx responses are not recorded — failed requests don't bill the customer.
 *   - DB inserts are best-effort; we never let usage logging break the request.
 */

import type { MiddlewareHandler } from 'hono';
import { db as getDb } from '../db/client.ts';
import { apiUsage, type NewApiUsage } from '../db/schema.ts';
import type { AuthPrincipal } from '../auth/types.ts';
import { env } from '../lib/env.ts';
import { log } from '../lib/log.ts';

/**
 * Per-tool unit weights. Tools not in this map default to 1 unit.
 *
 *   - `report_code_result` is telemetry (free, billed at 0).
 *   - `get_price_history` is more expensive due to upstream Keepa cost.
 */
export const TOOL_UNITS = {
  find_deals: 1,
  get_deal: 1,
  list_merchants: 1,
  get_price_history: 5,
  report_code_result: 0,
} as const;

export type KnownTool = keyof typeof TOOL_UNITS;

export type UnitsResolver = (tool: string, principal: AuthPrincipal) => number;

const defaultUnitsResolver: UnitsResolver = (tool) => {
  if (tool in TOOL_UNITS) {
    return TOOL_UNITS[tool as KnownTool];
  }
  return 1;
};

export interface UsageMiddlewareOptions {
  units?: UnitsResolver;
}

interface UsageVariables {
  principal: AuthPrincipal;
  /** Set by the MCP transport per tool call so usage rows record the tool name. */
  mcpTool?: string;
}

export const usageMiddleware = (
  opts: UsageMiddlewareOptions = {},
): MiddlewareHandler<{ Variables: UsageVariables }> => {
  const resolveUnits = opts.units ?? defaultUnitsResolver;

  return async (c, next) => {
    await next();

    // Only record on success (2xx). Failed requests must not bill.
    const status = c.res.status;
    if (status < 200 || status >= 300) return;

    const principal = c.get('principal') as AuthPrincipal | undefined;
    if (!principal) return;

    // Skip anonymous traffic in non-production.
    if (principal.source === 'anonymous' && env().NODE_ENV !== 'production') return;

    const tool = (c.get('mcpTool') as string | undefined) ?? c.req.path;
    const units = resolveUnits(tool, principal);

    const row: NewApiUsage = {
      clientHash: principal.clientHash,
      tool,
      units,
    };
    if (principal.orgId !== undefined) row.orgId = principal.orgId;
    if (principal.userId !== undefined) row.userId = principal.userId;

    try {
      await getDb().insert(apiUsage).values(row);
    } catch (err) {
      // Never fail the request because of usage logging.
      log.error(
        {
          err,
          tool,
          hashPrefix: principal.clientHash.slice(0, 8),
        },
        'failed to record api usage',
      );
    }
  };
};
