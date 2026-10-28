import { and, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { normalizeSearchText, SHOP_CATEGORIES } from '@bestprice/core';
import type { DB } from '../db/client';
import { products } from '../db/schema';
import { safeGet, type SafeResponse } from '../lib/http';
import { IMAGE_TYPES, imageWidth } from '../lib/imagesize';
import { hostAllowed } from '../lib/net';

type Fetcher = (url: string, opts: { kind: 'json' | 'image'; headers?: Record<string, string> }) => Promise<SafeResponse>;

const defaultFetcher: Fetcher = (url, { kind, headers }) => kind === 'json'
  ? safeGet(url, { accept: 'application/json', maxBytes: 2_000_000, timeoutMs: 5_000, headers })
  // Only the first bytes are needed to check type and size.
  : safeGet(url, { accept: 'image/*', maxBytes: 65_536, timeoutMs: 4_000, truncate: true });

/** Words too generic to prove a picture shows the right product. */
const GENERIC = new Set(['pro', 'max', 'plus', 'mini', 'air', 'ultra', 'slim', 'lite', 'series', 'edition', 'new', 'gen', 'inch', 'wireless', 'smart', 'the', 'and', 'with', 'for', 'gb', 'tb']);
const tokens = (s: string) => normalizeSearchText(s).split(' ').filter((w) => w.length >= 2 && !/^\d+(gb|tb|mm)?$/.test(w));

export interface ImageQuery { name: string; brand: string | null; preferHosts?: string[] }

/**
 * Finds a photo for a product when its store pages didn't give one:
 * image search (Brave Search API, when BRAVE_SEARCH_API_KEY is set), then
 * Wikipedia/Wikimedia (no key needed; well-known products). Every candidate
 * is fetched once to prove it is a real image of reasonable size before it
 * is used.
 */
export class MediaService {
  private tried = new Map<string, number>();
  private covers = new Map<string, { url: string | null; at: number }>();
  private inflight = new Map<string, Promise<string | null>>();

  constructor(private db: DB, private opts: { braveKey?: string; fetcher?: Fetcher } = {}) {}

  private get fetcher(): Fetcher {
    return this.opts.fetcher ?? defaultFetcher;
  }

  /** True when the URL serves an image at least `minWidth` wide (unknown formats pass). */
  async isImage(url: string, minWidth = 160): Promise<boolean> {
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:' || u.username || u.password) return false;
      const res = await this.fetcher(url, { kind: 'image' });
      const type = res.contentType.split(';')[0]!.trim();
      if (res.status !== 200 || !IMAGE_TYPES.has(type)) return false;
      const w = imageWidth(res.body);
      return w === null || w >= minWidth;
    } catch {
      return false;
    }
  }

  /** The first candidate that really is an image (tries at most `max`). */
  async firstImage(candidates: (string | null | undefined)[], max = 4): Promise<string | null> {
    const list = [...new Set(candidates.filter((c): c is string => !!c))].slice(0, max);
    for (const url of list) if (await this.isImage(url)) return url;
    return null;
  }

  async find(q: ImageQuery): Promise<string | null> {
    const base = q.name.split(/[·|(]/)[0]!.trim();
    const query = q.brand && !normalizeSearchText(base).includes(normalizeSearchText(q.brand)) ? `${q.brand} ${base}` : base;
    const candidates = [...(await this.brave(query, q.preferHosts ?? [])), ...(await this.wikipedia(query, q.brand))];
    return this.firstImage(candidates, 5);
  }

  /**
   * A real photo for each shopping category: the newest product photo in it
   * (from the store pages), otherwise an encyclopedia photo of the thing.
   * Cached for 6 hours.
   */
  async categoryCovers(): Promise<{ id: string; imageUrl: string | null }[]> {
    return Promise.all(SHOP_CATEGORIES.map(async (c) => {
      const hit = this.covers.get(c.id);
      if (hit && Date.now() - hit.at < 6 * 3_600_000) return { id: c.id, imageUrl: hit.url };
      const [p] = await this.db.select({ url: products.imageUrl }).from(products)
        .where(and(inArray(products.category, c.catalog), eq(products.status, 'active'), isNotNull(products.imageUrl)))
        .orderBy(desc(products.createdAt)).limit(1);
      let url = p?.url ?? null;
      if (!url) {
        url = await Promise.race([this.find({ name: c.cover, brand: null }), new Promise<null>((r) => setTimeout(() => r(null), 6_000))]).catch(() => null);
      }
      // Keep a miss only briefly, so a photo found later shows up soon.
      this.covers.set(c.id, { url, at: url ? Date.now() : Date.now() - 5.5 * 3_600_000 });
      return { id: c.id, imageUrl: url };
    }));
  }

  /** Fills in a missing product photo (at most one attempt per product every 6 h). */
  async ensureImage(productId: string): Promise<string | null> {
    const last = this.tried.get(productId);
    if (last && Date.now() - last < 6 * 3_600_000) return null;
    let p = this.inflight.get(productId);
    if (!p) {
      p = (async () => {
        this.tried.set(productId, Date.now());
        if (this.tried.size > 20_000) this.tried.clear();
        const row = await this.db.query.products.findFirst({ where: eq(products.id, productId) });
        if (!row || row.imageUrl) return row?.imageUrl ?? null;
        const url = await this.find({ name: row.name, brand: row.brand });
        if (url) await this.db.update(products).set({ imageUrl: url }).where(and(eq(products.id, productId), isNull(products.imageUrl)));
        return url;
      })().catch(() => null).finally(() => this.inflight.delete(productId));
      this.inflight.set(productId, p);
    }
    return p;
  }

  private async brave(query: string, preferHosts: string[]): Promise<string[]> {
    if (!this.opts.braveKey) return [];
    try {
      const res = await this.fetcher(`https://api.search.brave.com/res/v1/images/search?q=${encodeURIComponent(query)}&count=12&safesearch=strict&spellcheck=0`, {
        kind: 'json', headers: { 'x-subscription-token': this.opts.braveKey },
      });
      if (res.status !== 200) return [];
      const data = JSON.parse(res.body.toString('utf8')) as { results?: { properties?: { url?: string }; thumbnail?: { src?: string } }[] };
      const rows = (data.results ?? []).map((r) => ({ full: r.properties?.url, thumb: r.thumbnail?.src })).filter((r) => r.full || r.thumb);
      const preferred = (u?: string) => { try { return !!u && hostAllowed(new URL(u).hostname, preferHosts); } catch { return false; } };
      rows.sort((a, b) => Number(preferred(b.full)) - Number(preferred(a.full)));
      // Original first; Brave's own thumbnail copy as a reliable fallback.
      return rows.slice(0, 3).flatMap((r) => [r.full, r.thumb]).filter((u): u is string => !!u && u.startsWith('https://'));
    } catch {
      return [];
    }
  }

  private async wikipedia(query: string, brand: string | null): Promise<string[]> {
    try {
      const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrlimit=4&gsrnamespace=0&prop=pageimages&piprop=thumbnail&pithumbsize=800`;
      const res = await this.fetcher(url, { kind: 'json' });
      if (res.status !== 200) return [];
      const data = JSON.parse(res.body.toString('utf8')) as { query?: { pages?: { title: string; index: number; thumbnail?: { source: string } }[] } };
      const want = tokens(query).filter((w) => !brand || w !== normalizeSearchText(brand));
      const b = brand ? normalizeSearchText(brand) : null;
      return (data.query?.pages ?? [])
        .sort((x, y) => x.index - y.index)
        .filter((p) => {
          if (!p.thumbnail?.source) return false;
          const title = normalizeSearchText(p.title);
          const hits = want.filter((w) => title.includes(w));
          const strong = hits.filter((w) => w.length >= 5 && !GENERIC.has(w));
          // The article must be about this product, not just share a word with it.
          return hits.length >= 2 || (hits.length >= 1 && ((b !== null && title.includes(b)) || strong.length >= 1));
        })
        .map((p) => p.thumbnail!.source);
    } catch {
      return [];
    }
  }
}
