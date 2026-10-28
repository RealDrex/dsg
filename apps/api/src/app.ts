import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { eq } from 'drizzle-orm';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import type { Config } from './config';
import type { DB } from './db/client';
import { users } from './db/schema';
import { HttpError, forbidden, unauthorized } from './lib/errors';
import { TokenService, type UserRow } from './services/auth';
import { CatalogService } from './services/catalog';
import { AssistantService } from './services/assistant';
import { authRoutes } from './routes/auth';
import { meRoutes } from './routes/me';
import { catalogRoutes } from './routes/catalog';
import { watchRoutes } from './routes/watch';
import { assistantRoutes } from './routes/assistant';
import { adminRoutes } from './routes/admin';
import { DiscoveryJobs, DiscoveryService } from './services/discovery';
import { LogoService } from './lib/logo';
import { MediaService } from './services/media';
import { PriceMonitor } from './services/monitor';

export interface Ctx {
  cfg: Config;
  db: DB;
  tokens: TokenService;
  catalog: CatalogService;
  assistant: AssistantService;
  discovery: DiscoveryService;
  jobs: DiscoveryJobs;
  logos: LogoService;
  media: MediaService;
  monitor: PriceMonitor;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: UserRow | null;
  }
}

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  return schema.parse(data);
}

export async function buildApp(cfg: Config, db: DB): Promise<{ app: FastifyInstance; ctx: Ctx }> {
  const app = Fastify({
    logger: cfg.NODE_ENV === 'test' ? false : {
      level: cfg.NODE_ENV === 'production' ? 'info' : 'debug',
      redact: ['req.headers.authorization', 'req.headers.cookie', 'req.body.password', 'req.body.refreshToken'],
    },
    bodyLimit: 1_000_000,
    trustProxy: cfg.TRUST_PROXY,
    disableRequestLogging: cfg.NODE_ENV === 'production',
  });

  const tokens = new TokenService(db, cfg.JWT_SECRET);
  const catalog = new CatalogService(db, cfg.PUBLIC_BASE_URL);
  const media = new MediaService(db, { braveKey: cfg.BRAVE_SEARCH_API_KEY || undefined });
  const discovery = new DiscoveryService(db, catalog, {
    apiKey: cfg.ANTHROPIC_API_KEY || undefined,
    model: cfg.DISCOVERY_MODEL,
    effort: cfg.DISCOVERY_EFFORT,
    maxSearches: cfg.DISCOVERY_MAX_SEARCHES,
    dailyBudgetUsd: cfg.DISCOVERY_DAILY_BUDGET_USD,
    freeDaily: cfg.FREE_DISCOVERY_DAILY,
    proDaily: cfg.PRO_DISCOVERY_DAILY,
    monitorDaily: cfg.MONITOR_SEARCH_DAILY,
  }, media);
  const monitor = new PriceMonitor(db, discovery, { watchedEveryMin: cfg.WATCHED_REFRESH_MINUTES, viewedEveryMin: cfg.VIEWED_REFRESH_MINUTES });
  const assistant = new AssistantService(db, catalog, {
    apiKey: cfg.ANTHROPIC_API_KEY || undefined,
    model: cfg.ASSISTANT_MODEL,
    freeDaily: cfg.FREE_ASSISTANT_DAILY,
    proDaily: cfg.PRO_ASSISTANT_DAILY,
    freeWatchLimit: cfg.FREE_WATCH_LIMIT,
    proWatchLimit: cfg.PRO_WATCH_LIMIT,
  }, discovery);
  const jobs = new DiscoveryJobs(2, 400, (e) => app.log.error({ err: e }, 'online search failed'));
  const ctx: Ctx = { cfg, db, tokens, catalog, assistant, discovery, jobs, media, monitor, logos: new LogoService(undefined, { logoDevToken: cfg.LOGO_DEV_TOKEN || undefined, dir: cfg.NODE_ENV === 'test' ? undefined : cfg.LOGO_CACHE_DIR }) };

  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-site' },
  });
  const origins = cfg.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  await app.register(cors, {
    origin: (origin, cb) => cb(null, !origin || origins.includes(origin)),
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    allowedHeaders: ['authorization', 'content-type'],
    maxAge: 600,
  });
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.ip,
    errorResponseBuilder: (_req, c) => ({ statusCode: 429, error: { code: 'rate_limited', message: `Too many requests, retry in ${Math.ceil(c.ttl / 1000)}s` } }),
  });

  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req) => {
    const h = req.headers.authorization;
    if (!h) return;
    if (!h.startsWith('Bearer ')) throw unauthorized('invalid_authorization_header');
    const claims = await tokens.verifyAccess(h.slice(7));
    const u = await db.query.users.findFirst({ where: eq(users.id, claims.sub) });
    if (!u) throw unauthorized('invalid_token');
    req.user = u;
  });

  app.setErrorHandler((err: unknown, req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: { code: err.code, message: err.message } });
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: { code: 'validation_error', message: err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') } });
    }
    const e = err as { statusCode?: number; code?: string; message?: string; error?: unknown };
    if (e.statusCode === 429) return reply.status(429).send(e.error ? e : { error: { code: 'rate_limited', message: 'Too many requests' } });
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) {
      return reply.status(e.statusCode).send({ error: { code: e.code ?? 'bad_request', message: e.message ?? 'Bad request' } });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send({ error: { code: 'internal_error', message: 'Something went wrong' } });
  });
  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: { code: 'not_found', message: 'Not found' } }));

  app.get('/health', { config: { rateLimit: false } }, async () => {
    await db.execute('select 1');
    return { ok: true, assistant: assistant.mode, discovery: discovery.available };
  });

  await app.register(async (r) => authRoutes(r, ctx), { prefix: '/v1/auth' });
  await app.register(async (r) => meRoutes(r, ctx), { prefix: '/v1' });
  await app.register(async (r) => catalogRoutes(r, ctx));
  await app.register(async (r) => watchRoutes(r, ctx), { prefix: '/v1' });
  await app.register(async (r) => assistantRoutes(r, ctx), { prefix: '/v1/assistant' });
  await app.register(async (r) => adminRoutes(r, ctx), { prefix: '/v1/admin' });

  return { app, ctx };
}

export function requireUser(req: FastifyRequest): UserRow {
  if (!req.user) throw unauthorized();
  return req.user;
}

export function requireMember(req: FastifyRequest): UserRow {
  const u = requireUser(req);
  if (u.kind !== 'member') throw forbidden('account_required', 'Create an account to use this feature');
  return u;
}

export function requireAdmin(req: FastifyRequest): UserRow {
  const u = requireUser(req);
  if (u.role !== 'admin') throw forbidden();
  return u;
}

export const noStore = (reply: FastifyReply) => reply.header('cache-control', 'no-store');
