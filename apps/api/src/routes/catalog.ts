import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { classifyScan, effectivePriceMarket, OffersQuery, PurchaseBody, ScanBody, SearchQuery, type ScanResponse } from '@bestprice/core';
import { parse, requireUser, type Ctx } from '../app';
import { clickEvents, offers, purchases, searchHistory, sponsoredPlacements, stores } from '../db/schema';
import { notFound } from '../lib/errors';
import { safeOutboundUrl } from '../lib/net';

const IdParam = z.object({ id: z.string().uuid() });

export async function catalogRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db, catalog } = ctx;
  const countryOf = (req: { user: { country: string } | null }, q?: string) => q ?? req.user?.country ?? 'SA';

  app.get('/v1/products/search', async (req) => {
    const q = parse(SearchQuery, req.query);
    const results = await catalog.search(q.q, countryOf(req, q.country), q.limit);
    if (req.user) await db.insert(searchHistory).values({ userId: req.user.id, query: q.q.slice(0, 120) });
    return { results };
  });

  app.get('/v1/products/:id', async (req) => {
    const { id } = parse(IdParam, req.params);
    const p = await catalog.product(id, countryOf(req));
    if (req.user) await db.insert(searchHistory).values({ userId: req.user.id, productId: id });
    return p;
  });

  app.get('/v1/products/:id/offers', async (req) => {
    const { id } = parse(IdParam, req.params);
    const q = parse(OffersQuery, req.query);
    // Location is used for this request only and never stored.
    const loc = q.lat !== undefined && q.lng !== undefined ? { lat: q.lat, lng: q.lng } : undefined;
    return catalog.rankedOffers(id, q.sort, countryOf(req), loc);
  });

  app.get('/v1/products/:id/history', async (req) => {
    const { id } = parse(IdParam, req.params);
    return catalog.history(id, countryOf(req));
  });

  app.get('/v1/stores', async () => {
    const rows = await db.select().from(stores).where(eq(stores.active, true));
    return rows.map((s) => ({ id: s.id, name: s.name, nameAr: s.nameAr, logoUrl: s.logoUrl, brandColor: s.brandColor, website: s.website }));
  });

  /**
   * Classifies a camera scan. Barcodes resolve to products by exact GTIN only;
   * QR codes are never assumed to be products, and URLs come back with a
   * safety assessment instead of being followed.
   */
  app.post('/v1/scan', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req): Promise<ScanResponse> => {
    const body = parse(ScanBody, req.body);
    const country = countryOf(req);
    const c = classifyScan(body.raw);
    const gtin = c.kind === 'gtin' ? c.gtin : c.kind === 'url' ? c.gtin : undefined;
    let match: ScanResponse['match'] = null;
    if (gtin) {
      const p = await catalog.byGtin(gtin);
      if (p) {
        const [summary] = await catalog.summaries([p], country);
        match = { product: summary!, confidence: 1 };
        if (req.user) await db.insert(searchHistory).values({ userId: req.user.id, productId: p.id });
      }
    }
    const out: ScanResponse = { kind: c.kind, match, candidates: [] };
    if (c.kind === 'url') out.url = { url: c.assessment.url, host: c.assessment.host, risk: c.assessment.risk, reasons: c.assessment.reasons };
    if (c.kind === 'text') {
      out.text = c.raw.slice(0, 500);
      // Free text (e.g. OCR from a price tag) can be used to suggest candidates — the user must confirm.
      if (c.raw.length >= 3 && c.raw.length <= 120) out.candidates = await catalog.search(c.raw, country, 5);
    }
    return out;
  });

  /** Outbound link to a store. Only redirects to the store's allow-listed domains (no open redirect). */
  app.get('/r/:id', async (req, reply) => {
    const { id } = parse(IdParam, req.params);
    const row = await db.select({ o: offers, s: stores }).from(offers).innerJoin(stores, eq(stores.id, offers.storeId)).where(eq(offers.id, id)).limit(1);
    const r = row[0];
    const url = r ? safeOutboundUrl(r.o.url, r.s.allowedDomains) : null;
    if (!r || !url) throw notFound('link_not_available');
    await db.insert(clickEvents).values({ offerId: id, userId: req.user?.id ?? null });
    return reply.header('referrer-policy', 'no-referrer').redirect(url, 302);
  });

  app.get('/r/s/:id', async (req, reply) => {
    const { id } = parse(IdParam, req.params);
    const row = await db.select({ p: sponsoredPlacements, s: stores }).from(sponsoredPlacements).innerJoin(stores, eq(stores.id, sponsoredPlacements.storeId)).where(and(eq(sponsoredPlacements.id, id), eq(sponsoredPlacements.active, true))).limit(1);
    const r = row[0];
    const url = r ? safeOutboundUrl(r.p.url, r.s.allowedDomains) : null;
    if (!r || !url) throw notFound('link_not_available');
    await db.insert(clickEvents).values({ sponsoredId: id, userId: req.user?.id ?? null });
    return reply.header('referrer-policy', 'no-referrer').redirect(url, 302);
  });

  /**
   * The user tells us they bought from an offer. Savings are measured against
   * the highest current trusted final price for the same product.
   */
  app.post('/v1/purchases', async (req, reply) => {
    const u = requireUser(req);
    const { offerId } = parse(PurchaseBody, req.body);
    const o = await db.query.offers.findFirst({ where: eq(offers.id, offerId) });
    if (!o) throw notFound('offer_not_found');
    const ranked = await catalog.rankedOffers(o.productId, 'cheapest', u.country);
    const mine = ranked.offers.find((x) => x.id === offerId);
    if (!mine) throw notFound('offer_not_available');
    const usable = ranked.offers.filter((x) => x.confidence !== 'stale' && x.stock !== 'out_of_stock');
    const highest = Math.max(...usable.map((x) => x.finalMinor), mine.finalMinor);
    const saved = Math.max(0, highest - mine.finalMinor);
    await db.insert(purchases).values({ userId: u.id, offerId, productId: o.productId, paidMinor: mine.finalMinor, savedMinor: saved });
    return reply.status(201).send({ savedMinor: saved, paidMinor: mine.finalMinor, currency: effectivePriceMarket(u.country).currency });
  });
}
