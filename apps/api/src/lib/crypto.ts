import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';

// OWASP-recommended argon2id parameters (19 MiB, 2 iterations).
const ARGON = { algorithm: 2 /* Algorithm.Argon2id */, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (password: string) => hash(password, ARGON);

export async function verifyPassword(stored: string | null, password: string): Promise<boolean> {
  // Always do the work, even for unknown accounts, so response time doesn't reveal whether an email exists.
  const target = stored ?? (await dummyHash());
  try {
    const ok = await verify(target, password);
    return ok && stored !== null;
  } catch {
    return false;
  }
}
let dummy: Promise<string> | null = null;
const dummyHash = () => (dummy ??= hash(randomBytes(16).toString('hex'), ARGON));

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Rejects passwords that are trivially guessable even when long enough. */
export function passwordProblem(password: string, email: string): string | null {
  if (password.length < 10) return 'too_short';
  if (new Set(password).size < 5) return 'too_repetitive';
  const local = email.split('@')[0]?.toLowerCase() ?? '';
  if (local.length >= 4 && password.toLowerCase().includes(local)) return 'contains_email';
  if (/^(password|qwerty|123456|abcdef|letmein|welcome)/i.test(password)) return 'too_common';
  return null;
}
