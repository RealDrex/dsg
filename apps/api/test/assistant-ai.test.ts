import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Ctx } from '../src/app';
import type { DB } from '../src/db/client';
import { products } from '../src/db/schema';
import { guest, setup } from './helpers';

let app: FastifyInstance;
let ctx: Ctx;
let db: DB;
let ideapadId: string;

/** Scripted stand-in for the Anthropic client: returns queued responses and records requests. */
function fakeClient(script: ((req: any) => any)[]) {
  const calls: any[] = [];
  return {
    calls,
    beta: { messages: { create: async (req: any) => { calls.push(structuredClone(req)); const next = script.shift(); if (!next) throw new Error('script exhausted'); return next(req); } } },
  };
}
const msg = (content: any[], stop_reason = 'tool_use') => ({ id: 'm', type: 'message', role: 'assistant', model: 'x', content, stop_reason, usage: {} });

beforeAll(async () => {
  ({ app, ctx, db } = await setup());
  ideapadId = (await db.query.products.findFirst({ where: eq(products.model, '83HW0021AX') }))!.id;
});
afterAll(async () => { await app.close(); await db.$client.end(); });

describe('assistant (AI mode, scripted model)', () => {
  it('grounds cards in tool results: unseen or invented product ids are dropped and prices come from the DB', async () => {
    const fake = fakeClient([
      () => msg([{ type: 'tool_use', id: 't1', name: 'search_products', input: { query: 'IdeaPad' } }]),
      (req) => {
        // the tool result made it back to the model, as data
        const last = req.messages[req.messages.length - 1];
        expect(last.content[0].type).toBe('tool_result');
        expect(JSON.parse(last.content[0].content).results[0].lowest_price).toBe(2778);
        return msg([{ type: 'tool_use', id: 't2', name: 'respond', input: {
          text: 'هذا أفضل خيار لك', facts: ['16GB RAM'], opinion: 'أنصح فيه',
          recommendations: [
            { product_id: ideapadId, label: 'best_value', why: 'متوازن', pro: 'بطارية', con: 'شاشة' },
            { product_id: randomUUID(), label: 'cheapest_fit', why: 'invented' },
          ],
          chips: ['هل أشتري الآن؟'],
        } }]);
      },
    ]);
    (ctx.assistant as any).client = fake;
    const g = await guest(app);
    const r = (await app.inject({ method: 'POST', url: '/v1/assistant/chat', headers: g.h, payload: { message: 'أبي لابتوب', lang: 'ar' } })).json();
    const reply = r.messages[1];
    expect(reply.recommendations).toHaveLength(1);
    expect(reply.recommendations[0]).toMatchObject({ productId: ideapadId, priceMinor: 277800, storeName: 'noon' });
    expect(reply.mood).toBe('recommending');
    // system prompt is cached and user context is separate
    expect(fake.calls[0].system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(fake.calls[0].system[1].text).toContain('Arabic');
  });

  it('falls back to the rule-based advisor when the API fails', async () => {
    const { AssistantUnavailable } = await import('../src/services/assistant/claude');
    (ctx.assistant as any).client = { beta: { messages: { create: async () => { throw new Error('boom'); } } } };
    const g = await guest(app);
    const r = await app.inject({ method: 'POST', url: '/v1/assistant/chat', headers: g.h, payload: { message: 'أبي لابتوب', lang: 'ar' } });
    expect(r.statusCode).toBe(200);
    expect(r.json().messages[1].chips.length).toBeGreaterThan(0);
    void AssistantUnavailable;
  });

  it('handles refusals politely', async () => {
    (ctx.assistant as any).client = fakeClient([() => msg([], 'refusal')]);
    const g = await guest(app);
    const r = (await app.inject({ method: 'POST', url: '/v1/assistant/chat', headers: g.h, payload: { message: 'something off-topic', lang: 'en' } })).json();
    expect(r.messages[1].text).toMatch(/can’t help/);
  });

  it('only adds to the watchlist through the tool and respects ownership of the product id', async () => {
    (ctx.assistant as any).client = fakeClient([
      () => msg([{ type: 'tool_use', id: 't1', name: 'add_to_watchlist', input: { product_id: ideapadId, target_price: 2600 } }]),
      () => msg([{ type: 'tool_use', id: 't2', name: 'respond', input: { text: 'Done.' } }]),
    ]);
    const g = await guest(app);
    const r = (await app.inject({ method: 'POST', url: '/v1/assistant/chat', headers: g.h, payload: { message: 'watch the IdeaPad at 2600', lang: 'en' } })).json();
    expect(r.effects).toEqual([{ type: 'watch_added', id: expect.any(String) }]);
    const w = (await app.inject({ method: 'GET', url: '/v1/watches', headers: g.h })).json();
    expect(w[0].targetMinor).toBe(260000);
  });
});
