import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import type { Ctx } from '../src/app';
import type { DB } from '../src/db/client';
import { dataSources, offers, products, stores } from '../src/db/schema';
import { LogoService } from '../src/lib/logo';
import { extractPageFacts } from '../src/lib/page';
import { safeGet } from '../src/lib/http';
import { guest, setup } from './helpers';

let app: FastifyInstance;
let ctx: Ctx;
let db: DB;

function fakeClient(script: ((req: any) => any)[]) {
  const calls: any[] = [];
  return {
    calls,
    beta: { messages: { create: async (req: any) => { calls.push(structuredClone(req)); const next = script.shift(); if (!next) throw new Error('script exhausted'); return next(req); } } },
  };
}
const msg = (content: any[], stop_reason = 'tool_use') => ({ id: 'm', type: 'message', role: 'assistant', model: 'x', content, stop_reason, usage: {} });
const searchResult = (...urls: string[]) => ({
  type: 'web_search_tool_result', tool_use_id: 'srv1',
  content: urls.map((url) => ({ type: 'web_search_result', url, title: 't', encrypted_content: 'x', page_age: null })),
});

beforeAll(async () => { ({ app, ctx, db } = await setup()); });
afterAll(async () => { await app.close(); await db.$client.end(); });

describe('seed', () => {
  it('is idempotent: a second run adds nothing', async () => {
    const before = (await db.select({ id: products.id }).from(products)).length;
    const { seed } = await import('../src/db/seed');
    const logs: string[] = [];
    await seed(db, { demo: true, log: (m) => logs.push(m) });
    expect((await db.select({ id: products.id }).from(products)).length).toBe(before);
    expect(logs).toEqual(['demo catalog: 0 new products, 0 new stores']);
  });
});

describe('catalog search (Arabic)', () => {
  it('finds iPhone from Arabic spellings with hamza variants', async () => {
    for (const q of ['إيفون', 'ايفون 16', 'آيفون', 'الايفون']) {
      const r = (await app.inject({ method: 'GET', url: `/v1/products/search?q=${encodeURIComponent(q)}` })).json();
      expect(r.results.map((p: any) => p.name), q).toContain('iPhone 16 · 128GB');
    }
  });
  it('matches Arabic product names and category words', async () => {
    const r = (await app.inject({ method: 'GET', url: `/v1/products/search?q=${encodeURIComponent('مطحنة قهوة')}` })).json();
    expect(r.results[0].nameAr).toContain('مطحنة');
    const l = (await app.inject({ method: 'GET', url: `/v1/products/search?q=${encodeURIComponent('لابتوب لينوفو')}` })).json();
    expect(l.results.map((p: any) => p.brand)).toEqual(['Lenovo']);
    expect(l.canDiscover).toBe(false);
  });
  it('treats LIKE wildcards literally', async () => {
    const r = (await app.inject({ method: 'GET', url: `/v1/products/search?q=${encodeURIComponent('%_%')}` })).json();
    expect(r.results).toEqual([]);
  });
});

async function poll(h: Record<string, string>, first: any) {
  let j = first;
  for (let i = 0; j.status === 'running' && i < 100; i++) {
    await new Promise((r) => setTimeout(r, 30));
    j = (await app.inject({ method: 'GET', url: `/v1/products/discover/${first.jobId}`, headers: h })).json();
  }
  return j;
}
// Each call from its own address: the endpoint allows 6 searches a minute per client.
let ip = 10;
const post = (url: string, h: Record<string, string>, payload: object) => app.inject({ method: 'POST', url, headers: h, payload, remoteAddress: `203.0.113.${ip++}` });
const discover = async (h: Record<string, string>, payload: object) => poll(h, (await post('/v1/products/discover', h, payload)).json());
const submit = (products: any[]) => msg([{ type: 'tool_use', id: 't1', name: 'submit_products', input: { products } }]);
const product = (over: object) => ({
  name: 'X', name_ar: null, brand: null, brand_website: null, model: null, category: 'other', gtin: null, image_url: null, spec_source_url: null,
  match: 'exact', specs: [], listings: [], ...over,
});
const listing = (url: string, price: number, over: object = {}) => ({ url, seller_name: null, title: null, price, currency: 'SAR', condition: 'new', in_stock: true, ...over });

describe('online discovery (scripted model)', () => {
  it('reports unavailable without an API key', async () => {
    const g = await guest(app);
    const r = await app.inject({ method: 'POST', url: '/v1/products/discover', headers: g.h, payload: { q: 'Dyson V15' } });
    expect(r.json()).toMatchObject({ status: 'unavailable', jobId: null, results: [] });
  });

  it('requires a session and validates input', async () => {
    expect((await app.inject({ method: 'POST', url: '/v1/products/discover', payload: { q: 'Dyson V15' } })).statusCode).toBe(401);
    const g = await guest(app);
    expect((await app.inject({ method: 'POST', url: '/v1/products/discover', headers: g.h, payload: { q: 'x', gtin: '123' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/v1/products/discover', headers: g.h, payload: { image: { mediaType: 'image/gif', data: 'A'.repeat(200) } } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/v1/products/discover', headers: g.h, payload: { image: { mediaType: 'image/jpeg', data: '<script>'.repeat(30) } } })).statusCode).toBe(400);
  });

  it('keeps known stores, unknown sellers, abroad and used listings — only pages web search returned', async () => {
    const fake = fakeClient([
      () => msg([
        { type: 'server_tool_use', id: 'srv1', name: 'web_search', input: { query: 'Dyson V15 Detect سعر' } },
        searchResult(
          'https://www.amazon.sa/dp/B0DYSON15?ref=x', 'https://www.dyson.sa/v15-detect', 'https://shop.example/dyson-v15',
          'https://ar.aliexpress.com/item/1005.html', 'https://haraj.com.sa/1234/dyson_v15', 'http://plain.example/v15', 'https://192.168.1.4/v15',
        ),
      ], 'pause_turn'),
      (req) => {
        expect(req.messages).toHaveLength(2); // paused turn was resumed, not re-asked
        return submit([product({
          name: 'Dyson V15 Detect Absolute', name_ar: 'دايسون V15 ديتكت', brand: 'Dyson', brand_website: 'https://www.dyson.com/', model: 'SV47', category: 'home',
          image_url: 'https://evil.example/pixel.png', spec_source_url: 'https://www.dyson.sa/v15-detect',
          specs: [{ label: 'Run time', label_ar: 'مدة التشغيل', value: 'Up to 60 min' }],
          listings: [
            listing('https://www.amazon.sa/dp/B0DYSON15', 2799),                            // known store; the page says 2749 → page wins
            listing('https://www.noon.com/dyson-v15', 1999),                                  // never returned by search → dropped
            listing('https://shop.example/dyson-v15', 2499, { seller_name: 'Dyson Official Store' }), // unknown seller, named by its domain
            listing('https://ar.aliexpress.com/item/1005.html', 199, { currency: 'USD', title: 'V15 cordless vacuum' }), // abroad, converted, suspiciously cheap
            listing('https://haraj.com.sa/1234/dyson_v15', 1800, { condition: 'used', title: 'دايسون V15 مستعمل نظيف' }), // used → own section
            listing('http://plain.example/v15', 100),                                         // not https → dropped
            listing('https://192.168.1.4/v15', 100),                                          // IP address → dropped
          ],
        })]);
      },
    ]);
    (ctx.discovery as any).client = fake;
    (ctx.discovery as any).fetchPage = async (url: string) => url.includes('amazon.sa')
      ? { image: 'https://m.media-amazon.com/images/I/v15.jpg', title: 'Dyson V15', price: { amount: 2749, currency: 'SAR' }, inStock: true }
      : null;
    const g = await guest(app);
    const r = await discover(g.h, { q: 'دايسون V15' });
    expect(r.status).toBe('found');
    expect(r.queries).toEqual(['Dyson V15 Detect سعر']);
    expect(r.sites).toEqual(expect.arrayContaining(['amazon.sa', 'shop.example', 'haraj.com.sa']));
    expect(r.results[0]).toMatchObject({
      name: 'Dyson V15 Detect Absolute', match: 'exact', imageUrl: 'https://m.media-amazon.com/images/I/v15.jpg',
      brandLogoUrl: 'http://api.test/v1/logo/dyson.com', offerCount: 3,
    });

    const o = (await app.inject({ method: 'GET', url: `/v1/products/${r.results[0].id}/offers?sort=value` })).json();
    const by = (d: string) => o.offers.find((x: any) => x.store.domain === d);
    expect(by('amazon.sa')).toMatchObject({ priceMinor: 274900, sourceType: 'web_search', confidence: 'medium', store: { known: true, logoUrl: 'http://api.test/v1/logo/amazon.sa' } });
    expect(by('shop.example')).toMatchObject({ priceMinor: 249900, store: { name: 'shop.example', known: false, kind: 'retailer' } });
    expect(by('shop.example').reasons).toContain('unknown_seller');
    const ali = by('aliexpress.com');
    expect(ali).toMatchObject({ priceMinor: 74625, original: { priceMinor: 19900, currency: 'USD', exact: true }, store: { known: true, kind: 'global' }, title: 'V15 cordless vacuum' });
    expect(ali.reasons).toContain('suspicious_price');
    expect(o.offers[0].store.domain).not.toBe('aliexpress.com'); // best value is never the suspicious one
    expect(o.used).toHaveLength(1);
    expect(o.used[0]).toMatchObject({ condition: 'used', priceMinor: 180000, title: 'دايسون V15 مستعمل نظيف', store: { kind: 'classifieds' } });
    expect(o.offers.some((x: any) => x.store.domain === 'noon.com' || x.store.domain === 'plain.example')).toBe(false);
    // used listings never set the "from" price
    expect(r.results[0].bestPriceMinor).toBe(249900); // and never the suspicious one

    const rows = await db.select({ url: offers.url, type: dataSources.type }).from(offers).innerJoin(dataSources, eq(dataSources.id, offers.sourceId)).where(eq(offers.productId, r.results[0].id));
    expect(rows.every((x) => x.type === 'web_search')).toBe(true);
    expect(fake.calls[0].tools[0].type).toBe('web_search_20260209');
    expect(fake.calls[0].system[0].text).toContain('AliExpress');

    // same query again (any spelling that normalises the same) is served from cache, no model call
    const again = await discover(g.h, { q: 'دايسون v15' });
    expect(again.status).toBe('found');
    expect(again.results[0].id).toBe(r.results[0].id);
    expect(fake.calls).toHaveLength(2);
    // the catalog search finds it now; unknown sellers are not listed as directory stores
    const s = (await app.inject({ method: 'GET', url: `/v1/products/search?q=${encodeURIComponent('دايسون')}` })).json();
    expect(s.results[0].id).toBe(r.results[0].id);
    const dir = (await app.inject({ method: 'GET', url: '/v1/stores' })).json();
    expect(dir.some((x: any) => x.domain === 'shop.example')).toBe(false);
    expect(await db.query.stores.findFirst({ where: eq(stores.slug, 'web-shop.example') })).toMatchObject({ known: false, name: 'shop.example' });
  });

  it('records a miss when nothing matches', async () => {
    (ctx.discovery as any).client = fakeClient([() => submit([])]);
    const g = await guest(app);
    const r = await discover(g.h, { q: 'qwertyuiop gadget' });
    expect(r).toMatchObject({ status: 'not_found', results: [] });
  });

  it('searches by photo and marks alternatives as similar', async () => {
    const fake = fakeClient([
      () => msg([searchResult('https://www.amazon.sa/dp/BAG1')], 'pause_turn'),
      () => submit([product({ name: 'Leather tote bag, tan', category: 'fashion', match: 'similar', listings: [listing('https://www.amazon.sa/dp/BAG1', 149)] })]),
    ]);
    (ctx.discovery as any).client = fake;
    (ctx.discovery as any).fetchPage = async () => null;
    const g = await guest(app);
    const r = await discover(g.h, { image: { mediaType: 'image/jpeg', data: 'A'.repeat(400) }, q: 'شنطة' });
    expect(r.status).toBe('found');
    expect(r.results[0]).toMatchObject({ name: 'Leather tote bag, tan', match: 'similar' });
    const first = fake.calls[0].messages[0].content;
    expect(first[0]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg' } });
    expect(first[1].text).toContain('شنطة');
  });

  it('finds used listings for a product we already have', async () => {
    const ideapad = (await db.query.products.findFirst({ where: eq(products.model, '83HW0021AX') }))!;
    const fake = fakeClient([
      () => msg([searchResult('https://haraj.com.sa/99/ideapad_slim5')], 'pause_turn'),
      () => submit([product({ name: 'Lenovo IdeaPad Slim 5', listings: [listing('https://haraj.com.sa/99/ideapad_slim5', 1900, { condition: 'used', title: 'لينوفو ايديا باد سليم 5 مستعمل' })] })]),
    ]);
    (ctx.discovery as any).client = fake;
    (ctx.discovery as any).fetchPage = async () => null;
    const g = await guest(app);
    const r = await poll(g.h, (await post(`/v1/products/${ideapad.id}/discover`, g.h, { focus: 'used' })).json());
    expect(r.status).toBe('found');
    expect(r.results[0].id).toBe(ideapad.id);
    expect(fake.calls[0].messages[0].content[0].text).toContain('83HW0021AX');
    expect(fake.calls[0].system[0].text).toContain('used and refurbished listings');
    const o = (await app.inject({ method: 'GET', url: `/v1/products/${ideapad.id}/offers` })).json();
    expect(o.used.map((x: any) => x.priceMinor)).toEqual([190000]);
    expect(o.offers.every((x: any) => x.condition === 'new')).toBe(true);
  });

  it('only shows a job to the user who started it', async () => {
    (ctx.discovery as any).client = fakeClient([() => new Promise((r) => setTimeout(() => r(submit([])), 600))]);
    const a = await guest(app);
    const b = await guest(app);
    const j = (await post('/v1/products/discover', a.h, { q: 'slow thing here' })).json();
    expect(j.status).toBe('running');
    expect((await app.inject({ method: 'GET', url: `/v1/products/discover/${j.jobId}`, headers: b.h })).statusCode).toBe(404);
    expect((await poll(a.h, j)).status).toBe('not_found');
  });
});

describe('logos', () => {
  const png = (w: number) => { const b = Buffer.alloc(40); b.writeUInt32BE(0x89504e47, 0); b.writeUInt32BE(w, 16); return b; };
  it('serves cached site icons and refuses tiny or invalid ones', async () => {
    const asked: string[] = [];
    ctx.logos = new LogoService(async (url) => {
      asked.push(url);
      return { status: 200, url, contentType: 'image/png', body: url.includes('tiny.example') ? png(16) : png(128) };
    });
    const r = await app.inject({ method: 'GET', url: '/v1/logo/jarir.com' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('image/png');
    expect(r.headers['cache-control']).toContain('max-age');
    expect(r.headers['cross-origin-resource-policy']).toBe('cross-origin');
    await app.inject({ method: 'GET', url: '/v1/logo/jarir.com' });
    expect(asked).toEqual(['https://www.google.com/s2/favicons?domain=jarir.com&sz=128']); // cached
    expect((await app.inject({ method: 'GET', url: '/v1/logo/tiny.example' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/v1/logo/127.0.0.1' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/v1/logo/localhost' })).statusCode).toBe(404);
    expect(asked).toHaveLength(2);
  });
});

describe('page reading', () => {
  it('takes photo and price from JSON-LD, falling back to Open Graph', () => {
    const html = `<html><head>
      <meta property="og:image" content="/img/og.jpg"><meta property="og:title" content="OG title">
      <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"BreadcrumbList"},{"@type":"Product","name":"Stream Deck MK.2","image":["https://cdn.example/sd.jpg"],"offers":{"@type":"Offer","price":"649.00","priceCurrency":"SAR","availability":"https://schema.org/InStock"}}]}</script>
    </head></html>`;
    expect(extractPageFacts(html, 'https://shop.example/p/1')).toEqual({ image: 'https://cdn.example/sd.jpg', title: 'Stream Deck MK.2', price: { amount: 649, currency: 'SAR' }, inStock: true });
    const og = extractPageFacts(`<meta content="https://x.example/a.jpg?w=1&amp;h=2" property="og:image"><meta property="product:price:amount" content="99.5"><meta property="product:price:currency" content="usd">`, 'https://x.example/');
    expect(og).toEqual({ image: 'https://x.example/a.jpg?w=1&h=2', title: null, price: { amount: 99.5, currency: 'USD' }, inStock: null });
    expect(extractPageFacts('<meta property="og:image" content="javascript:alert(1)">', 'https://x.example/').image).toBeNull();
    expect(extractPageFacts('<script type="application/ld+json">{bad json</script>', 'https://x.example/').price).toBeNull();
  });
  it('never fetches private addresses, IP literals or plain http', async () => {
    await expect(safeGet('https://127.0.0.1/')).rejects.toThrow('host_not_public');
    await expect(safeGet('https://[::1]/')).rejects.toThrow('host_not_public');
    await expect(safeGet('https://localhost/')).rejects.toThrow('host_not_public');
    await expect(safeGet('http://example.com/')).rejects.toThrow('url_must_be_https');
    await expect(safeGet('https://user:pw@example.com/')).rejects.toThrow('url_has_credentials');
  });
});
