ALTER TYPE "public"."tenant_plan" ADD VALUE 'forever_free' BEFORE 'free';--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "referral_code" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "business_type" text DEFAULT 'proprietorship' NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "tan" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "cin" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "llpin" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "udyam_number" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "iec_code" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "lut_arn" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "e_invoice_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "e_way_bill_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "address_line_1" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "address_line_2" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "landmark" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "country_of_operations" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "financial_year_start_date" date;