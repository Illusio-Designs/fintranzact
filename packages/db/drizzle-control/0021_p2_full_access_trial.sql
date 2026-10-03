-- Full Access Trial (P2): when and how an organisation's trial began, the
-- one-trial-per-business claims (salted hashes only, never the raw email /
-- phone / GSTIN) and the reminder log. Idempotent.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "trial_started_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "trial_source" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trial_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"value_hash" text NOT NULL,
	"tenant_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trial_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "trial_claims" ADD CONSTRAINT "trial_claims_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "trial_reminders" ADD CONSTRAINT "trial_reminders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "trial_claims_kind_hash_idx" ON "trial_claims" USING btree ("kind","value_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trial_claims_tenant_idx" ON "trial_claims" USING btree ("tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "trial_reminders_tenant_kind_idx" ON "trial_reminders" USING btree ("tenant_id","kind");
