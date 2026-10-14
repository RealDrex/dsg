import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ChatBody, LangSchema } from '@bestprice/core';
import { noStore, parse, requireUser, type Ctx } from '../app';

const StartBody = z.object({ productIds: z.array(z.string().uuid()).max(4).default([]), lang: LangSchema.default('ar') });
const Loc = z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) }).partial();

export async function assistantRoutes(app: FastifyInstance, ctx: Ctx) {
  app.addHook('onSend', async (_req, reply) => { noStore(reply); });

  app.post('/conversations', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const u = requireUser(req);
    const body = parse(StartBody, req.body ?? {});
    return ctx.assistant.start(u, body.productIds, body.lang);
  });

  app.get('/conversations/:id', async (req) => {
    const u = requireUser(req);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    return { messages: await ctx.assistant.history(u, id) };
  });

  app.post('/chat', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const u = requireUser(req);
    const body = parse(ChatBody, req.body);
    const q = parse(Loc, req.query);
    const loc = q.lat !== undefined && q.lng !== undefined ? { lat: q.lat, lng: q.lng } : undefined;
    return ctx.assistant.chat(u, body, loc);
  });
}
