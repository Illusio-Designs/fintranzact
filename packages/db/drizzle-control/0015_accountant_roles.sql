-- Accountant access roles: 'auditor' (read-only) and 'ca_filing' (filing only).
-- Only adds enum values: they must not be used in this same migration run.
ALTER TYPE "public"."member_role" ADD VALUE IF NOT EXISTS 'auditor';--> statement-breakpoint
ALTER TYPE "public"."member_role" ADD VALUE IF NOT EXISTS 'ca_filing';
