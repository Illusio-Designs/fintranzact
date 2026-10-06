ALTER TABLE "businesses" ADD COLUMN "store_delivery_fee" numeric(15, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "store_free_delivery_above" numeric(15, 2);