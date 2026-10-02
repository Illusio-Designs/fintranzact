-- Subscription billing (roadmap P3): what each organisation pays for.
-- billing_subscriptions mirrors a Razorpay (or demo) subscription per plan /
-- add-on; billing_payments holds every charge and doubles as the GST invoice
-- register from Finvera Solutions LLP; billing_events keeps webhook
-- deliveries idempotent and is the billing audit trail. Tenants gain the
-- billing details printed on those invoices.
DO $$ BEGIN
  CREATE TYPE "billing_subscription_kind" AS ENUM ('plan', 'addon');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "billing_subscription_status" AS ENUM ('created', 'active', 'past_due', 'halted', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "billing_cycle" AS ENUM ('monthly', 'yearly');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "billing_name" text;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "billing_gstin" text;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "billing_address" text;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "billing_email" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "kind" "billing_subscription_kind" NOT NULL,
  "plan" text,
  "addon" text,
  "cycle" "billing_cycle" NOT NULL,
  "status" "billing_subscription_status" DEFAULT 'created' NOT NULL,
  "provider" text DEFAULT 'demo' NOT NULL,
  "provider_subscription_id" text,
  "base_paise" integer NOT NULL,
  "current_period_start" timestamp with time zone,
  "current_period_end" timestamp with time zone,
  "cancel_at_period_end" boolean DEFAULT false NOT NULL,
  "scheduled_plan" text,
  "scheduled_cycle" "billing_cycle",
  "grace_until" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_subscriptions_tenant_idx" ON "billing_subscriptions" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_subscriptions_status_idx" ON "billing_subscriptions" ("status", "current_period_end");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_subscriptions_provider_idx" ON "billing_subscriptions" ("provider_subscription_id") WHERE "provider_subscription_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_subscriptions_live_plan_idx" ON "billing_subscriptions" ("tenant_id") WHERE "kind" = 'plan' AND "status" <> 'cancelled';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_subscriptions_live_addon_idx" ON "billing_subscriptions" ("tenant_id", "addon") WHERE "kind" = 'addon' AND "status" <> 'cancelled';
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS "billing_invoice_seq";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_payments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "invoice_seq" integer,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "subscription_id" uuid REFERENCES "billing_subscriptions"("id") ON DELETE SET NULL,
  "status" text DEFAULT 'captured' NOT NULL,
  "description" text NOT NULL,
  "base_paise" integer NOT NULL,
  "gst_paise" integer NOT NULL,
  "total_paise" integer NOT NULL,
  "method" text,
  "provider" text NOT NULL,
  "provider_payment_id" text,
  "provider_invoice_id" text,
  "period_start" timestamp with time zone,
  "period_end" timestamp with time zone,
  "billing_name" text,
  "billing_gstin" text,
  "billing_address" text,
  "failure_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_payments_tenant_idx" ON "billing_payments" ("tenant_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_payments_subscription_idx" ON "billing_payments" ("subscription_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "provider" text NOT NULL,
  "event_id" text,
  "type" text NOT NULL,
  "tenant_id" uuid REFERENCES "tenants"("id") ON DELETE SET NULL,
  "subscription_id" uuid REFERENCES "billing_subscriptions"("id") ON DELETE SET NULL,
  "payload" jsonb,
  "error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_events_event_idx" ON "billing_events" ("provider", "event_id") WHERE "event_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_events_tenant_idx" ON "billing_events" ("tenant_id", "created_at");
