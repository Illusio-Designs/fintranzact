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

// ── Sales documents ──────────────────────────────────────────────

export type DocRow = {
  id: string;
  document_type: string;
  type: string;
  status: string;
  invoice_number: string;
  party_id: string;
  reference_document_id: string | null;
  subtotal: string;
  tax_amount: string;
  discount_amount: string;
  additional_charges: string;
  charges: Array<{ label: string; amount: string }> | null;
  round_off: string;
  total_amount: string;
  amount_paid: string;
  delivery_method: string | null;
  stock_mode: string;
  e_invoice_status: string | null;
  deleted_at: Date | null;
};

const DOC_COLUMNS = `id, document_type, type, status, invoice_number, party_id, reference_document_id, subtotal, tax_amount,
  discount_amount, additional_charges, charges, round_off, total_amount, amount_paid, delivery_method, stock_mode,
  e_invoice_status, deleted_at`;

/** A party's documents of one kind, oldest first. */
export async function documentsOf(partyId: string, documentType: string) {
  return (await db().unsafe(
    `select ${DOC_COLUMNS} from invoices where party_id = $1 and document_type = $2 order by created_at`,
    [partyId, documentType],
  )) as unknown as DocRow[];
}

export async function documentById(id: string) {
  const [row] = await db().unsafe(`select ${DOC_COLUMNS} from invoices where id = $1`, [id]);
  return row as unknown as DocRow | undefined;
}

export type DocLine = {
  item_id: string | null;
  item_name: string;
  quantity: string;
  free_quantity: string;
  unit_price: string;
  tax_percent: string;
  tax_amount: string;
  total_amount: string;
  batch_number: string | null;
};

/** A document's lines with the batch each took (sort order). */
export async function documentLines(id: string) {
  return (await db()`
    select ii.item_id, ii.item_name, ii.quantity, ii.free_quantity, ii.unit_price, ii.tax_percent, ii.tax_amount,
           ii.total_amount, b.batch_number
    from invoice_items ii left join item_batches b on b.id = ii.batch_id
    where ii.invoice_id = ${id} order by ii.sort_order, b.batch_number`) as unknown as DocLine[];
}

/** An item's stock: the stored total and what each batch holds (from its movements). */
export async function itemStock(itemId: string) {
  const [item] = await db()`select stock_quantity from items where id = ${itemId}`;
  const batches = (await db()`
    select coalesce(b.batch_number, '(unbatched)') as batch, sum(sm.quantity)::text as qty
    from stock_movements sm left join item_batches b on b.id = sm.batch_id
    where sm.item_id = ${itemId} group by 1 order by 1`) as unknown as Array<{ batch: string; qty: string }>;
  return {
    total: Number((item as { stock_quantity: string }).stock_quantity),
    byBatch: Object.fromEntries(batches.map((b) => [b.batch, Number(b.qty)])),
  };
}

/** Stock a document moved, net per item and batch (negative = out). */
export async function documentStockMoves(documentId: string) {
  const rows = (await db()`
    select sm.item_id, coalesce(b.batch_number, '(unbatched)') as batch, sum(sm.quantity)::text as qty
    from stock_movements sm left join item_batches b on b.id = sm.batch_id
    where sm.reference_id = ${documentId}
    group by 1, 2 order by 2`) as unknown as Array<{ item_id: string; batch: string; qty: string }>;
  return rows.map((r) => ({ itemId: r.item_id, batch: r.batch, qty: Number(r.qty) }));
}

/** Payments from a party with what each was allocated to. */
export async function paymentsOf(partyId: string) {
  return (await db()`
    select p.id, p.amount, p.mode, p.deleted_at,
           coalesce(json_agg(json_build_object('invoiceId', pa.invoice_id, 'amount', pa.amount)) filter (where pa.id is not null), '[]') as allocations
    from payments p left join payment_allocations pa on pa.payment_id = p.id
    where p.party_id = ${partyId} group by p.id order by p.created_at`) as unknown as Array<{
    id: string;
    amount: string;
    mode: string;
    deleted_at: Date | null;
    allocations: Array<{ invoiceId: string; amount: string | number }>;
  }>;
}

/**
 * What a customer owes from the books, worked out here rather than by the
 * app: opening balance + sale invoices and debit notes − credit notes and
 * sales returns − payments received. Quotations, orders, proformas and
 * challans are not bills and never count; cancelled or deleted documents
 * don't either.
 */
export async function customerBookBalance(partyId: string): Promise<number> {
  const [row] = await db()`
    select
      (select opening_balance from parties where id = ${partyId})
      + coalesce((select sum(case when document_type in ('invoice', 'debit_note') then total_amount
                                  else -total_amount end)
                  from invoices
                  where party_id = ${partyId} and type = 'sale'
                    and document_type in ('invoice', 'debit_note', 'credit_note', 'sales_return')
                    and status <> 'cancelled' and deleted_at is null), 0)
      - coalesce((select sum(amount) from payments where party_id = ${partyId} and deleted_at is null), 0)
      as balance`;
  return Number((row as { balance: string }).balance);
}

export async function businessRow(businessId: string) {
  const [row] = await db()`
    select id, state_code, custom_shipping_methods, e_way_bill_enabled, e_way_bill_threshold
    from businesses where id = ${businessId}`;
  return row as {
    id: string;
    state_code: string | null;
    custom_shipping_methods: Array<{ id: string; label: string; hasTracking: boolean }> | null;
    e_way_bill_enabled: boolean;
    e_way_bill_threshold: string | null;
  };
}

export async function ewayBillConfig(businessId: string) {
  const [row] = await db()`select gstin, is_enabled, is_sandbox from eway_bill_configs where business_id = ${businessId}`;
  return row as { gstin: string; is_enabled: boolean; is_sandbox: boolean } | undefined;
}

export async function ewayBillsFor(invoiceId: string) {
  return (await db()`select id, status from eway_bills where invoice_id = ${invoiceId}`) as unknown as Array<{ id: string; status: string }>;
}

// ── Purchases ───────────────────────────────────────────────────

/** A purchase document's lines: accepted, free and rejected goods, and the batch each came in. */
export async function receivedLines(id: string) {
  return (await db()`
    select ii.item_id, ii.quantity, ii.free_quantity, ii.rejected_quantity, ii.rejection_reason, ii.unit_price,
           ii.tax_amount, ii.total_amount, b.batch_number, b.expiry_date::text as expiry_date
    from invoice_items ii left join item_batches b on b.id = ii.batch_id
    where ii.invoice_id = ${id} order by ii.sort_order`) as unknown as Array<{
    item_id: string | null;
    quantity: string;
    free_quantity: string;
    rejected_quantity: string | null;
    rejection_reason: string | null;
    unit_price: string;
    tax_amount: string;
    total_amount: string;
    batch_number: string | null;
    expiry_date: string | null;
  }>;
}

/** Documents made from `sourceId` (conversions, returns of rejected goods), oldest first. */
export async function documentsMadeFrom(sourceId: string) {
  return (await db().unsafe(
    `select ${DOC_COLUMNS} from invoices where reference_document_id = $1 order by created_at`,
    [sourceId],
  )) as unknown as DocRow[];
}

/** Payments made to a supplier, each with its allocations and the bank movement behind it. */
export async function supplierPayments(partyId: string) {
  return (await db()`
    select p.id, p.amount, p.mode, p.bank_account_id,
           coalesce((select json_agg(json_build_object('invoiceId', pa.invoice_id, 'amount', pa.amount::numeric))
                     from payment_allocations pa where pa.payment_id = p.id), '[]') as allocations,
           (select json_agg(json_build_object('type', bt.type, 'amount', bt.amount::numeric, 'accountId', bt.bank_account_id))
            from bank_transactions bt where bt.reference_type = 'payment' and bt.reference_id = p.id) as bank
    from payments p where p.party_id = ${partyId} and p.deleted_at is null order by p.created_at`) as unknown as Array<{
    id: string;
    amount: string;
    mode: string;
    bank_account_id: string | null;
    allocations: Array<{ invoiceId: string; amount: number }>;
    bank: Array<{ type: string; amount: number; accountId: string }> | null;
  }>;
}

export async function bankBalance(accountId: string) {
  const [row] = await db()`select current_balance from bank_accounts where id = ${accountId}`;
  return Number((row as { current_balance: string }).current_balance);
}

/** The ITC ledger's rows for these documents (an invoice's credit, a return's reversal). */
export async function itcEntries(documentIds: string[]) {
  return (await db()`
    select invoice_id, return_period, status, cgst::numeric as cgst, sgst::numeric as sgst, igst::numeric as igst
    from itc_ledger_entries where invoice_id = any(${documentIds}::uuid[]) order by created_at`) as unknown as Array<{
    invoice_id: string;
    return_period: string;
    status: string;
    cgst: string;
    sgst: string;
    igst: string;
  }>;
}

/**
 * What the business owes a supplier from the books, worked out here rather
 * than by the app: opening balance + purchase invoices − the supplier's credit
 * notes, goods returned (purchase returns) and our debit notes − payments
 * made. Orders and GRNs are not bills; cancelled or deleted documents don't
 * count.
 */
export async function supplierBookBalance(partyId: string): Promise<number> {
  const [row] = await db()`
    select
      (select opening_balance from parties where id = ${partyId})
      + coalesce((select sum(case when document_type = 'invoice' then total_amount else -total_amount end)
                  from invoices
                  where party_id = ${partyId} and type = 'purchase'
                    and document_type in ('invoice', 'credit_note', 'purchase_return', 'debit_note')
                    and status <> 'cancelled' and deleted_at is null), 0)
      - coalesce((select sum(amount) from payments where party_id = ${partyId} and deleted_at is null), 0)
      as balance`;
  return Number((row as { balance: string }).balance);
}

// ── Inventory ────────────────────────────────────────────────────

export async function warehousesOf(businessId: string) {
  return (await db()`
    select id, name, code, warehouse_type, status from warehouses
    where business_id = ${businessId} order by created_at`) as unknown as Array<{
    id: string;
    name: string;
    code: string;
    warehouse_type: string;
    status: string;
  }>;
}

/**
 * Where an item's stock is: the stored warehouse balances and item total the
 * app keeps, next to the net quantity per warehouse and batch worked out from
 * its movements (zero rows dropped).
 */
export async function stockByWarehouse(itemId: string) {
  const moves = (await db()`
    select w.name as warehouse, coalesce(b.batch_number, '(unbatched)') as batch, sum(sm.quantity)::text as qty
    from stock_movements sm join warehouses w on w.id = sm.warehouse_id
    left join item_batches b on b.id = sm.batch_id
    where sm.item_id = ${itemId} group by 1, 2 having sum(sm.quantity) <> 0 order by 1, 2`) as unknown as Array<{
    warehouse: string;
    batch: string;
    qty: string;
  }>;
  const balances = (await db()`
    select w.name as warehouse, sum(sb.quantity)::text as qty
    from stock_balances sb join warehouses w on w.id = sb.warehouse_id
    where sb.item_id = ${itemId} group by 1 having sum(sb.quantity) <> 0 order by 1`) as unknown as Array<{ warehouse: string; qty: string }>;
  const [item] = await db()`select stock_quantity from items where id = ${itemId}`;
  return {
    total: Number((item as { stock_quantity: string }).stock_quantity),
    byWarehouse: Object.fromEntries(balances.map((b) => [b.warehouse, Number(b.qty)])),
    byBatch: moves.map((m) => ({ warehouse: m.warehouse, batch: m.batch, qty: Number(m.qty) })),
  };
}

/** An item's movements (optionally of one reference type), oldest first, with the warehouse and batch each touched. */
export async function itemMovements(itemId: string, referenceType?: string) {
  const rows = (await db()`
    select sm.reference_type, sm.movement_type, sm.reference_id, sm.quantity::numeric::float8 as qty,
           sm.unit_cost, w.name as warehouse, b.batch_number
    from stock_movements sm join warehouses w on w.id = sm.warehouse_id
    left join item_batches b on b.id = sm.batch_id
    where sm.item_id = ${itemId}
    order by sm.created_at, sm.quantity`) as unknown as Array<{
    reference_type: string;
    movement_type: string;
    reference_id: string | null;
    qty: number;
    unit_cost: string | null;
    warehouse: string;
    batch_number: string | null;
  }>;
  return referenceType ? rows.filter((r) => r.reference_type === referenceType) : rows;
}

export async function stockAdjustmentsOf(itemId: string) {
  return (await db()`
    select quantity::numeric::float8 as qty, previous_stock::numeric::float8 as previous,
           new_stock::numeric::float8 as next, reason
    from stock_adjustments where item_id = ${itemId} order by created_at, quantity`) as unknown as Array<{
    qty: number;
    previous: number;
    next: number;
    reason: string | null;
  }>;
}

export async function batchesOf(itemId: string) {
  return (await db()`
    select batch_number, expiry_date::text as expiry_date from item_batches
    where item_id = ${itemId} order by batch_number`) as unknown as Array<{ batch_number: string; expiry_date: string | null }>;
}

export async function physicalCountsOf(businessId: string) {
  return (await db()`
    select c.status, c.scan_count, c.adjusted_count, c.note, c.lines, c.unknown_codes, w.name as warehouse
    from physical_stock_counts c join warehouses w on w.id = c.warehouse_id
    where c.business_id = ${businessId} order by c.created_at`) as unknown as Array<{
    status: string;
    scan_count: number;
    adjusted_count: number;
    note: string | null;
    lines: Array<{ itemId: string; books: string; scanned: string }>;
    unknown_codes: Array<{ code: string; count: number }>;
    warehouse: string;
  }>;
}

export async function bomsOf(itemId: string) {
  return (await db()`
    select b.id, b.name, b.output_quantity, b.is_default, b.is_active,
           (select json_agg(json_build_object('itemId', c.item_id, 'quantity', c.quantity::text, 'wastage', c.wastage_percent::text)
                            order by c.sort_order)
            from bom_components c where c.bom_id = b.id) as components
    from boms b where b.item_id = ${itemId} order by b.created_at`) as unknown as Array<{
    id: string;
    name: string;
    output_quantity: string;
    is_default: boolean;
    is_active: boolean;
    components: Array<{ itemId: string; quantity: string; wastage: string }>;
  }>;
}

export async function manufacturingJournalsOf(itemId: string) {
  return (await db()`
    select j.id, j.journal_number, j.bom_id, j.quantity, j.components_cost, j.additional_costs,
           j.additional_cost_total, j.total_cost, j.unit_cost, j.status, sw.name as source, dw.name as destination,
           (select json_agg(json_build_object('itemId', l.item_id, 'kind', l.kind, 'standard', l.standard_quantity::text,
                                              'quantity', l.quantity::text, 'unitCost', l.unit_cost::text, 'amount', l.amount::text)
                            order by l.sort_order)
            from manufacturing_journal_lines l where l.journal_id = j.id) as lines
    from manufacturing_journals j
    join warehouses sw on sw.id = j.source_warehouse_id
    join warehouses dw on dw.id = j.destination_warehouse_id
    where j.item_id = ${itemId} order by j.created_at`) as unknown as Array<{
    id: string;
    journal_number: string;
    bom_id: string | null;
    quantity: string;
    components_cost: string;
    additional_costs: Array<{ label: string; amount: string }>;
    additional_cost_total: string;
    total_cost: string;
    unit_cost: string;
    status: string;
    source: string;
    destination: string;
    lines: Array<{ itemId: string; kind: string; standard: string | null; quantity: string; unitCost: string; amount: string }>;
  }>;
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
