/**
 * `npm run eval:prod` — runs the same 15-query best-deal benchmark
 * against the production HTTP endpoint instead of in-process handlers.
 *
 * Measures total round-trip latency including TLS, HTTP, MCP framing,
 * and server-side processing — i.e., what an actual MCP client (Claude
 * Desktop, ChatGPT Connectors) experiences.
 *
 * The script speaks the MCP JSON-RPC protocol directly with
 * `tools/call`, then strips the SSE envelope SerpApi-style.
 *
 * Override the endpoint with `--url=https://...` (default: prod).
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_URL = 'https://mcp.shopdeals.sh/mcp';

interface EvalQuery {
  label: string;
  query: string;
}

interface BestDealResult {
  best?: {
    merchant: string;
    totalCents?: number;
    effectiveTotalCents?: number;
    buyLink: string;
    codes?: Array<{ code?: string }>;
    priceSignal?: string;
  };
  alternatives?: unknown[];
  meta: { serpapiCalls: number; couponsMatched: number; keepaCalls: number; durationMs: number };
  note?: string;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx] ?? 0;
}

function fmtMs(ms: number): string { return `${ms.toFixed(0).padStart(5)} ms`; }
function fmtCents(c?: number): string { return c === undefined ? '   ?  ' : ('$' + (c / 100).toFixed(2)).padStart(8); }
function isAffiliateTagged(url?: string): boolean {
  return !!url && (/tag=shopdeals|skimresources\.com/i.test(url));
}

async function callTool(endpoint: string, name: string, args: Record<string, unknown>): Promise<{ result?: BestDealResult; error?: string; httpStatus: number; ms: number }> {
  const t0 = performance.now();
  let httpStatus = 0;
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
      signal: AbortSignal.timeout(45_000),
    });
    httpStatus = res.status;
    const text = await res.text();
    const ms = performance.now() - t0;
    // SSE-framed body: pluck the first `data: {...}` line.
    const m = text.match(/data:\s*(\{[\s\S]*?\})\s*(?:\n|$)/);
    if (!m) return { error: `no data line in body: ${text.slice(0,120)}`, httpStatus, ms };
    const body = JSON.parse(m[1] ?? '{}') as { result?: { structuredContent?: BestDealResult }; error?: { message: string } };
    if (body.error) return { error: body.error.message, httpStatus, ms };
    return { result: body.result?.structuredContent, httpStatus, ms };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err),
      httpStatus,
      ms: performance.now() - t0,
    };
  }
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const urlFlag = args.find((a) => a.startsWith('--url='));
  const endpoint = urlFlag ? urlFlag.split('=')[1] ?? DEFAULT_URL : DEFAULT_URL;
  const here = dirname(fileURLToPath(import.meta.url));
  const queries: EvalQuery[] = JSON.parse(await readFile(resolve(here, 'queries-best.json'), 'utf8')) as EvalQuery[];

  console.log(`\nfind_best_deal eval — PRODUCTION HTTP\n  endpoint: ${endpoint}\n  ${queries.length} queries\n`);
  console.log(
    'lat'.padStart(8) + '  ' + 'label'.padEnd(20) + ' best-merchant'.padEnd(28) +
    ' total'.padEnd(10) + ' eff'.padEnd(10) + ' code'.padEnd(8) + ' aff?',
  );
  console.log('-'.repeat(95));

  const results: Array<{ label: string; ms: number; ok: boolean; r?: BestDealResult; error?: string }> = [];
  for (const q of queries) {
    const out = await callTool(endpoint, 'find_best_deal', { query: q.query, alternatives: 3 });
    if (out.error) {
      console.log(fmtMs(out.ms) + '  ' + q.label.padEnd(20) + ' ERR ' + out.error.slice(0, 60));
      results.push({ label: q.label, ms: out.ms, ok: false, ...(out.error !== undefined ? { error: out.error } : {}) });
      continue;
    }
    const r = out.result;
    const best = r?.best;
    const code = best?.codes?.[0]?.code ?? '';
    const aff = isAffiliateTagged(best?.buyLink) ? '✓' : '—';
    console.log(
      fmtMs(out.ms) + '  ' + q.label.padEnd(20) + ' ' +
      (best?.merchant ?? '(none)').slice(0, 26).padEnd(27) +
      fmtCents(best?.totalCents) + ' ' + fmtCents(best?.effectiveTotalCents) + ' ' +
      code.padEnd(7) + ' ' + aff,
    );
    const next: { label: string; ms: number; ok: boolean; r?: BestDealResult; error?: string } = {
      label: q.label,
      ms: out.ms,
      ok: true,
    };
    if (r !== undefined) next.r = r;
    results.push(next);
  }

  const okResults = results.filter((r) => r.ok);
  const latencies = results.map((r) => r.ms).sort((a, b) => a - b);
  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);
  const p99 = percentile(latencies, 99);
  const withBest = okResults.filter((r) => r.r?.best).length;
  const withAff = okResults.filter((r) => isAffiliateTagged(r.r?.best?.buyLink)).length;
  const withCode = okResults.filter((r) => r.r?.best?.codes?.length).length;
  const errored = results.filter((r) => !r.ok).length;
  console.log('\n--- latency (full HTTP round trip) ---');
  console.log(`  p50  ${fmtMs(p50)}`);
  console.log(`  p95  ${fmtMs(p95)}`);
  console.log(`  p99  ${fmtMs(p99)}`);
  console.log('\n--- coverage ---');
  console.log(`  successful responses ${okResults.length}/${results.length}`);
  console.log(`  best returned        ${withBest}/${results.length}`);
  console.log(`  affiliate-tagged     ${withAff}/${results.length}`);
  console.log(`  coupon code attached ${withCode}/${results.length}`);
  if (errored) console.log(`  errored              ${errored}/${results.length}`);
  console.log('');
  return errored > 0 ? 1 : 0;
}

main().then((c) => process.exit(c)).catch((err) => { console.error(err); process.exit(1); });
