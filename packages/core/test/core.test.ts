import { describe, expect, it } from 'vitest';
import {
  assessUrl, buyTiming, classifyScan, formatMoney, isValidGtin, normalizeGtin, priceConfidence, rankOffers, recommend,
  effectivePriceMarket, expandSearchQuery, normalizeSearchText, type OfferInput,
} from '../src';

describe('barcode', () => {
  it('validates EAN-13, UPC-A and EAN-8 check digits', () => {
    expect(isValidGtin('4006381333931')).toBe(true);
    expect(isValidGtin('4006381333932')).toBe(false);
    expect(isValidGtin('036000291452')).toBe(true); // UPC-A
    expect(isValidGtin('96385074')).toBe(true); // EAN-8
    expect(isValidGtin('12345')).toBe(false);
    expect(isValidGtin('abc4006381333931')).toBe(false);
  });
  it('normalises UPC-A and EAN-13 forms to the same GTIN-14', () => {
    expect(normalizeGtin('036000291452')).toBe(normalizeGtin('0036000291452'));
    expect(normalizeGtin('036000291452')).toHaveLength(14);
  });
});

describe('scan classification', () => {
  it('treats a valid barcode as a product', () => {
    expect(classifyScan('4006381333931').kind).toBe('gtin');
  });
  it('never treats a QR URL as a product, and assesses it', () => {
    const r = classifyScan('https://www.jarir.com/sa-en/');
    expect(r.kind).toBe('url');
    if (r.kind === 'url') expect(r.assessment.risk).toBe('safe');
  });
  it('blocks dangerous URLs', () => {
    expect(assessUrl('http://user:pass@bank.com').risk).toBe('blocked');
    expect(assessUrl('http://192.168.1.1/login').risk).toBe('blocked');
    expect(assessUrl('http://3232235777/').risk).toBe('blocked');
    expect(assessUrl('https://xn--pple-43d.com').reasons).toContain('punycode_host');
    expect(assessUrl('https://bit.ly/abc').risk).toBe('caution');
    expect(assessUrl('http://example.com').reasons).toContain('not_https');
  });
  it('never offers to open script or data URIs', () => {
    expect(classifyScan('javascript:alert(1)').kind).toBe('text');
    expect(classifyScan('data:text/html,<script>').kind).toBe('text');
  });
  it('recognises wifi and contacts', () => {
    expect(classifyScan('WIFI:S:home;T:WPA;P:secret;;').kind).toBe('wifi');
    expect(classifyScan('BEGIN:VCARD\nFN:A\nEND:VCARD').kind).toBe('contact');
  });
  it('extracts GTIN from a GS1 digital link', () => {
    const r = classifyScan('https://id.gs1.org/01/04006381333931');
    expect(r.kind === 'url' && r.gtin).toBe('04006381333931');
  });
});

const now = new Date('2026-10-01T12:00:00Z');
const base = (o: Partial<OfferInput> & { id: string }): OfferInput => ({
  storeId: o.id, channel: 'online', priceMinor: 100000, shippingMinor: 0, feesMinor: 0, stock: 'in_stock',
  warrantyMonths: 12, returnDays: 15, etaHours: 24, distanceKm: null, observedAt: new Date(now.getTime() - 3600_000),
  sourceType: 'official_api', ...o,
});

describe('ranking', () => {
  const jarir = base({ id: 'jarir', channel: 'local', priceMinor: 284900, warrantyMonths: 24, etaHours: 2, distanceKm: 2.4, returnDays: 7, observedAt: new Date(now.getTime() - 12 * 60_000) });
  const amazon = base({ id: 'amazon', priceMinor: 278900, etaHours: 24, observedAt: new Date(now.getTime() - 40 * 60_000) });
  const noon = base({ id: 'noon', priceMinor: 273900, shippingMinor: 3900, etaHours: 60, stock: 'limited', observedAt: new Date(now.getTime() - 3 * 3600_000), sourceType: 'affiliate_feed' });
  const extra = base({ id: 'extra', channel: 'local', priceMinor: 289900, warrantyMonths: 24, etaHours: 2, distanceKm: 5.1, stock: 'unknown', observedAt: new Date(now.getTime() - 30 * 3600_000), sourceType: 'affiliate_feed' });
  const all = [extra, noon, amazon, jarir];

  it('cheapest uses final price including shipping', () => {
    const r = rankOffers(all, 'cheapest', now);
    expect(r.map((x) => x.offer.id)).toEqual(['noon', 'amazon', 'jarir', 'extra']);
    expect(r[0]?.finalMinor).toBe(277800);
    expect(r[0]?.reasons).toContain('lowest_final_price');
  });
  it('nearest puts local branches first by distance', () => {
    expect(rankOffers(all, 'nearest', now).map((x) => x.offer.id).slice(0, 2)).toEqual(['jarir', 'extra']);
  });
  it('value weighs warranty, pickup, and data confidence', () => {
    const r = rankOffers(all, 'value', now);
    expect(r[0]?.offer.id).toBe('jarir');
    expect(r[r.length - 1]?.offer.id).toBe('extra');
  });
  it('stale prices are flagged and sink to the bottom', () => {
    const stale = base({ id: 'stale', priceMinor: 1000, observedAt: new Date(now.getTime() - 30 * 86400_000) });
    const r = rankOffers([stale, amazon], 'cheapest', now);
    expect(r[1]?.offer.id).toBe('stale');
    expect(r[1]?.confidence).toBe('stale');
    expect(r[1]?.reasons).toContain('stale_price');
  });
  it('unknown shipping is never assumed free', () => {
    const r = rankOffers([base({ id: 'x', shippingMinor: null })], 'value', now);
    expect(r[0]?.finalIsEstimate).toBe(true);
    expect(r[0]?.reasons).toContain('shipping_unknown');
  });
  it('confidence decays with age', () => {
    expect(priceConfidence('official_api', new Date(now.getTime() - 3600_000), now)).toBe('high');
    expect(priceConfidence('official_api', new Date(now.getTime() - 10 * 86400_000), now)).toBe('stale');
  });
});

describe('history', () => {
  const day = 86400_000;
  it('reports insufficient data instead of guessing', () => {
    expect(buyTiming([{ at: now, minor: 100 }]).advice).toBe('insufficient_data');
  });
  it('recommends buying near the recorded low', () => {
    const vals = [3199, 3149, 3149, 2999, 3049, 2949, 2899, 2999, 2799, 2849, 2699, 2799, 2739];
    const pts = vals.map((v, i) => ({ at: new Date(now.getTime() - (vals.length - i) * 7 * day), minor: v * 100 }));
    const t = buyTiming(pts);
    expect(t.advice).toBe('buy_now');
    expect(t.stats.lowMinor).toBe(269900);
    expect(t.stats.coverageDays).toBeGreaterThan(80);
  });
});

describe('recommend', () => {
  const lap = (id: string, price: number, a: Record<string, number>) => ({ productId: id, name: id, category: 'laptop', priceMinor: price * 100, attributes: a });
  const c = [
    lap('ideapad', 2849, { ram_gb: 16, storage_gb: 512, cpu_score: 70, battery_h: 12, weight_kg: 1.46, warranty_months: 24 }),
    lap('vivobook', 2299, { ram_gb: 8, storage_gb: 512, cpu_score: 50, battery_h: 7, weight_kg: 1.7 }),
    lap('macair', 3499, { ram_gb: 8, storage_gb: 256, cpu_score: 80, battery_h: 18, weight_kg: 1.24 }),
    lap('cheapo', 1499, { ram_gb: 4, storage_gb: 128, cpu_score: 20, battery_h: 5, weight_kg: 2.2 }),
  ];
  it('labels best value, cheapest fit and a stretch pick within budget logic', () => {
    const picks = recommend(c, { category: 'laptop', budgetMinor: 300000, useCase: 'study', priorities: ['battery', 'speed'] });
    expect(picks.find((p) => p.label === 'best_value')?.candidate.productId).toBe('ideapad');
    expect(picks.find((p) => p.label === 'cheapest_fit')?.candidate.productId).toBe('vivobook');
    const stretch = picks.find((p) => p.label === 'stretch');
    expect(stretch?.candidate.productId).toBe('macair');
    expect(stretch?.cons).toContain('over_budget');
    expect(picks.some((p) => p.candidate.productId === 'cheapo')).toBe(false); // fails study minimums
  });
});

describe('markets & money', () => {
  it('falls back to the launch market for planned countries', () => {
    expect(effectivePriceMarket('US').code).toBe('SA');
    expect(effectivePriceMarket('SA').code).toBe('SA');
  });
  it('formats money per language', () => {
    expect(formatMoney(284900, 'SAR', 'ar')).toBe('2,849 ر.س');
    expect(formatMoney(284950, 'SAR', 'en')).toBe('2,849.50 SAR');
    expect(formatMoney(1500, 'KWD', 'en')).toBe('1.500 KWD');
  });
});

describe('search text', () => {
  it('normalises Arabic letter variants, diacritics and digits', () => {
    expect(normalizeSearchText('إيفُون ١٦')).toBe('ايفون 16');
    expect(normalizeSearchText('آيفون')).toBe('ايفون');
    expect(normalizeSearchText('قلاية هوائية')).toBe('قلايه هواييه');
  });
  it('expands Arabic spellings to catalog terms', () => {
    expect(expandSearchQuery('إيفون 16')).toEqual([['ايفون', 'iphone'], ['16']]);
    expect(expandSearchQuery('الايفون')[0]).toContain('iphone');
    expect(expandSearchQuery('ماك بوك اير')).toEqual([['ماك بوك', 'macbook'], ['اير', 'air']]);
    expect(expandSearchQuery('Galaxy A55')).toEqual([['galaxy'], ['a55']]);
    expect(expandSearchQuery('قلاية هوائية')[0]).toContain('airfryer');
  });
});
