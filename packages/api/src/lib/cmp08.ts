/**
 * cmp08.ts — CMP-08 quarterly statement of a composition taxpayer.
 *
 * A composition dealer pays a flat percent of turnover each quarter instead of
 * collecting GST: outward taxable turnover (sale invoices and debit notes, less
 * credit notes and sales returns) x the category rate, split half central and
 * half state (a composition dealer makes no inter-state supply, so there is no
 * integrated tax on the outward side). Tax on inward supplies under reverse
 * charge is declared in the same statement.
 *
 * `buildCmp08Quarter` is pure; `loadCmp08Quarter` reads the documents.
 * Rates, due dates and interest rate come from @fintranzact/shared
 * composition.ts: verify them yearly with a CA.
 */

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { businesses, compositionSettings, invoices, parties } from "@fintranzact/db";
import type { TenantDatabase } from "@fintranzact/db";
import {
  cmp08DueDate, compositionInterest, compositionQuarterRange, compositionRateFor, DEFAULT_COMPOSITION_CATEGORY,
  isIntraStateSupply, money, splitIntraStateTax,
  type CompositionCategory,
} from "@fintranzact/shared";
import { buildBusinessDateFilter } from "./business-date.js";

/** Sale documents that add to CMP-08 outward supplies. */
export const CMP08_ADDING_DOCUMENTS = ["invoice", "debit_note"] as const;
/** Sale documents that reduce CMP-08 outward supplies. */
export const CMP08_REDUCING_DOCUMENTS = ["credit_note", "sales_return"] as const;
/** Purchase documents that carry reverse-charge tax (tax invoices); the supplier's credit notes and returns reduce it. */
const RCM_ADDING_DOCUMENTS = ["invoice"] as const;
const RCM_REDUCING_DOCUMENTS = ["credit_note", "sales_return", "purchase_return", "debit_note"] as const;

export interface Cmp08Document {
  documentType: string;
  subtotal: string;
  discountAmount: string | null;
  additionalCharges: string | null;
}

export interface Cmp08RcmDocument extends Cmp08Document {
  taxAmount: string;
  /** Supplier is in another state: the tax is integrated tax, not central + state. */
  interState: boolean;
}

export interface Cmp08Input {
  financialYear: string;
  quarter: 1 | 2 | 3 | 4;
  /** Sale documents of the quarter (deleted and cancelled already left out). */
  outward: Cmp08Document[];
  /** Purchase documents of the quarter that are liable to reverse charge. */
  rcm: Cmp08RcmDocument[];
  category: CompositionCategory;
  /** Rate override (percent) from composition settings; null = category default. */
  rateOverride?: string | null;
  /** When the tax was actually paid; interest is worked out only when it is known. */
  paidOn?: Date | null;
}

export interface Cmp08Quarter {
  financialYear: string;
  quarter: 1 | 2 | 3 | 4;
  category: CompositionCategory;
  /** Percent of turnover, e.g. "1". */
  rate: string;
  /** Net outward taxable turnover (rupees, 2 decimals). */
  taxableValue: string;
  centralTax: string;
  stateTax: string;
  /** Always "0.00": composition dealers make no inter-state outward supply. */
  integratedTax: string;
  taxPayable: string;
  /** Inward supplies liable to reverse charge. */
  rcm: { taxableValue: string; centralTax: string; stateTax: string; integratedTax: string; tax: string };
  /** Interest on late payment; "0.00" while the payment date is unknown. */
  interest: string;
  interestBasis: "paid_on_time_or_not_late" | "paid_late" | "payment_date_unknown" | "no_cmp08_for_quarter";
  /** Null for Q4: the tax for Jan-Mar goes in the annual return GSTR-4. */
  dueDate: Date | null;
  /** False for Q4. */
  cmp08Applicable: boolean;
}

/** Value of supply of a document: lines less the document discount, plus the charges billed with it. */
export function cmp08DocumentValue(doc: Cmp08Document): string {
  return money.add(money.sub(doc.subtotal, doc.discountAmount || "0"), doc.additionalCharges || "0");
}

/** Pure: CMP-08 figures for one quarter. */
export function buildCmp08Quarter(input: Cmp08Input): Cmp08Quarter {
  const rate = compositionRateFor(input.category, input.rateOverride, input.financialYear);

  let taxable = "0.00";
  for (const doc of input.outward) {
    const value = cmp08DocumentValue(doc);
    taxable = (CMP08_REDUCING_DOCUMENTS as readonly string[]).includes(doc.documentType)
      ? money.sub(taxable, value)
      : money.add(taxable, value);
  }
  const taxPayable = money.percent(taxable, rate);
  const { cgst, sgst } = splitIntraStateTax(taxPayable);

  let rcmTaxable = "0.00", rcmCgst = "0.00", rcmSgst = "0.00", rcmIgst = "0.00";
  for (const doc of input.rcm) {
    const reducing = (RCM_REDUCING_DOCUMENTS as readonly string[]).includes(doc.documentType);
    const signed = (v: string) => (reducing ? money.sub("0", v) : v);
    rcmTaxable = money.add(rcmTaxable, signed(cmp08DocumentValue(doc)));
    const tax = signed(doc.taxAmount);
    if (doc.interState) {
      rcmIgst = money.add(rcmIgst, tax);
    } else {
      const heads = splitIntraStateTax(tax);
      rcmCgst = money.add(rcmCgst, heads.cgst);
      rcmSgst = money.add(rcmSgst, heads.sgst);
    }
  }
  const rcmTax = money.sum([rcmCgst, rcmSgst, rcmIgst]);

  const dueDate = cmp08DueDate(input.financialYear, input.quarter);
  const liableForInterest = money.add(taxPayable, rcmTax);
  let interest = "0.00";
  let interestBasis: Cmp08Quarter["interestBasis"];
  if (!dueDate) {
    interestBasis = "no_cmp08_for_quarter";
  } else if (!input.paidOn) {
    interestBasis = "payment_date_unknown";
  } else {
    interest = compositionInterest(liableForInterest, dueDate, input.paidOn);
    interestBasis = money.isPositive(interest) ? "paid_late" : "paid_on_time_or_not_late";
  }

  return {
    financialYear: input.financialYear,
    quarter: input.quarter,
    category: input.category,
    rate,
    taxableValue: taxable,
    centralTax: money.add(cgst, 0),
    stateTax: money.add(sgst, 0),
    integratedTax: "0.00",
    taxPayable,
    rcm: { taxableValue: rcmTaxable, centralTax: rcmCgst, stateTax: rcmSgst, integratedTax: rcmIgst, tax: rcmTax },
    interest,
    interestBasis,
    dueDate,
    cmp08Applicable: dueDate !== null,
  };
}

/** The business's composition category and rate override for a financial year. */
export async function loadCompositionSetting(
  db: TenantDatabase, businessId: string, financialYear: string,
): Promise<{ category: CompositionCategory; rateOverride: string | null; configured: boolean }> {
  const [row] = await db.select().from(compositionSettings)
    .where(and(eq(compositionSettings.businessId, businessId), eq(compositionSettings.financialYear, financialYear)))
    .limit(1);
  return {
    category: (row?.category as CompositionCategory | undefined) ?? DEFAULT_COMPOSITION_CATEGORY,
    rateOverride: row?.rate != null ? String(Number(row.rate)) : null,
    configured: !!row,
  };
}

/** Reads the documents of one quarter and builds its CMP-08 figures. */
export async function loadCmp08Quarter(
  db: TenantDatabase, businessId: string, financialYear: string, quarter: 1 | 2 | 3 | 4, paidOn?: Date | null,
): Promise<Cmp08Quarter & { quarterStart: Date; quarterEnd: Date; configured: boolean }> {
  const { from, to } = compositionQuarterRange(financialYear, quarter);
  const setting = await loadCompositionSetting(db, businessId, financialYear);

  // Quotations, proformas, orders and challans are not supplies, and deleted
  // or cancelled documents are not reported.
  const outward = await db.select({
    documentType: invoices.documentType,
    subtotal: invoices.subtotal,
    discountAmount: invoices.discountAmount,
    additionalCharges: invoices.additionalCharges,
  }).from(invoices)
    .where(and(
      eq(invoices.businessId, businessId),
      eq(invoices.type, "sale"),
      inArray(invoices.documentType, [...CMP08_ADDING_DOCUMENTS, ...CMP08_REDUCING_DOCUMENTS]),
      sql`${invoices.status} != 'cancelled'`,
      isNull(invoices.deletedAt),
      ...buildBusinessDateFilter(invoices, { from, to }),
    ));

  const [biz] = await db.select({ stateCode: businesses.stateCode, state: businesses.state, gstin: businesses.gstin })
    .from(businesses).where(eq(businesses.id, businessId)).limit(1);
  const rcmRows = await db.select({
    documentType: invoices.documentType,
    subtotal: invoices.subtotal,
    discountAmount: invoices.discountAmount,
    additionalCharges: invoices.additionalCharges,
    taxAmount: invoices.taxAmount,
    partyState: parties.state,
    partyStateCode: parties.stateCode,
    partyGstin: parties.gstin,
  }).from(invoices)
    .innerJoin(parties, eq(parties.id, invoices.partyId))
    .where(and(
      eq(invoices.businessId, businessId),
      eq(invoices.type, "purchase"),
      eq(invoices.isReverseCharge, true),
      inArray(invoices.documentType, [...RCM_ADDING_DOCUMENTS, ...RCM_REDUCING_DOCUMENTS]),
      sql`${invoices.status} != 'cancelled'`,
      isNull(invoices.deletedAt),
      ...buildBusinessDateFilter(invoices, { from, to }),
    ));
  const rcm: Cmp08RcmDocument[] = rcmRows.map((r) => ({
    documentType: r.documentType,
    subtotal: r.subtotal,
    discountAmount: r.discountAmount,
    additionalCharges: r.additionalCharges,
    taxAmount: r.taxAmount,
    interState: !isIntraStateSupply(
      { stateCode: biz?.stateCode, state: biz?.state, gstin: biz?.gstin },
      { stateCode: r.partyStateCode, state: r.partyState, gstin: r.partyGstin },
    ),
  }));

  const result = buildCmp08Quarter({
    financialYear, quarter, outward, rcm,
    category: setting.category, rateOverride: setting.rateOverride, paidOn,
  });
  return { ...result, quarterStart: from, quarterEnd: to, configured: setting.configured };
}
