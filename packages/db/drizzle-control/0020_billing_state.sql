-- Billing state: the GST state code of the organisation, used to split GST on Finvera's subscription invoices (CGST+SGST in the seller's state, IGST elsewhere). Nullable; no backfill. Idempotent.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "billing_state" text;
ALTER TABLE "billing_payments" ADD COLUMN IF NOT EXISTS "billing_state" text;
