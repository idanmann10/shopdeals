/**
 * Vitest global setup. Ensures the env schema in `src/lib/env.ts` validates
 * even when no `.env` is present — tests inject their own credentials per
 * adapter via the `*Adapter` constructor options.
 */
process.env['NODE_ENV'] ??= 'test';
process.env['LOG_LEVEL'] ??= 'fatal';
process.env['DATABASE_URL'] ??= 'postgres://test:test@localhost:5432/snap_ai_test';
