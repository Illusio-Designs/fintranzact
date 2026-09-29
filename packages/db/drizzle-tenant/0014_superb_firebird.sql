ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "assessee_of_other_territory" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "gst_return_periodicity" text DEFAULT 'monthly' NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "e_way_bill_threshold" numeric(15, 2);