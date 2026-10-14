import { CURRENCIES, type CurrencyCode } from './markets';

/**
 * Approximate exchange rates (units per 1 USD), used only to compare a
 * foreign-currency listing (e.g. AliExpress in USD) with local prices.
 * Converted prices are always shown as approximate, next to the original.
 * Gulf currencies are USD-pegged, so those rates are exact.
 */
export const FX_PER_USD: Readonly<Record<string, number>> = {
  USD: 1,
  SAR: 3.75, AED: 3.6725, QAR: 3.64, BHD: 0.376, OMR: 0.3845, // pegged
  KWD: 0.307, EGP: 49, JOD: 0.709,
  EUR: 0.86, GBP: 0.75, CNY: 7.15, HKD: 7.8, JPY: 148, KRW: 1390, INR: 87, TRY: 41, CAD: 1.38, AUD: 1.53, CHF: 0.8, SGD: 1.29,
};

/** Minor-unit digits for any currency we can convert from (falls back to 2). */
export function minorDigitsOf(code: string): number {
  if (code in CURRENCIES) return CURRENCIES[code as CurrencyCode].minorDigits;
  return code === 'JPY' || code === 'KRW' ? 0 : code === 'JOD' ? 3 : 2;
}

export const isConvertible = (code: string): boolean => code in FX_PER_USD;

/** Pegged pairs convert exactly; anything else is an estimate the UI marks with "≈". */
export function isExactRate(from: string, to: string): boolean {
  const pegged = new Set(['USD', 'SAR', 'AED', 'QAR', 'BHD', 'OMR']);
  return from === to || (pegged.has(from) && pegged.has(to));
}

/** Converts a price given in major units of `from` into minor units of `to`. null if a currency is unknown. */
export function convertToMinor(major: number, from: string, to: CurrencyCode): number | null {
  const a = FX_PER_USD[from];
  const b = FX_PER_USD[to];
  if (!a || !b || !Number.isFinite(major) || major <= 0) return null;
  return Math.round((major / a) * b * 10 ** CURRENCIES[to].minorDigits);
}
