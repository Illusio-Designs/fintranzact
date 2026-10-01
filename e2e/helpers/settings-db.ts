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
};

export async function businessProfile(businessId: string) {
  const [row] = await db()`
    select name, legal_name, email, phone, address_line_2, udyam_number,
           logo_mime_type, logo_width, logo_data is not null as logo_has_data,
           signature_mime_type, signature_data is not null as signature_has_data,
           invoice_prefix, next_invoice_number, default_terms_and_conditions, custom_shipping_methods,
           barcodes_enabled, barcode_type, barcode_mode, barcode_setup_locked_at, pos_enabled,
           e_way_bill_enabled, e_way_bill_threshold
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
