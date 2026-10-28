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
  /** Web searches the model may run per product search (each costs about $0.01). */
  DISCOVERY_MAX_SEARCHES: z.coerce.number().int().min(1).max(15).default(5),
  /** Hard ceiling on what web search may cost per day, all users together (USD). Reached → only the catalog until tomorrow. */
  DISCOVERY_DAILY_BUDGET_USD: z.coerce.number().min(0).default(5),
  /** Optional: image search for product photos (Brave Search API). Without it, photos come from store pages and Wikipedia. */
  BRAVE_SEARCH_API_KEY: z.string().optional(),
  /** Optional: sharper brand/store logos from logo.dev. Without it, each site's own icon is used. */
  LOGO_DEV_TOKEN: z.string().optional(),
  /** Amazon Associates tracking id (e.g. "bestprice-21"); used for Amazon stores that have no affiliate setting of their own. */
  AMAZON_ASSOCIATE_TAG: z.string().regex(/^[A-Za-z0-9_-]{2,40}$/).optional().or(z.literal('')),
  /** Where logos found are kept between restarts. */
  LOGO_CACHE_DIR: z.string().default('.cache/logos'),
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().optional(),
  SEED_DEMO_DATA: z.string().default('true').transform((v) => v === 'true'),
  TRUST_PROXY: z.string().default('false').transform((v) => v === 'true'),
  FREE_ASSISTANT_DAILY: z.coerce.number().int().default(30),
  PRO_ASSISTANT_DAILY: z.coerce.number().int().default(300),
  FREE_DISCOVERY_DAILY: z.coerce.number().int().default(15),
  PRO_DISCOVERY_DAILY: z.coerce.number().int().default(100),
  /** Price monitor: how often watched / recently viewed products are re-checked, and its daily web-search budget. */
  WATCHED_REFRESH_MINUTES: z.coerce.number().int().min(10).default(60),
  VIEWED_REFRESH_MINUTES: z.coerce.number().int().min(30).default(360),
  MONITOR_SEARCH_DAILY: z.coerce.number().int().min(0).default(40),
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
