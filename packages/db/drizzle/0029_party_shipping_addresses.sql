ALTER TABLE "parties" ADD COLUMN IF NOT EXISTS "shipping_addresses" jsonb;--> statement-breakpoint
UPDATE "parties" SET "shipping_addresses" = jsonb_build_array("shipping_address") WHERE "shipping_addresses" IS NULL AND coalesce(trim("shipping_address"), '') <> '';
