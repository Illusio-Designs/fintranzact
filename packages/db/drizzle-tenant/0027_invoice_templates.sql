-- Printed invoice design and thermal roll width per business.
-- Idempotent: safe to re-run where the columns already exist (db:push).
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "invoice_template" text DEFAULT 'classic' NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "thermal_width" integer DEFAULT 80 NOT NULL;
