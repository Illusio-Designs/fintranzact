CREATE TABLE "trial_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"value_hash" text NOT NULL,
	"tenant_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trial_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "trial_started_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "trial_source" text;
--> statement-breakpoint
ALTER TABLE "trial_claims" ADD CONSTRAINT "trial_claims_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trial_reminders" ADD CONSTRAINT "trial_reminders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "trial_claims_kind_hash_idx" ON "trial_claims" USING btree ("kind","value_hash");
--> statement-breakpoint
CREATE INDEX "trial_claims_tenant_idx" ON "trial_claims" USING btree ("tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "trial_reminders_tenant_kind_idx" ON "trial_reminders" USING btree ("tenant_id","kind");
