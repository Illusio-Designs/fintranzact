ALTER TABLE "businesses" ADD COLUMN "store_return_window_days" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "store_policies" jsonb;