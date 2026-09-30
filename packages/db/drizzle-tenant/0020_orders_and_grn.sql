ALTER TYPE "public"."document_type" ADD VALUE 'purchase_order';--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE 'sales_order';--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE 'goods_receipt_note';--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "purchase_order_prefix" text DEFAULT 'PO' NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "next_purchase_order_number" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "sales_order_prefix" text DEFAULT 'SO' NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "next_sales_order_number" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "goods_receipt_note_prefix" text DEFAULT 'GRN' NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "next_goods_receipt_note_number" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "closed_at" timestamp with time zone;