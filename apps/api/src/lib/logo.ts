import { siteDomain } from '@bestprice/core';
import { safeGet, type SafeResponse } from './http';
import { imageWidth } from './imagesize';
import { extractIcons } from './page';

type Img = { type: string; body: Buffer };
type Entry = { at: number; img: Img | null };
type Fetcher = (url: string, kind: 'image' | 'html') => Promise<SafeResponse>;

const OK_TYPES = new Set(['image/png', 'image/x-icon', 'image/vnd.microsoft.icon', 'image/jpeg', 'image/gif', 'image/webp']);
const HIT_TTL = 7 * 86_400_000;
const MISS_TTL = 6 * 3_600_000;
/** Sharp enough on a 42-pt tile at 3×; anything smaller is only used if nothing better exists. */
const GOOD = 96;
const MIN = 32;

const defaultFetcher: Fetcher = (url, kind) => kind === 'html'
  ? safeGet(url, { accept: 'text/html', maxBytes: 400_000, timeoutMs: 5_000, truncate: true })
  : safeGet(url, { accept: 'image/*', maxBytes: 500_000, timeoutMs: 5_000 });

/**
 * Store and brand logos. Tries, in order, until one is sharp:
 * 1. logo.dev (real brand logos) when LOGO_DEV_TOKEN is set,
 * 2. the icons the site itself declares (apple-touch-icon etc.),
 * 3. Google's and DuckDuckGo's site-icon services.
 * Results are cached here and served from /v1/logo, so shoppers' devices
 * never contact these services. No sharp icon → 404 → the app shows the
 * store's wordmark.
 */
export class LogoService {
  private cache = new Map<string, Entry>();
  private inflight = new Map<string, Promise<Img | null>>();

  constructor(private fetcher: Fetcher = defaultFetcher, private opts: { logoDevToken?: string } = {}, private max = 2_000) {}

  async get(rawDomain: string): Promise<Img | null> {
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

  private async image(url: string): Promise<(Img & { width: number }) | null> {
    try {
      const res = await this.fetcher(url, 'image');
      const type = res.contentType.split(';')[0]!.trim();
      if (res.status !== 200 || !OK_TYPES.has(type) || !res.body.length) return null;
      return { type, body: res.body, width: imageWidth(res.body) ?? GOOD };
    } catch {
      return null;
    }
  }

  private async load(domain: string): Promise<Img | null> {
    let fallback: (Img & { width: number }) | null = null;
    const consider = (img: (Img & { width: number }) | null) => {
      if (!img) return false;
      if (img.width >= GOOD) return true;
      if (img.width >= MIN && (!fallback || img.width > fallback.width)) fallback = img;
      return false;
    };
    const sources: (() => Promise<(Img & { width: number }) | null>)[] = [];
    if (this.opts.logoDevToken) sources.push(() => this.image(`https://img.logo.dev/${domain}?token=${encodeURIComponent(this.opts.logoDevToken!)}&size=200&format=png&fallback=404`));
    sources.push(async () => {
      // The site's own declared icons, biggest first (at most three tries).
      let icons: string[] = [];
      try {
        const page = await this.fetcher(`https://${domain}/`, 'html');
        if (page.status === 200) icons = extractIcons(page.body.toString('utf8'), page.url).slice(0, 3);
      } catch { /* site unreachable or blocks bots */ }
      for (const url of icons) {
        const img = await this.image(url);
        if (consider(img)) return img;
      }
      return null;
    });
    sources.push(() => this.image(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=256`));
    sources.push(() => this.image(`https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`));

    let img: Img | null = null;
    for (const src of sources) {
      const found = await src();
      if (consider(found)) { img = found; break; }
    }
    const best = fallback as (Img & { width: number }) | null; // assigned inside `consider`
    img ??= best;
    if (img) img = { type: img.type, body: img.body };
    this.cache.set(domain, { at: Date.now(), img });
    while (this.cache.size > this.max) this.cache.delete(this.cache.keys().next().value!);
    return img;
  }
}
