CREATE TABLE "partner_payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"period" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reference" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	"created_by_user_id" uuid
);
--> statement-breakpoint
CREATE TABLE "partners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_name" text NOT NULL,
	"company_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"city" text NOT NULL,
	"state" text,
	"website" text,
	"partner_type" text NOT NULL,
	"client_count" text,
	"message" text,
	"list_publicly" boolean DEFAULT false NOT NULL,
	"referral_code" text,
	"commission_percent" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"admin_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by_user_id" uuid
);
--> statement-breakpoint
CREATE TABLE "plan_settings" (
	"plan" "tenant_plan" PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"tagline" text NOT NULL,
	"monthly_price_inr" integer,
	"features" jsonb NOT NULL,
	"highlight" boolean DEFAULT false NOT NULL,
	"visible" boolean DEFAULT true NOT NULL,
	"limits" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_user_id" uuid
);
--> statement-breakpoint
ALTER TABLE "magic_link_tokens" ADD COLUMN "referral_code" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "partner_id" uuid;--> statement-breakpoint
ALTER TABLE "partner_payouts" ADD CONSTRAINT "partner_payouts_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_payouts" ADD CONSTRAINT "partner_payouts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_settings" ADD CONSTRAINT "plan_settings_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "partner_payouts_period_idx" ON "partner_payouts" USING btree ("partner_id","period");--> statement-breakpoint
CREATE INDEX "partners_status_idx" ON "partners" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "partners_email_idx" ON "partners" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "partners_referral_code_idx" ON "partners" USING btree ("referral_code");--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE set null ON UPDATE no action;