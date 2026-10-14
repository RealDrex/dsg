import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb, type DB } from './client';

const here = path.dirname(fileURLToPath(import.meta.url));
export async function runMigrations(db: DB) {
  // Works from src/db (tsx) and from dist (bundled): look for the drizzle folder upwards.
  const fs = await import('node:fs');
  const dir = [path.resolve(here, '../../drizzle'), path.resolve(here, '../drizzle')].find((p) => fs.existsSync(path.join(p, 'meta')));
  if (!dir) throw new Error('drizzle migrations folder not found');
  await migrate(db, { migrationsFolder: dir });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const db = createDb(url);
  await runMigrations(db);
  await db.$client.end();
  console.log('migrations applied');
}
