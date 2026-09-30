-- Brings tenant DBs in line with the schema (e-way bill configs, signatures,
-- barcodes were missing from drizzle-tenant/) and adds party GST/MSME/TDS
-- fields and extra shipping addresses. Idempotent so tenants that already
-- have some of these are safe.
CREATE TABLE IF NOT EXISTS "eway_bill_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"gstin" text NOT NULL,
	"client_id" text,
	"client_secret" text,
	"username" text NOT NULL,
	"password" text NOT NULL,
	"auth_token" text,
	"token_expires_at" timestamp with time zone,
	"is_sandbox" boolean DEFAULT true NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "e_invoice_configs" ALTER COLUMN "client_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "e_invoice_configs" ALTER COLUMN "client_secret" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "signature_data" "bytea";--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "signature_mime_type" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "signature_width" integer;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "signature_height" integer;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "signature_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "next_barcode_number" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "auto_generate_barcodes" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "item_variants" ADD COLUMN IF NOT EXISTS "barcode" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "barcode" text;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN IF NOT EXISTS "additional_shipping_addresses" jsonb;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN IF NOT EXISTS "legal_name" text;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN IF NOT EXISTS "trade_name" text;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN IF NOT EXISTS "gst_registration_type" text;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN IF NOT EXISTS "constitution" text;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN IF NOT EXISTS "gstin_status" text;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN IF NOT EXISTS "gstin_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN IF NOT EXISTS "is_msme" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN IF NOT EXISTS "udyam_number" text;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN IF NOT EXISTS "msme_category" text;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN IF NOT EXISTS "tds_section" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "eway_bill_configs" ADD CONSTRAINT "eway_bill_configs_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ewb_config_business_idx" ON "eway_bill_configs" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "item_variants_barcode_idx" ON "item_variants" USING btree ("barcode");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "items_barcode_idx" ON "items" USING btree ("business_id","barcode") WHERE "items"."barcode" IS NOT NULL AND "items"."deleted_at" IS NULL;