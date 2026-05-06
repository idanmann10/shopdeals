/**
 * Production entrypoint. Constructs the Hono app via `buildApp()` and listens.
 *
 * Tests should import `buildApp` from `./server.ts` directly and pass an
 * in-memory `resolveContext` so they don't need real env/DB.
 */

import { serve } from '@hono/node-server';
import { buildApp } from './server.ts';
import { env } from './lib/env.ts';
import { log } from './lib/log.ts';

export const app = buildApp();

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = env().PORT;
  serve({ fetch: app.fetch, port });
  log.info({ port, env: env().NODE_ENV }, 'snap-ai listening');
}
