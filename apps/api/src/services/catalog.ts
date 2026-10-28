import { and, desc, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm';
import {
  brandDomain, effectivePriceMarket, expandSearchQuery, isExactRate, rankOffers, buyTiming, siteDomain,
  type BuyOptionDTO, type CurrencyCode, type HistoryResponse, type OfferDTO, type OfferInput, type OffersResponse,
  type ProductDTO, type ProductSummaryDTO, type SortMode, type SponsoredDTO, type StoreDTO,
} from '@bestprice/core';
import type { DB } from '../db/client';
import { branches, dataSources, offers, priceObservations, productGtins, products, sponsoredPlacements, stores } from '../db/schema';
import { notFound } from '../lib/errors';
import { safeOutboundUrl } from '../lib/net';

type StoreRow = typeof stores.$inferSelect;
type ProductRow = typeof products.$inferSelect;
type BranchRow = typeof branches.$inferSelect;

/** Site icons are served through our own API (/v1/logo), so the app never calls a third party for them. */
export const logoUrlFor = (publicBaseUrl: string, domain: string | null) => (domain ? `${publicBaseUrl}/v1/logo/${domain}` : null);

export function toStoreDTO(s: StoreRow, publicBaseUrl: string): StoreDTO {
  const domain = siteDomain(s.allowedDomains[0]) ?? siteDomain(s.website);
  return {
    id: s.id, name: s.name, nameAr: s.nameAr, logoUrl: s.logoUrl ?? logoUrlFor(publicBaseUrl, domain), brandColor: s.brandColor, website: s.website,
    domain, known: s.known, kind: s.kind,
  };
}

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

interface BestInfo { minor: number; storeName: string; offerCount: number; maxMinor: number; best: BuyOptionDTO; fastest: BuyOptionDTO | null }

export interface LoadedOffer extends OfferInput {
  row: typeof offers.$inferSelect;
  store: StoreRow;
  branch: BranchRow | null;
  sourceName: string;
}

export class CatalogService {
  constructor(private db: DB, private publicBaseUrl: string) {}

  /** All publishable offers for products: active, unflagged, from active sources, in the price market. */
  async loadOffers(productIds: string[], market: string, loc?: { lat: number; lng: number }): Promise<LoadedOffer[]> {
    if (productIds.length === 0) return [];
    const rows = await this.db
      .select({ o: offers, s: stores, src: dataSources })
      .from(offers)
      .innerJoin(stores, eq(stores.id, offers.storeId))
      .innerJoin(dataSources, eq(dataSources.id, offers.sourceId))
      .where(and(
        inArray(offers.productId, productIds),
        eq(offers.active, true),
        eq(offers.flagged, false),
        eq(offers.country, market),
        eq(stores.active, true),
        eq(dataSources.active, true),
      ));
    const storeIds = [...new Set(rows.map((r) => r.s.id))];
    const allBranches = storeIds.length ? await this.db.select().from(branches).where(inArray(branches.storeId, storeIds)) : [];
    return rows.map(({ o, s, src }) => {
      let branch: BranchRow | null = o.branchId ? allBranches.find((b) => b.id === o.branchId) ?? null : null;
      let distanceKm: number | null = null;
      if (o.channel === 'local') {
        const candidates = branch ? [branch] : allBranches.filter((b) => b.storeId === s.id);
        if (loc && candidates.length) {
          const withD = candidates.map((b) => ({ b, d: haversineKm(loc.lat, loc.lng, b.lat, b.lng) })).sort((a, b) => a.d - b.d);
          branch = withD[0]!.b;
          distanceKm = Math.round(withD[0]!.d * 10) / 10;
        } else if (!branch && candidates.length) {
          branch = candidates[0]!;
        }
      }
      return {
        id: o.id, storeId: s.id, channel: o.channel, priceMinor: o.priceMinor, shippingMinor: o.shippingMinor, feesMinor: o.feesMinor,
        stock: o.stock, warrantyMonths: o.warrantyMonths, returnDays: o.returnDays, etaHours: o.etaHours, distanceKm,
        observedAt: o.observedAt, sourceType: src.type, sellerKnown: s.known, fromAbroad: s.kind === 'global', row: o, store: s, branch, sourceName: src.name,
      };
    });
  }

  async rankedOffers(productId: string, sort: SortMode, country: string, loc?: { lat: number; lng: number }): Promise<OffersResponse> {
    const product = await this.db.query.products.findFirst({ where: and(eq(products.id, productId), eq(products.status, 'active')) });
    if (!product) throw notFound('product_not_found');
    const market = effectivePriceMarket(country);
    const loaded = await this.loadOffers([productId], market.code, loc);
    const ranked = rankOffers(loaded.filter((o) => o.row.condition === 'new'), sort);
    const usedRanked = rankOffers(loaded.filter((o) => o.row.condition !== 'new'), 'cheapest');
    const currency = market.currency;
    const toDTO = (r: (typeof ranked)[number]): OfferDTO => {
      const o = r.offer;
      return {
        id: o.id,
        store: toStoreDTO(o.store, this.publicBaseUrl),
        channel: o.channel,
        priceMinor: o.priceMinor,
        shippingMinor: o.shippingMinor,
        feesMinor: o.feesMinor,
        finalMinor: r.finalMinor,
        finalIsEstimate: r.finalIsEstimate,
        currency: o.row.currency as CurrencyCode,
        stock: o.stock,
        warrantyMonths: o.warrantyMonths,
        returnDays: o.returnDays,
        etaHours: o.etaHours,
        branch: o.branch ? { id: o.branch.id, name: o.branch.name, nameAr: o.branch.nameAr, distanceKm: o.distanceKm, lat: o.branch.lat, lng: o.branch.lng } : null,
        observedAt: new Date(o.observedAt).toISOString(),
        condition: o.row.condition,
        title: o.row.title,
        original: o.row.origPriceMinor !== null && o.row.origCurrency
          ? { priceMinor: o.row.origPriceMinor, currency: o.row.origCurrency, exact: isExactRate(o.row.origCurrency, o.row.currency) }
          : null,
        sourceType: o.sourceType,
        sourceName: o.sourceName,
        confidence: r.confidence,
        reasons: r.reasons,
        rank: r.rank,
        buyUrl: safeOutboundUrl(o.row.url, o.store.allowedDomains) ? `${this.publicBaseUrl}/r/${o.id}` : null,
        isDemo: o.sourceType === 'demo',
      };
    };
    const dtos = ranked.map(toDTO);
    const used = usedRanked.map(toDTO);
    const now = new Date();
    const sponsoredRows = await this.db
      .select({ p: sponsoredPlacements, s: stores })
      .from(sponsoredPlacements)
      .innerJoin(stores, eq(stores.id, sponsoredPlacements.storeId))
      .where(and(
        eq(sponsoredPlacements.active, true),
        or(eq(sponsoredPlacements.productId, productId), isNull(sponsoredPlacements.productId)),
        sql`${sponsoredPlacements.startsAt} <= ${now}`,
        or(isNull(sponsoredPlacements.endsAt), gte(sponsoredPlacements.endsAt, now)),
      ))
      .limit(2);
    const sponsored: SponsoredDTO[] = sponsoredRows
      .filter(({ p, s }) => safeOutboundUrl(p.url, s.allowedDomains))
      .map(({ p, s }) => ({ id: p.id, label: p.label, labelAr: p.labelAr, priceMinor: p.priceMinor, currency, store: toStoreDTO(s, this.publicBaseUrl), clickUrl: `${this.publicBaseUrl}/r/s/${p.id}` }));
    return {
      productId,
      sort,
      offers: dtos,
      used,
      sponsored,
      currency,
      coverage: { market: market.code, live: market.code === country, storeCount: new Set(dtos.map((d) => d.store.id)).size },
    };
  }

  /**
   * Per product, from new items that are not stale, out of stock or suspiciously cheap:
   * the lowest final price, the price range, the best overall choice (price, delivery
   * time, seller) and the fastest delivery.
   */
  async bestPrices(productIds: string[], market: string): Promise<Map<string, BestInfo>> {
    const loaded = (await this.loadOffers(productIds, market)).filter((o) => o.row.condition === 'new');
    const byProduct = new Map<string, LoadedOffer[]>();
    for (const o of loaded) byProduct.set(o.row.productId, [...(byProduct.get(o.row.productId) ?? []), o]);
    const out = new Map<string, BestInfo>();
    const option = (r: ReturnType<typeof rankOffers<LoadedOffer>>[number]): BuyOptionDTO => ({
      storeName: r.offer.store.name, storeNameAr: r.offer.store.nameAr, finalMinor: r.finalMinor, finalIsEstimate: r.finalIsEstimate,
      etaHours: r.offer.etaHours, fromAbroad: r.offer.store.kind === 'global',
    });
    for (const [pid, list] of byProduct) {
      const usable = (rs: ReturnType<typeof rankOffers<LoadedOffer>>) => rs.filter((r) => r.confidence !== 'stale' && r.offer.stock !== 'out_of_stock' && !r.reasons.includes('suspicious_price'));
      const ranked = rankOffers(list, 'cheapest');
      const cheap = usable(ranked);
      if (!cheap.length) continue;
      // Sellers shown (a suspiciously cheap one is listed with a warning, so it counts).
      const shown = ranked.filter((r) => r.confidence !== 'stale' && r.offer.stock !== 'out_of_stock').length;
      const value = usable(rankOffers(list, 'value'));
      const fast = usable(rankOffers(list, 'fastest')).filter((r) => r.offer.etaHours !== null);
      const best = value[0] ?? cheap[0]!;
      const fastest = fast[0] && fast[0].offer.id !== best.offer.id && (best.offer.etaHours === null || fast[0].offer.etaHours! < best.offer.etaHours) ? fast[0] : null;
      out.set(pid, {
        minor: cheap[0]!.finalMinor, storeName: cheap[0]!.offer.store.name, offerCount: shown,
        maxMinor: Math.max(...cheap.map((r) => r.finalMinor)), best: option(best), fastest: fastest ? option(fastest) : null,
      });
    }
    return out;
  }

  async summaries(rows: ProductRow[], country: string): Promise<ProductSummaryDTO[]> {
    const market = effectivePriceMarket(country);
    const best = await this.bestPrices(rows.map((r) => r.id), market.code);
    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      nameAr: p.nameAr,
      brand: p.brand,
      model: p.model,
      category: p.category,
      imageUrl: p.imageUrl,
      brandLogoUrl: logoUrlFor(this.publicBaseUrl, p.brandDomain ?? brandDomain(p.brand)),
      bestPriceMinor: best.get(p.id)?.minor ?? null,
      priceRange: best.get(p.id) ? { minMinor: best.get(p.id)!.minor, maxMinor: best.get(p.id)!.maxMinor } : null,
      best: best.get(p.id)?.best ?? null,
      fastest: best.get(p.id)?.fastest ?? null,
      currency: market.currency,
      offerCount: best.get(p.id)?.offerCount ?? 0,
    }));
  }

  async summaryById(ids: string[], country: string): Promise<ProductSummaryDTO[]> {
    if (!ids.length) return [];
    const rows = await this.db.select().from(products).where(and(inArray(products.id, ids), eq(products.status, 'active')));
    const order = new Map(ids.map((id, i) => [id, i]));
    rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    return this.summaries(rows, country);
  }

  async product(id: string, country: string): Promise<ProductDTO> {
    const p = await this.db.query.products.findFirst({ where: and(eq(products.id, id), eq(products.status, 'active')) });
    if (!p) throw notFound('product_not_found');
    const [summary] = await this.summaries([p], country);
    const gtins = await this.db.select({ g: productGtins.gtin }).from(productGtins).where(eq(productGtins.productId, id));
    return {
      ...summary!,
      pricesCheckedAt: p.pricesCheckedAt?.toISOString() ?? null,
      gtins: gtins.map((g) => g.g),
      specs: p.specs,
      attributes: p.attributes,
      specSource: p.specSourceLabel ? { label: p.specSourceLabel, url: p.specSourceUrl } : null,
      description: p.description,
    };
  }

  async search(q: string, country: string, limit: number): Promise<ProductSummaryDTO[]> {
    const groups = expandSearchQuery(q);
    if (!groups.length) return [];
    // Same Arabic letter folding as normalizeSearchText, applied to the catalog side.
    const hay = sql`translate(lower(concat_ws(' ', ${products.name}, ${products.nameAr}, ${products.brand}, ${products.model}, ${products.category})), 'أإآٱىةؤئ', 'اااايهوي')`;
    // Escape LIKE wildcards in user input.
    const like = (term: string) => `%${term.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
    const conds = groups.map((alts) => or(...alts.map((a) => sql`${hay} like ${like(a)}`))!);
    const rows = await this.db
      .select()
      .from(products)
      .where(and(eq(products.status, 'active'), ...conds))
      .orderBy(desc(products.createdAt))
      .limit(limit);
    return this.summaries(rows, country);
  }

  async byGtin(gtin: string): Promise<ProductRow | null> {
    const row = await this.db
      .select({ p: products })
      .from(productGtins)
      .innerJoin(products, eq(products.id, productGtins.productId))
      .where(and(eq(productGtins.gtin, gtin), eq(products.status, 'active')))
      .limit(1);
    return row[0]?.p ?? null;
  }

  async history(productId: string, country: string, days = 90): Promise<HistoryResponse> {
    const market = effectivePriceMarket(country);
    const since = new Date(Date.now() - days * 86_400_000);
    // Daily lowest final price across trusted, unflagged offers in the market.
    const rows = await this.db
      .select({
        day: sql<string>`date_trunc('day', ${priceObservations.observedAt})`.as('day'),
        minor: sql<number>`min(${priceObservations.finalMinor})`.mapWith(Number),
        sources: sql<number>`count(distinct ${offers.sourceId})`.mapWith(Number),
      })
      .from(priceObservations)
      .innerJoin(offers, eq(offers.id, priceObservations.offerId))
      .where(and(eq(priceObservations.productId, productId), gte(priceObservations.observedAt, since), eq(offers.flagged, false), eq(offers.country, market.code)))
      .groupBy(sql`1`)
      .orderBy(sql`1`);
    const points = rows.map((r) => ({ at: new Date(r.day).toISOString(), minor: r.minor }));
    // The latest point is always the current best trusted price, so "now" matches the offers list.
    const current = (await this.bestPrices([productId], market.code)).get(productId);
    if (current) {
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const last = points[points.length - 1];
      if (last && new Date(last.at).getTime() >= today.getTime()) last.minor = current.minor;
      else points.push({ at: today.toISOString(), minor: current.minor });
    }
    const srcCount = await this.db
      .select({ n: sql<number>`count(distinct ${offers.sourceId})`.mapWith(Number) })
      .from(priceObservations)
      .innerJoin(offers, eq(offers.id, priceObservations.offerId))
      .where(and(eq(priceObservations.productId, productId), gte(priceObservations.observedAt, since)));
    const t = buyTiming(points);
    return { productId, currency: market.currency, points, stats: t.stats, advice: t.advice, dropLikelihood: t.dropLikelihood, sourceCount: srcCount[0]?.n ?? 0 };
  }

  async productsInCategory(category: string, limit = 60): Promise<ProductRow[]> {
    return this.db.select().from(products).where(and(eq(products.category, category), eq(products.status, 'active'))).orderBy(desc(products.createdAt)).limit(limit);
  }
}
