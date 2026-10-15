/**
 * Reads what a product page says about itself: its photo (Open Graph /
 * Twitter card / schema.org) and, when the page publishes structured data,
 * its price. No HTML parser dependency; only <head>-style metadata and
 * JSON-LD blocks are read, never page scripts.
 */

export interface PageFacts {
  image: string | null;
  title: string | null;
  price: { amount: number; currency: string } | null;
  inStock: boolean | null;
}

const ENTITIES: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', '#39': "'", '#x27': "'", '#x2F': '/', '#47': '/' };
const decode = (s: string) => s.replace(/&(#?[a-z0-9]+);/gi, (m, e: string) => ENTITIES[e] ?? ENTITIES[e.toLowerCase()] ?? m);

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([a-zA-Z_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) out[m[1]!.toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? '');
  return out;
}

/** Absolute https URL of an image reference on `pageUrl`, or null. */
export function absoluteImage(ref: unknown, pageUrl: string): string | null {
  const raw = typeof ref === 'string' ? ref : Array.isArray(ref) ? ref[0] : ref && typeof ref === 'object' ? (ref as { url?: unknown; contentUrl?: unknown }).url ?? (ref as { contentUrl?: unknown }).contentUrl : null;
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 2048) return null;
  try {
    const u = new URL(raw.trim(), pageUrl);
    if (u.protocol === 'http:') u.protocol = 'https:'; // most CDNs serve both; the app only loads https
    if (u.protocol !== 'https:' || u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[^\d.]/g, '')) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Finds the first schema.org Product in a JSON-LD value (handles @graph and arrays). */
function findProduct(v: unknown, depth = 0): Record<string, unknown> | null {
  if (!v || typeof v !== 'object' || depth > 4) return null;
  if (Array.isArray(v)) {
    for (const x of v) { const p = findProduct(x, depth + 1); if (p) return p; }
    return null;
  }
  const o = v as Record<string, unknown>;
  const type = o['@type'];
  if (type === 'Product' || (Array.isArray(type) && type.includes('Product'))) return o;
  return findProduct(o['@graph'], depth + 1);
}

export function extractPageFacts(html: string, pageUrl: string): PageFacts {
  const facts: PageFacts = { image: null, title: null, price: null, inStock: null };
  const meta: Record<string, string> = {};
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    const key = (a.property ?? a.name ?? a.itemprop ?? '').toLowerCase();
    if (key && a.content && !(key in meta)) meta[key] = a.content;
  }

  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try { data = JSON.parse(m[1]!.trim()); } catch { continue; }
    const p = findProduct(data);
    if (!p) continue;
    facts.image ??= absoluteImage(p.image, pageUrl);
    if (typeof p.name === 'string') facts.title ??= p.name.slice(0, 300);
    const offers = Array.isArray(p.offers) ? p.offers[0] : p.offers;
    if (offers && typeof offers === 'object' && !facts.price) {
      const o = offers as Record<string, unknown>;
      const amount = num(o.price) ?? num(o.lowPrice) ?? num((o.priceSpecification as Record<string, unknown> | undefined)?.price);
      const currency = typeof o.priceCurrency === 'string' ? o.priceCurrency.toUpperCase() : null;
      if (amount && currency && /^[A-Z]{3}$/.test(currency)) facts.price = { amount, currency };
      if (typeof o.availability === 'string') facts.inStock = /InStock|LimitedAvailability|PreOrder/i.test(o.availability) ? true : /OutOfStock|SoldOut|Discontinued/i.test(o.availability) ? false : null;
    }
  }

  facts.image ??= absoluteImage(meta['og:image:secure_url'] ?? meta['og:image'] ?? meta['twitter:image'] ?? meta['twitter:image:src'] ?? meta.image, pageUrl);
  facts.title ??= meta['og:title']?.slice(0, 300) ?? null;
  if (!facts.price) {
    const amount = num(meta['product:price:amount'] ?? meta['og:price:amount']);
    const currency = (meta['product:price:currency'] ?? meta['og:price:currency'] ?? '').toUpperCase();
    if (amount && /^[A-Z]{3}$/.test(currency)) facts.price = { amount, currency };
  }
  return facts;
}

/**
 * Icon candidates a site declares (<link rel="apple-touch-icon" | "icon">),
 * biggest first, plus the conventional /apple-touch-icon.png.
 */
export function extractIcons(html: string, pageUrl: string): string[] {
  const found: { url: string; size: number }[] = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    const rel = (a.rel ?? '').toLowerCase();
    if (!/(^|\s)(apple-touch-icon(-precomposed)?|icon|shortcut icon|mask-icon)(\s|$)/.test(rel) || rel.includes('mask-icon')) continue;
    if (/svg/.test(a.type ?? '') || /\.svg(\?|$)/i.test(a.href ?? '')) continue; // SVG icons are skipped (not served by us)
    const url = absoluteImage(a.href, pageUrl);
    if (!url) continue;
    const sizes = (a.sizes ?? '').split(/\s+/).map((s) => Number(s.split('x')[0])).filter(Number.isFinite);
    const size = sizes.length ? Math.max(...sizes) : rel.includes('apple-touch-icon') ? 180 : 32;
    found.push({ url, size });
  }
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    if ((a.name ?? '').toLowerCase() === 'msapplication-tileimage') { const url = absoluteImage(a.content, pageUrl); if (url) found.push({ url, size: 144 }); }
  }
  found.sort((x, y) => y.size - x.size);
  const out = [...new Set(found.map((f) => f.url))];
  const touch = absoluteImage('/apple-touch-icon.png', pageUrl);
  if (touch && !out.includes(touch)) out.push(touch);
  return out;
}
