import dns from 'node:dns/promises';
import net from 'node:net';

/** True if `host` equals or is a subdomain of one of `domains`. */
export function hostAllowed(host: string, domains: string[]): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  return domains.some((d) => {
    const dd = d.toLowerCase();
    return h === dd || h.endsWith('.' + dd);
  });
}

/** Validates an outbound store URL against the store's allow-list. Prevents open redirects. */
export function safeOutboundUrl(raw: string | null | undefined, domains: string[]): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return null;
    if (u.username || u.password) return null;
    if (!hostAllowed(u.hostname, domains)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateIp(v6.slice(7));
  return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80');
}

/**
 * SSRF guard for server-side fetches of partner feeds: https only, public
 * addresses only, no redirects, bounded size and time.
 */
export async function fetchPublicJson(url: string, { maxBytes = 5_000_000, timeoutMs = 15_000 } = {}): Promise<unknown> {
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new Error('feed_url_must_be_https');
  const addrs = await dns.lookup(u.hostname, { all: true });
  if (addrs.length === 0 || addrs.some((a) => isPrivateIp(a.address))) throw new Error('feed_url_not_public');
  const res = await fetch(u, { redirect: 'error', signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`feed_http_${res.status}`);
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > maxBytes) throw new Error('feed_too_large');
  const text = await res.text();
  if (text.length > maxBytes) throw new Error('feed_too_large');
  return JSON.parse(text);
}

export { isPrivateIp };
