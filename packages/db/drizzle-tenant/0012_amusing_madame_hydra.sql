ALTER TABLE "businesses" ADD COLUMN "business_type" text DEFAULT 'proprietorship' NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "tan" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "cin" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "llpin" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "udyam_number" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "iec_code" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "lut_arn" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "e_invoice_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "e_way_bill_enabled" boolean DEFAULT false NOT NULL;