/**
 * gstr4.ts — GSTR-4 (annual return of a composition taxpayer) data tables.
 *
 * Data only: the portal JSON and the UI page are separate. The outward side and
 * the tax payable are NOT re-derived here: they come from the four CMP-08
 * quarters (buildCmp08Quarter / loadCmp08Quarter), so the two can never differ.
 * All four quarters have a CMP-08 (Q4 due 18 April); GSTR-4 reconciles them.
 *
 * Table layout (best known from secondary sources; verify against the GST
 * offline tool): Table 4 inward supplies (4A registered non-RCM, 4B registered
 * RCM, 4C unregistered, 4D import of services); Table 5 summary of
 * self-assessed liability per CMP-08 (four quarters); Table 6 tax rate-wise
 * inward (RCM) and outward supplies; Table 7 TDS/TCS credit received (the app
 * has no such data: zero); Table 8 tax, interest and late fee payable / paid.
 * Due date, interest rate and late fee come from the resolved composition
 * settings (business FY override -> built-in versioned default).
 *
 * UNCERTAIN MAPPINGS (verify with a CA against the current GSTR-4 form):
 *  - The app has no explicit GSTR-4 field, so rows are keyed by meaning, not
 *    by portal code.
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
 *  - Late fee is computed only when a filing date is given; interest on the
 *    balance runs from the GSTR-4 due date (approximation: unpaid tax is really
 *    late from its own CMP-08 due date).
 */

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { businesses, invoices, parties } from "@fintranzact/db";
import type { TenantDatabase } from "@fintranzact/db";
import {
  compositionInterest, compositionQuarterRange, gstr4LateFee, isIntraStateSupply, money, resolveCompositionSettings, splitIntraStateTax,
  type Gstr4LateFee, type ResolvedCompositionSettings,
} from "@fintranzact/shared";
import { buildBusinessDateFilter } from "./business-date.js";
import { cmp08DocumentValue, loadCmp08Quarter, loadCompositionSetting, type Cmp08Document, type Cmp08Quarter } from "./cmp08.js";

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
  /** The four CMP-08 quarters in order. */
  quarters: Cmp08Quarter[];
  /** Effective settings (due date, interest, late fee); default: the built-in defaults for the year, composition category from quarters. */
  settings?: ResolvedCompositionSettings;
  /** When GSTR-4 is / was filed and the balance paid: interest on the balance and the late fee are worked out only when known. */
  filedOn?: Date | null;
  /** Purchase documents of the whole year (cancelled/deleted already left out). */
  purchases: Gstr4PurchaseDocument[];
  /**
   * Total (outward composition tax + RCM tax) actually paid through CMP-08 per
   * quarter. A quarter left out is assumed paid in full.
   */
  cmp08Paid?: { 1?: string; 2?: string; 3?: string; 4?: string };
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
  /** "override" when the business set the due date for the year (e.g. a notified extension). */
  dueDateSource: "default" | "override";
  /** Table 4: inward supplies. */
  inward: { rows: Gstr4InwardRow[]; totalTaxableValue: string; totalRcmTax: string };
  /** Table 5: summary of self-assessed liability per CMP-08, four quarters. */
  cmp08Summary: {
    quarters: {
      quarter: 1 | 2 | 3 | 4; taxableValue: string; rate: string;
      compositionTax: string; rcmTax: string; totalTax: string; dueDate: Date;
    }[];
    taxableValue: string;
    compositionTax: string;
    rcmTax: string;
    totalTax: string;
  };
  /** Table 6: tax rate-wise, outward (composition rate; usually one row) and inward under reverse charge. */
  rateWise: {
    outward: { rate: string; taxableValue: string; centralTax: string; stateTax: string; integratedTax: string; tax: string }[];
    inwardRcm: { taxableValue: string; centralTax: string; stateTax: string; integratedTax: string; tax: string };
    /** Not tracked by the app: always zero. */
    exempt: string;
    nilRated: string;
    nonGst: string;
  };
  /** Table 7: TDS / TCS credit received. Not held by the app: zero. */
  tdsTcs: { tds: string; tcs: string; note: string };
  /** Table 8: tax, interest and late fee payable / paid. */
  taxPaid: {
    /** Composition tax on outward supplies for the year (sum of the four quarters). */
    compositionTaxPayable: string;
    /** Tax on reverse-charge inward supplies for the year (from CMP-08 RCM, all quarters). */
    rcmTaxPayable: string;
    totalPayable: string;
    quarters: { quarter: 1 | 2 | 3 | 4; payable: string; paid: string; paidAssumed: boolean }[];
    paidThroughCmp08: string;
    /** True when any quarter was assumed paid in full because no amount was given. */
    paidAssumed: boolean;
    /** Balance still to pay with GSTR-4 (tax not paid through CMP-08). */
    balancePayable: string;
    /** Paid more than payable: carried as cash-ledger balance, not refunded here. */
    excessPaid: string;
    /** Interest total: CMP-08 interest known from payment dates + interest on the balance. */
    interest: string;
    /** Interest on the balance from the GSTR-4 due date to the filing date. */
    interestOnBalance: string;
    interestRatePercent: string;
    interestNote: string;
    /** Late fee, CGST + SGST; "0.00" until a filing date is given. */
    lateFee: string;
    lateFeeDetail: Gstr4LateFee | null;
    /** True when the return has no turnover and no tax (the lower nil late fee applies). */
    nilReturn: boolean;
    filingDateKnown: boolean;
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
    "Table 5 turnover and composition tax come from the four CMP-08 quarters (all four are filed, Q4 due 18 April).",
    "Exempt, nil-rated and non-GST outward supplies are not tracked separately; shown as zero.",
    "Cess is not tracked on documents; shown as zero.",
    "Table 7 (TDS/TCS credit received) has no data in Fintranzact: shown as zero.",
  ];
  if (!input.isComposition) notes.push("This business is not registered under the composition scheme: GSTR-4 does not apply.");

  // Table 4: inward supplies
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
  const outTaxable = money.sum(quarters.map((q) => q.taxableValue));
  const outTax = money.sum(quarters.map((q) => q.taxPayable));
  const rcmTaxPayable = money.sum(quarters.map((q) => q.rcm.tax));
  const cmp08Summary = {
    quarters: quarters.map((q) => ({
      quarter: q.quarter, taxableValue: q.taxableValue, rate: q.rate,
      compositionTax: q.taxPayable, rcmTax: q.rcm.tax, totalTax: money.add(q.taxPayable, q.rcm.tax), dueDate: q.dueDate,
    })),
    taxableValue: outTaxable, compositionTax: outTax, rcmTax: rcmTaxPayable, totalTax: money.add(outTax, rcmTaxPayable),
  };
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
  const rateWise = {
    outward: [...rateMap.entries()].map(([rate, r]) => ({
      rate, taxableValue: r.taxable, centralTax: r.cgst, stateTax: r.sgst, integratedTax: r.igst, tax: r.tax,
    })),
    inwardRcm: {
      taxableValue: money.sum(quarters.map((q) => q.rcm.taxableValue)),
      centralTax: money.sum(quarters.map((q) => q.rcm.centralTax)),
      stateTax: money.sum(quarters.map((q) => q.rcm.stateTax)),
      integratedTax: money.sum(quarters.map((q) => q.rcm.integratedTax)),
      tax: rcmTaxPayable,
    },
    exempt: "0.00", nilRated: "0.00", nonGst: "0.00",
  };

  // Table 8: tax paid
  const totalPayable = money.add(outTax, rcmTaxPayable);
  let paidAssumed = false;
  let paidThrough = "0.00";
  const quarterPay = quarters.map((q) => {
    const payable = money.add(q.taxPayable, q.rcm.tax);
    const given = input.cmp08Paid?.[q.quarter];
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

  const settings = input.settings ?? resolveCompositionSettings(financialYear, quarters[0]?.category);
  const dueDate = settings.gstr4DueDate;
  const filedOn = input.filedOn ?? null;
  const cmp08Interest = money.sum(quarters.map((q) => q.interest));
  const interestOnBalance = filedOn
    ? compositionInterest(balance, dueDate, filedOn, parseFloat(settings.interestRatePercent))
    : "0.00";
  const nilReturn = !money.isPositive(outTaxable) && !money.isPositive(totalPayable);
  const lateFeeDetail = filedOn ? gstr4LateFee(dueDate, filedOn, nilReturn, settings.lateFee) : null;

  return {
    financialYear,
    isComposition: input.isComposition,
    dueDate,
    dueDateSource: settings.sources.gstr4DueDate,
    inward: {
      rows,
      totalTaxableValue: money.sum(rows.map((r) => r.taxableValue)),
      totalRcmTax: money.sum(rows.map((r) => r.tax)),
    },
    cmp08Summary,
    rateWise,
    tdsTcs: {
      tds: "0.00", tcs: "0.00",
      note: "TDS/TCS credit received is not held by Fintranzact for this table: enter it from the portal.",
    },
    taxPaid: {
      compositionTaxPayable: outTax, rcmTaxPayable, totalPayable,
      quarters: quarterPay, paidThroughCmp08: paidThrough, paidAssumed,
      balancePayable: balance, excessPaid: excess,
      interest: money.add(cmp08Interest, interestOnBalance),
      interestOnBalance,
      interestRatePercent: settings.interestRatePercent,
      interestNote: filedOn
        ? `Interest at ${settings.interestRatePercent}% a year: CMP-08 interest from known payment dates, plus interest on the balance from the GSTR-4 due date to the filing date.`
        : "Enter the date GSTR-4 is filed and the balance paid to work out interest on the balance. CMP-08 interest shows only for quarters with a known payment date.",
      lateFee: lateFeeDetail?.fee ?? "0.00",
      lateFeeDetail,
      nilReturn,
      filingDateKnown: filedOn !== null,
      lateFeeNote: filedOn
        ? `Late fee ${nilReturn ? "(nil return) " : ""}${settings.lateFee[nilReturn ? "nilPerDay" : "perDay"]} a day, at most ${settings.lateFee[nilReturn ? "nilCap" : "cap"]}.`
        : "Enter the filing date to compute the late fee.",
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
  filedOn?: Date | null,
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

  const { resolved } = await loadCompositionSetting(db, businessId, financialYear);
  return buildGstr4({ financialYear, isComposition: true, quarters, purchases, cmp08Paid, settings: resolved, filedOn });
}
