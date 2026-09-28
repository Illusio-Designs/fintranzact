ALTER TYPE "public"."tenant_plan" ADD VALUE 'forever_free' BEFORE 'free';--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "referral_code" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "referral_code" text;