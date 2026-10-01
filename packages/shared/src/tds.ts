/**
 * tds.ts — income-tax TDS rules as pure functions.
 *
 * Sections, rates and thresholds are DEFAULTS for a financial year; each
 * business can override them per year (tds_section_settings) because they
 * change in most Budgets. Always verify with a CA before filing.
 *
 * Section codes (194C, 194J, …) are kept as labels: the Income-tax Act 2025
 * (in force from 1 April 2026) folds them into s.393, but businesses and CAs
 * still speak in the old numbers.
 *
 * TDS financial year is always April–March, independent of the business's
 * own accounting year setting.
 */

import { money } from "./money.js";
import { financialYearLabel, financialYearOf, istDateParts, istStartOfDay } from "./dates.js";
import { tdsSections, type TdsSection } from "./party-compliance.js";

export type ThresholdBasis = "payments" | "purchases";

/** A TDS section as it applies in one financial year. Amounts are rupee strings, rates percent strings. */
export interface TdsSectionRule {
  code: string;
  label: string;
  rate: string;
  /** Rate for individuals / HUFs when it differs (194C). */
  individualRate?: string;
  /** Rate when the deductee has no valid PAN (s.206AA). */
  rateWithoutPan: string;
  /** TDS applies once a single payment exceeds this. null = no single-payment limit. */
  singleThreshold: string | null;
  /** TDS applies once payments to one party in the year exceed this. null = no yearly limit. */
  aggregateThreshold: string | null;
  basis: ThresholdBasis;
  /** 194Q: tax is only on the amount above the yearly threshold, not from the first rupee. */
  excessOnly: boolean;
  note: string;
}

// Thresholds after Finance Act 2025 (effective 1 Apr 2025). Verify yearly.
const THRESHOLDS: Record<string, Pick<TdsSectionRule, "singleThreshold" | "aggregateThreshold" | "basis" | "excessOnly">> = {
  "194Q": { singleThreshold: null, aggregateThreshold: "5000000", basis: "purchases", excessOnly: true },
  "194C": { singleThreshold: "30000", aggregateThreshold: "100000", basis: "payments", excessOnly: false },
  "194J_TECH": { singleThreshold: null, aggregateThreshold: "50000", basis: "payments", excessOnly: false },
  "194J_PROF": { singleThreshold: null, aggregateThreshold: "50000", basis: "payments", excessOnly: false },
  "194H": { singleThreshold: null, aggregateThreshold: "20000", basis: "payments", excessOnly: false },
  "194I_PM": { singleThreshold: null, aggregateThreshold: "600000", basis: "payments", excessOnly: false },
  "194I_LB": { singleThreshold: null, aggregateThreshold: "600000", basis: "payments", excessOnly: false },
};

/** Default section rules for a financial year ("2026-27"). */
export function defaultTdsSectionRules(_financialYear: string): TdsSectionRule[] {
  return tdsSections.map((s: TdsSection) => ({
    code: s.code,
    label: s.label,
    rate: s.rate,
    individualRate: s.individualRate,
    rateWithoutPan: s.rateWithoutPan,
    ...(THRESHOLDS[s.code] ?? { singleThreshold: null, aggregateThreshold: null, basis: "payments" as const, excessOnly: false }),
    note: s.note,
  }));
}

// ── Periods and due dates ──────────────────────────────────────

/** TDS financial year label ("2026-27") for a date. Always April–March. */
export function tdsFinancialYear(date: Date | string): string {
  return financialYearLabel(financialYearOf(date, 4));
}

/** Quarter 1–4 of the TDS year (Q1 Apr–Jun … Q4 Jan–Mar). */
export function tdsQuarter(date: Date | string): 1 | 2 | 3 | 4 {
  const { month } = istDateParts(date);
  const idx = Math.floor(((month + 8) % 12) / 3); // Apr→0 … Mar→3
  return (idx + 1) as 1 | 2 | 3 | 4;
}

/** First and last instant of an Indian financial year label like "2026-27". */
export function tdsFinancialYearRange(fy: string): { from: Date; to: Date } {
  const start = parseInt(fy.slice(0, 4), 10);
  return {
    from: istStartOfDay(start, 4, 1),
    to: new Date(istStartOfDay(start + 1, 4, 1).getTime() - 1),
  };
}

/** First and last instant of a quarter of the TDS year. */
export function tdsQuarterRange(fy: string, quarter: 1 | 2 | 3 | 4): { from: Date; to: Date } {
  const start = parseInt(fy.slice(0, 4), 10);
  const startMonth = 4 + (quarter - 1) * 3; // 4, 7, 10, 13(=Jan next year)
  return {
    from: istStartOfDay(start, startMonth, 1),
    to: new Date(istStartOfDay(start, startMonth + 3, 1).getTime() - 1),
  };
}

/**
 * Last day to deposit TDS deducted on `deductedOn`: the 7th of the next month,
 * except March, which is 30 April. (TCS follows the same dates.) Returns the
 * start of that day in India.
 */
export function tdsDepositDueDate(deductedOn: Date | string): Date {
  const { year, month } = istDateParts(deductedOn);
  return month === 3 ? istStartOfDay(year, 4, 30) : istStartOfDay(year, month + 1, 7);
}

/** Due date of the quarterly return: Q1 31 Jul, Q2 31 Oct, Q3 31 Jan, Q4 31 May. */
export function tdsReturnDueDate(fy: string, quarter: 1 | 2 | 3 | 4): Date {
  const start = parseInt(fy.slice(0, 4), 10);
  switch (quarter) {
    case 1: return istStartOfDay(start, 7, 31);
    case 2: return istStartOfDay(start, 10, 31);
    case 3: return istStartOfDay(start + 1, 1, 31);
    default: return istStartOfDay(start + 1, 5, 31);
  }
}

// ── Computation ────────────────────────────────────────────────

export type TdsReason =
  | "no_section"
  | "below_threshold"
  | "single_payment_over_threshold"
  | "aggregate_threshold_crossed"
  | "above_threshold"
  | "no_threshold";

export interface TdsInput {
  section: TdsSectionRule;
  /** Deductee has a valid PAN (own, or the one inside a GSTIN). */
  hasPan: boolean;
  /** Proprietorship / HUF — gets the lower individual rate where one exists. */
  isIndividual?: boolean;
  /** Taxable value of this payment (excluding GST where the bill shows it separately). */
  amount: string;
  /** Total already paid/credited to this party under this section this FY, before this one. */
  ytdBase: string;
  /** Part of ytdBase that TDS has already been deducted on. */
  ytdTaxedBase: string;
}

export interface TdsResult {
  applicable: boolean;
  reason: TdsReason;
  /** Amount TDS is calculated on (may include earlier untaxed payments once the yearly limit is crossed). */
  base: string;
  /** Percent actually applied. */
  rate: string;
  /** TDS to deduct, rounded to the nearest rupee as the law requires. */
  tds: string;
}

/** The rate that applies to a deductee under a section. */
export function tdsRateForSection(section: TdsSectionRule, hasPan: boolean, isIndividual = false): string {
  if (!hasPan) return section.rateWithoutPan;
  if (isIndividual && section.individualRate) return section.individualRate;
  return section.rate;
}

const NONE = (reason: TdsReason, rate: string): TdsResult => ({ applicable: false, reason, base: "0.00", rate, tds: "0.00" });

/**
 * How much TDS to deduct on a payment, given what was already paid to the
 * party in the year. Rules:
 *  - Single-payment limit (194C ₹30,000): a payment above it is taxed on its own.
 *  - Yearly limit: once total payments cross it, TDS applies to the whole
 *    amount not yet taxed, including earlier payments that were below it.
 *  - 194Q: only the part of purchases above ₹50 lakh in the year is taxed.
 *  - No PAN (s.206AA): the higher no-PAN rate applies.
 */
export function computeTds(input: TdsInput): TdsResult {
  const { section } = input;
  const rate = tdsRateForSection(section, input.hasPan, input.isIndividual);
  const amount = Math.max(0, parseFloat(input.amount) || 0);
  const ytdBase = Math.max(0, parseFloat(input.ytdBase) || 0);
  const taxed = Math.max(0, parseFloat(input.ytdTaxedBase) || 0);
  const single = section.singleThreshold != null ? parseFloat(section.singleThreshold) : null;
  const aggregate = section.aggregateThreshold != null ? parseFloat(section.aggregateThreshold) : null;
  const cumulative = ytdBase + amount;

  if (amount <= 0) return NONE("below_threshold", rate);

  let base: number;
  let reason: TdsReason;

  if (section.excessOnly && aggregate != null) {
    // 194Q: tax the slice above the yearly limit, minus what was already taxed.
    base = Math.max(0, cumulative - aggregate) - taxed;
    reason = "above_threshold";
  } else if (single == null && aggregate == null) {
    base = amount;
    reason = "no_threshold";
  } else if (aggregate != null && cumulative > aggregate) {
    base = cumulative - taxed;
    reason = "aggregate_threshold_crossed";
  } else if (single != null && amount > single) {
    base = amount;
    reason = "single_payment_over_threshold";
  } else {
    return NONE("below_threshold", rate);
  }

  base = Math.max(0, base);
  if (base === 0) return NONE("below_threshold", rate);

  // TDS is rounded to the nearest rupee.
  const tds = Math.round(parseFloat(money.percent(base.toFixed(2), rate)));
  return { applicable: true, reason, base: base.toFixed(2), rate, tds: tds.toFixed(2) };
}
