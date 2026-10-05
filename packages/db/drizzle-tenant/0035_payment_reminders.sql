CREATE TABLE "payment_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"kind" text NOT NULL,
	"slot_key" text NOT NULL,
	"trigger" text NOT NULL,
	"status" text NOT NULL,
	"recipient" text,
	"error" text,
	"sent_by_user_id" uuid,
	"sent_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "payment_reminder_settings" jsonb;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "do_not_remind" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_reminders" ADD CONSTRAINT "payment_reminders_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reminders" ADD CONSTRAINT "payment_reminders_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_reminders_slot_idx" ON "payment_reminders" USING btree ("invoice_id","channel","slot_key");--> statement-breakpoint
CREATE INDEX "payment_reminders_invoice_idx" ON "payment_reminders" USING btree ("business_id","invoice_id","created_at");