CREATE TABLE "premises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"address" text,
	"state" text,
	"city" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "warehouse_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"parent_id" uuid,
	"location_type" text NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "warehouses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"premise_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"warehouse_type" text NOT NULL,
	"address" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "premises" ADD CONSTRAINT "premises_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouse_locations" ADD CONSTRAINT "warehouse_locations_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_premise_id_premises_id_fk" FOREIGN KEY ("premise_id") REFERENCES "public"."premises"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "premises_business_idx" ON "premises" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "premises_business_code_idx" ON "premises" USING btree ("business_id","code");--> statement-breakpoint
CREATE INDEX "warehouse_locations_warehouse_idx" ON "warehouse_locations" USING btree ("warehouse_id");--> statement-breakpoint
CREATE INDEX "warehouse_locations_parent_idx" ON "warehouse_locations" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "warehouse_locations_code_idx" ON "warehouse_locations" USING btree ("warehouse_id","code");--> statement-breakpoint
CREATE INDEX "warehouses_business_idx" ON "warehouses" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "warehouses_premise_idx" ON "warehouses" USING btree ("premise_id");--> statement-breakpoint
CREATE INDEX "warehouses_business_code_idx" ON "warehouses" USING btree ("business_id","code");