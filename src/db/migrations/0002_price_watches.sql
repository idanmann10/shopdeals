CREATE TABLE "price_watches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_hash" varchar(64) NOT NULL,
	"query" text,
	"product_url" text,
	"target_price_cents" integer NOT NULL,
	"country_code" varchar(2),
	"notify_email" varchar(320),
	"notify_webhook" text,
	"last_checked_at" timestamp with time zone,
	"last_observed_cents" integer,
	"triggered_at" timestamp with time zone,
	"triggered_cents" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "price_watches_client_active_idx" ON "price_watches" USING btree ("client_hash","is_active");
--> statement-breakpoint
CREATE INDEX "price_watches_active_checked_idx" ON "price_watches" USING btree ("is_active","last_checked_at");
