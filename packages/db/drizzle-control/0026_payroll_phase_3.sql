ALTER TYPE "public"."member_role" ADD VALUE 'hr';--> statement-breakpoint
ALTER TYPE "public"."member_role" ADD VALUE 'employee';--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "employee_id" uuid;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "business_id" uuid;