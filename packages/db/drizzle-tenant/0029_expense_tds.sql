ALTER TABLE "expenses" ADD COLUMN "party_id" uuid;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "tds_mode" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "tds_section" text;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "tds_amount" numeric(15, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "tax_deductions" ADD COLUMN "expense_id" uuid;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_deductions" ADD CONSTRAINT "tax_deductions_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tax_deductions_expense_idx" ON "tax_deductions" USING btree ("expense_id");