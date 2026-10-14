import { CURRENCIES, effectivePriceMarket, formatMoney, recommend, type Candidate, type Lang, type PickLabel } from '@bestprice/core';
import type { CatalogService } from '../catalog';
import type { RespondInput } from './tools';

/**
 * Rule-based advisor used when the AI model is not configured or not
 * reachable. It follows the same contract as the AI advisor: facts come from
 * the database, opinions are labelled, and nothing is invented.
 */

export interface FlowState {
  flow?: 'laptop' | 'phone' | 'headphones' | 'gift';
  step?: string;
  useCase?: string;
  budgetMinor?: number | null;
  priorities?: string[];
  lastRecs?: string[];
}

export interface RuleResult {
  answer: RespondInput;
  state: FlowState;
  watch?: { productId: string; targetMinor: number };
}

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const norm = (s: string) => s.replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d))).toLowerCase();
const has = (s: string, re: RegExp) => re.test(norm(s));

const RE = {
  laptop: /لابتوب|لاب توب|لابتوبات|laptop|notebook|كمبيوتر|computer|macbook|ماك بوك/,
  phone: /جوال|جوالي|ايفون|آيفون|iphone|phone|هاتف|سامسونج|galaxy/,
  headphones: /سماع|قيمنق|gaming|headset|headphone|earbuds|ايربودز/,
  gift: /هدية|هديه|gift|قهوة|قهوه|coffee/,
  watch: /راقب|تابع|نبهني|نبّهني|watch|track|alert|notify/,
  price: /سعر|وقت|انتظر|أنتظر|ينزل|price|wait|deal|عرض|cheap|now/,
  compare: /قارن|الفرق|مقارنة|compare|vs|difference|versus/,
  store: /متجر|وين|أين|اشتري منه|أشتري منه|store|where|shop/,
  suitable: /مناسب|يناسب|ينفع|suitable|good for|worth|يستاهل/,
  battery: /بطاري|battery|خفيف|خفة|light|portable|وزن/,
  speed: /سرع|speed|fast|أداء|performance|قوي/,
  both: /الاثنين|كلاهما|both/,
};

const USE_CASES: { key: string; re: RegExp; ar: string; en: string }[] = [
  { key: 'office', re: /مستند|تصفح|اجتماع|office|docs|browsing|meeting|عمل مكتبي/, ar: 'مستندات وتصفح واجتماعات', en: 'Docs, browsing, meetings' },
  { key: 'study', re: /دراس|جامع|study|university|student|طالب/, ar: 'دراسة', en: 'Study' },
  { key: 'dev_design', re: /برمج|تصميم|coding|code|design|developer|program/, ar: 'برمجة أو تصميم', en: 'Coding or design' },
  { key: 'creator_gaming', re: /مونتاج|ألعاب|العاب|قيم|gaming|video|edit|game/, ar: 'مونتاج وألعاب', en: 'Video editing & gaming' },
];

export function parseBudget(text: string, unit: number): number | null | undefined {
  const t = norm(text).replace(/,/g, '');
  const k = /(\d+(?:\.\d+)?)\s*(k|ألف|الف|آلاف)/.exec(t);
  if (k) return Math.round(Number(k[1]) * 1000 * unit);
  const m = /(\d{2,7})/.exec(t);
  if (m) return Math.round(Number(m[1]) * unit);
  if (/مفتوح|بدون|ما عندي|no budget|any|open/.test(t)) return null;
  return undefined;
}

const ATTR_PRO: Record<string, [string, string]> = {
  ram_gb: ['ذاكرة كبيرة', 'Generous RAM'],
  storage_gb: ['تخزين واسع', 'Plenty of storage'],
  cpu_score: ['معالج قوي', 'Fast processor'],
  gpu_score: ['رسوميات قوية', 'Strong graphics'],
  battery_h: ['بطارية طويلة', 'Long battery life'],
  battery_mah: ['بطارية كبيرة', 'Large battery'],
  weight_kg: ['خفيف الوزن', 'Lightweight'],
  warranty_months: ['ضمان أطول', 'Longer warranty'],
  camera_score: ['كاميرا ممتازة', 'Excellent camera'],
  update_years: ['تحديثات لسنوات', 'Years of updates'],
  mic_score: ['مايك واضح', 'Clear mic'],
  sound_score: ['صوت ممتاز', 'Great sound'],
  anc: ['عزل ضوضاء', 'Noise cancelling'],
  wireless: ['لاسلكية', 'Wireless'],
  comfort_score: ['مريحة', 'Comfortable'],
};
const ATTR_CON: Record<string, [string, string]> = {
  over_budget: ['يتجاوز ميزانيتك', 'Over your budget'],
  ram_gb: ['ذاكرة محدودة', 'Limited RAM'],
  storage_gb: ['تخزين محدود', 'Limited storage'],
  cpu_score: ['أداء متوسط', 'Average performance'],
  battery_h: ['بطارية أقصر', 'Shorter battery'],
  weight_kg: ['أثقل وزنًا', 'Heavier'],
  mic_score: ['مايك عادي', 'Average mic'],
  camera_score: ['كاميرا عادية', 'Average camera'],
};

export class RuleAdvisor {
  constructor(private catalog: CatalogService) {}

  async turn(args: { message: string; lang: Lang; country: string; state: FlowState; productIds: string[]; isFirst: boolean }): Promise<RuleResult> {
    const { message, lang, country } = args;
    const t = (ar: string, en: string) => (lang === 'ar' ? ar : en);
    const market = effectivePriceMarket(country);
    const unit = 10 ** CURRENCIES[market.currency].minorDigits;
    const money = (m: number) => formatMoney(m, market.currency, lang);
    const st: FlowState = { ...args.state };
    const ans = (a: Partial<RespondInput>): RespondInput => ({ text: '', facts: [], opinion: '', sources: [], recommendations: [], chips: [], ...a });

    // ---------- product-specific conversation ----------
    if (args.productIds.length) {
      const [pid, otherId] = args.productIds as [string, string | undefined];
      const product = await this.catalog.product(pid, country);
      const offers = await this.catalog.rankedOffers(pid, 'value', country);
      const cheapest = [...offers.offers].sort((a, b) => a.finalMinor - b.finalMinor)[0];
      const best = offers.offers[0];
      const demoNote = offers.offers.some((o) => o.isDemo) ? t('الأسعار المعروضة بيانات تجريبية.', 'Prices shown are demo data.') : '';

      if (has(message, RE.watch) && cheapest) {
        const target = Math.round((cheapest.finalMinor * 0.95) / unit) * unit;
        return {
          state: st,
          watch: { productId: pid, targetMinor: target },
          answer: ans({
            text: t(`تم. أضفت ${product.name} لقائمة المتابعة، وبنبهك إذا وصل لأي متجر موثوق بسعر ${money(target)} أو أقل.`, `Done. I added ${product.name} to your watchlist and will alert you when a trusted store hits ${money(target)} or less.`),
            chips: [t('افتح قائمة المتابعة', 'Open watchlist')],
          }),
        };
      }
      if (has(message, RE.compare) || otherId) {
        let other = otherId ? await this.catalog.product(otherId, country).catch(() => null) : null;
        if (!other) {
          const q = message.replace(/قارن(ه|ها)?|مع|compare|with|it|بـ|ب/gi, ' ').trim();
          const found = q.length > 1 ? (await this.catalog.search(q, country, 5)).filter((p) => p.id !== pid) : [];
          other = found[0] ? await this.catalog.product(found[0].id, country) : null;
        }
        if (!other) {
          const alts = (await this.catalog.summaries(await this.catalog.productsInCategory(product.category, 6), country)).filter((p) => p.id !== pid).slice(0, 3);
          return { state: st, answer: ans({ text: t('مع أي منتج تبي تقارنه؟', 'Which product should I compare it with?'), chips: alts.map((a) => t(`قارنه مع ${a.name}`, `Compare with ${a.name}`)) }) };
        }
        const line = (p: typeof product) => `${p.name}: ${p.specs.slice(0, 3).map((s) => s.value).join(' / ')}${p.bestPriceMinor !== null ? ' — ' + t('من ', 'from ') + money(p.bestPriceMinor) : ''}`;
        const diff = product.bestPriceMinor !== null && other.bestPriceMinor !== null ? Math.abs(product.bestPriceMinor - other.bestPriceMinor) : null;
        const cheaper = diff !== null ? (product.bestPriceMinor! <= other.bestPriceMinor! ? product : other) : null;
        return {
          state: st,
          answer: ans({
            text: t(`أضفت ${other.name} للمقارنة:`, `Added ${other.name} to the comparison:`),
            facts: [line(product), line(other)],
            opinion: cheaper && diff ? t(`${cheaper.name} أرخص بفرق ${money(diff)}. اختيارك يعتمد على المواصفة الأهم لك.`, `${cheaper.name} is cheaper by ${money(diff)}. The right pick depends on which spec matters most to you.`) : '',
            sources: [product.specSource, other.specSource].filter(Boolean).map((s) => ({ label: s!.label, url: s!.url ?? undefined })),
            chips: [t('هل أشتري الآن أم أنتظر؟', 'Buy now or wait?'), t('وين أفضل متجر أشتري منه؟', 'Which store is best to buy from?')],
          }),
        };
      }
      if (has(message, RE.store) && best) {
        const facts = [`${best.store.nameAr && lang === 'ar' ? best.store.nameAr : best.store.name}: ${money(best.finalMinor)}${best.warrantyMonths ? t(`، ضمان ${best.warrantyMonths} شهر`, `, ${best.warrantyMonths}-month warranty`) : ''}`];
        if (cheapest && cheapest.id !== best.id) facts.push(`${lang === 'ar' ? cheapest.store.nameAr : cheapest.store.name}: ${money(cheapest.finalMinor)} ${t('(الأرخص)', '(cheapest)')}`);
        return {
          state: st,
          answer: ans({
            text: t(`لـ ${product.name}، أنصح بـ ${lang === 'ar' ? best.store.nameAr : best.store.name}:`, `For ${product.name}, I recommend ${best.store.name}:`),
            facts,
            opinion: cheapest && cheapest.id !== best.id
              ? t(`الفرق ${money(best.finalMinor - cheapest.finalMinor)} مقابل ضمان أطول أو استلام أسرع. ${demoNote}`, `The ${money(best.finalMinor - cheapest.finalMinor)} difference buys a longer warranty or faster pickup. ${demoNote}`)
              : demoNote,
            chips: [t('افتح صفحة المنتج', 'Open product page'), t('راقب السعر لي', 'Watch the price for me')],
          }),
        };
      }
      if (has(message, RE.price)) {
        const h = await this.catalog.history(pid, country);
        const facts: string[] = [];
        if (h.stats.currentMinor !== null) facts.push(t(`السعر الحالي ${money(h.stats.currentMinor)}، وأدنى سعر سجلناه ${money(h.stats.lowMinor!)}`, `Current price ${money(h.stats.currentMinor)}; lowest recorded ${money(h.stats.lowMinor!)}`));
        facts.push(t(`البيانات تغطي آخر ${h.stats.coverageDays} يومًا من ${h.sourceCount} مصادر`, `Data covers the last ${h.stats.coverageDays} days from ${h.sourceCount} sources`));
        const op: Record<string, [string, string]> = {
          buy_now: ['السعر قريب جدًا من أدنى مستوى. احتمال نزول كبير قريبًا ضعيف، لكنه ليس مضمونًا. إذا تحتاجه الآن، اشترِ.', 'The price is very close to its recorded low. A big drop soon is unlikely, but not guaranteed. If you need it now, buy.'],
          fair: ['السعر في المنتصف مقارنة بالفترة المسجلة. إذا مو مستعجل، أراقبه لك.', 'The price is mid-range for the recorded period. If you can wait, I can watch it for you.'],
          consider_waiting: ['السعر أعلى من معظم الفترة المسجلة. فيه احتمال جيد ينزل، لكنه ليس مضمونًا.', 'The price is higher than most of the recorded period. A drop is fairly likely, but not guaranteed.'],
          insufficient_data: ['ما عندي بيانات كافية أحكم إذا السعر ممتاز. أقدر أراقبه لك.', 'I don’t have enough history to judge this price yet. I can watch it for you.'],
        };
        const o = op[h.advice]!;
        return { state: st, answer: ans({ text: t('حسب البيانات المتوفرة عندي:', 'Based on the data I have:'), facts, opinion: `${t(o[0], o[1])} ${demoNote}`.trim(), chips: [t('راقب السعر لي', 'Watch the price for me'), t('وين أفضل متجر أشتري منه؟', 'Which store is best to buy from?')] }) };
      }
      // default: specs-based suitability
      const facts = product.specs.slice(0, 4).map((s) => `${lang === 'ar' ? s.labelAr : s.label}: ${s.value}`);
      if (best) facts.push(t(`أفضل قيمة الآن: ${best.store.nameAr} ${money(best.finalMinor)}`, `Best value now: ${best.store.name} ${money(best.finalMinor)}`));
      return {
        state: st,
        answer: ans({
          text: args.isFirst
            ? t(`نتكلم الحين عن ${product.name}. عندي مواصفاته وأسعاره من ${offers.coverage.storeCount} متاجر. وش تبي تعرف؟`, `We’re talking about ${product.name}. I have its specs and prices from ${offers.coverage.storeCount} stores. What would you like to know?`)
            : t(`هذا اللي أعرفه عن ${product.name}:`, `Here’s what I know about ${product.name}:`),
          facts: args.isFirst ? [] : facts,
          sources: product.specSource ? [{ label: product.specSource.label, url: product.specSource.url ?? undefined }] : [],
          chips: [t('هل سعره الحالي ممتاز؟', 'Is the current price a good deal?'), t('وين أفضل متجر أشتري منه؟', 'Which store is best to buy from?'), t('قارنه مع منتج ثاني', 'Compare with another product')],
        }),
      };
    }

    // ---------- open conversation flows ----------
    const flow = st.flow ?? (has(message, RE.laptop) ? 'laptop' : has(message, RE.phone) ? 'phone' : has(message, RE.headphones) ? 'headphones' : has(message, RE.gift) ? 'gift' : undefined);

    // Follow-ups after recommendations
    if (st.lastRecs?.length && !st.step) {
      const recs = await this.catalog.summaryById(st.lastRecs, country);
      if (has(message, RE.watch) && recs[0]?.bestPriceMinor) {
        const target = Math.round((recs[0].bestPriceMinor * 0.95) / unit) * unit;
        return { state: st, watch: { productId: recs[0].id, targetMinor: target }, answer: ans({ text: t(`تم. أضفت ${recs[0].name} لقائمة المتابعة، وبنبهك إذا وصل لأي متجر موثوق بسعر ${money(target)} أو أقل.`, `Done. I added ${recs[0].name} to your watchlist and will alert you when a trusted store hits ${money(target)} or less.`), chips: [t('افتح قائمة المتابعة', 'Open watchlist')] }) };
      }
      if (has(message, RE.price) && recs[0]) return this.turn({ ...args, productIds: [recs[0].id], state: st, isFirst: false });
      if (has(message, RE.store) && recs[0]) return this.turn({ ...args, productIds: [recs[0].id], state: st, isFirst: false });
      if (has(message, RE.compare) && recs[0] && recs[1]) return this.turn({ ...args, productIds: [recs[0].id, recs[1].id], state: st, isFirst: false, message: 'compare' });
    }

    if (flow === 'laptop' || flow === 'headphones') {
      st.flow = flow;
      if (flow === 'laptop' && !st.useCase) {
        const uc = USE_CASES.find((u) => has(message, u.re));
        if (uc) st.useCase = uc.key;
        else if (st.step === 'use') st.useCase = 'office';
        else {
          st.step = 'use';
          return { state: st, answer: ans({ text: t('أكيد. عشان أرشّح لك صح، وش طبيعة شغلك على الجهاز؟', 'Sure. To recommend well, what kind of work will you do on it?'), chips: USE_CASES.filter((u) => u.key !== 'study').map((u) => t(u.ar, u.en)).concat(t('دراسة', 'Study')).slice(0, 4) }) };
        }
      }
      if (flow === 'headphones' && !st.priorities) {
        if (st.step === 'hp_use') {
          st.priorities = has(message, /سلك|wired/) ? ['sound'] : ['wireless', 'mic'];
        } else {
          st.step = 'hp_use';
          return { state: st, answer: ans({ text: t('تفضّل سلكية أو لاسلكية؟ وهل المايك مهم لك (تتكلم مع فريقك)؟', 'Wired or wireless? And does the mic matter (team chat)?'), chips: [t('لاسلكية والمايك مهم', 'Wireless, mic matters'), t('سلكية، الصوت أهم', 'Wired, sound first')] }) };
        }
      }
      if (st.budgetMinor === undefined) {
        const b = parseBudget(message, unit);
        if (b !== undefined && st.step === 'budget') st.budgetMinor = b;
        else if (b !== undefined && b !== null && b > 100 * unit) st.budgetMinor = b;
        else {
          st.step = 'budget';
          const chips = flow === 'laptop' ? [t('أقل من 2,500', 'Under 2,500'), t('حوالي 3,000', 'Around 3,000'), t('4,000 وأكثر', '4,000+')] : [t('أقل من 300', 'Under 300'), t('حوالي 600', 'Around 600'), t('ميزانية مفتوحة', 'Open budget')];
          return { state: st, answer: ans({ text: t('تمام. وكم ميزانيتك تقريبًا؟', 'Got it. What’s your rough budget?'), chips }) };
        }
      }
      if (flow === 'laptop' && !st.priorities) {
        if (st.step === 'priority') {
          st.priorities = has(message, RE.both) ? ['battery', 'portability', 'speed'] : has(message, RE.battery) ? ['battery', 'portability'] : has(message, RE.speed) ? ['speed'] : ['battery', 'speed'];
        } else {
          st.step = 'priority';
          return { state: st, answer: ans({ text: t('آخر سؤال: وش أهم شيء لك؟', 'Last question: what matters most?'), chips: [t('البطارية والخفة', 'Battery & weight'), t('السرعة', 'Speed'), t('الاثنين', 'Both')] }) };
        }
      }
      st.step = undefined;
      return this.recommendFor(flow, st, lang, country);
    }

    if (flow === 'phone') {
      st.flow = 'phone';
      if (!st.step) {
        st.step = 'ph_model';
        return { state: st, answer: ans({ text: t('خلنا نشوف إذا التغيير يستاهل فعلًا. وش جوالك الحالي؟', 'Let’s see if upgrading is really worth it. What phone do you have now?'), chips: ['iPhone 12', 'iPhone 13', 'Galaxy S22'] }) };
      }
      if (st.step === 'ph_model') {
        st.step = 'ph_issue';
        return { state: st, answer: ans({ text: t('وش اللي مضايقك فيه؟', 'What bothers you about it?'), chips: [t('البطارية تخلص بسرعة', 'Battery drains fast'), t('الكاميرا', 'The camera'), t('بطيء', 'It’s slow')] }) };
      }
      const batteryOnly = has(message, RE.battery);
      st.step = undefined;
      st.priorities = batteryOnly ? ['battery'] : has(message, /كامير|camera/) ? ['camera'] : ['speed'];
      const r = await this.recommendFor('phone', st, lang, country);
      if (batteryOnly) {
        r.answer.text = t('بناءً على كلامك:', 'Based on what you said:');
        r.answer.opinion = t('إذا المشكلة البطارية بس، غالبًا تغيير البطارية في مركز معتمد أوفر بكثير من جوال جديد، وتقدر تحتفظ بجوالك سنة إضافية. وإذا قررت تغيّر، هذي أنسب الخيارات المتوفرة:', 'If it’s only the battery, a replacement at an authorized center usually costs far less than a new phone and buys you another year. If you still want to upgrade, these are the best available options:');
      }
      return r;
    }

    if (flow === 'gift') {
      st.flow = 'gift';
      const b = parseBudget(message, unit);
      if (b === undefined && st.step !== 'gift_budget') {
        st.step = 'gift_budget';
        return { state: st, answer: ans({ text: t('فكرة حلوة. كم ميزانيتك تقريبًا للهدية؟', 'Nice idea. What’s your rough budget for the gift?'), chips: [t('أقل من 200', 'Under 200'), '200–500', t('أكثر من 500', 'Over 500')] }) };
      }
      st.step = undefined;
      const rows = await this.catalog.productsInCategory('coffee', 30);
      let items = await this.catalog.summaries(rows, country);
      const cap = b ?? null;
      if (cap) items = items.filter((p) => p.bestPriceMinor !== null && p.bestPriceMinor <= cap * (has(message, /أكثر|over|\+/) ? 10 : 1));
      items = items.filter((p) => p.bestPriceMinor !== null).slice(0, 3);
      st.lastRecs = items.map((i) => i.id);
      if (!items.length) return { state: st, answer: ans({ text: t('ما لقيت منتجات قهوة متوفرة ضمن هذي الميزانية في الكتالوج حاليًا.', 'I couldn’t find coffee products within that budget in the catalog right now.') }) };
      return {
        state: st,
        answer: ans({
          text: t('هذي أفكار متوفرة الآن ضمن الميزانية:', 'Here are ideas available now within budget:'),
          facts: items.map((i) => `${i.name} — ${t('من', 'from')} ${money(i.bestPriceMinor!)}`),
          opinion: t('إذا الشخص يحضّر قهوة مختصة في البيت، المطحنة اليدوية أكثر هدية بيستخدمها يوميًا.', 'If they brew specialty coffee at home, a hand grinder is the gift they’ll use daily.'),
        }),
      };
    }

    // ---------- free text: search the catalog ----------
    const q = message.trim();
    const found = q.length >= 2 ? await this.catalog.search(q, country, 3) : [];
    if (found.length && !args.isFirst) {
      st.lastRecs = found.map((f) => f.id);
      return {
        state: st,
        answer: ans({
          text: t('هذا اللي لقيته في الكتالوج:', 'Here’s what I found in the catalog:'),
          facts: found.map((f) => `${f.name}${f.bestPriceMinor !== null ? ' — ' + t('من', 'from') + ' ' + money(f.bestPriceMinor) : ' — ' + t('لا تتوفر أسعار حاليًا', 'no prices available yet')}`),
          chips: [t('هل أشتري الآن أم أنتظر؟', 'Buy now or wait?'), t('وين أفضل متجر أشتري منه؟', 'Which store is best to buy from?')],
        }),
      };
    }
    return {
      state: {},
      answer: ans({
        text: t('هلا! أنا مستشار الشراء في Best Price. قل لي وش ناوي تشتري أو وش محتار فيه، وأساعدك توصل لقرار مبني على أسعار فعلية.', 'Hi! I’m the Best Price shopping advisor. Tell me what you’re planning to buy or what you’re unsure about, and I’ll help you decide using real prices.'),
        chips: [t('أبي لابتوب للعمل، بس ما أعرف وش أختار', 'I need a work laptop but don’t know what to pick'), t('أفكر أغير جوالي، يستاهل؟', 'Thinking of upgrading my phone, worth it?'), t('هدية لشخص يحب القهوة', 'A gift for a coffee lover'), t('أفضل سماعة للقيمنق', 'Best gaming headset')],
      }),
    };
  }

  private async recommendFor(category: string, st: FlowState, lang: Lang, country: string): Promise<RuleResult> {
    const t = (ar: string, en: string) => (lang === 'ar' ? ar : en);
    const market = effectivePriceMarket(country);
    const rows = await this.catalog.productsInCategory(category, 80);
    const best = await this.catalog.bestPrices(rows.map((r) => r.id), market.code);
    const candidates: Candidate[] = rows.map((r) => ({ productId: r.id, name: r.name, category: r.category, priceMinor: best.get(r.id)?.minor ?? null, attributes: r.attributes }));
    const picks = recommend(candidates, { category, budgetMinor: st.budgetMinor ?? null, useCase: st.useCase, priorities: st.priorities });
    st.lastRecs = picks.map((p) => p.candidate.productId);
    st.flow = undefined;
    const why: Record<PickLabel, [string, string]> = {
      best_value: ['أقوى توازن بين المواصفات والسعر ضمن ميزانيتك.', 'Best balance of specs and price within your budget.'],
      cheapest_fit: ['أرخص خيار يغطي استخدامك.', 'The cheapest option that covers your use.'],
      stretch: ['أفضل في أولوياتك، لكنه يتجاوز ميزانيتك.', 'Stronger on your priorities, but over your budget.'],
      best_specs: ['أعلى مواصفات بين الخيارات المتوفرة.', 'Highest specs among available options.'],
    };
    if (!picks.length) {
      return { state: st, answer: { text: t('ما لقيت خيارات متوفرة بأسعار موثوقة ضمن هذي المعايير حاليًا. جرّب ميزانية مختلفة.', 'I couldn’t find options with reliable prices for these criteria right now. Try a different budget.'), facts: [], opinion: '', sources: [], recommendations: [], chips: [] } };
    }
    const compared = candidates.filter((c) => c.priceMinor !== null).length;
    return {
      state: st,
      answer: {
        text: t(`قارنت ${compared} منتجًا متوفرًا الآن. هذي أنسب ${picks.length} لاستخدامك:`, `I compared ${compared} products available now. These ${picks.length} fit you best:`),
        facts: [],
        opinion: '',
        sources: [{ label: t('المواصفات من مصادر الشركات المصنّعة · الأسعار من المتاجر المتاحة', 'Specs from manufacturer sources · prices from available stores') }],
        recommendations: picks.map((p) => ({
          product_id: p.candidate.productId,
          label: p.label,
          pro: p.pros[0] ? t(...(ATTR_PRO[p.pros[0]] ?? ['مواصفات قوية', 'Strong specs'])) : '',
          con: p.cons[0] ? t(...(ATTR_CON[p.cons[0]] ?? ['أضعف في بعض المواصفات', 'Weaker on some specs'])) : '',
          why: t(...why[p.label]),
        })),
        chips: [t('ما الفرق بين الأول والثاني؟', 'What’s the difference between #1 and #2?'), t('هل أشتري الآن أم أنتظر؟', 'Buy now or wait?'), t('راقب السعر لي', 'Watch the price for me')],
      },
    };
  }
}
