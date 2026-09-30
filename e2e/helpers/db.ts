/**
 * db.ts — Direct Postgres access for E2E assertions.
 *
 * Journeys check what the UI shows AND what was actually stored. This helper
 * opens one small connection pool to the database the API under test uses
 * (E2E_DATABASE_URL, falling back to DATABASE_URL, then the CI default) and
 * exposes a few typed read helpers. Writes are limited to test plumbing that
 * has no UI (e.g. making a magic link expire), and are named as such.
 *
 * Single-tenant mode only (MULTI_TENANT unset, as in CI): control tables and
 * business tables share this one database.
 */
import { createHash } from "node:crypto";
import postgres from "postgres";

const DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://test:test@localhost:5433/fintranzact_test";

let client: postgres.Sql | null = null;

/** Lazily-created shared connection pool. */
export function db(): postgres.Sql {
  if (!client) client = postgres(DATABASE_URL, { max: 2, idle_timeout: 5, onnotice: () => {} });
  return client;
}

export async function closeDb() {
  if (client) {
    const c = client;
    client = null;
    await c.end({ timeout: 5 });
  }
}

/** Same hashing the API uses for magic-link tokens (sha256 hex). */
export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

// ── Reads ────────────────────────────────────────────────────────

export async function userByEmail(email: string) {
  const [row] = await db()`
    select id, email, name, email_verified, password_hash is not null as has_password
    from users where lower(email) = lower(${email})`;
  return row as
    | { id: string; email: string; name: string | null; email_verified: boolean; has_password: boolean }
    | undefined;
}

/** Tenants (organisations) the user belongs to, with their role there. */
export async function membershipsOf(userId: string) {
  return (await db()`
    select tm.tenant_id, tm.role, t.name as tenant_name, t.plan
    from tenant_members tm join tenants t on t.id = tm.tenant_id
    where tm.user_id = ${userId}
    order by tm.created_at`) as unknown as Array<{ tenant_id: string; role: string; tenant_name: string; plan: string | null }>;
}

export async function businessesCreatedBy(userId: string) {
  return (await db()`
    select id, name, gst_registration_type, gstin, pan, state, state_code, city, pincode, phone,
           address_line_1, country_of_operations, business_type
    from businesses where created_by_user_id = ${userId} order by created_at`) as unknown as Array<Record<string, string | null>>;
}

export async function businessMembers(businessId: string) {
  return (await db()`
    select bm.user_id, bm.role, u.email from business_members bm join users u on u.id = bm.user_id
    where bm.business_id = ${businessId} order by bm.created_at`) as unknown as Array<{ user_id: string; role: string; email: string }>;
}

export async function magicLinkTokens(email: string) {
  return (await db()`
    select id, token_hash, expires_at, used_at, created_at from magic_link_tokens
    where email = lower(${email}) order by created_at`) as unknown as Array<{
    id: string;
    token_hash: string;
    expires_at: Date;
    used_at: Date | null;
    created_at: Date;
  }>;
}

export async function activeSessionCount(userId: string) {
  const [row] = await db()`select count(*)::int as n from sessions where user_id = ${userId} and expires_at > now()`;
  return (row as { n: number }).n;
}

// ── Test plumbing (no UI exists for these) ───────────────────────

/**
 * The API only stores a hash of each magic-link token and "sends" the raw
 * link to the dev console mailer. To open the link the user was emailed, the
 * test swaps the newest token's hash for the hash of a raw token it chose —
 * the stored row (expiry, used flag, email) is otherwise untouched.
 */
export async function claimLatestMagicLink(email: string): Promise<string> {
  const raw = `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const rows = await db()`
    update magic_link_tokens set token_hash = ${hashToken(raw)}
    where id = (select id from magic_link_tokens where email = lower(${email}) order by created_at desc limit 1)
    returning id`;
  if (rows.length !== 1) throw new Error(`No magic link was issued for ${email}`);
  return raw;
}

/** Backdate a magic link so it has expired (the 15-minute window has passed). */
export async function expireMagicLinkToken(raw: string) {
  await db()`update magic_link_tokens set expires_at = now() - interval '1 minute' where token_hash = ${hashToken(raw)}`;
}
