-- Load the Pro and Business plan prices and features (seed/plans.sql) once,
-- so a new server sells the board's prices without a manual seed. A plan a
-- platform admin has already saved is left alone.
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
ON CONFLICT (plan) DO NOTHING;
