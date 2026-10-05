-- Mobile number given at sign-up (normalised digits): used for the one-trial-per-business check and account recovery.
ALTER TABLE "users" ADD COLUMN "phone" text;
