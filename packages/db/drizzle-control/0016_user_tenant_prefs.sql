-- Client switcher: what each person pinned and last opened. Idempotent.
CREATE TABLE IF NOT EXISTS "user_tenant_prefs" (
	"user_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"pinned_at" timestamp with time zone,
	"last_opened_at" timestamp with time zone,
	CONSTRAINT "user_tenant_prefs_user_id_tenant_id_pk" PRIMARY KEY("user_id","tenant_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_tenant_prefs" ADD CONSTRAINT "user_tenant_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_tenant_prefs" ADD CONSTRAINT "user_tenant_prefs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_tenant_prefs_tenant_idx" ON "user_tenant_prefs" USING btree ("tenant_id");
