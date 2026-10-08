/**
 * Payroll calculation (pure: no database, no clock, no floating point money).
 *
 * All money in this file is integer PAISE. Callers convert from and to the
 * "1234.50" strings the database uses with rupeesToPaise / paiseToRupees.
 *
 * Rounding rule (the only one, everywhere): every amount that is derived by a
 * multiplication or a division is rounded ONCE, half up, to the nearest paisa
 * (roundDiv). Totals are the SUM of the rounded parts and are never rounded
 * again, so a payslip always adds up to the paisa.
 *
 * This file covers earnings, manual deductions and employer contributions you
 * enter yourself. Provident fund, ESI, professional tax, LWF and income-tax TDS
 * are computed in payroll-statutory.ts and added to a line afterwards
 * (applyStatutoryToLine); their components carry a `statutoryKind`.
 */

// ── Component model ──────────────────────────────────────────────────────────

export const COMPONENT_TYPES = ["earning", "deduction", "employer_contribution"] as const;
export type ComponentType = (typeof COMPONENT_TYPES)[number];

export const COMPONENT_TYPE_LABELS: Record<ComponentType, string> = {
  earning: "Earning",
  deduction: "Deduction",
  employer_contribution: "Employer contribution",
};

export const EARNING_CATEGORIES = [
  "basic", "da", "retaining_allowance", "hra", "conveyance", "special_allowance", "bonus", "incentive", "overtime", "other_earning",
] as const;
export const DEDUCTION_CATEGORIES = ["manual_deduction", "advance_recovery", "other_deduction"] as const;
export const EMPLOYER_CATEGORIES = ["other_employer"] as const;

export const COMPONENT_CATEGORIES = [...EARNING_CATEGORIES, ...DEDUCTION_CATEGORIES, ...EMPLOYER_CATEGORIES] as const;
export type ComponentCategory = (typeof COMPONENT_CATEGORIES)[number];

export const COMPONENT_CATEGORY_LABELS: Record<ComponentCategory, string> = {
  basic: "Basic",
  da: "Dearness allowance (DA)",
  retaining_allowance: "Retaining allowance",
  hra: "House rent allowance (HRA)",
  conveyance: "Conveyance",
  special_allowance: "Special allowance",
  bonus: "Bonus",
  incentive: "Incentive",
  overtime: "Overtime",
  other_earning: "Other earning",
  manual_deduction: "Manual deduction",
  advance_recovery: "Advance recovery",
  other_deduction: "Other deduction",
  other_employer: "Employer contribution",
};

export function categoriesForType(type: ComponentType): readonly ComponentCategory[] {
  return type === "earning" ? EARNING_CATEGORIES : type === "deduction" ? DEDUCTION_CATEGORIES : EMPLOYER_CATEGORIES;
}

/** Categories that count as "wages" under the Labour Codes (Basic + DA + retaining allowance). */
export const WAGE_CATEGORIES: readonly ComponentCategory[] = ["basic", "da", "retaining_allowance"];

/**
 * What a component is, for the statutory modules (Phase 2). The statutory
 * amounts are computed automatically in the payroll run (payroll-statutory.ts)
 * and carry one of these kinds; user-made salary components stay null.
 * `pf_employer` is the employer's EPF share (the part of the employer's 12%
 * that is not EPS); `vpf` is the employee's voluntary PF.
 */
export const STATUTORY_KINDS = [
  "pf_employee", "vpf", "pf_employer", "eps_employer", "esi_employee", "esi_employer", "professional_tax", "income_tax_tds", "gratuity", "lwf_employee", "lwf_employer",
] as const;
export type StatutoryKind = (typeof STATUTORY_KINDS)[number];

export const STATUTORY_KIND_LABELS: Record<StatutoryKind, string> = {
  pf_employee: "Provident fund (employee)",
  vpf: "Voluntary provident fund",
  pf_employer: "Provident fund (employer EPF share)",
  eps_employer: "Employees' pension scheme (employer EPS)",
  esi_employee: "ESI (employee)",
  esi_employer: "ESI (employer)",
  professional_tax: "Professional tax",
  income_tax_tds: "Income tax (TDS on salary)",
  gratuity: "Gratuity",
  lwf_employee: "Labour welfare fund (employee)",
  lwf_employer: "Labour welfare fund (employer)",
};

/** The liability a statutory amount is booked to until it is paid to the authority. */
export const STATUTORY_PAYABLE_GROUPS = ["pf", "esi", "pt", "lwf", "tds"] as const;
export type StatutoryPayableGroup = (typeof STATUTORY_PAYABLE_GROUPS)[number];

export const STATUTORY_PAYABLE_LABELS: Record<StatutoryPayableGroup, string> = {
  pf: "Provident fund (PF and EPS)",
  esi: "ESI",
  pt: "Professional tax",
  lwf: "Labour welfare fund",
  tds: "TDS on salary",
};

export function statutoryPayableGroup(kind: string | null | undefined): StatutoryPayableGroup | null {
  switch (kind) {
    case "pf_employee":
    case "vpf":
    case "pf_employer":
    case "eps_employer":
      return "pf";
    case "esi_employee":
    case "esi_employer":
      return "esi";
    case "professional_tax":
      return "pt";
    case "lwf_employee":
    case "lwf_employer":
      return "lwf";
    case "income_tax_tds":
      return "tds";
    default:
      return null;
  }
}

/** How a template line gets its monthly amount. */
export const CALC_TYPES = ["fixed", "percent_of_basic", "percent_of_ctc", "balance"] as const;
export type CalcType = (typeof CALC_TYPES)[number];

export const CALC_TYPE_LABELS: Record<CalcType, string> = {
  fixed: "Fixed monthly amount",
  percent_of_basic: "% of Basic",
  percent_of_ctc: "% of monthly CTC",
  balance: "Balance of CTC",
};

export class PayrollRuleError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "PayrollRuleError";
  }
}

// ── Paise helpers ────────────────────────────────────────────────────────────

/** "1234.5" (rupees) -> 123450. Rounds half up; throws on anything that is not a number. */
export function rupeesToPaise(value: string | number): number {
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(n)) throw new PayrollRuleError(`Not an amount: ${value}`, "bad_amount");
  const sign = n < 0 ? -1 : 1;
  return sign * Math.floor(Math.abs(n) * 100 + 0.5 + 1e-9);
}

/** 123450 -> "1234.50". */
export function paiseToRupees(paise: number): string {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(Math.round(paise));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * n / d rounded half up to an integer, for non-negative n and positive d. Uses
 * BigInt so a large salary times a large factor never loses a paisa.
 */
export function roundDiv(n: number, d: number): number {
  if (d <= 0) throw new PayrollRuleError("Division by zero", "bad_division");
  if (n <= 0) return -roundDivPositive(-n, d) || 0;
  return roundDivPositive(n, d);
}

function roundDivPositive(n: number, d: number): number {
  const bn = BigInt(Math.round(n));
  const bd = BigInt(Math.round(d));
  return Number((2n * bn + bd) / (2n * bd));
}

/** A percentage with up to 2 decimals as basis points (12.5 -> 1250). */
function percentToBp(percent: number): number {
  return Math.round(percent * 100);
}

/** `percent` % of `paise`, rounded half up. */
export function percentOf(paise: number, percent: number): number {
  return roundDiv(paise * percentToBp(percent), 10_000);
}

// ── Salary structure: annual CTC -> monthly amounts ──────────────────────────

export interface SalaryLineDef {
  componentId?: string;
  code: string;
  name: string;
  type: ComponentType;
  category: ComponentCategory;
  /** Counts toward "wages" (Basic + DA + retaining allowance). */
  isWage: boolean;
  /** Pay in proportion to paid days (otherwise paid in full whenever there is at least one paid day). */
  prorate: boolean;
  statutoryKind?: StatutoryKind | null;
  calcType: CalcType;
  /** Rupees for "fixed"; a percentage for the two percent types; ignored for "balance". */
  value: number;
}

export interface SalaryBreakdownLine extends Omit<SalaryLineDef, "calcType" | "value"> {
  calcType: CalcType;
  value: number;
  /** The monthly amount, paise. */
  monthlyPaise: number;
}

export interface SalaryBreakdown {
  annualCtcPaise: number;
  monthlyCtcPaise: number;
  lines: SalaryBreakdownLine[];
  /** Total monthly earnings (before loss of pay). */
  grossPaise: number;
  /** Total monthly employer contributions (part of CTC, not paid to the employee). */
  employerPaise: number;
  /** Total monthly deductions the structure itself carries. */
  deductionsPaise: number;
  /** gross - deductions. */
  takeHomePaise: number;
  /** monthly CTC - gross - employer contributions: the part of CTC no component takes. */
  unallocatedPaise: number;
  /** Basic + DA + retaining allowance, monthly. */
  wagesPaise: number;
  /** wages / (gross + employer contributions), as a percentage with 2 decimals; null when there is no remuneration. */
  wagePercent: number | null;
  warnings: PayrollWarning[];
}

export interface PayrollWarning {
  code:
    | "wages_below_50_percent" | "ctc_mismatch" | "negative_net" | "no_salary_structure" | "no_attendance" | "unmarked_days"
    // Statutory (Phase 2)
    | "pt_slabs_missing" | "pt_state_missing" | "pt_gender_missing" | "lwf_not_configured" | "tax_slabs_missing" | "tds_pan_missing"
    | "tds_history_gap" | "tds_capped" | "tds_surcharge" | "tds_senior_citizen" | "pf_uan_missing" | "esi_number_missing"
    | "double_deduction" | "pf_excluded_review" | "statutory_rates_default";
  message: string;
}

/** The Labour Codes' 50% wage rule: wages (Basic + DA + retaining) of at least half the total remuneration. */
export function checkWageRule(wagesPaise: number, totalRemunerationPaise: number): { ok: boolean; percent: number | null } {
  if (totalRemunerationPaise <= 0) return { ok: true, percent: null };
  const percent = roundDiv(wagesPaise * 10_000, totalRemunerationPaise) / 100;
  return { ok: wagesPaise * 2 >= totalRemunerationPaise, percent };
}

export const WAGE_RULE_WARNING =
  "Wages (Basic + DA + retaining allowance) are below 50% of the total remuneration. Under the Labour Codes wages should be at least 50%; check the structure with your CA.";

/**
 * Turn an annual CTC and a list of template lines into monthly amounts.
 *
 * Order of resolution: fixed amounts and % of CTC first, then % of Basic (so
 * Basic must be one of the first kind), then the single "balance" earning,
 * which takes whatever monthly CTC is left after every other earning and every
 * employer contribution. Deductions are never part of CTC.
 */
export function computeSalaryBreakdown(input: { annualCtcPaise: number; lines: readonly SalaryLineDef[] }): SalaryBreakdown {
  const { annualCtcPaise } = input;
  if (!Number.isInteger(annualCtcPaise) || annualCtcPaise < 0) throw new PayrollRuleError("Annual CTC must be zero or more.", "bad_ctc");
  const monthlyCtcPaise = roundDiv(annualCtcPaise, 12);

  const balanceLines = input.lines.filter((l) => l.calcType === "balance");
  if (balanceLines.length > 1) throw new PayrollRuleError("Only one component can take the balance of CTC.", "multiple_balance");
  if (balanceLines[0] && balanceLines[0].type !== "earning") throw new PayrollRuleError("Only an earning can take the balance of CTC.", "balance_not_earning");

  const amounts = new Map<number, number>();
  const idx = input.lines.map((_, i) => i);

  for (const i of idx) {
    const l = input.lines[i]!;
    if (l.calcType === "fixed") {
      if (l.value < 0) throw new PayrollRuleError(`${l.name}: amount cannot be negative.`, "negative_amount");
      amounts.set(i, rupeesToPaise(l.value));
    } else if (l.calcType === "percent_of_ctc") {
      assertPercent(l);
      amounts.set(i, percentOf(monthlyCtcPaise, l.value));
    }
  }

  const pendingBasic = idx.some((i) => input.lines[i]!.calcType === "percent_of_basic");
  if (pendingBasic) {
    const basicIdx = idx.filter((i) => input.lines[i]!.category === "basic" && input.lines[i]!.type === "earning");
    if (basicIdx.length === 0) throw new PayrollRuleError("Add a Basic component before using a percentage of Basic.", "no_basic");
    if (basicIdx.some((i) => !amounts.has(i))) throw new PayrollRuleError("Basic must be a fixed amount or a % of CTC when other lines are a % of Basic.", "basic_not_resolved");
    const basic = basicIdx.reduce((s, i) => s + amounts.get(i)!, 0);
    for (const i of idx) {
      const l = input.lines[i]!;
      if (l.calcType !== "percent_of_basic") continue;
      assertPercent(l);
      amounts.set(i, percentOf(basic, l.value));
    }
  }

  const balanceIdx = idx.find((i) => input.lines[i]!.calcType === "balance");
  if (balanceIdx !== undefined) {
    let used = 0;
    for (const i of idx) {
      if (i === balanceIdx) continue;
      const l = input.lines[i]!;
      if (l.type === "earning" || l.type === "employer_contribution") used += amounts.get(i) ?? 0;
    }
    const rest = monthlyCtcPaise - used;
    if (rest < 0) {
      throw new PayrollRuleError(
        `The other components add up to ${paiseToRupees(used)} a month, more than the monthly CTC of ${paiseToRupees(monthlyCtcPaise)}.`,
        "ctc_too_low",
      );
    }
    amounts.set(balanceIdx, rest);
  }

  const lines: SalaryBreakdownLine[] = idx.map((i) => ({ ...input.lines[i]!, monthlyPaise: amounts.get(i) ?? 0 }));
  const sum = (type: ComponentType) => lines.filter((l) => l.type === type).reduce((s, l) => s + l.monthlyPaise, 0);
  const grossPaise = sum("earning");
  const employerPaise = sum("employer_contribution");
  const deductionsPaise = sum("deduction");
  const wagesPaise = lines.filter((l) => l.type === "earning" && (l.isWage || WAGE_CATEGORIES.includes(l.category))).reduce((s, l) => s + l.monthlyPaise, 0);
  const total = grossPaise + employerPaise;
  const rule = checkWageRule(wagesPaise, total);
  const unallocatedPaise = monthlyCtcPaise - total;

  const warnings: PayrollWarning[] = [];
  if (!rule.ok) warnings.push({ code: "wages_below_50_percent", message: WAGE_RULE_WARNING });
  if (unallocatedPaise !== 0) {
    warnings.push({
      code: "ctc_mismatch",
      message:
        unallocatedPaise > 0
          ? `${paiseToRupees(unallocatedPaise)} a month of the CTC is not given to any component. Add a balance component (for example Special allowance) to use all of it.`
          : `The components add up to ${paiseToRupees(-unallocatedPaise)} a month more than the monthly CTC.`,
    });
  }

  return {
    annualCtcPaise,
    monthlyCtcPaise,
    lines,
    grossPaise,
    employerPaise,
    deductionsPaise,
    takeHomePaise: grossPaise - deductionsPaise,
    unallocatedPaise,
    wagesPaise,
    wagePercent: rule.percent,
    warnings,
  };
}

function assertPercent(l: SalaryLineDef) {
  if (!(l.value >= 0 && l.value <= 100)) throw new PayrollRuleError(`${l.name}: a percentage must be between 0 and 100.`, "bad_percent");
}

// ── Payroll line: monthly amounts + attendance -> pay ────────────────────────

/** One monthly amount of the employee's salary assignment (the snapshot a payroll run starts from). */
export interface AssignedComponent {
  componentId?: string;
  code: string;
  name: string;
  type: ComponentType;
  category: ComponentCategory;
  isWage: boolean;
  prorate: boolean;
  statutoryKind?: StatutoryKind | null;
  /** Full-month amount, paise. */
  monthlyPaise: number;
}

/** A one-off amount added to one employee's run (a manual deduction, an advance recovery, an incentive). */
export interface RunAdjustment {
  id?: string;
  name: string;
  type: "earning" | "deduction";
  category?: ComponentCategory;
  amountPaise: number;
}

export interface PayrollLineInput {
  components: readonly AssignedComponent[];
  daysInMonth: number;
  /** Days of the month inside the employment. */
  employedDays: number;
  /** Paid days, in 0.5 steps. */
  paidDays: number;
  lopDays: number;
  overtimeHours?: number;
  /** Overtime multiplier of the ordinary hourly wage; 2 by default. */
  overtimeMultiplier?: number;
  /** Working hours in a standard day; 8 by default. */
  standardHoursPerDay?: number;
  adjustments?: readonly RunAdjustment[];
}

export interface PayrollLineComponent {
  componentId?: string;
  code: string;
  name: string;
  type: ComponentType;
  category: ComponentCategory;
  isWage: boolean;
  statutoryKind?: StatutoryKind | null;
  /** The full-month amount; 0 for an adjustment or overtime. */
  fullPaise: number;
  /** What is paid / deducted / contributed this month, paise. */
  amountPaise: number;
  source: "structure" | "overtime" | "adjustment" | "statutory" | "loan";
  /** Phase 4: a loan or advance instalment recovered through the run (source "loan"). */
  loanId?: string;
  loanPart?: "principal" | "interest";
}

export interface PayrollLineResult {
  daysInMonth: number;
  employedDays: number;
  paidDays: number;
  lopDays: number;
  overtimeHours: number;
  components: PayrollLineComponent[];
  grossPaise: number;
  deductionsPaise: number;
  employerPaise: number;
  netPaise: number;
  overtimePaise: number;
  warnings: PayrollWarning[];
}

export const DEFAULT_OVERTIME_MULTIPLIER = 2;
export const DEFAULT_STANDARD_HOURS = 8;

/**
 * The pay for one employee for one month.
 *
 * - A proration component pays `full x paid days / days in month`, rounded
 *   half up to the paisa. Paid days are in 0.5 steps, so the calculation is
 *   `full x (paid days x 2) / (days in month x 2)`.
 * - A component that is not prorated pays in full when there is at least one
 *   paid day, otherwise nothing.
 * - Overtime = hours x ordinary hourly wage x multiplier, where the ordinary
 *   hourly wage is the FULL-month wages (Basic + DA + retaining) / days in
 *   month / standard hours a day. Not reduced by loss of pay. Verify the
 *   multiplier with your CA each year.
 * - Adjustments add to earnings or deductions as entered.
 * - net = gross earnings - deductions; employer contributions are not in it.
 */
export function computePayrollLine(input: PayrollLineInput): PayrollLineResult {
  const dim = input.daysInMonth;
  if (!(dim >= 28 && dim <= 31)) throw new PayrollRuleError("A month has 28 to 31 days.", "bad_month");
  if (input.paidDays < 0 || input.paidDays > dim) throw new PayrollRuleError("Paid days must be between 0 and the days in the month.", "bad_paid_days");
  const paidHalves = Math.round(input.paidDays * 2);
  if (paidHalves !== input.paidDays * 2) throw new PayrollRuleError("Paid days must be a whole or half day.", "bad_paid_days");

  const components: PayrollLineComponent[] = [];
  for (const c of input.components) {
    let amountPaise: number;
    if (paidHalves === 0) amountPaise = 0;
    else if (c.prorate) amountPaise = roundDiv(c.monthlyPaise * paidHalves, dim * 2);
    else amountPaise = c.monthlyPaise;
    components.push({
      componentId: c.componentId,
      code: c.code,
      name: c.name,
      type: c.type,
      category: c.category,
      isWage: c.isWage,
      statutoryKind: c.statutoryKind ?? null,
      fullPaise: c.monthlyPaise,
      amountPaise,
      source: "structure",
    });
  }

  const overtimeHours = input.overtimeHours ?? 0;
  let overtimePaise = 0;
  if (overtimeHours > 0) {
    const wagesFull = input.components
      .filter((c) => c.type === "earning" && (c.isWage || WAGE_CATEGORIES.includes(c.category)))
      .reduce((s, c) => s + c.monthlyPaise, 0);
    const multBp = Math.round((input.overtimeMultiplier ?? DEFAULT_OVERTIME_MULTIPLIER) * 100);
    const hoursTimes100 = Math.round(overtimeHours * 100);
    const stdHours = input.standardHoursPerDay ?? DEFAULT_STANDARD_HOURS;
    // wages / (days x std hours) x hours x multiplier, as one division.
    overtimePaise = roundDiv(wagesFull * hoursTimes100 * multBp, dim * stdHours * 100 * 100);
    if (overtimePaise > 0) {
      components.push({
        code: "OT",
        name: "Overtime",
        type: "earning",
        category: "overtime",
        isWage: false,
        statutoryKind: null,
        fullPaise: 0,
        amountPaise: overtimePaise,
        source: "overtime",
      });
    }
  }

  for (const a of input.adjustments ?? []) {
    if (a.amountPaise <= 0) continue;
    components.push({
      code: "ADJ",
      name: a.name,
      type: a.type,
      category: a.category ?? (a.type === "earning" ? "other_earning" : "manual_deduction"),
      isWage: false,
      statutoryKind: null,
      fullPaise: 0,
      amountPaise: a.amountPaise,
      source: "adjustment",
    });
  }

  const sum = (type: ComponentType) => components.filter((c) => c.type === type).reduce((s, c) => s + c.amountPaise, 0);
  const grossPaise = sum("earning");
  const deductionsPaise = sum("deduction");
  const employerPaise = sum("employer_contribution");
  const netPaise = grossPaise - deductionsPaise;

  const warnings: PayrollWarning[] = [];
  if (netPaise < 0) {
    warnings.push({
      code: "negative_net",
      message: `Deductions (${paiseToRupees(deductionsPaise)}) are more than the earnings (${paiseToRupees(grossPaise)}). Reduce a deduction before approving.`,
    });
  }
  const wages = components.filter((c) => c.type === "earning" && (c.isWage || WAGE_CATEGORIES.includes(c.category))).reduce((s, c) => s + c.fullPaise, 0);
  const fullGross = input.components.filter((c) => c.type === "earning").reduce((s, c) => s + c.monthlyPaise, 0);
  const fullEmployer = input.components.filter((c) => c.type === "employer_contribution").reduce((s, c) => s + c.monthlyPaise, 0);
  if (!checkWageRule(wages, fullGross + fullEmployer).ok) warnings.push({ code: "wages_below_50_percent", message: WAGE_RULE_WARNING });

  return {
    daysInMonth: dim,
    employedDays: input.employedDays,
    paidDays: input.paidDays,
    lopDays: input.lopDays,
    overtimeHours,
    components,
    grossPaise,
    deductionsPaise,
    employerPaise,
    netPaise,
    overtimePaise,
    warnings,
  };
}

// ── Run totals ───────────────────────────────────────────────────────────────

export interface RunTotals {
  employees: number;
  grossPaise: number;
  deductionsPaise: number;
  employerPaise: number;
  netPaise: number;
}

/** Totals of a run: the plain sums of its lines. */
export function sumRunTotals(lines: ReadonlyArray<{ grossPaise: number; deductionsPaise: number; employerPaise: number; netPaise: number }>): RunTotals {
  return lines.reduce<RunTotals>(
    (t, l) => ({
      employees: t.employees + 1,
      grossPaise: t.grossPaise + l.grossPaise,
      deductionsPaise: t.deductionsPaise + l.deductionsPaise,
      employerPaise: t.employerPaise + l.employerPaise,
      netPaise: t.netPaise + l.netPaise,
    }),
    { employees: 0, grossPaise: 0, deductionsPaise: 0, employerPaise: 0, netPaise: 0 },
  );
}

// ── Posting to the books ─────────────────────────────────────────────────────

/** The expense group a component is booked under. */
export type ExpenseGroup = "wages" | "allowances" | "bonus_incentives" | "overtime" | "employer_contributions";

export function expenseGroupOf(c: { type: ComponentType; category: ComponentCategory }): ExpenseGroup | null {
  if (c.type === "employer_contribution") return "employer_contributions";
  if (c.type !== "earning") return null;
  switch (c.category) {
    case "basic":
    case "da":
    case "retaining_allowance":
      return "wages";
    case "bonus":
    case "incentive":
      return "bonus_incentives";
    case "overtime":
      return "overtime";
    default:
      return "allowances";
  }
}

export interface PostingTotals {
  /** Debit side: salary expense by group (paise). */
  expense: Record<ExpenseGroup, number>;
  /** Credit: salaries payable (net pay). */
  netPayablePaise: number;
  /** Credit: deductions payable (what was held back from employees). */
  deductionsPayablePaise: number;
  /** Credit: employer contributions payable. */
  employerPayablePaise: number;
  /** Phase 4: credit loans receivable from employees (principal recovered from pay). Not in the deductions total above. */
  loanPrincipalPaise: number;
  /** Phase 4: credit interest income on staff loans (interest recovered from pay). Not in the deductions total above. */
  loanInterestPaise: number;
  /**
   * Credit: statutory amounts (employee and employer shares) by the authority
   * they are paid to. They are NOT in the two totals above, so every credit is
   * counted once.
   */
  statutoryPayable: Record<StatutoryPayableGroup, number>;
}

/**
 * Totals the payroll journal posts, from the lines' components. The entry
 * balances by construction: expense (gross + employer) = net + deductions +
 * employer contributions, because net = gross - deductions per line.
 */
export function buildPostingTotals(
  lines: ReadonlyArray<{
    components: ReadonlyArray<{ type: ComponentType; category: ComponentCategory; amountPaise: number; statutoryKind?: string | null; source?: string; loanPart?: string | null }>;
    netPaise: number;
  }>,
): PostingTotals {
  const expense: Record<ExpenseGroup, number> = { wages: 0, allowances: 0, bonus_incentives: 0, overtime: 0, employer_contributions: 0 };
  const statutoryPayable: Record<StatutoryPayableGroup, number> = { pf: 0, esi: 0, pt: 0, lwf: 0, tds: 0 };
  let netPayablePaise = 0;
  let deductionsPayablePaise = 0;
  let employerPayablePaise = 0;
  let loanPrincipalPaise = 0;
  let loanInterestPaise = 0;
  for (const l of lines) {
    netPayablePaise += l.netPaise;
    for (const c of l.components) {
      const g = expenseGroupOf(c);
      if (g) expense[g] += c.amountPaise;
      const payableGroup = c.type === "earning" ? null : statutoryPayableGroup(c.statutoryKind);
      if (payableGroup) statutoryPayable[payableGroup] += c.amountPaise;
      else if (c.type === "deduction" && c.source === "loan") {
        if (c.loanPart === "interest") loanInterestPaise += c.amountPaise;
        else loanPrincipalPaise += c.amountPaise;
      } else if (c.type === "deduction") deductionsPayablePaise += c.amountPaise;
      else if (c.type === "employer_contribution") employerPayablePaise += c.amountPaise;
    }
  }
  return { expense, netPayablePaise, deductionsPayablePaise, employerPayablePaise, loanPrincipalPaise, loanInterestPaise, statutoryPayable };
}

// ── Status machine and maker-checker ─────────────────────────────────────────

export const PAYROLL_RUN_STATUSES = ["draft", "attendance_locked", "calculated", "pending_approval", "approved", "posted", "paid"] as const;
export type PayrollRunStatus = (typeof PAYROLL_RUN_STATUSES)[number];

export const PAYROLL_RUN_STATUS_LABELS: Record<PayrollRunStatus, string> = {
  draft: "Draft",
  attendance_locked: "Attendance locked",
  calculated: "Calculated",
  pending_approval: "Pending approval",
  approved: "Approved",
  posted: "Posted to books",
  paid: "Paid",
};

/** Forward steps. A run before approval can also be reopened to "draft". */
export const PAYROLL_RUN_NEXT: Record<PayrollRunStatus, readonly PayrollRunStatus[]> = {
  draft: ["attendance_locked"],
  attendance_locked: ["calculated", "draft"],
  calculated: ["calculated", "pending_approval", "draft"],
  pending_approval: ["approved", "calculated", "draft"],
  approved: ["posted"],
  posted: ["paid"],
  paid: [],
};

export function canTransitionRun(from: PayrollRunStatus, to: PayrollRunStatus): boolean {
  return PAYROLL_RUN_NEXT[from].includes(to);
}

/** A run whose figures can still change (before approval). */
export function isRunEditable(status: PayrollRunStatus): boolean {
  return status === "draft" || status === "attendance_locked" || status === "calculated" || status === "pending_approval";
}

/**
 * Maker-checker: the person who calculated the run may not approve it, unless
 * the business has a single user (then there is nobody else to check).
 */
export function approverAllowed(input: { approverUserId: string; calculatedByUserId: string | null; businessMemberCount: number }): boolean {
  if (input.businessMemberCount <= 1) return true;
  return !input.calculatedByUserId || input.calculatedByUserId !== input.approverUserId;
}

export const MAKER_CHECKER_MESSAGE =
  "The person who calculated this payroll cannot approve it. Ask another owner or admin to approve it (a business with a single user can approve its own payroll).";
