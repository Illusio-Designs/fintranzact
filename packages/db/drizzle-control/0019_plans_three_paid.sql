-- Plans P1: three paid plans (starter, growth, business) replace forever_free / free / pro / business / enterprise.
--
-- Postgres cannot drop enum values, so the tenant_plan type is rebuilt: every column using it is
-- converted with a CASE mapping, the old type is dropped and the new one takes its name. All of it runs
-- in this one statement (one transaction) and is skipped when the type has already been rebuilt.
--
--   forever_free -> business + tenants.access_grandfathered = true (permanent full access; testing plan, removed)
--   free -> starter     pro -> growth     business -> business     enterprise -> business
--
-- Yearly prices are exactly ten months of the monthly price (two months free). pdfBranding is true on all three plans
-- (the small "Powered by Fintranzact" line on PDFs); an admin who changed it keeps their value.
-- Mirror of oldPlanToNew in packages/shared/src/plan-migration.ts. Rollback notes: docs/ROLLBACK.md.
-- Stored plan_settings: name, tagline, price, visibility and every limit an admin edited are kept; anything
-- still equal to the old built-in value becomes the new built-in value. Features text is reset (it is written
-- against the limits) unless an admin rewrote it. Plan prices become the published ones unless an admin changed them.
DO $mig$
DECLARE
  old_labels text[];
BEGIN
  ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "access_grandfathered" boolean DEFAULT false NOT NULL;
  ALTER TABLE "plan_settings" ADD COLUMN IF NOT EXISTS "yearly_price_inr" integer;

  SELECT array_agg(enumlabel::text) INTO old_labels
  FROM pg_enum WHERE enumtypid = to_regtype('public.tenant_plan');

  -- Already rebuilt (re-run, or a database created from the new schema): nothing to convert.
  IF old_labels IS NULL OR NOT (old_labels && ARRAY['forever_free', 'free', 'pro', 'enterprise']) THEN
    ALTER TABLE "tenants" ALTER COLUMN "plan" SET DEFAULT 'starter';
    RETURN;
  END IF;

  -- 1. Mark the Forever Free organisations BEFORE their plan changes.
  UPDATE "tenants" SET "access_grandfathered" = true WHERE "plan"::text = 'forever_free';

  -- 2. Free the columns from the old type.
  ALTER TABLE "tenants" ALTER COLUMN "plan" DROP DEFAULT;
  ALTER TABLE "tenants" ALTER COLUMN "plan" SET DATA TYPE text;
  ALTER TABLE "plan_settings" ALTER COLUMN "plan" SET DATA TYPE text;

  -- 3. Organisations and subscriptions (text columns).
  UPDATE "tenants" SET "plan" = CASE "plan"
    WHEN 'forever_free' THEN 'business'
    WHEN 'free' THEN 'starter'
    WHEN 'pro' THEN 'growth'
    WHEN 'enterprise' THEN 'business'
    ELSE "plan" END;
  UPDATE "billing_subscriptions" SET
    "plan" = CASE "plan" WHEN 'forever_free' THEN 'business' WHEN 'free' THEN 'starter' WHEN 'pro' THEN 'growth' WHEN 'enterprise' THEN 'business' ELSE "plan" END,
    "scheduled_plan" = CASE "scheduled_plan" WHEN 'forever_free' THEN 'business' WHEN 'free' THEN 'starter' WHEN 'pro' THEN 'growth' WHEN 'enterprise' THEN 'business' ELSE "scheduled_plan" END
  WHERE "plan" IN ('forever_free', 'free', 'pro', 'enterprise') OR "scheduled_plan" IN ('forever_free', 'free', 'pro', 'enterprise');

  -- 4. Stored plan settings: free -> starter, pro -> growth, business -> business; the rest are dropped.
  CREATE TEMP TABLE "_plan_settings_new" ON COMMIT DROP AS
  SELECT
    m.new_plan AS plan,
    CASE WHEN o.name IN ('Forever Free', 'Free (legacy)', 'Pro', 'Business', 'Enterprise') THEN m.new_name ELSE o.name END AS name,
    CASE WHEN o.tagline IN ('Unlimited for life', 'Older organisations', 'Best for growing teams', 'Scale without limits', 'For large organisations')
         THEN m.new_tagline ELSE o.tagline END AS tagline,
    CASE WHEN COALESCE(o.monthly_price_inr, 0) > 0 THEN o.monthly_price_inr ELSE m.new_monthly END AS monthly_price_inr,
    CASE WHEN COALESCE(o.monthly_price_inr, 0) > 0 AND o.monthly_price_inr <> m.new_monthly THEN NULL ELSE m.new_yearly END AS yearly_price_inr,
    CASE WHEN o.features IN (m.old_features_code, m.old_features_seed) THEN m.new_features ELSE o.features END AS features,
    (m.new_plan = 'growth') AS highlight,
    (o.visible OR o.plan = 'free') AS visible,
    -- recurringRunsPerMonth is gone: no plan caps how many invoices recurring templates make.
    (m.new_limits || COALESCE(
      (SELECT jsonb_object_agg(e.key, e.value) FROM jsonb_each(o.limits) e
       WHERE e.value IS DISTINCT FROM (m.old_limits -> e.key)),
      '{}'::jsonb)) - 'recurringRunsPerMonth' AS limits,
    o.updated_at,
    o.updated_by_user_id
  FROM "plan_settings" o
  JOIN (VALUES
    ('free', 'starter', 'Starter', 'For a single business', 299, 2990,
      '["1 business and 3 users","Invoices, quotations, payments, parties and items","GST reports and e-way bills","Basic inventory, recurring invoices and POS"]'::jsonb,
      '{"maxOwnedOrgs":1,"maxBusinesses":1,"maxTeamMembers":3,"maxConcurrentSessions":3,"maxApiKeys":0,"auditRetentionDays":30,"dataExport":false,"onlineStore":false,"pdfBranding":true,"gstReports":true,"eWayBills":true,"recurringInvoices":true,"pos":true,"eInvoicing":false,"multiWarehouse":false,"batchesExpiry":false,"bankReconciliation":false,"manufacturing":false,"approvals":false,"prioritySupport":false,"onboardingHelp":false}'::jsonb,
      '{"maxOwnedOrgs":1,"maxBusinesses":1,"maxTeamMembers":3,"maxConcurrentSessions":3,"maxApiKeys":0,"recurringRunsPerMonth":5,"auditRetentionDays":30,"dataExport":false,"onlineStore":false,"pdfBranding":true}'::jsonb,
      '["One business","Up to 3 team members"]'::jsonb,
      '["One business","Up to 3 team members"]'::jsonb),
    ('pro', 'growth', 'Growth', 'Best for growing businesses', 699, 6990,
      '["3 businesses and 10 users","Everything in Starter","e-Invoicing","Multiple warehouses, batches and expiry","Bank reconciliation","Basic online store and API access","Data export"]'::jsonb,
      '{"maxOwnedOrgs":3,"maxBusinesses":3,"maxTeamMembers":10,"maxConcurrentSessions":10,"maxApiKeys":3,"auditRetentionDays":365,"dataExport":true,"onlineStore":true,"pdfBranding":true,"gstReports":true,"eWayBills":true,"recurringInvoices":true,"pos":true,"eInvoicing":true,"multiWarehouse":true,"batchesExpiry":true,"bankReconciliation":true,"manufacturing":false,"approvals":false,"prioritySupport":false,"onboardingHelp":false}'::jsonb,
      '{"maxOwnedOrgs":3,"maxBusinesses":5,"maxTeamMembers":15,"maxConcurrentSessions":10,"maxApiKeys":3,"recurringRunsPerMonth":null,"auditRetentionDays":365,"dataExport":true,"onlineStore":true,"pdfBranding":false}'::jsonb,
      '["Advanced automation and workflows","Priority support","Expanded collaboration"]'::jsonb,
      '["Up to 5 businesses and 15 team members","e-Invoicing and e-way bills","Multiple warehouses, batches and expiry","Bank reconciliation","Online store and API access","Data export, no Fintranzact branding on documents"]'::jsonb),
    ('business', 'business', 'Business', 'Scale without limits', 1499, 14990,
      '["Unlimited businesses and users","Everything in Growth","Manufacturing and bill of materials","Full audit history","Priority support and onboarding help"]'::jsonb,
      '{"maxOwnedOrgs":null,"maxBusinesses":null,"maxTeamMembers":null,"maxConcurrentSessions":null,"maxApiKeys":null,"auditRetentionDays":null,"dataExport":true,"onlineStore":true,"pdfBranding":true,"gstReports":true,"eWayBills":true,"recurringInvoices":true,"pos":true,"eInvoicing":true,"multiWarehouse":true,"batchesExpiry":true,"bankReconciliation":true,"manufacturing":true,"approvals":true,"prioritySupport":true,"onboardingHelp":true}'::jsonb,
      '{"maxOwnedOrgs":null,"maxBusinesses":null,"maxTeamMembers":null,"maxConcurrentSessions":null,"maxApiKeys":null,"recurringRunsPerMonth":null,"auditRetentionDays":null,"dataExport":true,"onlineStore":true,"pdfBranding":false}'::jsonb,
      '["Multi-tenant controls","Premium reporting","Dedicated onboarding"]'::jsonb,
      '["Unlimited businesses and team members","Everything in Pro","Manufacturing and bill of materials","Full audit history","Priority support and onboarding help"]'::jsonb)
  ) AS m(old_plan, new_plan, new_name, new_tagline, new_monthly, new_yearly, new_features, new_limits, old_limits, old_features_code, old_features_seed)
    ON m.old_plan = o.plan;

  DELETE FROM "plan_settings";
  INSERT INTO "plan_settings" ("plan", "name", "tagline", "monthly_price_inr", "yearly_price_inr", "features", "highlight", "visible", "limits", "updated_at", "updated_by_user_id")
  SELECT plan, name, tagline, monthly_price_inr, yearly_price_inr, features, highlight, visible, limits, updated_at, updated_by_user_id
  FROM "_plan_settings_new";

  -- 5. Rebuild the type and put the columns back on it.
  ALTER TYPE "public"."tenant_plan" RENAME TO "tenant_plan_old";
  CREATE TYPE "public"."tenant_plan" AS ENUM ('starter', 'growth', 'business');
  ALTER TABLE "plan_settings" ALTER COLUMN "plan" SET DATA TYPE "public"."tenant_plan" USING "plan"::"public"."tenant_plan";
  ALTER TABLE "tenants" ALTER COLUMN "plan" SET DATA TYPE "public"."tenant_plan" USING "plan"::"public"."tenant_plan";
  ALTER TABLE "tenants" ALTER COLUMN "plan" SET DEFAULT 'starter';
  DROP TYPE "public"."tenant_plan_old";
END
$mig$;
