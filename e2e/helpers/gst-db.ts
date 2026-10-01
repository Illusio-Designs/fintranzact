/**
 * gst-db.ts — Direct database reads for the GST journeys (J9, J10).
 *
 * The journeys check what the GST screens show against what was stored:
 * each document's dates, totals and tax split by state, the ITC ledger, the
 * GSTR-2B reconciliation rows and stock movements. The tax heads are worked
 * out here from the stored tax and the two state codes, independently of the
 * app's report code.
 */
import { db } from "./db";

export type GstDocRow = {
  id: string;
  type: "sale" | "purchase";
  document_type: string;
  status: string;
  invoice_number: string;
  supplier_invoice_number: string | null;
  invoice_date: Date;
  reference_document_id: string | null;
  subtotal: string;
  discount_amount: string;
  additional_charges: string;
  tax_amount: string;
  total_amount: string;
  amount_paid: string;
  party_id: string;
  party_gstin: string | null;
  party_state_code: string | null;
  business_state_code: string | null;
};

/** Every live document of the business, in date order. */
export async function gstDocuments(businessId: string) {
  return (await db()`
    select i.id, i.type, i.document_type, i.status, i.invoice_number, i.supplier_invoice_number, i.invoice_date,
           i.reference_document_id, i.subtotal, i.discount_amount, i.additional_charges, i.tax_amount, i.total_amount,
           i.amount_paid, i.party_id, p.gstin as party_gstin, p.state_code as party_state_code,
           b.state_code as business_state_code
    from invoices i join parties p on p.id = i.party_id join businesses b on b.id = i.business_id
    where i.business_id = ${businessId} and i.deleted_at is null
    order by i.invoice_date, i.created_at`) as unknown as GstDocRow[];
}

/** Value of supply: lines less the document discount, plus charges. */
export function taxableOf(d: Pick<GstDocRow, "subtotal" | "discount_amount" | "additional_charges">) {
  return round2(Number(d.subtotal) - Number(d.discount_amount) + Number(d.additional_charges));
}

/**
 * The tax heads of a document from its stored tax and the two states: same
 * state → CGST = half (rounded to the paisa), SGST the rest; else all IGST.
 */
export function taxHeadsOf(d: Pick<GstDocRow, "tax_amount" | "party_state_code" | "business_state_code">) {
  const tax = Number(d.tax_amount);
  if (d.party_state_code && d.business_state_code && d.party_state_code !== d.business_state_code) {
    return { cgst: 0, sgst: 0, igst: round2(tax) };
  }
  const cgst = Math.round(tax * 50) / 100;
  return { cgst, sgst: round2(tax - cgst), igst: 0 };
}

export function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/** Lines of a document with each line's HSN and the item's unit. */
export async function gstLines(documentId: string) {
  return (await db()`
    select ii.item_id, it.hsn, it.unit, ii.quantity, ii.unit_price, ii.tax_percent, ii.tax_amount, ii.total_amount
    from invoice_items ii left join items it on it.id = ii.item_id
    where ii.invoice_id = ${documentId} order by ii.sort_order`) as unknown as Array<{
    item_id: string;
    hsn: string | null;
    unit: string | null;
    quantity: string;
    unit_price: string;
    tax_percent: string;
    tax_amount: string;
    total_amount: string;
  }>;
}

/** Net stock movements of an item per reference type (positive = in). */
export async function stockByReference(itemId: string) {
  const rows = (await db()`
    select reference_type, sum(quantity)::text as qty from stock_movements
    where item_id = ${itemId} group by reference_type order by reference_type`) as unknown as Array<{ reference_type: string; qty: string }>;
  return Object.fromEntries(rows.map((r) => [r.reference_type, Number(r.qty)]));
}

/** The ITC ledger of the business for a return period ("2026-09"). */
export async function itcLedgerFor(businessId: string, returnPeriod: string) {
  return (await db()`
    select invoice_id, status, cgst::text as cgst, sgst::text as sgst, igst::text as igst
    from itc_ledger_entries where business_id = ${businessId} and return_period = ${returnPeriod}
    order by created_at`) as unknown as Array<{ invoice_id: string; status: string; cgst: string; sgst: string; igst: string }>;
}

/** The latest GSTR-2B upload for the period and its reconciled rows. */
export async function gstr2bUpload(businessId: string, returnPeriod: string) {
  const [upload] = await db()`
    select id, file_name, total_records, matched_records, unmatched_records, new_records
    from gstr2b_uploads where business_id = ${businessId} and return_period = ${returnPeriod}
    order by uploaded_at desc limit 1`;
  if (!upload) return undefined;
  const records = (await db()`
    select supplier_gstin, invoice_number, taxable_value::text as taxable_value, cgst::text as cgst, sgst::text as sgst,
           igst::text as igst, match_status, matched_invoice_id, mismatch_reasons
    from gstr2b_records where upload_id = ${(upload as { id: string }).id} order by invoice_number`) as unknown as Array<{
    supplier_gstin: string;
    invoice_number: string;
    taxable_value: string;
    cgst: string;
    sgst: string;
    igst: string;
    match_status: string;
    matched_invoice_id: string | null;
    mismatch_reasons: string[] | null;
  }>;
  return { upload: upload as Record<string, unknown>, records };
}

/** Payments of the business with their allocations. */
export async function paymentsOfBusiness(businessId: string) {
  return (await db()`
    select p.id, p.party_id, p.invoice_id, p.amount::text as amount, p.mode, p.payment_date,
           coalesce(json_agg(json_build_object('invoiceId', pa.invoice_id, 'amount', pa.amount)) filter (where pa.id is not null), '[]') as allocations
    from payments p left join payment_allocations pa on pa.payment_id = p.id
    where p.business_id = ${businessId} and p.deleted_at is null
    group by p.id order by p.payment_date`) as unknown as Array<{
    id: string;
    party_id: string;
    invoice_id: string | null;
    amount: string;
    mode: string;
    payment_date: Date;
    allocations: Array<{ invoiceId: string; amount: string }>;
  }>;
}
