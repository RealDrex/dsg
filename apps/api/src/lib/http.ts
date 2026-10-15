import dns from 'node:dns';
import https from 'node:https';
import net, { type LookupFunction } from 'node:net';
import { isPrivateIp } from './net';

export interface SafeResponse {
  status: number;
  url: string;
  contentType: string;
  body: Buffer;
}

/**
 * Resolves the host and refuses private, loopback and link-local addresses.
 * Used as the socket's own lookup, so the address that is checked is the one
 * that is connected to (no DNS-rebinding window between check and connect).
 */
const publicLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { all: true }, (err, addrs) => {
    if (err) return (callback as (e: Error) => void)(err);
    if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) {
      return (callback as (e: Error) => void)(Object.assign(new Error('host_not_public'), { code: 'EHOSTNOTPUBLIC' }));
    }
    if ((options as { all?: boolean }).all) return (callback as (e: null, a: dns.LookupAddress[]) => void)(null, addrs);
    callback(null, addrs[0]!.address, addrs[0]!.family);
  });
};

/**
 * SSRF-safe GET for server-side fetches (product pages, partner feeds,
 * site icons): https only, public addresses only, redirects re-checked hop
 * by hop, bounded size and time. Never sends cookies or credentials.
 */
export async function safeGet(
  raw: string,
  { accept = '*/*', maxBytes = 1_500_000, timeoutMs = 6_000, maxRedirects = 3, truncate = false, headers = {} }: { accept?: string; maxBytes?: number; timeoutMs?: number; maxRedirects?: number; truncate?: boolean; headers?: Record<string, string> } = {},
): Promise<SafeResponse> {
  const deadline = Date.now() + timeoutMs;
  let url = new URL(raw);
  for (let hop = 0; ; hop++) {
    if (url.protocol !== 'https:') throw new Error('url_must_be_https');
    if (url.username || url.password) throw new Error('url_has_credentials');
    if (url.port && url.port !== '443') throw new Error('url_unusual_port');
    // IP literals skip DNS (and so the lookup guard): never fetch them.
    if (net.isIP(url.hostname.replace(/^\[|\]$/g, ''))) throw new Error('host_not_public');
    // Extra headers (API keys) are only sent to the host they were meant for, never after a redirect.
    const res = await getOnce(url, accept, maxBytes, Math.max(500, deadline - Date.now()), truncate, hop === 0 ? headers : {});
    if (res.status >= 300 && res.status < 400 && res.location) {
      if (hop >= maxRedirects) throw new Error('too_many_redirects');
      url = new URL(res.location, url);
      continue;
    }
    return { status: res.status, url: url.toString(), contentType: res.contentType, body: res.body };
  }
}

function getOnce(url: URL, accept: string, maxBytes: number, timeoutMs: number, truncate: boolean, extra: Record<string, string>): Promise<{ status: number; location?: string; contentType: string; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      lookup: publicLookup,
      timeout: timeoutMs,
      headers: {
        ...extra,
        accept,
        'accept-language': 'ar-SA,ar;q=0.9,en;q=0.8',
        // Identifies us honestly; a page fetched once on a shopper's request, like a link preview.
        'user-agent': 'Mozilla/5.0 (compatible; BestPriceBot/1.0; link preview)',
      },
    }, (res) => {
      const status = res.statusCode ?? 0;
      const contentType = String(res.headers['content-type'] ?? '').toLowerCase();
      if (status >= 300 && status < 400) {
        res.resume();
        return resolve({ status, location: res.headers.location, contentType, body: Buffer.alloc(0) });
      }
      const declared = Number(res.headers['content-length'] ?? 0);
      if (declared > maxBytes && !truncate) {
        res.destroy();
        return reject(new Error('response_too_large'));
      }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (c: Buffer) => {
        size += c.length;
        if (size > maxBytes) {
          if (truncate) {
            chunks.push(c.subarray(0, c.length - (size - maxBytes)));
            res.destroy();
            return resolve({ status, contentType, body: Buffer.concat(chunks) });
          }
          res.destroy();
          return reject(new Error('response_too_large'));
        }
        chunks.push(c);
      });
      res.on('end', () => resolve({ status, contentType, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

/** Partner feeds: JSON over https from a public host, no redirects. */
export async function fetchPublicJson(url: string, { maxBytes = 5_000_000, timeoutMs = 15_000 } = {}): Promise<unknown> {
  let res: SafeResponse;
  try {
    res = await safeGet(url, { accept: 'application/json', maxBytes, timeoutMs, maxRedirects: 0 });
  } catch (e) {
    const m = (e as Error).message;
    throw new Error(m === 'host_not_public' ? 'feed_url_not_public' : m === 'url_must_be_https' ? 'feed_url_must_be_https' : m);
  }
  if (res.status < 200 || res.status >= 300) throw new Error(`feed_http_${res.status}`);
  return JSON.parse(res.body.toString('utf8'));
}
