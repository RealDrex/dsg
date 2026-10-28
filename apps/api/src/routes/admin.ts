import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, count, desc, eq, gte, ilike, isNull, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { normalizeGtin } from '@bestprice/core';
import { parse, requireAdmin, noStore, type Ctx } from '../app';
import {
  assistantUsage, auditLogs, branches, clickEvents, dataSources, discoveryRuns, offers, priceObservations, productGtins, products,
  sponsoredPlacements, stores, unmatchedListings, users, watches,
} from '../db/schema';
import { badRequest, conflict, notFound } from '../lib/errors';
import { fetchPublicJson } from '../lib/http';
import { isValidAffiliate } from '../lib/affiliate';
import { importListings, Listing, matchKey } from '../ingest/pipeline';

const IdParam = z.object({ id: z.string().uuid() });
const Page = z.object({ q: z.string().trim().max(120).optional(), page: z.coerce.number().int().min(1).max(10_000).default(1) });
const PAGE = 25;

const SpecRow = z.object({ key: z.string().max(40), label: z.string().max(80), labelAr: z.string().max(80), value: z.string().max(120) });
const ProductIn = z.object({
  name: z.string().trim().min(1).max(200),
  nameAr: z.string().trim().max(200).nullable().optional(),
  brand: z.string().trim().max(80).nullable().optional(),
  model: z.string().trim().max(120).nullable().optional(),
  category: z.string().trim().min(1).max(40),
  imageUrl: z.string().url().startsWith('https://').max(2048).nullable().optional(),
  attributes: z.record(z.union([z.number(), z.string().max(120), z.boolean()])).optional(),
  specs: z.array(SpecRow).max(40).optional(),
  specSourceLabel: z.string().max(200).nullable().optional(),
  specSourceUrl: z.string().url().startsWith('https://').max(2048).nullable().optional(),
  description: z.string().max(4000).nullable().optional(),
  status: z.enum(['active', 'hidden']).optional(),
  gtins: z.array(z.string()).max(20).optional(),
});
const domain = z.string().trim().toLowerCase().regex(/^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/);
const StoreIn = z.object({
  slug: z.string().regex(/^[a-z0-9-]{2,40}$/),
  name: z.string().trim().min(1).max(80),
  nameAr: z.string().trim().min(1).max(80),
  logoUrl: z.string().url().startsWith('https://').nullable().optional(),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  website: z.string().url().startsWith('https://').nullable().optional(),
  allowedDomains: z.array(domain).max(10).default([]),
  country: z.string().regex(/^[A-Z]{2}$/).default('SA'),
  affiliate: z.string().trim().max(600).refine(isValidAffiliate, 'Use query parameters like tag=yourid-21, or an https template from a known affiliate network containing {url}').nullable().optional(),
  active: z.boolean().optional(),
});
const BranchIn = z.object({ name: z.string().max(80), nameAr: z.string().max(80), city: z.string().max(60), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
const SourceIn = z.object({
  name: z.string().trim().min(1).max(120),
  type: z.enum(['official_api', 'partner_catalog', 'affiliate_feed', 'user_report', 'demo']),
  storeId: z.string().uuid().nullable(),
  country: z.string().regex(/^[A-Z]{2}$/).default('SA'),
  active: z.boolean().default(false),
  termsNote: z.string().max(1000).default(''),
  feedUrl: z.string().url().startsWith('https://').nullable().optional(),
});
const SponsoredIn = z.object({
  productId: z.string().uuid().nullable().optional(),
  storeId: z.string().uuid(),
  label: z.string().max(120),
  labelAr: z.string().max(120),
  priceMinor: z.number().int().positive().nullable().optional(),
  url: z.string().url().startsWith('https://'),
  endsAt: z.coerce.date().nullable().optional(),
  active: z.boolean().default(true),
});

export async function adminRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db, cfg } = ctx;
  app.addHook('onRequest', async (req) => { requireAdmin(req); });
  app.addHook('onSend', async (_req, reply) => { noStore(reply); });

  const audit = (req: FastifyRequest, action: string, entity: string, entityId: string | null, data?: unknown) =>
    db.insert(auditLogs).values({ actorId: req.user!.id, action, entity, entityId, data: data as object });

  /* ------------------------------ Overview ------------------------------ */
  /** Web search runs and their estimated cost: today, this month, and how many were answered from cache. */
  const webSearchSpend = async () => {
    const day = new Date(); day.setUTCHours(0, 0, 0, 0);
    const month = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1));
    const agg = (since: Date) => db.select({ runs: sql<number>`count(*)`.mapWith(Number), micros: sql<number>`coalesce(sum(${discoveryRuns.costMicros}), 0)`.mapWith(Number) })
      .from(discoveryRuns).where(gte(discoveryRuns.createdAt, since));
    const [[t], [m]] = await Promise.all([agg(day), agg(month)]);
    return {
      runsToday: t?.runs ?? 0, costTodayUsd: (t?.micros ?? 0) / 1e6, runsMonth: m?.runs ?? 0, costMonthUsd: (m?.micros ?? 0) / 1e6,
      dailyBudgetUsd: cfg.DISCOVERY_DAILY_BUDGET_USD, model: cfg.DISCOVERY_MODEL, available: ctx.discovery.available,
    };
  };

  app.get('/stats', async () => {
    const staleBefore = new Date(Date.now() - 7 * 86_400_000);
    const weekAgo = new Date(Date.now() - 7 * 86_400_000);
    const today = new Date().toISOString().slice(0, 10);
    const one = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
    const n = sql<number>`count(*)`.mapWith(Number);
    const [productsN, covered, offersN, flagged, stale, unmatched, sourcesActive, members, guests, watchesN, clicks7d, assistantToday] = await Promise.all([
      one(db.select({ n }).from(products).where(eq(products.status, 'active'))),
      one(db.select({ n: sql<number>`count(distinct ${offers.productId})`.mapWith(Number) }).from(offers).where(and(eq(offers.active, true), eq(offers.flagged, false), sql`${offers.observedAt} >= ${staleBefore}`))),
      one(db.select({ n }).from(offers).where(eq(offers.active, true))),
      one(db.select({ n }).from(offers).where(and(eq(offers.active, true), eq(offers.flagged, true)))),
      one(db.select({ n }).from(offers).where(and(eq(offers.active, true), lt(offers.observedAt, staleBefore)))),
      one(db.select({ n }).from(unmatchedListings).where(isNull(unmatchedListings.resolvedAt))),
      one(db.select({ n }).from(dataSources).where(eq(dataSources.active, true))),
      one(db.select({ n }).from(users).where(eq(users.kind, 'member'))),
      one(db.select({ n }).from(users).where(eq(users.kind, 'guest'))),
      one(db.select({ n }).from(watches)),
      one(db.select({ n }).from(clickEvents).where(sql`${clickEvents.createdAt} >= ${weekAgo}`)),
      one(db.select({ n: sql<number>`coalesce(sum(${assistantUsage.count}),0)`.mapWith(Number) }).from(assistantUsage).where(eq(assistantUsage.day, today))),
    ]);
    return {
      products: productsN, productsWithFreshPrices: covered, priceCoverage: productsN ? covered / productsN : 0,
      offers: offersN, flaggedOffers: flagged, staleOffers: stale, unmatchedListings: unmatched, activeSources: sourcesActive,
      members, guests, watches: watchesN, clicks7d, assistantMessagesToday: assistantToday, assistantMode: ctx.assistant.mode,
      webSearch: await webSearchSpend(),
    };
  });

  /* ------------------------------ Products ------------------------------ */
  app.get('/products', async (req) => {
    const q = parse(Page, req.query);
    const where = q.q ? or(ilike(products.name, `%${q.q.replace(/[\\%_]/g, (c) => '\\' + c)}%`), ilike(products.brand, `%${q.q.replace(/[\\%_]/g, (c) => '\\' + c)}%`)) : undefined;
    const rows = await db
      .select({ p: products, offers: sql<number>`(select count(*) from ${offers} where ${offers.productId} = ${products.id} and ${offers.active})`.mapWith(Number) })
      .from(products).where(where).orderBy(desc(products.createdAt)).limit(PAGE).offset((q.page - 1) * PAGE);
    const [total] = await db.select({ n: count() }).from(products).where(where);
    return { items: rows.map((r) => ({ ...r.p, offerCount: r.offers })), total: total?.n ?? 0, page: q.page, pageSize: PAGE };
  });

  app.get('/products/:id', async (req) => {
    const { id } = parse(IdParam, req.params);
    const p = await db.query.products.findFirst({ where: eq(products.id, id) });
    if (!p) throw notFound();
    const gtins = await db.select().from(productGtins).where(eq(productGtins.productId, id));
    const os = await db.select({ o: offers, s: stores.name, src: dataSources.name }).from(offers).innerJoin(stores, eq(stores.id, offers.storeId)).innerJoin(dataSources, eq(dataSources.id, offers.sourceId)).where(eq(offers.productId, id)).orderBy(offers.priceMinor);
    return { ...p, gtins: gtins.map((g) => g.gtin), offers: os.map((r) => ({ ...r.o, storeName: r.s, sourceName: r.src })) };
  });

  const saveGtins = async (productId: string, gtins: string[] | undefined) => {
    if (!gtins) return;
    const norm = gtins.map((g) => normalizeGtin(g));
    if (norm.some((g) => !g)) throw badRequest('invalid_gtin', 'One or more barcodes have an invalid check digit');
    for (const g of norm as string[]) {
      const other = await db.query.productGtins.findFirst({ where: eq(productGtins.gtin, g) });
      if (other && other.productId !== productId) throw conflict('gtin_in_use', `Barcode ${g} already belongs to another product`);
    }
    await db.delete(productGtins).where(eq(productGtins.productId, productId));
    if (norm.length) await db.insert(productGtins).values((norm as string[]).map((g) => ({ gtin: g, productId }))).onConflictDoNothing();
  };

  app.post('/products', async (req, reply) => {
    const body = parse(ProductIn, req.body);
    const { gtins, ...data } = body;
    const [p] = await db.insert(products).values({ ...data, matchKey: matchKey(data.brand, data.model) }).returning();
    await saveGtins(p!.id, gtins);
    await audit(req, 'create', 'product', p!.id, body);
    return reply.status(201).send(p);
  });

  app.patch('/products/:id', async (req) => {
    const { id } = parse(IdParam, req.params);
    const body = parse(ProductIn.partial(), req.body);
    const { gtins, ...data } = body;
    const existing = await db.query.products.findFirst({ where: eq(products.id, id) });
    if (!existing) throw notFound();
    const brand = data.brand !== undefined ? data.brand : existing.brand;
    const model = data.model !== undefined ? data.model : existing.model;
    const [p] = await db.update(products).set({ ...data, matchKey: matchKey(brand, model) }).where(eq(products.id, id)).returning();
    await saveGtins(id, gtins);
    await audit(req, 'update', 'product', id, body);
    return p;
  });

  /* ------------------------------- Stores ------------------------------- */
  app.get('/stores', async () => {
    const rows = await db.select().from(stores).orderBy(stores.name);
    const bs = await db.select().from(branches);
    return rows.map((s) => ({ ...s, branches: bs.filter((b) => b.storeId === s.id) }));
  });
  app.post('/stores', async (req, reply) => {
    const body = parse(StoreIn, req.body);
    const [s] = await db.insert(stores).values(body).returning();
    await audit(req, 'create', 'store', s!.id, body);
    return reply.status(201).send(s);
  });
  app.patch('/stores/:id', async (req) => {
    const { id } = parse(IdParam, req.params);
    const body = parse(StoreIn.partial(), req.body);
    const [s] = await db.update(stores).set(body).where(eq(stores.id, id)).returning();
    if (!s) throw notFound();
    await audit(req, 'update', 'store', id, body);
    return s;
  });
  app.post('/stores/:id/branches', async (req, reply) => {
    const { id } = parse(IdParam, req.params);
    const body = parse(BranchIn, req.body);
    const [b] = await db.insert(branches).values({ ...body, storeId: id }).returning();
    await audit(req, 'create', 'branch', b!.id, body);
    return reply.status(201).send(b);
  });
  app.delete('/branches/:id', async (req, reply) => {
    const { id } = parse(IdParam, req.params);
    await db.delete(branches).where(eq(branches.id, id));
    await audit(req, 'delete', 'branch', id);
    return reply.status(204).send();
  });

  /* ---------------------------- Data sources ---------------------------- */
  app.get('/sources', async () => db.select().from(dataSources).orderBy(dataSources.name));
  const assertActivatable = (s: { active?: boolean; termsNote?: string }) => {
    if (s.active && !s.termsNote?.trim()) throw badRequest('terms_required', 'Document the legal basis (API terms, partner agreement, affiliate program) before activating a source');
  };
  app.post('/sources', async (req, reply) => {
    const body = parse(SourceIn, req.body);
    assertActivatable(body);
    const [s] = await db.insert(dataSources).values(body).returning();
    await audit(req, 'create', 'source', s!.id, body);
    return reply.status(201).send(s);
  });
  app.patch('/sources/:id', async (req) => {
    const { id } = parse(IdParam, req.params);
    const body = parse(SourceIn.partial(), req.body);
    const existing = await db.query.dataSources.findFirst({ where: eq(dataSources.id, id) });
    if (!existing) throw notFound();
    assertActivatable({ active: body.active ?? existing.active, termsNote: body.termsNote ?? existing.termsNote });
    const [s] = await db.update(dataSources).set(body).where(eq(dataSources.id, id)).returning();
    await audit(req, 'update', 'source', id, body);
    return s;
  });
  app.post('/sources/:id/import', { bodyLimit: 10_000_000 }, async (req) => {
    const { id } = parse(IdParam, req.params);
    const { listings } = parse(z.object({ listings: z.array(z.unknown()).max(5000) }), req.body);
    const report = await importListings(db, id, listings);
    await audit(req, 'import', 'source', id, { received: report.received, created: report.created, updated: report.updated, flagged: report.flagged });
    return report;
  });
  app.post('/sources/:id/fetch', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const { id } = parse(IdParam, req.params);
    const src = await db.query.dataSources.findFirst({ where: eq(dataSources.id, id) });
    if (!src?.feedUrl) throw badRequest('no_feed_url');
    let data: unknown;
    try {
      data = await fetchPublicJson(src.feedUrl);
    } catch (e) {
      await db.update(dataSources).set({ lastRunAt: new Date(), lastStatus: `error: ${(e as Error).message}` }).where(eq(dataSources.id, id));
      throw badRequest('feed_fetch_failed', (e as Error).message);
    }
    const list = Array.isArray(data) ? data : (data as { listings?: unknown[] })?.listings;
    if (!Array.isArray(list)) throw badRequest('feed_format', 'Feed must be an array of listings or {listings: [...]}');
    const report = await importListings(db, id, list.slice(0, 5000));
    await audit(req, 'fetch', 'source', id, { received: report.received });
    return report;
  });

  /* ---------------------------- Data quality ---------------------------- */
  app.get('/offers/flagged', async () => {
    const rows = await db.select({ o: offers, p: products.name, s: stores.name }).from(offers).innerJoin(products, eq(products.id, offers.productId)).innerJoin(stores, eq(stores.id, offers.storeId)).where(and(eq(offers.flagged, true), eq(offers.active, true))).orderBy(desc(offers.observedAt)).limit(200);
    return rows.map((r) => ({ ...r.o, productName: r.p, storeName: r.s }));
  });
  app.post('/offers/:id/approve', async (req) => {
    const { id } = parse(IdParam, req.params);
    const [o] = await db.update(offers).set({ flagged: false, flagReason: null }).where(eq(offers.id, id)).returning();
    if (!o) throw notFound();
    await db.insert(priceObservations).values({ offerId: o.id, productId: o.productId, finalMinor: o.priceMinor + (o.shippingMinor ?? 0) + o.feesMinor, observedAt: o.observedAt });
    await audit(req, 'approve', 'offer', id);
    return o;
  });
  app.post('/offers/:id/deactivate', async (req) => {
    const { id } = parse(IdParam, req.params);
    const [o] = await db.update(offers).set({ active: false }).where(eq(offers.id, id)).returning();
    if (!o) throw notFound();
    await audit(req, 'deactivate', 'offer', id);
    return o;
  });

  app.get('/unmatched', async () => db.select().from(unmatchedListings).where(isNull(unmatchedListings.resolvedAt)).orderBy(desc(unmatchedListings.createdAt)).limit(200));
  /** Human-confirmed match: links the listing to a product (adds its GTIN if valid) and imports it. */
  app.post('/unmatched/:id/resolve', async (req) => {
    const { id } = parse(IdParam, req.params);
    const { productId } = parse(z.object({ productId: z.string().uuid() }), req.body);
    const u = await db.query.unmatchedListings.findFirst({ where: eq(unmatchedListings.id, id) });
    if (!u) throw notFound();
    const listing = Listing.parse(u.payload);
    const g = listing.gtin ? normalizeGtin(listing.gtin) : null;
    if (g) await db.insert(productGtins).values({ gtin: g, productId }).onConflictDoNothing();
    else await db.update(products).set({ matchKey: matchKey(listing.brand, listing.model) }).where(and(eq(products.id, productId), isNull(products.matchKey)));
    const report = await importListings(db, u.sourceId, [listing]);
    await db.update(unmatchedListings).set({ resolvedAt: new Date() }).where(eq(unmatchedListings.id, id));
    await audit(req, 'resolve', 'unmatched', id, { productId });
    return report;
  });
  app.post('/unmatched/:id/dismiss', async (req) => {
    const { id } = parse(IdParam, req.params);
    await db.update(unmatchedListings).set({ resolvedAt: new Date() }).where(eq(unmatchedListings.id, id));
    await audit(req, 'dismiss', 'unmatched', id);
    return { ok: true };
  });

  /* ------------------------------ Sponsored ----------------------------- */
  app.get('/sponsored', async () => db.select().from(sponsoredPlacements).orderBy(desc(sponsoredPlacements.createdAt)));
  app.post('/sponsored', async (req, reply) => {
    const body = parse(SponsoredIn, req.body);
    const [s] = await db.insert(sponsoredPlacements).values(body).returning();
    await audit(req, 'create', 'sponsored', s!.id, body);
    return reply.status(201).send(s);
  });
  app.patch('/sponsored/:id', async (req) => {
    const { id } = parse(IdParam, req.params);
    const body = parse(SponsoredIn.partial(), req.body);
    const [s] = await db.update(sponsoredPlacements).set(body).where(eq(sponsoredPlacements.id, id)).returning();
    if (!s) throw notFound();
    await audit(req, 'update', 'sponsored', id, body);
    return s;
  });

  /* -------------------------------- Users ------------------------------- */
  app.get('/users', async (req) => {
    const q = parse(Page, req.query);
    const where = q.q ? ilike(users.email, `%${q.q.replace(/[\\%_]/g, (c) => '\\' + c)}%`) : eq(users.kind, 'member');
    const rows = await db.select({ id: users.id, kind: users.kind, email: users.email, name: users.name, role: users.role, plan: users.plan, country: users.country, createdAt: users.createdAt, lastSeenAt: users.lastSeenAt, lockedUntil: users.lockedUntil })
      .from(users).where(where).orderBy(desc(users.createdAt)).limit(PAGE).offset((q.page - 1) * PAGE);
    return { items: rows, page: q.page, pageSize: PAGE };
  });
  app.patch('/users/:id', async (req) => {
    const { id } = parse(IdParam, req.params);
    const body = parse(z.object({ role: z.enum(['user', 'admin']).optional(), plan: z.enum(['free', 'pro']).optional(), unlock: z.boolean().optional() }), req.body);
    if (id === req.user!.id && body.role === 'user') throw badRequest('cannot_demote_self');
    const set: Partial<typeof users.$inferInsert> = {};
    if (body.role) set.role = body.role;
    if (body.plan) set.plan = body.plan;
    if (body.unlock) Object.assign(set, { lockedUntil: null, failedLogins: 0 });
    const [u] = await db.update(users).set(set).where(eq(users.id, id)).returning({ id: users.id, role: users.role, plan: users.plan });
    if (!u) throw notFound();
    if (body.role) await ctx.tokens.revokeAllForUser(id); // role change takes effect on next login
    await audit(req, 'update', 'user', id, body);
    return u;
  });

  app.get('/audit', async () => {
    const rows = await db.select({ a: auditLogs, email: users.email }).from(auditLogs).leftJoin(users, eq(users.id, auditLogs.actorId)).orderBy(desc(auditLogs.createdAt)).limit(200);
    return rows.map((r) => ({ ...r.a, actorEmail: r.email }));
  });
}
