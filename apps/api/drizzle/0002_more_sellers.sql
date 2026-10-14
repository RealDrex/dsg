ALTER TABLE "discovery_runs" ADD COLUMN "similar_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "condition" text DEFAULT 'new' NOT NULL;--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "orig_price_minor" integer;--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "orig_currency" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "brand_domain" text;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "known" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "kind" text DEFAULT 'retailer' NOT NULL;