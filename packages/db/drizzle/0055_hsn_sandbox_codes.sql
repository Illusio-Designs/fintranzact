CREATE TABLE "hsn_sandbox_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"rate" numeric(6, 2),
	"active" boolean DEFAULT true NOT NULL,
	"inactive_reason" text,
	"effective_from" text,
	"effective_to" text,
	"status" text DEFAULT 'ok' NOT NULL,
	"source" text DEFAULT 'sandbox' NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "hsn_sandbox_codes_checked_idx" ON "hsn_sandbox_codes" USING btree ("checked_at");