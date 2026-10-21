import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gte, isNull, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { effectivePriceMarket, WatchBody, WatchPatch, type WatchItemDTO } from '@bestprice/core';
import { parse, requireUser, type Ctx } from '../app';
import { notifications, offers, priceObservations, products, watches } from '../db/schema';
import { HttpError, notFound } from '../lib/errors';
import { checkWatches, markRead } from '../services/alerts';
import type { UserRow } from '../services/auth';
import { toNotificationDTO } from './me';

const IdParam = z.object({ id: z.string().uuid() });

export async function listWatches(ctx: Ctx, u: UserRow): Promise<WatchItemDTO[]> {
  const rows = await ctx.db.select({ w: watches, p: products }).from(watches).innerJoin(products, eq(products.id, watches.productId)).where(eq(watches.userId, u.id)).orderBy(desc(watches.createdAt));
  if (!rows.length) return [];
  const market = effectivePriceMarket(u.country).code;
  const best = await ctx.catalog.bestPrices(rows.map((r) => r.p.id), market);
  const summaries = await ctx.catalog.summaries(rows.map((r) => r.p), u.country);
  // Lowest daily best price recorded since each watch started.
  const lows = await Promise.all(rows.map(async ({ w, p }) => {
    const [r] = await ctx.db.select({ m: sql<number | null>`min(${priceObservations.finalMinor})`.mapWith((v) => (v === null ? null : Number(v))) })
      .from(priceObservations).innerJoin(offers, eq(offers.id, priceObservations.offerId))
      .where(and(eq(priceObservations.productId, p.id), gte(priceObservations.observedAt, w.createdAt), eq(offers.flagged, false), eq(offers.condition, 'new')));
    return r?.m ?? null;
  }));
  return rows.map(({ w, p }, i) => {
    const b = best.get(p.id);
    const seen = [lows[i], b?.minor].filter((x): x is number => typeof x === 'number');
    return {
      id: w.id,
      product: summaries.find((s) => s.id === p.id)!,
      checkedAt: p.pricesCheckedAt?.toISOString() ?? null,
      lowestMinor: seen.length ? Math.min(...seen) : null,
      targetMinor: w.targetMinor,
      startMinor: w.startMinor,
      currentMinor: b?.minor ?? null,
      currentStore: b?.storeName ?? null,
      hit: b ? b.minor <= w.targetMinor : false,
      hitAt: w.hitAt?.toISOString() ?? null,
      createdAt: w.createdAt.toISOString(),
    };
  });
}

export async function watchRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db, cfg } = ctx;

  app.get('/watches', async (req) => listWatches(ctx, requireUser(req)));

  app.post('/watches', async (req, reply) => {
    const u = requireUser(req);
    const body = parse(WatchBody, req.body);
    const p = await db.query.products.findFirst({ where: eq(products.id, body.productId) });
    if (!p) throw notFound('product_not_found');
    const existing = await db.query.watches.findFirst({ where: and(eq(watches.userId, u.id), eq(watches.productId, p.id)) });
    const limit = u.plan === 'pro' ? cfg.PRO_WATCH_LIMIT : cfg.FREE_WATCH_LIMIT;
    if (!existing && (await db.$count(watches, eq(watches.userId, u.id))) >= limit) {
      throw new HttpError(402, 'watch_limit_reached', `Free plan tracks up to ${limit} products`);
    }
    const best = (await ctx.catalog.bestPrices([p.id], effectivePriceMarket(u.country).code)).get(p.id);
    const [w] = await db.insert(watches)
      .values({ userId: u.id, productId: p.id, targetMinor: body.targetMinor, startMinor: best?.minor ?? body.targetMinor })
      .onConflictDoUpdate({ target: [watches.userId, watches.productId], set: { targetMinor: body.targetMinor, hitAt: null } })
      .returning();
    return reply.status(existing ? 200 : 201).send({ id: w!.id });
  });

  /** Re-checks the prices of the user's watched products that weren't checked in the last 10 minutes. */
  app.post('/watches/refresh', { config: { rateLimit: { max: 4, timeWindow: '1 minute' } } }, async (req) => {
    const u = requireUser(req);
    const due = await db.select({ id: products.id }).from(watches).innerJoin(products, eq(products.id, watches.productId))
      .where(and(eq(watches.userId, u.id), or(isNull(products.pricesCheckedAt), lt(products.pricesCheckedAt, new Date(Date.now() - 10 * 60_000))))).limit(10);
    let changed = 0;
    for (let i = 0; i < due.length; i += 3) {
      const r = await Promise.all(due.slice(i, i + 3).map((d) => ctx.monitor.refreshProduct(d.id, { search: false }).catch(() => null)));
      changed += r.reduce((n, x) => n + (x?.changed ?? 0), 0);
    }
    if (due.length) await checkWatches(db, ctx.catalog).catch(() => 0);
    return { checked: due.length, changed, watches: await listWatches(ctx, u) };
  });

  app.patch('/watches/:id', async (req) => {
    const u = requireUser(req);
    const { id } = parse(IdParam, req.params);
    const body = parse(WatchPatch, req.body);
    const r = await db.update(watches).set({ targetMinor: body.targetMinor, hitAt: null }).where(and(eq(watches.id, id), eq(watches.userId, u.id))).returning({ id: watches.id });
    if (!r.length) throw notFound();
    return { id };
  });

  app.delete('/watches/:id', async (req, reply) => {
    const u = requireUser(req);
    const { id } = parse(IdParam, req.params);
    const r = await db.delete(watches).where(and(eq(watches.id, id), eq(watches.userId, u.id))).returning({ id: watches.id });
    if (!r.length) throw notFound();
    return reply.status(204).send();
  });

  app.get('/notifications', async (req) => {
    const u = requireUser(req);
    const rows = await db.select().from(notifications).where(eq(notifications.userId, u.id)).orderBy(desc(notifications.createdAt)).limit(50);
    return rows.map(toNotificationDTO);
  });

  app.post('/notifications/read', async (req, reply) => {
    const u = requireUser(req);
    const { ids } = parse(z.object({ ids: z.array(z.string().uuid()).max(100) }), req.body);
    await markRead(db, u.id, ids);
    return reply.status(204).send();
  });
}
