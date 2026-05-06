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

  // Wrap the INSERT + UPDATE in a single transaction so concurrent reports
  // can't race on the recomputed 30d rolling success_rate. We additionally
  // take a row lock on `deals` (`SELECT ... FOR UPDATE`) so two transactions
  // touching the same deal serialize cleanly instead of producing stale
  // aggregates from interleaved reads.
  const { telemetryId, newSuccessRate } = await ctx.db.transaction(async (tx) => {
    // Acquire a row lock on the target deal — serializes concurrent reports
    // for the same dealId without blocking unrelated rows.
    await tx.execute(sql`SELECT id FROM ${deals} WHERE ${eq(deals.id, input.dealId)} FOR UPDATE`);

    const inserted = await tx
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
    // Because we're inside the transaction (and after the FOR UPDATE row
    // lock above), the SELECT subqueries see our just-inserted telemetry
    // row and any concurrent writer is queued behind us.
    const updated = await tx
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

    return {
      telemetryId: telemetryRow.id,
      newSuccessRate: updated[0]?.successRate ?? null,
    };
  });

  const out: ReportCodeResultOutput = {
    ok: true,
    telemetryId: telemetryId.toString(),
    dealId: input.dealId,
  };
  if (newSuccessRate != null) out.newSuccessRate = newSuccessRate;
  return out;
}
