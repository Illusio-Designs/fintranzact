CREATE TABLE "attendance_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"date" date NOT NULL,
	"status" text NOT NULL,
	"leave_type_id" uuid,
	"check_in" text,
	"check_out" text,
	"overtime_hours" numeric(5, 2) DEFAULT '0' NOT NULL,
	"note" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"marked_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_salary_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"template_id" uuid,
	"annual_ctc" numeric(15, 2) NOT NULL,
	"monthly_ctc" numeric(15, 2) NOT NULL,
	"effective_from" date NOT NULL,
	"breakdown" jsonb NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"employee_code" text NOT NULL,
	"name" text NOT NULL,
	"date_of_birth" date,
	"gender" text,
	"father_or_spouse_name" text,
	"address" text,
	"phone" text,
	"email" text,
	"photo_data_url" text,
	"pan" text,
	"aadhaar" text,
	"uan" text,
	"esic_number" text,
	"date_of_joining" date NOT NULL,
	"department_id" uuid,
	"designation_id" uuid,
	"branch" text,
	"work_state" text,
	"manager_id" uuid,
	"shift_id" uuid,
	"employment_type" text DEFAULT 'permanent' NOT NULL,
	"tax_regime" text DEFAULT 'new' NOT NULL,
	"bank_account_number" text,
	"bank_ifsc" text,
	"bank_account_name" text,
	"bank_name" text,
	"status" text DEFAULT 'active' NOT NULL,
	"last_working_day" date,
	"exit_reason" text,
	"exit_note" text,
	"fnf_note" text,
	"fnf_payroll_run_id" uuid,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"half_day_start" boolean DEFAULT false NOT NULL,
	"half_day_end" boolean DEFAULT false NOT NULL,
	"days" numeric(6, 2) NOT NULL,
	"paid_days" numeric(6, 2) DEFAULT '0' NOT NULL,
	"lop_days" numeric(6, 2) DEFAULT '0' NOT NULL,
	"reason" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by_user_id" uuid,
	"decided_by_name" text,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_encashments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"days" numeric(6, 2) NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"note" text,
	"payroll_run_id" uuid,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"leave_year" integer NOT NULL,
	"entry_date" date NOT NULL,
	"kind" text NOT NULL,
	"days" numeric(6, 2) NOT NULL,
	"period_key" text,
	"application_id" uuid,
	"note" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_paid" boolean DEFAULT true NOT NULL,
	"accrual_type" text DEFAULT 'none' NOT NULL,
	"accrual_days" numeric(6, 2) DEFAULT '0' NOT NULL,
	"carry_forward" boolean DEFAULT false NOT NULL,
	"carry_forward_max" numeric(6, 2) DEFAULT '0' NOT NULL,
	"encashable" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_designations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"scope" text DEFAULT 'national' NOT NULL,
	"state_code" text,
	"branch" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_run_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"note" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_run_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"employee_code" text NOT NULL,
	"employee_name" text NOT NULL,
	"department" text,
	"designation" text,
	"days_in_month" integer NOT NULL,
	"employed_days" integer NOT NULL,
	"paid_days" numeric(5, 1) NOT NULL,
	"lop_days" numeric(5, 1) NOT NULL,
	"overtime_hours" numeric(6, 2) DEFAULT '0' NOT NULL,
	"components" jsonb NOT NULL,
	"gross_earnings" numeric(15, 2) NOT NULL,
	"total_deductions" numeric(15, 2) NOT NULL,
	"employer_contributions" numeric(15, 2) DEFAULT '0' NOT NULL,
	"net_pay" numeric(15, 2) NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_final_settlement" boolean DEFAULT false NOT NULL,
	"bank_account_number" text,
	"bank_ifsc" text,
	"bank_account_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"month" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"days_in_month" integer NOT NULL,
	"employee_count" integer DEFAULT 0 NOT NULL,
	"gross_total" numeric(15, 2) DEFAULT '0' NOT NULL,
	"deductions_total" numeric(15, 2) DEFAULT '0' NOT NULL,
	"employer_total" numeric(15, 2) DEFAULT '0' NOT NULL,
	"net_total" numeric(15, 2) DEFAULT '0' NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"attendance_locked_at" timestamp with time zone,
	"attendance_locked_by_user_id" uuid,
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
CREATE TABLE "payroll_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"default_weekly_off_days" jsonb DEFAULT '[0]'::jsonb NOT NULL,
	"standard_hours_per_day" numeric(4, 2) DEFAULT '8' NOT NULL,
	"overtime_multiplier" numeric(4, 2) DEFAULT '2' NOT NULL,
	"leave_year_start_month" integer DEFAULT 4 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"name" text NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"weekly_off_days" jsonb DEFAULT '[0]'::jsonb NOT NULL,
	"standard_hours" numeric(4, 2) DEFAULT '8' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payslips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"month" text NOT NULL,
	"number" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"emailed_at" timestamp with time zone,
	"emailed_to" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "salary_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"category" text NOT NULL,
	"prorate" boolean DEFAULT true NOT NULL,
	"is_wage" boolean DEFAULT false NOT NULL,
	"statutory_kind" text,
	"sort_order" integer DEFAULT 100 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "salary_template_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"component_id" uuid NOT NULL,
	"calc_type" text NOT NULL,
	"value" numeric(15, 2) DEFAULT '0' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "salary_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"sample_annual_ctc" numeric(15, 2) DEFAULT '0' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_salary_assignments" ADD CONSTRAINT "employee_salary_assignments_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_salary_assignments" ADD CONSTRAINT "employee_salary_assignments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_salary_assignments" ADD CONSTRAINT "employee_salary_assignments_template_id_salary_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."salary_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_department_id_payroll_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."payroll_departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_designation_id_payroll_designations_id_fk" FOREIGN KEY ("designation_id") REFERENCES "public"."payroll_designations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_manager_id_employees_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_shift_id_payroll_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."payroll_shifts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_applications" ADD CONSTRAINT "leave_applications_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_applications" ADD CONSTRAINT "leave_applications_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_applications" ADD CONSTRAINT "leave_applications_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_encashments" ADD CONSTRAINT "leave_encashments_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_encashments" ADD CONSTRAINT "leave_encashments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_encashments" ADD CONSTRAINT "leave_encashments_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_ledger" ADD CONSTRAINT "leave_ledger_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_ledger" ADD CONSTRAINT "leave_ledger_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_ledger" ADD CONSTRAINT "leave_ledger_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_departments" ADD CONSTRAINT "payroll_departments_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_designations" ADD CONSTRAINT "payroll_designations_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_holidays" ADD CONSTRAINT "payroll_holidays_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run_adjustments" ADD CONSTRAINT "payroll_run_adjustments_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run_adjustments" ADD CONSTRAINT "payroll_run_adjustments_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run_adjustments" ADD CONSTRAINT "payroll_run_adjustments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run_lines" ADD CONSTRAINT "payroll_run_lines_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run_lines" ADD CONSTRAINT "payroll_run_lines_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_run_lines" ADD CONSTRAINT "payroll_run_lines_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_accrual_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("accrual_journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_paid_from_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("paid_from_bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_payment_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("payment_journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_settings" ADD CONSTRAINT "payroll_settings_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_shifts" ADD CONSTRAINT "payroll_shifts_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_line_id_payroll_run_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."payroll_run_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_components" ADD CONSTRAINT "salary_components_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_template_lines" ADD CONSTRAINT "salary_template_lines_template_id_salary_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."salary_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_template_lines" ADD CONSTRAINT "salary_template_lines_component_id_salary_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."salary_components"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_templates" ADD CONSTRAINT "salary_templates_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_records_day_idx" ON "attendance_records" USING btree ("employee_id","date");--> statement-breakpoint
CREATE INDEX "attendance_records_business_date_idx" ON "attendance_records" USING btree ("business_id","date");--> statement-breakpoint
CREATE INDEX "employee_salary_assignments_employee_idx" ON "employee_salary_assignments" USING btree ("employee_id","effective_from");--> statement-breakpoint
CREATE INDEX "employee_salary_assignments_business_idx" ON "employee_salary_assignments" USING btree ("business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_code_idx" ON "employees" USING btree ("business_id","employee_code");--> statement-breakpoint
CREATE INDEX "employees_business_status_idx" ON "employees" USING btree ("business_id","status");--> statement-breakpoint
CREATE INDEX "employees_department_idx" ON "employees" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "leave_applications_business_idx" ON "leave_applications" USING btree ("business_id","status");--> statement-breakpoint
CREATE INDEX "leave_applications_employee_idx" ON "leave_applications" USING btree ("employee_id","from_date");--> statement-breakpoint
CREATE INDEX "leave_encashments_employee_idx" ON "leave_encashments" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "leave_encashments_run_idx" ON "leave_encashments" USING btree ("payroll_run_id");--> statement-breakpoint
CREATE INDEX "leave_ledger_employee_idx" ON "leave_ledger" USING btree ("employee_id","leave_type_id","leave_year");--> statement-breakpoint
CREATE UNIQUE INDEX "leave_ledger_period_idx" ON "leave_ledger" USING btree ("employee_id","leave_type_id","kind","period_key") WHERE "leave_ledger"."period_key" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "leave_types_code_idx" ON "leave_types" USING btree ("business_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_departments_name_idx" ON "payroll_departments" USING btree ("business_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_designations_name_idx" ON "payroll_designations" USING btree ("business_id","name");--> statement-breakpoint
CREATE INDEX "payroll_holidays_business_date_idx" ON "payroll_holidays" USING btree ("business_id","date");--> statement-breakpoint
CREATE INDEX "payroll_run_adjustments_run_idx" ON "payroll_run_adjustments" USING btree ("run_id","employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_run_lines_employee_idx" ON "payroll_run_lines" USING btree ("run_id","employee_id");--> statement-breakpoint
CREATE INDEX "payroll_run_lines_business_idx" ON "payroll_run_lines" USING btree ("business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_runs_month_idx" ON "payroll_runs" USING btree ("business_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_settings_business_idx" ON "payroll_settings" USING btree ("business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_shifts_name_idx" ON "payroll_shifts" USING btree ("business_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "payslips_run_employee_idx" ON "payslips" USING btree ("run_id","employee_id");--> statement-breakpoint
CREATE INDEX "payslips_business_idx" ON "payslips" USING btree ("business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "salary_components_code_idx" ON "salary_components" USING btree ("business_id","code");--> statement-breakpoint
CREATE INDEX "salary_template_lines_template_idx" ON "salary_template_lines" USING btree ("template_id");--> statement-breakpoint
CREATE UNIQUE INDEX "salary_template_lines_component_idx" ON "salary_template_lines" USING btree ("template_id","component_id");--> statement-breakpoint
CREATE UNIQUE INDEX "salary_templates_name_idx" ON "salary_templates" USING btree ("business_id","name");