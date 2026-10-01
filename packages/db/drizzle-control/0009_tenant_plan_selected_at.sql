-- Records when an organisation's owner actually chose a plan. Existing rows and
-- every insert path that does not set it (seeds, platform-admin orgs) count as
-- already chosen via the default; self sign-up inserts NULL so the owner is
-- sent to the plan page first.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "plan_selected_at" timestamp with time zone DEFAULT now();
