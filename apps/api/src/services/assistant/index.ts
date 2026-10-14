import Anthropic from '@anthropic-ai/sdk';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { effectivePriceMarket, type AssistantMessageDTO, type ChatResponse, type Lang, type RecCardDTO } from '@bestprice/core';
import type { DB } from '../../db/client';
import { assistantUsage, conversations, messages, preferences, products, users, watches } from '../../db/schema';
import { forbidden, notFound, tooMany } from '../../lib/errors';
import type { CatalogService } from '../catalog';
import type { UserRow } from '../auth';
import { AssistantUnavailable, claudeTurn } from './claude';
import { userContextBlock } from './prompt';
import type { DiscoveryService } from '../discovery';
import { RuleAdvisor, type FlowState } from './rules';
import type { RespondInput, ToolContext } from './tools';

interface StoredContent extends AssistantMessageDTO {
  state?: FlowState;
}

export interface AssistantOptions {
  apiKey?: string;
  model: string;
  freeDaily: number;
  proDaily: number;
  freeWatchLimit: number;
  proWatchLimit: number;
}

export class AssistantService {
  private client: Anthropic | null;
  private rules: RuleAdvisor;

  constructor(private db: DB, private catalog: CatalogService, private opts: AssistantOptions, private discovery?: DiscoveryService) {
    this.client = opts.apiKey ? new Anthropic({ apiKey: opts.apiKey, maxRetries: 2, timeout: 60_000 }) : null;
    this.rules = new RuleAdvisor(catalog);
  }

  get mode(): 'ai' | 'rules' {
    return this.client ? 'ai' : 'rules';
  }

  private async consumeQuota(user: UserRow): Promise<{ used: number; limit: number }> {
    const limit = user.plan === 'pro' ? this.opts.proDaily : this.opts.freeDaily;
    const day = new Date().toISOString().slice(0, 10);
    const [row] = await this.db
      .insert(assistantUsage)
      .values({ userId: user.id, day, count: 1 })
      .onConflictDoUpdate({ target: [assistantUsage.userId, assistantUsage.day], set: { count: sql`${assistantUsage.count} + 1` } })
      .returning({ count: assistantUsage.count });
    if (row!.count > limit) throw tooMany('assistant_daily_limit', `Daily assistant limit of ${limit} messages reached`);
    return { used: row!.count, limit };
  }

  private async ownedConversation(user: UserRow, id: string) {
    const conv = await this.db.query.conversations.findFirst({ where: eq(conversations.id, id) });
    if (!conv) throw notFound('conversation_not_found');
    if (conv.userId !== user.id) throw forbidden();
    return conv;
  }

  private async validProductIds(ids: string[]): Promise<{ id: string; name: string }[]> {
    if (!ids.length) return [];
    const rows = await this.db.select({ id: products.id, name: products.name }).from(products).where(and(inArray(products.id, ids), eq(products.status, 'active')));
    return ids.map((id) => rows.find((r) => r.id === id)).filter((r): r is { id: string; name: string } => !!r);
  }

  /** Starts a conversation (optionally about products) and returns the advisor's opening message. */
  async start(user: UserRow, productIds: string[], lang: Lang): Promise<ChatResponse> {
    const ctxProducts = await this.validProductIds(productIds);
    const [conv] = await this.db.insert(conversations).values({ userId: user.id, productIds: ctxProducts.map((p) => p.id) }).returning();
    const r = await this.rules.turn({ message: '', lang, country: user.country, state: {}, productIds: ctxProducts.map((p) => p.id), isFirst: true });
    const msg = await this.render(r.answer, new Set(), user.country, 'hello');
    await this.db.insert(messages).values({ conversationId: conv!.id, role: 'assistant', content: msg });
    const limit = user.plan === 'pro' ? this.opts.proDaily : this.opts.freeDaily;
    return { conversationId: conv!.id, productIds: conv!.productIds, messages: [msg], effects: [], usage: { used: 0, limit } };
  }

  async history(user: UserRow, conversationId: string): Promise<AssistantMessageDTO[]> {
    await this.ownedConversation(user, conversationId);
    const rows = await this.db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(asc(messages.createdAt)).limit(200);
    return rows.map((r) => stripState(r.content as StoredContent));
  }

  async chat(user: UserRow, input: { conversationId?: string; message: string; productIds?: string[]; lang: Lang }, loc?: { lat: number; lng: number }): Promise<ChatResponse> {
    const usage = await this.consumeQuota(user);

    let conv: typeof conversations.$inferSelect | undefined = input.conversationId ? await this.ownedConversation(user, input.conversationId) : undefined;
    if (!conv) {
      const ids = (await this.validProductIds(input.productIds ?? [])).map((p) => p.id);
      [conv] = await this.db.insert(conversations).values({ userId: user.id, productIds: ids }).returning();
    } else if (input.productIds?.length) {
      // Adding a product to an existing chat (e.g. "compare with…").
      const merged = [...new Set([...conv.productIds, ...input.productIds])].slice(0, 4);
      const valid = (await this.validProductIds(merged)).map((p) => p.id);
      [conv] = await this.db.update(conversations).set({ productIds: valid, updatedAt: new Date() }).where(eq(conversations.id, conv.id)).returning();
    }
    const c = conv!;
    const ctxProducts = await this.validProductIds(c.productIds);

    const prior = await this.db.select().from(messages).where(eq(messages.conversationId, c.id)).orderBy(desc(messages.createdAt)).limit(20);
    prior.reverse();
    const lastAssistant = [...prior].reverse().find((m) => m.role === 'assistant')?.content as StoredContent | undefined;

    const userMsg: StoredContent = blank(randomUUID(), 'user', input.message);
    await this.db.insert(messages).values({ conversationId: c.id, role: 'user', content: userMsg });

    const prefs = user.memoryEnabled
      ? (await this.db.select({ text: preferences.text }).from(preferences).where(eq(preferences.userId, user.id)).orderBy(asc(preferences.createdAt)).limit(30)).map((p) => p.text)
      : [];
    const ctx: ToolContext = {
      db: this.db, catalog: this.catalog, userId: user.id, country: user.country, memoryEnabled: user.memoryEnabled,
      watchLimit: user.plan === 'pro' ? this.opts.proWatchLimit : this.opts.freeWatchLimit, loc, effects: [], seen: new Set(ctxProducts.map((p) => p.id)),
      discover: this.discovery?.available ? async (q) => (await this.discovery!.discover(user, { q }, user.country)).results : undefined,
    };

    let answer: RespondInput | null = null;
    let state: FlowState | undefined;
    let usedAi = false;
    if (this.client) {
      try {
        const market = effectivePriceMarket(user.country);
        const history: Anthropic.Beta.BetaMessageParam[] = prior.map((m) => ({ role: m.role, content: summarize(m.content as StoredContent) }));
        history.push({ role: 'user', content: input.message });
        const userContext = userContextBlock({
          lang: input.lang, name: user.name, country: user.country, priceMarket: market.code, currency: market.currency,
          marketLive: market.code === user.country, priority: user.priority, memoryEnabled: user.memoryEnabled, preferences: prefs, productContext: ctxProducts,
        });
        const out = await claudeTurn(this.client, this.opts.model, mergeRoles(history), userContext, ctx);
        if (out === null) {
          answer = { text: input.lang === 'ar' ? 'ما أقدر أساعد في هذا الطلب. تقدر تسألني عن أي منتج أو مقارنة أو سعر.' : 'I can’t help with that request. Ask me about any product, comparison or price.', facts: [], opinion: '', sources: [], recommendations: [], chips: [] };
        } else answer = out;
        usedAi = true;
      } catch (e) {
        if (!(e instanceof AssistantUnavailable)) throw e;
        answer = null; // fall through to the rule-based advisor
      }
    }
    if (!answer) {
      const r = await this.rules.turn({ message: input.message, lang: input.lang, country: user.country, state: lastAssistant?.state ?? {}, productIds: ctxProducts.map((p) => p.id), isFirst: false });
      answer = r.answer;
      state = r.state;
      r.answer.recommendations.forEach((x) => ctx.seen.add(x.product_id));
      if (r.watch) {
        const count = await this.db.$count(watches, eq(watches.userId, user.id));
        if (count < ctx.watchLimit) {
          const best = (await this.catalog.bestPrices([r.watch.productId], effectivePriceMarket(user.country).code)).get(r.watch.productId);
          const [w] = await this.db.insert(watches)
            .values({ userId: user.id, productId: r.watch.productId, targetMinor: r.watch.targetMinor, startMinor: best?.minor ?? r.watch.targetMinor })
            .onConflictDoUpdate({ target: [watches.userId, watches.productId], set: { targetMinor: r.watch.targetMinor, hitAt: null } })
            .returning({ id: watches.id });
          ctx.effects.push({ type: 'watch_added', id: w!.id });
        } else {
          answer.text = input.lang === 'ar' ? `وصلت للحد الأقصى (${ctx.watchLimit} منتجات) في قائمة المتابعة. احذف منتجًا أو رقِّ للخطة Pro.` : `Your watchlist is full (${ctx.watchLimit} products). Remove one or upgrade to Pro.`;
          answer.chips = [];
        }
      }
    }

    const mood: AssistantMessageDTO['mood'] = ctx.effects.some((e) => e.type === 'watch_added') ? 'done' : answer.recommendations.length ? 'recommending' : answer.opinion ? 'opinion' : 'explaining';
    const msg: StoredContent = { ...(await this.render(answer, ctx.seen, user.country, mood)), state };
    await this.db.insert(messages).values({ conversationId: c.id, role: 'assistant', content: msg });
    await this.db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, c.id));
    await this.db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, user.id));
    void usedAi;
    return { conversationId: c.id, productIds: c.productIds, messages: [stripState(userMsg), stripState(msg)], effects: ctx.effects, usage };
  }

  /** Builds the DTO; product cards get live prices and stores from the database. */
  private async render(a: RespondInput, allowed: Set<string>, country: string, mood: AssistantMessageDTO['mood']): Promise<StoredContent> {
    const recIds = a.recommendations.map((r) => r.product_id).filter((id) => allowed.has(id));
    const market = effectivePriceMarket(country);
    const rows = recIds.length ? await this.db.select().from(products).where(and(inArray(products.id, recIds), eq(products.status, 'active'))) : [];
    const best = await this.catalog.bestPrices(rows.map((r) => r.id), market.code);
    const recommendations: RecCardDTO[] = [];
    for (const r of a.recommendations) {
      const p = rows.find((x) => x.id === r.product_id);
      if (!p) continue; // drop anything the model did not get from our tools
      const b = best.get(p.id);
      recommendations.push({
        productId: p.id, label: r.label, name: p.name,
        specLine: p.specs.slice(0, 4).map((s) => s.value).join(' · '),
        priceMinor: b?.minor ?? null, currency: market.currency, storeName: b?.storeName ?? null,
        pros: r.pro ? [r.pro] : [], cons: r.con ? [r.con] : [], why: r.why,
      });
    }
    return {
      id: randomUUID(), role: 'assistant', text: a.text, facts: a.facts, opinion: a.opinion || null,
      sources: a.sources.map((s) => ({ label: s.label, url: s.url && /^https:\/\//.test(s.url) ? s.url : null })),
      recommendations, chips: a.chips, mood, createdAt: new Date().toISOString(),
    };
  }
}

function blank(id: string, role: 'user' | 'assistant', text: string): StoredContent {
  return { id, role, text, facts: [], opinion: null, sources: [], recommendations: [], chips: [], mood: 'neutral', createdAt: new Date().toISOString() };
}

function stripState(m: StoredContent): AssistantMessageDTO {
  const { state: _state, ...rest } = m;
  return rest;
}

/** Compact text form of a past message for the model's context. */
function summarize(m: StoredContent): string {
  if (m.role === 'user') return m.text || '…';
  const parts = [m.text];
  if (m.facts.length) parts.push('Facts: ' + m.facts.join('; '));
  if (m.opinion) parts.push('Opinion: ' + m.opinion);
  if (m.recommendations.length) parts.push('Recommended: ' + m.recommendations.map((r) => `${r.name} (product_id ${r.productId}, ${r.label})`).join('; '));
  return parts.filter(Boolean).join('\n') || '…';
}

/** The API needs alternating roles starting with user; merge consecutive same-role turns. */
function mergeRoles(msgs: Anthropic.Beta.BetaMessageParam[]): Anthropic.Beta.BetaMessageParam[] {
  const out: Anthropic.Beta.BetaMessageParam[] = [];
  for (const m of msgs) {
    const last = out[out.length - 1];
    if (last && last.role === m.role && typeof last.content === 'string' && typeof m.content === 'string') last.content += '\n\n' + m.content;
    else out.push({ ...m });
  }
  while (out[0]?.role === 'assistant') out.shift();
  return out;
}
