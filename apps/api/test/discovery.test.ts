import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import type { Ctx } from '../src/app';
import type { DB } from '../src/db/client';
import { dataSources, offers, products, stores } from '../src/db/schema';
import { LogoService } from '../src/lib/logo';
import { imageWidth } from '../src/lib/imagesize';
import { extractPageFacts } from '../src/lib/page';
import { safeGet } from '../src/lib/http';
import { warmUp } from '../src/services/warmup';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
  match: 'exact', summary_ar: null, components_ar: [], specs: [], listings: [], ...over,
});
const listing = (url: string, price: number, over: object = {}) => ({ url, seller_name: null, title: null, price, currency: 'SAR', condition: 'new', in_stock: true, shipping: null, delivery_days: null, ships_to_market: null, ...over });

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
    (ctx.media as any).opts.fetcher = async (url: string) => url.startsWith('https://m.media-amazon.com/')
      ? { status: 200, url, contentType: 'image/jpeg', body: Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(40).fill(0)]) }
      : { status: 404, url, contentType: 'text/plain', body: Buffer.alloc(0) };
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

const png = (w: number) => { const b = Buffer.alloc(40); b.writeUInt32BE(0x89504e47, 0); b.writeUInt32BE(w, 16); return b; };
const res = (url: string, status: number, contentType: string, body: Buffer | string) => ({ status, url, contentType, body: Buffer.isBuffer(body) ? body : Buffer.from(body) });

describe('best option, delivery and links', () => {
  it('stores shipping and delivery time, drops sellers that cannot deliver, and picks best / fastest / range', async () => {
    const urls = ['https://www.amazon.sa/dp/B0BLEND1', 'https://www.noon.com/saudi-ar/blender/p/1', 'https://ar.aliexpress.com/item/77.html', 'https://ukshop.example/blender'];
    (ctx.discovery as any).client = fakeClient([
      () => msg([searchResult(...urls)], 'pause_turn'),
      () => submit([product({
        name: 'Portable Blender 380ml', name_ar: 'خلاط محمول', category: 'home', summary_ar: 'خلاط صغير يشحن بـ USB لتحضير العصير في أي مكان.',
        components_ar: ['كوب 380 مل', '6 شفرات ستانلس', 'كيبل USB-C'],
        listings: [
          listing(urls[0]!, 119, { shipping: 0, delivery_days: 1 }),                         // tomorrow
          listing(urls[1]!, 109, { shipping: 9, delivery_days: 0 }),                         // noon Minutes, today
          listing(urls[2]!, 19, { currency: 'USD', shipping: 2, delivery_days: 14 }),         // cheap but two weeks
          listing(urls[3]!, 15, { currency: 'GBP', ships_to_market: false }),                // UK only → dropped
        ],
      })]),
    ]);
    (ctx.discovery as any).fetchPage = async () => null;
    const g = await guest(app);
    const r = await discover(g.h, { q: 'خلاط محمول' });
    expect(r.status).toBe('found');
    const p = r.results[0];
    expect(p.offerCount).toBe(3);
    expect(p.priceRange).toEqual({ minMinor: 7875, maxMinor: 11900 }); // 21 USD = 78.75 SAR … 119 SAR
    expect(p.fastest).toMatchObject({ storeName: 'noon', etaHours: 2, finalMinor: 11800 });
    expect(p.best).not.toBeNull();
    const o = (await app.inject({ method: 'GET', url: `/v1/products/${p.id}/offers?sort=fastest` })).json();
    expect(o.offers[0]).toMatchObject({ store: { domain: 'noon.com' }, shippingMinor: 900, etaHours: 2, finalMinor: 11800 });
    expect(o.offers.some((x: any) => x.store.domain === 'ukshop.example')).toBe(false);
    const full = (await app.inject({ method: 'GET', url: `/v1/products/${p.id}` })).json();
    expect(full.description).toBe('خلاط صغير يشحن بـ USB لتحضير العصير في أي مكان.');
    expect(full.attributes.components).toBe('كوب 380 مل · 6 شفرات ستانلس · كيبل USB-C');
  });

  it('identifies the product in a pasted TikTok link from its caption and cover frame', async () => {
    const fake = fakeClient([
      () => msg([searchResult('https://www.amazon.sa/dp/B0LAMP1')], 'pause_turn'),
      () => submit([product({ name: 'Sunset projection lamp', name_ar: 'إضاءة الغروب', category: 'home', listings: [listing('https://www.amazon.sa/dp/B0LAMP1', 49)] })]),
    ]);
    (ctx.discovery as any).client = fake;
    const asked: string[] = [];
    (ctx.discovery as any).opts.fetchUrl = async (url: string) => {
      asked.push(url);
      if (url.startsWith('https://www.tiktok.com/oembed?url=')) return { status: 200, url, contentType: 'application/json', body: Buffer.from(JSON.stringify({ title: 'This sunset lamp changed my room 🌅 #tiktokmademebuyit', thumbnail_url: 'https://p16-sign.tiktokcdn.com/cover.jpeg' })) };
      if (url === 'https://p16-sign.tiktokcdn.com/cover.jpeg') return { status: 200, url, contentType: 'image/jpeg', body: Buffer.from([0xff, 0xd8, ...Array(200).fill(1)]) };
      return { status: 404, url, contentType: 'text/plain', body: Buffer.alloc(0) };
    };
    const g = await guest(app);
    const r = await discover(g.h, { url: 'https://www.tiktok.com/@someone/video/7400000000000000001' });
    expect(r.status).toBe('found');
    expect(r.results[0].name).toBe('Sunset projection lamp');
    const first = fake.calls[0].messages[0].content;
    expect(first[0]).toMatchObject({ type: 'image', source: { media_type: 'image/jpeg' } });
    expect(first[1].text).toContain('sunset lamp changed my room');
    expect(fake.calls[0].system[0].text).toContain('frame from a TikTok video');
    expect(asked[0]).toContain(encodeURIComponent('https://www.tiktok.com/@someone/video/7400000000000000001'));
    // unreadable link → not found, no model call
    (ctx.discovery as any).client = fakeClient([]);
    (ctx.discovery as any).opts.fetchUrl = async (url: string) => ({ status: 404, url, contentType: 'text/plain', body: Buffer.alloc(0) });
    expect((await discover(g.h, { url: 'https://www.tiktok.com/@x/video/1' })).status).toBe('not_found');
    expect((await post('/v1/products/discover', g.h, { url: 'javascript:alert(1)' })).statusCode).toBe(400);
  });

  it('sends the category\'s stores to the search and lists the category\'s catalog', async () => {
    const fake = fakeClient([() => submit([])]);
    (ctx.discovery as any).client = fake;
    const g = await guest(app);
    await discover(g.h, { q: 'روج مات', category: 'beauty' });
    expect(fake.calls[0].system[0].text).toContain('sephora.sa');
    expect(fake.calls[0].system[0].text).toContain('Riyadh');
    const list = (await app.inject({ method: 'GET', url: '/v1/categories/gaming/products' })).json();
    expect(list.map((p: any) => p.category).every((c: string) => c === 'gaming')).toBe(true);
    expect((await app.inject({ method: 'GET', url: '/v1/categories/nope/products' })).statusCode).toBe(404);
  });
});

describe('logos', () => {
  it('uses the icon the site declares, caches it, and refuses tiny or invalid ones', async () => {
    const asked: string[] = [];
    ctx.logos = new LogoService(async (url, kind) => {
      asked.push(url);
      if (kind === 'html') return url === 'https://jarir.com/' ? res(url, 200, 'text/html', '<link rel="icon" href="/fav.ico"><link rel="apple-touch-icon" sizes="180x180" href="/touch.png">') : res(url, 403, 'text/html', '');
      if (url === 'https://jarir.com/touch.png') return res(url, 200, 'image/png', png(180));
      if (url.includes('google.com') && url.includes('noon.com')) return res(url, 200, 'image/png', png(256));
      if (url.includes('google.com') && url.includes('small.example')) return res(url, 200, 'image/png', png(32));
      return res(url, 200, 'image/png', png(16));
    });
    const r = await app.inject({ method: 'GET', url: '/v1/logo/jarir.com' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('image/png');
    expect(r.headers['cache-control']).toContain('max-age');
    expect(r.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(imageWidth(r.rawPayload)).toBe(180);
    const n = asked.length;
    await app.inject({ method: 'GET', url: '/v1/logo/jarir.com' });
    expect(asked.length).toBe(n); // cached
    // site blocks bots → icon services
    expect(imageWidth((await app.inject({ method: 'GET', url: '/v1/logo/noon.com' })).rawPayload)).toBe(256);
    // only a 32 px icon anywhere → still better than nothing
    expect(imageWidth((await app.inject({ method: 'GET', url: '/v1/logo/small.example' })).rawPayload)).toBe(32);
    // 16 px everywhere → no logo (the app shows the wordmark)
    expect((await app.inject({ method: 'GET', url: '/v1/logo/tiny.example' })).statusCode).toBe(404);
    const before = asked.length;
    expect((await app.inject({ method: 'GET', url: '/v1/logo/127.0.0.1' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/v1/logo/localhost' })).statusCode).toBe(404);
    expect(asked.length).toBe(before);
  });
  it('prefers logo.dev when a token is configured', async () => {
    ctx.logos = new LogoService(async (url) => url.startsWith('https://img.logo.dev/apple.com?token=t0k') ? res(url, 200, 'image/png', png(200)) : res(url, 404, 'text/plain', ''), { logoDevToken: 't0k' });
    expect(imageWidth((await app.inject({ method: 'GET', url: '/v1/logo/apple.com' })).rawPayload)).toBe(200);
  });
  it('reads image widths', () => {
    expect(imageWidth(png(64))).toBe(64);
    const ico = Buffer.alloc(40); ico.writeUInt16LE(1, 2); ico.writeUInt16LE(2, 4); ico[6] = 16; ico[22] = 0; // 16 px and 256 px entries
    expect(imageWidth(ico)).toBe(256);
    const gif = Buffer.alloc(30); gif.write('GIF89a'); gif.writeUInt16LE(120, 6);
    expect(imageWidth(gif)).toBe(120);
    expect(imageWidth(Buffer.from('not an image at all, really'))).toBeNull();
  });
});

describe('product photos', () => {
  it('finds a missing photo on Wikipedia (only a matching article) and fills it in on first view', async () => {
    const ideapad = (await db.query.products.findFirst({ where: eq(products.model, '83HW0021AX') }))!;
    await db.update(products).set({ imageUrl: null }).where(eq(products.id, ideapad.id));
    (ctx.media as any).tried.clear();
    (ctx.media as any).opts.fetcher = async (url: string) => {
      if (url.startsWith('https://en.wikipedia.org/')) {
        expect(decodeURIComponent(url)).toContain('gsrsearch=Lenovo IdeaPad Slim 5');
        return res(url, 200, 'application/json', JSON.stringify({ query: { pages: [
          { title: 'Slim (film)', index: 1, thumbnail: { source: 'https://upload.wikimedia.org/film.jpg' } },
          { title: 'IdeaPad', index: 2, thumbnail: { source: 'https://upload.wikimedia.org/ideapad.jpg' } },
        ] } }));
      }
      if (url === 'https://upload.wikimedia.org/ideapad.jpg') return res(url, 200, 'image/png', png(800));
      return res(url, 404, 'text/plain', '');
    };
    const p = (await app.inject({ method: 'GET', url: `/v1/products/${ideapad.id}` })).json();
    expect(p.imageUrl).toBe('https://upload.wikimedia.org/ideapad.jpg');
    expect((await db.query.products.findFirst({ where: eq(products.id, ideapad.id) }))!.imageUrl).toBe('https://upload.wikimedia.org/ideapad.jpg');
  });
  it('uses image search when configured, preferring store hosts, and skips broken or tiny images', async () => {
    const iphone = (await db.query.products.findFirst({ where: eq(products.name, 'iPhone 16 · 128GB') }))!;
    await db.update(products).set({ imageUrl: null }).where(eq(products.id, iphone.id));
    (ctx.media as any).tried.clear();
    (ctx.media as any).opts.braveKey = 'brave-key';
    const sentKey: string[] = [];
    (ctx.media as any).opts.fetcher = async (url: string, o: { headers?: Record<string, string> }) => {
      if (url.startsWith('https://api.search.brave.com/')) {
        sentKey.push(o.headers?.['x-subscription-token'] ?? '');
        return res(url, 200, 'application/json', JSON.stringify({ results: [
          { properties: { url: 'https://random.example/iphone.jpg' }, thumbnail: { src: 'https://imgs.search.brave.com/a' } },
          { properties: { url: 'https://www.jarir.com/media/iphone16.jpg' }, thumbnail: { src: 'https://imgs.search.brave.com/b' } },
        ] }));
      }
      if (url === 'https://www.jarir.com/media/iphone16.jpg') return res(url, 200, 'image/png', png(40)); // too small
      if (url === 'https://imgs.search.brave.com/b') return res(url, 200, 'image/jpeg', Buffer.from([0xff, 0xd8, ...Array(30).fill(0)]));
      return res(url, 404, 'text/plain', '');
    };
    const p = (await app.inject({ method: 'GET', url: `/v1/products/${iphone.id}` })).json();
    expect(sentKey).toEqual(['brave-key']);
    expect(p.imageUrl).toBe('https://imgs.search.brave.com/b');
    (ctx.media as any).opts.braveKey = undefined;
  });
});

describe('warm-up', () => {
  it('fetches store logos (kept on disk across restarts) and missing product photos at startup', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'logos-'));
    let calls = 0;
    const fetcher = async (url: string, kind: string) => { calls++; return kind === 'html' ? res(url, 404, 'text/html', '') : res(url, 200, 'image/png', png(128)); };
    const lines: string[] = [];
    const photo = (await db.query.products.findFirst({ where: eq(products.name, 'AirPods 4') }))!;
    await db.update(products).set({ imageUrl: null }).where(eq(products.id, photo.id));
    (ctx.media as any).tried.clear();
    (ctx.media as any).opts.fetcher = async (url: string) => url.startsWith('https://en.wikipedia.org/')
      ? res(url, 200, 'application/json', JSON.stringify({ query: { pages: [{ title: 'AirPods 4', index: 1, thumbnail: { source: 'https://upload.wikimedia.org/airpods4.jpg' } }] } }))
      : url === 'https://upload.wikimedia.org/airpods4.jpg' ? res(url, 200, 'image/png', png(800)) : res(url, 404, 'text/plain', '');
    await warmUp(db, new LogoService(fetcher, { dir }), ctx.media, (m) => lines.push(m));
    expect(lines[0]).toMatch(/^warm-up: (\d+)\/\1 store logos, \d+\/\d+ product photos found$/);
    expect((await db.query.products.findFirst({ where: eq(products.id, photo.id) }))!.imageUrl).toBe('https://upload.wikimedia.org/airpods4.jpg');
    // a "restarted" server reads logos from disk instead of fetching again
    const before = calls;
    const again = new LogoService(fetcher, { dir });
    expect(imageWidth((await again.get('jarir.com'))!.body)).toBe(128);
    expect(calls).toBe(before);
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
