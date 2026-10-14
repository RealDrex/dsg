import { sql } from 'drizzle-orm';
import {
  boolean, date, doublePrecision, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/* ----------------------------- Accounts ----------------------------- */

export const users = pgTable('users', {
  id: id(),
  kind: text('kind', { enum: ['guest', 'member'] }).notNull().default('guest'),
  email: text('email'),
  passwordHash: text('password_hash'),
  role: text('role', { enum: ['user', 'admin'] }).notNull().default('user'),
  name: text('name'),
  lang: text('lang', { enum: ['ar', 'en'] }).notNull().default('ar'),
  country: text('country').notNull().default('SA'),
  avatar: text('avatar').notNull().default('m01'),
  interests: text('interests').array().notNull().default(sql`'{}'::text[]`),
  priority: text('priority', { enum: ['value', 'cheapest', 'nearest', 'fastest'] }).notNull().default('value'),
  memoryEnabled: boolean('memory_enabled').notNull().default(true),
  savingsGoalMinor: integer('savings_goal_minor').notNull().default(200000),
  plan: text('plan', { enum: ['free', 'pro'] }).notNull().default('free'),
  pushToken: text('push_token'),
  failedLogins: integer('failed_logins').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  createdAt: createdAt(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
}, (t) => [uniqueIndex('users_email_uq').on(t.email)]);

export const refreshTokens = pgTable('refresh_tokens', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  familyId: uuid('family_id').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('refresh_hash_uq').on(t.tokenHash), index('refresh_family_idx').on(t.familyId)]);

/* ------------------------------ Catalog ------------------------------ */

export const stores = pgTable('stores', {
  id: id(),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  nameAr: text('name_ar').notNull(),
  logoUrl: text('logo_url'),
  brandColor: text('brand_color'),
  website: text('website'),
  /** Outbound links are only followed to these hosts (and their subdomains). */
  allowedDomains: text('allowed_domains').array().notNull().default(sql`'{}'::text[]`),
  country: text('country').notNull().default('SA'),
  /** In the curated store directory. Sellers created from web search results are not, and the apps say so. */
  known: boolean('known').notNull().default(true),
  kind: text('kind', { enum: ['retailer', 'global', 'classifieds'] }).notNull().default('retailer'),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('stores_slug_uq').on(t.slug)]);

export const branches = pgTable('branches', {
  id: id(),
  storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  nameAr: text('name_ar').notNull(),
  city: text('city').notNull(),
  lat: doublePrecision('lat').notNull(),
  lng: doublePrecision('lng').notNull(),
  createdAt: createdAt(),
}, (t) => [index('branches_store_idx').on(t.storeId)]);

export const products = pgTable('products', {
  id: id(),
  name: text('name').notNull(),
  nameAr: text('name_ar'),
  brand: text('brand'),
  model: text('model'),
  /** normalised brand+model used to match listings without a GTIN */
  matchKey: text('match_key'),
  category: text('category').notNull(),
  imageUrl: text('image_url'),
  /** Maker's website (host only), for its logo. */
  brandDomain: text('brand_domain'),
  attributes: jsonb('attributes').$type<Record<string, number | string | boolean>>().notNull().default({}),
  specs: jsonb('specs').$type<{ key: string; label: string; labelAr: string; value: string }[]>().notNull().default([]),
  specSourceLabel: text('spec_source_label'),
  specSourceUrl: text('spec_source_url'),
  description: text('description'),
  status: text('status', { enum: ['active', 'hidden'] }).notNull().default('active'),
  createdAt: createdAt(),
}, (t) => [index('products_category_idx').on(t.category), index('products_match_idx').on(t.matchKey)]);

export const productGtins = pgTable('product_gtins', {
  gtin: text('gtin').primaryKey(),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
}, (t) => [index('gtins_product_idx').on(t.productId)]);

export const dataSources = pgTable('data_sources', {
  id: id(),
  name: text('name').notNull(),
  type: text('type', { enum: ['official_api', 'partner_catalog', 'affiliate_feed', 'user_report', 'web_search', 'demo'] }).notNull(),
  storeId: uuid('store_id').references(() => stores.id, { onDelete: 'set null' }),
  country: text('country').notNull().default('SA'),
  active: boolean('active').notNull().default(true),
  /** Legal basis / terms reference, required before a source can be activated. */
  termsNote: text('terms_note').notNull().default(''),
  feedUrl: text('feed_url'),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  lastStatus: text('last_status'),
  createdAt: createdAt(),
});

export const offers = pgTable('offers', {
  id: id(),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
  branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'set null' }),
  sourceId: uuid('source_id').notNull().references(() => dataSources.id, { onDelete: 'cascade' }),
  externalId: text('external_id').notNull(),
  country: text('country').notNull().default('SA'),
  currency: text('currency').notNull().default('SAR'),
  channel: text('channel', { enum: ['local', 'online'] }).notNull(),
  priceMinor: integer('price_minor').notNull(),
  shippingMinor: integer('shipping_minor'),
  feesMinor: integer('fees_minor').notNull().default(0),
  stock: text('stock', { enum: ['in_stock', 'limited', 'out_of_stock', 'unknown'] }).notNull().default('unknown'),
  warrantyMonths: integer('warranty_months'),
  returnDays: integer('return_days'),
  etaHours: integer('eta_hours'),
  url: text('url'),
  condition: text('condition', { enum: ['new', 'used', 'refurbished'] }).notNull().default('new'),
  /** Listing title as the seller wrote it (kept for used and marketplace listings). */
  title: text('title'),
  /** Price as shown by the seller when it was in another currency; priceMinor holds the converted amount. */
  origPriceMinor: integer('orig_price_minor'),
  origCurrency: text('orig_currency'),
  observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
  /** Flagged offers (anomalous price, contradicting data) are hidden until reviewed. */
  flagged: boolean('flagged').notNull().default(false),
  flagReason: text('flag_reason'),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('offers_source_ext_uq').on(t.sourceId, t.externalId),
  index('offers_product_idx').on(t.productId),
]);

export const priceObservations = pgTable('price_observations', {
  id: id(),
  offerId: uuid('offer_id').notNull().references(() => offers.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  finalMinor: integer('final_minor').notNull(),
  observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
}, (t) => [index('obs_product_time_idx').on(t.productId, t.observedAt)]);

/** Listings an import could not match to a catalog product with enough certainty. */
export const unmatchedListings = pgTable('unmatched_listings', {
  id: id(),
  sourceId: uuid('source_id').notNull().references(() => dataSources.id, { onDelete: 'cascade' }),
  externalId: text('external_id').notNull(),
  title: text('title').notNull(),
  payload: jsonb('payload').notNull(),
  createdAt: createdAt(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
}, (t) => [uniqueIndex('unmatched_source_ext_uq').on(t.sourceId, t.externalId)]);

/** Paid placements live in their own table and are never mixed into organic ranking. */
export const sponsoredPlacements = pgTable('sponsored_placements', {
  id: id(),
  productId: uuid('product_id').references(() => products.id, { onDelete: 'cascade' }),
  storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  labelAr: text('label_ar').notNull(),
  priceMinor: integer('price_minor'),
  url: text('url').notNull(),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull().defaultNow(),
  endsAt: timestamp('ends_at', { withTimezone: true }),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
});

/* ---------------------------- User activity ---------------------------- */

export const watches = pgTable('watches', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  targetMinor: integer('target_minor').notNull(),
  startMinor: integer('start_minor').notNull(),
  hitAt: timestamp('hit_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('watches_user_product_uq').on(t.userId, t.productId)]);

export const notifications = pgTable('notifications', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ['price_target', 'price_drop', 'system'] }).notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  productId: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  readAt: timestamp('read_at', { withTimezone: true }),
}, (t) => [index('notifications_user_idx').on(t.userId, t.createdAt)]);

/** Assistant memory: only stored when the user has memory enabled; always user-editable. */
export const preferences = pgTable('preferences', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  text: text('text').notNull(),
  createdAt: createdAt(),
}, (t) => [index('preferences_user_idx').on(t.userId)]);

export const conversations = pgTable('conversations', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  productIds: uuid('product_ids').array().notNull().default(sql`'{}'::uuid[]`),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('conversations_user_idx').on(t.userId)]);

export const messages = pgTable('messages', {
  id: id(),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['user', 'assistant'] }).notNull(),
  /** Rendered DTO shown in the app */
  content: jsonb('content').notNull(),
  createdAt: createdAt(),
}, (t) => [index('messages_conv_idx').on(t.conversationId, t.createdAt)]);

export const searchHistory = pgTable('search_history', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  query: text('query'),
  productId: uuid('product_id').references(() => products.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
}, (t) => [index('search_user_idx').on(t.userId, t.createdAt)]);

export const purchases = pgTable('purchases', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  offerId: uuid('offer_id').references(() => offers.id, { onDelete: 'set null' }),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  paidMinor: integer('paid_minor').notNull(),
  savedMinor: integer('saved_minor').notNull(),
  createdAt: createdAt(),
}, (t) => [index('purchases_user_idx').on(t.userId, t.createdAt)]);

export const clickEvents = pgTable('click_events', {
  id: id(),
  offerId: uuid('offer_id').references(() => offers.id, { onDelete: 'set null' }),
  sponsoredId: uuid('sponsored_id').references(() => sponsoredPlacements.id, { onDelete: 'set null' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
});

export const assistantUsage = pgTable('assistant_usage', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  day: date('day').notNull(),
  count: integer('count').notNull().default(0),
}, (t) => [primaryKey({ columns: [t.userId, t.day] })]);

export const auditLogs = pgTable('audit_logs', {
  id: id(),
  actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  entityId: text('entity_id'),
  data: jsonb('data'),
  createdAt: createdAt(),
}, (t) => [index('audit_time_idx').on(t.createdAt)]);

/**
 * Web product discovery runs (Claude + web search). Doubles as a 24 h cache
 * per query/market and as the per-user daily quota counter.
 */
export const discoveryRuns = pgTable('discovery_runs', {
  id: id(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  key: text('key').notNull(),
  market: text('market').notNull(),
  status: text('status', { enum: ['found', 'not_found', 'failed'] }).notNull(),
  productIds: uuid('product_ids').array().notNull().default(sql`'{}'::uuid[]`),
  /** Of productIds, the ones that are alternatives rather than the item searched for. */
  similarIds: uuid('similar_ids').array().notNull().default(sql`'{}'::uuid[]`),
  createdAt: createdAt(),
}, (t) => [index('discovery_key_idx').on(t.key, t.market, t.createdAt), index('discovery_user_idx').on(t.userId, t.createdAt)]);
