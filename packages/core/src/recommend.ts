/**
 * Recommendation engine. Ranks candidate products for a stated need and
 * budget, and labels picks (best value, cheapest that fits, worth stretching)
 * with structured pros/cons so the advisor can explain each choice.
 *
 * Inputs are real catalog rows with real current prices; the engine never
 * invents attributes. Missing attributes are reported as unknown.
 */

export type AttrValue = number | string | boolean;

export interface Candidate {
  productId: string;
  name: string;
  category: string;
  /** Lowest current trusted final price in minor units, or null when we have no price. */
  priceMinor: number | null;
  attributes: Record<string, AttrValue>;
  rating?: { value: number; count: number } | null;
}

export interface Need {
  category: string;
  budgetMinor?: number | null;
  /** Category-specific use cases, e.g. laptop: 'study' | 'office' | 'dev_design' | 'creator_gaming'. */
  useCase?: string | null;
  /** Things the user said matter most, e.g. 'battery', 'speed', 'portability', 'camera', 'mic'. */
  priorities?: string[];
}

export type PickLabel = 'best_value' | 'cheapest_fit' | 'stretch' | 'best_specs';

export interface Pick {
  label: PickLabel;
  candidate: Candidate;
  fit: number; // 0..1 how well it fits the need
  overBudgetMinor: number; // 0 when within budget
  pros: string[]; // attribute keys that are strengths
  cons: string[]; // attribute keys that are weaknesses, or 'over_budget'
}

interface AttrRule {
  key: string;
  /** maps a raw attribute to 0..1 */
  norm: (v: AttrValue) => number;
  tags: string[]; // priorities this attribute serves
}

const num = (v: AttrValue) => (typeof v === 'number' ? v : Number.parseFloat(String(v)) || 0);
const clamp = (x: number) => Math.max(0, Math.min(1, x));

const PROFILES: Record<string, { rules: AttrRule[]; useCaseNeeds: Record<string, Record<string, number>> }> = {
  laptop: {
    rules: [
      { key: 'ram_gb', norm: (v) => clamp((num(v) - 4) / 28), tags: ['speed', 'multitask'] },
      { key: 'storage_gb', norm: (v) => clamp((num(v) - 128) / 896), tags: ['storage'] },
      { key: 'cpu_score', norm: (v) => clamp(num(v) / 100), tags: ['speed'] },
      { key: 'gpu_score', norm: (v) => clamp(num(v) / 100), tags: ['gaming', 'creator'] },
      { key: 'battery_h', norm: (v) => clamp((num(v) - 4) / 16), tags: ['battery'] },
      { key: 'weight_kg', norm: (v) => clamp((2.6 - num(v)) / 1.5), tags: ['portability'] },
      { key: 'warranty_months', norm: (v) => clamp(num(v) / 36), tags: ['warranty'] },
    ],
    useCaseNeeds: {
      study: { ram_gb: 8, battery_h: 6 },
      office: { ram_gb: 8 },
      dev_design: { ram_gb: 16, cpu_score: 60 },
      creator_gaming: { ram_gb: 16, gpu_score: 50 },
    },
  },
  phone: {
    rules: [
      { key: 'cpu_score', norm: (v) => clamp(num(v) / 100), tags: ['speed'] },
      { key: 'camera_score', norm: (v) => clamp(num(v) / 100), tags: ['camera'] },
      { key: 'battery_mah', norm: (v) => clamp((num(v) - 2500) / 3500), tags: ['battery'] },
      { key: 'storage_gb', norm: (v) => clamp((num(v) - 64) / 448), tags: ['storage'] },
      { key: 'update_years', norm: (v) => clamp(num(v) / 7), tags: ['longevity'] },
    ],
    useCaseNeeds: {},
  },
  headphones: {
    rules: [
      { key: 'mic_score', norm: (v) => clamp(num(v) / 100), tags: ['mic'] },
      { key: 'sound_score', norm: (v) => clamp(num(v) / 100), tags: ['sound'] },
      { key: 'anc', norm: (v) => (v === true ? 1 : 0), tags: ['isolation'] },
      { key: 'wireless', norm: (v) => (v === true ? 1 : 0), tags: ['wireless'] },
      { key: 'comfort_score', norm: (v) => clamp(num(v) / 100), tags: ['comfort'] },
      { key: 'battery_h', norm: (v) => clamp(num(v) / 60), tags: ['battery'] },
    ],
    useCaseNeeds: {},
  },
};

function attributeScores(c: Candidate, need: Need) {
  const profile = PROFILES[need.category];
  const prio = new Set(need.priorities ?? []);
  if (!profile) {
    const r = c.rating ? clamp((c.rating.value - 3) / 2) : 0.5;
    return { fit: r, pros: [] as string[], cons: [] as string[], meetsMinimums: true };
  }
  let total = 0;
  let weightSum = 0;
  const pros: string[] = [];
  const cons: string[] = [];
  for (const rule of profile.rules) {
    const raw = c.attributes[rule.key];
    if (raw === undefined) continue;
    const s = rule.norm(raw);
    const w = rule.tags.some((t) => prio.has(t)) ? 3 : 1;
    total += s * w;
    weightSum += w;
    if (s >= 0.7) pros.push(rule.key);
    else if (s <= 0.25 && w > 1) cons.push(rule.key);
  }
  let meetsMinimums = true;
  const mins = need.useCase ? profile.useCaseNeeds[need.useCase] ?? {} : {};
  for (const [key, min] of Object.entries(mins)) {
    const raw = c.attributes[key];
    if (raw !== undefined && num(raw) < min) {
      meetsMinimums = false;
      if (!cons.includes(key)) cons.push(key);
    }
  }
  return { fit: weightSum ? total / weightSum : 0.5, pros, cons, meetsMinimums };
}

export function recommend(candidates: Candidate[], need: Need, opts: { stretchRatio?: number } = {}): Pick[] {
  const stretchRatio = opts.stretchRatio ?? 0.2;
  const budget = need.budgetMinor ?? null;
  const priced = candidates.filter((c) => c.category === need.category && c.priceMinor !== null);
  const rows = priced.map((c) => {
    const a = attributeScores(c, need);
    const price = c.priceMinor as number;
    const over = budget !== null ? Math.max(0, price - budget) : 0;
    return { c, ...a, price, over };
  });
  const within = rows.filter((r) => r.over === 0 && r.meetsMinimums);
  const picks: Pick[] = [];
  const used = new Set<string>();
  const add = (label: PickLabel, r: (typeof rows)[number] | undefined) => {
    if (!r || used.has(r.c.productId)) return;
    used.add(r.c.productId);
    picks.push({ label, candidate: r.c, fit: r.fit, overBudgetMinor: r.over, pros: r.pros, cons: r.over ? [...r.cons, 'over_budget'] : r.cons });
  };

  // Best value: highest fit per unit of price, but only among reasonably strong fits.
  const strong = within.filter((r) => r.fit >= 0.45);
  const bestValue = [...(strong.length ? strong : within)].sort((a, b) => b.fit - a.fit || a.price - b.price)[0];
  add('best_value', bestValue);
  // Cheapest that still meets the use-case minimums.
  add('cheapest_fit', [...within].sort((a, b) => a.price - b.price)[0]);
  // A stretch pick: clearly better fit, slightly over budget.
  if (budget !== null) {
    const best = bestValue?.fit ?? 0;
    const stretch = rows
      .filter((r) => r.over > 0 && r.over <= budget * stretchRatio && r.fit > best)
      .sort((a, b) => b.fit - a.fit)[0];
    add('stretch', stretch);
  } else {
    add('best_specs', [...rows].sort((a, b) => b.fit - a.fit)[0]);
  }
  return picks;
}
