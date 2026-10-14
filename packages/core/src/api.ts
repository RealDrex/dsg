import { z } from 'zod';
import type { Channel, Confidence, RankReason, SortMode, SourceType, Stock } from './ranking';
import type { BuyAdvice, HistoryStats } from './history';
import type { PickLabel } from './recommend';
import type { CurrencyCode, Lang } from './markets';

/* ------------------------------------------------------------------ */
/* Request schemas (validated on the server, reused by clients)        */
/* ------------------------------------------------------------------ */

const trimmed = (max: number) => z.string().trim().min(1).max(max);

export const LangSchema = z.enum(['ar', 'en']);
export const SortModeSchema = z.enum(['value', 'cheapest', 'nearest', 'fastest']);
export const CountrySchema = z.string().regex(/^[A-Z]{2}$/);

export const RegisterBody = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(10).max(128),
  name: z.string().trim().max(60).optional(),
});
export const LoginBody = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(128),
});
export const RefreshBody = z.object({ refreshToken: z.string().min(20).max(512) });
export const GuestBody = z.object({ deviceId: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/) });

export const ProfileBody = z.object({
  name: z.string().trim().max(60).optional(),
  lang: LangSchema.optional(),
  country: CountrySchema.optional(),
  avatar: z.string().regex(/^[mf]\d{2}$/).optional(),
  interests: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  priority: SortModeSchema.optional(),
  memoryEnabled: z.boolean().optional(),
  savingsGoalMinor: z.number().int().min(0).max(1e10).optional(),
});

export const SearchQuery = z.object({
  q: z.string().trim().min(1).max(120),
  country: CountrySchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const OffersQuery = z.object({
  sort: SortModeSchema.default('value'),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
});

export const ScanBody = z.object({ raw: z.string().min(1).max(4096), symbology: z.string().max(32).optional() });

export const WatchBody = z.object({
  productId: z.string().uuid(),
  targetMinor: z.number().int().positive().max(1e12),
});
export const WatchPatch = z.object({ targetMinor: z.number().int().positive().max(1e12) });

export const PreferenceBody = z.object({ text: trimmed(200) });

export const ChatBody = z.object({
  conversationId: z.string().uuid().optional(),
  message: trimmed(2000),
  productIds: z.array(z.string().uuid()).max(4).optional(),
  lang: LangSchema.default('ar'),
});

export const PurchaseBody = z.object({ offerId: z.string().uuid() });

/* ------------------------------------------------------------------ */
/* Response DTOs                                                       */
/* ------------------------------------------------------------------ */

export interface UserDTO {
  id: string;
  kind: 'guest' | 'member';
  email: string | null;
  role: 'user' | 'admin';
  name: string | null;
  lang: Lang;
  country: string;
  avatar: string;
  interests: string[];
  priority: SortMode;
  memoryEnabled: boolean;
  savingsGoalMinor: number;
  plan: 'free' | 'pro';
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: UserDTO;
}

export interface StoreDTO {
  id: string;
  name: string;
  nameAr: string;
  logoUrl: string | null;
  brandColor: string | null;
  website: string | null;
}

export interface ProductSummaryDTO {
  id: string;
  name: string;
  brand: string | null;
  model: string | null;
  category: string;
  imageUrl: string | null;
  bestPriceMinor: number | null;
  currency: CurrencyCode;
  offerCount: number;
}

export interface ProductDTO extends ProductSummaryDTO {
  gtins: string[];
  specs: { key: string; label: string; labelAr: string; value: string }[];
  attributes: Record<string, number | string | boolean>;
  specSource: { label: string; url: string | null } | null;
  description: string | null;
}

export interface OfferDTO {
  id: string;
  store: StoreDTO;
  channel: Channel;
  priceMinor: number;
  shippingMinor: number | null;
  feesMinor: number;
  finalMinor: number;
  finalIsEstimate: boolean;
  currency: CurrencyCode;
  stock: Stock;
  warrantyMonths: number | null;
  returnDays: number | null;
  etaHours: number | null;
  branch: { id: string; name: string; nameAr: string; distanceKm: number | null; lat: number; lng: number } | null;
  observedAt: string;
  sourceType: SourceType;
  sourceName: string;
  confidence: Confidence;
  reasons: RankReason[];
  rank: number;
  /** Outbound link via our redirect endpoint (validated store domain). */
  buyUrl: string | null;
  isDemo: boolean;
}

export interface SponsoredDTO {
  id: string;
  label: string;
  labelAr: string;
  priceMinor: number | null;
  currency: CurrencyCode;
  store: StoreDTO;
  clickUrl: string;
}

export interface OffersResponse {
  productId: string;
  sort: SortMode;
  offers: OfferDTO[];
  sponsored: SponsoredDTO[];
  currency: CurrencyCode;
  coverage: { market: string; live: boolean; storeCount: number };
}

export interface HistoryResponse {
  productId: string;
  currency: CurrencyCode;
  points: { at: string; minor: number }[];
  stats: HistoryStats;
  advice: BuyAdvice;
  dropLikelihood: 'low' | 'medium' | 'high' | 'unknown';
  sourceCount: number;
}

export interface WatchItemDTO {
  id: string;
  product: ProductSummaryDTO;
  targetMinor: number;
  startMinor: number;
  currentMinor: number | null;
  currentStore: string | null;
  hit: boolean;
  hitAt: string | null;
  createdAt: string;
}

export interface NotificationDTO {
  id: string;
  kind: 'price_target' | 'price_drop' | 'system';
  title: string;
  body: string;
  productId: string | null;
  createdAt: string;
  readAt: string | null;
}

export interface ScanResponse {
  kind: 'gtin' | 'url' | 'wifi' | 'contact' | 'text';
  /** Exact GTIN match (confidence 1) or best candidates for the user to pick from. */
  match: { product: ProductSummaryDTO; confidence: number } | null;
  candidates: ProductSummaryDTO[];
  url?: { url: string; host: string; risk: 'safe' | 'caution' | 'blocked'; reasons: string[] };
  text?: string;
}

export interface RecCardDTO {
  productId: string;
  label: PickLabel;
  name: string;
  specLine: string;
  priceMinor: number | null;
  currency: CurrencyCode;
  storeName: string | null;
  pros: string[];
  cons: string[];
  why: string;
}

export interface AssistantMessageDTO {
  id: string;
  role: 'assistant' | 'user';
  text: string;
  facts: string[];
  opinion: string | null;
  sources: { label: string; url: string | null }[];
  recommendations: RecCardDTO[];
  chips: string[];
  /** Short pre-rendered mood for the avatar: thinking | happy | explaining | recommending | done */
  mood: 'hello' | 'explaining' | 'recommending' | 'opinion' | 'done' | 'neutral';
  createdAt: string;
}

export interface ChatResponse {
  conversationId: string;
  productIds: string[];
  messages: AssistantMessageDTO[];
  /** Assistant actions that changed user state (e.g. watch added), so the client can refresh. */
  effects: { type: 'watch_added' | 'preference_saved'; id: string }[];
  usage: { used: number; limit: number };
}

export interface HomeResponse {
  user: UserDTO;
  savings: { monthMinor: number; goalMinor: number; purchases: number };
  stats: { watching: number; targetHit: number; dropped: number };
  watching: WatchItemDTO[];
  alerts: NotificationDTO[];
  localDeals: { offer: OfferDTO; product: ProductSummaryDTO }[];
  recent: ProductSummaryDTO[];
  suggestions: string[];
  coverage: { market: string; live: boolean };
}

export type ApiError = { error: { code: string; message: string } };
