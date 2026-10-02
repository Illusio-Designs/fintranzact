/**
 * composition.ts — GST composition scheme (s.10): rates, CMP-08 / GSTR-4 due
 * dates, interest and late fee as pure functions.
 *
 * NOTHING HERE IS HARD-WIRED. Every compliance value lives in a year-versioned
 * DEFAULTS table (COMPOSITION_DEFAULTS, read with compositionDefaultsFor(fy))
 * and a business can override most of them per financial year
 * (composition_settings). Resolution order everywhere:
 *   business financial-year override -> built-in versioned default.
 * resolveCompositionSettings() does that and says where each value came from.
 *
 * These values are researched from SECONDARY sources only (see `sources` in
 * each entry) and have changed by notification before. VERIFY THE RATES, DUE
 * DATES, INTEREST RATE AND LATE FEES WITH A CA BEFORE EACH FINANCIAL YEAR.
 */

import { money } from "./money.js";
import { istDateParts, istStartOfDay, istPeriodRange } from "./dates.js";

export const compositionCategories = ["manufacturer_trader", "restaurant", "other_service"] as const;
export type CompositionCategory = (typeof compositionCategories)[number];

export interface CompositionCategoryRule {
  code: CompositionCategory;
  label: string;
  /** Percent of turnover in the state, as a string ("1" = 1%). */
  rate: string;
  note: string;
}

/** GSTR-4 late fee: per day of delay, up to a cap; a nil return has its own (lower) amounts. All rupees, CGST + SGST together. */
export interface CompositionLateFeeRules {
  perDay: string;
  cap: string;
  nilPerDay: string;
  nilCap: string;
}

export interface CompositionDefaultsMeta {
  /** Where the values were researched. Secondary sources: not the official notifications. */
  sourceNotes: string[];
  /** When a person last reviewed the values (YYYY-MM-DD). */
  lastReviewed: string;
  /** Always true: a CA must confirm before filing. */
  verifyWithCA: true;
}

/** Built-in defaults that apply from `effectiveFromFy` (e.g. "2024-25") until a later entry takes over. */
export interface CompositionDefaults {
  effectiveFromFy: string;
  categories: CompositionCategoryRule[];
  cmp08: {
    /** Day of the month CMP-08 is due. */
    dueDay: number;
    /** Calendar month (1-12) of the due date for Q1..Q4. Q3 and Q4 fall in the year after the FY start. */
    dueMonths: readonly [number, number, number, number];
  };
  gstr4: {
    /** Due date of the annual return: `month`/`day` of the year after the FY starts. */
    dueMonth: number;
    dueDay: number;
  };
  /** Percent per year, simple, on tax paid late. */
  interestRatePercent: string;
  lateFee: CompositionLateFeeRules;
  meta: CompositionDefaultsMeta;
}

const SOURCE_NOTES = [
  "busy.in guide-to-gstr-4",
  "taxscan: GSTR-4 vs CMP-08 (2025-26)",
  "cleartax gstr4 page",
  "tutorial.gst.gstr.gov.in GSTR-4 annual manual",
  "caportal.saginfotech.com gstr-4-due-dates",
];

const RULES: CompositionCategoryRule[] = [
  { code: "manufacturer_trader", label: "Manufacturer or trader (goods)", rate: "1", note: "Central 0.5% + State 0.5% of turnover" },
  { code: "restaurant", label: "Restaurant (not serving alcohol)", rate: "5", note: "Central 2.5% + State 2.5% of turnover" },
  { code: "other_service", label: "Other service provider", rate: "6", note: "Central 3% + State 3% of turnover" },
];

/**
 * THE year-versioned defaults. To change a value for a new financial year, add
 * an entry (do not edit an old one: old years must keep computing as before).
 * Keep sorted by effectiveFromFy. Update `lastReviewed` when you re-check.
 */
export const COMPOSITION_DEFAULTS: readonly CompositionDefaults[] = [
  {
    // First year of the annual GSTR-4 (FY 2019-20 onward). GSTR-4 was due 30 April.
    effectiveFromFy: "2019-20",
    categories: RULES,
    cmp08: { dueDay: 18, dueMonths: [7, 10, 1, 4] },
    gstr4: { dueMonth: 4, dueDay: 30 },
    interestRatePercent: "18",
    lateFee: { perDay: "50", cap: "2000", nilPerDay: "20", nilCap: "500" },
    meta: {
      sourceNotes: [
        ...SOURCE_NOTES,
        "CMP-08 is filed for all four quarters (Q4 due 18 April). Rates 1% / 5% / 6%.",
        "Late fee 50/day (25 CGST + 25 SGST) up to 2,000; nil return 20/day up to 500. One source quoted 200/day up to 5,000 for FY 2019-20: UNCONFIRMED.",
      ],
      lastReviewed: "2026-10-02",
      verifyWithCA: true,
    },
  },
  {
    // CGST Notification 12/2024 (10 Jul 2024): GSTR-4 due 30 June after the year from FY 2024-25.
    effectiveFromFy: "2024-25",
    categories: RULES,
    cmp08: { dueDay: 18, dueMonths: [7, 10, 1, 4] },
    gstr4: { dueMonth: 6, dueDay: 30 },
    interestRatePercent: "18",
    lateFee: { perDay: "50", cap: "2000", nilPerDay: "20", nilCap: "500" },
    meta: {
      sourceNotes: [
        ...SOURCE_NOTES,
        "GSTR-4 due date moved from 30 April to 30 June after the year from FY 2024-25 (CGST Notification 12/2024, 10 Jul 2024). Some sites still print 30 April.",
        "Extensions are common: use the per-year override for the notified date.",
      ],
      lastReviewed: "2026-10-02",
      verifyWithCA: true,
    },
  },
];

const fyStart = (fy: string): number => parseInt(fy.slice(0, 4), 10);

/** The built-in defaults in force for a financial year such as "2026-27": the latest entry that has taken effect. */
export function compositionDefaultsFor(financialYear: string): CompositionDefaults {
  const start = fyStart(financialYear);
  let found = COMPOSITION_DEFAULTS[0]!;
  for (const d of COMPOSITION_DEFAULTS) if (fyStart(d.effectiveFromFy) <= start) found = d;
  return found;
}

/** Default rates of tax on turnover for a year. Verify with a CA: the Government can change them. */
export function defaultCompositionRules(financialYear?: string): CompositionCategoryRule[] {
  return compositionDefaultsFor(financialYear ?? COMPOSITION_DEFAULTS[COMPOSITION_DEFAULTS.length - 1]!.effectiveFromFy).categories;
}

/** Category a business is treated as until it picks one. */
export const DEFAULT_COMPOSITION_CATEGORY: CompositionCategory = "manufacturer_trader";

/**
 * The rate (percent string) a business pays for a year: its own override when
 * it has one, else the default of its category.
 */
export function compositionRateFor(
  category: CompositionCategory,
  override?: string | number | null,
  financialYear?: string,
): string {
  if (override != null && String(override) !== "") return String(Number(override));
  return defaultCompositionRules(financialYear).find((r) => r.code === category)!.rate;
}

/** Default interest rate (percent a year) of the newest built-in entry. Prefer resolveCompositionSettings(). */
export const COMPOSITION_INTEREST_RATE_PERCENT = parseFloat(COMPOSITION_DEFAULTS[COMPOSITION_DEFAULTS.length - 1]!.interestRatePercent);

/** First and last instant of a quarter of a financial year such as "2026-27". Q1 = Apr-Jun ... Q4 = Jan-Mar. */
export function compositionQuarterRange(fy: string, quarter: 1 | 2 | 3 | 4): { from: Date; to: Date } {
  return istPeriodRange(fyStart(fy), 4 + (quarter - 1) * 3, 3);
}

/**
 * Due date of the CMP-08 statement for a quarter (all four, Q4 included):
 * Q1 18 Jul, Q2 18 Oct, Q3 18 Jan, Q4 18 Apr by default. `dueDay` overrides the
 * day of the month (a business-year setting); months come from the defaults.
 */
export function cmp08DueDate(fy: string, quarter: 1 | 2 | 3 | 4, dueDay?: number | null): Date {
  const d = compositionDefaultsFor(fy);
  const month = d.cmp08.dueMonths[quarter - 1]!;
  const year = fyStart(fy) + (month < 7 ? 1 : 0); // Q3 (Jan) and Q4 (Apr) fall in the year after the FY starts
  return istStartOfDay(year, month, dueDay ?? d.cmp08.dueDay);
}

/** Due date of the annual return GSTR-4 (default 30 June after the year since FY 2024-25). `override` is a Date or "YYYY-MM-DD". */
export function gstr4DueDate(fy: string, override?: Date | string | null): Date {
  if (override) {
    if (typeof override === "string") {
      const [y, m, d] = override.slice(0, 10).split("-").map(Number);
      return istStartOfDay(y!, m!, d!);
    }
    return override;
  }
  const d = compositionDefaultsFor(fy).gstr4;
  return istStartOfDay(fyStart(fy) + 1, d.dueMonth, d.dueDay);
}

/** Indian calendar days from `due` to `paid` (negative when early). */
function daysLate(due: Date, paid: Date): number {
  const a = istDateParts(due);
  const b = istDateParts(paid);
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000);
}

/**
 * Interest on `tax` paid on `paidOn` against a `dueDate`: tax x rate x days
 * late / 365, to the paisa. Days are Indian calendar days; nothing is due when
 * paid on or before the due date or when there is no tax.
 */
export function compositionInterest(
  tax: string | number,
  dueDate: Date,
  paidOn: Date,
  annualRatePercent: number = COMPOSITION_INTEREST_RATE_PERCENT,
): string {
  if (!money.isPositive(tax)) return "0.00";
  const days = daysLate(dueDate, paidOn);
  if (days <= 0) return "0.00";
  return money.mul(money.percent(tax, annualRatePercent), days / 365);
}

export interface Gstr4LateFee {
  daysLate: number;
  /** Total fee, CGST + SGST. */
  fee: string;
  centralTax: string;
  stateTax: string;
  /** True when the cap limited the fee. */
  capped: boolean;
  /** The per-day and cap actually used (nil or non-nil amounts). */
  perDay: string;
  cap: string;
}

/**
 * GSTR-4 late fee: days late x per-day amount, up to the cap, split half
 * central and half state. A nil return (no turnover and no tax) uses the lower
 * nil amounts. Nothing is due when filed on or before the due date.
 */
export function gstr4LateFee(
  dueDate: Date, filedOn: Date, nil: boolean, rules: CompositionLateFeeRules,
): Gstr4LateFee {
  const perDay = nil ? rules.nilPerDay : rules.perDay;
  const cap = nil ? rules.nilCap : rules.cap;
  const days = Math.max(0, daysLate(dueDate, filedOn));
  const raw = money.mul(perDay, days);
  const capped = money.sub(raw, cap);
  const isCapped = money.isPositive(capped);
  const fee = isCapped ? money.add(cap, 0) : raw;
  const { cgst, sgst } = splitHalf(fee);
  return { daysLate: days, fee, centralTax: cgst, stateTax: sgst, capped: isCapped, perDay, cap };
}

function splitHalf(amount: string): { cgst: string; sgst: string } {
  const cgst = money.mul(amount, 0.5);
  return { cgst, sgst: money.sub(amount, cgst) };
}

/** Per-business, per-financial-year overrides (composition_settings). null / undefined = follow the built-in default. */
export interface CompositionOverrides {
  /** Category rate override, percent. */
  rate?: string | number | null;
  /** GSTR-4 due date, "YYYY-MM-DD" (or Date). */
  gstr4DueDate?: Date | string | null;
  /** Interest, percent a year. */
  interestRate?: string | number | null;
  lateFeePerDay?: string | number | null;
  lateFeeCap?: string | number | null;
  lateFeeNilPerDay?: string | number | null;
  lateFeeNilCap?: string | number | null;
  /** Day of month CMP-08 is due (1-28). */
  cmp08DueDay?: number | null;
}

export type CompositionValueSource = "default" | "override";

export interface ResolvedCompositionSettings {
  financialYear: string;
  category: CompositionCategory;
  /** Percent of turnover. */
  rate: string;
  cmp08DueDay: number;
  gstr4DueDate: Date;
  interestRatePercent: string;
  lateFee: CompositionLateFeeRules;
  /** Which of the above came from the business's override and which from the built-in default. */
  sources: {
    rate: CompositionValueSource;
    cmp08DueDay: CompositionValueSource;
    gstr4DueDate: CompositionValueSource;
    interestRatePercent: CompositionValueSource;
    lateFeePerDay: CompositionValueSource;
    lateFeeCap: CompositionValueSource;
    lateFeeNilPerDay: CompositionValueSource;
    lateFeeNilCap: CompositionValueSource;
  };
  /** The built-in defaults for the year (for showing "default: x" beside an overridden value). */
  defaults: {
    rate: string;
    cmp08DueDay: number;
    gstr4DueDate: Date;
    interestRatePercent: string;
    lateFee: CompositionLateFeeRules;
  };
  meta: CompositionDefaultsMeta & { effectiveFromFy: string };
}

const has = (v: unknown): boolean => v != null && String(v) !== "";
const num = (v: string | number): string => String(Number(v));

/** Business FY override -> built-in versioned default, with the source of each value. */
export function resolveCompositionSettings(
  financialYear: string,
  category: CompositionCategory = DEFAULT_COMPOSITION_CATEGORY,
  overrides: CompositionOverrides = {},
): ResolvedCompositionSettings {
  const d = compositionDefaultsFor(financialYear);
  const pick = <T,>(o: unknown, def: T, conv: (v: any) => T): { value: T; source: CompositionValueSource } =>
    has(o) ? { value: conv(o), source: "override" } : { value: def, source: "default" };
  const defRate = d.categories.find((r) => r.code === category)!.rate;
  const defDue = gstr4DueDate(financialYear);
  const rate = pick(overrides.rate, defRate, num);
  const day = pick(overrides.cmp08DueDay, d.cmp08.dueDay, Number);
  const due = pick(overrides.gstr4DueDate, defDue, (v) => gstr4DueDate(financialYear, v));
  const intr = pick(overrides.interestRate, d.interestRatePercent, num);
  const perDay = pick(overrides.lateFeePerDay, d.lateFee.perDay, num);
  const cap = pick(overrides.lateFeeCap, d.lateFee.cap, num);
  const nilPerDay = pick(overrides.lateFeeNilPerDay, d.lateFee.nilPerDay, num);
  const nilCap = pick(overrides.lateFeeNilCap, d.lateFee.nilCap, num);
  return {
    financialYear, category,
    rate: rate.value,
    cmp08DueDay: day.value,
    gstr4DueDate: due.value,
    interestRatePercent: intr.value,
    lateFee: { perDay: perDay.value, cap: cap.value, nilPerDay: nilPerDay.value, nilCap: nilCap.value },
    sources: {
      rate: rate.source, cmp08DueDay: day.source, gstr4DueDate: due.source, interestRatePercent: intr.source,
      lateFeePerDay: perDay.source, lateFeeCap: cap.source, lateFeeNilPerDay: nilPerDay.source, lateFeeNilCap: nilCap.source,
    },
    defaults: { rate: defRate, cmp08DueDay: d.cmp08.dueDay, gstr4DueDate: defDue, interestRatePercent: d.interestRatePercent, lateFee: d.lateFee },
    meta: { ...d.meta, effectiveFromFy: d.effectiveFromFy },
  };
}
