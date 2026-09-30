CREATE TABLE "roadmap_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" text NOT NULL,
	"status" text DEFAULT 'idea' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"launch_stage" text DEFAULT 'after_launch' NOT NULL,
	"phase" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"target" text,
	"billing" text DEFAULT 'included' NOT NULL,
	"price_note" text,
	"checklist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid
);
--> statement-breakpoint
ALTER TABLE "roadmap_items" ADD CONSTRAINT "roadmap_items_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "roadmap_items_status_idx" ON "roadmap_items" USING btree ("status","sort_order");