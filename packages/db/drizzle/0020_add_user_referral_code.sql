-- Migration: add referral_code to users
ALTER TABLE IF EXISTS users
  ADD COLUMN IF NOT EXISTS referral_code text;
