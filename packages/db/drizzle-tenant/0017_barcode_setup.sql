-- Barcode setup, extra item codes, physical stock counts and the invoice
-- warehouse, for tenant DBs (the same change as drizzle/0030_barcode_setup).
-- Idempotent so tenants that already have some of these are safe.
CREATE TABLE IF NOT EXISTS "item_barcodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"variant_id" uuid,
	"code" text NOT NULL,
	"pack_qty" numeric(15, 3) DEFAULT '1' NOT NULL,
	"label" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "physical_stock_counts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"status" text DEFAULT 'saved' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"scan_count" integer DEFAULT 0 NOT NULL,
	"note" text,
	"lines" jsonb NOT NULL,
	"unknown_codes" jsonb NOT NULL,
	"not_counted" jsonb NOT NULL,
	"adjusted_count" integer DEFAULT 0 NOT NULL,
	"posted_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "barcodes_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "barcode_type" text DEFAULT 'ean13' NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "barcode_mode" text DEFAULT 'single' NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "barcode_setup_locked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "barcode_setup_locked_by" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "warehouse_id" uuid;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "item_barcodes" ADD CONSTRAINT "item_barcodes_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "item_barcodes" ADD CONSTRAINT "item_barcodes_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "item_barcodes" ADD CONSTRAINT "item_barcodes_variant_id_item_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."item_variants"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "physical_stock_counts" ADD CONSTRAINT "physical_stock_counts_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "physical_stock_counts" ADD CONSTRAINT "physical_stock_counts_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "item_barcodes_code_idx" ON "item_barcodes" USING btree ("business_id","code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "item_barcodes_item_idx" ON "item_barcodes" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "physical_counts_business_idx" ON "physical_stock_counts" USING btree ("business_id","created_at");--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "invoices" ADD CONSTRAINT "invoices_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;