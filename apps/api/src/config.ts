import { z } from 'zod';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  CORS_ORIGINS: z.string().default(''),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:4000'),
  ANTHROPIC_API_KEY: z.string().optional(),
  ASSISTANT_MODEL: z.string().default('claude-opus-5-5'),
  /** Online product search: a faster model answers sooner; claude-opus-5-5 searches deeper. */
  DISCOVERY_MODEL: z.string().default('claude-sonnet-5-5'),
  DISCOVERY_EFFORT: z.enum(['low', 'medium', 'high']).default('low'),
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().optional(),
  SEED_DEMO_DATA: z.string().default('true').transform((v) => v === 'true'),
  TRUST_PROXY: z.string().default('false').transform((v) => v === 'true'),
  FREE_ASSISTANT_DAILY: z.coerce.number().int().default(30),
  PRO_ASSISTANT_DAILY: z.coerce.number().int().default(300),
  FREE_DISCOVERY_DAILY: z.coerce.number().int().default(15),
  PRO_DISCOVERY_DAILY: z.coerce.number().int().default(100),
  FREE_WATCH_LIMIT: z.coerce.number().int().default(5),
  PRO_WATCH_LIMIT: z.coerce.number().int().default(100),
});

export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment:\n${issues}`);
  }
  const cfg = parsed.data;
  if (cfg.NODE_ENV === 'production' && /change-me/.test(cfg.JWT_SECRET)) {
    throw new Error('Refusing to start in production with the example JWT_SECRET');
  }
  return cfg;
}
