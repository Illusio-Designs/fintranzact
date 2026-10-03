/**
 * settings-db.ts — Direct DB reads for the settings, store, platform-admin
 * and partner journeys (J11–J14). Same pool as db.ts.
 */
import { db } from "./db";

export type BusinessProfileRow = {
  name: string;
  legal_name: string | null;
  email: string | null;
  phone: string | null;
  address_line_2: string | null;
  udyam_number: string | null;
  logo_mime_type: string | null;
  logo_width: number | null;
  logo_has_data: boolean;
  signature_mime_type: string | null;
  signature_has_data: boolean;
  invoice_prefix: string;
  next_invoice_number: number;
  default_terms_and_conditions: string | null;
  custom_shipping_methods: Array<{ id: string; label: string; hasTracking: boolean }> | null;
  barcodes_enabled: boolean;
  barcode_type: string;
  barcode_mode: string;
  barcode_setup_locked_at: Date | null;
  pos_enabled: boolean;
  e_way_bill_enabled: boolean;
  e_way_bill_threshold: string | null;
  invoice_template: string;
  thermal_width: number;
};

export async function businessProfile(businessId: string) {
  const [row] = await db()`
    select name, legal_name, email, phone, address_line_2, udyam_number,
           logo_mime_type, logo_width, logo_data is not null as logo_has_data,
           signature_mime_type, signature_data is not null as signature_has_data,
           invoice_prefix, next_invoice_number, default_terms_and_conditions, custom_shipping_methods,
           barcodes_enabled, barcode_type, barcode_mode, barcode_setup_locked_at, pos_enabled,
           e_way_bill_enabled, e_way_bill_threshold, invoice_template, thermal_width
    from businesses where id = ${businessId}`;
  return row as unknown as BusinessProfileRow;
}

export async function eInvoiceConfig(businessId: string) {
  const [row] = await db()`
    select gstin, username, password, client_id, client_secret, is_sandbox, is_enabled, threshold_crore
    from e_invoice_configs where business_id = ${businessId}`;
  return row as
    | {
        gstin: string;
        username: string;
        password: string;
        client_id: string | null;
        client_secret: string | null;
        is_sandbox: boolean;
        is_enabled: boolean;
        threshold_crore: string;
      }
    | undefined;
}

export async function apiKeysOf(userId: string) {
  return (await db()`
    select id, name, key_prefix, expires_at, last_used_at from api_keys where user_id = ${userId} order by created_at`) as unknown as Array<{
    id: string;
    name: string;
    key_prefix: string;
    expires_at: Date | null;
    last_used_at: Date | null;
  }>;
}

export async function partiesOf(businessId: string, names: string[]) {
  return (await db()`
    select id, name, type, phone, gstin, state, state_code, opening_balance::text as opening_balance
    from parties where business_id = ${businessId} and name in ${db()(names)}
    order by name`) as unknown as Array<{
    id: string;
    name: string;
    type: string;
    phone: string | null;
    gstin: string | null;
    state: string | null;
    state_code: string | null;
    opening_balance: string;
  }>;
}

export async function itemsOf(businessId: string, names: string[]) {
  return (await db()`
    select id, name, hsn, unit, sale_price::text as sale_price, purchase_price::text as purchase_price,
           tax_percent::text as tax_percent, stock_quantity::text as stock_quantity
    from items where business_id = ${businessId} and name in ${db()(names)} and deleted_at is null
    order by name`) as unknown as Array<{
    id: string;
    name: string;
    hsn: string | null;
    unit: string;
    sale_price: string;
    purchase_price: string;
    tax_percent: string;
    stock_quantity: string;
  }>;
}

export async function invoicesNumbered(businessId: string, numbers: string[]) {
  return (await db()`
    select i.id, i.invoice_number, i.invoice_date, i.type, i.status, i.subtotal, i.tax_amount, i.total_amount,
           i.amount_paid, i.source, i.delivery_method, i.terms_and_conditions, p.name as party_name
    from invoices i join parties p on p.id = i.party_id
    where i.business_id = ${businessId} and i.invoice_number in ${db()(numbers)} and i.deleted_at is null
    order by i.invoice_number`) as unknown as Array<{
    id: string;
    invoice_number: string;
    invoice_date: Date;
    type: string;
    status: string;
    subtotal: string;
    tax_amount: string;
    total_amount: string;
    amount_paid: string;
    source: string | null;
    delivery_method: string | null;
    terms_and_conditions: string | null;
    party_name: string;
  }>;
}

export async function tenantPlan(tenantId: string) {
  const [row] = await db()`select plan from tenants where id = ${tenantId}`;
  return (row as { plan: string | null }).plan;
}

// ── Online store (J12) ──────────────────────────────────────────

export async function storeSettings(businessId: string) {
  const [row] = await db()`
    select store_enabled, store_slug, store_tagline, store_min_order_amount, store_delivery_note
    from businesses where id = ${businessId}`;
  return row as {
    store_enabled: boolean;
    store_slug: string | null;
    store_tagline: string | null;
    store_min_order_amount: string | null;
    store_delivery_note: string | null;
  };
}

export async function storeEnabledItems(businessId: string) {
  const rows = await db()`select name from items where business_id = ${businessId} and store_enabled order by name`;
  return rows.map((r) => (r as { name: string }).name);
}

export type StoreOrderRow = {
  id: string;
  order_number: string;
  status: string;
  customer_name: string;
  customer_phone: string;
  delivery_city: string | null;
  delivery_pincode: string | null;
  total_amount: string;
  item_count: number;
  cancellation_reason: string | null;
  confirmed_at: Date | null;
  cancelled_at: Date | null;
  invoice_id: string | null;
  invoice_number: string | null;
  invoice_status: string | null;
  invoice_source: string | null;
  subtotal: string | null;
  tax_amount: string | null;
  invoice_total: string | null;
  party_name: string | null;
};

/** A business's store orders, oldest first, with the invoice each raised. */
export async function storeOrdersOf(businessId: string) {
  return (await db()`
    select o.id, o.order_number, o.status, o.customer_name, o.customer_phone, o.delivery_city, o.delivery_pincode,
           o.total_amount, o.item_count, o.cancellation_reason, o.confirmed_at, o.cancelled_at, o.invoice_id,
           i.invoice_number, i.status as invoice_status, i.source as invoice_source, i.subtotal, i.tax_amount,
           i.total_amount as invoice_total, p.name as party_name
    from store_orders o
    left join invoices i on i.id = o.invoice_id
    left join parties p on p.id = i.party_id
    where o.business_id = ${businessId}
    order by o.created_at`) as unknown as StoreOrderRow[];
}

// ── Platform admin and partners (J13, J14) ──────────────────────

/** A plan's saved overrides (null = the built-in settings). */
export async function planOverride(plan: string) {
  const [row] = await db()`
    select name, tagline, monthly_price_inr, yearly_price_inr, visible, highlight, limits, features from plan_settings where plan = ${plan}`;
  return row as
    | { name: string; tagline: string; monthly_price_inr: number | null; yearly_price_inr: number | null; visible: boolean; highlight: boolean; limits: Record<string, unknown>; features: string[] }
    | undefined;
}

export async function partnerByEmail(email: string) {
  const [row] = await db()`
    select id, status, referral_code, commission_percent, list_publicly, partner_type, company_name, contact_name,
           city, phone, website, client_count, message, reviewed_at
    from partners where email = lower(${email}) order by created_at desc limit 1`;
  return row as
    | {
        id: string;
        status: string;
        referral_code: string | null;
        commission_percent: number | null;
        list_publicly: boolean;
        partner_type: string;
        company_name: string;
        contact_name: string;
        city: string | null;
        phone: string | null;
        website: string | null;
        client_count: string | null;
        message: string | null;
        reviewed_at: Date | null;
      }
    | undefined;
}

export async function partnerPayoutsOf(partnerId: string) {
  return (await db()`
    select period, amount::text as amount, status, reference, paid_at from partner_payouts
    where partner_id = ${partnerId} order by created_at`) as unknown as Array<{
    period: string;
    amount: string;
    status: string;
    reference: string | null;
    paid_at: Date | null;
  }>;
}

export async function roadmapItemsTitled(title: string) {
  return (await db()`select id, status, category, priority from roadmap_items where title = ${title}`) as unknown as Array<{
    id: string;
    status: string;
    category: string;
    priority: string;
  }>;
}

/** Organisations that signed up with a partner's code. */
export async function tenantsReferredBy(partnerId: string) {
  return (await db()`select id, name, plan from tenants where partner_id = ${partnerId} order by created_at`) as unknown as Array<{
    id: string;
    name: string;
    plan: string | null;
  }>;
}
