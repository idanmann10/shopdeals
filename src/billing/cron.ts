/**
 * CLI entrypoint that flushes pending api_usage rows to Stripe meter events.
 *
 * Usage:
 *   npx tsx src/billing/cron.ts
 *
 * Intended to run on a Fly.io scheduled machine every minute. Always exits with
 * code 0 on success or 1 on failure so the scheduler reports correctly.
 */

import { closeDb } from '../db/client.ts';
import { log } from '../lib/log.ts';
import { reportPendingUsage } from './stripe.ts';

async function main(): Promise<void> {
  const start = Date.now();
  try {
    const result = await reportPendingUsage();
    log.info({ reported: result.reported, ms: Date.now() - start }, 'usage flush done');
  } finally {
    await closeDb().catch(() => {
      /* ignore close errors */
    });
  }
}

main().catch((err) => {
  log.error({ err }, 'usage flush failed');
  process.exitCode = 1;
});
