/**
 * Offer ranking. Deterministic and explainable: every ordering ships the
 * reasons behind it so the UI (and the assistant) can say *why*.
 *
 * Paid placement never enters this module. Sponsored listings are a
 * separate entity and are rendered apart from organic results.
 */

export type Channel = 'local' | 'online';
export type Stock = 'in_stock' | 'limited' | 'out_of_stock' | 'unknown';
export type SourceType = 'official_api' | 'partner_catalog' | 'affiliate_feed' | 'user_report' | 'web_search' | 'demo';
export type Confidence = 'high' | 'medium' | 'low' | 'stale';
export type SortMode = 'value' | 'cheapest' | 'nearest' | 'fastest';

export interface OfferInput {
  id: string;
  storeId: string;
  channel: Channel;
  priceMinor: number;
  /** null = shipping cost unknown (never assumed free). */
  shippingMinor: number | null;
  feesMinor: number;
  stock: Stock;
  warrantyMonths: number | null;
  returnDays: number | null;
  /** Fastest delivery estimate in hours; local same-day pickup ≈ 2. null = unknown. */
  etaHours: number | null;
  distanceKm: number | null;
  observedAt: Date | string;
  sourceType: SourceType;
  /** false for a seller outside our store directory (found on the web). Defaults to true. */
  sellerKnown?: boolean;
  /** Ships from another country (longer delivery, customs, no local warranty). */
  fromAbroad?: boolean;
}

export interface RankedOffer<T extends OfferInput = OfferInput> {
  offer: T;
  rank: number;
  finalMinor: number;
  /** true when shipping is unknown: finalMinor is a lower bound. */
  finalIsEstimate: boolean;
  confidence: Confidence;
  score: number;
  reasons: RankReason[];
}

export type RankReason =
  | 'lowest_final_price'
  | 'longer_warranty'
  | 'pickup_today'
  | 'fast_delivery'
  | 'nearest_branch'
  | 'high_confidence'
  | 'low_confidence'
  | 'stale_price'
  | 'stock_unconfirmed'
  | 'out_of_stock'
  | 'shipping_unknown'
  | 'unknown_seller'
  | 'ships_from_abroad'
  | 'suspicious_price';

const HOUR = 3_600_000;

/** Freshness windows (hours) per source type: [high, medium, low]; older is stale. */
const FRESHNESS: Record<SourceType, [number, number, number]> = {
  official_api: [6, 48, 168],
  partner_catalog: [6, 48, 168],
  affiliate_feed: [3, 24, 96],
  user_report: [0, 24, 72],
  // Found by web search at request time: never "high" until a store feed confirms it.
  web_search: [0, 6, 48],
  demo: [6, 48, 168],
};

export function priceConfidence(sourceType: SourceType, observedAt: Date | string, now: Date = new Date()): Confidence {
  const ageH = (now.getTime() - new Date(observedAt).getTime()) / HOUR;
  const [hi, med, low] = FRESHNESS[sourceType];
  if (ageH <= hi) return 'high';
  if (ageH <= med) return 'medium';
  if (ageH <= low) return 'low';
  return 'stale';
}

/** Below this share of the median price, an offer is flagged as suspicious. */
const SUSPICIOUS_BELOW = 0.6;

const CONF_PENALTY: Record<Confidence, number> = { high: 0, medium: 0.03, low: 0.08, stale: 0.5 };
const STOCK_PENALTY: Record<Stock, number> = { in_stock: 0, limited: 0.02, unknown: 0.06, out_of_stock: 1 };

export function finalPrice(o: OfferInput): { minor: number; estimate: boolean } {
  return { minor: o.priceMinor + (o.shippingMinor ?? 0) + o.feesMinor, estimate: o.shippingMinor === null };
}

/**
 * Value score (lower is better), expressed as an "effective price" ratio:
 * final price relative to the cheapest, minus credits for warranty and speed,
 * plus penalties for weak data and uncertain stock.
 */
function valueScore(o: OfferInput, final: number, cheapest: number, conf: Confidence): number {
  let s = final / Math.max(1, cheapest);
  const warranty = o.warrantyMonths ?? 12;
  s -= Math.min(24, Math.max(0, warranty - 12)) * 0.0015; // up to ~3.6% credit for +24 months
  if (o.etaHours !== null) s -= o.etaHours <= 6 ? 0.01 : o.etaHours <= 30 ? 0.005 : 0;
  s += CONF_PENALTY[conf] + STOCK_PENALTY[o.stock];
  if (o.shippingMinor === null) s += 0.02;
  if (o.sellerKnown === false) s += 0.08; // a known store up to ~8% dearer is usually the safer buy
  if (o.fromAbroad) s += 0.06; // weeks of shipping, possible customs, warranty abroad
  return s;
}

export function rankOffers<T extends OfferInput>(offers: T[], mode: SortMode, now: Date = new Date()): RankedOffer<T>[] {
  if (offers.length === 0) return [];
  const rows = offers.map((offer) => {
    const f = finalPrice(offer);
    return { offer, final: f.minor, estimate: f.estimate, confidence: priceConfidence(offer.sourceType, offer.observedAt, now) };
  });
  const usable = rows.filter((r) => r.confidence !== 'stale' && r.offer.stock !== 'out_of_stock');
  // A price far below what the other sellers ask is a warning sign (wrong item, used, counterfeit, scam).
  const finals = usable.map((r) => r.final).sort((a, b) => a - b);
  const median = finals.length >= 3 ? finals[Math.floor(finals.length / 2)]! : null;
  const isSuspicious = (final: number) => median !== null && final < median * SUSPICIOUS_BELOW;
  const base = usable.filter((r) => !isSuspicious(r.final));
  const cheapest = Math.min(...(base.length ? base : usable.length ? usable : rows).map((r) => r.final));
  const maxWarranty = Math.max(...rows.map((r) => r.offer.warrantyMonths ?? 0));
  const minDistance = Math.min(...rows.map((r) => r.offer.distanceKm ?? Infinity));
  const minEta = Math.min(...rows.map((r) => r.offer.etaHours ?? Infinity));

  const scored = rows.map((r) => {
    const o = r.offer;
    const unusable = r.confidence === 'stale' || o.stock === 'out_of_stock';
    let score: number;
    switch (mode) {
      case 'cheapest':
        score = r.final;
        break;
      case 'nearest':
        score = o.channel === 'local' && o.distanceKm !== null ? o.distanceKm : 1e6 + r.final / 1e6;
        break;
      case 'fastest':
        score = (o.etaHours ?? 1e4) + r.final / 1e9;
        break;
      default:
        score = valueScore(o, r.final, cheapest, r.confidence);
    }
    const suspicious = isSuspicious(r.final);
    if (suspicious && mode === 'value') score += 1; // shown, with a warning, but never recommended as best value
    // Unusable offers always sink to the bottom, in every mode.
    if (unusable) score += 1e12;

    const reasons: RankReason[] = [];
    if (r.final === cheapest && !unusable) reasons.push('lowest_final_price');
    if (o.warrantyMonths !== null && o.warrantyMonths === maxWarranty && maxWarranty > 12) reasons.push('longer_warranty');
    if (o.channel === 'local' && o.etaHours !== null && o.etaHours <= 6) reasons.push('pickup_today');
    else if (o.etaHours !== null && o.etaHours === minEta && o.etaHours <= 30) reasons.push('fast_delivery');
    if (o.distanceKm !== null && o.distanceKm === minDistance) reasons.push('nearest_branch');
    if (r.confidence === 'high') reasons.push('high_confidence');
    if (r.confidence === 'low') reasons.push('low_confidence');
    if (r.confidence === 'stale') reasons.push('stale_price');
    if (o.stock === 'unknown') reasons.push('stock_unconfirmed');
    if (o.stock === 'out_of_stock') reasons.push('out_of_stock');
    if (o.shippingMinor === null) reasons.push('shipping_unknown');
    if (o.sellerKnown === false) reasons.push('unknown_seller');
    if (o.fromAbroad) reasons.push('ships_from_abroad');
    if (suspicious) reasons.push('suspicious_price');
    return { ...r, score, reasons };
  });

  scored.sort((a, b) => a.score - b.score || a.final - b.final || a.offer.id.localeCompare(b.offer.id));
  return scored.map((r, i) => ({
    offer: r.offer,
    rank: i + 1,
    finalMinor: r.final,
    finalIsEstimate: r.estimate,
    confidence: r.confidence,
    score: r.score,
    reasons: r.reasons,
  }));
}
