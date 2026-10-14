import { and, eq, inArray, isNull } from 'drizzle-orm';
import { effectivePriceMarket, formatMoney, type Lang } from '@bestprice/core';
import type { DB } from '../db/client';
import { notifications, products, users, watches } from '../db/schema';
import type { CatalogService } from './catalog';

/**
 * Checks every open watch against the current best trusted price and
 * notifies the user once when the target is reached.
 */
export async function checkWatches(db: DB, catalog: CatalogService, log: (msg: string) => void = () => {}) {
  const open = await db
    .select({ w: watches, u: users, p: products })
    .from(watches)
    .innerJoin(users, eq(users.id, watches.userId))
    .innerJoin(products, eq(products.id, watches.productId))
    .where(isNull(watches.hitAt));
  if (open.length === 0) return 0;

  const byMarket = new Map<string, string[]>();
  for (const r of open) {
    const m = effectivePriceMarket(r.u.country).code;
    byMarket.set(m, [...(byMarket.get(m) ?? []), r.p.id]);
  }
  const best = new Map<string, Map<string, { minor: number; storeName: string }>>();
  for (const [m, ids] of byMarket) best.set(m, await catalog.bestPrices([...new Set(ids)], m));

  let hits = 0;
  const pushes: { to: string; title: string; body: string; data: Record<string, string> }[] = [];
  for (const { w, u, p } of open) {
    const market = effectivePriceMarket(u.country);
    const price = best.get(market.code)?.get(p.id);
    if (!price || price.minor > w.targetMinor) continue;
    const updated = await db.update(watches).set({ hitAt: new Date() }).where(and(eq(watches.id, w.id), isNull(watches.hitAt))).returning({ id: watches.id });
    if (!updated.length) continue; // another worker got it
    const lang = u.lang as Lang;
    const priceTxt = formatMoney(price.minor, market.currency, lang);
    const title = lang === 'ar' ? `وصل لسعرك المستهدف: ${p.name}` : `Target price hit: ${p.name}`;
    const body = lang === 'ar'
      ? `${priceTxt} في ${price.storeName}. السعر قد يتغير قبل إتمام الشراء.`
      : `${priceTxt} at ${price.storeName}. Prices may change before checkout.`;
    await db.insert(notifications).values({ userId: u.id, kind: 'price_target', title, body, productId: p.id });
    if (u.pushToken) pushes.push({ to: u.pushToken, title, body, data: { productId: p.id } });
    hits++;
  }
  if (pushes.length) await sendExpoPush(pushes).catch((e) => log(`push failed: ${String(e)}`));
  log(`watch check: ${open.length} open, ${hits} hit`);
  return hits;
}

/** Expo push service; tokens are validated on registration. */
async function sendExpoPush(msgs: { to: string; title: string; body: string; data: Record<string, string> }[]) {
  for (let i = 0; i < msgs.length; i += 100) {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(msgs.slice(i, i + 100).map((m) => ({ ...m, sound: 'default' }))),
      signal: AbortSignal.timeout(10_000),
    });
  }
}

export async function markRead(db: DB, userId: string, ids: string[]) {
  if (!ids.length) return;
  await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, userId), inArray(notifications.id, ids)));
}
