import { and, eq, isNull } from 'drizzle-orm';
import { siteDomain } from '@bestprice/core';
import type { DB } from '../db/client';
import { products, stores } from '../db/schema';
import type { LogoService } from '../lib/logo';
import type { MediaService } from './media';

/**
 * Runs once after the server starts: fetches every directory store's logo
 * and looks up photos for products that have none, so the apps show real
 * logos and photos from the first screen. Slow and polite on purpose
 * (a few requests at a time); failures are simply retried next start.
 */
export async function warmUp(db: DB, logos: LogoService, media: MediaService, log: (m: string) => void) {
  const storeRows = await db.select().from(stores).where(and(eq(stores.active, true), eq(stores.known, true)));
  let logosFound = 0;
  for (const s of storeRows) {
    const d = siteDomain(s.allowedDomains[0]) ?? siteDomain(s.website);
    if (d && (await logos.get(d))) logosFound++;
  }
  const missing = await db.select({ id: products.id }).from(products).where(and(eq(products.status, 'active'), isNull(products.imageUrl))).limit(300);
  let photos = 0;
  const queue = [...missing];
  await Promise.all(Array.from({ length: 3 }, async () => {
    for (let p = queue.shift(); p; p = queue.shift()) if (await media.ensureImage(p.id)) photos++;
  }));
  log(`warm-up: ${logosFound}/${storeRows.length} store logos, ${photos}/${missing.length} product photos found`);
}
