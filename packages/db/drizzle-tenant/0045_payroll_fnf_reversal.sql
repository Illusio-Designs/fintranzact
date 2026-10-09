DROP INDEX "fnf_settlements_employee_idx";--> statement-breakpoint
ALTER TABLE "fnf_settlements" ADD COLUMN "payment_reversed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fnf_settlements" ADD COLUMN "payment_reversed_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "fnf_settlements" ADD COLUMN "payment_reversal_reason" text;--> statement-breakpoint
ALTER TABLE "fnf_settlements" ADD COLUMN "payment_reversal_journal_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "fnf_settlements" ADD COLUMN "reversed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fnf_settlements" ADD COLUMN "reversed_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "fnf_settlements" ADD COLUMN "reversed_by_name" text;--> statement-breakpoint
ALTER TABLE "fnf_settlements" ADD COLUMN "reversal_reason" text;--> statement-breakpoint
ALTER TABLE "fnf_settlements" ADD COLUMN "reversal_journal_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "fnf_settlements" ADD CONSTRAINT "fnf_settlements_payment_reversal_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("payment_reversal_journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fnf_settlements" ADD CONSTRAINT "fnf_settlements_reversal_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("reversal_journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "employee_loan_events_fnf_reversed_idx" ON "employee_loan_events" USING btree ("loan_id","settlement_id") WHERE "employee_loan_events"."kind" = 'fnf_reversed';--> statement-breakpoint
CREATE UNIQUE INDEX "fnf_settlements_employee_idx" ON "fnf_settlements" USING btree ("business_id","employee_id") WHERE "fnf_settlements"."status" <> 'reversed';