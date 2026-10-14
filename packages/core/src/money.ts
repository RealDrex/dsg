import { CURRENCIES, type CurrencyCode, type Lang } from './markets';

/**
 * All money is stored as integer minor units (halala, fils, cents) to avoid
 * floating point drift. Formatting happens only at the edges.
 */
export type Minor = number;

export function toMinor(major: number, currency: CurrencyCode): Minor {
  const d = CURRENCIES[currency].minorDigits;
  return Math.round(major * 10 ** d);
}

export function toMajor(minor: Minor, currency: CurrencyCode): number {
  const d = CURRENCIES[currency].minorDigits;
  return minor / 10 ** d;
}

/**
 * Formats with Latin digits in both languages (matches the design and avoids
 * mixed-digit confusion in prices). Whole amounts drop the fraction.
 */
export function formatAmount(minor: Minor, currency: CurrencyCode): string {
  const major = toMajor(minor, currency);
  const whole = Number.isInteger(major);
  return major.toLocaleString('en-US', {
    minimumFractionDigits: whole ? 0 : CURRENCIES[currency].minorDigits,
    maximumFractionDigits: whole ? 0 : CURRENCIES[currency].minorDigits,
  });
}

export function currencySymbol(currency: CurrencyCode, lang: Lang): string {
  const c = CURRENCIES[currency];
  return lang === 'ar' ? c.symbolAr : c.symbolEn;
}

export function formatMoney(minor: Minor, currency: CurrencyCode, lang: Lang): string {
  return `${formatAmount(minor, currency)} ${currencySymbol(currency, lang)}`;
}
