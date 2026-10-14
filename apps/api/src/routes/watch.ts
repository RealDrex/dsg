import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { effectivePriceMarket, WatchBody, WatchPatch, type WatchItemDTO } from '@bestprice/core';
import { parse, requireUser, type Ctx } from '../app';
import { notifications, products, watches } from '../db/schema';
import { HttpError, notFound } from '../lib/errors';
import { markRead } from '../services/alerts';
import type { UserRow } from '../services/auth';
import { toNotificationDTO } from './me';

const IdParam = z.object({ id: z.string().uuid() });

export async function listWatches(ctx: Ctx, u: UserRow): Promise<WatchItemDTO[]> {
  const rows = await ctx.db.select({ w: watches, p: products }).from(watches).innerJoin(products, eq(products.id, watches.productId)).where(eq(watches.userId, u.id)).orderBy(desc(watches.createdAt));
  if (!rows.length) return [];
  const market = effectivePriceMarket(u.country).code;
  const best = await ctx.catalog.bestPrices(rows.map((r) => r.p.id), market);
  const summaries = await ctx.catalog.summaries(rows.map((r) => r.p), u.country);
  return rows.map(({ w, p }) => {
    const b = best.get(p.id);
    return {
      id: w.id,
      product: summaries.find((s) => s.id === p.id)!,
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
