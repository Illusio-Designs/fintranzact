CREATE TABLE "ai_pack_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"packs" integer NOT NULL,
	"credits" integer NOT NULL,
	"base_paise" integer NOT NULL,
	"total_paise" integer NOT NULL,
	"provider" text NOT NULL,
	"provider_order_id" text NOT NULL,
	"provider_payment_id" text,
	"status" text DEFAULT 'created' NOT NULL,
	"payment_id" uuid,
	"grant_id" uuid,
	"failure_reason" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "ai_credit_grants" ADD COLUMN "payment_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_credit_grants" ADD COLUMN "order_id" uuid;--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD COLUMN "scheduled_addon" text;--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD COLUMN "replaces_subscription_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_pack_orders" ADD CONSTRAINT "ai_pack_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_pack_orders_provider_order_idx" ON "ai_pack_orders" USING btree ("provider_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_pack_orders_provider_payment_idx" ON "ai_pack_orders" USING btree ("provider_payment_id") WHERE "ai_pack_orders"."provider_payment_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "ai_pack_orders_tenant_idx" ON "ai_pack_orders" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_credit_grants_payment_idx" ON "ai_credit_grants" USING btree ("payment_id") WHERE "ai_credit_grants"."payment_id" IS NOT NULL;