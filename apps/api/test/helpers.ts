import type { FastifyInstance } from 'fastify';
import { buildApp, type Ctx } from '../src/app';
import { loadConfig } from '../src/config';
import { createDb, type DB } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';
import { seed } from '../src/db/seed';

export const ADMIN = { email: 'admin@test.local', password: 'Sup3r-Secret-Pass!' };

export async function setup(): Promise<{ app: FastifyInstance; ctx: Ctx; db: DB }> {
  const url = process.env.TEST_DATABASE_URL ?? 'postgres://bestprice:bestprice@localhost:5432/bestprice_test';
  const db = createDb(url);
  await db.execute('drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;');
  await runMigrations(db);
  await seed(db, { demo: true, adminEmail: ADMIN.email, adminPassword: ADMIN.password, log: () => {} });
  const cfg = loadConfig({
    NODE_ENV: 'test', DATABASE_URL: url, JWT_SECRET: 'test-secret-test-secret-test-secret-123', PUBLIC_BASE_URL: 'http://api.test',
    CORS_ORIGINS: 'http://admin.test', FREE_ASSISTANT_DAILY: '40', FREE_WATCH_LIMIT: '3',
  } as NodeJS.ProcessEnv);
  const { app, ctx } = await buildApp(cfg, db);
  // Tests never reach the internet: image lookups answer "not found" unless a test scripts them.
  (ctx.media as unknown as { opts: { fetcher: unknown } }).opts.fetcher = async (url: string) => ({ status: 404, url, contentType: 'text/plain', body: Buffer.alloc(0) });
  await app.ready();
  return { app, ctx, db };
}

export async function guest(app: FastifyInstance, body: object = {}) {
  const r = await app.inject({ method: 'POST', url: '/v1/auth/guest', payload: body });
  const j = r.json();
  return { token: j.accessToken as string, refresh: j.refreshToken as string, user: j.user, h: { authorization: `Bearer ${j.accessToken}` } };
}

export async function admin(app: FastifyInstance) {
  const r = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: ADMIN });
  return { authorization: `Bearer ${r.json().accessToken}` };
}
