import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, closeDb } from './client.ts';
import { log } from '../lib/log.ts';

// Resolve migrations relative to *this* file so it works in both:
//   - dev:  tsx src/db/migrate.ts  -> ./migrations next to migrate.ts
//   - prod: node dist/db/migrate.js -> ./migrations copied in by the Dockerfile
const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(here, 'migrations');

async function main() {
  log.info({ migrationsFolder }, 'Running database migrations...');
  await migrate(db(), { migrationsFolder });
  log.info('Migrations complete.');
  await closeDb();
}

main().catch((err) => {
  log.error(
    { err: err instanceof Error ? { message: err.message, stack: err.stack } : err },
    'Migration failed',
  );
  process.exit(1);
});
