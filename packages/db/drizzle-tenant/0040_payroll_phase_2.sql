CREATE TABLE "employee_tax_declarations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"financial_year" integer NOT NULL,
	"amounts" jsonb NOT NULL,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_statutory_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"paid_on" date NOT NULL,
	"challan_number" text,
	"challan_date" date,
	"reference" text,
	"bank_account_id" uuid,
	"journal_entry_id" uuid,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_statutory_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"financial_year" integer NOT NULL,
	"rates" jsonb NOT NULL,
	"verified_note" text,
	"verified_on" date,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "pf_applicable" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "pf_excluded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "eps_eligible" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "pf_on_actual_wages" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "vpf_percent" numeric(5, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "international_worker" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "pf_join_date" date;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "esi_applicable" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_run_lines" ADD COLUMN "statutory" jsonb;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "statutory" jsonb;--> statement-breakpoint
ALTER TABLE "payroll_settings" ADD COLUMN "pf_registered" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_settings" ADD COLUMN "pf_establishment_code" text;--> statement-breakpoint
ALTER TABLE "payroll_settings" ADD COLUMN "esi_registered" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_settings" ADD COLUMN "esi_code" text;--> statement-breakpoint
ALTER TABLE "payroll_settings" ADD COLUMN "pt_states" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_settings" ADD COLUMN "lwf_state" text;--> statement-breakpoint
ALTER TABLE "payroll_settings" ADD COLUMN "tds_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "employee_tax_declarations" ADD CONSTRAINT "employee_tax_declarations_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_tax_declarations" ADD CONSTRAINT "employee_tax_declarations_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_statutory_payments" ADD CONSTRAINT "payroll_statutory_payments_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_statutory_payments" ADD CONSTRAINT "payroll_statutory_payments_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_statutory_payments" ADD CONSTRAINT "payroll_statutory_payments_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_statutory_payments" ADD CONSTRAINT "payroll_statutory_payments_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_statutory_settings" ADD CONSTRAINT "payroll_statutory_settings_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "employee_tax_declarations_idx" ON "employee_tax_declarations" USING btree ("employee_id","financial_year");--> statement-breakpoint
CREATE INDEX "employee_tax_declarations_business_idx" ON "employee_tax_declarations" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "payroll_statutory_payments_run_idx" ON "payroll_statutory_payments" USING btree ("run_id","kind");--> statement-breakpoint
CREATE INDEX "payroll_statutory_payments_business_idx" ON "payroll_statutory_payments" USING btree ("business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_statutory_settings_year_idx" ON "payroll_statutory_settings" USING btree ("business_id","financial_year");