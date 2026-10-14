import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq, isNull } from 'drizzle-orm';
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
  // Stores without demo prices: web discovery can attach prices from their pages.
  { slug: 'carrefour', name: 'Carrefour', nameAr: 'كارفور', brandColor: '#1E5BC6', website: 'https://www.carrefourksa.com', allowedDomains: ['carrefourksa.com'] },
  { slug: 'virgin', name: 'Virgin Megastore', nameAr: 'فيرجن ميجاستور', brandColor: '#E10A0A', website: 'https://www.virginmegastore.sa', allowedDomains: ['virginmegastore.sa'] },
  { slug: 'apple', name: 'Apple Store', nameAr: 'متجر أبل', brandColor: '#1D1D1F', website: 'https://www.apple.com/sa/', allowedDomains: ['apple.com'] },
  { slug: 'samsung', name: 'Samsung', nameAr: 'سامسونج', brandColor: '#1428A0', website: 'https://www.samsung.com/sa/', allowedDomains: ['samsung.com'] },
  { slug: 'lulu', name: 'LuLu', nameAr: 'لولو', brandColor: '#D71920', website: 'https://www.luluhypermarket.com', allowedDomains: ['luluhypermarket.com'] },
  { slug: 'nahdi', name: 'Nahdi', nameAr: 'النهدي', brandColor: '#00A859', website: 'https://www.nahdionline.com', allowedDomains: ['nahdionline.com'] },
  { slug: 'ikea', name: 'IKEA', nameAr: 'ايكيا', brandColor: '#0058A3', website: 'https://www.ikea.com/sa/', allowedDomains: ['ikea.com'] },
  { slug: 'blackbox', name: 'Black Box', nameAr: 'بلاك بوكس', brandColor: '#2B2B2B', website: 'https://www.blackbox.com.sa', allowedDomains: ['blackbox.com.sa'] },
  { slug: 'stc', name: 'stc', nameAr: 'stc', brandColor: '#4F008C', website: 'https://www.stc.com.sa', allowedDomains: ['stc.com.sa'] },
  { slug: 'namshi', name: 'Namshi', nameAr: 'نمشي', brandColor: '#111111', website: 'https://www.namshi.com', allowedDomains: ['namshi.com'] },
  { slug: 'syarah', name: 'Syarah', nameAr: 'سيارة', brandColor: '#0A7CFF', website: 'https://syarah.com', allowedDomains: ['syarah.com'] },
  // Ship from abroad: shown with a "from abroad" label; prices may be converted from another currency.
  { slug: 'aliexpress', name: 'AliExpress', nameAr: 'علي إكسبريس', brandColor: '#E62E04', website: 'https://ar.aliexpress.com', allowedDomains: ['aliexpress.com', 'aliexpress.us'], kind: 'global' },
  { slug: 'temu', name: 'Temu', nameAr: 'تيمو', brandColor: '#FB7701', website: 'https://www.temu.com', allowedDomains: ['temu.com'], kind: 'global' },
  { slug: 'amazon-com', name: 'Amazon.com', nameAr: 'أمازون العالمي', brandColor: '#232F3E', website: 'https://www.amazon.com', allowedDomains: ['amazon.com'], kind: 'global' },
  { slug: 'ebay', name: 'eBay', nameAr: 'إيباي', brandColor: '#0064D2', website: 'https://www.ebay.com', allowedDomains: ['ebay.com'], kind: 'global' },
  { slug: 'shein', name: 'SHEIN', nameAr: 'شي إن', brandColor: '#111111', website: 'https://ar.shein.com', allowedDomains: ['shein.com'], kind: 'global' },
  // Classifieds: used items between people.
  { slug: 'haraj', name: 'Haraj', nameAr: 'حراج', brandColor: '#1B8A5A', website: 'https://haraj.com.sa', allowedDomains: ['haraj.com.sa'], kind: 'classifieds' },
  { slug: 'opensooq', name: 'OpenSooq', nameAr: 'السوق المفتوح', brandColor: '#0A6CC2', website: 'https://sa.opensooq.com', allowedDomains: ['opensooq.com'], kind: 'classifieds' },
  { slug: 'motory', name: 'Motory', nameAr: 'موتري', brandColor: '#E4002B', website: 'https://ksa.motory.com', allowedDomains: ['motory.com'], kind: 'classifieds' },
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
    key: 'iphone16', name: 'iPhone 16 · 128GB', nameAr: 'آيفون 16 · 128 جيجا', brand: 'Apple', model: 'A3287-128', category: 'phone', gtin: gtin('019594978472'),
    attributes: { cpu_score: 90, camera_score: 85, battery_mah: 3561, storage_gb: 128, update_years: 6 },
    specs: [S('chip', 'Chip', 'المعالج', 'A18'), S('storage', 'Storage', 'التخزين', '128GB'), S('camera', 'Camera', 'الكاميرا', '48MP Fusion'), S('screen', 'Display', 'الشاشة', '6.1″ OLED')],
    specSource: ['Apple technical specifications', 'https://www.apple.com/'],
  },
  {
    key: 'galaxya55', name: 'Samsung Galaxy A55 · 256GB', nameAr: 'سامسونج جالكسي A55 · 256 جيجا', brand: 'Samsung', model: 'SM-A556E', category: 'phone', gtin: gtin('880609412345'),
    attributes: { cpu_score: 60, camera_score: 65, battery_mah: 5000, storage_gb: 256, update_years: 4 },
    specs: [S('chip', 'Chip', 'المعالج', 'Exynos 1480'), S('storage', 'Storage', 'التخزين', '256GB'), S('battery', 'Battery', 'البطارية', '5000 mAh'), S('screen', 'Display', 'الشاشة', '6.6″ AMOLED 120Hz')],
    specSource: ['Samsung official product page', 'https://www.samsung.com/'],
  },
  {
    key: 'sonyxm5', name: 'Sony WH-1000XM5', nameAr: 'سماعة سوني WH-1000XM5', brand: 'Sony', model: 'WH1000XM5', category: 'headphones', gtin: gtin('454873553546'),
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
    key: 'dedica', name: 'DeLonghi Dedica EC685', nameAr: 'مكينة اسبريسو ديلونجي ديديكا', brand: "De'Longhi", model: 'EC685.M', category: 'coffee', gtin: gtin('804409313245'),
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
    key: 'airfryer', name: 'Philips Airfryer XL', nameAr: 'قلاية هوائية فيليبس XL', brand: 'Philips', model: 'HD9270', category: 'home', gtin: gtin('871010390123'),
    attributes: {}, specs: [S('capacity', 'Capacity', 'السعة', '6.2 L'), S('power', 'Power', 'القدرة', '2000 W')],
    specSource: ['Philips official product page', 'https://www.philips.com/'],
  },
  {
    key: 'iphone16pro', name: 'iPhone 16 Pro · 256GB', nameAr: 'آيفون 16 برو · 256 جيجا', brand: 'Apple', model: 'A3293-256', category: 'phone', gtin: gtin('019594978601'),
    attributes: { cpu_score: 97, camera_score: 95, battery_mah: 3582, storage_gb: 256, update_years: 6 },
    specs: [S('chip', 'Chip', 'المعالج', 'A18 Pro'), S('storage', 'Storage', 'التخزين', '256GB'), S('camera', 'Camera', 'الكاميرا', '48MP + 5x telephoto'), S('screen', 'Display', 'الشاشة', '6.3″ ProMotion OLED')],
    specSource: ['Apple technical specifications', 'https://www.apple.com/'],
  },
  {
    key: 'iphone15', name: 'iPhone 15 · 128GB', nameAr: 'آيفون 15 · 128 جيجا', brand: 'Apple', model: 'A3090-128', category: 'phone', gtin: gtin('019594902118'),
    attributes: { cpu_score: 82, camera_score: 80, battery_mah: 3349, storage_gb: 128, update_years: 5 },
    specs: [S('chip', 'Chip', 'المعالج', 'A16 Bionic'), S('storage', 'Storage', 'التخزين', '128GB'), S('camera', 'Camera', 'الكاميرا', '48MP'), S('screen', 'Display', 'الشاشة', '6.1″ OLED')],
    specSource: ['Apple technical specifications', 'https://www.apple.com/'],
  },
  {
    key: 's25ultra', name: 'Samsung Galaxy S25 Ultra · 256GB', nameAr: 'سامسونج جالكسي S25 الترا · 256 جيجا', brand: 'Samsung', model: 'SM-S938B', category: 'phone', gtin: gtin('880609456789'),
    attributes: { cpu_score: 96, camera_score: 94, battery_mah: 5000, storage_gb: 256, update_years: 7 },
    specs: [S('chip', 'Chip', 'المعالج', 'Snapdragon 8 Elite'), S('storage', 'Storage', 'التخزين', '256GB'), S('camera', 'Camera', 'الكاميرا', '200MP'), S('screen', 'Display', 'الشاشة', '6.9″ AMOLED 120Hz')],
    specSource: ['Samsung official product page', 'https://www.samsung.com/'],
  },
  {
    key: 'redmi13', name: 'Xiaomi Redmi Note 13 · 256GB', nameAr: 'شاومي ريدمي نوت 13 · 256 جيجا', brand: 'Xiaomi', model: '23129RAA4G', category: 'phone', gtin: gtin('694144567890'),
    attributes: { cpu_score: 40, camera_score: 50, battery_mah: 5000, storage_gb: 256, update_years: 3 },
    specs: [S('chip', 'Chip', 'المعالج', 'Snapdragon 685'), S('storage', 'Storage', 'التخزين', '256GB'), S('battery', 'Battery', 'البطارية', '5000 mAh'), S('screen', 'Display', 'الشاشة', '6.67″ AMOLED')],
    specSource: ['Xiaomi official product page', 'https://www.mi.com/'],
  },
  {
    key: 'airpodspro2', name: 'AirPods Pro 2 (USB-C)', nameAr: 'سماعات ايربودز برو 2', brand: 'Apple', model: 'MTJV3', category: 'headphones', gtin: gtin('019425350456'),
    attributes: { mic_score: 80, sound_score: 85, anc: true, wireless: true, comfort_score: 85, battery_h: 6 },
    specs: [S('type', 'Type', 'النوع', 'In-ear, wireless'), S('anc', 'Noise cancelling', 'عزل الضوضاء', 'Yes, adaptive'), S('battery', 'Battery', 'البطارية', 'Up to 6h (30h with case)')],
    specSource: ['Apple technical specifications', 'https://www.apple.com/'],
  },
  {
    key: 'airpods4', name: 'AirPods 4', nameAr: 'سماعات ايربودز 4', brand: 'Apple', model: 'MXP63', category: 'headphones', gtin: gtin('019594985012'),
    attributes: { mic_score: 70, sound_score: 75, anc: false, wireless: true, comfort_score: 80, battery_h: 5 },
    specs: [S('type', 'Type', 'النوع', 'Earbuds, wireless'), S('battery', 'Battery', 'البطارية', 'Up to 5h (30h with case)')],
    specSource: ['Apple technical specifications', 'https://www.apple.com/'],
  },
  {
    key: 'jblflip6', name: 'JBL Flip 6 Bluetooth Speaker', nameAr: 'سماعة بلوتوث JBL Flip 6', brand: 'JBL', model: 'JBLFLIP6BLK', category: 'headphones', gtin: gtin('605025634567'),
    attributes: { sound_score: 78, wireless: true, battery_h: 12 },
    specs: [S('type', 'Type', 'النوع', 'Portable speaker'), S('water', 'Water resistance', 'مقاومة الماء', 'IP67'), S('battery', 'Battery', 'البطارية', 'Up to 12h')],
    specSource: ['JBL official product page', 'https://www.jbl.com/'],
  },
  {
    key: 'watch10', name: 'Apple Watch Series 10 · 46mm', nameAr: 'ساعة ابل الإصدار 10 · 46 مم', brand: 'Apple', model: 'MWWP3', category: 'watch', gtin: gtin('019594976543'),
    attributes: {}, specs: [S('size', 'Case', 'المقاس', '46mm aluminium'), S('screen', 'Display', 'الشاشة', 'Always-On Retina'), S('battery', 'Battery', 'البطارية', 'Up to 18h')],
    specSource: ['Apple technical specifications', 'https://www.apple.com/'],
  },
  {
    key: 'ipadair', name: 'iPad Air 11″ M2 · 128GB', nameAr: 'آيباد اير 11 إنش M2 · 128 جيجا', brand: 'Apple', model: 'MUWD3', category: 'tablet', gtin: gtin('019594932112'),
    attributes: {}, specs: [S('chip', 'Chip', 'المعالج', 'Apple M2'), S('storage', 'Storage', 'التخزين', '128GB'), S('screen', 'Display', 'الشاشة', '11″ Liquid Retina')],
    specSource: ['Apple technical specifications', 'https://www.apple.com/'],
  },
  {
    key: 'tabs9fe', name: 'Samsung Galaxy Tab S9 FE · 128GB', nameAr: 'سامسونج جالكسي تاب S9 FE', brand: 'Samsung', model: 'SM-X510', category: 'tablet', gtin: gtin('880609498765'),
    attributes: {}, specs: [S('chip', 'Chip', 'المعالج', 'Exynos 1380'), S('storage', 'Storage', 'التخزين', '128GB'), S('screen', 'Display', 'الشاشة', '10.9″'), S('pen', 'Pen', 'القلم', 'S Pen included')],
    specSource: ['Samsung official product page', 'https://www.samsung.com/'],
  },
  {
    key: 'ps5', name: 'PlayStation 5 Slim · Disc Edition', nameAr: 'بلايستيشن 5 سليم · نسخة الأقراص', brand: 'Sony', model: 'CFI-2016', category: 'gaming', gtin: gtin('071171954321'),
    attributes: {}, specs: [S('storage', 'Storage', 'التخزين', '1TB SSD'), S('drive', 'Disc drive', 'مشغل الأقراص', 'Ultra HD Blu-ray'), S('res', 'Output', 'الدقة', 'Up to 4K 120Hz')],
    specSource: ['PlayStation official page', 'https://www.playstation.com/'],
  },
  {
    key: 'switcholed', name: 'Nintendo Switch OLED', nameAr: 'نينتندو سويتش OLED', brand: 'Nintendo', model: 'HEG-001', category: 'gaming', gtin: gtin('004549612345'),
    attributes: {}, specs: [S('screen', 'Display', 'الشاشة', '7″ OLED'), S('storage', 'Storage', 'التخزين', '64GB')],
    specSource: ['Nintendo official page', 'https://www.nintendo.com/'],
  },
  {
    key: 'tv55', name: 'Samsung 55″ Crystal UHD 4K TV', nameAr: 'شاشة سامسونج 55 بوصة 4K', brand: 'Samsung', model: 'UA55DU7000', category: 'tv', gtin: gtin('880609412398'),
    attributes: {}, specs: [S('size', 'Size', 'المقاس', '55″'), S('res', 'Resolution', 'الدقة', '4K UHD'), S('os', 'Smart TV', 'النظام', 'Tizen')],
    specSource: ['Samsung official product page', 'https://www.samsung.com/'],
  },
  {
    key: 'vertuo', name: 'Nespresso Vertuo Pop', nameAr: 'مكينة قهوة نسبريسو فيرتو بوب', brand: 'Nespresso', model: 'GCV2', category: 'coffee', gtin: gtin('763197654321'),
    attributes: {}, specs: [S('type', 'Type', 'النوع', 'Capsule machine'), S('tank', 'Water tank', 'خزان الماء', '0.56 L')],
    specSource: ['Nespresso official page', 'https://www.nespresso.com/'],
  },
  {
    key: 'anker', name: 'Anker 737 Power Bank 24,000mAh', nameAr: 'باور بانك انكر 737', brand: 'Anker', model: 'A1289', category: 'home', gtin: gtin('019473312345'),
    attributes: {}, specs: [S('capacity', 'Capacity', 'السعة', '24,000 mAh'), S('output', 'Output', 'الشحن', '140W USB-C')],
    specSource: ['Anker official page', 'https://www.anker.com/'],
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
  iphone16pro: [
    { store: 'jarir', channel: 'local', price: 4799, ship: 0, stock: 'in_stock', warranty: 12, ret: 7, eta: 2, ageMin: 35 },
    { store: 'extra', channel: 'local', price: 4749, ship: 0, stock: 'limited', warranty: 12, ret: 7, eta: 2, ageMin: 80 },
    { store: 'amazon-sa', channel: 'online', price: 4699, ship: 0, stock: 'in_stock', warranty: 12, ret: 15, eta: 24, ageMin: 55 },
  ],
  iphone15: [
    { store: 'noon', channel: 'online', price: 2799, ship: 0, stock: 'in_stock', warranty: 12, ret: 15, eta: 48, ageMin: 70 },
    { store: 'jarir', channel: 'local', price: 2899, ship: 0, stock: 'in_stock', warranty: 12, ret: 7, eta: 2, ageMin: 40 },
  ],
  s25ultra: [
    { store: 'extra', channel: 'local', price: 4999, ship: 0, stock: 'in_stock', warranty: 24, ret: 7, eta: 2, ageMin: 60 },
    { store: 'noon', channel: 'online', price: 4849, ship: 0, stock: 'in_stock', warranty: 12, ret: 15, eta: 48, ageMin: 95 },
    { store: 'jarir', channel: 'local', price: 4949, ship: 0, stock: 'in_stock', warranty: 24, ret: 7, eta: 2, ageMin: 45 },
  ],
  redmi13: [
    { store: 'noon', channel: 'online', price: 749, ship: 0, stock: 'in_stock', warranty: 12, ret: 15, eta: 48, ageMin: 120 },
    { store: 'extra', channel: 'local', price: 799, ship: 0, stock: 'in_stock', warranty: 24, ret: 7, eta: 2, ageMin: 90 },
  ],
  airpodspro2: [
    { store: 'amazon-sa', channel: 'online', price: 849, ship: 0, stock: 'in_stock', warranty: 12, ret: 15, eta: 24, ageMin: 30 },
    { store: 'jarir', channel: 'local', price: 899, ship: 0, stock: 'in_stock', warranty: 12, ret: 7, eta: 2, ageMin: 50 },
    { store: 'noon', channel: 'online', price: 829, ship: 19, stock: 'in_stock', warranty: 12, ret: 15, eta: 48, ageMin: 110 },
  ],
  airpods4: [
    { store: 'jarir', channel: 'local', price: 549, ship: 0, stock: 'in_stock', warranty: 12, ret: 7, eta: 2, ageMin: 70 },
    { store: 'amazon-sa', channel: 'online', price: 529, ship: 0, stock: 'in_stock', warranty: 12, ret: 15, eta: 24, ageMin: 60 },
  ],
  jblflip6: [
    { store: 'amazon-sa', channel: 'online', price: 399, ship: 0, stock: 'in_stock', warranty: 12, ret: 15, eta: 24, ageMin: 90 },
    { store: 'extra', channel: 'local', price: 449, ship: 0, stock: 'in_stock', warranty: 12, ret: 7, eta: 2, ageMin: 100 },
  ],
  watch10: [
    { store: 'jarir', channel: 'local', price: 1949, ship: 0, stock: 'in_stock', warranty: 12, ret: 7, eta: 2, ageMin: 60 },
    { store: 'extra', channel: 'local', price: 1899, ship: 0, stock: 'in_stock', warranty: 12, ret: 7, eta: 2, ageMin: 75 },
  ],
  ipadair: [
    { store: 'jarir', channel: 'local', price: 2599, ship: 0, stock: 'in_stock', warranty: 12, ret: 7, eta: 2, ageMin: 50 },
    { store: 'amazon-sa', channel: 'online', price: 2549, ship: 0, stock: 'in_stock', warranty: 12, ret: 15, eta: 24, ageMin: 65 },
  ],
  tabs9fe: [
    { store: 'noon', channel: 'online', price: 1399, ship: 0, stock: 'in_stock', warranty: 12, ret: 15, eta: 48, ageMin: 85 },
    { store: 'extra', channel: 'local', price: 1449, ship: 0, stock: 'in_stock', warranty: 24, ret: 7, eta: 2, ageMin: 70 },
  ],
  ps5: [
    { store: 'extra', channel: 'local', price: 2099, ship: 0, stock: 'in_stock', warranty: 12, ret: 7, eta: 2, ageMin: 40 },
    { store: 'amazon-sa', channel: 'online', price: 1999, ship: 0, stock: 'limited', warranty: 12, ret: 15, eta: 24, ageMin: 60 },
    { store: 'jarir', channel: 'local', price: 2149, ship: 0, stock: 'in_stock', warranty: 12, ret: 7, eta: 2, ageMin: 35 },
  ],
  switcholed: [
    { store: 'noon', channel: 'online', price: 1299, ship: 0, stock: 'in_stock', warranty: 12, ret: 15, eta: 48, ageMin: 100 },
    { store: 'jarir', channel: 'local', price: 1349, ship: 0, stock: 'in_stock', warranty: 12, ret: 7, eta: 2, ageMin: 80 },
  ],
  tv55: [
    { store: 'extra', channel: 'local', price: 1799, ship: 0, stock: 'in_stock', warranty: 24, ret: 7, eta: 24, ageMin: 120 },
    { store: 'saco', channel: 'local', price: 1849, ship: 0, stock: 'in_stock', warranty: 24, ret: 7, eta: 24, ageMin: 140 },
  ],
  vertuo: [
    { store: 'amazon-sa', channel: 'online', price: 449, ship: 0, stock: 'in_stock', warranty: 24, ret: 15, eta: 24, ageMin: 90 },
    { store: 'saco', channel: 'local', price: 499, ship: 0, stock: 'in_stock', warranty: 24, ret: 7, eta: 2, ageMin: 110 },
  ],
  anker: [
    { store: 'amazon-sa', channel: 'online', price: 389, ship: 0, stock: 'in_stock', warranty: 18, ret: 15, eta: 24, ageMin: 75 },
    { store: 'noon', channel: 'online', price: 369, ship: 0, stock: 'in_stock', warranty: 12, ret: 15, eta: 48, ageMin: 130 },
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
  // Store directory (real retailers and the domains their links may point to) is seeded in every environment;
  // demo prices only when SEED_DEMO_DATA is on.
  // Idempotent: re-running the seed adds stores/products that are missing and never touches existing rows,
  // so an existing database picks up catalog additions with `npm run db:seed`.
  const storeIds: Record<string, string> = {};
  const sourceIds: Record<string, string> = {};
  let newStores = 0;
  for (const s of STORES) {
    let row = await db.query.stores.findFirst({ where: eq(stores.slug, s.slug) });
    if (!row) {
      [row] = await db.insert(stores).values({ ...s, allowedDomains: [...s.allowedDomains] }).returning();
      newStores++;
      if (opts.demo) for (const b of BRANCHES[s.slug] ?? []) await db.insert(branches).values({ ...b, storeId: row!.id, city: 'Riyadh' });
    }
    storeIds[s.slug] = row!.id;
  }
  if (newStores) log(`stores: ${newStores} added`);
  // SEED_DEMO_DATA decides whether demo prices are shown at all: turning it off hides them (and back on restores them).
  const toggled = await db.update(dataSources).set({ active: opts.demo }).where(and(eq(dataSources.type, 'demo'), eq(dataSources.active, !opts.demo))).returning({ id: dataSources.id });
  if (toggled.length) log(`demo prices ${opts.demo ? 'shown' : 'hidden'} (${toggled.length} sources)`);
  if (!opts.demo) return;
  const demoSource = async (slug: string) => {
    if (sourceIds[slug]) return sourceIds[slug]!;
    const existing = await db.query.dataSources.findFirst({ where: and(eq(dataSources.storeId, storeIds[slug]!), eq(dataSources.type, 'demo')) });
    const id = existing?.id ?? (await db.insert(dataSources).values({
      name: `${STORES.find((s) => s.slug === slug)!.name} — demo data`, type: 'demo', storeId: storeIds[slug]!, active: true,
      termsNote: 'Demo data for development only. Not real prices. Replace with an official API, partner catalog or affiliate feed before launch.',
    }).returning())[0]!.id;
    return (sourceIds[slug] = id);
  };

  const now = Date.now();
  const day = 86_400_000;
  let newProducts = 0;
  for (const p of PRODUCTS) {
    const g = p.gtin.padStart(14, '0');
    const known = await db.query.productGtins.findFirst({ where: eq(productGtins.gtin, g) });
    if (known) {
      // Older databases: fill in Arabic names added to the catalog later (never overwrites an edited name).
      if (p.nameAr) await db.update(products).set({ nameAr: p.nameAr }).where(and(eq(products.id, known.productId), isNull(products.nameAr)));
      continue;
    }
    newProducts++;
    const [row] = await db.insert(products).values({
      name: p.name, nameAr: p.nameAr ?? null, brand: p.brand, model: p.model, matchKey: matchKey(p.brand, p.model), category: p.category,
      attributes: p.attributes, specs: p.specs, specSourceLabel: p.specSource[0], specSourceUrl: p.specSource[1],
    }).returning();
    await db.insert(productGtins).values({ gtin: g, productId: row!.id });

    for (const o of OFFERS[p.key] ?? []) {
      const store = STORES.find((s) => s.slug === o.store)!;
      const [off] = await db.insert(offers).values({
        productId: row!.id, storeId: storeIds[o.store]!, sourceId: await demoSource(o.store), externalId: `${p.key}-${o.store}`,
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
  log(`demo catalog: ${newProducts} new products, ${newStores} new stores`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const db = createDb(url);
  await runMigrations(db);
  await seed(db, { demo: process.env.SEED_DEMO_DATA !== 'false', adminEmail: process.env.ADMIN_EMAIL, adminPassword: process.env.ADMIN_PASSWORD || undefined });
  await db.$client.end();
}
