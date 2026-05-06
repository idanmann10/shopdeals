import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, closeDb } from './client.ts';
import { log } from '../lib/log.ts';

async function main() {
  log.info('Running database migrations...');
  await migrate(db(), { migrationsFolder: './src/db/migrations' });
  log.info('Migrations complete.');
  await closeDb();
}

main().catch((err) => {
  log.error({ err }, 'Migration failed');
  process.exit(1);
});
