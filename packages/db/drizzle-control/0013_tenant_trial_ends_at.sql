-- Free-trial end per organisation; NULL = no trial. Past it with no live plan
-- subscription the organisation is read-only.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "trial_ends_at" timestamp with time zone;
