-- CA partner link: the owner's opt-in to credit the invited CA (a partner) as the organisation's referrer. Idempotent.
ALTER TABLE "invitations" ADD COLUMN IF NOT EXISTS "credit_partner" boolean;
