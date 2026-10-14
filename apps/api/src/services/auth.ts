import { and, eq, isNull } from 'drizzle-orm';
import { jwtVerify, SignJWT } from 'jose';
import { randomUUID } from 'node:crypto';
import type { AuthResponse, UserDTO } from '@bestprice/core';
import type { DB } from '../db/client';
import { refreshTokens, users } from '../db/schema';
import { randomToken, sha256 } from '../lib/crypto';
import { unauthorized } from '../lib/errors';

export const ACCESS_TTL_S = 15 * 60;
const REFRESH_TTL_MS = 60 * 24 * 3600_000; // 60 days, rotated on every use
const ISSUER = 'bestprice-api';
const AUDIENCE = 'bestprice-app';

export type UserRow = typeof users.$inferSelect;

export interface AccessClaims {
  sub: string;
  role: 'user' | 'admin';
  kind: 'guest' | 'member';
}

export function toUserDTO(u: UserRow): UserDTO {
  return {
    id: u.id,
    kind: u.kind,
    email: u.email,
    role: u.role,
    name: u.name,
    lang: u.lang,
    country: u.country,
    avatar: u.avatar,
    interests: u.interests,
    priority: u.priority,
    memoryEnabled: u.memoryEnabled,
    savingsGoalMinor: u.savingsGoalMinor,
    plan: u.plan,
  };
}

export class TokenService {
  private key: Uint8Array;
  constructor(private db: DB, secret: string) {
    this.key = new TextEncoder().encode(secret);
  }

  async signAccess(u: UserRow): Promise<string> {
    return new SignJWT({ role: u.role, kind: u.kind })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(u.id)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TTL_S}s`)
      .sign(this.key);
  }

  async verifyAccess(token: string): Promise<AccessClaims> {
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS256'] });
      if (typeof payload.sub !== 'string') throw new Error('no sub');
      return { sub: payload.sub, role: payload.role === 'admin' ? 'admin' : 'user', kind: payload.kind === 'member' ? 'member' : 'guest' };
    } catch {
      throw unauthorized('invalid_token');
    }
  }

  private async newRefresh(userId: string, familyId: string): Promise<string> {
    const token = randomToken(32);
    await this.db.insert(refreshTokens).values({
      userId,
      familyId,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    });
    return token;
  }

  async issue(u: UserRow, familyId: string = randomUUID()): Promise<AuthResponse> {
    const [accessToken, refreshToken] = await Promise.all([this.signAccess(u), this.newRefresh(u.id, familyId)]);
    return { accessToken, refreshToken, expiresIn: ACCESS_TTL_S, user: toUserDTO(u) };
  }

  /**
   * Rotating refresh tokens with reuse detection: presenting an already-used
   * token revokes the whole family (the token was probably stolen).
   */
  async refresh(token: string): Promise<AuthResponse> {
    const row = await this.db.query.refreshTokens.findFirst({ where: eq(refreshTokens.tokenHash, sha256(token)) });
    if (!row) throw unauthorized('invalid_refresh');
    if (row.revokedAt) {
      await this.revokeFamily(row.familyId);
      throw unauthorized('refresh_reused');
    }
    if (row.expiresAt.getTime() < Date.now()) throw unauthorized('refresh_expired');
    const revoked = await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.id, row.id), isNull(refreshTokens.revokedAt)))
      .returning({ id: refreshTokens.id });
    if (revoked.length === 0) {
      // Lost a race with a concurrent refresh of the same token: treat as reuse.
      await this.revokeFamily(row.familyId);
      throw unauthorized('refresh_reused');
    }
    const user = await this.db.query.users.findFirst({ where: eq(users.id, row.userId) });
    if (!user) throw unauthorized('invalid_refresh');
    return this.issue(user, row.familyId);
  }

  async revokeFamily(familyId: string) {
    await this.db.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
  }

  async revokeToken(token: string) {
    const row = await this.db.query.refreshTokens.findFirst({ where: eq(refreshTokens.tokenHash, sha256(token)) });
    if (row) await this.revokeFamily(row.familyId);
  }

  async revokeAllForUser(userId: string) {
    await this.db.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  }
}
