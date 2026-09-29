ALTER TABLE "item_variants" ADD COLUMN "barcode" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "barcode" text;--> statement-breakpoint
CREATE INDEX "item_variants_barcode_idx" ON "item_variants" USING btree ("barcode");--> statement-breakpoint
CREATE UNIQUE INDEX "items_barcode_idx" ON "items" USING btree ("business_id","barcode") WHERE "items"."barcode" IS NOT NULL AND "items"."deleted_at" IS NULL;