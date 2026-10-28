/**
 * Shopping categories: what the app's category grid shows, what each one
 * suggests, and where the web search looks first for it. The store domains
 * are hints for the search, not a limit: any seller that ships to the
 * shopper can still appear.
 */
export interface ShopCategory {
  id: string;
  emoji: string;
  ar: string;
  en: string;
  /** Example searches shown as chips when the category is opened. */
  ideasAr: string[];
  ideasEn: string[];
  /** Search these first (domains). */
  sources: string[];
  /** Catalog categories that belong here. */
  catalog: string[];
}

export const SHOP_CATEGORIES: ShopCategory[] = [
  { id: 'trending', emoji: '🔥', ar: 'ترندات تيك توك', en: 'TikTok finds', catalog: ['other', 'home', 'gaming'],
    ideasAr: ['ميني بروجكتر', 'منظم سيارة', 'مكواة شعر لاسلكية', 'خلاط محمول', 'إضاءة غرفة RGB', 'مرطب جو'],
    ideasEn: ['mini projector', 'car organizer', 'cordless hair straightener', 'portable blender', 'RGB room lights', 'humidifier'],
    sources: ['noon.com', 'amazon.sa', 'aliexpress.com', 'temu.com', 'shein.com'] },
  { id: 'phones', emoji: '📱', ar: 'جوالات وسماعات', en: 'Phones & audio', catalog: ['phone', 'headphones', 'watch', 'tablet'],
    ideasAr: ['آيفون 17 برو', 'جالكسي S25 الترا', 'ايربودز برو', 'ساعة أبل', 'شاحن سريع', 'باور بانك'],
    ideasEn: ['iPhone 17 Pro', 'Galaxy S25 Ultra', 'AirPods Pro', 'Apple Watch', 'fast charger', 'power bank'],
    sources: ['jarir.com', 'extra.com', 'noon.com', 'amazon.sa', 'apple.com', 'samsung.com', 'stc.com.sa'] },
  { id: 'computers', emoji: '💻', ar: 'كمبيوتر ولابتوب', en: 'Computers', catalog: ['laptop', 'tablet', 'tv'],
    ideasAr: ['ماك بوك اير M4', 'لابتوب قيمنق', 'شاشة 27 بوصة', 'آيباد', 'كيبورد ميكانيكي', 'ماوس لاسلكي'],
    ideasEn: ['MacBook Air M4', 'gaming laptop', '27-inch monitor', 'iPad', 'mechanical keyboard', 'wireless mouse'],
    sources: ['jarir.com', 'extra.com', 'noon.com', 'amazon.sa', 'apple.com'] },
  { id: 'gaming', emoji: '🎮', ar: 'قيمنق', en: 'Gaming', catalog: ['gaming'],
    ideasAr: ['بلايستيشن 5', 'نينتندو سويتش 2', 'ستريم ديك', 'سماعة قيمنق', 'يد تحكم', 'كرسي قيمنق'],
    ideasEn: ['PlayStation 5', 'Nintendo Switch 2', 'Stream Deck', 'gaming headset', 'controller', 'gaming chair'],
    sources: ['noon.com', 'amazon.sa', 'jarir.com', 'extra.com', 'virginmegastore.sa', 'geekay.com', 'aliexpress.com'] },
  { id: 'beauty', emoji: '💄', ar: 'مكياج وعناية', en: 'Makeup & skincare', catalog: ['beauty'],
    ideasAr: ['روج مات', 'سيروم فيتامين سي', 'واقي شمس', 'كريم مرطب', 'ماسكرا', 'كونسيلر'],
    ideasEn: ['matte lipstick', 'vitamin C serum', 'sunscreen', 'moisturizer', 'mascara', 'concealer'],
    sources: ['sephora.sa', 'niceonesa.com', 'nahdionline.com', 'noon.com', 'amazon.sa', 'shein.com'] },
  { id: 'hair', emoji: '💇‍♀️', ar: 'الشعر والأجهزة', en: 'Hair & styling', catalog: ['beauty', 'home'],
    ideasAr: ['استشوار دايسون', 'مكواة شعر', 'سيشوار', 'زيت شعر', 'فرشاة حرارية', 'ماكينة حلاقة'],
    ideasEn: ['Dyson hair dryer', 'hair straightener', 'curling iron', 'hair oil', 'hot brush', 'shaver'],
    sources: ['noon.com', 'amazon.sa', 'niceonesa.com', 'sephora.sa', 'extra.com', 'dyson.sa'] },
  { id: 'perfume', emoji: '🌸', ar: 'عطور', en: 'Perfume', catalog: ['beauty'],
    ideasAr: ['عطر رجالي', 'عطر نسائي', 'دهن عود', 'معطر جسم', 'عطر عربي', 'بخور'],
    ideasEn: ["men's perfume", "women's perfume", 'oud oil', 'body mist', 'Arabic perfume', 'bakhoor'],
    sources: ['goldenscent.com', 'niceonesa.com', 'sephora.sa', 'noon.com', 'amazon.sa'] },
  { id: 'fashion', emoji: '👜', ar: 'أزياء وشنط', en: 'Fashion & bags', catalog: ['fashion'],
    ideasAr: ['شنطة يد', 'جزمة رياضية', 'ساعة رجالي', 'نظارة شمس', 'عباية', 'محفظة'],
    ideasEn: ['handbag', 'sneakers', "men's watch", 'sunglasses', 'abaya', 'wallet'],
    sources: ['namshi.com', 'shein.com', 'noon.com', 'amazon.sa', 'aliexpress.com', 'temu.com'] },
  { id: 'home', emoji: '🏠', ar: 'البيت والمطبخ', en: 'Home & kitchen', catalog: ['home', 'coffee', 'tv'],
    ideasAr: ['قلاية هوائية', 'مكينة قهوة', 'مكنسة روبوت', 'خلاط', 'مكيف متنقل', 'طقم قدور'],
    ideasEn: ['air fryer', 'coffee machine', 'robot vacuum', 'blender', 'portable AC', 'cookware set'],
    sources: ['noon.com', 'amazon.sa', 'extra.com', 'saco.sa', 'ikea.com', 'carrefourksa.com'] },
  { id: 'tools', emoji: '🛠', ar: 'عدد وأدوات العمل', en: 'Tools & work gear', catalog: ['other'],
    ideasAr: ['دريل بوش', 'جهاز قياس ليزر', 'ملتيميتر', 'طقم مفكات', 'سلم ألمنيوم', 'خوذة سلامة'],
    ideasEn: ['Bosch drill', 'laser distance meter', 'multimeter', 'screwdriver set', 'aluminium ladder', 'safety helmet'],
    sources: ['saco.sa', 'amazon.sa', 'noon.com', 'aliexpress.com'] },
  { id: 'grocery', emoji: '🥤', ar: 'أكل ومشروبات', en: 'Food & drinks', catalog: ['grocery', 'coffee'],
    ideasAr: ['مشروب طاقة', 'قهوة مختصة', 'ماء صحة كرتون', 'شوكولاتة', 'حليب', 'بروتين'],
    ideasEn: ['energy drink', 'specialty coffee', 'water case', 'chocolate', 'milk', 'protein powder'],
    sources: ['nana.sa', 'noon.com', 'amazon.sa', 'carrefourksa.com', 'tamimimarkets.com', 'luluhypermarket.com'] },
  { id: 'cars', emoji: '🚗', ar: 'سيارات وقطع', en: 'Cars & parts', catalog: ['car'],
    ideasAr: ['كامري 2025', 'كفرات', 'كاميرا داش', 'شاحن سيارة', 'زيت محرك', 'غطاء سيارة'],
    ideasEn: ['Camry 2025', 'tyres', 'dash cam', 'car charger', 'engine oil', 'car cover'],
    sources: ['syarah.com', 'motory.com', 'haraj.com.sa', 'amazon.sa', 'noon.com'] },
];

export const shopCategory = (id: string | null | undefined): ShopCategory | null => SHOP_CATEGORIES.find((c) => c.id === id) ?? null;
