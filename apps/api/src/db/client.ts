import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

export type DB = NodePgDatabase<typeof schema> & { $client: pg.Pool };

export function createDb(url: string): DB {
  const pool = new pg.Pool({ connectionString: url, max: 10, idleTimeoutMillis: 30_000, statement_timeout: 10_000 });
  return drizzle(pool, { schema }) as DB;
}

export { schema };
