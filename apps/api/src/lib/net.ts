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

export { isPrivateIp };
