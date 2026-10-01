-- Repairs databases that skipped earlier migrations. Every statement is
-- idempotent, so it is a no-op where the objects already exist.
--
-- 0020_add_user_referral_code was journaled with a 2023 timestamp, older
-- than 0019. The migrator only applies entries newer than the last one it
-- ran, so a database already past 0019 never got users.referral_code and
-- sign-up (which writes that column) failed with a 500.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referral_code" text;--> statement-breakpoint
-- access_tokens exists in the control migrations but never had a unified one.
CREATE TABLE IF NOT EXISTS "access_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "access_tokens" ADD CONSTRAINT "access_tokens_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "access_tokens_session_idx" ON "access_tokens" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "access_tokens_expires_idx" ON "access_tokens" USING btree ("expires_at");
