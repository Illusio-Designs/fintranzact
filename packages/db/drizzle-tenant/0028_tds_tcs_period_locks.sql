CREATE TABLE "financial_year_closes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"financial_year" text NOT NULL,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_by_user_id" uuid,
	"closed_by_name" text,
	"note" text,
	"snapshot" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "period_locks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"locked_through" date,
	"return_period" text,
	"note" text,
	"locked_by_user_id" uuid,
	"locked_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_challans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"financial_year" text NOT NULL,
	"quarter" integer NOT NULL,
	"challan_number" text NOT NULL,
	"bsr_code" text NOT NULL,
	"deposited_on" timestamp with time zone NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"interest" numeric(15, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_deductions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"direction" text NOT NULL,
	"party_id" uuid NOT NULL,
	"payment_id" uuid,
	"invoice_id" uuid,
	"section_code" text NOT NULL,
	"financial_year" text NOT NULL,
	"quarter" integer NOT NULL,
	"base_amount" numeric(15, 2) NOT NULL,
	"rate" numeric(6, 3) NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"has_pan" boolean DEFAULT true NOT NULL,
	"deducted_on" timestamp with time zone NOT NULL,
	"challan_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tds_section_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"financial_year" text NOT NULL,
	"section_code" text NOT NULL,
	"rate" numeric(6, 3),
	"individual_rate" numeric(6, 3),
	"rate_without_pan" numeric(6, 3),
	"single_threshold" numeric(15, 2),
	"aggregate_threshold" numeric(15, 2),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "tds_mode" text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "tds_section" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "tds_amount" numeric(15, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "tcs_mode" text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "tcs_amount" numeric(15, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "tcs_section" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "tds_amount" numeric(15, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "tds_section" text;--> statement-breakpoint
ALTER TABLE "financial_year_closes" ADD CONSTRAINT "financial_year_closes_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_locks" ADD CONSTRAINT "period_locks_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_challans" ADD CONSTRAINT "tax_challans_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_deductions" ADD CONSTRAINT "tax_deductions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_deductions" ADD CONSTRAINT "tax_deductions_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_deductions" ADD CONSTRAINT "tax_deductions_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_deductions" ADD CONSTRAINT "tax_deductions_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_deductions" ADD CONSTRAINT "tax_deductions_challan_id_tax_challans_id_fk" FOREIGN KEY ("challan_id") REFERENCES "public"."tax_challans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tds_section_settings" ADD CONSTRAINT "tds_section_settings_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "financial_year_closes_year_idx" ON "financial_year_closes" USING btree ("business_id","financial_year");--> statement-breakpoint
CREATE UNIQUE INDEX "period_locks_books_idx" ON "period_locks" USING btree ("business_id") WHERE "period_locks"."kind" = 'books';--> statement-breakpoint
CREATE UNIQUE INDEX "period_locks_gst_idx" ON "period_locks" USING btree ("business_id","return_period") WHERE "period_locks"."kind" = 'gst';--> statement-breakpoint
CREATE UNIQUE INDEX "tax_challans_cin_idx" ON "tax_challans" USING btree ("business_id","kind","bsr_code","challan_number","deposited_on");--> statement-breakpoint
CREATE INDEX "tax_challans_period_idx" ON "tax_challans" USING btree ("business_id","kind","financial_year","quarter");--> statement-breakpoint
CREATE INDEX "tax_deductions_period_idx" ON "tax_deductions" USING btree ("business_id","kind","direction","financial_year","quarter");--> statement-breakpoint
CREATE INDEX "tax_deductions_party_year_idx" ON "tax_deductions" USING btree ("business_id","party_id","financial_year","section_code");--> statement-breakpoint
CREATE INDEX "tax_deductions_payment_idx" ON "tax_deductions" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "tax_deductions_challan_idx" ON "tax_deductions" USING btree ("challan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tds_section_settings_year_code_idx" ON "tds_section_settings" USING btree ("business_id","financial_year","section_code");
--> statement-breakpoint
-- Existing businesses get the accounts the ledger now posts tax to: TDS Receivable
-- (TDS customers withhold) and TCS Payable (TCS collected on sales). New
-- businesses get them from the default chart of accounts.
INSERT INTO "chart_of_accounts" ("business_id", "code", "name", "account_type", "is_system", "is_active")
SELECT b."id", a."code", a."name", a."account_type"::"account_type", true, true
FROM "businesses" b
CROSS JOIN (VALUES ('1250', 'TDS Receivable', 'asset'), ('2210', 'TCS Payable', 'liability')) AS a("code", "name", "account_type")
WHERE NOT EXISTS (
	SELECT 1 FROM "chart_of_accounts" c WHERE c."business_id" = b."id" AND c."code" = a."code"
);
