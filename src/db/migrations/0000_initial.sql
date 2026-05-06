CREATE TYPE "public"."deal_kind" AS ENUM('code', 'automatic', 'cashback', 'sale', 'bogo');
--> statement-breakpoint
CREATE TYPE "public"."discount_type" AS ENUM('pct_off', 'amt_off', 'free_shipping', 'gift', 'tiered', 'unknown');
--> statement-breakpoint
CREATE TYPE "public"."segment" AS ENUM('general', 'new_customer', 'student', 'military', 'email_signup', 'first_app_purchase');
--> statement-breakpoint
CREATE TYPE "public"."source_network" AS ENUM('fmtc', 'awin', 'impact', 'cj', 'rakuten', 'skimlinks', 'partnerize', 'slickdeals', 'manual', 'telemetry');
--> statement-breakpoint
CREATE TYPE "public"."verification_difficulty" AS ENUM('easy', 'medium', 'hard');
--> statement-breakpoint
CREATE TABLE "merchants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(128) NOT NULL,
	"display_name" varchar(256) NOT NULL,
	"domains" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"categories" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"countries" varchar(2)[] DEFAULT ARRAY[]::varchar[] NOT NULL,
	"affiliate_networks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cashback_rate_bps" integer,
	"attribution_source" varchar(64),
	"verification_difficulty" "verification_difficulty" DEFAULT 'medium' NOT NULL,
	"logo_url" text,
	"homepage_url" text,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"kind" "deal_kind" NOT NULL,
	"code" varchar(128),
	"title" varchar(512) NOT NULL,
	"description" text,
	"discount_type" "discount_type" DEFAULT 'unknown' NOT NULL,
	"discount_value_bps" integer,
	"discount_value_cents" integer,
	"cart_min_cents" integer,
	"sku_scope" jsonb,
	"geo_scope" varchar(2)[] DEFAULT ARRAY[]::varchar[] NOT NULL,
	"segment" "segment" DEFAULT 'general' NOT NULL,
	"stack_rules" jsonb,
	"starts_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"deeplink" text,
	"attribution_source" varchar(64),
	"source_network" "source_network" NOT NULL,
	"source_id" varchar(256) NOT NULL,
	"source_meta" jsonb,
	"dedup_group_id" uuid,
	"embedding_digest" varchar(64),
	"last_seen_working_at" timestamp with time zone,
	"success_rate" real,
	"success_sample_count" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telemetry" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "telemetry_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"deal_id" uuid NOT NULL,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"worked" boolean NOT NULL,
	"effective_discount_cents" integer,
	"cart_total_cents" integer,
	"country_code" varchar(2),
	"client_hash" varchar(64) NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "prices" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "prices_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"merchant_id" uuid,
	"asin" varchar(16),
	"product_url" text,
	"product_key" varchar(256) NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"price_cents" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"availability" varchar(32),
	"source" varchar(32) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_usage" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "api_usage_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"client_hash" varchar(64) NOT NULL,
	"org_id" varchar(64),
	"user_id" varchar(64),
	"tool" varchar(64) NOT NULL,
	"units" integer DEFAULT 1 NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stripe_reported" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingest_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_network" "source_network" NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" varchar(32) DEFAULT 'running' NOT NULL,
	"deals_upserted" integer DEFAULT 0 NOT NULL,
	"merchants_upserted" integer DEFAULT 0 NOT NULL,
	"error_message" text
);
--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "telemetry" ADD CONSTRAINT "telemetry_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "prices" ADD CONSTRAINT "prices_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "merchants_slug_unique" ON "merchants" USING btree ("slug");
--> statement-breakpoint
CREATE INDEX "merchants_domains_idx" ON "merchants" USING gin ("domains");
--> statement-breakpoint
CREATE INDEX "merchants_categories_idx" ON "merchants" USING gin ("categories");
--> statement-breakpoint
CREATE INDEX "deals_merchant_idx" ON "deals" USING btree ("merchant_id");
--> statement-breakpoint
CREATE INDEX "deals_active_merchant_idx" ON "deals" USING btree ("is_active","merchant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "deals_source_unique" ON "deals" USING btree ("source_network","source_id");
--> statement-breakpoint
CREATE INDEX "deals_expires_idx" ON "deals" USING btree ("expires_at");
--> statement-breakpoint
CREATE INDEX "deals_dedup_group_idx" ON "deals" USING btree ("dedup_group_id");
--> statement-breakpoint
CREATE INDEX "deals_geo_idx" ON "deals" USING gin ("geo_scope");
--> statement-breakpoint
CREATE INDEX "telemetry_deal_reported_idx" ON "telemetry" USING btree ("deal_id","reported_at");
--> statement-breakpoint
CREATE INDEX "telemetry_client_idx" ON "telemetry" USING btree ("client_hash","reported_at");
--> statement-breakpoint
CREATE INDEX "prices_product_observed_idx" ON "prices" USING btree ("product_key","observed_at");
--> statement-breakpoint
CREATE INDEX "prices_asin_idx" ON "prices" USING btree ("asin");
--> statement-breakpoint
CREATE INDEX "api_usage_client_occurred_idx" ON "api_usage" USING btree ("client_hash","occurred_at");
--> statement-breakpoint
CREATE INDEX "api_usage_unreported_idx" ON "api_usage" USING btree ("stripe_reported","occurred_at");
--> statement-breakpoint
CREATE INDEX "ingest_runs_source_started_idx" ON "ingest_runs" USING btree ("source_network","started_at");
