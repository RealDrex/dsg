import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import type { Ctx } from '../src/app';
import type { DB } from '../src/db/client';
import { notifications, priceObservations, products } from '../src/db/schema';
import { checkWatches } from '../src/services/alerts';
import { guest, setup } from './helpers';

let app: FastifyInstance;
let ctx: Ctx;
let db: DB;
let productId: string;
const AMAZON = 'https://www.amazon.sa/dp/B0STREAMDK';
const JARIR = 'https://www.jarir.com/sa-ar/stream-deck.html';

const msg = (content: any[], stop_reason = 'tool_use') => ({ id: 'm', type: 'message', role: 'assistant', model: 'x', content, stop_reason, usage: {} });
let pagePrices: Record<string, { amount: number; currency: string } | null> = {};

beforeAll(async () => {
  ({ app, ctx, db } = await setup());
  // A product found by web search with two store offers.
  const script = [
    () => msg([{ type: 'web_search_tool_result', tool_use_id: 's', content: [AMAZON, JARIR].map((url) => ({ type: 'web_search_result', url, title: 't', encrypted_content: 'x' })) }], 'pause_turn'),
    () => msg([{ type: 'tool_use', id: 't', name: 'submit_products', input: { products: [{
      name: 'Elgato Stream Deck MK.2', name_ar: 'ستريم ديك', brand: 'Elgato', brand_website: 'elgato.com', model: '10GBA9901', category: 'gaming', gtin: null,
      image_url: null, spec_source_url: null, match: 'exact', specs: [],
      listings: [AMAZON, JARIR].map((url, i) => ({ url, seller_name: null, title: null, price: i ? 699 : 649, currency: 'SAR', condition: 'new', in_stock: true })),
    }] } }]),
  ];
  (ctx.discovery as any).client = { beta: { messages: { create: async () => script.shift()!() } } };
  (ctx.discovery as any).fetchPage = async () => null;
  const g = await guest(app);
  const r = await ctx.discovery.discover({ id: g.user.id, plan: 'free' }, { q: 'stream deck mk2' }, 'SA');
  productId = r.results[0]!.id;
  // From now on, "store pages" answer with whatever the test sets.
  (ctx.discovery as any).fetchPage = async (url: string) => (url in pagePrices ? { image: 'https://m.media-amazon.com/images/I/sd.jpg', title: null, price: pagePrices[url], inStock: true } : null);
});
afterAll(async () => { await app.close(); await db.$client.end(); });

const offersOf = async () => (await app.inject({ method: 'GET', url: `/v1/products/${productId}/offers?sort=cheapest` })).json();

describe('price monitor', () => {
  it('re-reads the store page, updates price and source, and records history', async () => {
    pagePrices = { [AMAZON]: { amount: 599, currency: 'SAR' } };
    const g = await guest(app);
    const r = (await app.inject({ method: 'POST', url: `/v1/products/${productId}/refresh`, headers: g.h })).json();
    expect(r).toMatchObject({ checked: 1, changed: 1, searched: false });
    const o = await offersOf();
    const amazon = o.offers.find((x: any) => x.store.domain === 'amazon.sa');
    expect(amazon).toMatchObject({ priceMinor: 59900, sourceType: 'store_page', confidence: 'high' });
    expect(o.offers.find((x: any) => x.store.domain === 'jarir.com')).toMatchObject({ priceMinor: 69900, sourceType: 'web_search' });
    const p = (await app.inject({ method: 'GET', url: `/v1/products/${productId}` })).json();
    expect(p.pricesCheckedAt).toBe(r.checkedAt);
    expect(p.imageUrl).toBe('https://m.media-amazon.com/images/I/sd.jpg'); // photo from the page
    const hist = await db.select().from(priceObservations).where(and(eq(priceObservations.productId, productId), eq(priceObservations.finalMinor, 59900)));
    expect(hist).toHaveLength(1);
    // asked again right away: answered from the last check, pages not re-read
    pagePrices = { [AMAZON]: { amount: 1, currency: 'SAR' } };
    expect((await app.inject({ method: 'POST', url: `/v1/products/${productId}/refresh`, headers: g.h })).json()).toMatchObject({ checked: 0, checkedAt: r.checkedAt });
  });

  it('ignores a page price that is clearly another variant or accessory', async () => {
    pagePrices = { [AMAZON]: { amount: 59, currency: 'SAR' } };
    const r = await ctx.monitor.refreshProduct(productId);
    expect(r.checked).toBe(0);
    expect((await offersOf()).offers.find((x: any) => x.store.domain === 'amazon.sa').priceMinor).toBe(59900);
  });

  it('sends a price-drop alert, then the target alert, and keeps the watchlist current', async () => {
    const g = await guest(app);
    await app.inject({ method: 'POST', url: '/v1/watches', headers: g.h, payload: { productId, targetMinor: 50000 } });
    await checkWatches(db, ctx.catalog); // remembers 599 as the last best price
    pagePrices = { [AMAZON]: { amount: 569, currency: 'SAR' } }; // −5 %
    await db.update(products).set({ pricesCheckedAt: null }).where(eq(products.id, productId));
    const w1 = (await app.inject({ method: 'POST', url: '/v1/watches/refresh', headers: g.h })).json();
    expect(w1).toMatchObject({ checked: 1, changed: 1 });
    expect(w1.watches[0]).toMatchObject({ currentMinor: 56900, hit: false, lowestMinor: 56900 });
    expect(w1.watches[0].checkedAt).toBeTruthy();
    const mine = async () => db.select().from(notifications).where(eq(notifications.userId, g.user.id));
    expect((await mine()).map((n) => n.kind)).toEqual(['price_drop']);
    expect((await mine())[0]!.body).toContain('569');

    pagePrices = { [AMAZON]: { amount: 489, currency: 'SAR' } }; // below the 500 target
    await db.update(products).set({ pricesCheckedAt: null }).where(eq(products.id, productId));
    const w2 = (await app.inject({ method: 'POST', url: '/v1/watches/refresh', headers: g.h })).json();
    expect(w2.watches[0]).toMatchObject({ currentMinor: 48900, hit: true });
    expect((await mine()).map((n) => n.kind).sort()).toEqual(['price_drop', 'price_target']);
  });

  it('checks watched products on its own when they are due', async () => {
    pagePrices = { [AMAZON]: { amount: 479, currency: 'SAR' } };
    await db.update(products).set({ pricesCheckedAt: new Date(Date.now() - 2 * 3_600_000) }).where(eq(products.id, productId));
    const lines: string[] = [];
    expect(await ctx.monitor.tick((m) => lines.push(m))).toBeGreaterThanOrEqual(1);
    expect(lines[0]).toMatch(/price monitor: \d+ products checked, 1 prices changed/);
    expect(await ctx.monitor.tick()).toBe(0); // nothing due any more
  });
});
