import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { gtinCheckDigit } from '@bestprice/core';
import { createDb, type DB } from './client';
import { branches, dataSources, offers, priceObservations, productGtins, products, sponsoredPlacements, stores, users } from './schema';
import { runMigrations } from './migrate';
import { hashPassword, passwordProblem } from '../lib/crypto';
import { matchKey } from '../ingest/pipeline';

/**
 * Demo catalog for development and design review. Every source is of type
 * `demo`, so the apps label these prices as demo data. Replace with real
 * partner/affiliate sources before launch.
 */

const gtin = (body12: string) => body12 + String(gtinCheckDigit(body12));
const S = (key: string, label: string, labelAr: string, value: string) => ({ key, label, labelAr, value });

const STORES = [
  { slug: 'jarir', name: 'Jarir', nameAr: 'جرير', brandColor: '#C8102E', website: 'https://www.jarir.com', allowedDomains: ['jarir.com'] },
  { slug: 'amazon-sa', name: 'Amazon', nameAr: 'أمازون', brandColor: '#232F3E', website: 'https://www.amazon.sa', allowedDomains: ['amazon.sa'] },
  { slug: 'noon', name: 'noon', nameAr: 'نون', brandColor: '#FEEE00', website: 'https://www.noon.com', allowedDomains: ['noon.com'] },
  { slug: 'extra', name: 'eXtra', nameAr: 'إكسترا', brandColor: '#F26B21', website: 'https://www.extra.com', allowedDomains: ['extra.com'] },
  { slug: 'saco', name: 'SACO', nameAr: 'ساكو', brandColor: '#0057A8', website: 'https://www.saco.sa', allowedDomains: ['saco.sa'] },
] as const;

const BRANCHES: Record<string, { name: string; nameAr: string; lat: number; lng: number }[]> = {
  jarir: [{ name: 'Olaya branch', nameAr: 'فرع العليا', lat: 24.6950, lng: 46.6850 }, { name: 'Khurais branch', nameAr: 'فرع خريص', lat: 24.7290, lng: 46.7880 }],
  extra: [{ name: 'Malqa branch', nameAr: 'فرع الملقا', lat: 24.8050, lng: 46.6120 }],
  saco: [{ name: 'Takhassusi branch', nameAr: 'فرع التخصصي', lat: 24.7120, lng: 46.6650 }],
};

type P = {
  key: string; name: string; nameAr?: string; brand: string; model: string; category: string; gtin: string;
  attributes: Record<string, number | string | boolean>; specs: ReturnType<typeof S>[]; specSource: [string, string];
};

const PRODUCTS: P[] = [
  {
    key: 'ideapad', name: 'Lenovo IdeaPad Slim 5 · 14″', brand: 'Lenovo', model: '83HW0021AX', category: 'laptop', gtin: gtin('019752984621'),
    attributes: { ram_gb: 16, storage_gb: 512, cpu_score: 70, gpu_score: 30, battery_h: 12, weight_kg: 1.46, warranty_months: 24, screen_in: 14 },
    specs: [S('cpu', 'Processor', 'المعالج', 'Ryzen 7 7730U'), S('ram', 'Memory', 'الذاكرة', '16GB RAM'), S('storage', 'Storage', 'التخزين', '512GB SSD'), S('screen', 'Display', 'الشاشة', '14″ WUXGA'), S('weight', 'Weight', 'الوزن', '1.46 kg'), S('battery', 'Battery', 'البطارية', 'Up to 12h*')],
    specSource: ['Lenovo official product page', 'https://www.lenovo.com/'],
  },
  {
    key: 'vivobook', name: 'ASUS Vivobook 15', brand: 'ASUS', model: 'X1504VA', category: 'laptop', gtin: gtin('019761234567'),
    attributes: { ram_gb: 8, storage_gb: 512, cpu_score: 50, gpu_score: 20, battery_h: 7, weight_kg: 1.7, warranty_months: 12, screen_in: 15.6 },
    specs: [S('cpu', 'Processor', 'المعالج', 'Core i5-1335U'), S('ram', 'Memory', 'الذاكرة', '8GB RAM'), S('storage', 'Storage', 'التخزين', '512GB SSD'), S('screen', 'Display', 'الشاشة', '15.6″ FHD'), S('weight', 'Weight', 'الوزن', '1.7 kg')],
    specSource: ['ASUS official product page', 'https://www.asus.com/'],
  },
  {
    key: 'macair', name: 'MacBook Air M2 · 13″', brand: 'Apple', model: 'MLY33', category: 'laptop', gtin: gtin('019425333061'),
    attributes: { ram_gb: 8, storage_gb: 256, cpu_score: 80, gpu_score: 40, battery_h: 18, weight_kg: 1.24, warranty_months: 12, screen_in: 13.6 },
    specs: [S('cpu', 'Chip', 'المعالج', 'Apple M2'), S('ram', 'Memory', 'الذاكرة', '8GB'), S('storage', 'Storage', 'التخزين', '256GB SSD'), S('screen', 'Display', 'الشاشة', '13.6″ Liquid Retina'), S('weight', 'Weight', 'الوزن', '1.24 kg'), S('battery', 'Battery', 'البطارية', 'Up to 18h*')],
    specSource: ['Apple technical specifications', 'https://www.apple.com/'],
  },
  {
    key: 'hp15', name: 'HP 15 Laptop', brand: 'HP', model: '15-fd0000', category: 'laptop', gtin: gtin('019672345678'),
    attributes: { ram_gb: 4, storage_gb: 128, cpu_score: 22, gpu_score: 10, battery_h: 6, weight_kg: 1.69, warranty_months: 12 },
    specs: [S('cpu', 'Processor', 'المعالج', 'Celeron N100'), S('ram', 'Memory', 'الذاكرة', '4GB RAM'), S('storage', 'Storage', 'التخزين', '128GB eMMC')],
    specSource: ['HP official product page', 'https://www.hp.com/'],
  },
  {
    key: 'iphone16', name: 'iPhone 16 · 128GB', brand: 'Apple', model: 'A3287-128', category: 'phone', gtin: gtin('019594978472'),
    attributes: { cpu_score: 90, camera_score: 85, battery_mah: 3561, storage_gb: 128, update_years: 6 },
    specs: [S('chip', 'Chip', 'المعالج', 'A18'), S('storage', 'Storage', 'التخزين', '128GB'), S('camera', 'Camera', 'الكاميرا', '48MP Fusion'), S('screen', 'Display', 'الشاشة', '6.1″ OLED')],
    specSource: ['Apple technical specifications', 'https://www.apple.com/'],
  },
  {
    key: 'galaxya55', name: 'Samsung Galaxy A55 · 256GB', brand: 'Samsung', model: 'SM-A556E', category: 'phone', gtin: gtin('880609412345'),
    attributes: { cpu_score: 60, camera_score: 65, battery_mah: 5000, storage_gb: 256, update_years: 4 },
    specs: [S('chip', 'Chip', 'المعالج', 'Exynos 1480'), S('storage', 'Storage', 'التخزين', '256GB'), S('battery', 'Battery', 'البطارية', '5000 mAh'), S('screen', 'Display', 'الشاشة', '6.6″ AMOLED 120Hz')],
    specSource: ['Samsung official product page', 'https://www.samsung.com/'],
  },
  {
    key: 'sonyxm5', name: 'Sony WH-1000XM5', brand: 'Sony', model: 'WH1000XM5', category: 'headphones', gtin: gtin('454873553546'),
    attributes: { mic_score: 80, sound_score: 88, anc: true, wireless: true, comfort_score: 85, battery_h: 30 },
    specs: [S('type', 'Type', 'النوع', 'Over-ear, wireless'), S('anc', 'Noise cancelling', 'عزل الضوضاء', 'Yes'), S('battery', 'Battery', 'البطارية', 'Up to 30h')],
    specSource: ['Sony official product page', 'https://www.sony.com/'],
  },
  {
    key: 'hyperx', name: 'HyperX Cloud III', brand: 'HyperX', model: '727A8AA', category: 'headphones', gtin: gtin('019652812345'),
    attributes: { mic_score: 85, sound_score: 75, anc: false, wireless: false, comfort_score: 90, battery_h: 0 },
    specs: [S('type', 'Type', 'النوع', 'Wired gaming headset'), S('mic', 'Microphone', 'المايك', 'Detachable, noise-cancelling'), S('platforms', 'Platforms', 'الأجهزة', 'PC, PS5, Xbox, Switch')],
    specSource: ['HyperX official product page', 'https://hyperx.com/'],
  },
  {
    key: 'dedica', name: 'DeLonghi Dedica EC685', brand: "De'Longhi", model: 'EC685.M', category: 'coffee', gtin: gtin('804409313245'),
    attributes: { pressure_bar: 15 }, specs: [S('type', 'Type', 'النوع', 'Espresso machine'), S('pressure', 'Pressure', 'الضغط', '15 bar')],
    specSource: ["De'Longhi official product page", 'https://www.delonghi.com/'],
  },
  {
    key: 'timemore', name: 'Timemore Chestnut C3 Hand Grinder', nameAr: 'مطحنة قهوة يدوية Timemore C3', brand: 'Timemore', model: 'C3', category: 'coffee', gtin: gtin('695317012345'),
    attributes: {}, specs: [S('type', 'Type', 'النوع', 'Hand grinder'), S('burr', 'Burr', 'الشفرات', 'Stainless steel S2C')],
    specSource: ['Timemore official product page', 'https://www.timemore.com/'],
  },
  {
    key: 'scale', name: 'Digital Coffee Scale with Timer', nameAr: 'ميزان قهوة رقمي مع مؤقت', brand: 'Timemore', model: 'Black Mirror Basic', category: 'coffee', gtin: gtin('695317054321'),
    attributes: {}, specs: [S('type', 'Type', 'النوع', 'Scale + timer'), S('precision', 'Precision', 'الدقة', '0.1 g')],
    specSource: ['Timemore official product page', 'https://www.timemore.com/'],
  },
  {
    key: 'v60', name: 'Hario V60 Starter Set', nameAr: 'مجموعة V60 مع فلاتر', brand: 'Hario', model: 'VDS-3012', category: 'coffee', gtin: gtin('497779201234'),
    attributes: {}, specs: [S('type', 'Type', 'النوع', 'Pour-over set'), S('includes', 'Includes', 'يشمل', 'Dripper, server, filters')],
    specSource: ['Hario official product page', 'https://www.hario-europe.com/'],
  },
  {
    key: 'ipad10', name: 'iPad 10th Gen · 64GB', brand: 'Apple', model: 'MPQ03', category: 'tablet', gtin: gtin('019425312345'),
    attributes: {}, specs: [S('chip', 'Chip', 'المعالج', 'A14 Bionic'), S('storage', 'Storage', 'التخزين', '64GB'), S('screen', 'Display', 'الشاشة', '10.9″')],
    specSource: ['Apple technical specifications', 'https://www.apple.com/'],
  },
  {
    key: 'airfryer', name: 'Philips Airfryer XL', brand: 'Philips', model: 'HD9270', category: 'home', gtin: gtin('871010390123'),
    attributes: {}, specs: [S('capacity', 'Capacity', 'السعة', '6.2 L'), S('power', 'Power', 'القدرة', '2000 W')],
    specSource: ['Philips official product page', 'https://www.philips.com/'],
  },
];

type O = { store: string; channel: 'local' | 'online'; price: number; ship: number | null; stock: 'in_stock' | 'limited' | 'out_of_stock' | 'unknown'; warranty: number; ret: number; eta: number; ageMin: number };
const OFFERS: Record<string, O[]> = {
  ideapad: [
    { store: 'jarir', channel: 'local', price: 2849, ship: 0, stock: 'in_stock', warranty: 24, ret: 7, eta: 2, ageMin: 12 },
    { store: 'amazon-sa', channel: 'online', price: 2789, ship: 0, stock: 'in_stock', warranty: 12, ret: 15, eta: 24, ageMin: 40 },
    { store: 'noon', channel: 'online', price: 2739, ship: 39, stock: 'limited', warranty: 12, ret: 15, eta: 60, ageMin: 180 },
    { store: 'extra', channel: 'local', price: 2899, ship: 0, stock: 'unknown', warranty: 24, ret: 7, eta: 2, ageMin: 60 * 30 },
  ],
  vivobook: [
    { store: 'noon', channel: 'online', price: 2299, ship: 0, stock: 'in_stock', warranty: 12, ret: 15, eta: 48, ageMin: 90 },
    { store: 'jarir', channel: 'local', price: 2399, ship: 0, stock: 'in_stock', warranty: 24, ret: 7, eta: 2, ageMin: 30 },
  ],
  macair: [
    { store: 'amazon-sa', channel: 'online', price: 3499, ship: 0, stock: 'in_stock', warranty: 12, ret: 15, eta: 24, ageMin: 50 },
    { store: 'jarir', channel: 'local', price: 3599, ship: 0, stock: 'in_stock', warranty: 12, ret: 7, eta: 2, ageMin: 20 },
  ],
  hp15: [{ store: 'extra', channel: 'local', price: 1499, ship: 0, stock: 'in_stock', warranty: 12, ret: 7, eta: 2, ageMin: 120 }],
  iphone16: [
    { store: 'extra', channel: 'local', price: 3349, ship: 0, stock: 'in_stock', warranty: 12, ret: 7, eta: 2, ageMin: 45 },
    { store: 'jarir', channel: 'local', price: 3399, ship: 0, stock: 'in_stock', warranty: 12, ret: 7, eta: 2, ageMin: 25 },
    { store: 'amazon-sa', channel: 'online', price: 3379, ship: 0, stock: 'in_stock', warranty: 12, ret: 15, eta: 24, ageMin: 70 },
  ],
  galaxya55: [
    { store: 'noon', channel: 'online', price: 1399, ship: 0, stock: 'in_stock', warranty: 12, ret: 15, eta: 48, ageMin: 100 },
    { store: 'extra', channel: 'local', price: 1449, ship: 0, stock: 'in_stock', warranty: 24, ret: 7, eta: 2, ageMin: 60 },
  ],
  sonyxm5: [
    { store: 'amazon-sa', channel: 'online', price: 1149, ship: 0, stock: 'in_stock', warranty: 12, ret: 15, eta: 24, ageMin: 30 },
    { store: 'jarir', channel: 'local', price: 1249, ship: 0, stock: 'in_stock', warranty: 24, ret: 7, eta: 2, ageMin: 50 },
  ],
  hyperx: [
    { store: 'amazon-sa', channel: 'online', price: 399, ship: 0, stock: 'in_stock', warranty: 24, ret: 15, eta: 24, ageMin: 80 },
    { store: 'jarir', channel: 'local', price: 429, ship: 0, stock: 'in_stock', warranty: 24, ret: 7, eta: 2, ageMin: 40 },
  ],
  dedica: [
    { store: 'noon', channel: 'online', price: 899, ship: 0, stock: 'in_stock', warranty: 12, ret: 15, eta: 48, ageMin: 120 },
    { store: 'saco', channel: 'local', price: 949, ship: 0, stock: 'in_stock', warranty: 24, ret: 7, eta: 2, ageMin: 90 },
  ],
  timemore: [{ store: 'amazon-sa', channel: 'online', price: 289, ship: 0, stock: 'in_stock', warranty: 12, ret: 15, eta: 24, ageMin: 60 }],
  scale: [{ store: 'amazon-sa', channel: 'online', price: 149, ship: 0, stock: 'in_stock', warranty: 12, ret: 15, eta: 24, ageMin: 60 }],
  v60: [{ store: 'noon', channel: 'online', price: 179, ship: 15, stock: 'in_stock', warranty: 0, ret: 15, eta: 48, ageMin: 90 }],
  ipad10: [
    { store: 'jarir', channel: 'local', price: 1299, ship: 0, stock: 'in_stock', warranty: 12, ret: 7, eta: 2, ageMin: 60 },
    { store: 'amazon-sa', channel: 'online', price: 1329, ship: 0, stock: 'in_stock', warranty: 12, ret: 15, eta: 24, ageMin: 60 },
  ],
  airfryer: [
    { store: 'extra', channel: 'local', price: 449, ship: 0, stock: 'in_stock', warranty: 24, ret: 7, eta: 2, ageMin: 240 },
    { store: 'noon', channel: 'online', price: 469, ship: 0, stock: 'in_stock', warranty: 12, ret: 15, eta: 48, ageMin: 200 },
  ],
};

/** Weekly lows for the last ~90 days (matches the design's chart for the IdeaPad). */
const IDEAPAD_HISTORY = [3199, 3149, 3149, 2999, 3049, 2949, 2899, 2999, 2799, 2849, 2699, 2799, 2739];

export async function seed(db: DB, opts: { demo: boolean; adminEmail?: string; adminPassword?: string; log?: (m: string) => void }) {
  const log = opts.log ?? console.log;
  if (opts.adminEmail && opts.adminPassword) {
    const existing = await db.query.users.findFirst({ where: eq(users.email, opts.adminEmail.toLowerCase()) });
    if (!existing) {
      const problem = passwordProblem(opts.adminPassword, opts.adminEmail);
      if (problem) throw new Error(`ADMIN_PASSWORD rejected: ${problem}`);
      await db.insert(users).values({ kind: 'member', role: 'admin', email: opts.adminEmail.toLowerCase(), passwordHash: await hashPassword(opts.adminPassword), name: 'Admin' });
      log(`admin created: ${opts.adminEmail}`);
    }
  }
  if (!opts.demo) return;
  if (await db.query.stores.findFirst()) {
    log('catalog already present, skipping demo seed');
    return;
  }

  const storeIds: Record<string, string> = {};
  const sourceIds: Record<string, string> = {};
  for (const s of STORES) {
    const [row] = await db.insert(stores).values({ ...s, allowedDomains: [...s.allowedDomains] }).returning();
    storeIds[s.slug] = row!.id;
    const [src] = await db.insert(dataSources).values({
      name: `${s.name} — demo data`, type: 'demo', storeId: row!.id, active: true,
      termsNote: 'Demo data for development only. Not real prices. Replace with an official API, partner catalog or affiliate feed before launch.',
    }).returning();
    sourceIds[s.slug] = src!.id;
    for (const b of BRANCHES[s.slug] ?? []) await db.insert(branches).values({ ...b, storeId: row!.id, city: 'Riyadh' });
  }

  const now = Date.now();
  const day = 86_400_000;
  for (const p of PRODUCTS) {
    const [row] = await db.insert(products).values({
      name: p.name, nameAr: p.nameAr ?? null, brand: p.brand, model: p.model, matchKey: matchKey(p.brand, p.model), category: p.category,
      attributes: p.attributes, specs: p.specs, specSourceLabel: p.specSource[0], specSourceUrl: p.specSource[1],
    }).returning();
    await db.insert(productGtins).values({ gtin: p.gtin.padStart(14, '0'), productId: row!.id });

    for (const o of OFFERS[p.key] ?? []) {
      const store = STORES.find((s) => s.slug === o.store)!;
      const [off] = await db.insert(offers).values({
        productId: row!.id, storeId: storeIds[o.store]!, sourceId: sourceIds[o.store]!, externalId: `${p.key}-${o.store}`,
        channel: o.channel, priceMinor: o.price * 100, shippingMinor: o.ship === null ? null : o.ship * 100, stock: o.stock,
        warrantyMonths: o.warranty, returnDays: o.ret, etaHours: o.eta, url: `${store.website}/`,
        observedAt: new Date(now - o.ageMin * 60_000),
      }).returning();
      // Price history: the IdeaPad follows the design curve; other products get a gentle deterministic walk.
      const final = o.price + (o.ship ?? 0);
      const series = p.key === 'ideapad'
        ? IDEAPAD_HISTORY.map((v) => v + (final - 2739))
        : Array.from({ length: 13 }, (_, i) => Math.round(final * (1 + 0.08 * Math.cos(i / 2 + p.key.length) * (1 - i / 13))));
      for (let i = 0; i < series.length; i++) {
        await db.insert(priceObservations).values({ offerId: off!.id, productId: row!.id, finalMinor: series[i]! * 100, observedAt: new Date(now - (series.length - 1 - i) * 7 * day - (i === series.length - 1 ? o.ageMin * 60_000 : 0)) });
      }
    }
    if (p.key === 'ideapad') {
      await db.insert(sponsoredPlacements).values({ productId: row!.id, storeId: storeIds.saco!, label: 'SACO · same laptop with a free bag', labelAr: 'ساكو · نفس الجهاز مع حقيبة مجانية', priceMinor: 289900, url: 'https://www.saco.sa/' });
    }
  }
  log(`demo catalog seeded: ${PRODUCTS.length} products, ${STORES.length} stores`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const db = createDb(url);
  await runMigrations(db);
  await seed(db, { demo: process.env.SEED_DEMO_DATA !== 'false', adminEmail: process.env.ADMIN_EMAIL, adminPassword: process.env.ADMIN_PASSWORD || undefined });
  await db.$client.end();
}
