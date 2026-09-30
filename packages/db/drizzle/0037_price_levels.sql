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
ALTER TABLE "item_variants" ADD COLUMN "mrp" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "mrp" numeric(15, 2);--> statement-breakpoint
ALTER TABLE "parties" ADD COLUMN "price_level_id" uuid;--> statement-breakpoint
ALTER TABLE "price_levels" ADD CONSTRAINT "price_levels_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_entries" ADD CONSTRAINT "price_list_entries_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_entries" ADD CONSTRAINT "price_list_entries_price_level_id_price_levels_id_fk" FOREIGN KEY ("price_level_id") REFERENCES "public"."price_levels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_entries" ADD CONSTRAINT "price_list_entries_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_entries" ADD CONSTRAINT "price_list_entries_variant_id_item_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."item_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "price_levels_name_idx" ON "price_levels" USING btree ("business_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "price_levels_default_idx" ON "price_levels" USING btree ("business_id") WHERE is_default;--> statement-breakpoint
CREATE INDEX "price_list_entries_level_item_idx" ON "price_list_entries" USING btree ("price_level_id","item_id");--> statement-breakpoint
CREATE INDEX "price_list_entries_item_idx" ON "price_list_entries" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "price_list_entries_business_idx" ON "price_list_entries" USING btree ("business_id");--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_price_level_id_price_levels_id_fk" FOREIGN KEY ("price_level_id") REFERENCES "public"."price_levels"("id") ON DELETE set null ON UPDATE no action;