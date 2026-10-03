-- The three paid plans, from the "P1. Plans & pricing" item on the Upcoming
-- features board. There is no free plan.
--
--   Starter   Rs 299 a month   (Rs 2,990 a year)
--   Growth    Rs 699 a month   (Rs 6,990 a year), highlighted
--   Business  Rs 1,499 a month (Rs 14,990 a year)
--
-- Prices are in rupees, before 18% GST; a year is exactly ten months (two months free). pdfBranding is on for all three plans. A null
-- limit means unlimited. These are the same values as PLAN_DEFAULTS in
-- packages/shared/src/plans.ts, which a plan with no plan_settings row uses,
-- so seeding is optional: it only writes them down as editable rows.
--
-- Safe to run again: it overwrites these plans each time, so an admin's later
-- edits in the admin console are replaced.
-- Run with:  pnpm --filter @fintranzact/db db:seed:plans

INSERT INTO plan_settings (plan, name, tagline, monthly_price_inr, yearly_price_inr, features, highlight, visible, limits, updated_at)
VALUES
  (
    'starter', 'Starter', 'For a single business', 299, 2990,
    '["1 business and 3 users","Invoices, quotations, payments, parties and items","GST reports and e-way bills","Basic inventory, recurring invoices and POS"]'::jsonb,
    FALSE, TRUE,
    '{"maxOwnedOrgs":1,"maxBusinesses":1,"maxTeamMembers":3,"maxConcurrentSessions":3,"maxApiKeys":0,"auditRetentionDays":30,"dataExport":false,"onlineStore":false,"pdfBranding":true,"gstReports":true,"eWayBills":true,"recurringInvoices":true,"pos":true,"eInvoicing":false,"multiWarehouse":false,"batchesExpiry":false,"bankReconciliation":false,"manufacturing":false,"approvals":false,"prioritySupport":false,"onboardingHelp":false}'::jsonb,
    now()
  ),
  (
    'growth', 'Growth', 'Best for growing businesses', 699, 6990,
    '["3 businesses and 10 users","Everything in Starter","e-Invoicing","Multiple warehouses, batches and expiry","Bank reconciliation","Basic online store and API access","Data export"]'::jsonb,
    TRUE, TRUE,
    '{"maxOwnedOrgs":3,"maxBusinesses":3,"maxTeamMembers":10,"maxConcurrentSessions":10,"maxApiKeys":3,"auditRetentionDays":365,"dataExport":true,"onlineStore":true,"pdfBranding":true,"gstReports":true,"eWayBills":true,"recurringInvoices":true,"pos":true,"eInvoicing":true,"multiWarehouse":true,"batchesExpiry":true,"bankReconciliation":true,"manufacturing":false,"approvals":false,"prioritySupport":false,"onboardingHelp":false}'::jsonb,
    now()
  ),
  (
    'business', 'Business', 'Scale without limits', 1499, 14990,
    '["Unlimited businesses and users","Everything in Growth","Manufacturing and bill of materials","Approvals","Full audit history","Priority support and onboarding help"]'::jsonb,
    FALSE, TRUE,
    '{"maxOwnedOrgs":null,"maxBusinesses":null,"maxTeamMembers":null,"maxConcurrentSessions":null,"maxApiKeys":null,"auditRetentionDays":null,"dataExport":true,"onlineStore":true,"pdfBranding":true,"gstReports":true,"eWayBills":true,"recurringInvoices":true,"pos":true,"eInvoicing":true,"multiWarehouse":true,"batchesExpiry":true,"bankReconciliation":true,"manufacturing":true,"approvals":true,"prioritySupport":true,"onboardingHelp":true}'::jsonb,
    now()
  )
ON CONFLICT (plan) DO UPDATE SET
  name = EXCLUDED.name,
  tagline = EXCLUDED.tagline,
  monthly_price_inr = EXCLUDED.monthly_price_inr,
  yearly_price_inr = EXCLUDED.yearly_price_inr,
  features = EXCLUDED.features,
  highlight = EXCLUDED.highlight,
  visible = EXCLUDED.visible,
  limits = EXCLUDED.limits,
  updated_at = now();
