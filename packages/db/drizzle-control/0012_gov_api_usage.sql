-- Government API usage metering (Sandbox.co.in): one row per chargeable
-- document sent to NIC/GSTN, billed per document after the month ends, plus a
-- deployment-wide monthly call counter for quota alerts.
CREATE TABLE IF NOT EXISTS "gov_api_usage" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "business_id" uuid,
  "gstin" text,
  "kind" text NOT NULL,
  "reference" text NOT NULL,
  "rate_paise" integer NOT NULL,
  "period" text NOT NULL,
  "statement_payment_id" uuid REFERENCES "billing_payments"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "gov_api_usage_doc_idx" ON "gov_api_usage" ("tenant_id", "kind", "reference");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gov_api_usage_period_idx" ON "gov_api_usage" ("tenant_id", "period");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sandbox_call_counters" (
  "period" text PRIMARY KEY NOT NULL,
  "calls" integer DEFAULT 0 NOT NULL,
  "alerted_percent" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
