/**
 * Official websites of common brands, used to show the maker's logo (site
 * icon) next to a product. Products found on the web carry their own brand
 * site; this map covers the catalog and the most common names.
 */
const BRAND_DOMAINS: Record<string, string> = {
  apple: 'apple.com', samsung: 'samsung.com', sony: 'sony.com', lenovo: 'lenovo.com', hp: 'hp.com', dell: 'dell.com', asus: 'asus.com',
  acer: 'acer.com', msi: 'msi.com', microsoft: 'microsoft.com', google: 'google.com', huawei: 'huawei.com', xiaomi: 'mi.com', redmi: 'mi.com',
  oppo: 'oppo.com', honor: 'honor.com', oneplus: 'oneplus.com', nokia: 'nokia.com', lg: 'lg.com', philips: 'philips.com', bose: 'bose.com',
  jbl: 'jbl.com', beats: 'beatsbydre.com', anker: 'anker.com', logitech: 'logitech.com', razer: 'razer.com', corsair: 'corsair.com',
  hyperx: 'hyperx.com', steelseries: 'steelseries.com', elgato: 'elgato.com', nintendo: 'nintendo.com', playstation: 'playstation.com',
  xbox: 'xbox.com', canon: 'canon.com', nikon: 'nikon.com', fujifilm: 'fujifilm.com', gopro: 'gopro.com', dji: 'dji.com', garmin: 'garmin.com',
  dyson: 'dyson.com', nespresso: 'nespresso.com', "de'longhi": 'delonghi.com', delonghi: 'delonghi.com', breville: 'breville.com',
  hario: 'hario.co.jp', timemore: 'timemore.com', tefal: 'tefal.com', braun: 'braun.com', panasonic: 'panasonic.com', tcl: 'tcl.com',
  hisense: 'hisense.com', ikea: 'ikea.com', nike: 'nike.com', adidas: 'adidas.com', puma: 'puma.com', 'new balance': 'newbalance.com',
  'louis vuitton': 'louisvuitton.com', gucci: 'gucci.com', prada: 'prada.com', chanel: 'chanel.com', dior: 'dior.com', 'michael kors': 'michaelkors.com',
  coach: 'coach.com', rolex: 'rolex.com', casio: 'casio.com', 'g-shock': 'gshock.com', toyota: 'toyota.com', hyundai: 'hyundai.com',
  kia: 'kia.com', nissan: 'nissan-global.com', ford: 'ford.com', chevrolet: 'chevrolet.com', lexus: 'lexus.com', mercedes: 'mercedes-benz.com',
  'mercedes-benz': 'mercedes-benz.com', bmw: 'bmw.com', tesla: 'tesla.com', 'l\'oréal': 'loreal.com', loreal: 'loreal.com', nivea: 'nivea.com',
};

/** The brand's site for its logo, or null when unknown. */
export function brandDomain(brand: string | null | undefined): string | null {
  if (!brand) return null;
  return BRAND_DOMAINS[brand.trim().toLowerCase()] ?? null;
}

/**
 * Normalises a site name for logos and store matching: "https://www.Jarir.com/sa" → "jarir.com".
 * Returns null for anything that is not a plain public host name.
 */
export function siteDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  let host = input.trim().toLowerCase();
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//.test(host)) host = new URL(host).hostname;
  } catch {
    return null;
  }
  host = host.replace(/^www\./, '').replace(/\.$/, '').split('/')[0]!;
  if (host.length > 253 || !/^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(host)) return null;
  return host;
}
