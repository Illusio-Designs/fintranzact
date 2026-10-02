ALTER TABLE "composition_settings" ADD COLUMN "gstr4_due_date" date;--> statement-breakpoint
ALTER TABLE "composition_settings" ADD COLUMN "interest_rate" numeric(6, 3);--> statement-breakpoint
ALTER TABLE "composition_settings" ADD COLUMN "late_fee_per_day" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "composition_settings" ADD COLUMN "late_fee_cap" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "composition_settings" ADD COLUMN "late_fee_nil_per_day" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "composition_settings" ADD COLUMN "late_fee_nil_cap" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "composition_settings" ADD COLUMN "cmp08_due_day" integer;