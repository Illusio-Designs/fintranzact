/**
 * composition.ts — GST composition scheme (s.10) rates and CMP-08 dates as
 * pure functions.
 *
 * Everything here is a DEFAULT for a financial year. The rates and due dates
 * have changed by notification before, so a business can override its rate per
 * year (composition_settings) and the dates are kept in one place. VERIFY THE
 * RATES, DUE DATES AND INTEREST RATE WITH A CA BEFORE EACH FINANCIAL YEAR.
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

/**
 * Default rates of tax on turnover. Verify with a CA: the Government can change
 * them, and a business that supplies both goods and services is taxed at the
 * rate of the higher category by the CA's advice, not by this table.
 */
export function defaultCompositionRules(_financialYear?: string): CompositionCategoryRule[] {
  return [
    { code: "manufacturer_trader", label: "Manufacturer or trader (goods)", rate: "1", note: "Central 0.5% + State 0.5% of turnover" },
    { code: "restaurant", label: "Restaurant (not serving alcohol)", rate: "5", note: "Central 2.5% + State 2.5% of turnover" },
    { code: "other_service", label: "Other service provider", rate: "6", note: "Central 3% + State 3% of turnover" },
  ];
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

/** Interest on tax paid late: percent per year, simple, from the day after the due date (s.50). Verify with a CA. */
export const COMPOSITION_INTEREST_RATE_PERCENT = 18;

/** First and last instant of a quarter of a financial year such as "2026-27". Q1 = Apr-Jun ... Q4 = Jan-Mar. */
export function compositionQuarterRange(fy: string, quarter: 1 | 2 | 3 | 4): { from: Date; to: Date } {
  const start = parseInt(fy.slice(0, 4), 10);
  return istPeriodRange(start, 4 + (quarter - 1) * 3, 3);
}

/**
 * Due date of the CMP-08 statement for a quarter: the 18th of the month after
 * it (Q1 18 Jul, Q2 18 Oct, Q3 18 Jan). There is no CMP-08 for Q4: the tax for
 * Jan-Mar is declared in the annual return GSTR-4, so this returns null.
 * Verify yearly with a CA.
 */
export function cmp08DueDate(fy: string, quarter: 1 | 2 | 3 | 4): Date | null {
  const start = parseInt(fy.slice(0, 4), 10);
  switch (quarter) {
    case 1: return istStartOfDay(start, 7, 18);
    case 2: return istStartOfDay(start, 10, 18);
    case 3: return istStartOfDay(start + 1, 1, 18);
    default: return null;
  }
}

/** Due date of the annual return GSTR-4: 30 April after the year. Verify yearly with a CA (it has been extended often). */
export function gstr4DueDate(fy: string): Date {
  return istStartOfDay(parseInt(fy.slice(0, 4), 10) + 1, 4, 30);
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
  const due = istDateParts(dueDate);
  const paid = istDateParts(paidOn);
  const days = Math.round((Date.UTC(paid.year, paid.month - 1, paid.day) - Date.UTC(due.year, due.month - 1, due.day)) / 86_400_000);
  if (days <= 0) return "0.00";
  return money.mul(money.percent(tax, annualRatePercent), days / 365);
}
