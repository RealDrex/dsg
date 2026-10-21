import { buildApp } from './app';
import { loadConfig } from './config';
import { createDb } from './db/client';
import { checkWatches } from './services/alerts';

/** Standalone price monitor + alerts worker for deployments that scale the API horizontally (RUN_WORKER=false there). */
const cfg = loadConfig();
const db = createDb(cfg.DATABASE_URL);
const { ctx } = await buildApp(cfg, db);
const log = (m: string) => console.log(new Date().toISOString(), m);
const tick = async () => {
  await ctx.monitor.tick(log).catch((e) => log(`price monitor failed: ${String(e)}`));
  await checkWatches(db, ctx.catalog, log).catch((e) => log(`watch check failed: ${String(e)}`));
};
await tick();
setInterval(tick, 10 * 60_000);
