import { loadConfig } from './config';
import { createDb } from './db/client';
import { CatalogService } from './services/catalog';
import { checkWatches } from './services/alerts';

/** Standalone alerts worker for deployments that scale the API horizontally. */
const cfg = loadConfig();
const db = createDb(cfg.DATABASE_URL);
const catalog = new CatalogService(db, cfg.PUBLIC_BASE_URL);
const log = (m: string) => console.log(new Date().toISOString(), m);
const tick = () => checkWatches(db, catalog, log).catch((e) => log(`watch check failed: ${String(e)}`));
await tick();
setInterval(tick, 10 * 60_000);
