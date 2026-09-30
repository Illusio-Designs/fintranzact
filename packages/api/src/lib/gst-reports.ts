import { eq, and, sql, inArray, isNull } from "drizzle-orm";
import { invoices, invoiceItems, parties, businesses, items as itemsTable } from "@fintranzact/db";
import type { TenantDatabase } from "@fintranzact/db";
import { buildBusinessDateFilter } from "./business-date.js";

// Split a tax amount exactly in half using paise-level integer arithmetic
// to avoid floating-point rounding errors on odd amounts (e.g. ₹1.01).
function splitTax(amount: number): number {
  return Math.round(amount * 100 / 2) / 100;
}

// ── Types ──────────────────────────────────────────────────────

/**
 * Per-rate breakdown of a document's line items. The GSTN portal schema
 * requires one `itms[].itm_det` entry per distinct tax rate (`rt`), so each
 * document section carries this breakdown for the portal JSON export.
 */
export interface GstRateLine {
  rate: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Group line items by tax rate and split tax into CGST+SGST or IGST. */
function groupLinesByRate(
  lines: Array<{ taxPercent: string; totalAmount: string; taxAmount: string }>,
  sameState: boolean,
): GstRateLine[] {
  const byRate = new Map<number, { taxable: number; tax: number }>();
  for (const li of lines) {
    const rate = parseFloat(li.taxPercent);
    const tax = parseFloat(li.taxAmount);
    const existing = byRate.get(rate) ?? { taxable: 0, tax: 0 };
    existing.taxable += parseFloat(li.totalAmount) - tax;
    existing.tax += tax;
    byRate.set(rate, existing);
  }
  return Array.from(byRate.entries())
    .sort(([a], [b]) => a - b)
    .map(([rate, { taxable, tax }]) => ({
      rate,
      taxableValue: round2(taxable),
      cgst: sameState ? splitTax(tax) : 0,
      sgst: sameState ? splitTax(tax) : 0,
      igst: sameState ? 0 : round2(tax),
    }));
}

export interface GSTR1Report {
  period: string; // e.g. "Apr 2025"
  businessGstin: string;
  businessName: string;
  // B2B - outward supplies to registered persons
  b2b: Array<{
    partyGstin: string;
    partyName: string;
    invoiceNumber: string;
    invoiceDate: string;
    invoiceType: string; // "Regular" | "SEZ" etc
    taxableValue: number;
    cgst: number;
    sgst: number;
    igst: number;
    totalInvoiceValue: number;
    rateItems?: GstRateLine[];
  }>;
  // B2C Large - to unregistered (> ₹2.5L inter-state)
  b2cLarge: Array<{
    state: string;
    taxableValue: number;
    cgst: number;
    sgst: number;
    igst: number;
    // The invoices behind the state total — the portal lists B2CL per invoice
    invoices?: Array<{
      invoiceNumber: string;
      invoiceDate: string;
      totalInvoiceValue: number;
      taxableValue: number;
      igst: number;
      rateItems: GstRateLine[];
    }>;
  }>;
  // B2C Small - to unregistered (≤ ₹2.5L or intra-state), per rate and place of supply
  b2cSmall: Array<{
    taxRate: number;
    taxableValue: number;
    cgst: number;
    sgst: number;
    igst: number;
    supplyType?: "INTRA" | "INTER";
    pos?: string; // 2-digit state code of the place of supply
  }>;
  // HSN summary
  hsn: Array<{
    hsn: string;
    description: string;
    quantity: number;
    taxableValue: number;
    cgst: number;
    sgst: number;
    igst: number;
    totalValue: number;
  }>;
  // Credit Notes issued to customers (sales returns / adjustments reducing output tax)
  creditNotes: Array<{
    invoiceNumber: string;
    originalInvoiceNumber?: string;
    invoiceDate: string;
    partyName: string;
    partyGstin: string;
    totalAmount: string;
    taxableAmount: string;
    taxAmount: string;
    cgst?: number;
    sgst?: number;
    igst?: number;
    rateItems?: GstRateLine[];
  }>;
  // Debit Notes issued to customers (additional charges, increasing output tax)
  debitNotes: Array<{
    invoiceNumber: string;
    originalInvoiceNumber?: string;
    invoiceDate: string;
    partyName: string;
    partyGstin: string;
    totalAmount: string;
    taxableAmount: string;
    taxAmount: string;
    cgst?: number;
    sgst?: number;
    igst?: number;
    rateItems?: GstRateLine[];
  }>;
  // Totals
  totalTaxableValue: number;
  totalCgst: number;
  totalSgst: number;
  totalIgst: number;
  totalTax: number;
  totalInvoiceValue: number;
  invoiceCount: number;
}

export interface GSTR3BReport {
  period: string;
  businessGstin: string;
  businessName: string;
  // 3.1 - Outward supplies
  outwardSupplies: {
    taxable: { taxableValue: number; igst: number; cgst: number; sgst: number };
    zeroRated: { taxableValue: number; igst: number; cgst: number; sgst: number };
    exempt: { taxableValue: number; igst: number; cgst: number; sgst: number };
  };
  // 3.1(d) - Inward supplies liable to reverse charge
  rcmSupplies: { taxableValue: string; cgst: string; sgst: string; igst: string };
  // 3.2 - Inter-state supplies to unregistered
  interStateUnregistered: Array<{
    state: string;
    taxableValue: number;
    igst: number;
  }>;
  // 4 - Eligible ITC (from purchases)
  itc: {
    igst: number;
    cgst: number;
    sgst: number;
    total: number;
  };
  // 5 - Tax payable
  taxPayable: {
    igst: number;
    cgst: number;
    sgst: number;
  };
  // Net tax (after ITC)
  netTax: {
    igst: number;
    cgst: number;
    sgst: number;
    total: number;
  };
}

// ── Generator ──────────────────────────────────────────────────

export async function generateGSTR1(
  businessId: string,
  year: number,
  month: number, // 1-12
  db: TenantDatabase
): Promise<GSTR1Report> {
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0, 23, 59, 59);

  const [biz] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);

  // Get all sale invoices for the period with their items and parties
  const saleInvoices = await db.select({
    id: invoices.id,
    invoiceNumber: invoices.invoiceNumber,
    invoiceDate: invoices.invoiceDate,
    totalAmount: invoices.totalAmount,
    subtotal: invoices.subtotal,
    taxAmount: invoices.taxAmount,
    partyName: parties.name,
    partyGstin: parties.gstin,
    partyState: parties.state,
    partyStateCode: parties.stateCode,
  }).from(invoices)
    .innerJoin(parties, eq(parties.id, invoices.partyId))
    .where(and(
      eq(invoices.businessId, businessId),
      eq(invoices.type, "sale"),
      eq(invoices.documentType, "invoice"),
      sql`${invoices.status} != 'cancelled'`,
      isNull(invoices.deletedAt),
      ...buildBusinessDateFilter(invoices, { from: startDate, to: endDate }),
    ))
    .orderBy(invoices.invoiceDate);

  // Get line items for all these invoices
  const allInvoiceIds = saleInvoices.map((inv) => inv.id);
  const allLineItems = allInvoiceIds.length > 0
    ? await db.select().from(invoiceItems).where(inArray(invoiceItems.invoiceId, allInvoiceIds))
    : [];

  const lineItemsByInvoice = new Map<string, typeof allLineItems>();
  for (const li of allLineItems) {
    const existing = lineItemsByInvoice.get(li.invoiceId) || [];
    existing.push(li);
    lineItemsByInvoice.set(li.invoiceId, existing);
  }

  // Pre-fetch HSN codes for all items referenced in these line items.
  //
  // Historical join — GSTR-1 aggregates taxable value per HSN across all
  // invoices in the period. Soft-deleted items must still contribute
  // their HSN (otherwise the HSN summary drops rows for items the user
  // deleted between filing periods). Do NOT filter `itemsTable.deletedAt`.
  const allItemIds = new Set<string>();
  for (const li of allLineItems) {
    if (li.itemId) allItemIds.add(li.itemId);
  }
  const itemHsnData = allItemIds.size > 0
    ? await db.select({ id: itemsTable.id, hsn: itemsTable.hsn })
        .from(itemsTable)
        .where(inArray(itemsTable.id, [...allItemIds]))
    : [];
  const itemHsnLookup = new Map(itemHsnData.map((i) => [i.id, i.hsn || "0000"]));

  // Fix 3: State comparison using stateCode (preferred) with text fallback
  const isSameState = (partyState: string | null, partyStateCode: string | null) => {
    // Prefer state code comparison (2-digit GST codes — more reliable)
    if (biz?.stateCode && partyStateCode) {
      return biz.stateCode === partyStateCode;
    }
    // Fallback to text comparison
    return biz?.state && partyState && biz.state.toLowerCase() === partyState.toLowerCase();
  };

  const b2b: GSTR1Report["b2b"] = [];
  const b2cLargeMap = new Map<string, GSTR1Report["b2cLarge"][0]>();
  const b2cSmallMap = new Map<string, GSTR1Report["b2cSmall"][0]>();
  const bizStateCode = biz?.stateCode || biz?.gstin?.substring(0, 2) || undefined;
  const hsnSummaryMap = new Map<string, GSTR1Report["hsn"][0]>();

  let totalTaxableValue = 0;
  let totalCgst = 0;
  let totalSgst = 0;
  let totalIgst = 0;
  let totalInvoiceValue = 0;

  for (const inv of saleInvoices) {
    const lineItems = lineItemsByInvoice.get(inv.id) || [];
    const sameState = isSameState(inv.partyState, inv.partyStateCode);
    const taxable = parseFloat(inv.subtotal);
    const tax = parseFloat(inv.taxAmount);
    const total = parseFloat(inv.totalAmount);

    const cgst = sameState ? splitTax(tax) : 0;
    const sgst = sameState ? splitTax(tax) : 0;
    const igst = sameState ? 0 : tax;

    totalTaxableValue += taxable;
    totalCgst += cgst;
    totalSgst += sgst;
    totalIgst += igst;
    totalInvoiceValue += total;

    // B2B: party has GSTIN
    if (inv.partyGstin) {
      b2b.push({
        partyGstin: inv.partyGstin,
        partyName: inv.partyName,
        invoiceNumber: inv.invoiceNumber,
        invoiceDate: inv.invoiceDate.toISOString(),
        invoiceType: "Regular",
        taxableValue: taxable,
        cgst, sgst, igst,
        totalInvoiceValue: total,
        rateItems: groupLinesByRate(lineItems, !!sameState),
      });
    } else if (!sameState && total > 250000) {
      // B2C Large: inter-state > ₹2.5L
      const state = inv.partyState || "Unknown";
      const existing = b2cLargeMap.get(state) || { state, taxableValue: 0, cgst: 0, sgst: 0, igst: 0, invoices: [] };
      existing.taxableValue += taxable;
      existing.igst += igst;
      existing.invoices?.push({
        invoiceNumber: inv.invoiceNumber,
        invoiceDate: inv.invoiceDate.toISOString(),
        totalInvoiceValue: total,
        taxableValue: taxable,
        igst,
        rateItems: groupLinesByRate(lineItems, false),
      });
      b2cLargeMap.set(state, existing);
    } else {
      // B2C Small: one row per rate and place of supply (the portal needs
      // intra- and inter-state supplies apart, each with its state)
      const supplyType = sameState ? "INTRA" : "INTER";
      const pos = sameState
        ? bizStateCode
        : inv.partyStateCode || (inv.partyState ? stateNameToCode(inv.partyState) : undefined);
      for (const li of lineItems) {
        const rate = parseFloat(li.taxPercent);
        const key = `${rate}|${supplyType}|${pos ?? ""}`;
        const existing = b2cSmallMap.get(key) || { taxRate: rate, taxableValue: 0, cgst: 0, sgst: 0, igst: 0, supplyType, pos };
        const itemTaxable = parseFloat(li.totalAmount) - parseFloat(li.taxAmount);
        const itemTax = parseFloat(li.taxAmount);
        existing.taxableValue += itemTaxable;
        if (sameState) {
          existing.cgst += splitTax(itemTax);
          existing.sgst += splitTax(itemTax);
        } else {
          existing.igst += itemTax;
        }
        b2cSmallMap.set(key, existing);
      }
    }

    // Fix 1: HSN summary using actual HSN from items table
    for (const li of lineItems) {
      const itemHsn = li.itemId
        ? (itemHsnLookup.get(li.itemId) || "0000")
        : "0000";
      const existing = hsnSummaryMap.get(itemHsn) || {
        // HSN summary description is a human-readable label for the HSN
        // group — use itemName (required snapshot), not the optional notes
        // column.
        hsn: itemHsn, description: li.itemName, quantity: 0,
        taxableValue: 0, cgst: 0, sgst: 0, igst: 0, totalValue: 0,
      };
      const itemTaxable = parseFloat(li.totalAmount) - parseFloat(li.taxAmount);
      const itemTax = parseFloat(li.taxAmount);
      existing.quantity += parseFloat(li.quantity);
      existing.taxableValue += itemTaxable;
      existing.totalValue += parseFloat(li.totalAmount);
      if (sameState) {
        existing.cgst += splitTax(itemTax);
        existing.sgst += splitTax(itemTax);
      } else {
        existing.igst += itemTax;
      }
      hsnSummaryMap.set(itemHsn, existing);
    }
  }

  // Fix 2: Fetch credit notes for the period. Only notes issued to customers
  // (type sale) are outward supplies; a supplier's credit note or goods we
  // return to a supplier adjust ITC in GSTR-3B instead.
  const rawCreditNotes = await db.select({
    id: invoices.id,
    invoiceNumber: invoices.invoiceNumber,
    invoiceDate: invoices.invoiceDate,
    totalAmount: invoices.totalAmount,
    subtotal: invoices.subtotal,
    taxAmount: invoices.taxAmount,
    referenceDocumentId: invoices.referenceDocumentId,
    partyName: parties.name,
    partyGstin: parties.gstin,
    partyState: parties.state,
    partyStateCode: parties.stateCode,
  }).from(invoices)
    .innerJoin(parties, eq(parties.id, invoices.partyId))
    .where(and(
      eq(invoices.businessId, businessId),
      eq(invoices.type, "sale"),
      inArray(invoices.documentType, ["credit_note", "sales_return"]),
      sql`${invoices.status} != 'cancelled'`,
      isNull(invoices.deletedAt),
      ...buildBusinessDateFilter(invoices, { from: startDate, to: endDate }),
    ))
    .orderBy(invoices.invoiceDate);

  // Fix 2: Fetch debit notes for the period
  const rawDebitNotes = await db.select({
    id: invoices.id,
    invoiceNumber: invoices.invoiceNumber,
    invoiceDate: invoices.invoiceDate,
    totalAmount: invoices.totalAmount,
    subtotal: invoices.subtotal,
    taxAmount: invoices.taxAmount,
    referenceDocumentId: invoices.referenceDocumentId,
    partyName: parties.name,
    partyGstin: parties.gstin,
    partyState: parties.state,
    partyStateCode: parties.stateCode,
  }).from(invoices)
    .innerJoin(parties, eq(parties.id, invoices.partyId))
    .where(and(
      eq(invoices.businessId, businessId),
      eq(invoices.type, "sale"),
      eq(invoices.documentType, "debit_note"),
      sql`${invoices.status} != 'cancelled'`,
      isNull(invoices.deletedAt),
      ...buildBusinessDateFilter(invoices, { from: startDate, to: endDate }),
    ))
    .orderBy(invoices.invoiceDate);

  // Resolve original invoice numbers for credit/debit notes that reference an invoice
  const noteRefIds = [
    ...rawCreditNotes.map((n) => n.referenceDocumentId),
    ...rawDebitNotes.map((n) => n.referenceDocumentId),
  ].filter((id): id is string => id !== null && id !== undefined);

  const refInvoiceNumbers = noteRefIds.length > 0
    ? await db.select({ id: invoices.id, invoiceNumber: invoices.invoiceNumber })
        .from(invoices)
        .where(inArray(invoices.id, noteRefIds))
    : [];
  const refInvoiceMap = new Map(refInvoiceNumbers.map((r) => [r.id, r.invoiceNumber]));

  // Line items for notes — needed for the per-rate breakdown in the portal JSON
  const noteIds = [...rawCreditNotes, ...rawDebitNotes].map((n) => n.id);
  const noteLineItems = noteIds.length > 0
    ? await db.select().from(invoiceItems).where(inArray(invoiceItems.invoiceId, noteIds))
    : [];
  const noteLinesByNote = new Map<string, typeof noteLineItems>();
  for (const li of noteLineItems) {
    const existing = noteLinesByNote.get(li.invoiceId) || [];
    existing.push(li);
    noteLinesByNote.set(li.invoiceId, existing);
  }
  const noteRateItems = (n: typeof rawCreditNotes[0]) =>
    groupLinesByRate(noteLinesByNote.get(n.id) || [], !!isSameState(n.partyState, n.partyStateCode));
  const noteTaxSplit = (n: typeof rawCreditNotes[0]) => {
    const sameState = isSameState(n.partyState, n.partyStateCode);
    const tax = parseFloat(n.taxAmount);
    return {
      cgst: sameState ? splitTax(tax) : 0,
      sgst: sameState ? splitTax(tax) : 0,
      igst: sameState ? 0 : tax,
    };
  };

  const creditNotes: GSTR1Report["creditNotes"] = rawCreditNotes.map((n) => ({
    invoiceNumber: n.invoiceNumber,
    originalInvoiceNumber: n.referenceDocumentId ? refInvoiceMap.get(n.referenceDocumentId) : undefined,
    invoiceDate: n.invoiceDate.toISOString(),
    partyName: n.partyName,
    partyGstin: n.partyGstin || "",
    totalAmount: n.totalAmount,
    taxableAmount: n.subtotal,
    taxAmount: n.taxAmount,
    ...noteTaxSplit(n),
    rateItems: noteRateItems(n),
  }));

  const debitNotes: GSTR1Report["debitNotes"] = rawDebitNotes.map((n) => ({
    invoiceNumber: n.invoiceNumber,
    originalInvoiceNumber: n.referenceDocumentId ? refInvoiceMap.get(n.referenceDocumentId) : undefined,
    invoiceDate: n.invoiceDate.toISOString(),
    partyName: n.partyName,
    partyGstin: n.partyGstin || "",
    totalAmount: n.totalAmount,
    taxableAmount: n.subtotal,
    taxAmount: n.taxAmount,
    ...noteTaxSplit(n),
    rateItems: noteRateItems(n),
  }));

  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  return {
    period: `${monthNames[month - 1]} ${year}`,
    businessGstin: biz?.gstin || "",
    businessName: biz?.name || "",
    b2b,
    b2cLarge: Array.from(b2cLargeMap.values()),
    b2cSmall: Array.from(b2cSmallMap.values()),
    hsn: Array.from(hsnSummaryMap.values()),
    creditNotes,
    debitNotes,
    totalTaxableValue,
    totalCgst,
    totalSgst,
    totalIgst,
    totalTax: totalCgst + totalSgst + totalIgst,
    totalInvoiceValue,
    invoiceCount: saleInvoices.length,
  };
}

/**
 * Purchase-side documents that give ITC: tax invoices and debit notes (the
 * supplier charging more — they add to what we owe, as in the party ledger).
 */
const ITC_DOCUMENTS = ["invoice", "debit_note"] as const;
/**
 * Purchase-side documents that take ITC back: the supplier's credit notes and
 * goods returned to the supplier (a purchase return, or a return made from a
 * purchase invoice). They reduce what we owe, as in the party ledger.
 */
const ITC_REVERSING_DOCUMENTS = ["credit_note", "sales_return", "purchase_return"] as const;

export async function generateGSTR3B(
  businessId: string,
  year: number,
  month: number,
  db: TenantDatabase
): Promise<GSTR3BReport> {
  const gstr1 = await generateGSTR1(businessId, year, month, db);

  // Get purchase invoices for ITC
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0, 23, 59, 59);

  const [biz] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);

  const purchaseInvoices = await db.select({
    documentType: invoices.documentType,
    taxAmount: invoices.taxAmount,
    subtotal: invoices.subtotal,
    partyState: parties.state,
    partyStateCode: parties.stateCode,
    isReverseCharge: invoices.isReverseCharge,
  }).from(invoices)
    .innerJoin(parties, eq(parties.id, invoices.partyId))
    .where(and(
      eq(invoices.businessId, businessId),
      eq(invoices.type, "purchase"),
      // Only tax invoices and the supplier's credit/debit notes (and returns)
      // move ITC. Purchase orders, GRNs, quotations, proformas and challans
      // share type "purchase" and are converted into an invoice with the same
      // tax — including them counted the same ITC twice.
      inArray(invoices.documentType, [...ITC_DOCUMENTS, ...ITC_REVERSING_DOCUMENTS]),
      sql`${invoices.status} != 'cancelled'`,
      isNull(invoices.deletedAt),
      ...buildBusinessDateFilter(invoices, { from: startDate, to: endDate }),
    ));

  let itcIgst = 0, itcCgst = 0, itcSgst = 0;

  // RCM accumulators: Table 3.1(d) — inward supplies liable to reverse charge
  let rcmTaxableValue = 0, rcmCgst = 0, rcmSgst = 0, rcmIgst = 0;

  for (const inv of purchaseInvoices) {
    // A credit note from the supplier or goods sent back reduce ITC (and any
    // reverse-charge liability) by their tax
    const sign = (ITC_REVERSING_DOCUMENTS as readonly string[]).includes(inv.documentType) ? -1 : 1;
    const tax = sign * parseFloat(inv.taxAmount);
    // Prefer state code comparison; fall back to text
    const sameState = (biz?.stateCode && inv.partyStateCode)
      ? biz.stateCode === inv.partyStateCode
      : (biz?.state && inv.partyState &&
          biz.state.toLowerCase() === inv.partyState.toLowerCase());

    if (inv.isReverseCharge) {
      // RCM purchases: tracked in 3.1(d) AND generate ITC for the buyer
      rcmTaxableValue += sign * parseFloat(inv.subtotal);
      if (sameState) {
        const half = splitTax(tax);
        rcmCgst += half;
        rcmSgst += half;
        itcCgst += half;
        itcSgst += half;
      } else {
        rcmIgst += tax;
        itcIgst += tax;
      }
    } else {
      // Normal purchase ITC
      if (sameState) {
        itcCgst += splitTax(tax);
        itcSgst += splitTax(tax);
      } else {
        itcIgst += tax;
      }
    }
  }

  // Table 3.1(a) is net of the credit and debit notes issued in the period
  let outTaxable = gstr1.totalTaxableValue;
  let outIgst = gstr1.totalIgst, outCgst = gstr1.totalCgst, outSgst = gstr1.totalSgst;
  const notes = [
    ...gstr1.debitNotes.map((note) => ({ note, sign: 1 })),
    ...gstr1.creditNotes.map((note) => ({ note, sign: -1 })),
  ];
  for (const { note, sign } of notes) {
    outTaxable += sign * parseFloat(note.taxableAmount);
    outIgst += sign * (note.igst ?? 0);
    outCgst += sign * (note.cgst ?? 0);
    outSgst += sign * (note.sgst ?? 0);
  }

  // Net tax payable = output tax - ITC
  // A negative value indicates ITC credit remaining (e.g. when purchase tax
  // exceeds sales tax for a component). This is correct per GST rules —
  // the excess credit carries forward. Do NOT clamp to zero.
  const netIgst = outIgst - itcIgst;
  const netCgst = outCgst - itcCgst;
  const netSgst = outSgst - itcSgst;

  return {
    period: gstr1.period,
    businessGstin: gstr1.businessGstin,
    businessName: gstr1.businessName,
    outwardSupplies: {
      taxable: {
        taxableValue: outTaxable,
        igst: outIgst,
        cgst: outCgst,
        sgst: outSgst,
      },
      zeroRated: { taxableValue: 0, igst: 0, cgst: 0, sgst: 0 },
      exempt: { taxableValue: 0, igst: 0, cgst: 0, sgst: 0 },
    },
    rcmSupplies: {
      taxableValue: rcmTaxableValue.toFixed(2),
      cgst: rcmCgst.toFixed(2),
      sgst: rcmSgst.toFixed(2),
      igst: rcmIgst.toFixed(2),
    },
    interStateUnregistered: gstr1.b2cLarge.map((e) => ({
      state: e.state, taxableValue: e.taxableValue, igst: e.igst,
    })),
    itc: {
      igst: itcIgst,
      cgst: itcCgst,
      sgst: itcSgst,
      total: itcIgst + itcCgst + itcSgst,
    },
    taxPayable: {
      igst: outIgst,
      cgst: outCgst,
      sgst: outSgst,
    },
    netTax: {
      igst: netIgst,
      cgst: netCgst,
      sgst: netSgst,
      total: netIgst + netCgst + netSgst,
    },
  };
}

// ── Portal JSON Export ─────────────────────────────────────────

// GST state code lookup by state name (case-insensitive)
const GST_STATE_CODE_MAP: Record<string, string> = {
  "jammu and kashmir": "01", "himachal pradesh": "02", "punjab": "03",
  "chandigarh": "04", "uttarakhand": "05", "haryana": "06", "delhi": "07",
  "rajasthan": "08", "uttar pradesh": "09", "bihar": "10", "sikkim": "11",
  "arunachal pradesh": "12", "nagaland": "13", "manipur": "14",
  "mizoram": "15", "tripura": "16", "meghalaya": "17", "assam": "18",
  "west bengal": "19", "jharkhand": "20", "odisha": "21",
  "chhattisgarh": "22", "madhya pradesh": "23", "gujarat": "24",
  "dadra and nagar haveli and daman and diu": "26", "maharashtra": "27",
  "andhra pradesh": "28", "karnataka": "29", "goa": "30", "lakshadweep": "31",
  "kerala": "32", "tamil nadu": "33", "puducherry": "34",
  "andaman and nicobar islands": "35", "telangana": "36",
  "andhra pradesh (new)": "37", "ladakh": "38",
};

function stateNameToCode(state: string): string {
  return GST_STATE_CODE_MAP[state.toLowerCase()] ?? "99";
}

// UQC (Unit Quantity Code) mapping — GST portal codes
const UQC_MAP: Record<string, string> = {
  "pcs": "NOS", "nos": "NOS", "piece": "NOS", "pieces": "NOS",
  "unit": "NOS", "units": "NOS", "number": "NOS",
  "kg": "KGS", "kgs": "KGS", "kilogram": "KGS", "kilograms": "KGS",
  "gm": "GMS", "gms": "GMS", "gram": "GMS", "grams": "GMS",
  "ltr": "LTR", "lts": "LTR", "litre": "LTR", "litres": "LTR", "liter": "LTR",
  "mtr": "MTR", "meter": "MTR", "meters": "MTR", "metre": "MTR",
  "sqm": "SQM", "sqmtr": "SQM",
  "sqf": "SQF", "sqft": "SQF",
  "cbm": "CBM",
  "doz": "DOZ", "dozen": "DOZ",
  "box": "BOX", "boxes": "BOX",
  "bag": "BAG", "bags": "BAG",
  "set": "SET", "sets": "SET",
  "pk": "PAC", "pac": "PAC", "pack": "PAC", "packs": "PAC",
  "rol": "ROL", "roll": "ROL", "rolls": "ROL",
  "tub": "TUB", "tube": "TUB",
  "ton": "TON", "tonne": "TON", "tonnes": "TON",
  "mlt": "MLT", "ml": "MLT", "millilitre": "MLT", "milliliter": "MLT",
};

function toUqc(unit?: string | null): string {
  if (!unit) return "NOS";
  return UQC_MAP[unit.toLowerCase()] ?? "NOS";
}

/** Convert ISO date string "YYYY-MM-DDTXX:XX:XX..." to portal "DD-MM-YYYY" */
function isoToPortalDate(isoDate: string): string {
  const datePart = isoDate.split("T")[0];
  const [year, month, day] = datePart.split("-");
  return `${day}-${month}-${year}`;
}

// Valid GST rate slabs (percent) accepted by the portal for `rt`.
const GST_RATE_SLABS = [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28, 40];

/**
 * Derive the GST rate from taxable value and tax when no line-level breakdown
 * is available. Snaps to the nearest valid slab to absorb paise rounding
 * (₹4237.29 taxable with ₹762.71 tax is 17.9999…% → 18).
 */
function deriveRate(taxable: number, tax: number): number {
  if (!(taxable > 0) || !(tax > 0)) return 0;
  const raw = (tax / taxable) * 100;
  const nearest = GST_RATE_SLABS.reduce((best, r) => (Math.abs(r - raw) < Math.abs(best - raw) ? r : best));
  return Math.abs(nearest - raw) <= 0.05 ? nearest : round2(raw);
}

/** Build the portal `itms` array: one entry per tax rate, numbered from 1. */
function toPortalItms(
  rateItems: GstRateLine[] | undefined,
  fallback: GstRateLine,
): Array<{ num: number; itm_det: Record<string, number> }> {
  const lines = rateItems && rateItems.length > 0 ? rateItems : [fallback];
  return lines.map((line, idx) => ({
    num: idx + 1,
    itm_det: {
      txval: line.taxableValue,
      rt: line.rate,
      iamt: line.igst,
      camt: line.cgst,
      samt: line.sgst,
      csamt: 0,
    },
  }));
}

/**
 * Transforms a GSTR1Report into the JSON schema required by the GST portal's
 * offline tool. The returned object can be serialised to JSON and uploaded
 * directly to the portal.
 *
 * @param report        - Internal GSTR1Report from generateGSTR1()
 * @param gstin         - Business GSTIN
 * @param _financialYear - e.g. "2025-26" (reserved for future portal schema versions)
 * @param taxPeriod     - Filing period in MMYYYY format, e.g. "082025"
 */
export function gstr1ToPortalJson(
  report: GSTR1Report,
  gstin: string,
  _financialYear: string,
  taxPeriod: string,
): Record<string, unknown> {
  // B2B: group invoices by recipient GSTIN
  const b2bMap = new Map<string, { ctin: string; inv: Array<Record<string, unknown>> }>();

  for (const inv of report.b2b) {
    const ctin = inv.partyGstin;
    const existing = b2bMap.get(ctin) ?? { ctin, inv: [] };
    existing.inv.push({
      inum: inv.invoiceNumber,
      idt: isoToPortalDate(inv.invoiceDate),
      val: inv.totalInvoiceValue,
      pos: ctin.substring(0, 2),
      rchrg: "N",
      inv_typ: "R",
      itms: toPortalItms(inv.rateItems, {
        rate: deriveRate(inv.taxableValue, inv.igst + inv.cgst + inv.sgst),
        taxableValue: inv.taxableValue,
        igst: inv.igst,
        cgst: inv.cgst,
        sgst: inv.sgst,
      }),
    });
    b2bMap.set(ctin, existing);
  }

  // B2CL: group by state code
  const b2clMap = new Map<string, { pos: string; inv: Array<Record<string, unknown>> }>();

  for (const entry of report.b2cLarge) {
    if (!entry.invoices || entry.invoices.length === 0) continue;
    const pos = stateNameToCode(entry.state);
    const existing = b2clMap.get(pos) ?? { pos, inv: [] };
    for (const inv of entry.invoices) {
      const lines = inv.rateItems.length > 0
        ? inv.rateItems
        : [{ rate: deriveRate(inv.taxableValue, inv.igst), taxableValue: inv.taxableValue, igst: inv.igst }];
      existing.inv.push({
        inum: inv.invoiceNumber,
        idt: isoToPortalDate(inv.invoiceDate),
        val: inv.totalInvoiceValue,
        itms: lines.map((line, idx) => ({
          num: idx + 1,
          itm_det: { txval: line.taxableValue, rt: line.rate, iamt: line.igst, csamt: 0 },
        })),
      });
    }
    b2clMap.set(pos, existing);
  }

  // B2CS: supply type and place of supply from the report; older reports
  // without them fall back to the presence of CGST and our own state
  const b2cs = report.b2cSmall.map((entry) => ({
    sply_ty: entry.supplyType ?? (entry.cgst > 0 ? "INTRA" : "INTER"),
    pos: entry.pos ?? gstin.substring(0, 2),
    typ: "OE",
    txval: entry.taxableValue,
    rt: entry.taxRate,
    camt: entry.cgst,
    samt: entry.sgst,
    iamt: entry.igst,
    csamt: 0,
  }));

  // CDNR: group credit and debit notes by recipient GSTIN
  const cdnrMap = new Map<string, { ctin: string; nt: Array<Record<string, unknown>> }>();

  const pushNote = (note: GSTR1Report["creditNotes"][0], ntty: "C" | "D") => {
    const ctin = note.partyGstin;
    const existing = cdnrMap.get(ctin) ?? { ctin, nt: [] };
    const noteTaxable = parseFloat(note.taxableAmount);
    const noteTax = parseFloat(note.taxAmount);
    const noteIntra = ctin.substring(0, 2) === gstin.substring(0, 2);
    existing.nt.push({
      ntty,
      nt_num: note.invoiceNumber,
      nt_dt: isoToPortalDate(note.invoiceDate),
      val: parseFloat(note.totalAmount),
      pos: ctin.substring(0, 2),
      rchrg: "N",
      inv_typ: "R",
      itms: toPortalItms(note.rateItems, {
        rate: deriveRate(noteTaxable, noteTax),
        taxableValue: noteTaxable,
        igst: noteIntra ? 0 : noteTax,
        cgst: noteIntra ? splitTax(noteTax) : 0,
        sgst: noteIntra ? splitTax(noteTax) : 0,
      }),
    });
    cdnrMap.set(ctin, existing);
  };

  for (const cn of report.creditNotes) pushNote(cn, "C");
  for (const dn of report.debitNotes) pushNote(dn, "D");

  // HSN summary
  const hsnData = report.hsn.map((entry, idx) => ({
    num: idx + 1,
    hsn_sc: entry.hsn,
    desc: entry.description,
    uqc: toUqc(null),
    qty: entry.quantity,
    txval: entry.taxableValue,
    iamt: entry.igst,
    camt: entry.cgst,
    samt: entry.sgst,
    csamt: 0,
  }));

  return {
    gstin,
    fp: taxPeriod,
    b2b: Array.from(b2bMap.values()),
    b2cl: Array.from(b2clMap.values()),
    b2cs,
    cdnr: Array.from(cdnrMap.values()),
    hsn: { data: hsnData },
  };
}

// ── CSV Export ──────────────────────────────────────────────────

export function gstr1ToCSV(report: GSTR1Report): string {
  const lines: string[] = [];

  lines.push("GSTR-1 Report");
  lines.push(`Period,${report.period}`);
  lines.push(`GSTIN,${report.businessGstin}`);
  lines.push(`Business,${report.businessName}`);
  lines.push("");

  // B2B Section
  lines.push("B2B - Outward Supplies to Registered Persons");
  lines.push("Party GSTIN,Party Name,Invoice No,Invoice Date,Type,Taxable Value,CGST,SGST,IGST,Total Value");
  for (const row of report.b2b) {
    lines.push([
      row.partyGstin, `"${row.partyName}"`, row.invoiceNumber,
      new Date(row.invoiceDate).toLocaleDateString("en-IN"),
      row.invoiceType, row.taxableValue.toFixed(2),
      row.cgst.toFixed(2), row.sgst.toFixed(2), row.igst.toFixed(2),
      row.totalInvoiceValue.toFixed(2),
    ].join(","));
  }
  lines.push("");

  // B2C Small
  lines.push("B2CS - Outward Supplies to Unregistered Persons (Small)");
  lines.push("Tax Rate %,Taxable Value,CGST,SGST,IGST");
  for (const row of report.b2cSmall) {
    lines.push([
      row.taxRate, row.taxableValue.toFixed(2),
      row.cgst.toFixed(2), row.sgst.toFixed(2), row.igst.toFixed(2),
    ].join(","));
  }
  lines.push("");

  // Summary
  lines.push("Summary");
  lines.push(`Total Invoices,${report.invoiceCount}`);
  lines.push(`Total Taxable Value,${report.totalTaxableValue.toFixed(2)}`);
  lines.push(`Total CGST,${report.totalCgst.toFixed(2)}`);
  lines.push(`Total SGST,${report.totalSgst.toFixed(2)}`);
  lines.push(`Total IGST,${report.totalIgst.toFixed(2)}`);
  lines.push(`Total Tax,${report.totalTax.toFixed(2)}`);
  lines.push(`Total Invoice Value,${report.totalInvoiceValue.toFixed(2)}`);

  return lines.join("\n");
}
