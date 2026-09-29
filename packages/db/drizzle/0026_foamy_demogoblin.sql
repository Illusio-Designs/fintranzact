ALTER TABLE "businesses" ADD COLUMN "signature_data" "bytea";--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "signature_mime_type" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "signature_width" integer;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "signature_height" integer;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "signature_updated_at" timestamp with time zone;