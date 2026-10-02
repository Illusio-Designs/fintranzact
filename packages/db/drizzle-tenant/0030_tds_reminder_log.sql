CREATE TABLE "tds_reminder_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"item_key" text NOT NULL,
	"day_offset" integer NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tds_reminder_log" ADD CONSTRAINT "tds_reminder_log_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tds_reminder_log_item_idx" ON "tds_reminder_log" USING btree ("business_id","item_key","day_offset");