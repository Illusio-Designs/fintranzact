CREATE TABLE "tds_26as_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"import_batch_id" uuid NOT NULL,
	"financial_year" text NOT NULL,
	"quarter" integer NOT NULL,
	"deductor_tan" text NOT NULL,
	"deductor_name" text,
	"section" text NOT NULL,
	"txn_date" timestamp with time zone NOT NULL,
	"amount_paid" numeric(15, 2) DEFAULT '0' NOT NULL,
	"tax_deducted" numeric(15, 2) NOT NULL,
	"tax_deposited" numeric(15, 2),
	"party_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tds_26as_entries" ADD CONSTRAINT "tds_26as_entries_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tds_26as_entries" ADD CONSTRAINT "tds_26as_entries_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tds_26as_entries_year_idx" ON "tds_26as_entries" USING btree ("business_id","financial_year","quarter");--> statement-breakpoint
CREATE INDEX "tds_26as_entries_tan_idx" ON "tds_26as_entries" USING btree ("business_id","deductor_tan");