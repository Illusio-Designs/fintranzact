/**
 * Payroll Phase 4 (year-end and exit): bonus, gratuity, full and final
 * settlement, loans and advances, relieving letters and the extra registers.
 *
 * Pure: no database, no clock. All money is integer PAISE. Every statutory
 * figure is DATA (the `bonus` and `gratuity` parts of StatutoryRates, edited
 * per financial year by an owner or admin); nothing here guesses a legal
 * number. The bonus ceilings ship EMPTY and a bonus run refuses to calculate
 * until they are set. Every rule and rounding below is listed in
 * docs/PAYROLL-CA-VERIFICATION.md (Phase 4) for the CA to confirm.
 *
 * NOT built, on purpose: set-on / set-off of allocable surplus (sections 15 and
 * 16 of the Payment of Bonus Act), tax on gratuity, and tax (TDS) on a full and
 * final settlement beyond a manual amount.
 */

import { z } from "zod";
import { csvCell, isoDateSchema, payrollMonthSchema } from "./payroll.js";
import { PayrollRuleError, paiseToRupees, roundDiv, rupeesToPaise, type PayrollLineComponent, type PayrollLineResult } from "./payroll-calc.js";
import { serviceBetween } from "./payroll-filings.js";
import type { StatutoryRates } from "./payroll-statutory.js";
import { formatPayrollMonth } from "./payroll-calendar.js";

const uuid = z.string().uuid();
const text = (max: number) => z.string().trim().max(max);
const maybe = <T extends z.ZodTypeAny>(schema: T) => z.union([z.literal(""), schema]).optional();

export const PHASE4_LABEL = "Working copy for CA / legal review. Not a statutory form.";

/** Month arithmetic on "YYYY-MM". */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

function csvTable(header: readonly string[], rows: ReadonlyArray<ReadonlyArray<string | number>>): string {
  return `${[header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

const ddmmyyyy = (iso: string | null | undefined) => (iso ? iso.split("-").reverse().join("/") : "");

// ═══════════════════════════════════════════════════════════════════════════
// 1. Bonus (Payment of Bonus Act)
// ═══════════════════════════════════════════════════════════════════════════

export type BonusRules = StatutoryRates["bonus"];

export const BONUS_RUN_STATUSES = ["draft", "calculated", "pending_approval", "approved", "posted", "paid"] as const;
export type BonusRunStatus = (typeof BONUS_RUN_STATUSES)[number];
export const BONUS_RUN_STATUS_LABELS: Record<BonusRunStatus, string> = {
  draft: "Draft",
  calculated: "Calculated",
  pending_approval: "Pending approval",
  approved: "Approved",
  posted: "Posted to books",
  paid: "Paid",
};
export const BONUS_RUN_NEXT: Record<BonusRunStatus, readonly BonusRunStatus[]> = {
  draft: ["calculated"],
  calculated: ["calculated", "pending_approval", "draft"],
  pending_approval: ["calculated", "approved", "draft"],
  approved: ["posted"],
  posted: ["paid"],
  paid: [],
};
export function canTransitionBonusRun(from: BonusRunStatus, to: BonusRunStatus): boolean {
  return BONUS_RUN_NEXT[from].includes(to);
}
/** A bonus run can still be changed (not yet approved). */
export function isBonusRunEditable(status: BonusRunStatus): boolean {
  return status === "draft" || status === "calculated" || status === "pending_approval";
}

/** Messages for the bonus figures that ship empty on purpose (a bonus run cannot be calculated until they are set). */
export function bonusRulesGaps(rules: BonusRules): string[] {
  const out: string[] = [];
  if (!(rules.eligibilityCeilingRupees > 0)) out.push("The bonus eligibility wage ceiling is not configured. Set it in Statutory settings (Bonus) and verify it with your CA.");
  if (!(rules.wageCeilingRupees > 0) && !(rules.minimumWageRupees > 0)) {
    out.push("The bonus calculation ceiling and the minimum wage are both not configured. Set at least one in Statutory settings (Bonus) and verify with your CA.");
  }
  return out;
}

/**
 * The wage a month's bonus is capped at: the HIGHER of the calculation ceiling and the minimum wage (our reading of
 * the Act; the CA confirms). Paise; 0 when neither is configured.
 */
export function bonusCalculationCapPaise(rules: BonusRules): number {
  return Math.max(rupeesToPaise(rules.wageCeilingRupees), rupeesToPaise(rules.minimumWageRupees));
}

export interface BonusMonthInput {
  month: string;
  daysInMonth: number;
  /** Paid days of the month, in half days. */
  paidDays: number;
  /** Basic + DA earned that month (after loss of pay), paise. */
  earnedWagePaise: number;
  /** Basic + DA of the full month (the structure), paise: tests the eligibility ceiling. */
  fullWagePaise: number;
}

export const BONUS_REASONS = ["ok", "manual", "no_pay", "wage_above_ceiling", "too_few_days"] as const;
export type BonusReason = (typeof BONUS_REASONS)[number];

export interface BonusLineResult {
  eligible: boolean;
  reason: BonusReason;
  reasonText: string;
  /** Full-month Basic + DA of the last paid month: what the eligibility ceiling is tested on. */
  eligibilityWagePaise: number;
  daysPaid: number;
  monthsPaid: number;
  /** Sum of Basic + DA earned in the year. */
  wagesPaise: number;
  /** Sum of each month's wage after the (prorated) ceiling: the bonus basis. */
  calculationWagesPaise: number;
  percent: number;
  bonusPaise: number;
}

export function validateBonusPercent(percent: number, rules: BonusRules): string | null {
  if (!(percent > 0)) return "Enter the bonus percentage.";
  if (percent < rules.minPercent) return `The bonus percentage cannot be below ${rules.minPercent}%.`;
  if (percent > rules.maxPercent) return `The bonus percentage cannot be above ${rules.maxPercent}%.`;
  return null;
}

/**
 * One employee's bonus for a financial year.
 *
 * - Eligible when the full-month Basic + DA in the LAST paid month of the year is up to the eligibility ceiling (assumption: the
 *   Act tests "salary or wage" per month; we test the last paid month), the employee was paid for at least `minWorkingDays`
 *   days in the year (paid days stand in for days worked) and is not marked not eligible by hand.
 * - Each month's bonus wage = the lower of the Basic + DA earned and the calculation cap prorated by paid days
 *   (cap x paid days / days in month, rounded half up), where the cap is the higher of the calculation ceiling and the
 *   minimum wage. Because earned wages are already reduced by loss of pay, a part-year or part-month worker is prorated by
 *   days worked.
 * - Bonus = the sum of those wages x the chosen percentage, rounded half up to the paisa ONCE per employee.
 */
export function computeEmployeeBonus(
  input: { months: readonly BonusMonthInput[]; manualReason?: string | null },
  rules: BonusRules,
  percent: number,
): BonusLineResult {
  const gaps = bonusRulesGaps(rules);
  if (gaps.length) throw new PayrollRuleError(gaps[0]!, "bonus_not_configured");
  const pctError = validateBonusPercent(percent, rules);
  if (pctError) throw new PayrollRuleError(pctError, "bad_bonus_percent");

  const months = [...input.months].sort((a, b) => a.month.localeCompare(b.month));
  const paid = months.filter((m) => m.paidDays > 0);
  const daysPaid = paid.reduce((s, m) => s + m.paidDays, 0);
  const wagesPaise = months.reduce((s, m) => s + m.earnedWagePaise, 0);
  const lastPaid = paid[paid.length - 1];
  const eligibilityWagePaise = lastPaid?.fullWagePaise ?? 0;
  const cap = bonusCalculationCapPaise(rules);
  const calculationWagesPaise = months.reduce((s, m) => {
    if (m.paidDays <= 0) return s;
    const proratedCap = roundDiv(cap * Math.round(m.paidDays * 2), m.daysInMonth * 2);
    return s + Math.min(m.earnedWagePaise, proratedCap);
  }, 0);

  const base = { eligibilityWagePaise, daysPaid, monthsPaid: paid.length, wagesPaise, calculationWagesPaise, percent };
  const no = (reason: BonusReason, reasonText: string): BonusLineResult => ({ ...base, eligible: false, reason, reasonText, bonusPaise: 0 });
  if (input.manualReason) return no("manual", `Marked not eligible: ${input.manualReason}`);
  if (paid.length === 0) return no("no_pay", "No pay in the year.");
  if (eligibilityWagePaise > rupeesToPaise(rules.eligibilityCeilingRupees)) return no("wage_above_ceiling", `Wage above the eligibility ceiling (₹${rules.eligibilityCeilingRupees}).`);
  if (daysPaid < rules.minWorkingDays) return no("too_few_days", `Worked ${daysPaid} day(s); the minimum is ${rules.minWorkingDays}.`);
  const bonusPaise = roundDiv(calculationWagesPaise * Math.round(percent * 100), 10_000);
  return { ...base, eligible: true, reason: "ok", reasonText: "Eligible", bonusPaise };
}

export const bonusRunCreateSchema = z.object({
  financialYear: z.number().int().min(2020).max(2100),
  /** The bonus percentage for this run (between the minimum and maximum in the bonus settings). */
  percent: z.number().min(0.01).max(100),
  note: maybe(text(300)),
});
export const bonusRunUpdateSchema = z.object({ id: uuid, percent: z.number().min(0.01).max(100).optional(), note: maybe(text(300)) });
export const bonusLineExcludeSchema = z.object({
  runId: uuid,
  employeeId: uuid,
  /** Empty = eligible again. */
  reason: text(200),
});
export const bonusMarkPaidSchema = z.object({ runId: uuid, bankAccountId: uuid, paidOn: isoDateSchema, reference: maybe(text(100)) });

export function buildBonusStatementCsv(
  fyLabelText: string,
  rows: ReadonlyArray<{ employeeCode: string; name: string; monthsPaid: number; daysPaid: number; wagesPaise: number; calculationWagesPaise: number; eligible: boolean; reasonText: string; percent: number; bonusPaise: number }>,
): string {
  return csvTable(
    ["Financial Year", "Employee Code", "Employee Name", "Months Paid", "Days Paid", "Basic + DA Earned", "Wages Used (after ceiling)", "Eligible", "Note", "Bonus %", "Bonus Amount"],
    rows.map((r) => [fyLabelText, r.employeeCode, r.name, r.monthsPaid, r.daysPaid, paiseToRupees(r.wagesPaise), paiseToRupees(r.calculationWagesPaise), r.eligible ? "Yes" : "No", r.reasonText, r.percent, paiseToRupees(r.bonusPaise)]),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. Gratuity
// ═══════════════════════════════════════════════════════════════════════════

export const GRATUITY_EXEMPT_REASONS = ["death", "disablement"] as const;

export interface GratuityDetail {
  completedYears: number;
  /** Years the formula uses: completed years, plus one when the rest is more than six months. */
  yearsForFormula: number;
  /** Completed years of service the rule requires (5 for ordinary staff, 1 for fixed-term), 0 when exempt. */
  minYearsRequired: number;
  rule: "standard" | "fixed_term" | "exempt";
  eligible: boolean;
  /** The formula amount before the limit, paise (0 when not eligible). */
  rawPaise: number;
  amountPaise: number;
  capped: boolean;
  /** What the formula would give if the minimum-service test were ignored (for the "if eligible" estimate). */
  ifEligiblePaise: number;
}

/**
 * Gratuity: last drawn (Basic + DA) x 15 / 26 x years, where a part year of more than six months counts as a full year,
 * capped at the configured limit.
 *
 * - Minimum service: `rules.minYears` (5) of COMPLETED years for ordinary staff; `rules.fixedTermMinYears` (1) for a
 *   fixed-term employee (assumption: the employment type "contract" is the fixed-term type); no minimum on death or
 *   disablement (exit reason "death" / "disablement").
 * - Completed years are measured from the joining date to the end date, counting the end date; the rounded-up figure is
 *   NOT what the minimum is tested on.
 * - Rounded half up to the paisa once. Tax on gratuity is NOT computed.
 */
export function computeGratuityFull(input: {
  joinedOn: string;
  endOn: string;
  lastDrawnWagesPaise: number;
  employmentType: string;
  exitReason?: string | null;
  rules: StatutoryRates["gratuity"];
}): GratuityDetail {
  const { months, days } = serviceBetween(input.joinedOn, input.endOn);
  const completedYears = Math.floor(months / 12);
  const rem = months % 12;
  const yearsForFormula = completedYears + (rem > 6 || (rem === 6 && days > 0) ? 1 : 0);
  const exempt = !!input.exitReason && (GRATUITY_EXEMPT_REASONS as readonly string[]).includes(input.exitReason);
  const fixedTerm = input.employmentType === "contract";
  const rule: GratuityDetail["rule"] = exempt ? "exempt" : fixedTerm ? "fixed_term" : "standard";
  const minYearsRequired = exempt ? 0 : fixedTerm ? input.rules.fixedTermMinYears : input.rules.minYears;
  const eligible = completedYears >= minYearsRequired;

  let rawAll = 0;
  if (input.lastDrawnWagesPaise > 0 && yearsForFormula > 0) {
    rawAll = roundDiv(input.lastDrawnWagesPaise * Math.round(input.rules.daysPerYear * 100) * yearsForFormula, Math.round(input.rules.workingDaysDivisor * 100));
  }
  const cap = rupeesToPaise(input.rules.capRupees);
  const limit = (n: number) => (cap > 0 && n > cap ? cap : n);
  const rawPaise = eligible ? rawAll : 0;
  return {
    completedYears,
    yearsForFormula,
    minYearsRequired,
    rule,
    eligible,
    rawPaise,
    amountPaise: limit(rawPaise),
    capped: cap > 0 && rawPaise > cap,
    ifEligiblePaise: limit(rawAll),
  };
}

export interface GratuityEstimateRow {
  employeeId: string;
  employeeCode: string;
  name: string;
  joinedOn: string;
  employmentType: string;
  lastDrawnWagesPaise: number;
  detail: GratuityDetail;
}

/** What the liability would be today: the sum of what is payable now to each employee (not-yet-eligible staff are 0 and shown separately). */
export function gratuityLiability(rows: readonly GratuityEstimateRow[]): { payableTodayPaise: number; ifEligiblePaise: number; eligibleCount: number } {
  return {
    payableTodayPaise: rows.reduce((s, r) => s + r.detail.amountPaise, 0),
    ifEligiblePaise: rows.reduce((s, r) => s + r.detail.ifEligiblePaise, 0),
    eligibleCount: rows.filter((r) => r.detail.eligible).length,
  };
}

export const gratuityProvisionSchema = z.object({ asOf: isoDateSchema, note: maybe(text(200)) });

// ═══════════════════════════════════════════════════════════════════════════
// 3. Loans and advances
// ═══════════════════════════════════════════════════════════════════════════

export const LOAN_KINDS = ["loan", "advance"] as const;
export type LoanKind = (typeof LOAN_KINDS)[number];
export const LOAN_STATUSES = ["pending_approval", "approved", "active", "closed", "rejected", "cancelled"] as const;
export type LoanStatus = (typeof LOAN_STATUSES)[number];
export const LOAN_STATUS_LABELS: Record<LoanStatus, string> = {
  pending_approval: "Pending approval",
  approved: "Approved, not disbursed",
  active: "Active",
  closed: "Closed",
  rejected: "Rejected",
  cancelled: "Cancelled",
};
export const LOAN_EVENT_KINDS = ["issued", "approved", "disbursed", "emi_recovered", "prepaid", "foreclosed", "fnf_recovered", "skipped", "rescheduled", "closed", "rejected", "cancelled"] as const;
export type LoanEventKind = (typeof LOAN_EVENT_KINDS)[number];

const MAX_SCHEDULE_MONTHS = 600;

export function interestForMonthPaise(openingPaise: number, annualRatePct: number): number {
  if (annualRatePct <= 0 || openingPaise <= 0) return 0;
  // opening x (rate / 12 / 100): the rate has at most two decimals, so work in basis points.
  return roundDiv(openingPaise * Math.round(annualRatePct * 100), 12 * 10_000);
}

/**
 * The EMI for a reducing-balance loan, rounded half up to the paisa: P r (1+r)^n / ((1+r)^n - 1) with r = rate / 12 / 100.
 * At 0% it is the principal divided by the count, rounded half up. Plain double-precision arithmetic (documented for the CA).
 * The LAST instalment is adjusted in the schedule so the balance ends at exactly zero.
 */
export function computeEmiPaise(principalPaise: number, annualRatePct: number, count: number): number {
  if (!(principalPaise > 0)) throw new PayrollRuleError("Enter an amount above zero.", "bad_loan");
  if (!Number.isInteger(count) || count < 1 || count > MAX_SCHEDULE_MONTHS) throw new PayrollRuleError(`The number of instalments must be between 1 and ${MAX_SCHEDULE_MONTHS}.`, "bad_loan");
  if (annualRatePct <= 0) return roundDiv(principalPaise, count);
  const r = annualRatePct / 1200;
  const f = Math.pow(1 + r, count);
  return Math.round((principalPaise * r * f) / (f - 1));
}

export interface ScheduleRow {
  seq: number;
  /** "YYYY-MM": the payroll month the instalment is recovered in. */
  month: string;
  openingPaise: number;
  principalPaise: number;
  interestPaise: number;
  emiPaise: number;
  closingPaise: number;
}

/**
 * The repayment schedule. Give either `count` (the EMI is computed) or `emiPaise` (the number of instalments follows).
 * Interest each month = opening balance x rate / 12 (rounded half up to the paisa); principal = EMI - interest; the last
 * instalment clears whatever balance is left (so it can differ from the others by a few paise).
 */
export function buildRepaymentSchedule(input: { principalPaise: number; annualRatePct: number; firstMonth: string; count?: number; emiPaise?: number; startSeq?: number }): ScheduleRow[] {
  const { principalPaise, annualRatePct } = input;
  if (!(principalPaise > 0)) return [];
  if (input.count == null && input.emiPaise == null) throw new PayrollRuleError("Give the number of instalments or the EMI.", "bad_loan");
  const emi = input.count != null ? computeEmiPaise(principalPaise, annualRatePct, input.count) : input.emiPaise!;
  if (!(emi > 0)) throw new PayrollRuleError("The EMI must be above zero.", "bad_loan");
  const rows: ScheduleRow[] = [];
  let opening = principalPaise;
  const seq0 = input.startSeq ?? 1;
  for (let i = 0; opening > 0; i++) {
    if (i >= MAX_SCHEDULE_MONTHS) throw new PayrollRuleError(`The loan would take more than ${MAX_SCHEDULE_MONTHS} instalments. Increase the EMI.`, "bad_loan");
    const interest = interestForMonthPaise(opening, annualRatePct);
    const last = (input.count != null && i + 1 === input.count) || emi - interest >= opening;
    let principal = last ? opening : emi - interest;
    if (principal <= 0) throw new PayrollRuleError("The EMI is too small to repay the loan (it does not cover the interest). Increase the EMI.", "bad_loan");
    if (principal > opening) principal = opening;
    rows.push({ seq: seq0 + i, month: addMonths(input.firstMonth, i), openingPaise: opening, principalPaise: principal, interestPaise: interest, emiPaise: principal + interest, closingPaise: opening - principal });
    opening -= principal;
  }
  return rows;
}

export interface LoanDueInstallment {
  installmentId: string;
  seq: number;
  dueMonth: string;
  /** What is still unpaid of this instalment. */
  principalDuePaise: number;
  interestDuePaise: number;
}
export interface LoanDue {
  loanId: string;
  loanNumber: string;
  installments: readonly LoanDueInstallment[];
}
export interface LoanRecoveryLine {
  loanId: string;
  loanNumber: string;
  principalPaise: number;
  interestPaise: number;
  totalPaise: number;
  allocations: Array<{ installmentId: string; seq: number; principalPaise: number; interestPaise: number }>;
  /** Due this run but not recovered (carried forward as arrears). */
  arrearsPaise: number;
}
export interface LoanRecoveryPlan {
  lines: LoanRecoveryLine[];
  allowedPaise: number;
  dueTotalPaise: number;
  recoveredPaise: number;
  shortfallPaise: number;
}

/**
 * How much of the loan instalments due in a run to recover from an employee's pay. The cap is a share of the net pay BEFORE
 * loan recovery (default 50%, configurable); instalments are taken oldest first, interest before principal; what is not
 * recovered stays due on its instalment (arrears) and is picked up by the next run.
 */
export function planLoanRecovery(input: { netPaise: number; maxSharePercent: number; loans: readonly LoanDue[] }): LoanRecoveryPlan {
  const share = Math.min(100, Math.max(0, input.maxSharePercent));
  const allowedPaise = input.netPaise > 0 ? Math.floor((input.netPaise * Math.round(share * 100)) / 10_000) : 0;
  let left = allowedPaise;
  let dueTotal = 0;
  let recovered = 0;
  const lines: LoanRecoveryLine[] = [];
  for (const loan of input.loans) {
    const allocations: LoanRecoveryLine["allocations"] = [];
    let principal = 0;
    let interest = 0;
    let due = 0;
    for (const inst of [...loan.installments].sort((a, b) => a.seq - b.seq)) {
      const instDue = inst.principalDuePaise + inst.interestDuePaise;
      if (instDue <= 0) continue;
      due += instDue;
      const takeInterest = Math.min(inst.interestDuePaise, left);
      left -= takeInterest;
      const takePrincipal = Math.min(inst.principalDuePaise, left);
      left -= takePrincipal;
      if (takeInterest + takePrincipal > 0) allocations.push({ installmentId: inst.installmentId, seq: inst.seq, principalPaise: takePrincipal, interestPaise: takeInterest });
      principal += takePrincipal;
      interest += takeInterest;
    }
    dueTotal += due;
    recovered += principal + interest;
    if (due > 0) lines.push({ loanId: loan.loanId, loanNumber: loan.loanNumber, principalPaise: principal, interestPaise: interest, totalPaise: principal + interest, allocations, arrearsPaise: due - principal - interest });
  }
  return { lines, allowedPaise, dueTotalPaise: dueTotal, recoveredPaise: recovered, shortfallPaise: dueTotal - recovered };
}

/**
 * Adds the planned loan recovery to a calculated line as deduction components (source "loan", one for the principal and one
 * for the interest of each loan, "advance recovery" category) and recalculates the totals. Run it AFTER the statutory
 * amounts, on the net pay they leave.
 */
export function applyLoanRecoveryToLine(line: PayrollLineResult, plan: LoanRecoveryPlan): PayrollLineResult {
  const extra: PayrollLineComponent[] = [];
  for (const l of plan.lines) {
    if (l.principalPaise > 0) {
      extra.push({ code: "LOAN", name: `Loan recovery ${l.loanNumber}`, type: "deduction", category: "advance_recovery", isWage: false, statutoryKind: null, fullPaise: 0, amountPaise: l.principalPaise, source: "loan", loanId: l.loanId, loanPart: "principal" });
    }
    if (l.interestPaise > 0) {
      extra.push({ code: "LOANINT", name: `Loan interest ${l.loanNumber}`, type: "deduction", category: "advance_recovery", isWage: false, statutoryKind: null, fullPaise: 0, amountPaise: l.interestPaise, source: "loan", loanId: l.loanId, loanPart: "interest" });
    }
  }
  if (extra.length === 0) return line;
  const components = [...line.components, ...extra];
  const deductionsPaise = line.deductionsPaise + extra.reduce((s, c) => s + c.amountPaise, 0);
  return { ...line, components, deductionsPaise, netPaise: line.grossPaise - deductionsPaise };
}

export const loanCreateSchema = z
  .object({
    employeeId: uuid,
    kind: z.enum(LOAN_KINDS).default("loan"),
    /** Rupees. */
    amount: z.number().positive("Enter an amount above zero.").max(100_000_000),
    /** Annual interest on the reducing balance, % (0 = interest free). */
    interestRate: z.number().min(0).max(60).default(0),
    /** Give the number of instalments or the EMI (rupees). */
    installments: z.number().int().min(1).max(MAX_SCHEDULE_MONTHS).optional(),
    emi: z.number().positive().max(100_000_000).optional(),
    /** The first payroll month an instalment is recovered in. */
    startMonth: payrollMonthSchema,
    issueDate: isoDateSchema,
    purpose: maybe(text(300)),
  })
  .refine((v) => (v.installments != null) !== (v.emi != null), { path: ["installments"], message: "Give either the number of instalments or the EMI amount." });
export type LoanCreateInput = z.infer<typeof loanCreateSchema>;
export const loanSchedulePreviewSchema = z
  .object({
    amount: z.number().positive().max(100_000_000),
    interestRate: z.number().min(0).max(60).default(0),
    installments: z.number().int().min(1).max(MAX_SCHEDULE_MONTHS).optional(),
    emi: z.number().positive().max(100_000_000).optional(),
    startMonth: payrollMonthSchema,
  })
  .refine((v) => (v.installments != null) !== (v.emi != null), { path: ["installments"], message: "Give either the number of instalments or the EMI amount." });
export const loanDisburseSchema = z.object({ id: uuid, bankAccountId: uuid, paidOn: isoDateSchema, reference: maybe(text(100)) });
export const loanReceiveSchema = z.object({
  id: uuid,
  bankAccountId: uuid,
  receivedOn: isoDateSchema,
  /** Rupees of principal repaid. Foreclosure takes the whole outstanding balance and ignores this. */
  amount: z.number().positive().max(100_000_000).optional(),
  /** Rupees of interest paid with it (optional). */
  interest: z.number().min(0).max(100_000_000).default(0),
  reference: maybe(text(100)),
});
export const loanSkipSchema = z.object({ id: uuid, reason: z.string().trim().min(3, "Say why the instalment is skipped.").max(200) });
export const loanRescheduleSchema = z
  .object({
    id: uuid,
    reason: z.string().trim().min(3, "Say why the loan is rescheduled.").max(200),
    /** New number of remaining instalments, or a new EMI (rupees). */
    installments: z.number().int().min(1).max(MAX_SCHEDULE_MONTHS).optional(),
    emi: z.number().positive().max(100_000_000).optional(),
    firstMonth: payrollMonthSchema,
  })
  .refine((v) => (v.installments != null) !== (v.emi != null), { path: ["installments"], message: "Give either the number of instalments or the EMI amount." });
export const loanSettingsSchema = z.object({ maxDeductionPercent: z.number().min(1).max(100) });

// ═══════════════════════════════════════════════════════════════════════════
// 4. Full and final settlement
// ═══════════════════════════════════════════════════════════════════════════

export const FNF_STATUSES = ["draft", "pending_approval", "approved", "posted", "paid"] as const;
export type FnfStatus = (typeof FNF_STATUSES)[number];
export const FNF_STATUS_LABELS: Record<FnfStatus, string> = {
  draft: "Draft",
  pending_approval: "Pending approval",
  approved: "Approved",
  posted: "Posted to books",
  paid: "Paid",
};
export const FNF_NEXT: Record<FnfStatus, readonly FnfStatus[]> = {
  draft: ["draft", "pending_approval"],
  pending_approval: ["draft", "approved"],
  approved: ["posted"],
  posted: ["paid"],
  paid: [],
};
export function canTransitionFnf(from: FnfStatus, to: FnfStatus): boolean {
  return FNF_NEXT[from].includes(to);
}
export function isFnfEditable(status: FnfStatus): boolean {
  return status === "draft" || status === "pending_approval";
}

export const LEAVE_ENCASHMENT_BASES = ["basic_da_26", "basic_da_30", "gross_30"] as const;
export type LeaveEncashmentBasis = (typeof LEAVE_ENCASHMENT_BASES)[number];
export const LEAVE_ENCASHMENT_BASIS_LABELS: Record<LeaveEncashmentBasis, string> = {
  basic_da_26: "Basic + DA / 26",
  basic_da_30: "Basic + DA / 30",
  gross_30: "Gross monthly salary / 30",
};

/** Per-day rate and amount of leave encashment: rate = monthly wage / divisor (26 or 30); amount = days x rate, rounded half up once. */
export function computeLeaveEncashment(input: { days: number; basicDaPaise: number; grossPaise: number; basis: LeaveEncashmentBasis }): { ratePerDayPaise: number; amountPaise: number } {
  const monthly = input.basis === "gross_30" ? input.grossPaise : input.basicDaPaise;
  const divisor = input.basis === "basic_da_26" ? 26 : 30;
  const hundredths = Math.round(input.days * 100);
  return { ratePerDayPaise: roundDiv(monthly, divisor), amountPaise: roundDiv(monthly * hundredths, divisor * 100) };
}

/** Days that can be encashed: the balance, capped by the carry-forward maximum when the leave type carries forward with a limit. */
export function encashableDays(balance: number, type: { encashable: boolean; carryForward: boolean; carryForwardMax: number }): number {
  if (!type.encashable) return 0;
  const bal = Math.max(0, balance);
  if (type.carryForward && type.carryForwardMax > 0) return Math.min(bal, type.carryForwardMax);
  return bal;
}

/** Notice-period shortfall recovery: one month's gross / 30 per day short (half days allowed), rounded half up. */
export function computeNoticeRecovery(shortfallDays: number, grossMonthlyPaise: number): number {
  if (!(shortfallDays > 0)) return 0;
  return roundDiv(grossMonthlyPaise * Math.round(shortfallDays * 2), 60);
}

export const FNF_LINE_KINDS = ["leave_encashment", "gratuity", "bonus", "arrears", "other_earning", "notice_recovery", "tds", "other_deduction", "loan_recovery"] as const;
export type FnfLineKind = (typeof FNF_LINE_KINDS)[number];
export const FNF_EARNING_KINDS: readonly FnfLineKind[] = ["leave_encashment", "gratuity", "bonus", "arrears", "other_earning"];
export const FNF_LINE_LABELS: Record<FnfLineKind, string> = {
  leave_encashment: "Leave encashment",
  gratuity: "Gratuity",
  bonus: "Bonus",
  arrears: "Arrears",
  other_earning: "Other earning",
  notice_recovery: "Notice-period recovery",
  tds: "TDS on settlement (manual)",
  other_deduction: "Other recovery",
  loan_recovery: "Loan / advance recovery",
};

export interface FnfLine {
  kind: FnfLineKind;
  label: string;
  amountPaise: number;
  /** A loan id for a loan recovery, a leave type id for encashment. */
  ref?: string | null;
  detail?: string | null;
}

export interface FnfResult {
  earnings: FnfLine[];
  deductions: FnfLine[];
  grossPaise: number;
  deductionsPaise: number;
  loanRecoveredPaise: number;
  loanShortfallPaise: number;
  netPayablePaise: number;
  warnings: Array<{ code: string; message: string }>;
}

/**
 * The settlement arithmetic, in a fixed order:
 *   1. earnings: leave encashment, gratuity, bonus due, arrears and other earnings;
 *   2. deductions: notice-period recovery, TDS (a manual amount), other recoveries;
 *   3. loans and advances are recovered LAST, from what is left, and never take the net payable below zero: the part of a
 *      balance that cannot be recovered stays outstanding on the loan (with a warning).
 * Net payable = earnings - deductions - loan recovery. The final month's salary is NOT in this arithmetic: it is paid by
 * the payroll run of the exit month (see docs/architecture/payroll-phase-4.md).
 */
export function computeFnf(input: {
  earnings: ReadonlyArray<FnfLine>;
  deductions: ReadonlyArray<FnfLine>;
  loans: ReadonlyArray<{ loanId: string; loanNumber: string; outstandingPrincipalPaise: number }>;
}): FnfResult {
  const earnings = input.earnings.filter((l) => l.amountPaise > 0);
  const fixedDeductions = input.deductions.filter((l) => l.amountPaise > 0);
  const grossPaise = earnings.reduce((s, l) => s + l.amountPaise, 0);
  const fixedPaise = fixedDeductions.reduce((s, l) => s + l.amountPaise, 0);
  const warnings: FnfResult["warnings"] = [];
  let left = grossPaise - fixedPaise;
  if (left < 0) warnings.push({ code: "negative_net", message: `The recoveries (₹${paiseToRupees(fixedPaise)}) are more than the amounts due (₹${paiseToRupees(grossPaise)}). Reduce a recovery before approving.` });
  const loanLines: FnfLine[] = [];
  let shortfall = 0;
  let recovered = 0;
  for (const loan of input.loans) {
    if (loan.outstandingPrincipalPaise <= 0) continue;
    const take = Math.max(0, Math.min(loan.outstandingPrincipalPaise, left));
    left -= take;
    recovered += take;
    if (take > 0) loanLines.push({ kind: "loan_recovery", label: `${FNF_LINE_LABELS.loan_recovery} ${loan.loanNumber}`, amountPaise: take, ref: loan.loanId });
    const rest = loan.outstandingPrincipalPaise - take;
    if (rest > 0) {
      shortfall += rest;
      warnings.push({ code: "loan_not_fully_recovered", message: `₹${paiseToRupees(rest)} of ${loan.loanNumber} cannot be recovered from this settlement and stays outstanding on the loan.` });
    }
  }
  const deductions = [...fixedDeductions, ...loanLines];
  return {
    earnings,
    deductions,
    grossPaise,
    deductionsPaise: fixedPaise + recovered,
    loanRecoveredPaise: recovered,
    loanShortfallPaise: shortfall,
    netPayablePaise: grossPaise - fixedPaise - recovered,
    warnings,
  };
}

export const FNF_TDS_WARNING =
  "Income-tax (TDS) on this settlement is NOT calculated. Enter the amount to deduct yourself after checking with your CA (leave encashment and gratuity have their own exemption rules).";

const fnfManualLine = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(80),
  /** Rupees. */
  amount: z.number().positive("Enter an amount above zero.").max(1_000_000_000),
});
export const fnfCreateSchema = z.object({
  employeeId: uuid,
  encashmentBasis: z.enum(LEAVE_ENCASHMENT_BASES).default("basic_da_26"),
  note: maybe(text(500)),
});
export const fnfUpdateSchema = z.object({
  id: uuid,
  encashmentBasis: z.enum(LEAVE_ENCASHMENT_BASES).optional(),
  /** Days short of the notice period (half days allowed). */
  noticeShortfallDays: z.number().min(0).max(365).optional(),
  /** Manual TDS on the settlement, rupees. */
  tdsAmount: z.number().min(0).max(1_000_000_000).optional(),
  /** Include the bonus due for the exit financial year (a suggestion at the minimum percentage). */
  includeBonus: z.boolean().optional(),
  /** Days of each leave type to encash, keyed by leave type id; blank = the maximum. */
  encashDays: z.record(z.string().uuid(), z.number().min(0).max(366)).optional(),
  earnings: z.array(fnfManualLine).max(20).optional(),
  deductions: z.array(fnfManualLine).max(20).optional(),
  note: maybe(text(500)),
});
export const fnfMarkPaidSchema = z.object({ id: uuid, bankAccountId: uuid, paidOn: isoDateSchema, reference: maybe(text(100)) });

// ═══════════════════════════════════════════════════════════════════════════
// 5. Relieving / experience letter template
// ═══════════════════════════════════════════════════════════════════════════

export const LETTER_KINDS = ["relieving"] as const;
export type LetterKind = (typeof LETTER_KINDS)[number];

export const LETTER_PLACEHOLDERS = [
  "employee_name",
  "employee_code",
  "designation",
  "department",
  "date_of_joining",
  "last_working_day",
  "company_name",
  "letter_date",
] as const;
export type LetterPlaceholder = (typeof LETTER_PLACEHOLDERS)[number];

export const DEFAULT_RELIEVING_LETTER_BODY = `This is to certify that {{employee_name}} (Employee Code: {{employee_code}}) was employed with {{company_name}} as {{designation}} in the {{department}} department from {{date_of_joining}} to {{last_working_day}}.

{{employee_name}} has been relieved from the services of {{company_name}} with effect from the close of working hours on {{last_working_day}}.

We thank {{employee_name}} for the contribution made during this period and wish them success in the future.`;

const PLACEHOLDER_RE = /\{\{\s*([a-z_]+)\s*\}\}/g;

/** Placeholders in a body that the template does not support. */
export function unknownPlaceholders(body: string): string[] {
  const bad = new Set<string>();
  for (const m of body.matchAll(PLACEHOLDER_RE)) if (!(LETTER_PLACEHOLDERS as readonly string[]).includes(m[1]!)) bad.add(m[1]!);
  return [...bad];
}

/** Fills the placeholders. A value that is missing is printed as "-". */
export function renderLetterBody(body: string, values: Partial<Record<LetterPlaceholder, string | null | undefined>>): string {
  return body.replace(PLACEHOLDER_RE, (_all, key: string) => {
    const v = (values as Record<string, string | null | undefined>)[key];
    return v && v.trim() ? v : "-";
  });
}

export const letterTemplateSchema = z.object({
  kind: z.enum(LETTER_KINDS).default("relieving"),
  title: z.string().trim().min(2).max(80).default("Relieving Letter"),
  body: z
    .string()
    .trim()
    .min(20, "Write the letter text.")
    .max(4000)
    .refine((b) => unknownPlaceholders(b).length === 0, (b) => ({ message: `Unknown placeholder: ${unknownPlaceholders(b).map((p) => `{{${p}}}`).join(", ")}. Allowed: ${LETTER_PLACEHOLDERS.map((p) => `{{${p}}}`).join(", ")}.` })),
  signatoryName: maybe(text(80)),
  signatoryTitle: maybe(text(80)),
  place: maybe(text(80)),
});
export const letterGenerateSchema = z.object({ employeeId: uuid, kind: z.enum(LETTER_KINDS).default("relieving") });

// ═══════════════════════════════════════════════════════════════════════════
// 6. Registers (working copies)
// ═══════════════════════════════════════════════════════════════════════════

export const PHASE4_REGISTERS = ["employment", "deductions", "overtime", "fnf"] as const;
export type Phase4Register = (typeof PHASE4_REGISTERS)[number];
export const PHASE4_REGISTER_LABELS: Record<Phase4Register, string> = {
  employment: "Register of employees (employment)",
  deductions: "Register of deductions, fines and advances",
  overtime: "Register of overtime",
  fnf: "Register of full and final settlements",
};

export function buildEmploymentRegister(
  rows: ReadonlyArray<{ employeeCode: string; name: string; fatherOrSpouse: string | null; gender: string | null; dateOfBirth: string | null; designation: string | null; department: string | null; employmentType: string; joinedOn: string; status: string; lastWorkingDay: string | null; exitReason: string | null }>,
): string {
  return csvTable(
    ["Employee Code", "Name", "Father / Spouse", "Gender", "Date of Birth", "Designation", "Department", "Employment Type", "Date of Joining", "Status", "Last Working Day", "Reason for Leaving"],
    rows.map((r) => [r.employeeCode, r.name, r.fatherOrSpouse ?? "", r.gender ?? "", ddmmyyyy(r.dateOfBirth), r.designation ?? "", r.department ?? "", r.employmentType, ddmmyyyy(r.joinedOn), r.status, ddmmyyyy(r.lastWorkingDay), r.exitReason ?? ""]),
  );
}

export interface DeductionRegisterRow {
  /** "YYYY-MM" or a date. */
  period: string;
  employeeCode: string;
  name: string;
  kind: "deduction" | "loan_recovery" | "advance_given";
  description: string;
  amountPaise: number;
}
export function buildDeductionsRegister(rows: readonly DeductionRegisterRow[]): string {
  const label = { deduction: "Deduction", loan_recovery: "Advance / loan recovered", advance_given: "Advance / loan given" } as const;
  return csvTable(
    ["Period", "Employee Code", "Employee Name", "Type", "Description", "Amount"],
    rows.map((r) => [r.period, r.employeeCode, r.name, label[r.kind], r.description, paiseToRupees(r.amountPaise)]),
  );
}

export function buildOvertimeRegister(rows: ReadonlyArray<{ month: string; employeeCode: string; name: string; hours: string; amountPaise: number }>): string {
  return csvTable(
    ["Month", "Employee Code", "Employee Name", "Overtime Hours", "Overtime Amount"],
    rows.map((r) => [formatPayrollMonth(r.month), r.employeeCode, r.name, r.hours, paiseToRupees(r.amountPaise)]),
  );
}

export function buildFnfRegister(
  rows: ReadonlyArray<{ number: string; employeeCode: string; name: string; lastWorkingDay: string | null; status: string; grossPaise: number; deductionsPaise: number; netPaise: number; paidOn: string | null }>,
): string {
  return csvTable(
    ["Settlement No", "Employee Code", "Employee Name", "Last Working Day", "Status", "Amounts Due", "Recoveries", "Net Payable", "Paid On"],
    rows.map((r) => [r.number, r.employeeCode, r.name, ddmmyyyy(r.lastWorkingDay), r.status, paiseToRupees(r.grossPaise), paiseToRupees(r.deductionsPaise), paiseToRupees(r.netPaise), ddmmyyyy(r.paidOn)]),
  );
}

export function buildLoanStatementCsv(
  rows: ReadonlyArray<{ date: string; kind: string; principalPaise: number; interestPaise: number; balancePaise: number; note: string }>,
): string {
  return csvTable(
    ["Date", "Event", "Principal", "Interest", "Balance After", "Note"],
    rows.map((r) => [ddmmyyyy(r.date), r.kind, paiseToRupees(r.principalPaise), paiseToRupees(r.interestPaise), paiseToRupees(r.balancePaise), r.note]),
  );
}

/** Numbers: BN-2026-27-0001, FF-0001, LN-0001. */
export function sequenceNumber(prefix: string, n: number, width = 4): string {
  return `${prefix}-${String(n).padStart(width, "0")}`;
}
