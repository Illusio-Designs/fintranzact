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
CREATE INDEX "bom_by_products_bom_idx" ON "bom_by_products" USING btree ("bom_id");--> statement-breakpoint
CREATE INDEX "bom_components_bom_idx" ON "bom_components" USING btree ("bom_id");--> statement-breakpoint
CREATE INDEX "bom_components_item_idx" ON "bom_components" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "boms_business_idx" ON "boms" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "boms_item_idx" ON "boms" USING btree ("business_id","item_id");--> statement-breakpoint
CREATE INDEX "manufacturing_journal_lines_journal_idx" ON "manufacturing_journal_lines" USING btree ("journal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "manufacturing_journals_number_idx" ON "manufacturing_journals" USING btree ("business_id","journal_number");--> statement-breakpoint
CREATE INDEX "manufacturing_journals_date_idx" ON "manufacturing_journals" USING btree ("business_id","journal_date");--> statement-breakpoint
CREATE INDEX "manufacturing_journals_item_idx" ON "manufacturing_journals" USING btree ("item_id");