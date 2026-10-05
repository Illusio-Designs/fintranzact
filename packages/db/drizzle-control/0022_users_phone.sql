-- Mobile number given at sign-up (normalised digits): used for the one-trial-per-business check and account recovery. Idempotent.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phone" text;
