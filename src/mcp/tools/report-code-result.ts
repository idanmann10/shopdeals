import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import type { McpContext } from '../context.ts';
import { deals, telemetry } from '../../db/schema.ts';

export const name = 'report_code_result';

export const description =
  'Report whether a deal code worked at checkout. Updates the deal’s rolling 30-day success rate and lastSeenWorkingAt timestamp.';

export const inputSchema = z.object({
  dealId: z.string().uuid(),
  worked: z.boolean(),
  effectiveDiscountCents: z.number().int().nonnegative().optional(),
  cartTotalCents: z.number().int().nonnegative().optional(),
  countryCode: z.string().length(2).optional(),
  notes: z.string().max(2000).optional(),
});

export type ReportCodeResultInput = z.infer<typeof inputSchema>;

export interface ReportCodeResultOutput extends Record<string, unknown> {
  ok: true;
  telemetryId: string;
  dealId: string;
  newSuccessRate?: number;
}

export async function handler(
  input: ReportCodeResultInput,
  ctx: McpContext,
): Promise<ReportCodeResultOutput> {
  // Confirm the deal exists before recording telemetry.
  const existing = await ctx.db
    .select({ id: deals.id })
    .from(deals)
    .where(eq(deals.id, input.dealId))
    .limit(1);

  if (existing.length === 0) {
    throw new McpError(ErrorCode.InvalidParams, `deal not found: ${input.dealId}`);
  }

  const inserted = await ctx.db
    .insert(telemetry)
    .values({
      dealId: input.dealId,
      worked: input.worked,
      effectiveDiscountCents: input.effectiveDiscountCents ?? null,
      cartTotalCents: input.cartTotalCents ?? null,
      countryCode: input.countryCode ?? null,
      clientHash: ctx.clientHash,
      notes: input.notes ?? null,
    })
    .returning({ id: telemetry.id });

  const telemetryRow = inserted[0];
  if (!telemetryRow) {
    throw new McpError(ErrorCode.InternalError, 'failed to record telemetry');
  }

  // Single UPDATE that recomputes the 30d rolling success rate / count
  // from the telemetry table, and conditionally bumps last_seen_working_at.
  const updated = await ctx.db
    .update(deals)
    .set({
      successRate: sql`(
        SELECT avg(case when worked then 1 else 0 end)::real FROM ${telemetry}
        WHERE ${telemetry.dealId} = ${deals.id}
          AND ${telemetry.reportedAt} > now() - interval '30 days'
      )`,
      successSampleCount: sql`(
        SELECT count(*)::int FROM ${telemetry}
        WHERE ${telemetry.dealId} = ${deals.id}
          AND ${telemetry.reportedAt} > now() - interval '30 days'
      )`,
      lastSeenWorkingAt: sql`CASE WHEN ${input.worked} THEN now() ELSE ${deals.lastSeenWorkingAt} END`,
      updatedAt: sql`now()`,
    })
    .where(eq(deals.id, input.dealId))
    .returning({ successRate: deals.successRate });

  const out: ReportCodeResultOutput = {
    ok: true,
    telemetryId: telemetryRow.id.toString(),
    dealId: input.dealId,
  };
  const newRate = updated[0]?.successRate;
  if (newRate != null) out.newSuccessRate = newRate;
  return out;
}
