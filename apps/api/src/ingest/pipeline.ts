import { and, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { getMarket, normalizeGtin } from '@bestprice/core';
import type { DB } from '../db/client';
import { dataSources, offers, priceObservations, productGtins, products, stores, unmatchedListings } from '../db/schema';
import { safeOutboundUrl } from '../lib/net';

/**
 * Normalised listing format every source adapter (official store API,
 * partner catalog, affiliate feed) converts to before import.
 */
export const Listing = z.object({
  externalId: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(300),
  gtin: z.string().trim().max(20).optional(),
  brand: z.string().trim().max(80).optional(),
  model: z.string().trim().max(120).optional(),
  priceMinor: z.number().int().positive().max(1e11),
  shippingMinor: z.number().int().min(0).max(1e9).nullable().optional(),
  feesMinor: z.number().int().min(0).max(1e9).optional(),
  currency: z.string().length(3),
  channel: z.enum(['local', 'online']),
  stock: z.enum(['in_stock', 'limited', 'out_of_stock', 'unknown']).default('unknown'),
  warrantyMonths: z.number().int().min(0).max(240).nullable().optional(),
  returnDays: z.number().int().min(0).max(365).nullable().optional(),
  etaHours: z.number().int().min(0).max(24 * 90).nullable().optional(),
  url: z.string().url().max(2048).optional(),
  branchId: z.string().uuid().optional(),
  observedAt: z.coerce.date().optional(),
  condition: z.enum(['new', 'used', 'refurbished']).default('new'),
  /** Kept for used and marketplace listings, where the title says what exactly is sold. */
  keepTitle: z.boolean().optional(),
  /** Seller's own price when it was in another currency (priceMinor is the converted amount). */
  origPriceMinor: z.number().int().positive().max(1e11).optional(),
  origCurrency: z.string().regex(/^[A-Z]{3}$/).optional(),
});
export type Listing = z.infer<typeof Listing>;

export interface ImportReport {
  received: number;
  created: number;
  updated: number;
  flagged: number;
  unmatched: number;
  rejected: { index: number; reason: string }[];
}

export const matchKey = (brand?: string | null, model?: string | null) =>
  brand && model ? `${brand}|${model}`.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}|]+/gu, '') : null;

const OUTLIER_LOW = 0.6;
const OUTLIER_HIGH = 1.6;

/**
 * `productId` pins every listing to a product the caller already identified
 * (web discovery creates the product first); otherwise listings are matched
 * by GTIN, then brand+model.
 */
export async function importListings(db: DB, sourceId: string, input: unknown[], opts: { productId?: string; flagOutliers?: boolean } = {}): Promise<ImportReport> {
  const source = await db.query.dataSources.findFirst({ where: eq(dataSources.id, sourceId) });
  if (!source) throw new Error('source_not_found');
  if (!source.storeId) throw new Error('source_has_no_store');
  const store = await db.query.stores.findFirst({ where: eq(stores.id, source.storeId) });
  if (!store) throw new Error('source_has_no_store');
  const market = getMarket(source.country);

  const report: ImportReport = { received: input.length, created: 0, updated: 0, flagged: 0, unmatched: 0, rejected: [] };

  for (let i = 0; i < input.length; i++) {
    const parsed = Listing.safeParse(input[i]);
    if (!parsed.success) {
      report.rejected.push({ index: i, reason: parsed.error.issues[0]?.path.join('.') + ': ' + parsed.error.issues[0]?.message });
      continue;
    }
    const l = parsed.data;
    if (l.currency !== market.currency) {
      report.rejected.push({ index: i, reason: `currency ${l.currency} does not match market ${market.currency}` });
      continue;
    }
    if (l.url && !safeOutboundUrl(l.url, store.allowedDomains)) {
      report.rejected.push({ index: i, reason: 'url not on store allow-list' });
      continue;
    }

    // 1) Exact match by GTIN. 2) brand+model match key. Otherwise queue for human review —
    // we never guess a match for a "similar" product.
    let productId: string | null = opts.productId ?? null;
    const gtin = l.gtin ? normalizeGtin(l.gtin) : null;
    if (!productId && gtin) {
      const g = await db.query.productGtins.findFirst({ where: eq(productGtins.gtin, gtin) });
      productId = g?.productId ?? null;
    }
    if (!productId) {
      const key = matchKey(l.brand, l.model);
      if (key) {
        const matches = await db.select({ id: products.id }).from(products).where(eq(products.matchKey, key)).limit(2);
        if (matches.length === 1) productId = matches[0]!.id;
      }
    }
    if (!productId) {
      await db.insert(unmatchedListings).values({ sourceId, externalId: l.externalId, title: l.title, payload: l })
        .onConflictDoUpdate({ target: [unmatchedListings.sourceId, unmatchedListings.externalId], set: { title: l.title, payload: l, resolvedAt: null } });
      report.unmatched++;
      continue;
    }

    const final = l.priceMinor + (l.shippingMinor ?? 0) + (l.feesMinor ?? 0);
    const others = await db
      .select({ p: offers.priceMinor, s: offers.shippingMinor, f: offers.feesMinor })
      .from(offers)
      .where(and(eq(offers.productId, productId), eq(offers.active, true), eq(offers.flagged, false), eq(offers.condition, l.condition), ne(offers.sourceId, sourceId)));
    let flagReason: string | null = null;
    // Web search results are shown with a warning instead (see rankOffers' suspicious_price): hiding them would hide the risk.
    if (opts.flagOutliers !== false && others.length >= 2) {
      const finals = others.map((o) => o.p + (o.s ?? 0) + o.f).sort((a, b) => a - b);
      const median = finals[Math.floor(finals.length / 2)]!;
      if (final < median * OUTLIER_LOW) flagReason = 'price_far_below_market';
      else if (final > median * OUTLIER_HIGH) flagReason = 'price_far_above_market';
    }

    const observedAt = l.observedAt ?? new Date();
    const values = {
      productId, storeId: store.id, branchId: l.branchId ?? null, sourceId, externalId: l.externalId, country: market.code, currency: l.currency,
      channel: l.channel, priceMinor: l.priceMinor, shippingMinor: l.shippingMinor ?? null, feesMinor: l.feesMinor ?? 0, stock: l.stock,
      warrantyMonths: l.warrantyMonths ?? null, returnDays: l.returnDays ?? null, etaHours: l.etaHours ?? null, url: l.url ?? null,
      condition: l.condition, title: l.keepTitle ? l.title : null,
      origPriceMinor: l.origPriceMinor ?? null, origCurrency: l.origPriceMinor ? l.origCurrency ?? null : null,
      observedAt, flagged: flagReason !== null, flagReason, active: true,
    };
    const existing = await db.query.offers.findFirst({ where: and(eq(offers.sourceId, sourceId), eq(offers.externalId, l.externalId)) });
    let offerId: string;
    if (existing) {
      await db.update(offers).set(values).where(eq(offers.id, existing.id));
      offerId = existing.id;
      report.updated++;
    } else {
      const [row] = await db.insert(offers).values(values).returning({ id: offers.id });
      offerId = row!.id;
      report.created++;
    }
    if (flagReason) report.flagged++;
    else if (l.condition === 'new') await db.insert(priceObservations).values({ offerId, productId, finalMinor: final, observedAt });
  }

  await db.update(dataSources).set({ lastRunAt: new Date(), lastStatus: `ok: ${report.created} new, ${report.updated} updated, ${report.flagged} flagged, ${report.unmatched} unmatched, ${report.rejected.length} rejected` }).where(eq(dataSources.id, sourceId));
  return report;
}
