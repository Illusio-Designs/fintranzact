ALTER TABLE "inventory_settings" ADD COLUMN "negative_stock_policy" text DEFAULT 'warn' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "stock_mode" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
-- Documents that already post stock movements are tracked.
UPDATE "invoices" SET "stock_mode" = 'tracked'
WHERE EXISTS (SELECT 1 FROM "stock_movements" m WHERE m."reference_id" = "invoices"."id");--> statement-breakpoint
-- Invoices billed against a delivery challan never moved stock themselves.
UPDATE "invoices" SET "stock_mode" = 'none'
WHERE "stock_mode" = 'legacy'
  AND "document_type" = 'invoice'
  AND "reference_document_id" IN (SELECT c."id" FROM "invoices" c WHERE c."document_type" = 'delivery_challan');
