CREATE TABLE "stock_balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"location_id" uuid,
	"item_id" uuid NOT NULL,
	"variant_id" uuid,
	"quantity" numeric(15, 3) DEFAULT '0' NOT NULL,
	"reserved_quantity" numeric(15, 3) DEFAULT '0' NOT NULL,
	"damaged_quantity" numeric(15, 3) DEFAULT '0' NOT NULL,
	"blocked_quantity" numeric(15, 3) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_location_id_warehouse_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."warehouse_locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_variant_id_item_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."item_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_balances_business_idx" ON "stock_balances" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "stock_balances_warehouse_idx" ON "stock_balances" USING btree ("warehouse_id");--> statement-breakpoint
CREATE INDEX "stock_balances_location_idx" ON "stock_balances" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "stock_balances_item_idx" ON "stock_balances" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "stock_balances_variant_idx" ON "stock_balances" USING btree ("variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_balances_unique_idx" ON "stock_balances" USING btree ("business_id","warehouse_id","location_id","item_id","variant_id");