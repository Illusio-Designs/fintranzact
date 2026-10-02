/**
 * gstr4.ts — GSTR-4 (annual return of a composition taxpayer) data tables.
 *
 * Data only: the portal JSON and the UI page are separate. The outward side and
 * the tax payable are NOT re-derived here: they come from the four CMP-08
 * quarters (buildCmp08Quarter / loadCmp08Quarter), so the two can never differ.
 *
 * UNCERTAIN MAPPINGS (verify with a CA against the current GSTR-4 form):
 *  - Table numbering and the Table 4 sub-rows follow the post-2021 form
 *    (4A registered non-RCM, 4B registered RCM, 4C unregistered, 4D import of
 *    services); the app has no explicit GSTR-4 field, so rows are keyed by
 *    meaning, not by portal code.
 *  - A purchase counts as "registered" when the supplier party has a GSTIN or a
 *    registration type of regular/composition/sez/uin; "overseas" parties are
 *    import of services (the app cannot tell goods from services, so imports of
 *    goods bought from an overseas party are included here — flagged).
 *  - Non-RCM purchases carry no tax payable by the recipient: only the taxable
 *    value is shown. The tax on the supplier's invoice is not a liability here.
 *  - Unregistered purchases without the reverse-charge flag are shown with zero
 *    tax: the app does not auto-apply s.9(4) RCM, the user flags documents.
 *  - Cess: the app stores no cess on documents, so cess is always "0.00".
 *  - Exempt / nil-rated / non-GST outward supplies: not tracked separately in
 *    the app (CMP-08 taxes all outward turnover), so those rows are zero.
 *  - Purchases from a composition supplier (bill of supply) are shown under
 *    "registered"; the form may want them in a separate exempt/nil row.
 *  - Late fee for GSTR-4 is applicable but not computed (field = 0).
 */

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { businesses, invoices, parties } from "@fintranzact/db";
import type { TenantDatabase } from "@fintranzact/db";
import { compositionQuarterRange, gstr4DueDate, isIntraStateSupply, money, splitIntraStateTax } from "@fintranzact/shared";
import { buildBusinessDateFilter } from "./business-date.js";
import { cmp08DocumentValue, loadCmp08Quarter, type Cmp08Document, type Cmp08Quarter } from "./cmp08.js";

const PURCHASE_ADDING = ["invoice"] as const;
const PURCHASE_REDUCING = ["credit_note", "sales_return", "purchase_return", "debit_note"] as const;

export type Gstr4InwardKind =
  | "registered_non_rcm"
  | "registered_rcm"
  | "unregistered_rcm"
  | "unregistered_non_rcm"
  | "import_of_services";

export interface Gstr4PurchaseDocument extends Cmp08Document {
  taxAmount: string;
  isReverseCharge: boolean;
  /** Supplier is in another state (decides integrated vs central + state tax). */
  interState: boolean;
  partyGstin: string | null;
  partyRegistrationType: string | null;
}

export interface Gstr4Input {
  financialYear: string;
  /** True when the business is registered under the composition scheme. */
  isComposition: boolean;
  /** The four CMP-08 quarters in order (Q4's figures are the GSTR-4 part). */
  quarters: Cmp08Quarter[];
  /** Purchase documents of the whole year (cancelled/deleted already left out). */
  purchases: Gstr4PurchaseDocument[];
  /**
   * Total (outward composition tax + RCM tax) actually paid through CMP-08 per
   * quarter. A quarter left out is assumed paid in full.
   */
  cmp08Paid?: { 1?: string; 2?: string; 3?: string };
}

export interface Gstr4InwardRow {
  kind: Gstr4InwardKind;
  label: string;
  taxableValue: string;
  centralTax: string;
  stateTax: string;
  integratedTax: string;
  cess: string;
  /** Tax paid on reverse charge (0 for rows where the recipient pays none). */
  tax: string;
  documentCount: number;
}

export interface Gstr4Report {
  financialYear: string;
  isComposition: boolean;
  dueDate: Date;
  /** Table 4: inward supplies. */
  inward: { rows: Gstr4InwardRow[]; totalTaxableValue: string; totalRcmTax: string };
  /** Table 5: outward supplies by the composition taxpayer. */
  outward: {
    quarters: { quarter: 1 | 2 | 3 | 4; taxableValue: string; rate: string; tax: string }[];
    taxableValue: string;
    tax: string;
    /** Not tracked by the app: always zero. */
    exempt: string;
    nilRated: string;
    nonGst: string;
  };
  /** Table 6: tax-rate-wise summary (composition rate is single, so usually one row). */
  rateWise: { rate: string; taxableValue: string; centralTax: string; stateTax: string; integratedTax: string; tax: string }[];
  taxPaid: {
    /** Composition tax on outward supplies for the year (sum of the four quarters). */
    compositionTaxPayable: string;
    /** Tax on reverse-charge inward supplies for the year (from CMP-08 RCM, all quarters). */
    rcmTaxPayable: string;
    totalPayable: string;
    quarters: { quarter: 1 | 2 | 3 | 4; payable: string; paid: string; paidAssumed: boolean }[];
    paidThroughCmp08: string;
    /** True when any of Q1-Q3 was assumed paid in full because no amount was given. */
    paidAssumed: boolean;
    /** Balance to pay with GSTR-4 (Q4 and any unpaid earlier tax). */
    balancePayable: string;
    /** Paid more than payable: carried as cash-ledger balance, not refunded here. */
    excessPaid: string;
    interest: string;
    interestNote: string;
    lateFee: string;
    lateFeeNote: string;
  };
  notes: string[];
}

const ROW_LABELS: Record<Gstr4InwardKind, string> = {
  registered_non_rcm: "Inward supplies from registered suppliers (other than reverse charge)",
  registered_rcm: "Inward supplies from registered suppliers attracting reverse charge",
  unregistered_rcm: "Inward supplies from unregistered suppliers attracting reverse charge",
  unregistered_non_rcm: "Inward supplies from unregistered suppliers (not flagged reverse charge)",
  import_of_services: "Import of services",
};
const ROW_ORDER: Gstr4InwardKind[] = [
  "registered_non_rcm", "registered_rcm", "unregistered_rcm", "unregistered_non_rcm", "import_of_services",
];

const REGISTERED_TYPES = ["regular", "composition", "sez", "uin"];

/** Pure: which Table 4 row a purchase document belongs to. */
export function classifyGstr4Purchase(doc: Pick<Gstr4PurchaseDocument, "isReverseCharge" | "partyGstin" | "partyRegistrationType">): Gstr4InwardKind {
  const type = (doc.partyRegistrationType ?? "").toLowerCase();
  if (type === "overseas") return "import_of_services";
  const registered = !!(doc.partyGstin && doc.partyGstin.trim()) || REGISTERED_TYPES.includes(type);
  if (registered) return doc.isReverseCharge ? "registered_rcm" : "registered_non_rcm";
  return doc.isReverseCharge ? "unregistered_rcm" : "unregistered_non_rcm";
}

/** Pure: build the GSTR-4 tables. */
export function buildGstr4(input: Gstr4Input): Gstr4Report {
  const { financialYear, quarters } = input;
  const notes: string[] = [
    "Outward turnover and composition tax come from the four CMP-08 quarters.",
    "Exempt, nil-rated and non-GST outward supplies are not tracked separately; shown as zero.",
    "Cess is not tracked on documents; shown as zero.",
  ];
  if (!input.isComposition) notes.push("This business is not registered under the composition scheme: GSTR-4 does not apply.");

  // Table 4
  const acc = new Map<Gstr4InwardKind, { taxable: string; cgst: string; sgst: string; igst: string; count: number }>();
  for (const k of ROW_ORDER) acc.set(k, { taxable: "0.00", cgst: "0.00", sgst: "0.00", igst: "0.00", count: 0 });
  for (const doc of input.purchases) {
    const kind = classifyGstr4Purchase(doc);
    const a = acc.get(kind)!;
    const reducing = (PURCHASE_REDUCING as readonly string[]).includes(doc.documentType);
    const signed = (v: string) => (reducing ? money.sub("0", v) : v);
    a.taxable = money.add(a.taxable, signed(cmp08DocumentValue(doc)));
    a.count += 1;
    // Only reverse-charge supplies carry tax the recipient pays; imports of
    // services are always integrated tax payable by the recipient.
    const taxPaidByRecipient = doc.isReverseCharge || kind === "import_of_services";
    if (taxPaidByRecipient) {
      const tax = signed(doc.taxAmount);
      if (doc.interState || kind === "import_of_services") {
        a.igst = money.add(a.igst, tax);
      } else {
        const h = splitIntraStateTax(tax);
        a.cgst = money.add(a.cgst, h.cgst);
        a.sgst = money.add(a.sgst, h.sgst);
      }
    }
  }
  const rows: Gstr4InwardRow[] = ROW_ORDER.map((kind) => {
    const a = acc.get(kind)!;
    return {
      kind, label: ROW_LABELS[kind],
      taxableValue: a.taxable, centralTax: a.cgst, stateTax: a.sgst, integratedTax: a.igst, cess: "0.00",
      tax: money.sum([a.cgst, a.sgst, a.igst]), documentCount: a.count,
    };
  });
  const hasOverseas = rows.find((r) => r.kind === "import_of_services")!.documentCount > 0;
  if (hasOverseas) notes.push("Purchases from overseas parties are all reported as import of services; the app cannot tell goods from services.");

  // Table 5 / 6 straight from CMP-08
  const outQuarters = quarters.map((q) => ({ quarter: q.quarter, taxableValue: q.taxableValue, rate: q.rate, tax: q.taxPayable }));
  const outTaxable = money.sum(quarters.map((q) => q.taxableValue));
  const outTax = money.sum(quarters.map((q) => q.taxPayable));
  const rateMap = new Map<string, { taxable: string; cgst: string; sgst: string; igst: string; tax: string }>();
  for (const q of quarters) {
    const r = rateMap.get(q.rate) ?? { taxable: "0.00", cgst: "0.00", sgst: "0.00", igst: "0.00", tax: "0.00" };
    r.taxable = money.add(r.taxable, q.taxableValue);
    r.cgst = money.add(r.cgst, q.centralTax);
    r.sgst = money.add(r.sgst, q.stateTax);
    r.igst = money.add(r.igst, q.integratedTax);
    r.tax = money.add(r.tax, q.taxPayable);
    rateMap.set(q.rate, r);
  }
  const rateWise = [...rateMap.entries()].map(([rate, r]) => ({
    rate, taxableValue: r.taxable, centralTax: r.cgst, stateTax: r.sgst, integratedTax: r.igst, tax: r.tax,
  }));

  // Tax paid
  const rcmTaxPayable = money.sum(quarters.map((q) => q.rcm.tax));
  const totalPayable = money.add(outTax, rcmTaxPayable);
  let paidAssumed = false;
  let paidThrough = "0.00";
  const quarterPay = quarters.map((q) => {
    const payable = money.add(q.taxPayable, q.rcm.tax);
    if (q.quarter === 4) return { quarter: q.quarter, payable, paid: "0.00", paidAssumed: false };
    const given = input.cmp08Paid?.[q.quarter as 1 | 2 | 3];
    const assumed = given == null;
    if (assumed) paidAssumed = true;
    const paid = money.add(assumed ? payable : given, 0);
    paidThrough = money.add(paidThrough, paid);
    return { quarter: q.quarter, payable, paid, paidAssumed: assumed };
  });
  if (paidAssumed) notes.push("Payment is not tracked: quarters without a given amount are assumed paid in full through CMP-08.");
  const diff = money.sub(totalPayable, paidThrough);
  const balance = money.isPositive(diff) ? diff : "0.00";
  const excess = money.isPositive(diff) ? "0.00" : money.sub("0", diff);
  const interest = money.sum(quarters.map((q) => q.interest));

  return {
    financialYear,
    isComposition: input.isComposition,
    dueDate: gstr4DueDate(financialYear),
    inward: {
      rows,
      totalTaxableValue: money.sum(rows.map((r) => r.taxableValue)),
      totalRcmTax: money.sum(rows.map((r) => r.tax)),
    },
    outward: { quarters: outQuarters, taxableValue: outTaxable, tax: outTax, exempt: "0.00", nilRated: "0.00", nonGst: "0.00" },
    rateWise,
    taxPaid: {
      compositionTaxPayable: outTax, rcmTaxPayable, totalPayable,
      quarters: quarterPay, paidThroughCmp08: paidThrough, paidAssumed,
      balancePayable: balance, excessPaid: excess,
      interest,
      interestNote: "Interest is only what CMP-08 could work out from known payment dates; late interest on the GSTR-4 balance is not computed.",
      lateFee: "0.00",
      lateFeeNote: "Late fee for GSTR-4 is applicable after the due date but is not computed here.",
    },
    notes,
  };
}

export class Gstr4NotApplicableError extends Error {
  constructor() {
    super("GSTR-4 is only for businesses registered under the composition scheme.");
    this.name = "Gstr4NotApplicableError";
  }
}

/** Reads the year's documents and builds GSTR-4. Throws Gstr4NotApplicableError for non-composition businesses. */
export async function loadGstr4(
  db: TenantDatabase, businessId: string, financialYear: string,
  cmp08Paid?: Gstr4Input["cmp08Paid"],
): Promise<Gstr4Report> {
  const [biz] = await db.select({
    stateCode: businesses.stateCode, state: businesses.state, gstin: businesses.gstin,
    gstRegistrationType: businesses.gstRegistrationType,
  }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!biz || biz.gstRegistrationType !== "composition") throw new Gstr4NotApplicableError();

  const quarters: Cmp08Quarter[] = [];
  for (const q of [1, 2, 3, 4] as const) quarters.push(await loadCmp08Quarter(db, businessId, financialYear, q));

  const from = compositionQuarterRange(financialYear, 1).from;
  const to = compositionQuarterRange(financialYear, 4).to;
  const rows = await db.select({
    documentType: invoices.documentType,
    subtotal: invoices.subtotal,
    discountAmount: invoices.discountAmount,
    additionalCharges: invoices.additionalCharges,
    taxAmount: invoices.taxAmount,
    isReverseCharge: invoices.isReverseCharge,
    partyState: parties.state,
    partyStateCode: parties.stateCode,
    partyGstin: parties.gstin,
    partyRegistrationType: parties.gstRegistrationType,
  }).from(invoices)
    .innerJoin(parties, eq(parties.id, invoices.partyId))
    .where(and(
      eq(invoices.businessId, businessId),
      eq(invoices.type, "purchase"),
      inArray(invoices.documentType, [...PURCHASE_ADDING, ...PURCHASE_REDUCING]),
      sql`${invoices.status} != 'cancelled'`,
      isNull(invoices.deletedAt),
      ...buildBusinessDateFilter(invoices, { from, to }),
    ));
  const purchases: Gstr4PurchaseDocument[] = rows.map((r) => ({
    documentType: r.documentType,
    subtotal: r.subtotal,
    discountAmount: r.discountAmount,
    additionalCharges: r.additionalCharges,
    taxAmount: r.taxAmount,
    isReverseCharge: !!r.isReverseCharge,
    partyGstin: r.partyGstin,
    partyRegistrationType: r.partyRegistrationType,
    interState: !isIntraStateSupply(
      { stateCode: biz.stateCode, state: biz.state, gstin: biz.gstin },
      { stateCode: r.partyStateCode, state: r.partyState, gstin: r.partyGstin },
    ),
  }));

  return buildGstr4({ financialYear, isComposition: true, quarters, purchases, cmp08Paid });
}
