ALTER TYPE "public"."member_role" ADD VALUE 'hr';--> statement-breakpoint
ALTER TYPE "public"."member_role" ADD VALUE 'employee';--> statement-breakpoint
CREATE TABLE "attendance_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"version" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_device_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"created_by_user_id" uuid,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"source" text NOT NULL,
	"file_name" text,
	"device_key_id" uuid,
	"status" text DEFAULT 'applied' NOT NULL,
	"totals" jsonb NOT NULL,
	"from_date" date,
	"to_date" date,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"undone_at" timestamp with time zone,
	"undone_by_user_id" uuid
);
--> statement-breakpoint
CREATE TABLE "attendance_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"punch_enabled" boolean DEFAULT true NOT NULL,
	"geofence_policy" text DEFAULT 'record' NOT NULL,
	"accuracy_threshold_m" integer DEFAULT 100 NOT NULL,
	"selfie_required" boolean DEFAULT true NOT NULL,
	"selfie_retention_days" integer DEFAULT 90 NOT NULL,
	"late_grace_minutes" integer DEFAULT 15 NOT NULL,
	"full_day_min_hours" numeric(4, 2),
	"half_day_min_hours" numeric(4, 2),
	"overtime_from_punches" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_logins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_punch_selfies" (
	"punch_id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"mime_type" text NOT NULL,
	"bytes" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_punches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"punched_at" timestamp with time zone NOT NULL,
	"client_time" timestamp with time zone,
	"work_date" date NOT NULL,
	"source" text NOT NULL,
	"device_id" text DEFAULT '' NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"accuracy_m" double precision,
	"distance_m" integer,
	"location_id" uuid,
	"geofence_result" text DEFAULT 'not_checked' NOT NULL,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"review_status" text,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"import_batch_id" uuid,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_work_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"location_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form16_releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"financial_year" integer NOT NULL,
	"released_by_user_id" uuid,
	"released_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"name" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"radius_m" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "employee_id" uuid;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "business_id" uuid;--> statement-breakpoint
ALTER TABLE "attendance_consents" ADD CONSTRAINT "attendance_consents_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_consents" ADD CONSTRAINT "attendance_consents_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_device_keys" ADD CONSTRAINT "attendance_device_keys_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_import_batches" ADD CONSTRAINT "attendance_import_batches_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_settings" ADD CONSTRAINT "attendance_settings_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_logins" ADD CONSTRAINT "employee_logins_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_logins" ADD CONSTRAINT "employee_logins_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_punch_selfies" ADD CONSTRAINT "employee_punch_selfies_punch_id_employee_punches_id_fk" FOREIGN KEY ("punch_id") REFERENCES "public"."employee_punches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_punch_selfies" ADD CONSTRAINT "employee_punch_selfies_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_punches" ADD CONSTRAINT "employee_punches_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_punches" ADD CONSTRAINT "employee_punches_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_punches" ADD CONSTRAINT "employee_punches_import_batch_id_attendance_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."attendance_import_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_work_locations" ADD CONSTRAINT "employee_work_locations_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_work_locations" ADD CONSTRAINT "employee_work_locations_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_work_locations" ADD CONSTRAINT "employee_work_locations_location_id_work_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."work_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form16_releases" ADD CONSTRAINT "form16_releases_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_locations" ADD CONSTRAINT "work_locations_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_consents_idx" ON "attendance_consents" USING btree ("employee_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_device_keys_hash_idx" ON "attendance_device_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "attendance_device_keys_business_idx" ON "attendance_device_keys" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "attendance_import_batches_business_idx" ON "attendance_import_batches" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_settings_business_idx" ON "attendance_settings" USING btree ("business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_logins_employee_idx" ON "employee_logins" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_logins_user_idx" ON "employee_logins" USING btree ("business_id","user_id");--> statement-breakpoint
CREATE INDEX "employee_punch_selfies_captured_idx" ON "employee_punch_selfies" USING btree ("business_id","captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_punches_dedupe_idx" ON "employee_punches" USING btree ("employee_id","punched_at","source","device_id");--> statement-breakpoint
CREATE INDEX "employee_punches_employee_time_idx" ON "employee_punches" USING btree ("employee_id","punched_at");--> statement-breakpoint
CREATE INDEX "employee_punches_business_date_idx" ON "employee_punches" USING btree ("business_id","work_date");--> statement-breakpoint
CREATE INDEX "employee_punches_review_idx" ON "employee_punches" USING btree ("business_id","review_status");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_work_locations_idx" ON "employee_work_locations" USING btree ("employee_id","location_id");--> statement-breakpoint
CREATE INDEX "employee_work_locations_business_idx" ON "employee_work_locations" USING btree ("business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "form16_releases_idx" ON "form16_releases" USING btree ("business_id","financial_year");--> statement-breakpoint
CREATE INDEX "work_locations_business_idx" ON "work_locations" USING btree ("business_id");