ALTER TABLE "invoice_items" ADD COLUMN "free_quantity" numeric(15, 3) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD COLUMN "rejected_quantity" numeric(15, 3) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD COLUMN "rejection_reason" text;