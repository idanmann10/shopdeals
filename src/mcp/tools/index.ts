/**
 * Barrel of MCP tool modules. Each tool exports `name`, `description`,
 * `inputSchema` (Zod) and `handler(input, ctx) => Promise<output>`.
 *
 * Tools are pure with respect to anything outside of `ctx` — no global `db()`
 * calls inside handlers. Logging + auth gating live in the server wrapper.
 */

import * as findDeals from './find-deals.ts';
import * as findProducts from './find-products.ts';
import * as getDeal from './get-deal.ts';
import * as listMerchants from './list-merchants.ts';
import * as getPriceHistory from './get-price-history.ts';
import * as reportCodeResult from './report-code-result.ts';
import type { z } from 'zod';
import type { McpContext } from '../context.ts';

export interface ToolModule<I = unknown, O extends Record<string, unknown> = Record<string, unknown>> {
  name: string;
  description: string;
  inputSchema: z.ZodType<I>;
  handler: (input: I, ctx: McpContext) => Promise<O>;
}

// We intentionally type the registry as `ToolModule[]` of unknown I/O so the
// dispatcher in `server.ts` can iterate uniformly. The individual modules
// remain strongly typed for direct consumers and tests.
export const tools: ReadonlyArray<ToolModule<never, Record<string, unknown>>> = [
  findDeals as unknown as ToolModule<never, Record<string, unknown>>,
  findProducts as unknown as ToolModule<never, Record<string, unknown>>,
  getDeal as unknown as ToolModule<never, Record<string, unknown>>,
  listMerchants as unknown as ToolModule<never, Record<string, unknown>>,
  getPriceHistory as unknown as ToolModule<never, Record<string, unknown>>,
  reportCodeResult as unknown as ToolModule<never, Record<string, unknown>>,
];

export const toolByName: Readonly<Record<string, ToolModule<never, Record<string, unknown>>>> =
  Object.fromEntries(tools.map((t) => [t.name, t]));

export { findDeals, findProducts, getDeal, listMerchants, getPriceHistory, reportCodeResult };
