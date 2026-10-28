import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import type { Ctx } from '../src/app';
import type { DB } from '../src/db/client';
import { offers, stores } from '../src/db/schema';
import { isValidAffiliate, withAffiliate } from '../src/lib/affiliate';
import { admin, setup } from './helpers';

let app: FastifyInstance;
let ctx: Ctx;
let db: DB;
beforeAll(async () => { ({ app, ctx, db } = await setup()); });
afterAll(async () => { await app.close(); await db.$client.end(); });

describe('affiliate settings', () => {
  it('adds query parameters or fills a network template', () => {
    expect(withAffiliate('https://www.amazon.sa/dp/B0X?th=1', 'tag=bestprice-21')).toBe('https://www.amazon.sa/dp/B0X?th=1&tag=bestprice-21');
    expect(withAffiliate('https://www.amazon.sa/dp/B0X?tag=other-21', 'tag=bestprice-21')).toBe('https://www.amazon.sa/dp/B0X?tag=bestprice-21');
    expect(withAffiliate('https://ar.aliexpress.com/item/1.html', 'https://s.click.aliexpress.com/deep_link.htm?aff_short_key=K&dl_target={url}'))
      .toBe('https://s.click.aliexpress.com/deep_link.htm?aff_short_key=K&dl_target=https%3A%2F%2Far.aliexpress.com%2Fitem%2F1.html');
    expect(withAffiliate('https://www.jarir.com/x', null)).toBe('https://www.jarir.com/x');
  });

  it('rejects settings that could send shoppers somewhere else', () => {
    expect(isValidAffiliate('https://evil.example/?u={url}')).toBe(false);
    expect(isValidAffiliate('http://s.click.aliexpress.com/?u={url}')).toBe(false);
    expect(isValidAffiliate('https://s.click.aliexpress.com/no-target')).toBe(false);
    expect(isValidAffiliate('tag=a b')).toBe(false);
    expect(withAffiliate('https://www.jarir.com/x', 'https://evil.example/?u={url}')).toBe('https://www.jarir.com/x');
  });

  it('puts the store code on Buy links, and admins can set it', async () => {
    const [o] = await db.select({ id: offers.id, url: offers.url, storeId: offers.storeId }).from(offers).where(eq(offers.active, true)).limit(1);
    const go = async () => (await app.inject({ method: 'GET', url: `/r/${o!.id}` })).headers.location as string;
    expect(await go()).toBe(o!.url);

    const h = await admin(app);
    const bad = await app.inject({ method: 'PATCH', url: `/v1/admin/stores/${o!.storeId}`, headers: h, payload: { affiliate: 'https://evil.example/?u={url}' } });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({ method: 'PATCH', url: `/v1/admin/stores/${o!.storeId}`, headers: h, payload: { affiliate: 'ref=bestprice' } });
    expect(ok.statusCode).toBe(200);
    const u = new URL(await go());
    expect(u.searchParams.get('ref')).toBe('bestprice');
    expect(u.hostname).toBe(new URL(o!.url).hostname);
  });

  it('uses the Amazon Associates tag for Amazon stores without their own code', async () => {
    const [amazon] = await db.select().from(stores).where(eq(stores.slug, 'amazon-sa'));
    const [o] = await db.select({ id: offers.id }).from(offers).where(eq(offers.storeId, amazon!.id)).limit(1);
    if (!o) throw new Error('demo data has no Amazon offer');
    expect(o).toBeTruthy();
    await db.update(stores).set({ affiliate: null }).where(eq(stores.id, amazon!.id));
    (ctx.cfg as { AMAZON_ASSOCIATE_TAG?: string }).AMAZON_ASSOCIATE_TAG = 'bestprice-21';
    const loc = (await app.inject({ method: 'GET', url: `/r/${o.id}` })).headers.location as string;
    expect(new URL(loc).searchParams.get('tag')).toBe('bestprice-21');
  });
});
