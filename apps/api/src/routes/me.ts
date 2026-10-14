import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { effectivePriceMarket, PreferenceBody, ProfileBody, type HomeResponse, type NotificationDTO } from '@bestprice/core';
import { noStore, parse, requireUser, type Ctx } from '../app';
import { conversations, messages, notifications, offers, preferences, purchases, searchHistory, users, watches } from '../db/schema';
import { notFound } from '../lib/errors';
import { toUserDTO } from '../services/auth';
import { listWatches } from './watch';

const PushBody = z.object({ token: z.string().regex(/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,100}\]$/).nullable() });

const SUGGESTIONS: Record<string, [string, string]> = {
  'لابتوبات': ['أبي لابتوب للعمل، بس ما أعرف وش أختار', 'I need a work laptop but don’t know what to pick'],
  'جوالات': ['أفكر أغير جوالي، يستاهل؟', 'Thinking of upgrading my phone, worth it?'],
  'قهوة': ['هدية لشخص يحب القهوة', 'A gift for a coffee lover'],
  'ألعاب': ['أفضل سماعة للقيمنق', 'Best gaming headset'],
  'سماعات': ['أفضل سماعة للقيمنق', 'Best gaming headset'],
};
const DEFAULT_SUGGESTIONS = ['لابتوبات', 'جوالات', 'قهوة'];

export const toNotificationDTO = (n: typeof notifications.$inferSelect): NotificationDTO => ({
  id: n.id, kind: n.kind, title: n.title, body: n.body, productId: n.productId, createdAt: n.createdAt.toISOString(), readAt: n.readAt?.toISOString() ?? null,
});

export async function meRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db, catalog } = ctx;
  app.addHook('onSend', async (_req, reply) => { noStore(reply); });

  app.get('/me', async (req) => toUserDTO(requireUser(req)));

  app.patch('/me', async (req) => {
    const u = requireUser(req);
    const body = parse(ProfileBody, req.body);
    const [row] = await db.update(users).set(body).where(eq(users.id, u.id)).returning();
    if (body.memoryEnabled === false) {
      // Turning memory off also forgets what was remembered.
      await db.delete(preferences).where(eq(preferences.userId, u.id));
    }
    return toUserDTO(row!);
  });

  app.put('/me/push-token', async (req, reply) => {
    const u = requireUser(req);
    const { token } = parse(PushBody, req.body);
    await db.update(users).set({ pushToken: token }).where(eq(users.id, u.id));
    return reply.status(204).send();
  });

  /** Privacy: everything we hold about the user, as JSON. */
  app.get('/me/export', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req) => {
    const u = requireUser(req);
    const [prefs, w, hist, convs, purch, notes] = await Promise.all([
      db.select().from(preferences).where(eq(preferences.userId, u.id)),
      db.select().from(watches).where(eq(watches.userId, u.id)),
      db.select().from(searchHistory).where(eq(searchHistory.userId, u.id)),
      db.select().from(conversations).where(eq(conversations.userId, u.id)),
      db.select().from(purchases).where(eq(purchases.userId, u.id)),
      db.select().from(notifications).where(eq(notifications.userId, u.id)),
    ]);
    const msgs = convs.length
      ? await db.select({ conversationId: messages.conversationId, role: messages.role, content: messages.content, createdAt: messages.createdAt }).from(messages).where(inArray(messages.conversationId, convs.map((c) => c.id)))
      : [];
    return { exportedAt: new Date().toISOString(), profile: toUserDTO(u), preferences: prefs, watches: w, searchHistory: hist, conversations: convs, messages: msgs, purchases: purch, notifications: notes };
  });

  /** Privacy: permanently delete the account and all associated data (cascades). */
  app.delete('/me', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req, reply) => {
    const u = requireUser(req);
    await db.delete(users).where(eq(users.id, u.id));
    return reply.status(204).send();
  });

  app.get('/me/preferences', async (req) => {
    const u = requireUser(req);
    return db.select({ id: preferences.id, text: preferences.text, createdAt: preferences.createdAt }).from(preferences).where(eq(preferences.userId, u.id)).orderBy(preferences.createdAt);
  });
  app.post('/me/preferences', async (req, reply) => {
    const u = requireUser(req);
    const { text } = parse(PreferenceBody, req.body);
    if (!u.memoryEnabled) return reply.status(409).send({ error: { code: 'memory_disabled', message: 'Assistant memory is off' } });
    const [row] = await db.insert(preferences).values({ userId: u.id, text }).returning({ id: preferences.id, text: preferences.text });
    return reply.status(201).send(row);
  });
  app.delete('/me/preferences/:id', async (req, reply) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const r = await db.delete(preferences).where(and(eq(preferences.id, id), eq(preferences.userId, u.id))).returning({ id: preferences.id });
    if (!r.length) throw notFound();
    return reply.status(204).send();
  });

  app.delete('/me/history', async (req, reply) => {
    const u = requireUser(req);
    await db.delete(searchHistory).where(eq(searchHistory.userId, u.id));
    await db.delete(conversations).where(eq(conversations.userId, u.id));
    return reply.status(204).send();
  });

  app.get('/home', async (req): Promise<HomeResponse> => {
    const u = requireUser(req);
    const market = effectivePriceMarket(u.country);
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const [sav] = await db
      .select({ saved: sql<number>`coalesce(sum(${purchases.savedMinor}), 0)`.mapWith(Number), n: sql<number>`count(*)`.mapWith(Number) })
      .from(purchases)
      .where(and(eq(purchases.userId, u.id), gte(purchases.createdAt, monthStart)));
    const watching = await listWatches(ctx, u);
    const alerts = await db.select().from(notifications).where(and(eq(notifications.userId, u.id), isNull(notifications.readAt))).orderBy(desc(notifications.createdAt)).limit(5);

    // Local deals: fresh, in-stock, local offers with known branch data.
    const local = (await catalog.loadOffers(
      (await db.selectDistinct({ id: offers.productId }).from(offers).where(and(eq(offers.channel, 'local'), eq(offers.active, true), eq(offers.flagged, false), eq(offers.country, market.code))).limit(40)).map((r) => r.id),
      market.code,
    )).filter((o) => o.channel === 'local' && o.branch && o.stock === 'in_stock' && Date.now() - new Date(o.observedAt).getTime() < 24 * 3600_000);
    local.sort((a, b) => new Date(b.observedAt).getTime() - new Date(a.observedAt).getTime());
    const seenP = new Set<string>();
    const picks = local.filter((o) => !seenP.has(o.row.productId) && seenP.add(o.row.productId)).slice(0, 2);
    const localDeals: HomeResponse['localDeals'] = [];
    for (const o of picks) {
      const r = await catalog.rankedOffers(o.row.productId, 'nearest', u.country);
      const dto = r.offers.find((x) => x.id === o.id);
      const [summary] = await catalog.summaryById([o.row.productId], u.country);
      if (dto && summary) localDeals.push({ offer: dto, product: summary });
    }

    const recentIds = await db
      .select({ id: searchHistory.productId, at: sql`max(${searchHistory.createdAt})` })
      .from(searchHistory)
      .where(and(eq(searchHistory.userId, u.id), sql`${searchHistory.productId} is not null`))
      .groupBy(searchHistory.productId)
      .orderBy(desc(sql`max(${searchHistory.createdAt})`))
      .limit(6);
    const recent = await catalog.summaryById(recentIds.map((r) => r.id!).filter(Boolean), u.country);

    const keys = (u.interests.filter((i) => SUGGESTIONS[i]).length ? u.interests.filter((i) => SUGGESTIONS[i]) : DEFAULT_SUGGESTIONS).slice(0, 3);
    const suggestions = [...new Set(keys.map((k) => SUGGESTIONS[k]![u.lang === 'ar' ? 0 : 1]))];
    if (suggestions.length < 3) for (const k of DEFAULT_SUGGESTIONS) { const s = SUGGESTIONS[k]![u.lang === 'ar' ? 0 : 1]; if (!suggestions.includes(s) && suggestions.length < 3) suggestions.push(s); }

    return {
      user: toUserDTO(u),
      savings: { monthMinor: sav?.saved ?? 0, goalMinor: u.savingsGoalMinor, purchases: sav?.n ?? 0 },
      stats: {
        watching: watching.length,
        targetHit: watching.filter((w) => w.hit).length,
        dropped: watching.filter((w) => w.currentMinor !== null && w.currentMinor < w.startMinor).length,
      },
      watching,
      alerts: alerts.map(toNotificationDTO),
      localDeals,
      recent,
      suggestions,
      coverage: { market: market.code, live: market.code === u.country },
    };
  });

}
