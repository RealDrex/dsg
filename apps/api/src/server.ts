import { buildApp } from './app';
import { loadConfig } from './config';
import { createDb } from './db/client';
import { runMigrations } from './db/migrate';
import { checkWatches } from './services/alerts';

const cfg = loadConfig();
const db = createDb(cfg.DATABASE_URL);
await runMigrations(db);
const { app, ctx } = await buildApp(cfg, db);

// In single-process deployments the API also runs the alert loop; set
// RUN_WORKER=false when running `npm run worker` as a separate process.
let timer: NodeJS.Timeout | undefined;
if (process.env.RUN_WORKER !== 'false') {
  const tick = () => checkWatches(db, ctx.catalog, (m) => app.log.info(m)).catch((e) => app.log.error(e, 'watch check failed'));
  timer = setInterval(tick, 10 * 60_000);
  setTimeout(tick, 5_000);
}

const shutdown = async () => {
  clearInterval(timer);
  await app.close();
  await db.$client.end();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ port: cfg.PORT, host: cfg.HOST });
app.log.info(`assistant mode: ${ctx.assistant.mode}`);
