CREATE TABLE "item_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"variant_id" uuid,
	"batch_number" text NOT NULL,
	"mfg_date" date,
	"expiry_date" date,
	"mrp" numeric(15, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoice_items" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "track_batches" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "track_expiry" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "item_batches" ADD CONSTRAINT "item_batches_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_batches" ADD CONSTRAINT "item_batches_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_batches" ADD CONSTRAINT "item_batches_variant_id_item_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."item_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "item_batches_item_number_idx" ON "item_batches" USING btree ("business_id","item_id","batch_number") WHERE "item_batches"."variant_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "item_batches_variant_number_idx" ON "item_batches" USING btree ("business_id","item_id","variant_id","batch_number") WHERE "item_batches"."variant_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "item_batches_item_idx" ON "item_batches" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "item_batches_expiry_idx" ON "item_batches" USING btree ("business_id","expiry_date");--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_batch_id_item_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."item_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Nothing wrote batch_id before batches existed; clear any stray value so the FK can be added.
UPDATE "stock_movements" SET "batch_id" = NULL WHERE "batch_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_batch_id_item_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."item_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_items_batch_idx" ON "invoice_items" USING btree ("batch_id");