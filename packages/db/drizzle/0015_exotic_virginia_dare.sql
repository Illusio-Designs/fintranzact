DROP INDEX "premises_business_code_idx";--> statement-breakpoint
DROP INDEX "warehouse_locations_code_idx";--> statement-breakpoint
DROP INDEX "warehouses_business_code_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "premises_business_code_idx" ON "premises" USING btree ("business_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "warehouse_locations_code_idx" ON "warehouse_locations" USING btree ("warehouse_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "warehouses_business_code_idx" ON "warehouses" USING btree ("business_id","code");