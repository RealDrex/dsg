/**
 * Markets: countries, currencies, locales and coverage.
 *
 * The data model supports any country from day one, but a market is only
 * "live" once we have reliable, legally obtained price sources for it.
 * Everything else is "planned" and the apps must say so instead of
 * pretending to have local coverage.
 */

export type CurrencyCode = 'SAR' | 'AED' | 'KWD' | 'EGP' | 'USD' | 'QAR' | 'BHD' | 'OMR';

export interface Currency {
  code: CurrencyCode;
  /** Number of minor-unit digits (SAR has 2 halala, KWD has 3 fils). */
  minorDigits: number;
  symbolAr: string;
  symbolEn: string;
}

export const CURRENCIES: Record<CurrencyCode, Currency> = {
  SAR: { code: 'SAR', minorDigits: 2, symbolAr: 'ر.س', symbolEn: 'SAR' },
  AED: { code: 'AED', minorDigits: 2, symbolAr: 'د.إ', symbolEn: 'AED' },
  KWD: { code: 'KWD', minorDigits: 3, symbolAr: 'د.ك', symbolEn: 'KWD' },
  EGP: { code: 'EGP', minorDigits: 2, symbolAr: 'ج.م', symbolEn: 'EGP' },
  USD: { code: 'USD', minorDigits: 2, symbolAr: '$', symbolEn: 'USD' },
  QAR: { code: 'QAR', minorDigits: 2, symbolAr: 'ر.ق', symbolEn: 'QAR' },
  BHD: { code: 'BHD', minorDigits: 3, symbolAr: 'د.ب', symbolEn: 'BHD' },
  OMR: { code: 'OMR', minorDigits: 3, symbolAr: 'ر.ع', symbolEn: 'OMR' },
};

export type MarketStatus = 'live' | 'planned';
export type UnitSystem = 'metric' | 'imperial';

export interface Market {
  code: string; // ISO 3166-1 alpha-2
  nameAr: string;
  nameEn: string;
  currency: CurrencyCode;
  timezone: string;
  units: UnitSystem;
  /** VAT/sales tax rate used only to explain prices; offers store tax-inclusive totals. */
  vatRate: number;
  status: MarketStatus;
}

export const MARKETS: Market[] = [
  { code: 'SA', nameAr: 'السعودية', nameEn: 'Saudi Arabia', currency: 'SAR', timezone: 'Asia/Riyadh', units: 'metric', vatRate: 0.15, status: 'live' },
  { code: 'AE', nameAr: 'الإمارات', nameEn: 'UAE', currency: 'AED', timezone: 'Asia/Dubai', units: 'metric', vatRate: 0.05, status: 'planned' },
  { code: 'KW', nameAr: 'الكويت', nameEn: 'Kuwait', currency: 'KWD', timezone: 'Asia/Kuwait', units: 'metric', vatRate: 0, status: 'planned' },
  { code: 'EG', nameAr: 'مصر', nameEn: 'Egypt', currency: 'EGP', timezone: 'Africa/Cairo', units: 'metric', vatRate: 0.14, status: 'planned' },
  { code: 'US', nameAr: 'الولايات المتحدة', nameEn: 'United States', currency: 'USD', timezone: 'America/New_York', units: 'imperial', vatRate: 0, status: 'planned' },
];

export const LAUNCH_MARKET = 'SA';

export function getMarket(code: string | undefined | null): Market {
  return MARKETS.find((m) => m.code === code) ?? (MARKETS[0] as Market);
}

/** The market whose prices we actually show: a planned market falls back to the launch market. */
export function effectivePriceMarket(code: string | undefined | null): Market {
  const m = getMarket(code);
  return m.status === 'live' ? m : getMarket(LAUNCH_MARKET);
}

export type Lang = 'ar' | 'en';
export const SUPPORTED_LANGS: Lang[] = ['ar', 'en'];
export const RTL_LANGS: ReadonlySet<string> = new Set(['ar', 'he', 'fa', 'ur']);
export const isRtl = (lang: string) => RTL_LANGS.has(lang);
