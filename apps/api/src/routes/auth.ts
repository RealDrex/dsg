import type { FastifyInstance } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { LoginBody, RefreshBody, RegisterBody, ProfileBody } from '@bestprice/core';
import { parse, noStore, type Ctx } from '../app';
import { users } from '../db/schema';
import { hashPassword, passwordProblem, verifyPassword } from '../lib/crypto';
import { badRequest, conflict, HttpError, unauthorized } from '../lib/errors';

const LOCK_AFTER = 5;
const LOCK_MS = 15 * 60_000;
const strict = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

export async function authRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db, tokens } = ctx;

  /** Guest session: core features work without an account. */
  app.post('/guest', { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (req, reply) => {
    noStore(reply);
    const prefs = ProfileBody.partial().safeParse(req.body ?? {});
    const p = prefs.success ? prefs.data : {};
    const [u] = await db.insert(users).values({
      kind: 'guest', name: p.name ?? null, lang: p.lang ?? 'ar', country: p.country ?? 'SA', avatar: p.avatar ?? 'm01',
      interests: p.interests ?? [], priority: p.priority ?? 'value', memoryEnabled: p.memoryEnabled ?? true,
    }).returning();
    return tokens.issue(u!);
  });

  /** Register; when called with a guest token the guest account is upgraded in place (keeps watchlist, chats). */
  app.post('/register', strict, async (req, reply) => {
    noStore(reply);
    const body = parse(RegisterBody, req.body);
    const problem = passwordProblem(body.password, body.email);
    if (problem) throw badRequest('weak_password', problem);
    const exists = await db.query.users.findFirst({ where: eq(users.email, body.email) });
    if (exists) throw conflict('email_taken', 'An account with this email already exists');
    const passwordHash = await hashPassword(body.password);
    let user;
    if (req.user && req.user.kind === 'guest') {
      [user] = await db.update(users).set({ kind: 'member', email: body.email, passwordHash, name: body.name ?? req.user.name }).where(eq(users.id, req.user.id)).returning();
      await tokens.revokeAllForUser(req.user.id);
    } else {
      [user] = await db.insert(users).values({ kind: 'member', email: body.email, passwordHash, name: body.name ?? null }).returning();
    }
    return reply.status(201).send(await tokens.issue(user!));
  });

  app.post('/login', strict, async (req, reply) => {
    noStore(reply);
    const body = parse(LoginBody, req.body);
    const u = await db.query.users.findFirst({ where: eq(users.email, body.email) });
    if (u?.lockedUntil && u.lockedUntil.getTime() > Date.now()) {
      throw new HttpError(423, 'account_locked', 'Too many failed attempts. Try again later.');
    }
    const ok = await verifyPassword(u?.passwordHash ?? null, body.password);
    if (!u || !ok) {
      if (u) {
        const failed = u.failedLogins + 1;
        await db.update(users).set({
          failedLogins: sql`${users.failedLogins} + 1`,
          lockedUntil: failed >= LOCK_AFTER ? new Date(Date.now() + LOCK_MS) : null,
        }).where(eq(users.id, u.id));
      }
      throw unauthorized('invalid_credentials', 'Email or password is incorrect');
    }
    await db.update(users).set({ failedLogins: 0, lockedUntil: null, lastSeenAt: new Date() }).where(eq(users.id, u.id));
    return tokens.issue(u);
  });

  app.post('/refresh', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    noStore(reply);
    const { refreshToken } = parse(RefreshBody, req.body);
    return tokens.refresh(refreshToken);
  });

  app.post('/logout', async (req, reply) => {
    const parsed = RefreshBody.safeParse(req.body);
    if (parsed.success) await tokens.revokeToken(parsed.data.refreshToken);
    return reply.status(204).send();
  });

  /** Sign out everywhere: revokes every refresh token for the account. */
  app.post('/logout-all', async (req, reply) => {
    if (!req.user) throw unauthorized();
    await tokens.revokeAllForUser(req.user.id);
    return reply.status(204).send();
  });
}
