/**
 * Payroll statutory rules (Phase 2): provident fund (EPF, EPS, VPF), ESI,
 * professional tax, labour welfare fund and income-tax TDS on salary (s.192).
 *
 * Pure: no database, no clock, no floating point money. All money is integer
 * PAISE; rates are percentages with up to two decimals.
 *
 * EVERY RATE, CEILING, SLAB AND DUE DATE IS DATA, NOT CODE. They live in a
 * `StatutoryRates` object that the business stores per financial year (the
 * `payroll_statutory_settings` table) and edits on the Statutory settings
 * screen. The defaults here (`defaultStatutoryRates`) are only what the roadmap
 * states plus a few long-standing figures; anything state-wise, and the
 * income-tax slabs, ship EMPTY on purpose (calculation then yields 0 and the
 * payroll run shows a warning). Every default and assumption is listed in
 * docs/PAYROLL-CA-VERIFICATION.md. Verify every figure with your CA.
 *
 * Rounding rules (assumptions, editable): PF amounts are rounded to the nearest
 * rupee (the ECR carries whole rupees), ESI amounts are rounded UP to the next
 * rupee, PT and LWF are whole rupees as configured, income tax is rounded to the
 * nearest ten rupees (s.288A/288B) and the monthly TDS to the nearest rupee.
 */

import { z } from "zod";
import { isStateCode } from "./indian-states.js";
import { isoDateSchema } from "./payroll.js";
import {
  STATUTORY_PAYABLE_GROUPS,
  WAGE_CATEGORIES,
  percentOf,
  roundDiv,
  paiseToRupees,
  rupeesToPaise,
  type PayrollLineComponent,
  type PayrollLineResult,
  type PayrollWarning,
  type StatutoryPayableGroup,
} from "./payroll-calc.js";

export const VERIFY_WITH_CA_LABEL = "Verify with your CA";

// ── Rounding ─────────────────────────────────────────────────────────────────

export const ROUNDING_MODES = ["paisa", "nearest_rupee", "ceil_rupee"] as const;
export type RoundingMode = (typeof ROUNDING_MODES)[number];

export const ROUNDING_MODE_LABELS: Record<RoundingMode, string> = {
  paisa: "To the paisa",
  nearest_rupee: "To the nearest rupee",
  ceil_rupee: "Up to the next rupee",
};

/** Round a non-negative paise amount by the mode. */
export function roundPaise(paise: number, mode: RoundingMode): number {
  if (paise <= 0) return 0;
  if (mode === "paisa") return Math.round(paise);
  if (mode === "nearest_rupee") return roundDiv(paise, 100) * 100;
  return Math.ceil(paise / 100) * 100;
}

// ── Rates (the data) ─────────────────────────────────────────────────────────

const rupees = z.number().min(0).max(10_000_000_000);
const percent = z.number().min(0).max(100);

export const PT_GENDERS = ["any", "male", "female"] as const;

/** One professional-tax slab. It applies when `fromRupees` < monthly gross <= `toRupees` (null = no upper limit). */
export const ptSlabSchema = z.object({
  fromRupees: rupees,
  toRupees: rupees.nullable(),
  monthlyRupees: rupees,
  /** The amount for February when the state's rule differs (for example Maharashtra's 300). Null = same as every month. */
  februaryRupees: rupees.nullable().optional(),
  gender: z.enum(PT_GENDERS).default("any"),
});
export type PtSlab = z.infer<typeof ptSlabSchema>;

export const ptStateRuleSchema = z.object({
  /** The most that can be deducted from one employee in a financial year (₹2,500 by law). 0 = no yearly cap applied. */
  annualMaxRupees: rupees.default(2500),
  slabs: z.array(ptSlabSchema).max(30),
  note: z.string().max(300).optional(),
});
export type PtStateRule = z.infer<typeof ptStateRuleSchema>;

export const LWF_FREQUENCIES = ["monthly", "half_yearly", "yearly"] as const;
export type LwfFrequency = (typeof LWF_FREQUENCIES)[number];

export const lwfStateRuleSchema = z.object({
  frequency: z.enum(LWF_FREQUENCIES),
  /** Calendar months (1-12) in which the contribution is deducted, for example [6, 12] for half-yearly in June and December. */
  deductionMonths: z.array(z.number().int().min(1).max(12)).min(1).max(12),
  employeeRupees: rupees,
  employerRupees: rupees,
  note: z.string().max(300).optional(),
});
export type LwfStateRule = z.infer<typeof lwfStateRuleSchema>;

export const taxSlabSchema = z.object({ fromRupees: rupees, toRupees: rupees.nullable(), ratePercent: percent });
export type TaxSlab = z.infer<typeof taxSlabSchema>;

export const regimeConfigSchema = z.object({
  slabs: z.array(taxSlabSchema).max(20),
  standardDeductionRupees: rupees,
  /** s.87A: taxable income up to this gets a rebate. 0 = no rebate configured. */
  rebateThresholdRupees: rupees,
  /** The most the rebate can be (and the tax it cancels). */
  rebateMaxRupees: rupees,
  /** Marginal relief just above the rebate threshold (tax limited to the income above it). */
  marginalRelief: z.boolean().default(false),
});
export type RegimeConfig = z.infer<typeof regimeConfigSchema>;

export const statutoryRatesSchema = z.object({
  pf: z.object({
    employeePercent: percent,
    employerPercent: percent,
    epsPercent: percent,
    /** PF wage ceiling (₹15,000): contributions are on wages up to it unless the employee is on actual wages. */
    wageCeilingRupees: rupees,
    /** EPS wage ceiling (₹15,000). */
    epsWageCeilingRupees: rupees,
    rounding: z.enum(ROUNDING_MODES),
    /** The date from which a new member with wages above the ceiling is not an EPS member. */
    epsCutoffDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    /** EPS stops at this age. */
    epsStopAge: z.number().int().min(40).max(80),
  }),
  esi: z.object({
    employeePercent: percent,
    employerPercent: percent,
    wageCeilingRupees: rupees,
    rounding: z.enum(ROUNDING_MODES),
  }),
  /** Keyed by GST state code ("27" = Maharashtra). A state with no entry, or no slabs, yields 0 and a warning. */
  pt: z.record(z.string().regex(/^\d{2}$/), ptStateRuleSchema),
  lwf: z.record(z.string().regex(/^\d{2}$/), lwfStateRuleSchema),
  tds: z.object({
    cessPercent: percent,
    newRegime: regimeConfigSchema,
    oldRegime: regimeConfigSchema,
    /** Tax and income are rounded to a multiple of this many rupees (10 under s.288A/288B). 1 = no rounding. */
    roundingRupees: z.number().int().min(1).max(100),
    /** Old-regime declaration limits. 0 = no limit. */
    limits: z.object({ sec80CRupees: rupees, sec80DRupees: rupees, homeLoanInterestRupees: rupees }),
    /** A projected taxable income above this shows a "surcharge not computed" warning. 0 = off. */
    surchargeWarnAboveRupees: rupees,
  }),
  /** Due days of the month after the wage month, and return dates as "MM-DD". Shown on the statutory dues tab. */
  dueDates: z.object({
    pfDay: z.number().int().min(1).max(31),
    esiDay: z.number().int().min(1).max(31),
    tdsDepositDay: z.number().int().min(1).max(31),
    /** The deposit date for the March wage month, "MM-DD" in the next calendar year. */
    tdsMarchDeposit: z.string().regex(/^\d{2}-\d{2}$/),
    /** Null = state specific: not configured. */
    ptDay: z.number().int().min(1).max(31).nullable(),
    lwfDay: z.number().int().min(1).max(31).nullable(),
    tds24qQuarterEnd: z.object({ q1: z.string(), q2: z.string(), q3: z.string(), q4: z.string() }),
    form16: z.string(),
  }),
  gratuity: z.object({
    daysPerYear: z.number().min(0).max(60),
    workingDaysDivisor: z.number().min(1).max(31),
    minYears: z.number().min(0).max(20),
    capRupees: rupees,
  }),
  bonus: z.object({
    /** Wage ceiling for bonus, ₹. 0 = not configured (the register then shows the wages without a bonus amount). */
    wageCeilingRupees: rupees,
    /** Bonus percentage of the capped wages. 0 = not configured. */
    percent: percent,
  }),
});
export type StatutoryRates = z.infer<typeof statutoryRatesSchema>;

/**
 * What a new financial year starts from. Only figures the roadmap states, plus
 * a few long-standing ones, are filled; state slabs and income-tax slabs are
 * EMPTY unless noted. See docs/PAYROLL-CA-VERIFICATION.md for each one.
 */
export function defaultStatutoryRates(): StatutoryRates {
  return {
    pf: {
      employeePercent: 12,
      employerPercent: 12,
      epsPercent: 8.33,
      wageCeilingRupees: 15000,
      epsWageCeilingRupees: 15000,
      rounding: "nearest_rupee",
      epsCutoffDate: "2014-09-01",
      epsStopAge: 58,
    },
    esi: { employeePercent: 0.75, employerPercent: 3.25, wageCeilingRupees: 21000, rounding: "ceil_rupee" },
    pt: {
      // Maharashtra (27), monthly gross. Men: up to 7,500 nil, up to 10,000 175, above 10,000 200 (February 300).
      // Women: up to 25,000 nil, above 25,000 200 (February 300). Total at most 2,500 a year.
      "27": {
        annualMaxRupees: 2500,
        slabs: [
          { fromRupees: 0, toRupees: 7500, monthlyRupees: 0, februaryRupees: null, gender: "male" },
          { fromRupees: 7500, toRupees: 10000, monthlyRupees: 175, februaryRupees: null, gender: "male" },
          { fromRupees: 10000, toRupees: null, monthlyRupees: 200, februaryRupees: 300, gender: "male" },
          { fromRupees: 0, toRupees: 25000, monthlyRupees: 0, februaryRupees: null, gender: "female" },
          { fromRupees: 25000, toRupees: null, monthlyRupees: 200, februaryRupees: 300, gender: "female" },
        ],
        note: "Seeded default for Maharashtra; verify with your CA before use.",
      },
    },
    lwf: {},
    tds: {
      cessPercent: 4,
      newRegime: { slabs: [], standardDeductionRupees: 75000, rebateThresholdRupees: 0, rebateMaxRupees: 0, marginalRelief: false },
      oldRegime: { slabs: [], standardDeductionRupees: 0, rebateThresholdRupees: 0, rebateMaxRupees: 0, marginalRelief: false },
      roundingRupees: 10,
      limits: { sec80CRupees: 150000, sec80DRupees: 0, homeLoanInterestRupees: 200000 },
      surchargeWarnAboveRupees: 5_000_000,
    },
    dueDates: {
      pfDay: 15,
      esiDay: 15,
      tdsDepositDay: 7,
      tdsMarchDeposit: "04-30",
      ptDay: null,
      lwfDay: null,
      tds24qQuarterEnd: { q1: "07-31", q2: "10-31", q3: "01-31", q4: "05-31" },
      form16: "06-15",
    },
    gratuity: { daysPerYear: 15, workingDaysDivisor: 26, minYears: 5, capRupees: 2_000_000 },
    bonus: { wageCeilingRupees: 0, percent: 0 },
  };
}

/** Which of the defaults are empty on purpose, as a list of messages for the settings screen. */
export function ratesGaps(rates: StatutoryRates, flags: { ptStates: readonly string[]; lwfState: string | null }): string[] {
  const out: string[] = [];
  for (const s of flags.ptStates) if (!rates.pt[s]?.slabs.length) out.push(`Professional tax slabs not configured for state ${s}: add your state's slabs.`);
  if (flags.lwfState && !rates.lwf[flags.lwfState]) out.push(`Labour welfare fund amounts not configured for state ${flags.lwfState}: add them.`);
  if (!rates.tds.newRegime.slabs.length) out.push("New-regime income-tax slabs are not configured: TDS on salary is 0 for employees on the new regime until you add them.");
  if (!rates.tds.oldRegime.slabs.length) out.push("Old-regime income-tax slabs are not configured: TDS on salary is 0 for employees on the old regime until you add them.");
  return out;
}

// ── Date helpers (financial year April to March) ─────────────────────────────

/** Start year of the financial year a payroll month ("2026-10") falls in: 2026 for 2026-10, 2025 for 2026-02. */
export function fyStartYearOfMonth(month: string): number {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m >= 4 ? y : y - 1;
}

/** The twelve payroll months of a financial year, April first. */
export function monthsOfFy(fyStartYear: number): string[] {
  return Array.from({ length: 12 }, (_, i) => {
    const m = ((3 + i) % 12) + 1;
    const y = m >= 4 ? fyStartYear : fyStartYear + 1;
    return `${y}-${String(m).padStart(2, "0")}`;
  });
}

export function fyLabel(fyStartYear: number): string {
  return `${fyStartYear}-${String((fyStartYear + 1) % 100).padStart(2, "0")}`;
}

/** TDS quarter of a month: Q1 Apr-Jun, Q2 Jul-Sep, Q3 Oct-Dec, Q4 Jan-Mar. */
export function tdsQuarterOfMonth(month: string): 1 | 2 | 3 | 4 {
  const m = Number(month.split("-")[1]);
  if (m >= 4 && m <= 6) return 1;
  if (m >= 7 && m <= 9) return 2;
  if (m >= 10) return 3;
  return 4;
}

export function monthsOfQuarter(fyStartYear: number, quarter: 1 | 2 | 3 | 4): string[] {
  return monthsOfFy(fyStartYear).slice((quarter - 1) * 3, quarter * 3);
}

/**
 * Months of the FY AFTER `month`, up to the exit month (the month of the last
 * working day) when the employee leaves inside this year, else to March.
 */
export function remainingMonthsAfter(month: string, lastWorkingDay?: string | null): number {
  const fy = fyStartYearOfMonth(month);
  const all = monthsOfFy(fy);
  const idx = all.indexOf(month);
  if (idx < 0) return 0;
  let last = all.length - 1;
  if (lastWorkingDay) {
    const exitIdx = all.indexOf(lastWorkingDay.slice(0, 7));
    if (exitIdx >= 0) last = exitIdx;
    else if (lastWorkingDay.slice(0, 7) < all[0]!) last = -1;
  }
  return Math.max(0, last - idx);
}

/**
 * The ESI contribution period a month belongs to: April-September or
 * October-March. Once an employee is covered in a period, they stay covered to
 * its end, even if wages rise above the ceiling (see computeEsi).
 */
export function esiContributionPeriod(month: string): { key: string; months: string[]; label: string } {
  const fy = fyStartYearOfMonth(month);
  const all = monthsOfFy(fy);
  const first = all.indexOf(month) < 6;
  const months = first ? all.slice(0, 6) : all.slice(6);
  return { key: `${months[0]}..${months[5]}`, months, label: first ? `April to September ${fy}` : `October ${fy} to March ${fy + 1}` };
}

/** Whole years of age on a date (both "YYYY-MM-DD"); null when there is no birth date. */
export function ageOn(dateOfBirth: string | null | undefined, onDate: string): number | null {
  if (!dateOfBirth) return null;
  const [by, bm, bd] = dateOfBirth.split("-").map(Number) as [number, number, number];
  const [y, m, d] = onDate.split("-").map(Number) as [number, number, number];
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age -= 1;
  return age;
}

// ── PF: EPS eligibility ──────────────────────────────────────────────────────

export interface EpsSuggestion {
  /** "review" when it cannot be decided automatically (an international worker, or a missing date). */
  status: "eligible" | "not_eligible" | "review";
  reasons: string[];
}

/**
 * Suggest whether the employee is an EPS member. It is only a suggestion: the
 * employee's own "EPS eligible" flag is what payroll uses.
 *  - Joined PF on or after the cut-off (1 Sep 2014) with wages above the ceiling: no EPS.
 *  - Age of 58 or more: EPS stops.
 *  - International worker: a special case, flagged for review.
 */
export function suggestEpsEligibility(input: {
  dateOfBirth: string | null | undefined;
  /** The date the employee joined PF (the joining date when not recorded separately). */
  pfJoinDate: string | null | undefined;
  /** PF wages at joining, paise; null when unknown. */
  wagesAtJoiningPaise: number | null;
  internationalWorker: boolean;
  asOf: string;
  rates: Pick<StatutoryRates["pf"], "epsCutoffDate" | "epsWageCeilingRupees" | "epsStopAge">;
}): EpsSuggestion {
  const reasons: string[] = [];
  const age = ageOn(input.dateOfBirth, input.asOf);
  if (age !== null && age >= input.rates.epsStopAge) {
    return { status: "not_eligible", reasons: [`Age ${age}: EPS contributions stop at ${input.rates.epsStopAge}.`] };
  }
  if (input.internationalWorker) {
    return { status: "review", reasons: ["International workers are a special case for EPS: confirm with your CA."] };
  }
  const ceiling = rupeesToPaise(input.rates.epsWageCeilingRupees);
  if (input.pfJoinDate && input.pfJoinDate >= input.rates.epsCutoffDate) {
    if (input.wagesAtJoiningPaise === null) {
      reasons.push(`Joined PF on or after ${input.rates.epsCutoffDate}: not an EPS member if the wages at joining were above ${paiseToRupees(ceiling)}. Wages at joining are not known.`);
      return { status: "review", reasons };
    }
    if (input.wagesAtJoiningPaise > ceiling) {
      return { status: "not_eligible", reasons: [`Joined PF on or after ${input.rates.epsCutoffDate} with wages above ${paiseToRupees(ceiling)}: not an EPS member.`] };
    }
  }
  if (age === null) reasons.push("No date of birth: the age-58 rule could not be checked.");
  return { status: age === null ? "review" : "eligible", reasons };
}

// ── PF ───────────────────────────────────────────────────────────────────────

export interface PfInput {
  /** Earned PF wages this month (Basic + DA + retaining allowance, after loss of pay), paise. */
  wagesPaise: number;
  applicable: boolean;
  excluded: boolean;
  onActualWages: boolean;
  internationalWorker: boolean;
  /** Voluntary PF as a percentage of the actual wages. */
  vpfPercent: number;
  /** The EPS flag AFTER the age-58 rule (see effectiveEps). */
  epsEligible: boolean;
  rates: StatutoryRates["pf"];
}

export interface PfResult {
  member: boolean;
  /** Wages the 12% is worked on (capped at the ceiling unless on actual wages). */
  contributionWagesPaise: number;
  epsWagesPaise: number;
  /** EDLI wages: the wages capped at the ceiling. */
  edliWagesPaise: number;
  employeePaise: number;
  vpfPaise: number;
  /** The employer's 12% in all (EPF share + EPS). */
  employerTotalPaise: number;
  employerEpfPaise: number;
  employerEpsPaise: number;
}

const ZERO_PF: PfResult = { member: false, contributionWagesPaise: 0, epsWagesPaise: 0, edliWagesPaise: 0, employeePaise: 0, vpfPaise: 0, employerTotalPaise: 0, employerEpfPaise: 0, employerEpsPaise: 0 };

/**
 * PF for one month.
 *  - Contributions are on the wages capped at the ceiling, unless the employee
 *    is on actual wages (or an international worker, who has no ceiling).
 *  - Employee = 12% of those wages; VPF = vpf % of the actual wages.
 *  - Employer 12% in all. With EPS: 8.33% of the wages capped at the EPS ceiling
 *    goes to EPS and the rest to EPF; without EPS the whole 12% goes to EPF.
 *  - Each amount is rounded once, by the rounding mode; the EPF share is the
 *    rounded employer total less the rounded EPS, so the shares add up.
 *  - An excluded employee, or one with PF off, has no PF at all.
 */
export function computePf(input: PfInput): PfResult {
  if (!input.applicable || input.excluded || input.wagesPaise <= 0) return { ...ZERO_PF, member: input.applicable && !input.excluded };
  const r = input.rates;
  const ceiling = rupeesToPaise(r.wageCeilingRupees);
  const epsCeiling = rupeesToPaise(r.epsWageCeilingRupees);
  const wages = input.wagesPaise;
  const contributionWagesPaise = input.onActualWages || input.internationalWorker ? wages : Math.min(wages, ceiling);
  const employeePaise = roundPaise(percentOf(contributionWagesPaise, r.employeePercent), r.rounding);
  const vpfPaise = input.vpfPercent > 0 ? roundPaise(percentOf(wages, input.vpfPercent), r.rounding) : 0;
  const employerTotalPaise = roundPaise(percentOf(contributionWagesPaise, r.employerPercent), r.rounding);
  const epsWagesPaise = input.epsEligible ? Math.min(contributionWagesPaise, epsCeiling) : 0;
  const employerEpsPaise = input.epsEligible ? Math.min(roundPaise(percentOf(epsWagesPaise, r.epsPercent), r.rounding), employerTotalPaise) : 0;
  return {
    member: true,
    contributionWagesPaise,
    epsWagesPaise,
    edliWagesPaise: Math.min(wages, ceiling),
    employeePaise,
    vpfPaise,
    employerTotalPaise,
    employerEpfPaise: employerTotalPaise - employerEpsPaise,
    employerEpsPaise,
  };
}

/** The EPS flag payroll uses: the employee's flag, switched off from the age EPS stops at (age on the first of the month). */
export function effectiveEps(input: { epsFlag: boolean; dateOfBirth: string | null | undefined; month: string; stopAge: number }): boolean {
  if (!input.epsFlag) return false;
  const age = ageOn(input.dateOfBirth, `${input.month}-01`);
  return !(age !== null && age >= input.stopAge);
}

// ── ESI ──────────────────────────────────────────────────────────────────────

export interface EsiInput {
  /** Earned ESI wages this month, paise (what the contribution is worked on). */
  wagesPaise: number;
  /** The full-month wages of the salary structure, paise (what the ceiling test uses). */
  fullMonthWagesPaise: number;
  applicable: boolean;
  /** Already covered (contributed) earlier in the current contribution period. */
  coveredEarlierInPeriod: boolean;
  rates: StatutoryRates["esi"];
}

export interface EsiResult {
  covered: boolean;
  reason: "not_applicable" | "within_ceiling" | "kept_for_period" | "above_ceiling" | "no_wages";
  wagesPaise: number;
  employeePaise: number;
  employerPaise: number;
}

/**
 * ESI for one month. Covered while the full-month wages are at or below the
 * ceiling (exactly the ceiling is covered). CONTRIBUTION-PERIOD RULE (as
 * implemented): the periods are April-September and October-March; an employee
 * who contributed in an earlier month of the current period stays covered
 * until that period ends even if wages rise above the ceiling, and is tested
 * afresh at the start of the next period. Contributions are on the earned
 * wages of the month and rounded by the rounding mode (default: up to the next
 * rupee).
 */
export function computeEsi(input: EsiInput): EsiResult {
  const none = (reason: EsiResult["reason"]): EsiResult => ({ covered: false, reason, wagesPaise: 0, employeePaise: 0, employerPaise: 0 });
  if (!input.applicable) return none("not_applicable");
  const ceiling = rupeesToPaise(input.rates.wageCeilingRupees);
  let reason: EsiResult["reason"];
  if (input.fullMonthWagesPaise <= ceiling) reason = "within_ceiling";
  else if (input.coveredEarlierInPeriod) reason = "kept_for_period";
  else return none("above_ceiling");
  if (input.wagesPaise <= 0) return { ...none("no_wages"), covered: true };
  return {
    covered: true,
    reason,
    wagesPaise: input.wagesPaise,
    employeePaise: roundPaise(percentOf(input.wagesPaise, input.rates.employeePercent), input.rates.rounding),
    employerPaise: roundPaise(percentOf(input.wagesPaise, input.rates.employerPercent), input.rates.rounding),
  };
}

// ── Professional tax ─────────────────────────────────────────────────────────

export interface PtResult {
  paise: number;
  /** "ok", or why nothing was deducted. */
  status: "ok" | "not_configured" | "gender_missing";
  /** The slab that applied (rupees), for the payslip and the return. */
  slab: { fromRupees: number; toRupees: number | null; monthlyRupees: number } | null;
}

/**
 * Professional tax for one month on the month's gross. Slabs are chosen by the
 * employee's gender when the state has gender-specific slabs (otherwise the
 * "any" slabs); a missing gender uses the "male" slabs and says so. February
 * uses the slab's February amount when one is configured. The yearly cap is
 * applied against what was already deducted this financial year.
 */
export function computePt(input: { grossPaise: number; month: string; gender: string | null | undefined; rule: PtStateRule | undefined; paidThisFyPaise: number }): PtResult {
  const rule = input.rule;
  if (!rule || rule.slabs.length === 0) return { paise: 0, status: "not_configured", slab: null };
  const g = input.gender === "male" || input.gender === "female" ? input.gender : null;
  let slabs = g ? rule.slabs.filter((s) => s.gender === g) : [];
  let status: PtResult["status"] = "ok";
  if (slabs.length === 0) slabs = rule.slabs.filter((s) => s.gender === "any");
  if (slabs.length === 0) {
    slabs = rule.slabs.filter((s) => s.gender === "male");
    if (!g) status = "gender_missing";
    if (slabs.length === 0) slabs = rule.slabs;
  }
  const hit = slabs.find((s) => input.grossPaise > rupeesToPaise(s.fromRupees) && (s.toRupees === null || input.grossPaise <= rupeesToPaise(s.toRupees)));
  if (!hit || input.grossPaise <= 0) return { paise: 0, status, slab: null };
  const isFeb = input.month.endsWith("-02");
  let amount = rupeesToPaise(isFeb && hit.februaryRupees != null ? hit.februaryRupees : hit.monthlyRupees);
  if (rule.annualMaxRupees > 0) amount = Math.min(amount, Math.max(0, rupeesToPaise(rule.annualMaxRupees) - input.paidThisFyPaise));
  return { paise: amount, status, slab: { fromRupees: hit.fromRupees, toRupees: hit.toRupees, monthlyRupees: hit.monthlyRupees } };
}

/** Whether a state's slabs overlap within a gender (a settings mistake). Returns the messages. */
export function validatePtRule(rule: PtStateRule): string[] {
  const out: string[] = [];
  for (const g of PT_GENDERS) {
    const s = rule.slabs.filter((x) => x.gender === g).sort((a, b) => a.fromRupees - b.fromRupees);
    for (let i = 0; i < s.length; i++) {
      const cur = s[i]!;
      if (cur.toRupees !== null && cur.toRupees <= cur.fromRupees) out.push(`A slab ends at or below where it starts (${cur.fromRupees}).`);
      const next = s[i + 1];
      if (next && (cur.toRupees === null || cur.toRupees > next.fromRupees)) out.push(`Slabs overlap around ${next.fromRupees}.`);
    }
  }
  return out;
}

// ── Labour welfare fund ──────────────────────────────────────────────────────

export interface LwfResult {
  due: boolean;
  employeePaise: number;
  employerPaise: number;
}

/** LWF for one month: the configured amounts in the configured deduction months (monthly, half-yearly or yearly), else nothing. */
export function computeLwf(input: { month: string; rule: LwfStateRule | undefined }): LwfResult {
  if (!input.rule) return { due: false, employeePaise: 0, employerPaise: 0 };
  const m = Number(input.month.split("-")[1]);
  const months = input.rule.frequency === "monthly" ? Array.from({ length: 12 }, (_, i) => i + 1) : input.rule.deductionMonths;
  if (!months.includes(m)) return { due: false, employeePaise: 0, employerPaise: 0 };
  return { due: true, employeePaise: rupeesToPaise(input.rule.employeeRupees), employerPaise: rupeesToPaise(input.rule.employerRupees) };
}

// ── Income tax: slabs, rebate, cess ──────────────────────────────────────────

export interface TaxResult {
  /** Tax on the slabs before rebate. */
  slabTaxPaise: number;
  /** s.87A rebate (and marginal relief), the amount taken off. */
  rebatePaise: number;
  taxAfterRebatePaise: number;
  cessPaise: number;
  /** Tax plus cess, rounded to the configured multiple. */
  totalPaise: number;
}

/** Round paise to the nearest multiple of `rupeesStep` rupees, half up. */
export function roundToRupeeStep(paise: number, rupeesStep: number): number {
  if (paise <= 0) return 0;
  const step = Math.max(1, rupeesStep) * 100;
  return roundDiv(paise, step) * step;
}

/**
 * Annual tax on a taxable income for one regime: tax on the slabs, then the
 * s.87A rebate (when the income is within the threshold; marginal relief above
 * it when switched on), then cess on that, then the total rounded to the
 * configured multiple (₹10). The income is rounded the same way first.
 */
export function computeAnnualTax(input: { taxableIncomePaise: number; regime: RegimeConfig; cessPercent: number; roundingRupees: number }): TaxResult {
  const income = roundToRupeeStep(Math.max(0, input.taxableIncomePaise), input.roundingRupees);
  let weighted = 0;
  for (const s of input.regime.slabs) {
    const lo = rupeesToPaise(s.fromRupees);
    const hi = s.toRupees === null ? Number.POSITIVE_INFINITY : rupeesToPaise(s.toRupees);
    const portion = Math.max(0, Math.min(income, hi) - lo);
    weighted += portion * Math.round(s.ratePercent * 100);
  }
  const slabTaxPaise = roundDiv(weighted, 10_000);
  const threshold = rupeesToPaise(input.regime.rebateThresholdRupees);
  let after = slabTaxPaise;
  if (threshold > 0) {
    if (income <= threshold) after = Math.max(0, slabTaxPaise - rupeesToPaise(input.regime.rebateMaxRupees));
    else if (input.regime.marginalRelief) after = Math.min(slabTaxPaise, income - threshold);
  }
  const cessPaise = percentOf(after, input.cessPercent);
  return {
    slabTaxPaise,
    rebatePaise: slabTaxPaise - after,
    taxAfterRebatePaise: after,
    cessPaise,
    totalPaise: roundToRupeeStep(after + cessPaise, input.roundingRupees),
  };
}

// ── TDS on salary (s.192) ────────────────────────────────────────────────────

/** An employee's investment declarations for the year, in rupees. Used under the old regime only. */
export const taxDeclarationSchema = z.object({
  sec80C: rupees.default(0),
  sec80D: rupees.default(0),
  hraExemption: rupees.default(0),
  homeLoanInterest: rupees.default(0),
  otherDeductions: rupees.default(0),
  /** Income from a previous employer in the same financial year (taxable salary), and tax it deducted. */
  previousEmployerIncome: rupees.default(0),
  previousEmployerTds: rupees.default(0),
});
export type TaxDeclaration = z.infer<typeof taxDeclarationSchema>;

export const EMPTY_DECLARATION: TaxDeclaration = taxDeclarationSchema.parse({});

export interface TdsProjectionInput {
  regime: "new" | "old";
  tds: StatutoryRates["tds"];
  /** Gross salary of the earlier months of this financial year from this employer, paise. */
  grossToDatePaise: number;
  grossThisMonthPaise: number;
  /** The full-month gross the remaining months are projected at, paise. */
  projectedMonthlyGrossPaise: number;
  /** Months of the year after this one in which the employee is still employed. */
  remainingMonths: number;
  tdsToDatePaise: number;
  /** Professional tax deducted so far this year, this month's, and the projected monthly amount (old regime: deductible). */
  ptToDatePaise: number;
  ptThisMonthPaise: number;
  declaration: TaxDeclaration;
  /** Amounts already computed for other deductions are not needed here: the cap against take-home is the caller's job. */
}

export interface TdsProjection {
  annualGrossPaise: number;
  standardDeductionPaise: number;
  declaredDeductionsPaise: number;
  professionalTaxPaise: number;
  taxableIncomePaise: number;
  tax: TaxResult;
  /** Tax of the year less the tax already deducted (here and at a previous employer). */
  remainingTaxPaise: number;
  /** This month's deduction: the remaining tax spread over this and the remaining months. */
  thisMonthPaise: number;
  monthsLeftIncludingThis: number;
  slabsMissing: boolean;
  warnings: PayrollWarning[];
}

/**
 * Projected annual tax and this month's TDS.
 *  - Annual income = gross to date + this month + remaining months at the full monthly gross + a previous employer's income.
 *  - Less the standard deduction of the regime; the old regime also takes the declared amounts (80C, 80D, home-loan interest within their limits; HRA exemption and others as entered) and professional tax.
 *  - Tax by slabs, rebate, cess, rounded (computeAnnualTax); less the TDS already deducted (and a previous employer's).
 *  - This month = what is left / (remaining months + this one), rounded to the nearest rupee, never negative and never more than what is left.
 * Re-running it every month spreads any change (a raise, a bonus, a new declaration) over the months that remain.
 */
export function projectSalaryTds(input: TdsProjectionInput): TdsProjection {
  const regime = input.regime === "new" ? input.tds.newRegime : input.tds.oldRegime;
  const d = input.declaration;
  const warnings: PayrollWarning[] = [];
  const monthsLeft = input.remainingMonths + 1;
  const annualGrossPaise = input.grossToDatePaise + input.grossThisMonthPaise + input.projectedMonthlyGrossPaise * input.remainingMonths + rupeesToPaise(d.previousEmployerIncome);
  const standardDeductionPaise = rupeesToPaise(regime.standardDeductionRupees);
  const capped = (declared: number, limit: number) => (limit > 0 ? Math.min(declared, limit) : declared);
  let declaredDeductionsPaise = 0;
  let professionalTaxPaise = 0;
  if (input.regime === "old") {
    declaredDeductionsPaise =
      rupeesToPaise(capped(d.sec80C, input.tds.limits.sec80CRupees)) +
      rupeesToPaise(capped(d.sec80D, input.tds.limits.sec80DRupees)) +
      rupeesToPaise(capped(d.homeLoanInterest, input.tds.limits.homeLoanInterestRupees)) +
      rupeesToPaise(d.hraExemption) +
      rupeesToPaise(d.otherDeductions);
    professionalTaxPaise = input.ptToDatePaise + input.ptThisMonthPaise * (1 + input.remainingMonths);
  }
  const taxableIncomePaise = Math.max(0, annualGrossPaise - standardDeductionPaise - declaredDeductionsPaise - professionalTaxPaise);
  const slabsMissing = regime.slabs.length === 0;
  const tax = slabsMissing
    ? { slabTaxPaise: 0, rebatePaise: 0, taxAfterRebatePaise: 0, cessPaise: 0, totalPaise: 0 }
    : computeAnnualTax({ taxableIncomePaise, regime, cessPercent: input.tds.cessPercent, roundingRupees: input.tds.roundingRupees });
  if (slabsMissing) {
    warnings.push({
      code: "tax_slabs_missing",
      message: `${input.regime === "new" ? "New" : "Old"}-regime income-tax slabs are not configured, so no TDS was deducted. Add them in Statutory settings.`,
    });
  }
  const surcharge = rupeesToPaise(input.tds.surchargeWarnAboveRupees);
  if (surcharge > 0 && taxableIncomePaise > surcharge) {
    warnings.push({ code: "tds_surcharge", message: "Projected taxable income is high enough that a surcharge may apply. Surcharge is not computed here: check the TDS with your CA." });
  }
  const remainingTaxPaise = Math.max(0, tax.totalPaise - input.tdsToDatePaise - rupeesToPaise(d.previousEmployerTds));
  const thisMonthPaise = Math.min(remainingTaxPaise, roundDiv(remainingTaxPaise, monthsLeft * 100) * 100);
  return {
    annualGrossPaise,
    standardDeductionPaise,
    declaredDeductionsPaise,
    professionalTaxPaise,
    taxableIncomePaise,
    tax,
    remainingTaxPaise,
    thisMonthPaise: slabsMissing ? 0 : thisMonthPaise,
    monthsLeftIncludingThis: monthsLeft,
    slabsMissing,
    warnings,
  };
}

// ── One employee-month, all statutory parts ──────────────────────────────────

export interface StatutoryContext {
  month: string;
  rates: StatutoryRates;
  business: { pfRegistered: boolean; esiRegistered: boolean; ptStates: readonly string[]; lwfState: string | null; tdsEnabled: boolean };
}

export interface StatutoryEmployee {
  pfApplicable: boolean;
  pfExcluded: boolean;
  epsEligible: boolean;
  pfOnActualWages: boolean;
  internationalWorker: boolean;
  vpfPercent: number;
  esiApplicable: boolean;
  dateOfBirth: string | null;
  gender: string | null;
  workState: string | null;
  lastWorkingDay: string | null;
  hasPan: boolean;
  hasUan: boolean;
  hasEsicNumber: boolean;
  taxRegime: "new" | "old";
  declaration: TaxDeclaration;
}

export interface StatutoryHistory {
  /** An earlier month of this ESI contribution period had an ESI contribution. */
  esiCoveredEarlierInPeriod: boolean;
  ptPaidThisFyPaise: number;
  /** TDS: earlier months of this FY from this employer. */
  grossToDatePaise: number;
  tdsToDatePaise: number;
  /** Earlier months of the year in which the employee was employed but has no approved payroll line. */
  missingMonths: number;
}

export interface StatutoryDetails {
  pf: { member: boolean; contributionWagesPaise: number; epfWagesPaise: number; epsWagesPaise: number; edliWagesPaise: number; epsEligible: boolean; wagesPaise: number } | null;
  esi: { covered: boolean; reason: EsiResult["reason"]; wagesPaise: number } | null;
  pt: { state: string | null; grossPaise: number; status: PtResult["status"] } | null;
  lwf: { state: string; due: boolean } | null;
  tds: {
    regime: "new" | "old";
    annualGrossPaise: number;
    taxableIncomePaise: number;
    annualTaxPaise: number;
    remainingTaxPaise: number;
    monthsLeft: number;
    thisMonthPaise: number;
  } | null;
}

export interface StatutoryLineResult {
  components: PayrollLineComponent[];
  details: StatutoryDetails;
  warnings: PayrollWarning[];
}

/** An earning component counts as PF wages when it is Basic, DA, retaining allowance or flagged as a wage. */
function isWageComponent(c: { type: string; category: string; isWage: boolean }): boolean {
  return c.type === "earning" && (c.isWage || (WAGE_CATEGORIES as readonly string[]).includes(c.category));
}

function statutoryComponent(kind: NonNullable<PayrollLineComponent["statutoryKind"]>, code: string, name: string, type: "deduction" | "employer_contribution", amountPaise: number): PayrollLineComponent {
  return {
    code,
    name,
    type,
    category: type === "deduction" ? "other_deduction" : "other_employer",
    isWage: false,
    statutoryKind: kind,
    fullPaise: 0,
    amountPaise,
    source: "statutory",
  };
}

/**
 * Every statutory amount of one employee for one month, from the already
 * calculated pay line. Returns components to append (applyStatutoryToLine).
 * Nothing about a part the business is not registered for is ever produced:
 * with PF off there is no PF, VPF or EPS component and no PF detail at all.
 */
export function computeStatutoryLine(input: {
  ctx: StatutoryContext;
  employee: StatutoryEmployee;
  line: PayrollLineResult;
  /** Full-month earnings of the salary structure (not reduced by loss of pay), paise. */
  fullMonthEarnings: ReadonlyArray<{ type: string; category: string; isWage: boolean; monthlyPaise: number }>;
  history: StatutoryHistory;
}): StatutoryLineResult {
  const { ctx, employee: e, line, history } = input;
  const { rates, business } = ctx;
  const warnings: PayrollWarning[] = [];
  const components: PayrollLineComponent[] = [];
  const details: StatutoryDetails = { pf: null, esi: null, pt: null, lwf: null, tds: null };

  const structure = line.components.filter((c) => c.source === "structure");
  const wagesPaise = structure.filter(isWageComponent).reduce((s, c) => s + c.amountPaise, 0);

  // PF (EPF, VPF, EPS)
  if (business.pfRegistered) {
    const eps = effectiveEps({ epsFlag: e.epsEligible, dateOfBirth: e.dateOfBirth, month: ctx.month, stopAge: rates.pf.epsStopAge });
    const pf = computePf({
      wagesPaise,
      applicable: e.pfApplicable,
      excluded: e.pfExcluded,
      onActualWages: e.pfOnActualWages,
      internationalWorker: e.internationalWorker,
      vpfPercent: e.vpfPercent,
      epsEligible: eps,
      rates: rates.pf,
    });
    details.pf = {
      member: pf.member,
      contributionWagesPaise: pf.contributionWagesPaise,
      epfWagesPaise: pf.contributionWagesPaise,
      epsWagesPaise: pf.epsWagesPaise,
      edliWagesPaise: pf.edliWagesPaise,
      epsEligible: eps && pf.member,
      wagesPaise,
    };
    if (pf.member) {
      if (pf.employeePaise > 0) components.push(statutoryComponent("pf_employee", "PF_EE", "Provident fund (employee)", "deduction", pf.employeePaise));
      if (pf.vpfPaise > 0) components.push(statutoryComponent("vpf", "VPF", "Voluntary provident fund", "deduction", pf.vpfPaise));
      if (pf.employerEpfPaise > 0) components.push(statutoryComponent("pf_employer", "PF_ER", "Provident fund (employer EPF share)", "employer_contribution", pf.employerEpfPaise));
      if (pf.employerEpsPaise > 0) components.push(statutoryComponent("eps_employer", "EPS_ER", "Employees' pension scheme (employer)", "employer_contribution", pf.employerEpsPaise));
      if (!e.hasUan) warnings.push({ code: "pf_uan_missing", message: "No UAN on the employee: the PF contribution is calculated but the employee cannot be in the ECR file until a UAN is added." });
    } else if (e.pfExcluded) {
      // An excluded employee is outside PF: no lines, a reminder only when wages are low.
      if (wagesPaise > 0 && wagesPaise <= rupeesToPaise(rates.pf.wageCeilingRupees)) {
        warnings.push({ code: "pf_excluded_review", message: "Marked as an excluded employee, but the wages are within the PF ceiling. Excluded employees should have wages above it and never have been PF members: check with your CA." });
      }
    }
  }

  // ESI
  if (business.esiRegistered) {
    const fullWages = input.fullMonthEarnings.filter((c) => c.type === "earning" && c.category !== "overtime").reduce((s, c) => s + c.monthlyPaise, 0);
    const earnedWages = structure.filter((c) => c.type === "earning" && c.category !== "overtime").reduce((s, c) => s + c.amountPaise, 0);
    const esi = computeEsi({ wagesPaise: earnedWages, fullMonthWagesPaise: fullWages, applicable: e.esiApplicable, coveredEarlierInPeriod: history.esiCoveredEarlierInPeriod, rates: rates.esi });
    details.esi = { covered: esi.covered, reason: esi.reason, wagesPaise: esi.wagesPaise };
    if (esi.employeePaise > 0) components.push(statutoryComponent("esi_employee", "ESI_EE", "ESI (employee)", "deduction", esi.employeePaise));
    if (esi.employerPaise > 0) components.push(statutoryComponent("esi_employer", "ESI_ER", "ESI (employer)", "employer_contribution", esi.employerPaise));
    if (esi.covered && !e.hasEsicNumber) warnings.push({ code: "esi_number_missing", message: "No ESIC insurance number on the employee: add it before generating the ESIC file." });
  }

  // Professional tax
  let ptPaise = 0;
  if (business.ptStates.length > 0) {
    const state = e.workState && business.ptStates.includes(e.workState) ? e.workState : !e.workState && business.ptStates.length === 1 ? business.ptStates[0]! : null;
    if (!state) {
      if (!e.workState && business.ptStates.length > 1) {
        warnings.push({ code: "pt_state_missing", message: "The business has professional tax in more than one state and the employee has no work state, so no professional tax was deducted. Set the employee's work state." });
      }
      // A work state with no professional-tax registration: nothing to deduct.
    } else {
      const pt = computePt({ grossPaise: line.grossPaise, month: ctx.month, gender: e.gender, rule: rates.pt[state], paidThisFyPaise: history.ptPaidThisFyPaise });
      details.pt = { state, grossPaise: line.grossPaise, status: pt.status };
      ptPaise = pt.paise;
      if (pt.status === "not_configured") {
        warnings.push({ code: "pt_slabs_missing", message: `Professional tax slabs are not configured for state ${state}, so no professional tax was deducted. Add your state's slabs in Statutory settings.` });
      } else if (pt.status === "gender_missing") {
        warnings.push({ code: "pt_gender_missing", message: "The state's professional tax slabs depend on gender and the employee's gender is not set: the male slabs were used." });
      }
      if (pt.paise > 0) components.push(statutoryComponent("professional_tax", "PT", "Professional tax", "deduction", pt.paise));
    }
  }

  // Labour welfare fund
  if (business.lwfState) {
    const rule = rates.lwf[business.lwfState];
    if (!rule) {
      warnings.push({ code: "lwf_not_configured", message: `Labour welfare fund amounts are not configured for state ${business.lwfState}, so none was deducted. Add them in Statutory settings.` });
    } else if (!e.workState || e.workState === business.lwfState) {
      const lwf = computeLwf({ month: ctx.month, rule });
      details.lwf = { state: business.lwfState, due: lwf.due };
      if (lwf.employeePaise > 0 && line.grossPaise > 0) components.push(statutoryComponent("lwf_employee", "LWF_EE", "Labour welfare fund (employee)", "deduction", lwf.employeePaise));
      if (lwf.employerPaise > 0 && line.grossPaise > 0) components.push(statutoryComponent("lwf_employer", "LWF_ER", "Labour welfare fund (employer)", "employer_contribution", lwf.employerPaise));
    }
  }

  // TDS on salary (s.192): only when the business deducts it (it turned it on in Statutory settings)
  if (business.tdsEnabled) {
  const fullGross = input.fullMonthEarnings.filter((c) => c.type === "earning" && c.category !== "overtime").reduce((s, c) => s + c.monthlyPaise, 0);
  const proj = projectSalaryTds({
    regime: e.taxRegime,
    tds: rates.tds,
    grossToDatePaise: history.grossToDatePaise,
    grossThisMonthPaise: line.grossPaise,
    projectedMonthlyGrossPaise: fullGross,
    remainingMonths: remainingMonthsAfter(ctx.month, e.lastWorkingDay),
    tdsToDatePaise: history.tdsToDatePaise,
    ptToDatePaise: history.ptPaidThisFyPaise,
    ptThisMonthPaise: ptPaise,
    declaration: e.declaration,
  });
  warnings.push(...proj.warnings);
  let tdsPaise = proj.thisMonthPaise;
  const withheldBefore = line.deductionsPaise + components.filter((c) => c.type === "deduction").reduce((s, c) => s + c.amountPaise, 0);
  const available = Math.max(0, line.grossPaise - withheldBefore);
  if (tdsPaise > available) {
    warnings.push({ code: "tds_capped", message: `TDS of ${paiseToRupees(tdsPaise)} was reduced to ${paiseToRupees(available)} because the pay after other deductions is not enough. The rest is spread over the coming months.` });
    tdsPaise = available;
  }
  if (tdsPaise > 0) {
    if (!e.hasPan) warnings.push({ code: "tds_pan_missing", message: "No PAN on the employee: TDS is worked out at the normal rates. A missing PAN may attract a higher rate under s.206AA: check with your CA." });
    components.push(statutoryComponent("income_tax_tds", "TDS", "Income tax (TDS on salary)", "deduction", tdsPaise));
  } else if (!e.hasPan && proj.tax.totalPaise > 0) {
    warnings.push({ code: "tds_pan_missing", message: "No PAN on the employee: add it before the TDS return." });
  }
  const age = ageOn(e.dateOfBirth, `${ctx.month}-01`);
  if (age !== null && age >= 60 && e.taxRegime === "old") {
    warnings.push({ code: "tds_senior_citizen", message: "The employee is 60 or older: senior-citizen slabs are not applied automatically. Edit the old-regime slabs or check the TDS with your CA." });
  }
  if (history.missingMonths > 0) {
    warnings.push({ code: "tds_history_gap", message: `${history.missingMonths} earlier month(s) of this financial year have no approved payroll for this employee, so the tax already deducted may be incomplete. Check the TDS with your CA.` });
  }
  details.tds = {
    regime: e.taxRegime,
    annualGrossPaise: proj.annualGrossPaise,
    taxableIncomePaise: proj.taxableIncomePaise,
    annualTaxPaise: proj.tax.totalPaise,
    remainingTaxPaise: proj.remainingTaxPaise,
    monthsLeft: proj.monthsLeftIncludingThis,
    thisMonthPaise: tdsPaise,
  };
  }

  return { components, details, warnings };
}

/**
 * Add statutory components to a calculated pay line and recompute its totals
 * and its negative-net warning. A line the statutory parts do not touch is
 * returned unchanged.
 */
export function applyStatutoryToLine(line: PayrollLineResult, statutory: ReadonlyArray<PayrollLineComponent>): PayrollLineResult {
  if (statutory.length === 0) return line;
  const components = [...line.components, ...statutory];
  const sum = (type: PayrollLineComponent["type"]) => components.filter((c) => c.type === type).reduce((s, c) => s + c.amountPaise, 0);
  const grossPaise = sum("earning");
  const deductionsPaise = sum("deduction");
  const employerPaise = sum("employer_contribution");
  const netPaise = grossPaise - deductionsPaise;
  const warnings = line.warnings.filter((w) => w.code !== "negative_net");
  if (netPaise < 0) {
    warnings.push({
      code: "negative_net",
      message: `Deductions (${paiseToRupees(deductionsPaise)}) are more than the earnings (${paiseToRupees(grossPaise)}). Reduce a deduction before approving.`,
    });
  }
  return { ...line, components, grossPaise, deductionsPaise, employerPaise, netPaise, warnings };
}

/** A manual deduction that looks like a statutory one entered in Phase 1 (a double-deduction risk once the automatic ones run). */
export function looksLikeManualStatutory(c: { name: string; code: string; statutoryKind?: string | null; source?: string }): boolean {
  if (c.statutoryKind || c.source === "statutory") return false;
  return /\b(pf|epf|vpf|esi|esic|pt|tds|prof(essional)?\s*tax|provident|income\s*tax)\b/i.test(`${c.name} ${c.code}`);
}

// ── Due dates ────────────────────────────────────────────────────────────────

/**
 * The date a statutory amount of a wage month is due ("YYYY-MM-DD"), from the
 * configured due days (the month after the wage month; the March TDS has its own
 * date). Null when the due day is not configured (PT and LWF are state specific).
 */
export function statutoryDueDate(group: StatutoryPayableGroup, month: string, due: StatutoryRates["dueDates"]): string | null {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const dm = m === 12 ? 1 : m + 1;
  const dy = m === 12 ? y + 1 : y;
  if (group === "tds" && m === 3) return `${dy}-${due.tdsMarchDeposit}`;
  const day = group === "pf" ? due.pfDay : group === "esi" ? due.esiDay : group === "tds" ? due.tdsDepositDay : group === "pt" ? due.ptDay : due.lwfDay;
  if (day === null) return null;
  const last = new Date(Date.UTC(dy, dm, 0)).getUTCDate();
  return `${dy}-${String(dm).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

// ── Input schemas (API, web) ─────────────────────────────────────────────────

const uuidField = z.string().uuid();
const stateCodeField = z.string().refine(isStateCode, "Choose a state.");
const optionalText = (max: number) => z.union([z.literal(""), z.string().trim().max(max)]).optional();

export const statutoryBusinessSettingsSchema = z.object({
  pfRegistered: z.boolean(),
  pfEstablishmentCode: optionalText(30),
  esiRegistered: z.boolean(),
  esiCode: optionalText(30),
  /** States the business deducts professional tax in (GST state codes). */
  ptStates: z.array(stateCodeField).max(40),
  lwfState: z.union([z.literal(""), stateCodeField]).nullable().optional(),
  tdsEnabled: z.boolean(),
});

export const statutoryRatesSaveSchema = z.object({
  /** Start year of the financial year the figures apply from (2026 = 2026-27). */
  financialYear: z.number().int().min(2020).max(2100),
  rates: statutoryRatesSchema,
  /** "Last verified" note: who checked the figures and against what. */
  verifiedNote: optionalText(300),
  verifiedOn: z.union([z.literal(""), isoDateSchema]).optional(),
});

export const employeeStatutorySchema = z.object({
  employeeId: uuidField,
  pfApplicable: z.boolean().optional(),
  pfExcluded: z.boolean().optional(),
  epsEligible: z.boolean().optional(),
  pfOnActualWages: z.boolean().optional(),
  vpfPercent: z.number().min(0).max(100).optional(),
  internationalWorker: z.boolean().optional(),
  pfJoinDate: z.union([z.literal(""), isoDateSchema]).nullable().optional(),
  esiApplicable: z.boolean().optional(),
});

export const taxDeclarationSaveSchema = z.object({
  employeeId: uuidField,
  financialYear: z.number().int().min(2020).max(2100),
  amounts: taxDeclarationSchema,
});

export const statutoryPaymentSchema = z.object({
  runId: uuidField,
  kind: z.enum(STATUTORY_PAYABLE_GROUPS),
  /** Rupees. */
  amount: z.number().positive("Enter an amount above zero.").max(1_000_000_000),
  paidOn: isoDateSchema,
  bankAccountId: uuidField,
  challanNumber: optionalText(40),
  challanDate: z.union([z.literal(""), isoDateSchema]).optional(),
  reference: optionalText(100),
});

export const FILING_REGISTERS = ["wages", "attendance", "leave", "bonus", "gratuity"] as const;
export type FilingRegister = (typeof FILING_REGISTERS)[number];

export const fyInputSchema = z.object({ financialYear: z.number().int().min(2020).max(2100).optional() });
