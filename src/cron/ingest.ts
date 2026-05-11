/**
 * Cron / CLI entrypoint for the source-adapter ingest pipeline.
 *
 * Usage:
 *   tsx src/cron/ingest.ts            # all configured adapters
 *   tsx src/cron/ingest.ts fmtc       # one adapter
 *   tsx src/cron/ingest.ts all        # all configured adapters (explicit)
 *
 * The process exits 0 on success; 1 if any adapter run fails. Adapters that
 * aren't configured (missing API keys) are skipped with a log line — this is
 * not an error.
 */
import { closeDb, db } from '../db/client.ts';
import { log } from '../lib/log.ts';
import type { SourceAdapter } from '../sources/common.ts';
import { getAdapter, getAllAdapters } from '../sources/index.ts';
import { upsertDeals } from '../sources/upsert.ts';
import { runLifecyclePass } from './lifecycle.ts';

const KNOWN = new Set(['fmtc', 'awin', 'impact', 'all']);

function pickAdapters(arg: string | undefined): SourceAdapter[] {
  const target = (arg ?? 'all').toLowerCase();
  if (!KNOWN.has(target)) {
    log.error({ arg }, `unknown ingest target; expected one of: ${[...KNOWN].join(', ')}`);
    process.exit(1);
  }
  if (target === 'all') return getAllAdapters();
  const a = getAdapter(target);
  return a ? [a] : [];
}

export async function runIngest(arg: string | undefined): Promise<number> {
  const adapters = pickAdapters(arg);
  if (adapters.length === 0) {
    log.warn({ arg }, 'no adapters resolved; nothing to do');
    return 0;
  }

  let failures = 0;

  for (const adapter of adapters) {
    if (!adapter.isConfigured()) {
      log.info({ network: adapter.network }, 'adapter not configured; skipping');
      continue;
    }

    try {
      const start = Date.now();
      const result = await upsertDeals(adapter);
      log.info(
        {
          network: adapter.network,
          dealsUpserted: result.dealsUpserted,
          merchantsUpserted: result.merchantsUpserted,
          durationMs: Date.now() - start,
        },
        'adapter ingest finished'
      );
    } catch (err) {
      failures += 1;
      log.error(
        {
          network: adapter.network,
          err: err instanceof Error ? err.message : String(err),
        },
        'adapter ingest failed'
      );
    }
  }

  // Lifecycle sweep runs even if some adapters failed — expiring/stale
  // cleanup is independent of any single source's success and should keep
  // happening on the cron interval.
  try {
    await runLifecyclePass(db());
  } catch (err) {
    log.error(
      { err: err instanceof Error ? err.message : String(err) },
      'lifecycle sweep failed',
    );
    failures += 1;
  }

  return failures > 0 ? 1 : 0;
}

// Run when invoked as a script (tsx / node). The check works for both ESM
// entrypoints and re-imports from tests (where it must be a no-op).
const isMain = (() => {
  try {
    const argv1 = process.argv[1];
    if (!argv1) return false;
    const here = new URL(import.meta.url).pathname;
    return here.endsWith(argv1) || argv1.endsWith('ingest.ts') || argv1.endsWith('ingest.js');
  } catch {
    return false;
  }
})();

if (isMain) {
  const arg = process.argv[2];
  runIngest(arg)
    .then(async (code) => {
      await closeDb();
      process.exit(code);
    })
    .catch(async (err) => {
      log.error({ err: err instanceof Error ? err.message : String(err) }, 'ingest crashed');
      await closeDb();
      process.exit(1);
    });
}
