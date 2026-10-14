import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import type { Ctx } from '../src/app';
import type { DB } from '../src/db/client';
import { dataSources, notifications, offers, products, stores, users, watches } from '../src/db/schema';
import { checkWatches } from '../src/services/alerts';
import { admin, guest, setup } from './helpers';

let app: FastifyInstance;
let ctx: Ctx;
let db: DB;
let ideapadId: string;
const IDEAPAD_EAN = '0197529846216';

beforeAll(async () => {
  ({ app, ctx, db } = await setup());
  const p = await db.query.products.findFirst({ where: eq(products.model, '83HW0021AX') });
  ideapadId = p!.id;
});
afterAll(async () => {
  await app.close();
  await db.$client.end();
});

describe('security basics', () => {
  it('sets security headers and hides internals on 404', async () => {
    const r = await app.inject({ method: 'GET', url: '/nope' });
    expect(r.statusCode).toBe(404);
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['content-security-policy']).toContain("default-src 'none'");
    expect(r.json()).toEqual({ error: { code: 'not_found', message: 'Not found' } });
  });
  it('only allows configured CORS origins', async () => {
    const ok = await app.inject({ method: 'OPTIONS', url: '/v1/stores', headers: { origin: 'http://admin.test', 'access-control-request-method': 'GET' } });
    expect(ok.headers['access-control-allow-origin']).toBe('http://admin.test');
    const bad = await app.inject({ method: 'OPTIONS', url: '/v1/stores', headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' } });
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });
  it('rejects forged and malformed tokens', async () => {
    const forged = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4Iiwicm9sZSI6ImFkbWluIn0.AAAA';
    expect((await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${forged}` } })).statusCode).toBe(401);
    const none = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.';
    expect((await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${none}` } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: 'Basic abc' } })).statusCode).toBe(401);
  });
  it('validates input and does not leak stack traces', async () => {
    const r = await app.inject({ method: 'GET', url: '/v1/products/not-a-uuid' });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe('validation_error');
    expect(r.body).not.toContain('at ');
  });
});

describe('auth', () => {
  it('guest → member upgrade keeps the same account', async () => {
    const g = await guest(app, { name: 'سعود', lang: 'ar' });
    expect(g.user.kind).toBe('guest');
    const r = await app.inject({ method: 'POST', url: '/v1/auth/register', headers: g.h, payload: { email: 'Saud@Example.com', password: 'Very-Strong-Pass-1' } });
    expect(r.statusCode).toBe(201);
    expect(r.json().user.id).toBe(g.user.id);
    expect(r.json().user.email).toBe('saud@example.com');
    // old guest refresh token was revoked on upgrade
    expect((await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: g.refresh } })).statusCode).toBe(401);
  });
  it('rejects weak passwords and duplicate emails', async () => {
    expect((await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { email: 'a@b.co', password: 'aaaaaaaaaaaa' } })).json().error.code).toBe('weak_password');
    expect((await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { email: 'saud@example.com', password: 'Another-Strong-1' } })).statusCode).toBe(409);
  });
  it('locks the account after repeated failures without revealing whether it exists', async () => {
    await app.inject({ method: 'POST', url: '/v1/auth/register', payload: { email: 'lock@example.com', password: 'Correct-Horse-9' } });
    const unknown = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'nobody@example.com', password: 'x' } });
    const wrong = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'lock@example.com', password: 'x' } });
    expect(unknown.json()).toEqual(wrong.json());
    await db.update(users).set({ failedLogins: 4 }).where(eq(users.email, 'lock@example.com'));
    await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'lock@example.com', password: 'x' } });
    const locked = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'lock@example.com', password: 'Correct-Horse-9' } });
    expect(locked.statusCode).toBe(423);
  });
  it('rotates refresh tokens and revokes the family on reuse', async () => {
    const g = await guest(app);
    const r1 = await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: g.refresh } });
    expect(r1.statusCode).toBe(200);
    const next = r1.json().refreshToken;
    const reuse = await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: g.refresh } });
    expect(reuse.json().error.code).toBe('refresh_reused');
    // the stolen-family's newest token is now dead too
    expect((await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: next } })).statusCode).toBe(401);
  });
});

describe('catalog & prices', () => {
  it('searches by name and model', async () => {
    const r = await app.inject({ method: 'GET', url: '/v1/products/search?q=ideapad' });
    expect(r.json().results[0].name).toContain('IdeaPad');
    const wild = await app.inject({ method: 'GET', url: '/v1/products/search?q=%25' });
    expect(wild.json().results).toHaveLength(0); // LIKE wildcards are escaped
  });
  it('ranks offers by value with explanations, and by cheapest final price', async () => {
    const v = (await app.inject({ method: 'GET', url: `/v1/products/${ideapadId}/offers?sort=value` })).json();
    expect(v.offers[0].store.name).toBe('Jarir');
    expect(v.offers[0].reasons).toContain('longer_warranty');
    expect(v.offers.every((o: { isDemo: boolean }) => o.isDemo)).toBe(true);
    const c = (await app.inject({ method: 'GET', url: `/v1/products/${ideapadId}/offers?sort=cheapest` })).json();
    expect(c.offers[0].store.name).toBe('noon');
    expect(c.offers[0].finalMinor).toBe(277800);
    expect(v.sponsored).toHaveLength(1); // ads are separate from organic offers
    expect(v.offers.some((o: { store: { name: string } }) => o.store.name === 'SACO')).toBe(false);
  });
  it('uses location only to compute distance', async () => {
    const r = (await app.inject({ method: 'GET', url: `/v1/products/${ideapadId}/offers?sort=nearest&lat=24.69&lng=46.68` })).json();
    expect(r.offers[0].channel).toBe('local');
    expect(r.offers[0].branch.distanceKm).toBeLessThan(2);
  });
  it('reports price history with its real coverage', async () => {
    const h = (await app.inject({ method: 'GET', url: `/v1/products/${ideapadId}/history` })).json();
    expect(h.stats.coverageDays).toBeGreaterThan(80);
    expect(h.stats.lowMinor).toBe(273800);
    expect(h.stats.currentMinor).toBe(277800);
    expect(h.advice).toBe('buy_now');
  });
  it('planned markets fall back to launch-market prices and say so', async () => {
    const g = await guest(app, { country: 'US' });
    const r = (await app.inject({ method: 'GET', url: `/v1/products/${ideapadId}/offers`, headers: g.h })).json();
    expect(r.currency).toBe('SAR');
    expect(r.coverage).toMatchObject({ market: 'SA', live: false });
  });
});

describe('scan', () => {
  it('matches a barcode exactly', async () => {
    const r = (await app.inject({ method: 'POST', url: '/v1/scan', payload: { raw: IDEAPAD_EAN } })).json();
    expect(r.kind).toBe('gtin');
    expect(r.match.product.id).toBe(ideapadId);
    expect(r.match.confidence).toBe(1);
  });
  it('treats QR links as links with a safety verdict, never as products', async () => {
    const r = (await app.inject({ method: 'POST', url: '/v1/scan', payload: { raw: 'http://user:pw@10.0.0.1/login' } })).json();
    expect(r.kind).toBe('url');
    expect(r.match).toBeNull();
    expect(r.url.risk).toBe('blocked');
  });
  it('unknown text yields candidates for the user to confirm, not a guessed match', async () => {
    const r = (await app.inject({ method: 'POST', url: '/v1/scan', payload: { raw: 'MacBook Air' } })).json();
    expect(r.match).toBeNull();
    expect(r.candidates.length).toBeGreaterThan(0);
  });
});

describe('outbound links', () => {
  it('redirects only to the store allow-list', async () => {
    const o = await db.query.offers.findFirst({ where: eq(offers.productId, ideapadId) });
    const ok = await app.inject({ method: 'GET', url: `/r/${o!.id}` });
    expect(ok.statusCode).toBe(302);
    await db.update(offers).set({ url: 'https://evil.example/phish' }).where(eq(offers.id, o!.id));
    expect((await app.inject({ method: 'GET', url: `/r/${o!.id}` })).statusCode).toBe(404);
    await db.update(offers).set({ url: 'https://www.jarir.com/' }).where(eq(offers.id, o!.id));
  });
});

describe('watchlist & alerts', () => {
  it('enforces ownership (no IDOR) and plan limits', async () => {
    const a = await guest(app);
    const b = await guest(app);
    const created = await app.inject({ method: 'POST', url: '/v1/watches', headers: a.h, payload: { productId: ideapadId, targetMinor: 260000 } });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;
    expect((await app.inject({ method: 'DELETE', url: `/v1/watches/${id}`, headers: b.h })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PATCH', url: `/v1/watches/${id}`, headers: b.h, payload: { targetMinor: 1 } })).statusCode).toBe(404);
    const others = await db.select().from(products).limit(4);
    const codes = [];
    for (const p of others) codes.push((await app.inject({ method: 'POST', url: '/v1/watches', headers: a.h, payload: { productId: p.id, targetMinor: 100 } })).statusCode);
    expect(codes).toContain(402);
  });
  it('notifies once when a trusted price reaches the target', async () => {
    const g = await guest(app, { lang: 'en' });
    await app.inject({ method: 'POST', url: '/v1/watches', headers: g.h, payload: { productId: ideapadId, targetMinor: 280000 } });
    await checkWatches(db, ctx.catalog);
    await checkWatches(db, ctx.catalog);
    const n = await db.select().from(notifications).where(eq(notifications.userId, g.user.id));
    expect(n).toHaveLength(1);
    expect(n[0]!.title).toContain('Target price hit');
    const list = (await app.inject({ method: 'GET', url: '/v1/watches', headers: g.h })).json();
    expect(list[0].hit).toBe(true);
  });
});

describe('assistant (rule-based mode)', () => {
  it('runs the laptop consultation and recommends with live catalog prices', async () => {
    const g = await guest(app);
    const say = async (message: string, conversationId?: string) =>
      (await app.inject({ method: 'POST', url: '/v1/assistant/chat', headers: g.h, payload: { message, conversationId, lang: 'ar' } })).json();
    let r = await say('أبي لابتوب للعمل، بس ما أعرف وش أختار');
    expect(r.messages[1].chips.length).toBeGreaterThan(0);
    const cid = r.conversationId;
    r = await say('مستندات وتصفح واجتماعات', cid);
    r = await say('حوالي 3,000 ر.س', cid);
    r = await say('البطارية والخفة', cid);
    const recs = r.messages[1].recommendations;
    expect(recs.length).toBeGreaterThanOrEqual(2);
    const best = recs.find((x: { label: string }) => x.label === 'best_value');
    expect(best.name).toContain('IdeaPad');
    expect(best.priceMinor).toBe(277800); // from the database, not the model
    r = await say('راقب السعر لي', cid);
    expect(r.effects[0].type).toBe('watch_added');
  });
  it('product chat answers from real offers and history', async () => {
    const g = await guest(app, { lang: 'en' });
    const start = (await app.inject({ method: 'POST', url: '/v1/assistant/conversations', headers: g.h, payload: { productIds: [ideapadId], lang: 'en' } })).json();
    expect(start.messages[0].text).toContain('IdeaPad');
    const r = (await app.inject({ method: 'POST', url: '/v1/assistant/chat', headers: g.h, payload: { conversationId: start.conversationId, message: 'Is the current price a good deal?', lang: 'en' } })).json();
    expect(r.messages[1].facts.join(' ')).toContain('2,738');
    expect(r.messages[1].opinion).toMatch(/not guaranteed/);
  });
  it('keeps conversations private', async () => {
    const a = await guest(app);
    const b = await guest(app);
    const r = (await app.inject({ method: 'POST', url: '/v1/assistant/chat', headers: a.h, payload: { message: 'hello', lang: 'en' } })).json();
    expect((await app.inject({ method: 'GET', url: `/v1/assistant/conversations/${r.conversationId}`, headers: b.h })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/v1/assistant/chat', headers: b.h, payload: { conversationId: r.conversationId, message: 'hi', lang: 'en' } })).statusCode).toBe(403);
  });
});

describe('privacy controls', () => {
  it('turning memory off deletes saved preferences; export and delete work', async () => {
    const g = await guest(app);
    await app.inject({ method: 'POST', url: '/v1/me/preferences', headers: g.h, payload: { text: 'Prefers in-store pickup' } });
    expect((await app.inject({ method: 'GET', url: '/v1/me/preferences', headers: g.h })).json()).toHaveLength(1);
    await app.inject({ method: 'PATCH', url: '/v1/me', headers: g.h, payload: { memoryEnabled: false } });
    expect((await app.inject({ method: 'GET', url: '/v1/me/preferences', headers: g.h })).json()).toHaveLength(0);
    const exp = await app.inject({ method: 'GET', url: '/v1/me/export', headers: g.h });
    expect(exp.json().profile.id).toBe(g.user.id);
    expect(exp.headers['cache-control']).toBe('no-store');
    expect((await app.inject({ method: 'DELETE', url: '/v1/me', headers: g.h })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/v1/me', headers: g.h })).statusCode).toBe(401);
  });
});

describe('admin & data pipeline', () => {
  it('is admin-only', async () => {
    const g = await guest(app);
    expect((await app.inject({ method: 'GET', url: '/v1/admin/stats', headers: g.h })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/v1/admin/stats' })).statusCode).toBe(401);
  });
  it('requires a documented legal basis before a source goes live', async () => {
    const h = await admin(app);
    const store = await db.query.stores.findFirst({ where: eq(stores.slug, 'jarir') });
    const r = await app.inject({ method: 'POST', url: '/v1/admin/sources', headers: h, payload: { name: 'X', type: 'affiliate_feed', storeId: store!.id, active: true } });
    expect(r.json().error.code).toBe('terms_required');
  });
  it('imports listings: matches by GTIN, flags outliers, queues unknowns, rejects bad links', async () => {
    const h = await admin(app);
    const store = await db.query.stores.findFirst({ where: eq(stores.slug, 'jarir') });
    const src = (await app.inject({ method: 'POST', url: '/v1/admin/sources', headers: h, payload: { name: 'Jarir partner feed', type: 'partner_catalog', storeId: store!.id, active: true, termsNote: 'Partner agreement #42' } })).json();
    const report = (await app.inject({
      method: 'POST', url: `/v1/admin/sources/${src.id}/import`, headers: h,
      payload: {
        listings: [
          { externalId: 'a', title: 'IdeaPad', gtin: IDEAPAD_EAN, priceMinor: 279900, currency: 'SAR', channel: 'online', stock: 'in_stock', url: 'https://www.jarir.com/p/1' },
          { externalId: 'b', title: 'IdeaPad suspicious', gtin: IDEAPAD_EAN, priceMinor: 99900, currency: 'SAR', channel: 'online', url: 'https://www.jarir.com/p/2' },
          { externalId: 'c', title: 'Unknown gadget', priceMinor: 10000, currency: 'SAR', channel: 'online' },
          { externalId: 'd', title: 'Wrong currency', gtin: IDEAPAD_EAN, priceMinor: 10000, currency: 'USD', channel: 'online' },
          { externalId: 'e', title: 'Bad link', gtin: IDEAPAD_EAN, priceMinor: 279900, currency: 'SAR', channel: 'online', url: 'https://evil.example/' },
        ],
      },
    })).json();
    expect(report).toMatchObject({ received: 5, created: 2, flagged: 1, unmatched: 1 });
    expect(report.rejected).toHaveLength(2);
    // flagged offer is hidden from users
    const pub = (await app.inject({ method: 'GET', url: `/v1/products/${ideapadId}/offers?sort=cheapest` })).json();
    expect(pub.offers.some((o: { finalMinor: number }) => o.finalMinor === 99900)).toBe(false);
    const stats = (await app.inject({ method: 'GET', url: '/v1/admin/stats', headers: h })).json();
    expect(stats.flaggedOffers).toBe(1);
    expect(stats.unmatchedListings).toBe(1);
    const audit = (await app.inject({ method: 'GET', url: '/v1/admin/audit', headers: h })).json();
    expect(audit.some((a: { action: string }) => a.action === 'import')).toBe(true);
    void dataSources;
  });
  it('blocks SSRF in feed fetching', async () => {
    const h = await admin(app);
    const store = await db.query.stores.findFirst({ where: eq(stores.slug, 'noon') });
    const src = (await app.inject({ method: 'POST', url: '/v1/admin/sources', headers: h, payload: { name: 'feed', type: 'affiliate_feed', storeId: store!.id, feedUrl: 'https://127.0.0.1/feed.json' } })).json();
    const r = await app.inject({ method: 'POST', url: `/v1/admin/sources/${src.id}/fetch`, headers: h });
    expect(r.json().error.message).toBe('feed_url_not_public');
  });
  it('home aggregates savings, watches and local deals', async () => {
    const g = await guest(app);
    const offersRes = (await app.inject({ method: 'GET', url: `/v1/products/${ideapadId}/offers?sort=value` })).json();
    const p = await app.inject({ method: 'POST', url: '/v1/purchases', headers: g.h, payload: { offerId: offersRes.offers[1].id } });
    expect(p.json().savedMinor).toBeGreaterThanOrEqual(0);
    const home = (await app.inject({ method: 'GET', url: '/v1/home', headers: g.h })).json();
    expect(home.savings.purchases).toBe(1);
    expect(home.localDeals.length).toBeGreaterThan(0);
    expect(home.suggestions).toHaveLength(3);
    void watches;
  });
});
