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

export async function tenantMembers(tenantId: string) {
  return (await db()`
    select u.email, tm.role, tm.accepted_at from tenant_members tm join users u on u.id = tm.user_id
    where tm.tenant_id = ${tenantId} order by tm.created_at`) as unknown as Array<{ email: string; role: string; accepted_at: Date | null }>;
}

export async function invitationsFor(tenantId: string, email: string) {
  return (await db()`
    select role, accepted_at, expires_at, token from invitations
    where tenant_id = ${tenantId} and lower(email) = lower(${email}) order by created_at`) as unknown as Array<{
    role: string;
    accepted_at: Date | null;
    expires_at: Date;
    token: string;
  }>;
}

/** Tenants the user's live sessions are pointed at (null = no organisation). */
export async function sessionTenants(userId: string) {
  const rows = await db()`select tenant_id from sessions where user_id = ${userId} and expires_at > now()`;
  return rows.map((r) => (r as { tenant_id: string | null }).tenant_id);
}

export async function invoiceRow(id: string) {
  const [row] = await db()`
    select id, status, invoice_number, total_amount, amount_paid, deleted_at, created_at from invoices where id = ${id}`;
  return row as
    | { id: string; status: string; invoice_number: string; total_amount: string; amount_paid: string; deleted_at: Date | null; created_at: Date }
    | undefined;
}

// ── Masters ─────────────────────────────────────────────────────

export type PartyRow = {
  id: string;
  type: string;
  name: string;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  pan: string | null;
  state: string | null;
  state_code: string | null;
  billing_address: string | null;
  shipping_address: string | null;
  additional_shipping_addresses: Array<{ label?: string; address: string; city?: string; state?: string; stateCode?: string; pincode?: string }> | null;
  opening_balance: string;
  credit_limit: string | null;
  credit_period_days: number | null;
  price_level_id: string | null;
};

export async function partiesNamed(businessId: string, name: string) {
  return (await db()`
    select id, type, name, phone, email, gstin, pan, state, state_code, billing_address, shipping_address,
           additional_shipping_addresses, opening_balance, credit_limit, credit_period_days, price_level_id
    from parties where business_id = ${businessId} and name = ${name}`) as unknown as PartyRow[];
}

export async function invoicePartyIds(invoiceIds: string[]) {
  return (await db()`select id, party_id, notes from invoices where id = any(${invoiceIds}::uuid[])`) as unknown as Array<{
    id: string;
    party_id: string;
    notes: string | null;
  }>;
}

export async function invoiceLines(invoiceId: string) {
  return (await db()`
    select item_id, item_name, quantity, unit_price, tax_percent, total_amount from invoice_items
    where invoice_id = ${invoiceId} order by sort_order`) as unknown as Array<{
    item_id: string | null;
    item_name: string;
    quantity: string;
    unit_price: string;
    tax_percent: string;
    total_amount: string;
  }>;
}

export async function recurringTemplatesOf(partyId: string) {
  return (await db()`select id, name from recurring_invoice_templates where party_id = ${partyId}`) as unknown as Array<{ id: string; name: string }>;
}

export type ItemRow = {
  id: string;
  name: string;
  item_type: string;
  item_mode: string;
  hsn: string | null;
  sku: string | null;
  barcode: string | null;
  unit: string;
  unit_variants: Array<{ unit: string; conversionFactor: number; salePrice?: string }> | null;
  variant_attributes: string[] | null;
  sale_price: string | null;
  purchase_price: string | null;
  tax_percent: string;
  stock_quantity: string;
  stock_group_id: string | null;
  track_batches: boolean;
  track_expiry: boolean;
  deleted_at: Date | null;
};

export async function itemsNamed(businessId: string, name: string) {
  return (await db()`
    select id, name, item_type, item_mode, hsn, sku, barcode, unit, unit_variants, variant_attributes, sale_price,
           purchase_price, tax_percent, stock_quantity, stock_group_id, track_batches, track_expiry, deleted_at
    from items where business_id = ${businessId} and name = ${name}`) as unknown as ItemRow[];
}

export async function itemVariants(itemId: string) {
  return (await db()`
    select id, attribute_values, sku, sale_price, stock_quantity, deleted_at from item_variants
    where item_id = ${itemId} order by created_at`) as unknown as Array<{
    id: string;
    attribute_values: Record<string, string>;
    sku: string | null;
    sale_price: string | null;
    stock_quantity: string;
    deleted_at: Date | null;
  }>;
}

export async function itemBatches(itemId: string) {
  return (await db()`
    select batch_number, expiry_date::text as expiry_date, mfg_date::text as mfg_date from item_batches
    where item_id = ${itemId} order by created_at`) as unknown as Array<{ batch_number: string; expiry_date: string | null; mfg_date: string | null }>;
}

/** Stock movements of an item (opening stock, sales, adjustments…). */
export async function stockMovements(itemId: string) {
  return (await db()`
    select sm.movement_type, sm.reference_type, sm.quantity, b.batch_number, sm.variant_id
    from stock_movements sm left join item_batches b on b.id = sm.batch_id
    where sm.item_id = ${itemId} order by sm.created_at`) as unknown as Array<{
    movement_type: string;
    reference_type: string | null;
    quantity: string;
    batch_number: string | null;
    variant_id: string | null;
  }>;
}

export async function stockGroupNamed(businessId: string, name: string) {
  const [row] = await db()`select id, name, parent_id from stock_groups where business_id = ${businessId} and name = ${name}`;
  return row as { id: string; name: string; parent_id: string | null } | undefined;
}

export async function priceListEntries(levelName: string, itemId: string) {
  return (await db()`
    select ple.price, ple.unit, ple.min_quantity from price_list_entries ple
    join price_levels pl on pl.id = ple.price_level_id
    where pl.name = ${levelName} and ple.item_id = ${itemId}`) as unknown as Array<{ price: string; unit: string | null; min_quantity: string }>;
}

export async function priceLevelNamed(businessId: string, name: string) {
  const [row] = await db()`select id, name from price_levels where business_id = ${businessId} and name = ${name}`;
  return row as { id: string; name: string } | undefined;
}

// ── Test plumbing (no UI exists for these) ───────────────────────

/** Make an invoice look `hours` old (role rules depend on its age). */
export async function backdateInvoice(id: string, hours: number) {
  await db()`update invoices set created_at = now() - make_interval(hours => ${hours}) where id = ${id}`;
}

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
