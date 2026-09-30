CREATE TABLE "stock_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "stock_group_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_groups" ADD CONSTRAINT "stock_groups_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_groups" ADD CONSTRAINT "stock_groups_parent_id_stock_groups_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."stock_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_groups_business_name_idx" ON "stock_groups" USING btree ("business_id","name");--> statement-breakpoint
CREATE INDEX "stock_groups_parent_idx" ON "stock_groups" USING btree ("parent_id");--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_stock_group_id_stock_groups_id_fk" FOREIGN KEY ("stock_group_id") REFERENCES "public"."stock_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "items_stock_group_idx" ON "items" USING btree ("stock_group_id");--> statement-breakpoint
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