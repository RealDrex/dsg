# Roadmap & success metrics

## Phase 1 — MVP (this repository)
Everything listed in the README's MVP table. Remaining before a public launch:

1. Sign 2–4 real data sources in Saudi Arabia (affiliate feeds and/or partner catalogs) and switch off demo sources.
2. Real product photos (from partner feeds, with rights) instead of placeholders.
3. EAS project setup, app-store assets, privacy policy & terms (Arabic + English), PDPL review.
4. Production hosting per `docs/SECURITY.md` checklist; external penetration test.
5. Closed beta (100–300 users), measure the metrics below, fix data gaps.

## Phase 2 — after the beta
- Visual search: product photo and gallery image → candidate products (user confirms). Price-tag OCR → compare the shelf price with other stores.
- More categories (fragrance, fashion, furniture) where GTINs are weaker: needs attribute-based matching with human review.
- Richer price history and "good time to buy" with seasonal events (White Friday, Ramadan, back-to-school).
- Pro plan: higher assistant limits, more watches, advanced alerts (any drop, store-specific), longer history. In-app purchase via the stores' billing.
- Verified user price reports with moderation.

## Phase 3 — expansion
- UAE, Kuwait, Egypt: currency, VAT, local stores and branches; Gulf-wide shipping costs.
- Merchant tools (clearly separated from organic results): sponsored placements dashboard, product data quality reports.

## Success metrics (from the product brief)

| Metric | How it is measured |
|---|---|
| Product recognition accuracy | Share of scans with an exact GTIN match; share of "Not this product?" taps |
| Reliable price coverage | Admin overview: % of active products with fresh (non-stale) prices |
| Price freshness & accuracy | Offer age distribution; flagged/approved ratio; spot checks against stores |
| Assistant usage & useful conversations | Messages per day (`assistant_usage`); conversations ending with a product open, watch, or click-out |
| Retention | Returning users (`last_seen_at`) D1/D7/D30 |
| Saves & alerts | Watches created; targets hit |
| Click-outs & conversions | `click_events`; affiliate conversion reports |
| Data cost vs revenue | Feed/API costs per store vs affiliate revenue |
| Satisfaction | In-app rating of recommendations (to add in beta) |
