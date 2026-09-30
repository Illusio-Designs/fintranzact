ALTER TYPE "public"."document_type" ADD VALUE 'purchase_order';--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE 'sales_order';--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE 'goods_receipt_note';--> statement-breakpoint
CREATE TABLE "bom_by_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bom_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"variant_id" uuid,
	"quantity" numeric(15, 3) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bom_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bom_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"variant_id" uuid,
	"quantity" numeric(15, 3) NOT NULL,
	"unit" text,
	"wastage_percent" numeric(6, 2) DEFAULT '0' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "boms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"variant_id" uuid,
	"name" text NOT NULL,
	"output_quantity" numeric(15, 3) DEFAULT '1' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manufacturing_journal_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"journal_id" uuid NOT NULL,
	"kind" text DEFAULT 'component' NOT NULL,
	"item_id" uuid NOT NULL,
	"variant_id" uuid,
	"standard_quantity" numeric(15, 3),
	"quantity" numeric(15, 3) NOT NULL,
	"unit_cost" numeric(15, 4) DEFAULT '0' NOT NULL,
	"amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manufacturing_journals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"journal_number" text NOT NULL,
	"journal_date" timestamp with time zone NOT NULL,
	"bom_id" uuid,
	"item_id" uuid NOT NULL,
	"variant_id" uuid,
	"quantity" numeric(15, 3) NOT NULL,
	"source_warehouse_id" uuid NOT NULL,
	"destination_warehouse_id" uuid NOT NULL,
	"components_cost" numeric(15, 2) DEFAULT '0' NOT NULL,
	"additional_costs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"additional_cost_total" numeric(15, 2) DEFAULT '0' NOT NULL,
	"total_cost" numeric(15, 2) DEFAULT '0' NOT NULL,
	"unit_cost" numeric(15, 4) DEFAULT '0' NOT NULL,
	"notes" text,
	"status" text DEFAULT 'posted' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_user_id" uuid,
	"created_by_user_id" uuid,
	"created_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_levels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_list_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"price_level_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"variant_id" uuid,
	"unit" text,
	"min_quantity" numeric(15, 3) DEFAULT '0' NOT NULL,
	"price" numeric(15, 2),
	"discount_percent" numeric(5, 2),
	"effective_from" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "purchase_order_prefix" text DEFAULT 'PO' NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "next_purchase_order_number" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "sales_order_prefix" text DEFAULT 'SO' NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "next_sales_order_number" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "goods_receipt_note_prefix" text DEFAULT 'GRN' NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "next_goods_receipt_note_number" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_settings" ADD COLUMN "negative_stock_policy" text DEFAULT 'warn' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_settings" ADD COLUMN "valuation_method" text DEFAULT 'weighted_average' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "stock_mode" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "item_variants" ADD COLUMN "mrp" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "mrp" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "stock_group_id" uuid;--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "price_level_id" uuid;--> statement-breakpoint
ALTER TABLE "bom_by_products" ADD CONSTRAINT "bom_by_products_bom_id_boms_id_fk" FOREIGN KEY ("bom_id") REFERENCES "public"."boms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_by_products" ADD CONSTRAINT "bom_by_products_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_by_products" ADD CONSTRAINT "bom_by_products_variant_id_item_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."item_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_components" ADD CONSTRAINT "bom_components_bom_id_boms_id_fk" FOREIGN KEY ("bom_id") REFERENCES "public"."boms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_components" ADD CONSTRAINT "bom_components_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_components" ADD CONSTRAINT "bom_components_variant_id_item_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."item_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boms" ADD CONSTRAINT "boms_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boms" ADD CONSTRAINT "boms_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boms" ADD CONSTRAINT "boms_variant_id_item_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."item_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manufacturing_journal_lines" ADD CONSTRAINT "manufacturing_journal_lines_journal_id_manufacturing_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."manufacturing_journals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manufacturing_journal_lines" ADD CONSTRAINT "manufacturing_journal_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manufacturing_journal_lines" ADD CONSTRAINT "manufacturing_journal_lines_variant_id_item_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."item_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manufacturing_journals" ADD CONSTRAINT "manufacturing_journals_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manufacturing_journals" ADD CONSTRAINT "manufacturing_journals_bom_id_boms_id_fk" FOREIGN KEY ("bom_id") REFERENCES "public"."boms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manufacturing_journals" ADD CONSTRAINT "manufacturing_journals_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manufacturing_journals" ADD CONSTRAINT "manufacturing_journals_variant_id_item_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."item_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manufacturing_journals" ADD CONSTRAINT "manufacturing_journals_source_warehouse_id_warehouses_id_fk" FOREIGN KEY ("source_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manufacturing_journals" ADD CONSTRAINT "manufacturing_journals_destination_warehouse_id_warehouses_id_fk" FOREIGN KEY ("destination_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_levels" ADD CONSTRAINT "price_levels_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_entries" ADD CONSTRAINT "price_list_entries_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_entries" ADD CONSTRAINT "price_list_entries_price_level_id_price_levels_id_fk" FOREIGN KEY ("price_level_id") REFERENCES "public"."price_levels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_entries" ADD CONSTRAINT "price_list_entries_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_entries" ADD CONSTRAINT "price_list_entries_variant_id_item_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."item_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_groups" ADD CONSTRAINT "stock_groups_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_groups" ADD CONSTRAINT "stock_groups_parent_id_stock_groups_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."stock_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bom_by_products_bom_idx" ON "bom_by_products" USING btree ("bom_id");--> statement-breakpoint
CREATE INDEX "bom_components_bom_idx" ON "bom_components" USING btree ("bom_id");--> statement-breakpoint
CREATE INDEX "bom_components_item_idx" ON "bom_components" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "boms_business_idx" ON "boms" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "boms_item_idx" ON "boms" USING btree ("business_id","item_id");--> statement-breakpoint
CREATE INDEX "manufacturing_journal_lines_journal_idx" ON "manufacturing_journal_lines" USING btree ("journal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "manufacturing_journals_number_idx" ON "manufacturing_journals" USING btree ("business_id","journal_number");--> statement-breakpoint
CREATE INDEX "manufacturing_journals_date_idx" ON "manufacturing_journals" USING btree ("business_id","journal_date");--> statement-breakpoint
CREATE INDEX "manufacturing_journals_item_idx" ON "manufacturing_journals" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "price_levels_name_idx" ON "price_levels" USING btree ("business_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "price_levels_default_idx" ON "price_levels" USING btree ("business_id") WHERE is_default;--> statement-breakpoint
CREATE INDEX "price_list_entries_level_item_idx" ON "price_list_entries" USING btree ("price_level_id","item_id");--> statement-breakpoint
CREATE INDEX "price_list_entries_item_idx" ON "price_list_entries" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "price_list_entries_business_idx" ON "price_list_entries" USING btree ("business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_groups_business_name_idx" ON "stock_groups" USING btree ("business_id","name");--> statement-breakpoint
CREATE INDEX "stock_groups_parent_idx" ON "stock_groups" USING btree ("parent_id");--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_stock_group_id_stock_groups_id_fk" FOREIGN KEY ("stock_group_id") REFERENCES "public"."stock_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_price_level_id_price_levels_id_fk" FOREIGN KEY ("price_level_id") REFERENCES "public"."price_levels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "items_stock_group_idx" ON "items" USING btree ("stock_group_id");--> statement-breakpoint
-- Documents that already post stock movements are tracked.
UPDATE "invoices" SET "stock_mode" = 'tracked'
WHERE EXISTS (SELECT 1 FROM "stock_movements" m WHERE m."reference_id" = "invoices"."id");--> statement-breakpoint
-- Invoices billed against a delivery challan never moved stock themselves.
UPDATE "invoices" SET "stock_mode" = 'none'
WHERE "stock_mode" = 'legacy'
  AND "document_type" = 'invoice'
  AND "reference_document_id" IN (SELECT c."id" FROM "invoices" c WHERE c."document_type" = 'delivery_challan');
--> statement-breakpoint
-- Backfill: one stock group per distinct category in each business, then
-- link items to it. Idempotent, so it is safe to re-run.
INSERT INTO "stock_groups" ("business_id", "name")
SELECT DISTINCT i."business_id", btrim(i."category")
FROM "items" i
WHERE i."category" IS NOT NULL AND btrim(i."category") <> '' AND i."deleted_at" IS NULL
ON CONFLICT ("business_id", "name") DO NOTHING;--> statement-breakpoint
UPDATE "items" i SET "stock_group_id" = g."id", "category" = g."name"
FROM "stock_groups" g
WHERE i."stock_group_id" IS NULL
  AND g."business_id" = i."business_id"
  AND g."name" = btrim(i."category");