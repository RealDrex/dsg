/**
 * GTIN (EAN-8, UPC-A, EAN-13, GTIN-14) validation and normalisation.
 * Products are keyed by GTIN-14 so UPC-A and EAN-13 forms of the same code match.
 */

const DIGITS = /^\d+$/;
const GTIN_LENGTHS = new Set([8, 12, 13, 14]);

export function gtinCheckDigit(body: string): number {
  // Weights alternate 3,1 starting from the rightmost digit of the body.
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const digit = body.charCodeAt(body.length - 1 - i) - 48;
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidGtin(raw: string): boolean {
  const code = raw.replace(/[\s-]/g, '');
  if (!DIGITS.test(code) || !GTIN_LENGTHS.has(code.length)) return false;
  const body = code.slice(0, -1);
  return gtinCheckDigit(body) === Number(code[code.length - 1]);
}

/** Returns the zero-padded GTIN-14, or null when the input is not a valid GTIN. */
export function normalizeGtin(raw: string): string | null {
  const code = raw.replace(/[\s-]/g, '');
  if (!isValidGtin(code)) return null;
  return code.padStart(14, '0');
}

/** Display form: drops GTIN-14 padding back to EAN-13 / UPC-A where possible. */
export function displayGtin(gtin14: string): string {
  if (gtin14.startsWith('000000')) return gtin14.slice(6); // EAN-8
  if (gtin14.startsWith('0')) return gtin14.slice(1); // EAN-13
  return gtin14;
}
