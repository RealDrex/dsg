/**
 * Affiliate links: the store page a shopper opens from "Buy" carries our
 * affiliate code, so the store pays us a commission on the sale. Never
 * changes which offer ranks first.
 *
 * A store's setting is either
 *  - query parameters added to the store link, e.g. "tag=bestprice-21" (Amazon Associates), or
 *  - a tracking-link template from an affiliate network with "{url}" where the store link goes,
 *    e.g. "https://s.click.aliexpress.com/deep_link.htm?aff_short_key=XXXX&dl_target={url}".
 * Templates may only point at known affiliate-network hosts (no open redirect).
 */
export const AFFILIATE_HOSTS = ['s.click.aliexpress.com', 'ad.admitad.com', 'prf.hn', 'click.linksynergy.com', 'tc.tradetracker.net', 'www.awin1.com', 'go.skimresources.com', 'clk.tradedoubler.com'];

export function isValidAffiliate(setting: string): boolean {
  const s = setting.trim();
  if (!s) return false;
  if (/^https:\/\//i.test(s)) {
    if (!s.includes('{url}')) return false;
    try {
      const host = new URL(s.replace('{url}', 'x')).hostname.toLowerCase();
      return AFFILIATE_HOSTS.includes(host);
    } catch {
      return false;
    }
  }
  return /^[A-Za-z0-9_.-]+=[^&\s]{1,200}(&[A-Za-z0-9_.-]+=[^&\s]{1,200})*$/.test(s);
}

/** The link to open: the store URL with the store's affiliate setting applied (or unchanged if none/invalid). */
export function withAffiliate(target: string, setting: string | null | undefined): string {
  if (!setting || !isValidAffiliate(setting)) return target;
  const s = setting.trim();
  if (/^https:\/\//i.test(s)) return s.replace('{url}', encodeURIComponent(target));
  const u = new URL(target);
  for (const [k, v] of new URLSearchParams(s)) u.searchParams.set(k, v);
  return u.toString();
}
