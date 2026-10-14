# Architecture

```
apps/mobile  ──HTTPS/JSON──▶  apps/api  ──▶ PostgreSQL
apps/admin   ──HTTPS/JSON──▶     │
                                 ├──▶ Anthropic API (advisor, optional)
                                 ├──▶ Expo Push service (price alerts)
                                 └──◀ partner / affiliate feeds (admin-triggered, SSRF-guarded)
packages/core: shared, framework-free TypeScript used by all three apps
```

## packages/core

Pure functions with unit tests (`npm test -w @bestprice/core`):

| Module | Responsibility |
|---|---|
| `markets.ts` | Countries, currencies (minor-unit digits), timezones, units, VAT, and **coverage status**. Only `live` markets show local prices; others fall back to the launch market and say so. |
| `money.ts` | Integer minor units everywhere; formatting only at the edges. |
| `barcode.ts` | GTIN-8/12/13/14 check digits; normalises to GTIN-14 so UPC-A and EAN-13 forms match. |
| `scan.ts` | Classifies scanned payloads (product code, URL, Wi-Fi, contact, text). URLs get a risk verdict (`safe`/`caution`/`blocked`): non-HTTP schemes, embedded credentials, IP literals (incl. decimal/hex encodings), punycode, shorteners, unusual ports. GS1 Digital Link URLs yield a GTIN. |
| `ranking.ts` | Deterministic, explainable offer ranking for `value`, `cheapest`, `nearest`, `fastest`. Final price = price + shipping + fees; unknown shipping is never assumed free. Freshness → confidence (`high`/`medium`/`low`/`stale`) per source type. Stale or out-of-stock offers always sink. Every offer carries reason codes. |
| `history.ts` | Price-history stats with explicit coverage, plus a heuristic buy-now/wait estimate that reports `insufficient_data` instead of guessing. |
| `recommend.ts` | Need/budget-based picks (`best_value`, `cheapest_fit`, `stretch`, `best_specs`) with strengths/weaknesses from real attributes. |
| `api.ts` | Zod request schemas and response DTO types shared by server and clients. |

## apps/api

Fastify 5, Drizzle ORM, PostgreSQL. Migrations in `apps/api/drizzle` run on boot.

### Data model (main tables)

- `users` (guest or member, role, locale/country, avatar, interests, priority, memory flag, plan, lockout counters, push token)
- `refresh_tokens` (hashed, rotating, family-based reuse detection)
- `stores` (with `allowed_domains` for outbound links), `branches` (coordinates)
- `products` (canonical catalog, specs + spec source, recommendation attributes, `match_key`), `product_gtins`
- `data_sources` (type, store, country, **terms note / legal basis**, feed URL, last run)
- `offers` (price, shipping, fees, stock, warranty, returns, ETA, URL, observed time, `flagged` + reason)
- `price_observations` (history), `unmatched_listings` (human review queue)
- `sponsored_placements` (separate from organic offers)
- `watches`, `notifications`, `preferences` (assistant memory), `conversations`, `messages`, `search_history`, `purchases`, `click_events`, `assistant_usage`, `audit_logs`

All money is integer minor units. Every offer row links to its source and observation time.

### Request flow highlights

- **Auth:** `POST /v1/auth/guest` creates an anonymous account so the app works without sign-up. `register` upgrades a guest in place. Access JWT (HS256, 15 min) + opaque refresh token (60 days, rotated every use, reuse revokes the family).
- **Offers:** `GET /v1/products/:id/offers?sort=&lat=&lng=` loads publishable offers (active, unflagged, active store and source, market = user's price market), computes branch distance if a location was sent for this request, ranks, and returns separate `sponsored` items.
- **Scan:** `POST /v1/scan` → exact GTIN match only; otherwise candidates for the user to confirm. URLs are returned with a safety verdict, never followed by the server.
- **Assistant:** `POST /v1/assistant/chat` → quota check → conversation ownership → Claude tool loop (or rule-based fallback) → server renders product cards from the DB → persisted.
- **Alerts:** a 10-minute loop (`checkWatches`) in the API process or the standalone `worker` marks watches whose best trusted price ≤ target and sends one notification + push.
- **Ingestion:** adapters normalise listings → `importListings` validates, enforces store link allow-lists and market currency, matches by GTIN then brand+model, flags outliers (<60% or >160% of the median of other sources), queues unmatched listings, records observations.

### Assistant design

`services/assistant/`:

- `prompt.ts` — frozen system prompt (cached with `cache_control`) + per-user context block (language, market, saved preferences, product context).
- `tools.ts` — tool definitions and handlers; every handler validates input with Zod and reads only from the database. `respond` is the final-answer tool (structured: text, facts, opinion, sources, recommendations, chips).
- `claude.ts` — manual loop on `client.beta.messages.create` with `fallbacks: "default"` (server-side refusal fallback), adaptive thinking at `effort: medium`, up to 8 steps, all tool results returned in one user turn, typed SDK errors mapped to a fallback.
- `rules.ts` — deterministic advisor (slot-filling flows for laptops, phones, headsets, gifts; product Q&A on price timing, best store, comparison) used without an API key or when the API is unavailable.
- `index.ts` — orchestration, daily quota, conversation storage (only rendered messages are stored; raw tool traffic stays inside the turn), card hydration that drops any product id the model didn't obtain from a tool this turn.

## apps/mobile

Expo SDK 57, Expo Router (`src/app`), design tokens in `src/ui/theme.ts` copied from the 2A design.

- Layout direction is applied per view (`direction: 'rtl' | 'ltr'`) so Arabic/English switch instantly without an app restart; native RTL auto-flipping is disabled (`expo-localization` `supportsRTL: false`) to keep one source of truth.
- Session: refresh token in the iOS Keychain / Android Keystore via `expo-secure-store`; access token in memory.
- Screens: splash animation, 3-step onboarding, home, advisor (memoji avatar reacts to the conversation state), scan, product, watchlist, profile/privacy, search, sign-in.
- Notification permission is requested only when the user first watches a price.

## apps/admin

Vite + React single-page admin. Access token in memory, refresh token in `sessionStorage` (tab-scoped). Served by nginx with a strict CSP (`apps/admin/nginx.conf`).
