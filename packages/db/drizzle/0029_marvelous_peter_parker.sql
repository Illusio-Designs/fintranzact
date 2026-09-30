ALTER TABLE "parties" ADD COLUMN "additional_shipping_addresses" jsonb;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "legal_name" text;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "trade_name" text;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "gst_registration_type" text;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "constitution" text;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "gstin_status" text;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "gstin_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "is_msme" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "udyam_number" text;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "msme_category" text;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "tds_section" text;