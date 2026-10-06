CREATE TABLE "invoice_payment_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"razorpay_link_id" text NOT NULL,
	"short_url" text NOT NULL,
	"amount_paise" integer NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "razorpay_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"key_id_encrypted" text NOT NULL,
	"key_secret_encrypted" text NOT NULL,
	"webhook_secret_encrypted" text,
	"key_id_masked" text NOT NULL,
	"mode" text NOT NULL,
	"webhook_token_hash" text NOT NULL,
	"webhook_token_encrypted" text NOT NULL,
	"last_tested_at" timestamp with time zone,
	"last_test_ok" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "razorpay_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"razorpay_payment_id" text NOT NULL,
	"payment_id" uuid,
	"invoice_id" uuid,
	"razorpay_link_id" text,
	"amount_paise" integer NOT NULL,
	"fee_paise" integer,
	"tax_paise" integer,
	"method" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoice_payment_links" ADD CONSTRAINT "invoice_payment_links_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payment_links" ADD CONSTRAINT "invoice_payment_links_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "razorpay_connections" ADD CONSTRAINT "razorpay_connections_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "razorpay_payments" ADD CONSTRAINT "razorpay_payments_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "razorpay_payments" ADD CONSTRAINT "razorpay_payments_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "razorpay_payments" ADD CONSTRAINT "razorpay_payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inv_pay_link_rzp_idx" ON "invoice_payment_links" USING btree ("business_id","razorpay_link_id");--> statement-breakpoint
CREATE INDEX "inv_pay_link_invoice_idx" ON "invoice_payment_links" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inv_pay_link_active_idx" ON "invoice_payment_links" USING btree ("invoice_id") WHERE status IN ('created', 'partially_paid');--> statement-breakpoint
CREATE UNIQUE INDEX "razorpay_conn_business_idx" ON "razorpay_connections" USING btree ("business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "razorpay_conn_token_idx" ON "razorpay_connections" USING btree ("webhook_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "rzp_payments_unique_idx" ON "razorpay_payments" USING btree ("business_id","razorpay_payment_id");