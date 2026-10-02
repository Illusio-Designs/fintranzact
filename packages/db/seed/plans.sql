-- Plan prices and features, from the "P1. Plans & pricing" item on the
-- Upcoming features board, applied to the plans that exist today.
--
--   Pro        Rs 699 a month  (the board's "Growth" plan)
--   Business   Rs 1,499 a month
--
-- Prices are in rupees, before 18% GST. Forever Free is left as it is. The
-- limits below are the ones already enforced for each plan (packages/shared
-- plans.ts), so seeding changes what is shown and sold, not what is allowed.
-- A null limit means unlimited.
--
-- Safe to run again: it overwrites these two plans each time, so an admin's
-- later edits to Pro or Business in the admin console are replaced.
-- Run with:  pnpm --filter @fintranzact/db db:seed:plans

INSERT INTO plan_settings (plan, name, tagline, monthly_price_inr, features, highlight, visible, limits, updated_at)
VALUES
  (
    'pro', 'Pro', 'Best for growing teams', 699,
    '["Up to 5 businesses and 15 team members","e-Invoicing and e-way bills","Multiple warehouses, batches and expiry","Bank reconciliation","Online store and API access","Data export, no Fintranzact branding on documents"]'::jsonb,
    FALSE, TRUE,
    '{"maxOwnedOrgs":3,"maxBusinesses":5,"maxTeamMembers":15,"maxConcurrentSessions":10,"maxApiKeys":3,"recurringRunsPerMonth":null,"auditRetentionDays":365,"dataExport":true,"onlineStore":true,"pdfBranding":false}'::jsonb,
    now()
  ),
  (
    'business', 'Business', 'Scale without limits', 1499,
    '["Unlimited businesses and team members","Everything in Pro","Manufacturing and bill of materials","Full audit history","Priority support and onboarding help"]'::jsonb,
    FALSE, TRUE,
    '{"maxOwnedOrgs":null,"maxBusinesses":null,"maxTeamMembers":null,"maxConcurrentSessions":null,"maxApiKeys":null,"recurringRunsPerMonth":null,"auditRetentionDays":null,"dataExport":true,"onlineStore":true,"pdfBranding":false}'::jsonb,
    now()
  )
ON CONFLICT (plan) DO UPDATE SET
  name = EXCLUDED.name,
  tagline = EXCLUDED.tagline,
  monthly_price_inr = EXCLUDED.monthly_price_inr,
  features = EXCLUDED.features,
  highlight = EXCLUDED.highlight,
  visible = EXCLUDED.visible,
  limits = EXCLUDED.limits,
  updated_at = now();
