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
  /** Section of the Income-tax Act 2025 (tax year 2026-27 onward), e.g. "393(1) Table 6(i)". Display only. */
  actSection?: string;
  /** Payment code used on challans and returns from tax year 2026-27 (e.g. "1023/1024"). Display only. */
  paymentCode?: string;
}

/** First financial year governed by the Income-tax Act 2025 (in force from 1 April 2026). */
export const INCOME_TAX_ACT_2025_FIRST_FY = "2026-27";

/** True when the year falls under the Income-tax Act 2025. Blank or unreadable years count as the old Act. */
export function isIncomeTaxAct2025Year(financialYear: string): boolean {
  const start = parseInt(financialYear.slice(0, 4), 10);
  return Number.isFinite(start) && start >= parseInt(INCOME_TAX_ACT_2025_FIRST_FY.slice(0, 4), 10);
}

/** Where the built-in defaults of a year came from and how fresh they are. */
export interface TaxRulesMeta {
  sourceNotes: string[];
  /** ISO date the defaults were last checked against sources. */
  lastReviewed: string;
  /** Always true: every value is from secondary sources and must be confirmed by a CA. */
  verifyWithCA: boolean;
  /** Plain-language note on the legal framework of the year (shown above the table). */
  actNote: string;
}

const COMMON_SOURCES = [
  "taxguru.in: TCS rate chart tax year 2026-27 under Income-tax Act, 2025 (secondary source)",
  "taxguru.in: TCS rates rationalised from 1 April 2026 (secondary source)",
  "terra-insight.com / taxroutine.com / karnanica.com: TDS payment codes 1001-1092 (secondary sources)",
  "calcguru.in, saral.pro, tdsman.com: 194C / 194H under s.393 (secondary sources)",
];

const TDS_META_LEGACY: TaxRulesMeta = {
  sourceNotes: ["Rates and thresholds as of Finance Act 2025 (effective 1 Apr 2025). Existing built-in values; confirm with a CA."],
  lastReviewed: "2026-10-02",
  verifyWithCA: true,
  actNote: "Income-tax Act, 1961: section 194C, 194J, 194H, 194I, 194Q.",
};

const TDS_META_ACT_2025: TaxRulesMeta = {
  sourceNotes: [
    ...COMMON_SOURCES,
    "Rates and thresholds of the TDS sections shown here appear unchanged from 2025-26; only the section reference and payment code change.",
    "194H commission: the payment code and table row are not confirmed (one source says 1006, others differ), so none is shown.",
  ],
  lastReviewed: "2026-10-02",
  verifyWithCA: true,
  actNote:
    "From 1 April 2026 the Income-tax Act, 2025 applies: non-salary TDS is section 393 with four-digit payment codes. " +
    "The old section numbers (194C ...) are kept as the ids here. Form and certificate names for these years are to be confirmed with your CA.",
};

/** Source notes and last-reviewed date of the built-in TDS defaults for a financial year. */
export function tdsRulesMetaFor(financialYear: string): TaxRulesMeta {
  return isIncomeTaxAct2025Year(financialYear) ? TDS_META_ACT_2025 : TDS_META_LEGACY;
}

/** New-Act reference of each TDS section (secondary sources; verify with a CA). Applied for FY 2026-27 onward only. */
const ACT_2025_REFS: Record<string, { actSection: string; paymentCode?: string }> = {
  "194Q": { actSection: "393(1) Table 8(ii)", paymentCode: "1031" },
  "194C": { actSection: "393(1) Table 6(i)", paymentCode: "1023/1024" },
  "194J_TECH": { actSection: "393(1) Table 6(iii)", paymentCode: "1026" },
  "194J_PROF": { actSection: "393(1) Table 6(iii)", paymentCode: "1027" },
  "194H": { actSection: "393(1)" },
  "194I_PM": { actSection: "393(1) Table 2(ii)", paymentCode: "1008" },
  "194I_LB": { actSection: "393(1) Table 2(ii)", paymentCode: "1009" },
};

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

/**
 * Built-in section rules for a financial year ("2026-27"). Years before 2026-27
 * use the Income-tax Act 1961 values; from 2026-27 the values are the same but
 * carry the Income-tax Act 2025 reference and payment code. The old code
 * (194C ...) stays the stable id. A business can still override any value.
 */
export function defaultTdsSectionRules(financialYear: string): TdsSectionRule[] {
  const act2025 = isIncomeTaxAct2025Year(financialYear);
  return tdsSections.map((s: TdsSection) => {
    const ref = act2025 ? ACT_2025_REFS[s.code] : undefined;
    return {
      code: s.code,
      label: s.label,
      rate: s.rate,
      individualRate: s.individualRate,
      rateWithoutPan: s.rateWithoutPan,
      ...(THRESHOLDS[s.code] ?? { singleThreshold: null, aggregateThreshold: null, basis: "payments" as const, excessOnly: false }),
      note: ref ? `${s.note} Income-tax Act 2025: s.${ref.actSection}${ref.paymentCode ? `, payment code ${ref.paymentCode}` : ""}.` : s.note,
      ...(ref ? { actSection: ref.actSection, ...(ref.paymentCode ? { paymentCode: ref.paymentCode } : {}) } : {}),
    };
  });
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
