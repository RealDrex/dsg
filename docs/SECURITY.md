# Security

This document lists the controls implemented in the codebase and what must be configured at deployment. Tests covering the controls live in `apps/api/test/api.test.ts` and `apps/api/test/assistant-ai.test.ts`.

## Implemented controls

### Authentication & sessions
- Passwords hashed with **argon2id** (19 MiB, t=2). Minimum 10 characters; rejects repetitive, common, and email-containing passwords.
- Login timing does not reveal whether an email exists (a dummy hash is verified for unknown accounts); identical error for unknown email and wrong password.
- **Lockout**: 5 failed attempts → 15-minute lock (`423`). Admins can unlock.
- Access tokens: HS256 JWT, 15 minutes, issuer/audience/algorithm pinned (rejects `alg: none` and forged tokens).
- Refresh tokens: 256-bit random, stored only as SHA-256 hashes, **rotated on every use**; reusing an old token revokes the entire token family (stolen-token detection). Guest→member upgrade and role changes revoke existing sessions. "Sign out everywhere" endpoint.
- Mobile stores the refresh token in Keychain/Keystore (`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`).

### Authorization
- Every user-owned resource (watches, preferences, conversations, notifications, purchases) is queried with the caller's user id — no IDOR (tested).
- Admin routes require `role = admin` on every request; all admin mutations are written to `audit_logs`.

### Input & output
- Every body, query and route parameter is validated with Zod; strict UUID checks; size limits on all strings and arrays; 1 MB body limit (10 MB only for admin imports).
- SQL is parameterised by Drizzle; `LIKE` wildcards in search input are escaped.
- Errors return `{error: {code, message}}` without stack traces; logs redact `authorization`, cookies, passwords and refresh tokens.
- Security headers via Helmet: `default-src 'none'` CSP for the API, `nosniff`, frame denial, etc. `Cache-Control: no-store` on personal endpoints.
- CORS: explicit allow-list (`CORS_ORIGINS`); mobile apps don't need CORS.

### Abuse limits
- Global rate limit 300 req/min/IP; tighter limits on login/register (10/min), refresh (30/min), guest creation (20/h), scan (60/min), chat (20/min), exports and deletion.
- Assistant daily message quota per plan; watchlist size limit per plan.

### Links, QR codes and SSRF
- QR payloads are classified, never assumed to be products. URLs get a risk verdict; `javascript:`, `data:`, `file:`, `intent:` etc. are never opened. Credentials-in-URL and IP-literal hosts are blocked; punycode, shorteners, plain HTTP and odd ports show a caution.
- Outbound "Buy" links go through `/r/:id`, which only redirects (HTTPS) to the store's `allowed_domains` — no open redirect. Import rejects listings with off-domain URLs.
- Server-side feed fetching (`/admin/sources/:id/fetch`) is HTTPS-only, resolves DNS and refuses private/loopback/link-local/CGNAT ranges, follows no redirects, and caps size and time.

### AI assistant
- Prices, stores, availability and links come only from database-backed tools. Product cards are rendered server-side from the DB; any product id the model did not receive from a tool in that turn is dropped (tested).
- Tool inputs are schema-validated before execution; tool results are marked as data and the system prompt instructs the model to ignore instructions inside them (prompt-injection from catalog/store text).
- Side-effecting tools are limited to adding a watch (user's own account, plan limit enforced) and saving a preference (only if the user enabled memory; capped).
- Refusals return a polite message; API failures fall back to the rule-based advisor.

### Online product lookup (web discovery)
- Runs only for a signed-in session (guest included), rate limited (6/min) with a daily per-user quota; results are cached per query and market (24 h found, 1 h miss) so repeated searches cost nothing.
- A price is kept only if its page URL was returned by web search in that same run **and** belongs to a store in the store directory (`allowed_domains`); anything else the model reports is dropped (tested). Kept prices go through the normal import pipeline (currency check, outlier flagging) as `web_search` offers, which never reach "high" confidence and are labelled in the app with a "check on the store page" notice.
- Spec source links must be pages the search returned. Product photos are accepted only from store domains, known store image CDNs, or the spec-source site; other hosts are dropped (tested).
- The model's structured output is schema-validated (strict tool + Zod); web page text is treated as data, never as instructions.

### Privacy
- Guest use without email. Location is sent per request only for distance and never stored. Country comes from settings, not geolocation.
- Turning assistant memory off deletes saved preferences. Users can view/delete each preference, clear search & chat history, export all their data (JSON) and permanently delete their account (cascading delete).
- No third-party analytics or ad SDKs in the app; store logos are rendered locally (no third-party image requests that leak IPs).
- Notification permission requested only when watching a price.

### Commercial integrity
- Sponsored placements live in a separate table and response field, are labelled in the UI and never affect organic ranking or assistant recommendations.

## Deployment checklist (must do before launch)

- [ ] Generate a unique `JWT_SECRET` (≥ 32 random bytes) per environment; store all secrets in a secrets manager, never in git.
- [ ] Serve the API only over HTTPS (TLS 1.2+) behind a reverse proxy/load balancer; set `TRUST_PROXY=true` there so rate limits see client IPs; enable HSTS.
- [ ] Set `CORS_ORIGINS` to the exact admin origin(s).
- [ ] Restrict the admin panel by network (VPN/IP allow-list or SSO proxy) in addition to admin login; set `connect-src` in `apps/admin/nginx.conf` to the API origin.
- [ ] Use a dedicated least-privilege Postgres role; enable encrypted backups and point-in-time recovery; encryption at rest.
- [ ] Rotate the seeded admin password after first login; create named admin accounts; remove unused admins.
- [ ] Configure `ANTHROPIC_API_KEY` with a spend limit; monitor usage.
- [ ] Set up log shipping and alerts (5xx rate, lockouts, refresh-token reuse events, flagged-offer spikes).
- [ ] Run `npm audit --omit=dev` and dependency updates on a schedule (CI already reports).
- [ ] Commission an external penetration test and a privacy review (PDPL in Saudi Arabia; GDPR when expanding to the EU) before public launch; publish a privacy policy and terms.
- [ ] Configure EAS project ID for push notifications; enable app transport security defaults (HTTPS only) in production builds.

## Reporting a vulnerability

Please email the maintainers privately; do not open a public issue for security reports.
