# Data sources

Best Price only shows prices from sources it is allowed to use. The AI model never produces prices, stock or links.

## Allowed source types

| Type | Examples | Notes |
|---|---|---|
| `official_api` | A retailer's product/price API under its developer terms | Preferred. Respect rate limits and attribution terms. |
| `partner_catalog` | Direct feed agreed with a store (CSV/JSON/SFTP) | Signed data-sharing agreement. |
| `affiliate_feed` | Affiliate network product feeds (e.g. Amazon Associates / PA-API, regional networks) | Use the feed's own price/freshness rules and required disclosures. |
| `user_report` | Price-tag photos / reports from users | Must be verified (e.g. multiple reports or moderator review) before publishing; lower confidence window. |
| `demo` | Seed data | Development only; always labelled "demo data" in the apps. |

**Not allowed:** scraping sites whose terms forbid it, bypassing bot protection, or using prices without the right to display them.

A source can only be activated after its **legal basis** (`terms_note`: API terms version, agreement reference, affiliate program ID) is recorded — enforced by the API.

## Launch market plan

Start with Saudi Arabia (SAR) and categories with good structured data and GTIN coverage: laptops, phones, tablets, headphones, small appliances, coffee equipment. Add stores one at a time, measure coverage and freshness, then expand to new categories, then new countries (the model already supports multiple markets, currencies, languages, timezones and units).

## Listing format (import)

`POST /v1/admin/sources/:id/import` with `{ "listings": [...] }` (or a feed URL that returns the same array):

```json
{
  "externalId": "store-sku-123",
  "title": "Lenovo IdeaPad Slim 5 14",
  "gtin": "0197529846216",
  "brand": "Lenovo",
  "model": "83HW0021AX",
  "priceMinor": 284900,
  "shippingMinor": 0,
  "feesMinor": 0,
  "currency": "SAR",
  "channel": "local",
  "stock": "in_stock",
  "warrantyMonths": 24,
  "returnDays": 7,
  "etaHours": 2,
  "url": "https://www.store.example/product/123",
  "branchId": "optional-branch-uuid",
  "observedAt": "2026-10-14T08:10:00Z"
}
```

- `priceMinor` etc. are integers in minor units (halala). Prices are VAT-inclusive as shown to consumers.
- `shippingMinor: null` means unknown; the app shows the final price as a lower bound ("≥").
- `url` must be HTTPS and on the store's allowed domains.

## Matching (same product vs similar product)

1. **GTIN** exact match (UPC/EAN normalised to GTIN-14).
2. **Brand + model** normalised match key, only when exactly one catalog product matches.
3. Otherwise the listing goes to **Unmatched listings** for a human to link or dismiss. We never auto-match "similar" products.

## Quality controls

- **Outliers:** a price below 60% or above 160% of the median of other sources' prices for the same product is flagged and hidden until approved in *Data quality*.
- **Freshness → confidence:** per source type (e.g. affiliate feeds are "high" for 3 h, "medium" for 24 h, "low" for 4 days, then "stale"). Stale offers sink to the bottom and never count as the best price; the UI shows "updated X ago" and the reliability level next to every price.
- **Currency/market:** listings must use the source market's currency.
- **Audit:** every import and moderation action is logged.
- **Metrics** (admin overview): price coverage (% of products with fresh prices), flagged and stale counts, unmatched queue, active sources.

## Adding a source adapter

Write a small adapter that calls the partner API, maps each item to the listing format above, and calls `importListings(db, sourceId, listings)` (see `apps/api/src/ingest/pipeline.ts`). Schedule it per the partner's allowed refresh rate. Keep credentials in environment variables / a secrets manager, never in the database.
