/**
 * `npm run eval` — in-process latency + coverage benchmark for find_deals.
 *
 * Runs the canned queries in eval/queries.json against the real DB, calling
 * the find_deals handler directly (no HTTP, no MCP transport). Measures:
 *
 *   - per-query latency in ms
 *   - p50 / p95 / p99 across the full run
 *   - coverage: how many queries return at least 1 deal
 *   - empty-result list so we can see where the catalog is thin
 *
 * The eval is in-process by design — we want to measure handler+DB time,
 * not whatever the HTTP round-trip / Hono middleware adds on top. Add
 * ~30-80 ms for the network hop in production.
 *
 * Each query is run `--iterations` times (default 3) and the median per
 * query is kept, so a stray cold-cache hit doesn't poison the percentiles.
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handler as findDealsHandler } from '../src/mcp/tools/find-deals.ts';
import { closeDb, db } from '../src/db/client.ts';
import { createAffiliateRewriter } from '../src/lib/affiliate.ts';
import type { McpContext } from '../src/mcp/context.ts';

interface EvalQuery {
  label: string;
  args: Record<string, unknown>;
}

interface QueryResult {
  label: string;
  /** Median latency over `iterations` runs, in milliseconds. */
  medianMs: number;
  /** Number of deals returned on the last iteration. */
  dealCount: number;
  /** Iteration timings in ms. */
  timings: number[];
  /** Last error message if any iteration failed; otherwise undefined. */
  error?: string;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx] ?? 0;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? 0);
}

function fmt(ms: number): string {
  return `${ms.toFixed(1).padStart(7)} ms`;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const iterFlag = args.find((a) => a.startsWith('--iterations='));
  const iterations = iterFlag ? Math.max(1, Number(iterFlag.split('=')[1] ?? '3')) : 3;

  const here = dirname(fileURLToPath(import.meta.url));
  const queries: EvalQuery[] = JSON.parse(
    await readFile(resolve(here, 'queries.json'), 'utf8'),
  ) as EvalQuery[];

  const ctx: McpContext = {
    db: db(),
    clientHash: 'eval',
    scopes: ['deals:read', 'prices:read'],
    affiliate: createAffiliateRewriter(),
  };

  const results: QueryResult[] = [];
  console.log(`\nshopdeals eval — ${queries.length} queries × ${iterations} iter\n`);

  for (const q of queries) {
    const timings: number[] = [];
    let dealCount = 0;
    let error: string | undefined;
    for (let i = 0; i < iterations; i += 1) {
      const t0 = performance.now();
      try {
        const res = await findDealsHandler(q.args as Parameters<typeof findDealsHandler>[0], ctx);
        const elapsed = performance.now() - t0;
        timings.push(elapsed);
        dealCount = res.deals.length;
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
        timings.push(performance.now() - t0);
      }
    }
    const med = median(timings);
    results.push({
      label: q.label,
      medianMs: med,
      dealCount,
      timings,
      ...(error !== undefined ? { error } : {}),
    });
    const tag = error ? 'ERR' : dealCount === 0 ? 'EMPTY' : `${dealCount} deals`;
    console.log(`  ${fmt(med)}  ${q.label.padEnd(22)} ${tag}`);
  }

  await closeDb();

  // Summary stats.
  const allTimings = results.flatMap((r) => r.timings).sort((a, b) => a - b);
  const p50 = percentile(allTimings, 50);
  const p95 = percentile(allTimings, 95);
  const p99 = percentile(allTimings, 99);
  const withResults = results.filter((r) => r.dealCount > 0 && !r.error).length;
  const errored = results.filter((r) => r.error).length;

  console.log('\nlatency:');
  console.log(`  p50  ${fmt(p50)}`);
  console.log(`  p95  ${fmt(p95)}`);
  console.log(`  p99  ${fmt(p99)}`);
  console.log('\ncoverage:');
  console.log(`  ${withResults}/${results.length} queries returned >=1 deal`);
  if (errored > 0) console.log(`  ${errored} queries errored`);

  const empty = results.filter((r) => r.dealCount === 0 && !r.error).map((r) => r.label);
  if (empty.length > 0) {
    console.log('\nempty-result queries:');
    for (const label of empty) console.log(`  - ${label}`);
  }

  console.log('');
  // Return nonzero only if something errored — empty results are diagnostic,
  // not failures.
  return errored > 0 ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('eval crashed:', err instanceof Error ? err.stack : err);
    process.exit(1);
  });
