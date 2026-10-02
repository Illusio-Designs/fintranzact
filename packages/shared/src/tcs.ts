/**
 * tcs.ts — tax collected at source (TCS) on sales, as pure functions.
 *
 * A seller collects TCS from the buyer on specified goods and cases (s.206C:
 * scrap, minerals, alcohol, forest produce, parking / toll / mining, motor
 * vehicles above ₹10 lakh) and deposits it with the government. It is collected
 * with the invoice: the customer owes goods + GST + TCS.
 *
 * Rates and limits change in Budgets (the old s.206C(1H) charge on sales above
 * ₹50 lakh no longer applies from 1 April 2025), so these are DEFAULTS that a
 * business can override per financial year. Verify with a CA. The base is the
 * taxable value (GST excluded, where GST is shown separately).
 */

import { money } from "./money.js";
import { istDateParts, istStartOfDay } from "./dates.js";
import { isIncomeTaxAct2025Year, type TaxRulesMeta } from "./tds.js";

export interface TcsSectionRule {
  code: string;
  label: string;
  /** Percent. */
  rate: string;
  /** Percent when the buyer has no PAN (s.206CC): twice the rate or 5%, whichever is higher. */
  rateWithoutPan: string;
  /** TCS applies only when the line's value is above this (motor vehicles: ₹10 lakh). null = no limit. */
  singleThreshold: string | null;
  note: string;
  /** Section of the Income-tax Act 2025 (tax year 2026-27 onward). Display only. */
  actSection?: string;
  /** Payment code from tax year 2026-27, where a source gave one. Display only. */
  paymentCode?: string;
}

const noPanRate = (rate: string) => String(Math.max(parseFloat(rate) * 2, 5));

const SECTIONS: Array<Omit<TcsSectionRule, "rateWithoutPan"> & { rateWithoutPan?: string }> = [
  { code: "206C_ALCOHOL", label: "206C · Alcoholic liquor for human consumption", rate: "1", singleThreshold: null, note: "Sale of alcoholic liquor for human consumption." },
  { code: "206C_TENDU", label: "206C · Tendu leaves", rate: "5", singleThreshold: null, note: "Sale of tendu leaves." },
  { code: "206C_TIMBER_LEASE", label: "206C · Timber under a forest lease", rate: "2.5", singleThreshold: null, note: "Timber obtained under a forest lease." },
  { code: "206C_TIMBER_OTHER", label: "206C · Timber (other)", rate: "2.5", singleThreshold: null, note: "Timber obtained other than under a forest lease." },
  { code: "206C_FOREST", label: "206C · Other forest produce", rate: "2.5", singleThreshold: null, note: "Forest produce other than timber and tendu leaves." },
  { code: "206C_SCRAP", label: "206C · Scrap", rate: "1", singleThreshold: null, note: "Sale of scrap." },
  { code: "206C_MINERALS", label: "206C · Coal, lignite, iron ore", rate: "1", singleThreshold: null, note: "Sale of coal, lignite or iron ore." },
  { code: "206C_PARKING", label: "206C · Parking lot, toll plaza, mining", rate: "2", singleThreshold: null, note: "Licence or lease of a parking lot, toll plaza, or mining and quarrying." },
  { code: "206C_VEHICLE", label: "206C · Motor vehicle above ₹10 lakh", rate: "1", singleThreshold: "1000000", note: "Sale of a motor vehicle whose value is above ₹10 lakh." },
];

export const tcsSectionCodes = SECTIONS.map((s) => s.code) as [string, ...string[]];

/**
 * Rates from 1 April 2026 (Finance Act 2026; secondary sources, verify with a CA).
 * Sections not listed keep their earlier rate. Timber and other forest produce:
 * some sources print 2% instead of 2.5%; the older 2.5% is kept and flagged.
 */
const RATES_FROM_2026_27: Record<string, string> = {
  "206C_ALCOHOL": "2",
  "206C_TENDU": "2",
  "206C_SCRAP": "2",
  "206C_MINERALS": "2",
};

/** Payment codes under the Income-tax Act 2025 where a secondary source gave one. */
const PAYMENT_CODES_2026_27: Record<string, string> = {
  "206C_ALCOHOL": "1068",
  "206C_SCRAP": "1073",
};

const TCS_META_LEGACY: TaxRulesMeta = {
  sourceNotes: ["Rates as before 1 April 2026 (Income-tax Act 1961, s.206C). Existing built-in values; confirm with a CA."],
  lastReviewed: "2026-10-02",
  verifyWithCA: true,
  actNote: "Income-tax Act, 1961: section 206C (the old 206C(1H) charge on sales above Rs 50 lakh ended on 1 April 2025).",
};

const TCS_META_ACT_2025: TaxRulesMeta = {
  sourceNotes: [
    "taxguru.in: TCS rate chart tax year 2026-27 under Income-tax Act, 2025 (secondary source)",
    "taxguru.in: TCS rates rationalised from 1 April 2026 (secondary source)",
    "Alcohol, scrap, coal / lignite / iron ore 1% to 2%; tendu leaves 5% to 2% (Finance Act 2026).",
    "Timber and other forest produce: some sources say 2%, others leave it unchanged; the older 2.5% is kept. UNCONFIRMED: check with a CA and use the per-year override.",
    "Parking / toll / mining 2% and motor vehicles 1% above Rs 10 lakh: no change found.",
    "Payment codes: only alcohol (1068) and scrap (1073) were found; others are blank.",
  ],
  lastReviewed: "2026-10-02",
  verifyWithCA: true,
  actNote:
    "From 1 April 2026 TCS is section 394 of the Income-tax Act, 2025. The old s.206C codes are kept as the ids here. " +
    "Return and certificate form names for these years are to be confirmed with your CA.",
};

/** Source notes and last-reviewed date of the built-in TCS defaults for a financial year. */
export function tcsRulesMetaFor(financialYear: string): TaxRulesMeta {
  return isIncomeTaxAct2025Year(financialYear) ? TCS_META_ACT_2025 : TCS_META_LEGACY;
}

/**
 * Built-in TCS sections for a financial year ("2026-27"). Before 2026-27 the
 * s.206C rates apply; from 2026-27 the section 394 rates. A blank year gives
 * the older rates (used only to list names). A business can override per year.
 */
export function defaultTcsSectionRules(financialYear: string): TcsSectionRule[] {
  const act2025 = isIncomeTaxAct2025Year(financialYear);
  return SECTIONS.map((s) => {
    const rate = (act2025 ? RATES_FROM_2026_27[s.code] : undefined) ?? s.rate;
    const code = act2025 ? PAYMENT_CODES_2026_27[s.code] : undefined;
    return {
      ...s,
      rate,
      rateWithoutPan: noPanRate(rate),
      ...(act2025
        ? {
            actSection: "394(1)",
            ...(code ? { paymentCode: code } : {}),
            note: `${s.note} Income-tax Act 2025: s.394(1)${code ? `, payment code ${code}` : ""}.`,
          }
        : {}),
    };
  });
}

export function tcsRateForSection(section: TcsSectionRule, hasPan: boolean): string {
  return hasPan ? section.rate : section.rateWithoutPan;
}

export interface TcsInput {
  section: TcsSectionRule;
  /** The buyer has a valid PAN (their own, or the one inside a GSTIN). */
  hasPan: boolean;
  /** Taxable value of the line (GST excluded). */
  taxable: string;
}

export interface TcsResult {
  applicable: boolean;
  /** Amount the tax is on. */
  base: string;
  /** Percent applied. */
  rate: string;
  /** TCS to collect, rounded to the nearest rupee. */
  tcs: string;
}

/** TCS on one line of a sale. A line at or below the section's limit carries none. */
export function computeTcs(input: TcsInput): TcsResult {
  const rate = tcsRateForSection(input.section, input.hasPan);
  const taxable = Math.max(0, parseFloat(input.taxable) || 0);
  const limit = input.section.singleThreshold != null ? parseFloat(input.section.singleThreshold) : null;
  if (taxable <= 0 || (limit != null && taxable <= limit)) {
    return { applicable: false, base: "0.00", rate, tcs: "0.00" };
  }
  const tcs = Math.round(parseFloat(money.percent(taxable.toFixed(2), rate)));
  return { applicable: tcs > 0, base: taxable.toFixed(2), rate, tcs: tcs.toFixed(2) };
}

/**
 * Last day to deposit TCS collected on `collectedOn`: the 7th of the next
 * month — for every month, March included (unlike TDS). Start of that day in India.
 */
export function tcsDepositDueDate(collectedOn: Date | string): Date {
  const { year, month } = istDateParts(collectedOn);
  return istStartOfDay(year, month + 1, 7);
}

/** Due date of the quarterly TCS return (Form 27EQ): Q1 15 Jul, Q2 15 Oct, Q3 15 Jan, Q4 15 May. */
export function tcsReturnDueDate(fy: string, quarter: 1 | 2 | 3 | 4): Date {
  const start = parseInt(fy.slice(0, 4), 10);
  switch (quarter) {
    case 1: return istStartOfDay(start, 7, 15);
    case 2: return istStartOfDay(start, 10, 15);
    case 3: return istStartOfDay(start + 1, 1, 15);
    default: return istStartOfDay(start + 1, 5, 15);
  }
}
