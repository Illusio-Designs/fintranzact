CREATE TABLE "bonus_run_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"employee_code" text NOT NULL,
	"employee_name" text NOT NULL,
	"eligible" boolean NOT NULL,
	"reason" text NOT NULL,
	"reason_text" text NOT NULL,
	"months_paid" integer NOT NULL,
	"days_paid" numeric(7, 1) NOT NULL,
	"eligibility_wage" numeric(15, 2) NOT NULL,
	"wages" numeric(15, 2) NOT NULL,
	"calculation_wages" numeric(15, 2) NOT NULL,
	"percent" numeric(5, 2) NOT NULL,
	"bonus" numeric(15, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bonus_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"financial_year" integer NOT NULL,
	"number" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"percent" numeric(5, 2) NOT NULL,
	"note" text,
	"employee_count" integer DEFAULT 0 NOT NULL,
	"eligible_count" integer DEFAULT 0 NOT NULL,
	"total_bonus" numeric(15, 2) DEFAULT '0' NOT NULL,
	"rules" jsonb,
	"exclusions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"calculated_at" timestamp with time zone,
	"calculated_by_user_id" uuid,
	"calculated_by_name" text,
	"submitted_at" timestamp with time zone,
	"submitted_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"approved_by_user_id" uuid,
	"approved_by_name" text,
	"posted_at" timestamp with time zone,
	"posted_by_user_id" uuid,
	"accrual_journal_entry_id" uuid,
	"paid_at" timestamp with time zone,
	"paid_on" date,
	"paid_by_user_id" uuid,
	"paid_from_bank_account_id" uuid,
	"paid_reference" text,
	"payment_journal_entry_id" uuid,
	"created_by_user_id" uuid,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_loan_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loan_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"event_date" date NOT NULL,
	"principal" numeric(15, 2) DEFAULT '0' NOT NULL,
	"interest" numeric(15, 2) DEFAULT '0' NOT NULL,
	"balance_after" numeric(15, 2) NOT NULL,
	"run_id" uuid,
	"settlement_id" uuid,
	"journal_entry_id" uuid,
	"bank_account_id" uuid,
	"note" text,
	"created_by_user_id" uuid,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_loan_installments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"loan_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"due_month" text NOT NULL,
	"principal" numeric(15, 2) NOT NULL,
	"interest" numeric(15, 2) NOT NULL,
	"paid_principal" numeric(15, 2) DEFAULT '0' NOT NULL,
	"paid_interest" numeric(15, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_loans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"number" text NOT NULL,
	"kind" text DEFAULT 'loan' NOT NULL,
	"status" text DEFAULT 'pending_approval' NOT NULL,
	"principal" numeric(15, 2) NOT NULL,
	"interest_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"installment_count" integer NOT NULL,
	"emi" numeric(15, 2) NOT NULL,
	"start_month" text NOT NULL,
	"issue_date" date NOT NULL,
	"purpose" text,
	"requested_by_user_id" uuid,
	"requested_by_name" text,
	"approved_at" timestamp with time zone,
	"approved_by_user_id" uuid,
	"approved_by_name" text,
	"decision_note" text,
	"disbursed_at" timestamp with time zone,
	"disbursed_on" date,
	"disbursed_by_user_id" uuid,
	"disbursed_from_bank_account_id" uuid,
	"disbursement_reference" text,
	"disbursement_journal_entry_id" uuid,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fnf_settlement_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"settlement_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"side" text NOT NULL,
	"label" text NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"ref" text,
	"detail" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fnf_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"number" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"last_working_day" date NOT NULL,
	"exit_reason" text,
	"encashment_basis" text DEFAULT 'basic_da_26' NOT NULL,
	"inputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"note" text,
	"gross_total" numeric(15, 2) DEFAULT '0' NOT NULL,
	"deductions_total" numeric(15, 2) DEFAULT '0' NOT NULL,
	"loan_recovered" numeric(15, 2) DEFAULT '0' NOT NULL,
	"net_payable" numeric(15, 2) DEFAULT '0' NOT NULL,
	"salary_month" text,
	"salary_run_id" uuid,
	"gratuity" jsonb,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"calculated_at" timestamp with time zone,
	"calculated_by_user_id" uuid,
	"calculated_by_name" text,
	"submitted_at" timestamp with time zone,
	"submitted_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"approved_by_user_id" uuid,
	"approved_by_name" text,
	"posted_at" timestamp with time zone,
	"posted_by_user_id" uuid,
	"accrual_journal_entry_id" uuid,
	"paid_at" timestamp with time zone,
	"paid_on" date,
	"paid_by_user_id" uuid,
	"paid_from_bank_account_id" uuid,
	"paid_reference" text,
	"payment_journal_entry_id" uuid,
	"created_by_user_id" uuid,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gratuity_provisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"as_of" date NOT NULL,
	"liability" numeric(15, 2) NOT NULL,
	"previous_balance" numeric(15, 2) NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"employee_count" integer DEFAULT 0 NOT NULL,
	"note" text,
	"journal_entry_id" uuid,
	"created_by_user_id" uuid,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_letter_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"kind" text DEFAULT 'relieving' NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"signatory_name" text,
	"signatory_title" text,
	"place" text,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payroll_settings" ADD COLUMN "loan_max_deduction_percent" numeric(5, 2) DEFAULT '50' NOT NULL;--> statement-breakpoint
ALTER TABLE "bonus_run_lines" ADD CONSTRAINT "bonus_run_lines_run_id_bonus_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."bonus_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonus_run_lines" ADD CONSTRAINT "bonus_run_lines_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonus_run_lines" ADD CONSTRAINT "bonus_run_lines_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonus_runs" ADD CONSTRAINT "bonus_runs_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonus_runs" ADD CONSTRAINT "bonus_runs_accrual_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("accrual_journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonus_runs" ADD CONSTRAINT "bonus_runs_paid_from_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("paid_from_bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonus_runs" ADD CONSTRAINT "bonus_runs_payment_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("payment_journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_loan_events" ADD CONSTRAINT "employee_loan_events_loan_id_employee_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."employee_loans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_loan_events" ADD CONSTRAINT "employee_loan_events_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_loan_events" ADD CONSTRAINT "employee_loan_events_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_loan_events" ADD CONSTRAINT "employee_loan_events_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_loan_events" ADD CONSTRAINT "employee_loan_events_settlement_id_fnf_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."fnf_settlements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_loan_events" ADD CONSTRAINT "employee_loan_events_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_loan_events" ADD CONSTRAINT "employee_loan_events_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_loan_installments" ADD CONSTRAINT "employee_loan_installments_loan_id_employee_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."employee_loans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_loan_installments" ADD CONSTRAINT "employee_loan_installments_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_loans" ADD CONSTRAINT "employee_loans_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_loans" ADD CONSTRAINT "employee_loans_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_loans" ADD CONSTRAINT "employee_loans_disbursed_from_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("disbursed_from_bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_loans" ADD CONSTRAINT "employee_loans_disbursement_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("disbursement_journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fnf_settlement_lines" ADD CONSTRAINT "fnf_settlement_lines_settlement_id_fnf_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."fnf_settlements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fnf_settlement_lines" ADD CONSTRAINT "fnf_settlement_lines_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fnf_settlements" ADD CONSTRAINT "fnf_settlements_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fnf_settlements" ADD CONSTRAINT "fnf_settlements_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fnf_settlements" ADD CONSTRAINT "fnf_settlements_salary_run_id_payroll_runs_id_fk" FOREIGN KEY ("salary_run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fnf_settlements" ADD CONSTRAINT "fnf_settlements_accrual_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("accrual_journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fnf_settlements" ADD CONSTRAINT "fnf_settlements_paid_from_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("paid_from_bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fnf_settlements" ADD CONSTRAINT "fnf_settlements_payment_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("payment_journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gratuity_provisions" ADD CONSTRAINT "gratuity_provisions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gratuity_provisions" ADD CONSTRAINT "gratuity_provisions_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_letter_templates" ADD CONSTRAINT "payroll_letter_templates_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bonus_run_lines_employee_idx" ON "bonus_run_lines" USING btree ("run_id","employee_id");--> statement-breakpoint
CREATE INDEX "bonus_run_lines_business_idx" ON "bonus_run_lines" USING btree ("business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bonus_runs_year_idx" ON "bonus_runs" USING btree ("business_id","financial_year");--> statement-breakpoint
CREATE UNIQUE INDEX "bonus_runs_number_idx" ON "bonus_runs" USING btree ("business_id","number");--> statement-breakpoint
CREATE INDEX "employee_loan_events_loan_idx" ON "employee_loan_events" USING btree ("loan_id","created_at");--> statement-breakpoint
CREATE INDEX "employee_loan_events_business_idx" ON "employee_loan_events" USING btree ("business_id","event_date");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_loan_events_run_idx" ON "employee_loan_events" USING btree ("loan_id","run_id") WHERE "employee_loan_events"."kind" = 'emi_recovered';--> statement-breakpoint
CREATE UNIQUE INDEX "employee_loan_events_fnf_idx" ON "employee_loan_events" USING btree ("loan_id","settlement_id") WHERE "employee_loan_events"."kind" = 'fnf_recovered';--> statement-breakpoint
CREATE UNIQUE INDEX "employee_loan_installments_seq_idx" ON "employee_loan_installments" USING btree ("loan_id","seq");--> statement-breakpoint
CREATE INDEX "employee_loan_installments_due_idx" ON "employee_loan_installments" USING btree ("business_id","due_month","status");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_loans_number_idx" ON "employee_loans" USING btree ("business_id","number");--> statement-breakpoint
CREATE INDEX "employee_loans_employee_idx" ON "employee_loans" USING btree ("employee_id","status");--> statement-breakpoint
CREATE INDEX "fnf_settlement_lines_settlement_idx" ON "fnf_settlement_lines" USING btree ("settlement_id","sort_order");--> statement-breakpoint
CREATE INDEX "fnf_settlement_lines_business_idx" ON "fnf_settlement_lines" USING btree ("business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fnf_settlements_employee_idx" ON "fnf_settlements" USING btree ("business_id","employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fnf_settlements_number_idx" ON "fnf_settlements" USING btree ("business_id","number");--> statement-breakpoint
CREATE INDEX "gratuity_provisions_business_idx" ON "gratuity_provisions" USING btree ("business_id","as_of");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_letter_templates_kind_idx" ON "payroll_letter_templates" USING btree ("business_id","kind");