import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, notInArray, or } from 'drizzle-orm';
import { convertToMinor, isConvertible, LAUNCH_MARKET, minorDigitsOf, type CurrencyCode, type RefreshResponse } from '@bestprice/core';
import type { DB } from '../db/client';
import { dataSources, offers, priceObservations, products, searchHistory, stores, watches } from '../db/schema';
import type { DiscoveryService } from './discovery';

type OfferRow = typeof offers.$inferSelect;
type StoreRow = typeof stores.$inferSelect;

export interface MonitorOptions {
  /** Watched products are re-checked this often (minutes). */
  watchedEveryMin: number;
  /** Products someone viewed in the last two days are re-checked this often (minutes). */
  viewedEveryMin: number;
}

/**
 * Keeps prices current without anyone pressing a button.
 *
 * Every offer found on the web links to its product page. The monitor reads
 * that page again (its own published price, stock and photo — no AI, no
 * cost) and updates the offer, moving it to a `store_page` source: a price
 * the store's page confirmed just now. Watched products are checked every
 * hour, recently viewed ones every few hours. When no page of a watched
 * product can be read, the monitor runs a web search for it instead, within
 * its own daily budget.
 */
export class PriceMonitor {
  constructor(private db: DB, private discovery: DiscoveryService, private opts: MonitorOptions) {}

  /** Re-checks one product's prices now. */
  async refreshProduct(productId: string, { search = false }: { search?: boolean } = {}): Promise<RefreshResponse> {
    const rows = await this.db
      .select({ o: offers, s: stores, src: dataSources })
      .from(offers)
      .innerJoin(stores, eq(stores.id, offers.storeId))
      .innerJoin(dataSources, eq(dataSources.id, offers.sourceId))
      .where(and(eq(offers.productId, productId), eq(offers.active, true), isNotNull(offers.url), inArray(dataSources.type, ['web_search', 'store_page'])))
      .limit(24);
    let checked = 0;
    let changed = 0;
    let photo: string | null = null;
    const queue = [...rows];
    await Promise.all(Array.from({ length: 4 }, async () => {
      for (let r = queue.shift(); r; r = queue.shift()) {
        const facts = await this.discovery.readPage(r.o.url!);
        if (!facts) continue;
        photo ??= facts.image;
        const result = await this.applyPagePrice(r.o, r.s, facts.price, facts.inStock);
        if (result === 'skipped') continue;
        checked++;
        if (result === 'changed') changed++;
      }
    }));

    const product = await this.db.query.products.findFirst({ where: eq(products.id, productId) });
    if (photo && product && !product.imageUrl) await this.db.update(products).set({ imageUrl: photo }).where(and(eq(products.id, productId), isNull(products.imageUrl)));

    // Nothing readable (stores that block page reads): search the web for fresh prices instead.
    let searched = false;
    if (checked === 0 && search && this.discovery.available) {
      try {
        const r = await this.discovery.discoverForProduct({ id: null, plan: 'pro' }, productId, 'all', LAUNCH_MARKET);
        searched = r.status === 'found';
      } catch { /* budget reached or search failed: try again next round */ }
    }
    const checkedAt = new Date();
    await this.db.update(products).set({ pricesCheckedAt: checkedAt }).where(eq(products.id, productId));
    return { checkedAt: checkedAt.toISOString(), checked, changed, searched };
  }

  /** Writes a price read from the store's own page onto the offer. */
  private async applyPagePrice(o: OfferRow, store: StoreRow, price: { amount: number; currency: string } | null, inStock: boolean | null): Promise<'skipped' | 'same' | 'changed'> {
    const cur = o.currency as CurrencyCode;
    let priceMinor = o.priceMinor;
    let orig: { origPriceMinor: number | null; origCurrency: string | null } = { origPriceMinor: o.origPriceMinor, origCurrency: o.origCurrency };
    if (price && isConvertible(price.currency)) {
      if (price.currency === cur) {
        priceMinor = Math.round(price.amount * 10 ** minorDigitsOf(cur));
        orig = { origPriceMinor: null, origCurrency: null };
      } else {
        priceMinor = convertToMinor(price.amount, price.currency, cur) ?? o.priceMinor;
        orig = { origPriceMinor: Math.round(price.amount * 10 ** minorDigitsOf(price.currency)), origCurrency: price.currency };
      }
      // A page price far from what we had is more likely another variant or an accessory than a real change.
      if (priceMinor < o.priceMinor * 0.4 || priceMinor > o.priceMinor * 2.5) return 'skipped';
    } else if (inStock === null) {
      return 'skipped'; // the page told us nothing
    }
    const stock = inStock === true ? 'in_stock' : inStock === false ? 'out_of_stock' : o.stock;
    const now = new Date();
    const isChange = priceMinor !== o.priceMinor || stock !== o.stock;
    const sourceId = price ? await this.pageSource(store, o.country) : o.sourceId;
    await this.db.update(offers).set({
      priceMinor, stock, observedAt: price ? now : o.observedAt, sourceId,
      ...(price ? orig : {}),
    }).where(eq(offers.id, o.id));
    if (price && o.condition === 'new') {
      // History: every change, and at least one point every 12 hours.
      const [last] = await this.db.select({ at: priceObservations.observedAt }).from(priceObservations).where(eq(priceObservations.offerId, o.id)).orderBy(desc(priceObservations.observedAt)).limit(1);
      if (isChange || !last || now.getTime() - last.at.getTime() > 12 * 3_600_000) {
        await this.db.insert(priceObservations).values({ offerId: o.id, productId: o.productId, finalMinor: priceMinor + (o.shippingMinor ?? 0) + o.feesMinor, observedAt: now });
      }
    }
    return isChange ? 'changed' : 'same';
  }

  private async pageSource(store: StoreRow, country: string): Promise<string> {
    const existing = await this.db.query.dataSources.findFirst({ where: and(eq(dataSources.storeId, store.id), eq(dataSources.type, 'store_page'), eq(dataSources.country, country)) });
    if (existing) return existing.id;
    const [row] = await this.db.insert(dataSources).values({
      name: `${store.name} — product page`, type: 'store_page', storeId: store.id, country, active: true,
      termsNote: 'Price, stock and photo read from the store\'s public product page (its published structured data), re-checked by the price monitor; linked to the page.',
    }).returning({ id: dataSources.id });
    return row!.id;
  }

  /** One round: watched products first, then recently viewed ones. Returns how many were checked. */
  async tick(log: (m: string) => void = () => {}): Promise<number> {
    const now = Date.now();
    const watchedDue = new Date(now - this.opts.watchedEveryMin * 60_000);
    const viewedDue = new Date(now - this.opts.viewedEveryMin * 60_000);
    const watched = await this.db.selectDistinct({ id: products.id, at: products.pricesCheckedAt })
      .from(watches).innerJoin(products, eq(products.id, watches.productId))
      .where(and(eq(products.status, 'active'), or(isNull(products.pricesCheckedAt), lt(products.pricesCheckedAt, watchedDue))))
      .orderBy(products.pricesCheckedAt).limit(40);
    const watchedIds = watched.map((w) => w.id);
    const viewed = await this.db.selectDistinct({ id: products.id, at: products.pricesCheckedAt })
      .from(searchHistory).innerJoin(products, eq(products.id, searchHistory.productId))
      .where(and(
        eq(products.status, 'active'),
        gte(searchHistory.createdAt, new Date(now - 48 * 3_600_000)),
        or(isNull(products.pricesCheckedAt), lt(products.pricesCheckedAt, viewedDue)),
        ...(watchedIds.length ? [notInArray(products.id, watchedIds)] : []),
      ))
      .orderBy(products.pricesCheckedAt).limit(20);
    const jobs = [...watched.map((w) => ({ id: w.id, search: true })), ...viewed.map((v) => ({ id: v.id, search: false }))];
    let changed = 0;
    for (let i = 0; i < jobs.length; i += 3) {
      const batch = await Promise.all(jobs.slice(i, i + 3).map((j) => this.refreshProduct(j.id, { search: j.search }).catch(() => null)));
      changed += batch.reduce((n, r) => n + (r?.changed ?? 0), 0);
    }
    if (jobs.length) log(`price monitor: ${jobs.length} products checked, ${changed} prices changed`);
    return jobs.length;
  }
}
