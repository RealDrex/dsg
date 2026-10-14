import { normalizeGtin } from './barcode';

/**
 * Classifies whatever the camera decoded. A QR code is NOT assumed to be a
 * product: it may be a URL, Wi-Fi credentials, a contact card, or plain text.
 * URLs are assessed before the app ever offers to open them.
 */

export type UrlRisk = 'safe' | 'caution' | 'blocked';

export interface UrlAssessment {
  url: string;
  host: string;
  risk: UrlRisk;
  reasons: UrlReason[];
}

export type UrlReason =
  | 'not_https'
  | 'ip_literal'
  | 'credentials_in_url'
  | 'punycode_host'
  | 'url_shortener'
  | 'unusual_port'
  | 'unsupported_scheme'
  | 'too_long'
  | 'invalid';

export type ScanPayload =
  | { kind: 'gtin'; gtin: string; raw: string }
  | { kind: 'url'; raw: string; assessment: UrlAssessment; gtin?: string }
  | { kind: 'wifi'; raw: string }
  | { kind: 'contact'; raw: string }
  | { kind: 'text'; raw: string };

const SHORTENERS = new Set([
  'bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'is.gd', 'ow.ly', 'buff.ly', 'rebrand.ly', 'cutt.ly', 'shorturl.at', 'rb.gy', 'tiny.cc',
]);

const MAX_URL_LENGTH = 2048;

function isIpLiteral(host: string): boolean {
  if (host.startsWith('[')) return true; // IPv6
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  // Decimal/hex encoded IPv4 forms such as http://3232235777 or 0x7f.1
  return /^(0x[0-9a-f]+|\d+)(\.(0x[0-9a-f]+|\d+))*$/i.test(host);
}

export function assessUrl(input: string): UrlAssessment {
  const reasons: UrlReason[] = [];
  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    return { url: input, host: '', risk: 'blocked', reasons: ['invalid'] };
  }
  const scheme = parsed.protocol.toLowerCase();
  if (scheme !== 'https:' && scheme !== 'http:') {
    // javascript:, data:, file:, intent:, sms: etc. are never opened from a scan.
    return { url: input, host: parsed.hostname, risk: 'blocked', reasons: ['unsupported_scheme'] };
  }
  const host = parsed.hostname.toLowerCase();
  if (input.length > MAX_URL_LENGTH) reasons.push('too_long');
  if (scheme === 'http:') reasons.push('not_https');
  if (parsed.username || parsed.password) reasons.push('credentials_in_url');
  if (isIpLiteral(host)) reasons.push('ip_literal');
  if (host.split('.').some((label) => label.startsWith('xn--'))) reasons.push('punycode_host');
  if (SHORTENERS.has(host)) reasons.push('url_shortener');
  if (parsed.port && parsed.port !== '443' && parsed.port !== '80') reasons.push('unusual_port');

  const blocking: UrlReason[] = ['credentials_in_url', 'ip_literal', 'too_long'];
  const risk: UrlRisk = reasons.some((r) => blocking.includes(r)) ? 'blocked' : reasons.length ? 'caution' : 'safe';
  return { url: parsed.toString(), host, risk, reasons };
}

/** GS1 Digital Link: https://id.example.com/01/<gtin>/... carries a product code inside a URL. */
function gtinFromDigitalLink(url: string): string | undefined {
  const m = /\/01\/(\d{8,14})(?:[/?#]|$)/.exec(url);
  return m ? normalizeGtin(m[1] as string) ?? undefined : undefined;
}

export function classifyScan(raw: string): ScanPayload {
  const value = raw.trim();
  const gtin = normalizeGtin(value);
  if (gtin) return { kind: 'gtin', gtin, raw: value };
  if (/^WIFI:/i.test(value)) return { kind: 'wifi', raw: value };
  if (/^(BEGIN:VCARD|MECARD:)/i.test(value)) return { kind: 'contact', raw: value };
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^\d/.test(value)) {
    const assessment = assessUrl(value);
    if (assessment.reasons.includes('unsupported_scheme') || assessment.reasons.includes('invalid')) {
      return { kind: 'text', raw: value };
    }
    return { kind: 'url', raw: value, assessment, gtin: gtinFromDigitalLink(value) };
  }
  return { kind: 'text', raw: value };
}
