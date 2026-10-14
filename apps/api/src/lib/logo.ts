import { siteDomain } from '@bestprice/core';
import { safeGet, type SafeResponse } from './http';

type Entry = { at: number; img: { type: string; body: Buffer } | null };

const OK_TYPES = new Set(['image/png', 'image/x-icon', 'image/vnd.microsoft.icon', 'image/jpeg', 'image/gif', 'image/webp']);
const HIT_TTL = 7 * 86_400_000;
const MISS_TTL = 86_400_000;

/** Width of a PNG from its header, or null for other formats. */
function pngWidth(b: Buffer): number | null {
  return b.length > 24 && b.readUInt32BE(0) === 0x89504e47 ? b.readUInt32BE(16) : null;
}

/**
 * Store and brand logos: the site's own icon, fetched once through a single
 * icon service and cached here, so shoppers' devices never contact third
 * parties for logos. Icons too small to look sharp are treated as missing
 * (the app then shows the store's wordmark).
 */
export class LogoService {
  private cache = new Map<string, Entry>();
  private inflight = new Map<string, Promise<Entry['img']>>();

  constructor(private fetcher: (url: string) => Promise<SafeResponse> = (url) => safeGet(url, { accept: 'image/*', maxBytes: 300_000, timeoutMs: 5_000 }), private max = 2_000) {}

  async get(rawDomain: string): Promise<Entry['img']> {
    const domain = siteDomain(rawDomain);
    if (!domain) return null;
    const hit = this.cache.get(domain);
    if (hit && Date.now() - hit.at < (hit.img ? HIT_TTL : MISS_TTL)) {
      this.cache.delete(domain);
      this.cache.set(domain, hit); // LRU: most recently used last
      return hit.img;
    }
    let p = this.inflight.get(domain);
    if (!p) {
      p = this.load(domain).finally(() => this.inflight.delete(domain));
      this.inflight.set(domain, p);
    }
    return p;
  }

  private async load(domain: string): Promise<Entry['img']> {
    let img: Entry['img'] = null;
    try {
      const res = await this.fetcher(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`);
      const type = res.contentType.split(';')[0]!.trim();
      const w = pngWidth(res.body);
      if (res.status === 200 && OK_TYPES.has(type) && res.body.length > 0 && (w === null || w >= 48)) img = { type, body: res.body };
    } catch {
      img = null;
    }
    this.cache.set(domain, { at: Date.now(), img });
    while (this.cache.size > this.max) this.cache.delete(this.cache.keys().next().value!);
    return img;
  }
}
