import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import type { Ctx } from '../src/app';
import type { DB } from '../src/db/client';
import { dataSources, offers, products } from '../src/db/schema';
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

describe('online discovery (scripted model)', () => {
  it('reports unavailable without an API key', async () => {
    const g = await guest(app);
    const r = await app.inject({ method: 'POST', url: '/v1/products/discover', headers: g.h, payload: { q: 'Dyson V15' } });
    expect(r.json()).toEqual({ status: 'unavailable', results: [] });
  });

  it('requires a session and validates input', async () => {
    expect((await app.inject({ method: 'POST', url: '/v1/products/discover', payload: { q: 'Dyson V15' } })).statusCode).toBe(401);
    const g = await guest(app);
    expect((await app.inject({ method: 'POST', url: '/v1/products/discover', headers: g.h, payload: { q: 'x', gtin: '123' } })).statusCode).toBe(400);
  });

  it('keeps only prices whose page came back from web search and belongs to a known store', async () => {
    const fake = fakeClient([
      () => msg([
        { type: 'server_tool_use', id: 'srv1', name: 'web_search', input: { query: 'Dyson V15 Detect price' } },
        searchResult('https://www.amazon.sa/dp/B0DYSON15?ref=x', 'https://www.dyson.sa/v15-detect', 'https://evil.example/dyson'),
      ], 'pause_turn'),
      (req) => {
        expect(req.messages).toHaveLength(2); // paused turn was resumed, not re-asked
        return msg([{ type: 'tool_use', id: 't1', name: 'submit_products', input: { products: [{
          name: 'Dyson V15 Detect Absolute', name_ar: 'دايسون V15 ديتكت', brand: 'Dyson', model: 'SV47', category: 'home', gtin: null,
          image_url: 'https://evil.example/pixel.png', spec_source_url: 'https://www.dyson.sa/v15-detect',
          specs: [{ label: 'Run time', label_ar: 'مدة التشغيل', value: 'Up to 60 min' }],
          offers: [
            { url: 'https://www.amazon.sa/dp/B0DYSON15', price: 2799, in_stock: true },     // seen + known store → kept
            { url: 'https://www.noon.com/dyson-v15', price: 1999, in_stock: true },         // never returned by search → dropped
            { url: 'https://evil.example/dyson', price: 99, in_stock: true },               // not a store → dropped
          ],
        }] } }]);
      },
    ]);
    (ctx.discovery as any).client = fake;
    const g = await guest(app);
    const r = (await app.inject({ method: 'POST', url: '/v1/products/discover', headers: g.h, payload: { q: 'دايسون V15' } })).json();
    expect(r.status).toBe('found');
    expect(r.results[0]).toMatchObject({ name: 'Dyson V15 Detect Absolute', offerCount: 1, bestPriceMinor: 279900, imageUrl: null });
    const p = await db.query.products.findFirst({ where: eq(products.id, r.results[0].id) });
    expect(p!.specSourceUrl).toBe('https://www.dyson.sa/v15-detect');
    const rows = await db.select({ url: offers.url, type: dataSources.type }).from(offers).innerJoin(dataSources, eq(dataSources.id, offers.sourceId)).where(eq(offers.productId, p!.id));
    expect(rows).toEqual([{ url: 'https://www.amazon.sa/dp/B0DYSON15?ref=x', type: 'web_search' }]);
    // the offer is shown as a web price, never high confidence
    const o = (await app.inject({ method: 'GET', url: `/v1/products/${p!.id}/offers` })).json();
    expect(o.offers[0]).toMatchObject({ sourceType: 'web_search', confidence: 'medium' });
    expect(fake.calls[0].tools[0].type).toBe('web_search_20260209');

    // same query again (any spelling that normalises the same) is served from cache, no model call
    const again = (await app.inject({ method: 'POST', url: '/v1/products/discover', headers: g.h, payload: { q: 'دايسون v15' } })).json();
    expect(again.results[0].id).toBe(r.results[0].id);
    expect(fake.calls).toHaveLength(2);
    // and the catalog search finds it now
    const s = (await app.inject({ method: 'GET', url: `/v1/products/search?q=${encodeURIComponent('دايسون')}` })).json();
    expect(s.results[0].id).toBe(r.results[0].id);
  });

  it('records a miss when nothing matches', async () => {
    (ctx.discovery as any).client = fakeClient([() => msg([{ type: 'tool_use', id: 't', name: 'submit_products', input: { products: [] } }])]);
    const g = await guest(app);
    const r = (await app.inject({ method: 'POST', url: '/v1/products/discover', headers: g.h, payload: { q: 'qwertyuiop gadget' } })).json();
    expect(r).toEqual({ status: 'not_found', results: [] });
  });
});
