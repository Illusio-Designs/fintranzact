CREATE TABLE "inventory_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"sales_warehouse_id" uuid,
	"purchase_warehouse_id" uuid,
	"sales_return_warehouse_id" uuid,
	"purchase_return_warehouse_id" uuid,
	"production_warehouse_id" uuid,
	"stock_adjustment_warehouse_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "warehouse_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"business_member_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"can_view" boolean DEFAULT true NOT NULL,
	"can_receive" boolean DEFAULT false NOT NULL,
	"can_issue" boolean DEFAULT false NOT NULL,
	"can_transfer" boolean DEFAULT false NOT NULL,
	"can_adjust" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_settings" ADD CONSTRAINT "inventory_settings_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_settings" ADD CONSTRAINT "inventory_settings_sales_warehouse_id_warehouses_id_fk" FOREIGN KEY ("sales_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_settings" ADD CONSTRAINT "inventory_settings_purchase_warehouse_id_warehouses_id_fk" FOREIGN KEY ("purchase_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_settings" ADD CONSTRAINT "inventory_settings_sales_return_warehouse_id_warehouses_id_fk" FOREIGN KEY ("sales_return_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_settings" ADD CONSTRAINT "inventory_settings_purchase_return_warehouse_id_warehouses_id_fk" FOREIGN KEY ("purchase_return_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_settings" ADD CONSTRAINT "inventory_settings_production_warehouse_id_warehouses_id_fk" FOREIGN KEY ("production_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_settings" ADD CONSTRAINT "inventory_settings_stock_adjustment_warehouse_id_warehouses_id_fk" FOREIGN KEY ("stock_adjustment_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouse_permissions" ADD CONSTRAINT "warehouse_permissions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouse_permissions" ADD CONSTRAINT "warehouse_permissions_business_member_id_business_members_id_fk" FOREIGN KEY ("business_member_id") REFERENCES "public"."business_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouse_permissions" ADD CONSTRAINT "warehouse_permissions_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_settings_business_idx" ON "inventory_settings" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "inventory_settings_sales_wh_idx" ON "inventory_settings" USING btree ("sales_warehouse_id");--> statement-breakpoint
CREATE INDEX "inventory_settings_purchase_wh_idx" ON "inventory_settings" USING btree ("purchase_warehouse_id");--> statement-breakpoint
CREATE UNIQUE INDEX "warehouse_permissions_member_wh_idx" ON "warehouse_permissions" USING btree ("business_member_id","warehouse_id");--> statement-breakpoint
CREATE INDEX "warehouse_permissions_business_idx" ON "warehouse_permissions" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "warehouse_permissions_member_idx" ON "warehouse_permissions" USING btree ("business_member_id");--> statement-breakpoint
CREATE INDEX "warehouse_permissions_warehouse_idx" ON "warehouse_permissions" USING btree ("warehouse_id");