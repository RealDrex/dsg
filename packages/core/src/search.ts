/**
 * Search-text normalisation shared by the API (catalog search) and the apps.
 *
 * People type product names in Arabic script, in English, or a mix
 * ("ايفون 16", "إيفون", "galaxy a55", "سماعة سوني"). We normalise Arabic
 * letter variants, then expand each word to its known spellings so
 * "إيفون" finds "iPhone".
 */

const TASHKEEL = /[ً-ٰٟـ]/g; // harakat, superscript alef, tatweel

/** Lower-case, unify Arabic letter variants and digits, strip diacritics and punctuation. */
export function normalizeSearchText(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(TASHKEEL, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[^\p{L}\p{N}\s.+-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Arabic spellings (already normalised) → catalog terms. Keys may be
 * multi-word. Values are alternatives; any of them may match.
 */
const RAW_ALIASES: Record<string, string[]> = {
  // Brands & product lines
  'ايفون': ['iphone'], 'افون': ['iphone'], 'اي فون': ['iphone'], 'ايفونات': ['iphone'],
  'ايباد': ['ipad'], 'اي باد': ['ipad'], 'ماك بوك': ['macbook'], 'ماكبوك': ['macbook'], 'ماك': ['mac'],
  'ايربودز': ['airpods'], 'ايربود': ['airpods'], 'اير بودز': ['airpods'], 'ابل': ['apple'], 'ابل واتش': ['apple watch'],
  'ساعه ابل': ['apple watch'], 'سامسونج': ['samsung'], 'سامسونق': ['samsung'], 'سامسونغ': ['samsung'],
  'جالكسي': ['galaxy'], 'جلكسي': ['galaxy'], 'قالكسي': ['galaxy'], 'قلكسي': ['galaxy'], 'جالاكسي': ['galaxy'], 'غالاكسي': ['galaxy'],
  'سوني': ['sony'], 'بلايستيشن': ['playstation', 'ps5'], 'بلاستيشن': ['playstation', 'ps5'], 'بلي': ['playstation', 'ps5'], 'سوني 5': ['ps5'],
  'اكس بوكس': ['xbox'], 'اكسبوكس': ['xbox'], 'نينتندو': ['nintendo'], 'سويتش': ['switch'],
  'لينوفو': ['lenovo'], 'اسوس': ['asus'], 'ايسر': ['acer'], 'ديل': ['dell'], 'اتش بي': ['hp'], 'هواوي': ['huawei'],
  'شاومي': ['xiaomi'], 'ريدمي': ['redmi'], 'اوبو': ['oppo'], 'هونر': ['honor'], 'انكر': ['anker'], 'جوجل': ['google'], 'بكسل': ['pixel'],
  'فيليبس': ['philips'], 'فلبس': ['philips'], 'فيلبس': ['philips'], 'ديلونجي': ['delonghi', "de'longhi"], 'ديلونقي': ['delonghi', "de'longhi"],
  'نسبريسو': ['nespresso'], 'دايسون': ['dyson'], 'هايبر اكس': ['hyperx'], 'هاريو': ['hario'], 'تايمور': ['timemore'], 'تايم مور': ['timemore'],
  'برو': ['pro'], 'ماكس': ['max'], 'الترا': ['ultra'], 'بلس': ['plus'], 'ميني': ['mini'], 'اير': ['air'],
  // Categories / generic words
  'جوال': ['phone'], 'جوالات': ['phone'], 'هاتف': ['phone'], 'موبايل': ['phone'], 'تلفون': ['phone'],
  'لابتوب': ['laptop'], 'لاب توب': ['laptop'], 'لابتوبات': ['laptop'], 'كمبيوتر محمول': ['laptop'], 'حاسب محمول': ['laptop'], 'حاسوب': ['laptop'],
  'تابلت': ['tablet', 'ipad'], 'ايباد او تابلت': ['tablet'], 'سماعه': ['headphones'], 'سماعات': ['headphones'], 'هيدفون': ['headphones'],
  'شاشه': ['monitor', 'tv'], 'تلفزيون': ['tv'], 'تلفاز': ['tv'], 'ساعه': ['watch'], 'ساعه ذكيه': ['watch'],
  'قهوه': ['coffee'], 'مكينه قهوه': ['coffee', 'espresso'], 'اله قهوه': ['coffee', 'espresso'], 'اسبريسو': ['espresso'],
  'مطحنه': ['grinder'], 'ميزان': ['scale'], 'قلايه هوائيه': ['airfryer'], 'قلايه': ['airfryer', 'fryer'], 'اير فراير': ['airfryer'],
  'مكنسه': ['vacuum'], 'كاميرا': ['camera'], 'سوني الفا': ['sony alpha'], 'بلايستيشن 5': ['ps5'],
};

/** Keys normalised the same way as queries, so they can be written naturally above. */
const ALIASES: Record<string, string[]> = Object.fromEntries(Object.entries(RAW_ALIASES).map(([k, v]) => [normalizeSearchText(k), v]));
const ALIAS_KEYS = Object.keys(ALIASES).sort((a, b) => b.split(' ').length - a.split(' ').length);

/** Arabic → Latin best-effort letter map, used only when no alias matches (e.g. brand names we don't know). */
const AR2LAT: Record<string, string> = {
  'ا': 'a', 'ب': 'b', 'ت': 't', 'ث': 'th', 'ج': 'g', 'ح': 'h', 'خ': 'kh', 'د': 'd', 'ذ': 'th', 'ر': 'r', 'ز': 'z', 'س': 's', 'ش': 'sh',
  'ص': 's', 'ض': 'd', 'ط': 't', 'ظ': 'z', 'ع': 'a', 'غ': 'g', 'ف': 'f', 'ق': 'q', 'ك': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n', 'ه': 'h',
  'و': 'o', 'ي': 'i', 'ء': '',
};
const isArabic = (w: string) => /[؀-ۿ]/.test(w);

/**
 * Splits a query into term groups: every group must match, any alternative
 * inside a group may match. Arabic words also keep their own spelling so
 * Arabic product names still match.
 */
export function expandSearchQuery(q: string): string[][] {
  const words = normalizeSearchText(q).split(' ').filter(Boolean).slice(0, 8);
  const groups: string[][] = [];
  for (let i = 0; i < words.length; ) {
    let matched = false;
    for (const key of ALIAS_KEYS) {
      const n = key.split(' ').length;
      if (words.slice(i, i + n).join(' ') === key) {
        groups.push([...new Set([key, ...ALIASES[key]!])]);
        i += n;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    const w = words[i]!;
    i += 1;
    // Strip the Arabic definite article for matching ("الايفون" → "ايفون").
    const bare = isArabic(w) && w.startsWith('ال') && w.length > 4 ? w.slice(2) : w;
    if (bare !== w && ALIASES[bare]) { groups.push([...new Set([w, bare, ...ALIASES[bare]!])]); continue; }
    if (isArabic(bare)) {
      const lat = [...bare].map((c) => AR2LAT[c] ?? '').join('');
      groups.push(lat.length >= 3 ? [bare, lat] : [bare]);
    } else if (w.length >= 1) {
      groups.push([w]);
    }
  }
  return groups;
}

/** Normalised, cache-friendly key for a free-text product query. */
export function searchKey(q: string): string {
  return normalizeSearchText(q).slice(0, 120);
}
