-- Migration: add referral_code to tenants
ALTER TABLE IF EXISTS tenants
  ADD COLUMN IF NOT EXISTS referral_code text;
