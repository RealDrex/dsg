import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { CURRENCIES, effectivePriceMarket, minorDigitsOf, recommend, type Candidate, type ProductSummaryDTO, type SortMode } from '@bestprice/core';
import { and, eq } from 'drizzle-orm';
import type { DB } from '../../db/client';
import { preferences, products, watches } from '../../db/schema';
import type { CatalogService } from '../catalog';

/**
 * Tools the advisor can call. Every price, store, availability and link the
 * advisor mentions must come from these tools (i.e. from our database),
 * never from the model's own knowledge.
 */

export const TOOL_DEFS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'search_products',
    description: 'Search the Best Price catalog by name, brand, model or category. Returns products with their current lowest trusted price in the user\'s market. Use this before recommending or comparing any product.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search text, e.g. "laptop", "iPhone 16", "coffee grinder"' },
        category: { type: 'string', enum: ['laptop', 'phone', 'headphones', 'tablet', 'watch', 'tv', 'camera', 'gaming', 'coffee', 'home', 'beauty', 'fashion', 'car', 'grocery', 'any'], description: 'Optional category filter' },
        max_price: { type: 'number', description: 'Optional maximum price in major currency units (e.g. 3000 for 3,000 SAR)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'find_product_online',
    description: 'Look a product up on the web when search_products finds nothing for it. Adds it to the catalog with its specs and any store prices found in web search (marked as unverified web prices with their store link). Slow (up to a minute) and rate-limited: use only after search_products came back empty for a specific product.',
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Specific product name, e.g. "Dyson V15 Detect"' } }, required: ['query'] },
  },
  {
    name: 'get_product',
    description: 'Get full specifications for one product, including where the specs come from.',
    input_schema: { type: 'object', properties: { product_id: { type: 'string' } }, required: ['product_id'] },
  },
  {
    name: 'get_offers',
    description: 'Get current store offers for a product, ranked. Includes final price after shipping, stock, warranty, delivery time, how fresh each price is and its reliability. Prices may change before purchase.',
    input_schema: {
      type: 'object',
      properties: {
        product_id: { type: 'string' },
        sort: { type: 'string', enum: ['value', 'cheapest', 'nearest', 'fastest'] },
      },
      required: ['product_id'],
    },
  },
  {
    name: 'get_price_history',
    description: 'Get the recorded price history for a product (only the period we actually have data for) and a heuristic buy-now-or-wait estimate. The estimate is a probability, never a guarantee.',
    input_schema: { type: 'object', properties: { product_id: { type: 'string' } }, required: ['product_id'] },
  },
  {
    name: 'recommend_products',
    description: 'Rank catalog products in a category for a need and budget. Returns labelled picks (best_value, cheapest_fit, stretch) with strengths and weaknesses derived from real specs and prices.',
    input_schema: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: ['laptop', 'phone', 'headphones', 'tablet', 'coffee', 'home'] },
        budget: { type: 'number', description: 'Budget in major currency units; omit if unknown' },
        use_case: { type: 'string', description: 'laptop: study | office | dev_design | creator_gaming' },
        priorities: { type: 'array', items: { type: 'string' }, description: 'e.g. battery, speed, portability, camera, mic, sound, isolation, wireless, comfort' },
      },
      required: ['category'],
    },
  },
  {
    name: 'add_to_watchlist',
    description: 'Add a product to the user\'s watchlist with a target price. Only call this when the user explicitly asks you to watch/track a price.',
    input_schema: {
      type: 'object',
      properties: { product_id: { type: 'string' }, target_price: { type: 'number', description: 'Target in major currency units' } },
      required: ['product_id', 'target_price'],
    },
  },
  {
    name: 'save_preference',
    description: 'Remember a lasting shopping preference the user stated (e.g. "prefers in-store pickup", "laptop budget around 3,000 SAR"). Only when memory is enabled and the user clearly stated it. Never store sensitive personal data.',
    input_schema: { type: 'object', properties: { text: { type: 'string', maxLength: 200 } }, required: ['text'] },
  },
  {
    name: 'respond',
    description: 'Send your final answer to the user. Always finish every turn by calling this exactly once.',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Main conversational reply, short and natural, in the user\'s language.' },
        facts: { type: 'array', items: { type: 'string' }, description: 'Verified facts taken from tool results only (specs, prices, dates). Empty if none.' },
        opinion: { type: 'string', description: 'Your recommendation / opinion, clearly separate from facts. Empty string if none.' },
        sources: {
          type: 'array',
          items: { type: 'object', properties: { label: { type: 'string' }, url: { type: 'string' } }, required: ['label'] },
          description: 'Where the facts came from (spec source, stores, history coverage).',
        },
        recommendations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              product_id: { type: 'string' },
              label: { type: 'string', enum: ['best_value', 'cheapest_fit', 'stretch', 'best_specs'] },
              pro: { type: 'string' },
              con: { type: 'string' },
              why: { type: 'string' },
            },
            required: ['product_id', 'label', 'why'],
          },
          description: 'Product cards to show. Prices and stores are filled in by the app from live data.',
        },
        chips: { type: 'array', items: { type: 'string' }, description: '2-4 short follow-up replies the user might tap next, in the user\'s language.' },
      },
      required: ['text'],
    },
  },
];

export const RespondInput = z.object({
  text: z.string().max(4000),
  facts: z.array(z.string().max(500)).max(12).optional().default([]),
  opinion: z.string().max(2000).optional().default(''),
  sources: z.array(z.object({ label: z.string().max(200), url: z.string().max(2048).optional() })).max(8).optional().default([]),
  recommendations: z.array(z.object({
    product_id: z.string(),
    label: z.enum(['best_value', 'cheapest_fit', 'stretch', 'best_specs']),
    pro: z.string().max(200).optional().default(''),
    con: z.string().max(200).optional().default(''),
    why: z.string().max(400),
  })).max(5).optional().default([]),
  chips: z.array(z.string().max(80)).max(4).optional().default([]),
});
export type RespondInput = z.infer<typeof RespondInput>;

const uuid = z.string().uuid();
const SearchIn = z.object({ query: z.string().min(1).max(120), category: z.string().max(30).optional(), max_price: z.number().positive().optional() });
const ProductIn = z.object({ product_id: uuid });
const OffersIn = z.object({ product_id: uuid, sort: z.enum(['value', 'cheapest', 'nearest', 'fastest']).optional() });
const RecIn = z.object({ category: z.string().max(30), budget: z.number().positive().optional(), use_case: z.string().max(40).optional(), priorities: z.array(z.string().max(30)).max(8).optional() });
const WatchIn = z.object({ product_id: uuid, target_price: z.number().positive() });
const PrefIn = z.object({ text: z.string().min(1).max(200) });

export interface ToolContext {
  db: DB;
  catalog: CatalogService;
  userId: string;
  country: string;
  memoryEnabled: boolean;
  watchLimit: number;
  loc?: { lat: number; lng: number };
  effects: { type: 'watch_added' | 'preference_saved'; id: string }[];
  /** Product ids the model has seen via tools this turn; recommendations are limited to these. */
  seen: Set<string>;
  /** Web discovery, when configured. */
  discover?: (query: string) => Promise<ProductSummaryDTO[]>;
}

const major = (minor: number | null, digits = 2) => (minor === null ? null : minor / 10 ** digits);

export async function runTool(name: string, rawInput: unknown, ctx: ToolContext): Promise<unknown> {
  const market = effectivePriceMarket(ctx.country);
  const cur = market.currency;
  const unit = 10 ** CURRENCIES[cur].minorDigits;
  const M = (m: number | null) => major(m, CURRENCIES[cur].minorDigits);
  switch (name) {
    case 'search_products': {
      const i = SearchIn.parse(rawInput);
      let list = await ctx.catalog.search(i.query, ctx.country, 15);
      if (list.length === 0 && i.category && i.category !== 'any') {
        const rows = await ctx.catalog.productsInCategory(i.category, 15);
        list = await ctx.catalog.summaries(rows, ctx.country);
      }
      if (i.category && i.category !== 'any') list = list.filter((p) => p.category === i.category);
      if (i.max_price) list = list.filter((p) => p.bestPriceMinor !== null && p.bestPriceMinor <= i.max_price! * unit);
      list.forEach((p) => ctx.seen.add(p.id));
      return {
        currency: cur,
        market: market.code,
        results: list.map((p) => ({ product_id: p.id, name: p.name, brand: p.brand, category: p.category, lowest_price: M(p.bestPriceMinor), store_offers: p.offerCount })),
      };
    }
    case 'find_product_online': {
      const i = z.object({ query: z.string().trim().min(2).max(120) }).parse(rawInput);
      if (!ctx.discover) return { error: 'online lookup is not available' };
      const list = await ctx.discover(i.query);
      list.forEach((p) => ctx.seen.add(p.id));
      return {
        currency: cur,
        note: 'Prices here come from web search results (source_type web_search): mention they are unverified and may have changed.',
        results: list.map((p) => ({ product_id: p.id, name: p.name, brand: p.brand, category: p.category, lowest_price: M(p.bestPriceMinor), store_offers: p.offerCount })),
      };
    }
    case 'get_product': {
      const i = ProductIn.parse(rawInput);
      const p = await ctx.catalog.product(i.product_id, ctx.country);
      ctx.seen.add(p.id);
      return {
        product_id: p.id, name: p.name, brand: p.brand, model: p.model, category: p.category,
        specs: p.specs.map((s) => ({ name: s.label, value: s.value })), spec_source: p.specSource,
        lowest_price: M(p.bestPriceMinor), currency: cur, description: p.description,
      };
    }
    case 'get_offers': {
      const i = OffersIn.parse(rawInput);
      const r = await ctx.catalog.rankedOffers(i.product_id, (i.sort ?? 'value') as SortMode, ctx.country, ctx.loc);
      ctx.seen.add(i.product_id);
      const row = (o: (typeof r.offers)[number]) => ({
        store: o.store.name, seller_known: o.store.known, ships_from_abroad: o.store.kind === 'global', condition: o.condition, listing_title: o.title,
        channel: o.channel, price: M(o.priceMinor), original_price: o.original ? `${o.original.priceMinor / 10 ** minorDigitsOf(o.original.currency)} ${o.original.currency}${o.original.exact ? '' : ' (converted approximately)'}` : null,
        shipping: o.shippingMinor === null ? 'unknown' : M(o.shippingMinor),
        final_price: M(o.finalMinor), final_is_estimate: o.finalIsEstimate, stock: o.stock, warranty_months: o.warrantyMonths,
        return_days: o.returnDays, delivery_hours: o.etaHours, branch: o.branch?.name ?? null, distance_km: o.branch?.distanceKm ?? null,
        price_updated_at: o.observedAt, reliability: o.confidence, source_type: o.sourceType, demo_data: o.isDemo, rank: o.rank, rank_reasons: o.reasons,
      });
      return {
        currency: r.currency,
        note: 'Prices and stock may change before purchase. Reliability reflects how recent and trustworthy each price is. seller_known=false means a seller outside our store directory; suspicious_price in rank_reasons means far below other sellers.',
        offers: r.offers.map(row),
        used_listings: r.used.map(row),
      };
    }
    case 'get_price_history': {
      const i = ProductIn.parse(rawInput);
      const h = await ctx.catalog.history(i.product_id, ctx.country);
      return {
        currency: h.currency, data_points: h.stats.points, coverage_days: h.stats.coverageDays, first_record: h.stats.firstAt,
        high: M(h.stats.highMinor), low: M(h.stats.lowMinor), current: M(h.stats.currentMinor), sources: h.sourceCount,
        estimate: h.advice, drop_likelihood_30d: h.dropLikelihood,
        note: 'History only covers the period above. The estimate is heuristic and not a guarantee.',
      };
    }
    case 'recommend_products': {
      const i = RecIn.parse(rawInput);
      const rows = await ctx.catalog.productsInCategory(i.category, 80);
      const best = await ctx.catalog.bestPrices(rows.map((r) => r.id), market.code);
      const candidates: Candidate[] = rows.map((r) => ({ productId: r.id, name: r.name, category: r.category, priceMinor: best.get(r.id)?.minor ?? null, attributes: r.attributes }));
      const picks = recommend(candidates, { category: i.category, budgetMinor: i.budget ? Math.round(i.budget * unit) : null, useCase: i.use_case, priorities: i.priorities });
      picks.forEach((p) => ctx.seen.add(p.candidate.productId));
      return {
        currency: cur,
        compared: candidates.filter((c) => c.priceMinor !== null).length,
        picks: picks.map((p) => ({
          product_id: p.candidate.productId, label: p.label, name: p.candidate.name, price: M(p.candidate.priceMinor),
          store: best.get(p.candidate.productId)?.storeName ?? null, over_budget_by: M(p.overBudgetMinor) || 0,
          strengths: p.pros, weaknesses: p.cons, attributes: p.candidate.attributes,
        })),
      };
    }
    case 'add_to_watchlist': {
      const i = WatchIn.parse(rawInput);
      const p = await ctx.db.query.products.findFirst({ where: eq(products.id, i.product_id) });
      if (!p) return { ok: false, error: 'product_not_found' };
      const count = await ctx.db.$count(watches, eq(watches.userId, ctx.userId));
      const existing = await ctx.db.query.watches.findFirst({ where: and(eq(watches.userId, ctx.userId), eq(watches.productId, p.id)) });
      if (!existing && count >= ctx.watchLimit) return { ok: false, error: 'watch_limit_reached', limit: ctx.watchLimit };
      const best = (await ctx.catalog.bestPrices([p.id], market.code)).get(p.id);
      const target = Math.round(i.target_price * unit);
      const [row] = await ctx.db.insert(watches)
        .values({ userId: ctx.userId, productId: p.id, targetMinor: target, startMinor: best?.minor ?? target })
        .onConflictDoUpdate({ target: [watches.userId, watches.productId], set: { targetMinor: target, hitAt: null } })
        .returning({ id: watches.id });
      ctx.effects.push({ type: 'watch_added', id: row!.id });
      return { ok: true, product: p.name, target_price: i.target_price, currency: cur };
    }
    case 'save_preference': {
      const i = PrefIn.parse(rawInput);
      if (!ctx.memoryEnabled) return { ok: false, error: 'memory_disabled_by_user' };
      const n = await ctx.db.$count(preferences, eq(preferences.userId, ctx.userId));
      if (n >= 30) return { ok: false, error: 'too_many_preferences' };
      const [row] = await ctx.db.insert(preferences).values({ userId: ctx.userId, text: i.text }).returning({ id: preferences.id });
      ctx.effects.push({ type: 'preference_saved', id: row!.id });
      return { ok: true };
    }
    default:
      return { error: `unknown tool ${name}` };
  }
}
