import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env } from '../lib/env.ts';
import * as schema from './schema.ts';

const { Pool } = pg;

let poolInstance: pg.Pool | undefined;
let dbInstance: ReturnType<typeof drizzle<typeof schema>> | undefined;

export function pool(): pg.Pool {
  if (!poolInstance) {
    poolInstance = new Pool({
      connectionString: env().DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
    });
  }
  return poolInstance;
}

export function db() {
  if (!dbInstance) {
    dbInstance = drizzle(pool(), { schema });
  }
  return dbInstance;
}

export async function closeDb(): Promise<void> {
  if (poolInstance) {
    await poolInstance.end();
    poolInstance = undefined;
    dbInstance = undefined;
  }
}

export type Db = ReturnType<typeof db>;
export { schema };
