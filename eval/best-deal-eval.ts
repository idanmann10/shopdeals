/**
 * `npm run eval:best` — quality + latency benchmark for `find_best_deal`.
 *
 * Runs the canned queries in `eval/queries-best.json` against the real
 * production stack (SerpApi + DB + Keepa) by calling the handler directly
 * (no HTTP, no MCP transport — same pattern as the find_deals eval).
 *
 * Reports per-query:
 *   - latency in ms
 *   - whether a best buy was returned
 *   - whether the buy link is affiliate-tagged
 *   - whether a coupon code was attached
 *   - whether a Keepa price signal fired (Amazon-only)
 *   - the merchant and effective total of the best pick
 *
 * Aggregate stats:
 *   - latency p50/p95/p99
 *   - coverage % (queries returning a best pick)
 *   - monetization % (queries where the best buyLink is affiliate-tagged)
 *   - code-match % (queries where the best pick had a code attached)
 *   - SerpApi credits consumed
 *
 * SerpApi cost: up to ~4 credits per query (1 search + up to 3 immersive).
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handler as findBestDeal } from '../src/mcp/tools/find-best-deal.ts';
import type {
  BestDealOption,
  FindBestDealResult,
} from '../src/mcp/tools/find-best-deal.ts';
import { closeDb, db } from '../src/db/client.ts';
import { createAffiliateRewriter } from '../src/lib/affiliate.ts';
import { SerpApiClient } from '../src/lib/serpapi.ts';
import { KeepaClient } from '../src/sources/keepa.ts';
import type { McpContext } from '../src/mcp/context.ts';

interface EvalQuery {
  label: string;
  query: string;
  country?: string;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx] ?? 0;
}

function fmtCents(c: number | undefined): string {
  return c === undefined ? '   ?  ' : ('$' + (c / 100).toFixed(2)).padStart(8);
}

function fmtMs(ms: number): string {
  return `${ms.toFixed(0).padStart(5)} ms`;
}

function isAffiliateTagged(url: string | undefined): boolean {
  if (!url) return false;
  return /tag=shopdeals|skimresources\.com|goto\.skimresources|impactlinks|awinmid/i.test(url);
}

async function main(): Promise<number> {
  const here = dirname(fileURLToPath(import.meta.url));
  const queries: EvalQuery[] = JSON.parse(
    await readFile(resolve(here, 'queries-best.json'), 'utf8'),
  ) as EvalQuery[];

  const ctx: McpContext = {
    db: db(),
    clientHash: 'eval',
    scopes: ['deals:read', 'prices:read'],
    affiliate: createAffiliateRewriter(),
    serpapi: new SerpApiClient(),
    keepa: new KeepaClient(),
  };

  if (!ctx.serpapi?.isConfigured()) {
    console.error('SERPAPI_KEY not set — cannot run live eval');
    await closeDb();
    return 1;
  }

  console.log(`\nfind_best_deal eval — ${queries.length} queries\n`);
  console.log(
    'lat'.padStart(8) +
      '  ' +
      'label'.padEnd(20) +
      ' best-merchant'.padEnd(28) +
      ' total'.padEnd(10) +
      ' eff'.padEnd(10) +
      ' code'.padEnd(8) +
      ' signal'.padEnd(16) +
      ' aff?',
  );
  console.log('-'.repeat(110));

  const results: Array<{
    label: string;
    durationMs: number;
    payload: FindBestDealResult;
  }> = [];

  for (const q of queries) {
    const t0 = performance.now();
    let payload: FindBestDealResult;
    try {
      payload = await findBestDeal({ query: q.query, alternatives: 3 }, ctx);
    } catch (err) {
      console.log(
        '  ERR'.padStart(8) +
          '  ' +
          q.label.padEnd(20) +
          ' ' +
          (err instanceof Error ? err.message : String(err)).slice(0, 60),
      );
      results.push({
        label: q.label,
        durationMs: performance.now() - t0,
        payload: { query: q.query, alternatives: [], meta: { serpapiCalls: 0, keepaCalls: 0, couponsMatched: 0, durationMs: 0 } } as FindBestDealResult,
      });
      continue;
    }
    const durationMs = performance.now() - t0;
    results.push({ label: q.label, durationMs, payload });

    const best: BestDealOption | undefined = payload.best;
    const code = best?.codes?.[0]?.code ?? '';
    const signal = best?.priceSignal ?? '';
    const aff = isAffiliateTagged(best?.buyLink) ? '✓' : '—';

    console.log(
      fmtMs(durationMs) +
        '  ' +
        q.label.padEnd(20) +
        ' ' +
        (best?.merchant ?? '(none)').slice(0, 26).padEnd(27) +
        fmtCents(best?.totalCents) +
        ' ' +
        fmtCents(best?.effectiveTotalCents) +
        ' ' +
        code.padEnd(7) +
        ' ' +
        signal.padEnd(15) +
        ' ' +
        aff,
    );
  }

  await closeDb();

  // Aggregate stats.
  const latencies = results.map((r) => r.durationMs).sort((a, b) => a - b);
  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);
  const p99 = percentile(latencies, 99);
  const withBest = results.filter((r) => r.payload.best).length;
  const withAffiliate = results.filter((r) => isAffiliateTagged(r.payload.best?.buyLink)).length;
  const withCode = results.filter((r) => r.payload.best?.codes?.length).length;
  const withSignal = results.filter((r) => r.payload.best?.priceSignal).length;
  const totalCredits = results.reduce((s, r) => s + r.payload.meta.serpapiCalls, 0);

  console.log('\n--- latency ---');
  console.log(`  p50  ${fmtMs(p50)}`);
  console.log(`  p95  ${fmtMs(p95)}`);
  console.log(`  p99  ${fmtMs(p99)}`);
  console.log('\n--- coverage ---');
  console.log(`  best returned        ${withBest}/${results.length}`);
  console.log(`  affiliate-tagged     ${withAffiliate}/${results.length}`);
  console.log(`  coupon code attached ${withCode}/${results.length}`);
  console.log(`  Keepa price signal   ${withSignal}/${results.length}`);
  console.log('\n--- cost ---');
  console.log(`  SerpApi credits used ${totalCredits} (~$${(totalCredits * 0.025).toFixed(2)} on Starter)`);
  console.log('');

  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('eval crashed:', err instanceof Error ? err.stack : err);
    process.exit(1);
  });
