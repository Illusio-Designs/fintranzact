CREATE TABLE "store_order_refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"store_order_id" uuid NOT NULL,
	"razorpay_payment_id" text NOT NULL,
	"razorpay_refund_id" text,
	"amount_paise" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason" text,
	"credit_note_id" uuid,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "store_online_payments_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "store_cod_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "store_orders" ADD COLUMN "payment_method" text DEFAULT 'cod' NOT NULL;--> statement-breakpoint
ALTER TABLE "store_orders" ADD COLUMN "payment_status" text DEFAULT 'unpaid' NOT NULL;--> statement-breakpoint
ALTER TABLE "store_orders" ADD COLUMN "paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "store_orders" ADD COLUMN "refunded_amount" numeric(15, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "store_orders" ADD COLUMN "payment_failed_emailed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "store_order_refunds" ADD CONSTRAINT "store_order_refunds_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_order_refunds" ADD CONSTRAINT "store_order_refunds_store_order_id_store_orders_id_fk" FOREIGN KEY ("store_order_id") REFERENCES "public"."store_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_order_refunds" ADD CONSTRAINT "store_order_refunds_credit_note_id_invoices_id_fk" FOREIGN KEY ("credit_note_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "store_order_refunds_key_idx" ON "store_order_refunds" USING btree ("business_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "store_order_refunds_order_idx" ON "store_order_refunds" USING btree ("store_order_id");