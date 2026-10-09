/**
 * Full and final (F&F) settlement on an employee's exit (Payroll Phase 4).
 *
 * DESIGN DECISION (flag for the owner, docs/architecture/payroll-phase-4.md): the final month's SALARY is NOT in the
 * settlement. It is paid by the normal payroll run of the exit month, which already prorates by days worked and applies
 * PF, ESI, professional tax, TDS and the payslip, so every statutory file stays complete. The settlement links to that
 * run (`salary_run_id`), shows what the run pays, and refuses to be submitted until that run is approved: the salary can
 * therefore neither be missed nor paid twice. What the settlement itself pays:
 *   earnings   - leave encashment, gratuity, bonus due (a suggestion), arrears and other manual earnings;
 *   deductions - notice-period recovery, a manual TDS amount, other recoveries; then loan and advance balances (last, from
 *                what is left, never below zero).
 * Status: draft (calculated) -> pending_approval -> approved -> posted -> paid. Maker-checker like a payroll run. There is
 * no reversal before posting (correct an approved settlement with a journal entry); a POSTED settlement can be reversed
 * (`reverseFnf`, terminal status `reversed`) and a paid one only after its payment is reversed (`reverseFnfPayment`).
 */

import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  bonusRunLines,
  bonusRuns,
  bankAccounts,
  businessMembers,
  businesses,
  employees,
  fnfSettlementLines,
  fnfSettlements,
  leaveLedger,
  leaveTypes,
  payrollDepartments,
  payrollDesignations,
  payrollRunLines,
  payrollRuns,
  type TenantDatabase,
} from "@fintranzact/db";
import {
  FNF_EARNING_KINDS,
  FNF_LINE_LABELS,
  FNF_TDS_WARNING,
  MAKER_CHECKER_MESSAGE,
  approverAllowed,
  bonusRulesGaps,
  computeEmployeeBonus,
  computeFnf,
  computeGratuityFull,
  computeLeaveEncashment,
  computeNoticeRecovery,
  formatPayrollMonth,
  fyStartYearOfMonth,
  istDateParts,
  leaveYearOf,
  monthOf,
  paiseToRupees,
  rupeesToPaise,
  encashableDays,
  fyLabel,
  type FnfLine,
  type FnfManualDeduction,
  type FnfManualEarning,
  type FnfResult,
  type FnfStatus,
  type GratuityDetail,
  type LeaveEncashmentBasis,
} from "@fintranzact/shared";
import { assertPeriodOpen } from "../period-lock.js";
import { amountInWords } from "../invoice-templates/model.js";
import { badRequest, notFound } from "./access.js";
import { bookDate, cashOrBankAccountId, ensurePayrollAccounts, moveBank, reverseJournalEntry, writeJournalEntry, type PayrollAccountKey } from "./books.js";
import { loadBonusYear } from "./bonus.js";
import { provisionBalancePaise, salaryBasisOf } from "./gratuity.js";
import { activeLoansOf, nextSeriesNumber, recoverLoansInFnf, reverseLoanRecoveriesOfFnf } from "./loans.js";
import { loadPayrollSettings } from "./data.js";
import { loadStatutoryRates } from "./statutory.js";
import type { Actor } from "./run.js";
import type { FnfStatementData } from "./phase4-pdf.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;
type Reader = Pick<TenantDatabase, "select">;
type FnfRow = typeof fnfSettlements.$inferSelect;
type EmployeeRow = typeof employees.$inferSelect;

const FINAL = ["approved", "posted", "paid"];

export interface FnfInputs {
  noticeShortfallDays?: number;
  tdsAmount?: number;
  includeBonus?: boolean;
  /** Set by the calculation when a bonus line was produced: the financial year it is for. */
  bonusFinancialYear?: number;
  encashDays?: Record<string, number>;
  earnings?: FnfManualEarning[];
  deductions?: FnfManualDeduction[];
}

function todayIst(): string {
  const p = istDateParts(new Date());
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export async function getFnf(db: Reader, businessId: string, id: string): Promise<FnfRow> {
  const [s] = await db.select().from(fnfSettlements).where(and(eq(fnfSettlements.id, id), eq(fnfSettlements.businessId, businessId))).limit(1);
  if (!s) throw notFound("Settlement");
  return s;
}

async function lockFnf(tx: Tx, businessId: string, id: string): Promise<FnfRow> {
  const [s] = await tx.select().from(fnfSettlements).where(and(eq(fnfSettlements.id, id), eq(fnfSettlements.businessId, businessId))).for("update").limit(1);
  if (!s) throw notFound("Settlement");
  return s as FnfRow;
}

function requireStatus(s: FnfRow, allowed: FnfStatus[], what: string) {
  if (!allowed.includes(s.status as FnfStatus)) throw badRequest(`${what} is not possible while the settlement is "${s.status.replace(/_/g, " ")}".`);
}

// ── Salary of the exit month (paid by the payroll run) ───────────────────────

export interface SalaryStatus {
  state: "in_run" | "run_pending" | "no_run" | "no_line";
  month: string;
  runId: string | null;
  runStatus: string | null;
  netPay: string | null;
  message: string;
}

export async function salaryStatusOf(db: Reader, businessId: string, employeeId: string, month: string): Promise<SalaryStatus> {
  const label = formatPayrollMonth(month);
  const [run] = await db.select().from(payrollRuns).where(and(eq(payrollRuns.businessId, businessId), eq(payrollRuns.month, month))).limit(1);
  if (!run) return { state: "no_run", month, runId: null, runStatus: null, netPay: null, message: `There is no payroll run for ${label} yet. The last month's salary is paid through it: create and approve it before this settlement.` };
  const [line] = await db.select().from(payrollRunLines).where(and(eq(payrollRunLines.runId, run.id), eq(payrollRunLines.employeeId, employeeId))).limit(1);
  if (!line) {
    return { state: "no_line", month, runId: run.id, runStatus: run.status, netPay: null, message: `The ${label} payroll run has no line for this employee (no salary structure, or the run is not calculated yet). Check it so the last month's salary is not missed.` };
  }
  const final = FINAL.includes(run.status);
  return {
    state: final ? "in_run" : "run_pending",
    month,
    runId: run.id,
    runStatus: run.status,
    netPay: line.netPay,
    message: final
      ? `Salary for ${label} (net ₹${line.netPay}) is paid through the ${label} payroll run, not in this settlement.`
      : `The ${label} payroll run is "${run.status.replace(/_/g, " ")}". Approve it first: the last month's salary is paid through it.`,
  };
}

// ── The plan: everything the settlement works out ────────────────────────────

interface FnfPlan {
  lines: FnfLine[];
  result: FnfResult;
  encashments: Array<{ leaveTypeId: string; code: string; days: number; amountPaise: number }>;
  loanRecoveries: Array<{ loanId: string; amountPaise: number }>;
  gratuity: (GratuityDetail & { lastDrawnWagesPaise: number }) | null;
  bonusFy: number | null;
  salary: SalaryStatus;
  warnings: Array<{ code: string; message: string }>;
}

async function leaveBalance(tx: Tx, employeeId: string, leaveTypeId: string, leaveYear: number): Promise<number> {
  const [row] = await tx
    .select({ n: sql<string>`COALESCE(SUM(${leaveLedger.days}), 0)::text` })
    .from(leaveLedger)
    .where(and(eq(leaveLedger.employeeId, employeeId), eq(leaveLedger.leaveTypeId, leaveTypeId), eq(leaveLedger.leaveYear, leaveYear)));
  return Number(row?.n ?? 0);
}

async function buildPlan(tx: Tx, s: FnfRow, emp: EmployeeRow): Promise<FnfPlan> {
  const inputs = (s.inputs ?? {}) as FnfInputs;
  const lwd = s.lastWorkingDay;
  const warnings: FnfPlan["warnings"] = [];
  const salary = await salaryStatusOf(tx, s.businessId, emp.id, s.salaryMonth ?? monthOf(lwd));
  if (salary.state === "no_line") warnings.push({ code: "salary_not_in_run", message: salary.message });
  const basisMap = await salaryBasisOf(tx, s.businessId, [emp.id], lwd);
  const basis = basisMap.get(emp.id);
  if (!basis) warnings.push({ code: "no_salary_structure", message: "This employee has no salary structure effective by the last working day, so leave encashment, gratuity and notice recovery are 0. Add a salary structure and calculate again." });
  const basicDa = basis?.basicDaPaise ?? 0;
  const gross = basis?.grossPaise ?? 0;
  const settings = await loadPayrollSettings(tx, s.businessId);
  const fy = fyStartYearOfMonth(monthOf(lwd));
  const loaded = await loadStatutoryRates(tx, s.businessId, fy);

  const earnings: FnfLine[] = [];
  const deductions: FnfLine[] = [];

  // Leave encashment: each encashable leave type, its balance in the leave year of the last working day.
  const encashments: FnfPlan["encashments"] = [];
  const types = await tx.select().from(leaveTypes).where(and(eq(leaveTypes.businessId, s.businessId), eq(leaveTypes.encashable, true), eq(leaveTypes.isActive, true))).orderBy(asc(leaveTypes.code));
  const leaveYear = leaveYearOf(lwd, settings.leaveYearStartMonth);
  for (const t of types as Array<typeof leaveTypes.$inferSelect>) {
    const balance = await leaveBalance(tx, emp.id, t.id, leaveYear);
    const maxDays = encashableDays(balance, { encashable: t.encashable, carryForward: t.carryForward, carryForwardMax: Number(t.carryForwardMax) });
    const wanted = inputs.encashDays?.[t.id];
    const days = Math.min(maxDays, wanted == null ? maxDays : Math.max(0, wanted));
    if (!(days > 0)) continue;
    const enc = computeLeaveEncashment({ days, basicDaPaise: basicDa, grossPaise: gross, basis: s.encashmentBasis as LeaveEncashmentBasis });
    if (enc.amountPaise <= 0) continue;
    encashments.push({ leaveTypeId: t.id, code: t.code, days, amountPaise: enc.amountPaise });
    earnings.push({
      kind: "leave_encashment",
      label: `${FNF_LINE_LABELS.leave_encashment} (${t.code})`,
      amountPaise: enc.amountPaise,
      ref: t.id,
      detail: `${days} day${days === 1 ? "" : "s"} x ₹${paiseToRupees(enc.ratePerDayPaise)} (${s.encashmentBasis.replace(/_/g, " ")}); balance ${balance}, encashable ${maxDays}`,
    });
  }

  // Gratuity.
  let gratuity: FnfPlan["gratuity"] = null;
  if (basis) {
    const g = computeGratuityFull({ joinedOn: emp.dateOfJoining, endOn: lwd, lastDrawnWagesPaise: basicDa, employmentType: emp.employmentType, exitReason: s.exitReason, rules: loaded.rates.gratuity });
    gratuity = { ...g, lastDrawnWagesPaise: basicDa };
    if (g.amountPaise > 0) {
      earnings.push({
        kind: "gratuity",
        label: FNF_LINE_LABELS.gratuity,
        amountPaise: g.amountPaise,
        detail: `Last drawn Basic + DA ₹${paiseToRupees(basicDa)} x 15/26 x ${g.yearsForFormula} year${g.yearsForFormula === 1 ? "" : "s"}${g.capped ? " (limit applied)" : ""}`,
      });
    } else if (!g.eligible) {
      warnings.push({ code: "gratuity_not_eligible", message: `Gratuity is not payable: ${g.completedYears} completed year${g.completedYears === 1 ? "" : "s"} of service, ${g.minYearsRequired} needed.` });
    }
  }

  // Bonus due (a suggestion at the minimum percentage), unless a bonus run already covers it.
  let bonusFy: number | null = null;
  if (inputs.includeBonus) {
    const gaps = bonusRulesGaps(loaded.rates.bonus);
    if (gaps.length) {
      warnings.push({ code: "bonus_not_configured", message: `Bonus due was not added. ${gaps[0]}` });
    } else {
      const [existing] = await tx
        .select({ run: bonusRuns, line: bonusRunLines })
        .from(bonusRuns)
        .leftJoin(bonusRunLines, and(eq(bonusRunLines.runId, bonusRuns.id), eq(bonusRunLines.employeeId, emp.id)))
        .where(and(eq(bonusRuns.businessId, s.businessId), eq(bonusRuns.financialYear, fy)))
        .limit(1);
      if (existing && FINAL.includes(existing.run.status) && existing.line && existing.line.eligible && Number(existing.line.bonus) > 0) {
        warnings.push({ code: "bonus_in_run", message: `Bonus for ${fyLabel(fy)} is already in bonus run ${existing.run.number}, so it is not added here.` });
      } else {
        const year = await loadBonusYear(tx, s.businessId, fy);
        const mine = year.employees.find((e) => e.employeeId === emp.id);
        const months = (mine?.months ?? []).filter((m) => m.month <= monthOf(lwd));
        if (months.length === 0) {
          warnings.push({ code: "bonus_no_pay", message: `Bonus due was not added: there is no approved payroll for this employee in ${fyLabel(fy)} yet.` });
        } else {
          const b = computeEmployeeBonus({ months }, loaded.rates.bonus, loaded.rates.bonus.minPercent);
          if (b.bonusPaise > 0) {
            bonusFy = fy;
            earnings.push({ kind: "bonus", label: `${FNF_LINE_LABELS.bonus} (FY ${fyLabel(fy)})`, amountPaise: b.bonusPaise, detail: `${loaded.rates.bonus.minPercent}% (the minimum) of wages after the ceiling, ${b.monthsPaid} month${b.monthsPaid === 1 ? "" : "s"} paid` });
            if (existing) warnings.push({ code: "bonus_run_exists", message: `A bonus run for ${fyLabel(fy)} exists (${existing.run.number}). This employee is left out of it once this settlement is approved.` });
          } else if (!b.eligible) {
            warnings.push({ code: "bonus_not_eligible", message: `No bonus due: ${b.reasonText}` });
          }
        }
      }
    }
  }

  for (const e of inputs.earnings ?? []) earnings.push({ kind: e.kind ?? "other_earning", label: e.name, amountPaise: rupeesToPaise(e.amount) });

  // Deductions.
  const notice = computeNoticeRecovery(inputs.noticeShortfallDays ?? 0, gross);
  if (notice > 0) deductions.push({ kind: "notice_recovery", label: FNF_LINE_LABELS.notice_recovery, amountPaise: notice, detail: `${inputs.noticeShortfallDays} day${inputs.noticeShortfallDays === 1 ? "" : "s"} short x gross ₹${paiseToRupees(gross)} / 30` });
  if ((inputs.tdsAmount ?? 0) > 0) deductions.push({ kind: "tds", label: FNF_LINE_LABELS.tds, amountPaise: rupeesToPaise(inputs.tdsAmount!) });
  for (const d of inputs.deductions ?? []) deductions.push({ kind: "other_deduction", label: d.name, amountPaise: rupeesToPaise(d.amount) });

  // Loans last.
  const loans = await activeLoansOf(tx, s.businessId, emp.id);
  const result = computeFnf({ earnings, deductions, loans: loans.map((l) => ({ loanId: l.loan.id, loanNumber: l.loan.number, outstandingPrincipalPaise: l.outstandingPaise })) });
  warnings.push(...result.warnings);
  warnings.push({ code: "tds_not_computed", message: FNF_TDS_WARNING });
  const loanRecoveries = result.deductions.filter((d) => d.kind === "loan_recovery" && d.ref).map((d) => ({ loanId: d.ref!, amountPaise: d.amountPaise }));
  return { lines: [...result.earnings, ...result.deductions], result, encashments, loanRecoveries, gratuity, bonusFy, salary, warnings };
}

async function persistPlan(tx: Tx, s: FnfRow, plan: FnfPlan, actor: Actor): Promise<FnfRow> {
  const inputs = { ...((s.inputs ?? {}) as FnfInputs) };
  if (plan.bonusFy != null) inputs.bonusFinancialYear = plan.bonusFy;
  else delete inputs.bonusFinancialYear;
  await tx.delete(fnfSettlementLines).where(eq(fnfSettlementLines.settlementId, s.id));
  if (plan.lines.length) {
    await tx.insert(fnfSettlementLines).values(
      plan.lines.map((l, i) => ({
        settlementId: s.id,
        businessId: s.businessId,
        kind: l.kind,
        side: (FNF_EARNING_KINDS as readonly string[]).includes(l.kind) ? "earning" : "deduction",
        label: l.label,
        amount: paiseToRupees(l.amountPaise),
        ref: l.ref ?? null,
        detail: l.detail ?? null,
        sortOrder: i,
      })),
    );
  }
  const [updated] = await tx
    .update(fnfSettlements)
    .set({
      status: "draft",
      inputs,
      grossTotal: paiseToRupees(plan.result.grossPaise),
      deductionsTotal: paiseToRupees(plan.result.deductionsPaise),
      loanRecovered: paiseToRupees(plan.result.loanRecoveredPaise),
      netPayable: paiseToRupees(plan.result.netPayablePaise),
      salaryRunId: plan.salary.runId,
      gratuity: plan.gratuity ? ({ ...plan.gratuity } as unknown as Record<string, unknown>) : null,
      warnings: plan.warnings,
      calculatedAt: new Date(),
      calculatedByUserId: actor.id,
      calculatedByName: actor.name,
      submittedAt: null,
      submittedByUserId: null,
      updatedAt: new Date(),
    })
    .where(eq(fnfSettlements.id, s.id))
    .returning();
  return updated as FnfRow;
}

async function employeeOf(tx: Tx, s: FnfRow): Promise<EmployeeRow> {
  const [emp] = await tx.select().from(employees).where(eq(employees.id, s.employeeId)).limit(1);
  if (!emp) throw notFound("Employee");
  return emp as EmployeeRow;
}

// ── Create, calculate, edit ──────────────────────────────────────────────────

export async function createFnf(
  db: TenantDatabase,
  input: { businessId: string; employeeId: string; encashmentBasis: LeaveEncashmentBasis; note?: string | null; actor: Actor },
): Promise<FnfRow> {
  const [emp] = await db.select().from(employees).where(and(eq(employees.id, input.employeeId), eq(employees.businessId, input.businessId))).limit(1);
  if (!emp) throw notFound("Employee");
  if (emp.status !== "exited" || !emp.lastWorkingDay) throw badRequest("Record the employee's exit (with the last working day) before preparing the full and final settlement.");
  if (emp.lastWorkingDay > todayIst()) throw badRequest("The settlement can be prepared on or after the last working day.");
  // A reversed settlement stays on record; a new one may be prepared after it.
  const [existing] = await db.select({ id: fnfSettlements.id }).from(fnfSettlements).where(and(eq(fnfSettlements.businessId, input.businessId), eq(fnfSettlements.employeeId, emp.id), ne(fnfSettlements.status, "reversed"))).limit(1);
  if (existing) throw new TRPCError({ code: "CONFLICT", message: "This employee already has a full and final settlement." });
  return db.transaction(async (tx) => {
    const number = await nextSeriesNumber(tx, input.businessId, "fnf");
    const [row] = await tx
      .insert(fnfSettlements)
      .values({
        businessId: input.businessId,
        employeeId: emp.id,
        number,
        lastWorkingDay: emp.lastWorkingDay!,
        exitReason: emp.exitReason,
        encashmentBasis: input.encashmentBasis,
        note: input.note || null,
        salaryMonth: monthOf(emp.lastWorkingDay!),
        createdByUserId: input.actor.id,
        createdByName: input.actor.name,
      })
      .returning();
    const plan = await buildPlan(tx, row!, emp);
    return persistPlan(tx, row!, plan, input.actor);
  });
}

/** Calculate again from today's balances (leave, loans, bonus rules) and the saved inputs. */
export async function calculateFnf(db: TenantDatabase, input: { businessId: string; id: string; actor: Actor }): Promise<FnfRow> {
  return db.transaction(async (tx) => {
    const s = await lockFnf(tx, input.businessId, input.id);
    requireStatus(s, ["draft", "pending_approval"], "Calculating");
    const emp = await employeeOf(tx, s);
    const plan = await buildPlan(tx, s, emp);
    return persistPlan(tx, s, plan, input.actor);
  });
}

/** Save what the preparer chose, then calculate again. */
export async function updateFnf(
  db: TenantDatabase,
  input: {
    businessId: string;
    id: string;
    actor: Actor;
    patch: { encashmentBasis?: LeaveEncashmentBasis; noticeShortfallDays?: number; tdsAmount?: number; includeBonus?: boolean; encashDays?: Record<string, number>; earnings?: FnfManualEarning[]; deductions?: FnfManualDeduction[]; note?: string | null };
  },
): Promise<FnfRow> {
  return db.transaction(async (tx) => {
    const s = await lockFnf(tx, input.businessId, input.id);
    requireStatus(s, ["draft", "pending_approval"], "Changing the settlement");
    const p = input.patch;
    const inputs: FnfInputs = { ...((s.inputs ?? {}) as FnfInputs) };
    if (p.noticeShortfallDays !== undefined) inputs.noticeShortfallDays = p.noticeShortfallDays;
    if (p.tdsAmount !== undefined) inputs.tdsAmount = p.tdsAmount;
    if (p.includeBonus !== undefined) inputs.includeBonus = p.includeBonus;
    if (p.encashDays !== undefined) inputs.encashDays = p.encashDays;
    if (p.earnings !== undefined) inputs.earnings = p.earnings;
    if (p.deductions !== undefined) inputs.deductions = p.deductions;
    const [saved] = await tx
      .update(fnfSettlements)
      .set({ inputs: inputs as Record<string, unknown>, ...(p.encashmentBasis ? { encashmentBasis: p.encashmentBasis } : {}), ...(p.note !== undefined ? { note: p.note || null } : {}), updatedAt: new Date() })
      .where(eq(fnfSettlements.id, s.id))
      .returning();
    const emp = await employeeOf(tx, saved as FnfRow);
    const plan = await buildPlan(tx, saved as FnfRow, emp);
    return persistPlan(tx, saved as FnfRow, plan, input.actor);
  });
}

export async function submitFnf(db: TenantDatabase, input: { businessId: string; id: string; actor: Actor }): Promise<FnfRow> {
  return db.transaction(async (tx) => {
    const s = await lockFnf(tx, input.businessId, input.id);
    requireStatus(s, ["draft"], "Submitting for approval");
    if (!s.calculatedAt) throw badRequest("Calculate the settlement first.");
    if (rupeesToPaise(s.netPayable) < 0) throw badRequest("The recoveries are more than the amounts due. Reduce a recovery and calculate again.");
    const salary = await salaryStatusOf(tx, input.businessId, s.employeeId, s.salaryMonth ?? monthOf(s.lastWorkingDay));
    if (salary.state === "no_run" || salary.state === "run_pending") throw badRequest(salary.message);
    const [updated] = await tx.update(fnfSettlements).set({ status: "pending_approval", submittedAt: new Date(), submittedByUserId: input.actor.id, updatedAt: new Date() }).where(eq(fnfSettlements.id, s.id)).returning();
    return updated as FnfRow;
  });
}

export async function reopenFnf(db: TenantDatabase, input: { businessId: string; id: string }): Promise<FnfRow> {
  return db.transaction(async (tx) => {
    const s = await lockFnf(tx, input.businessId, input.id);
    if (s.status === "draft") throw badRequest("The settlement is already a draft.");
    requireStatus(s, ["pending_approval"], "Reopening");
    const [updated] = await tx.update(fnfSettlements).set({ status: "draft", submittedAt: null, submittedByUserId: null, updatedAt: new Date() }).where(eq(fnfSettlements.id, s.id)).returning();
    return updated as FnfRow;
  });
}

export async function deleteFnf(db: TenantDatabase, input: { businessId: string; id: string }): Promise<{ deleted: true }> {
  return db.transaction(async (tx) => {
    const s = await lockFnf(tx, input.businessId, input.id);
    requireStatus(s, ["draft"], "Deleting");
    await tx.delete(fnfSettlements).where(eq(fnfSettlements.id, s.id));
    return { deleted: true as const };
  });
}

// ── Approve: record the effects (leave encashed, loans recovered) ────────────

export async function approveFnf(db: TenantDatabase, input: { businessId: string; id: string; actor: Actor }): Promise<FnfRow> {
  return db.transaction(async (tx) => {
    const s = await lockFnf(tx, input.businessId, input.id);
    requireStatus(s, ["pending_approval"], "Approving");
    const [members] = await tx.select({ n: sql<number>`count(*)::int` }).from(businessMembers).where(eq(businessMembers.businessId, input.businessId));
    if (!approverAllowed({ approverUserId: input.actor.id, calculatedByUserId: s.calculatedByUserId, businessMemberCount: members?.n ?? 1 })) {
      throw new TRPCError({ code: "FORBIDDEN", message: MAKER_CHECKER_MESSAGE.replace(/payroll/g, "settlement") });
    }
    // Serialise with the payroll run approval for this employee, and re-work the plan: balances may have moved since it was calculated.
    await tx.select({ id: employees.id }).from(employees).where(eq(employees.id, s.employeeId)).for("update");
    const emp = await employeeOf(tx, s);
    const plan = await buildPlan(tx, s, emp);
    const saved: Array<typeof fnfSettlementLines.$inferSelect> = await tx.select().from(fnfSettlementLines).where(eq(fnfSettlementLines.settlementId, s.id));
    const key = (kind: string, ref: string | null, label: string, amount: string) => `${kind}|${ref ?? ""}|${label}|${rupeesToPaise(amount)}`;
    const savedKeys = saved.map((l) => key(l.kind, l.ref, l.label, l.amount)).sort().join("\n");
    const freshKeys = plan.lines.map((l) => key(l.kind, l.ref ?? null, l.label, paiseToRupees(l.amountPaise))).sort().join("\n");
    if (savedKeys !== freshKeys) throw badRequest("Balances (leave, loans or bonus) changed after the settlement was calculated (for example a bonus run now pays the bonus). Calculate it again before approving.");
    if (plan.result.netPayablePaise < 0) throw badRequest("The recoveries are more than the amounts due.");
    if (plan.salary.state === "no_run" || plan.salary.state === "run_pending") throw badRequest(plan.salary.message);
    // Leave encashed leaves the balance (idempotent by period key).
    const settings = await loadPayrollSettings(tx, input.businessId);
    const leaveYear = leaveYearOf(s.lastWorkingDay, settings.leaveYearStartMonth);
    for (const en of plan.encashments) {
      await tx
        .insert(leaveLedger)
        .values({ businessId: input.businessId, employeeId: s.employeeId, leaveTypeId: en.leaveTypeId, leaveYear, entryDate: s.lastWorkingDay, kind: "encashment", days: String(-en.days), periodKey: `fnf:${s.id}`, note: `Encashed in full and final ${s.number}`, createdByUserId: input.actor.id })
        .onConflictDoNothing();
    }
    await recoverLoansInFnf(tx, { businessId: input.businessId, settlementId: s.id, date: s.lastWorkingDay, recoveries: plan.loanRecoveries, actor: input.actor });
    const [updated] = await tx
      .update(fnfSettlements)
      .set({ status: "approved", approvedAt: new Date(), approvedByUserId: input.actor.id, approvedByName: input.actor.name, salaryRunId: plan.salary.runId, updatedAt: new Date() })
      .where(eq(fnfSettlements.id, s.id))
      .returning();
    return updated as FnfRow;
  });
}

// ── Post to the books and pay ────────────────────────────────────────────────

export async function postFnf(db: TenantDatabase, input: { businessId: string; id: string; actor: Actor }): Promise<{ settlement: FnfRow; journalEntryId: string | null; created: boolean }> {
  const first = await getFnf(db, input.businessId, input.id);
  if (first.status === "posted" || first.status === "paid") return { settlement: first, journalEntryId: first.accrualJournalEntryId, created: false };
  requireStatus(first, ["approved"], "Posting to the books");
  await assertPeriodOpen(db, input.businessId, [first.lastWorkingDay]);
  return db.transaction(async (tx) => {
    const s = await lockFnf(tx, input.businessId, input.id);
    if (s.status === "posted" || s.status === "paid") return { settlement: s, journalEntryId: s.accrualJournalEntryId, created: false };
    requireStatus(s, ["approved"], "Posting to the books");
    const lines: Array<typeof fnfSettlementLines.$inferSelect> = await tx.select().from(fnfSettlementLines).where(eq(fnfSettlementLines.settlementId, s.id));
    const sum = (kinds: string[]) => lines.filter((l) => kinds.includes(l.kind)).reduce((n, l) => n + rupeesToPaise(l.amount), 0);
    const leave = sum(["leave_encashment"]);
    const gratuity = sum(["gratuity"]);
    const bonus = sum(["bonus"]);
    const arrears = sum(["arrears"]);
    const other = sum(["other_earning"]);
    const notice = sum(["notice_recovery"]);
    const tds = sum(["tds"]);
    const otherDed = sum(["other_deduction"]);
    const loan = sum(["loan_recovery"]);
    const gross = leave + gratuity + bonus + arrears + other;
    const net = rupeesToPaise(s.netPayable);
    if (gross !== rupeesToPaise(s.grossTotal) || net !== gross - notice - tds - otherDed - loan) throw badRequest("The settlement's totals no longer match its lines. Calculate it again.");
    if (gross === 0) {
      const [updated] = await tx.update(fnfSettlements).set({ status: "posted", postedAt: new Date(), postedByUserId: input.actor.id, updatedAt: new Date() }).where(eq(fnfSettlements.id, s.id)).returning();
      return { settlement: updated as FnfRow, journalEntryId: null, created: true };
    }
    const keys = new Set<PayrollAccountKey>();
    if (leave > 0 || other > 0) keys.add("allowances");
    if (arrears > 0) keys.add("wages");
    if (bonus > 0) keys.add("bonus_incentives");
    let draw = 0;
    if (gratuity > 0) {
      const balance = await provisionBalancePaise(tx, input.businessId);
      draw = Math.min(gratuity, Math.max(0, balance));
      if (draw > 0) keys.add("gratuity_provision");
      if (gratuity - draw > 0) keys.add("gratuity_expense");
    }
    if (net > 0) keys.add("fnf_payable");
    if (loan > 0) keys.add("loans_receivable");
    if (notice + otherDed > 0) keys.add("deductions_payable");
    if (tds > 0) keys.add("tds_payable");
    const acc = await ensurePayrollAccounts(tx, input.businessId, [...keys]);
    const label = `${s.number}`;
    const jl: Parameters<typeof writeJournalEntry>[1]["lines"] = [];
    if (leave + other > 0) jl.push({ accountId: acc.allowances!, debitPaise: leave + other, creditPaise: 0, narration: `Leave encashment and other dues ${label}` });
    if (arrears > 0) jl.push({ accountId: acc.wages!, debitPaise: arrears, creditPaise: 0, narration: `Arrears ${label}` });
    if (bonus > 0) jl.push({ accountId: acc.bonus_incentives!, debitPaise: bonus, creditPaise: 0, narration: `Bonus ${label}` });
    if (draw > 0) jl.push({ accountId: acc.gratuity_provision!, debitPaise: draw, creditPaise: 0, narration: `Gratuity paid from provision ${label}` });
    if (gratuity - draw > 0) jl.push({ accountId: acc.gratuity_expense!, debitPaise: gratuity - draw, creditPaise: 0, narration: `Gratuity ${label}` });
    if (net > 0) jl.push({ accountId: acc.fnf_payable!, debitPaise: 0, creditPaise: net, narration: `Full and final payable ${label}` });
    if (loan > 0) jl.push({ accountId: acc.loans_receivable!, debitPaise: 0, creditPaise: loan, narration: `Loan and advance recovered ${label}` });
    if (notice + otherDed > 0) jl.push({ accountId: acc.deductions_payable!, debitPaise: 0, creditPaise: notice + otherDed, narration: `Recoveries held ${label}` });
    if (tds > 0) jl.push({ accountId: acc.tds_payable!, debitPaise: 0, creditPaise: tds, narration: `TDS on settlement ${label}` });
    const entry = await writeJournalEntry(tx, {
      businessId: input.businessId,
      entryDate: bookDate(s.lastWorkingDay),
      narration: `Full and final settlement ${s.number}`,
      userId: input.actor.id,
      userName: input.actor.name,
      lines: jl,
    });
    const [updated] = await tx.update(fnfSettlements).set({ status: "posted", postedAt: new Date(), postedByUserId: input.actor.id, accrualJournalEntryId: entry.id, updatedAt: new Date() }).where(eq(fnfSettlements.id, s.id)).returning();
    return { settlement: updated as FnfRow, journalEntryId: entry.id, created: true };
  });
}

export async function markFnfPaid(
  db: TenantDatabase,
  input: { businessId: string; id: string; bankAccountId: string; paidOn: string; reference?: string | null; actor: Actor },
): Promise<{ settlement: FnfRow; journalEntryId: string | null; created: boolean }> {
  const first = await getFnf(db, input.businessId, input.id);
  if (first.status === "paid") return { settlement: first, journalEntryId: first.paymentJournalEntryId, created: false };
  requireStatus(first, ["posted"], "Marking as paid");
  await assertPeriodOpen(db, input.businessId, [input.paidOn]);
  return db.transaction(async (tx) => {
    const s = await lockFnf(tx, input.businessId, input.id);
    if (s.status === "paid") return { settlement: s, journalEntryId: s.paymentJournalEntryId, created: false };
    requireStatus(s, ["posted"], "Marking as paid");
    const net = rupeesToPaise(s.netPayable);
    let journalEntryId: string | null = null;
    let bankId: string | null = null;
    if (net > 0) {
      const acc = await ensurePayrollAccounts(tx, input.businessId, ["fnf_payable"]);
      const bank = await moveBank(tx, { businessId: input.businessId, bankAccountId: input.bankAccountId, direction: "out", paise: net, date: bookDate(input.paidOn), description: `Full and final ${s.number}`, referenceType: "fnf_settlement", referenceId: s.id });
      const payFrom = await cashOrBankAccountId(tx, input.businessId, bank.accountType);
      const entry = await writeJournalEntry(tx, {
        businessId: input.businessId,
        entryDate: bookDate(input.paidOn),
        narration: `Full and final settlement ${s.number} paid`,
        userId: input.actor.id,
        userName: input.actor.name,
        lines: [
          { accountId: acc.fnf_payable!, debitPaise: net, creditPaise: 0, narration: `Settlement paid ${s.number}` },
          { accountId: payFrom, debitPaise: 0, creditPaise: net, narration: `Settlement ${s.number} paid from ${bank.accountName}` },
        ],
      });
      journalEntryId = entry.id;
      bankId = bank.id;
    }
    const [updated] = await tx
      .update(fnfSettlements)
      .set({ status: "paid", paidAt: new Date(), paidOn: input.paidOn, paidByUserId: input.actor.id, paidFromBankAccountId: bankId, paidReference: input.reference ?? null, paymentJournalEntryId: journalEntryId, paymentReversedAt: null, paymentReversedByUserId: null, paymentReversalReason: null, paymentReversalJournalEntryId: null, updatedAt: new Date() })
      .where(eq(fnfSettlements.id, s.id))
      .returning();
    return { settlement: updated as FnfRow, journalEntryId, created: true };
  });
}

// ── Reversal ─────────────────────────────────────────────────────────────────

/**
 * Reverse the PAYMENT of a settlement (paid -> posted): a mirror of the payment entry (Dr bank or cash / Cr 2442), the money
 * back into the bank account it left (a bank transaction), and the paid fields cleared. The reason is kept on the record.
 * Idempotent: a second call finds the payment already reversed and returns the first result. Refused unless the settlement is
 * paid (or was paid and reversed). Needs the period of the payment entry open.
 */
export async function reverseFnfPayment(
  db: TenantDatabase,
  input: { businessId: string; id: string; reason: string; actor: Actor },
): Promise<{ settlement: FnfRow; journalEntryId: string | null; created: boolean }> {
  const first = await getFnf(db, input.businessId, input.id);
  if (first.status === "posted" && first.paymentReversedAt) return { settlement: first, journalEntryId: first.paymentReversalJournalEntryId, created: false };
  requireStatus(first, ["paid"], "Reversing the payment");
  await assertPeriodOpen(db, input.businessId, [first.paidOn ?? todayIst()]);
  return db.transaction(async (tx) => {
    const s = await lockFnf(tx, input.businessId, input.id);
    if (s.status === "posted" && s.paymentReversedAt) return { settlement: s, journalEntryId: s.paymentReversalJournalEntryId, created: false };
    requireStatus(s, ["paid"], "Reversing the payment");
    const net = rupeesToPaise(s.netPayable);
    let journalEntryId: string | null = null;
    if (net > 0) {
      if (!s.paymentJournalEntryId || !s.paidFromBankAccountId) throw badRequest("The payment of this settlement has no journal entry or bank account on record, so it cannot be reversed here. Correct it with a journal entry.");
      const [acct] = await tx.select({ id: bankAccounts.id }).from(bankAccounts).where(and(eq(bankAccounts.id, s.paidFromBankAccountId), eq(bankAccounts.businessId, input.businessId))).limit(1);
      if (!acct) throw badRequest("The bank or cash account this settlement was paid from no longer exists, so the payment cannot be reversed here.");
      const mirror = await reverseJournalEntry(tx, { businessId: input.businessId, entryId: s.paymentJournalEntryId, narration: `Reversal of the payment of full and final settlement ${s.number}: ${input.reason}`, userId: input.actor.id, userName: input.actor.name });
      await moveBank(tx, { businessId: input.businessId, bankAccountId: s.paidFromBankAccountId, direction: "in", paise: net, date: bookDate(s.paidOn ?? todayIst()), description: `Reversal: full and final ${s.number} payment`, referenceType: "fnf_settlement_reversal", referenceId: s.id });
      journalEntryId = mirror.id;
    }
    const [updated] = await tx
      .update(fnfSettlements)
      .set({
        status: "posted",
        paidAt: null,
        paidOn: null,
        paidByUserId: null,
        paidFromBankAccountId: null,
        paidReference: null,
        paymentJournalEntryId: null,
        paymentReversedAt: new Date(),
        paymentReversedByUserId: input.actor.id,
        paymentReversalReason: input.reason,
        paymentReversalJournalEntryId: journalEntryId,
        updatedAt: new Date(),
      })
      .where(eq(fnfSettlements.id, s.id))
      .returning();
    return { settlement: updated as FnfRow, journalEntryId, created: true };
  });
}

/**
 * Reverse a POSTED settlement (posted -> reversed, terminal). Everything it did is undone by appending, never deleting:
 *   books    - a mirror of the accrual entry with every line swapped (the original is marked voided and points at it);
 *   loans    - an `fnf_reversed` event per loan it recovered puts the principal back, closed loans become active, and the
 *              remaining schedule is replaced for the restored balance;
 *   leave    - a compensating `adjustment` row per leave type it encashed;
 *   gratuity - it was drawn from the provision (2441) by the entry itself, so the mirror gives it back;
 *   bonus    - the settlement no longer counts as approved, so a bonus run takes the employee in again.
 * The employee is NOT reactivated: HR re-opens the exit or prepares a new settlement (allowed once this one is reversed).
 * A paid settlement is refused until its payment is reversed (`reverseFnfPayment`). Idempotent: a second call returns the
 * first result. The period of the accrual entry must be open (the mirror is dated the same day).
 */
export async function reverseFnf(
  db: TenantDatabase,
  input: { businessId: string; id: string; reason: string; actor: Actor },
): Promise<{ settlement: FnfRow; journalEntryId: string | null; created: boolean; loans: Array<{ loanId: string; loanNumber: string; amountPaise: number }> }> {
  const first = await getFnf(db, input.businessId, input.id);
  if (first.status === "reversed") return { settlement: first, journalEntryId: first.reversalJournalEntryId, created: false, loans: [] };
  if (first.status === "paid") throw badRequest("This settlement has been paid. Reverse the payment first (which puts the money back into the account it left), then reverse the settlement.");
  requireStatus(first, ["posted"], "Reversing");
  await assertPeriodOpen(db, input.businessId, [first.lastWorkingDay]);
  return db.transaction(async (tx) => {
    const s = await lockFnf(tx, input.businessId, input.id);
    if (s.status === "reversed") return { settlement: s, journalEntryId: s.reversalJournalEntryId, created: false, loans: [] };
    if (s.status === "paid") throw badRequest("This settlement has been paid. Reverse the payment first, then reverse the settlement.");
    requireStatus(s, ["posted"], "Reversing");
    // Serialise with the payroll run approval for this employee, like approval does.
    await tx.select({ id: employees.id }).from(employees).where(eq(employees.id, s.employeeId)).for("update");

    let journalEntryId: string | null = null;
    if (s.accrualJournalEntryId) {
      const mirror = await reverseJournalEntry(tx, { businessId: input.businessId, entryId: s.accrualJournalEntryId, narration: `Reversal of full and final settlement ${s.number}: ${input.reason}`, userId: input.actor.id, userName: input.actor.name });
      journalEntryId = mirror.id;
    }
    const loans = await reverseLoanRecoveriesOfFnf(tx, { businessId: input.businessId, settlementId: s.id, date: todayIst(), actor: input.actor });

    // Leave encashed in the settlement comes back to the balance (compensating rows, same leave year as the encashment).
    const encashed: Array<typeof leaveLedger.$inferSelect> = await tx
      .select()
      .from(leaveLedger)
      .where(and(eq(leaveLedger.businessId, input.businessId), eq(leaveLedger.employeeId, s.employeeId), eq(leaveLedger.kind, "encashment"), eq(leaveLedger.periodKey, `fnf:${s.id}`)));
    for (const row of encashed) {
      await tx
        .insert(leaveLedger)
        .values({ businessId: input.businessId, employeeId: s.employeeId, leaveTypeId: row.leaveTypeId, leaveYear: row.leaveYear, entryDate: todayIst(), kind: "adjustment", days: String(Math.abs(Number(row.days))), periodKey: `fnf-reversed:${s.id}`, note: `Full and final ${s.number} reversed: leave encashment put back`, createdByUserId: input.actor.id })
        .onConflictDoNothing();
    }

    const [updated] = await tx
      .update(fnfSettlements)
      .set({ status: "reversed", reversedAt: new Date(), reversedByUserId: input.actor.id, reversedByName: input.actor.name, reversalReason: input.reason, reversalJournalEntryId: journalEntryId, updatedAt: new Date() })
      .where(eq(fnfSettlements.id, s.id))
      .returning();
    return { settlement: updated as FnfRow, journalEntryId, created: true, loans };
  });
}

// ── Reading ──────────────────────────────────────────────────────────────────

export async function listFnf(db: TenantDatabase, businessId: string) {
  const rows = await db
    .select({ s: fnfSettlements, name: employees.name, code: employees.employeeCode })
    .from(fnfSettlements)
    .innerJoin(employees, eq(employees.id, fnfSettlements.employeeId))
    .where(eq(fnfSettlements.businessId, businessId))
    .orderBy(sql`${fnfSettlements.createdAt} DESC`);
  return rows.map((r) => ({ ...r.s, employeeName: r.name, employeeCode: r.code }));
}

export async function fnfDetail(db: TenantDatabase, businessId: string, id: string) {
  const s = await getFnf(db, businessId, id);
  const [emp] = await db.select().from(employees).where(eq(employees.id, s.employeeId)).limit(1);
  const [lines, members, salary] = await Promise.all([
    db.select().from(fnfSettlementLines).where(eq(fnfSettlementLines.settlementId, s.id)).orderBy(asc(fnfSettlementLines.sortOrder)),
    db.select({ n: sql<number>`count(*)::int` }).from(businessMembers).where(eq(businessMembers.businessId, businessId)),
    salaryStatusOf(db, businessId, s.employeeId, s.salaryMonth ?? monthOf(s.lastWorkingDay)),
  ]);
  // The leave types that can be encashed, with the balance and the days chosen, for the edit screen.
  const settings = await loadPayrollSettings(db, businessId);
  const leaveYear = leaveYearOf(s.lastWorkingDay, settings.leaveYearStartMonth);
  const types = await db.select().from(leaveTypes).where(and(eq(leaveTypes.businessId, businessId), eq(leaveTypes.encashable, true), eq(leaveTypes.isActive, true))).orderBy(asc(leaveTypes.code));
  const encashable = [];
  for (const t of types) {
    const balance = await leaveBalance(db, s.employeeId, t.id, leaveYear);
    encashable.push({ leaveTypeId: t.id, code: t.code, name: t.name, balance, maxDays: encashableDays(balance, { encashable: t.encashable, carryForward: t.carryForward, carryForwardMax: Number(t.carryForwardMax) }) });
  }
  return { settlement: s, employee: emp ? { id: emp.id, code: emp.employeeCode, name: emp.name, status: emp.status } : null, lines, salary, encashable, memberCount: members[0]?.n ?? 1 };
}

export async function fnfStatementData(db: TenantDatabase, businessId: string, id: string): Promise<{ data: FnfStatementData; logo: Buffer | null; filename: string }> {
  const s = await getFnf(db, businessId, id);
  if (!s.calculatedAt) throw badRequest("Calculate the settlement first.");
  const [emp] = await db.select().from(employees).where(eq(employees.id, s.employeeId)).limit(1);
  const [biz] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!emp || !biz) throw notFound("Settlement");
  const [lines, desig, dept, salary] = await Promise.all([
    db.select().from(fnfSettlementLines).where(eq(fnfSettlementLines.settlementId, s.id)).orderBy(asc(fnfSettlementLines.sortOrder)),
    emp.designationId ? db.select({ n: payrollDesignations.name }).from(payrollDesignations).where(eq(payrollDesignations.id, emp.designationId)).limit(1) : Promise.resolve([]),
    emp.departmentId ? db.select({ n: payrollDepartments.name }).from(payrollDepartments).where(eq(payrollDepartments.id, emp.departmentId)).limit(1) : Promise.resolve([]),
    salaryStatusOf(db, businessId, s.employeeId, s.salaryMonth ?? monthOf(s.lastWorkingDay)),
  ]);
  const data: FnfStatementData = {
    business: { name: biz.name, legalName: biz.legalName, address: biz.address, city: biz.city, state: biz.state, pincode: biz.pincode, phone: biz.phone, email: biz.email },
    number: s.number,
    status: s.status.replace(/_/g, " "),
    employee: { code: emp.employeeCode, name: emp.name, designation: desig[0]?.n ?? null, department: dept[0]?.n ?? null, dateOfJoining: emp.dateOfJoining, lastWorkingDay: s.lastWorkingDay, exitReason: s.exitReason },
    earnings: lines.filter((l) => l.side === "earning").map((l) => ({ label: l.label, amount: l.amount, detail: l.detail })),
    deductions: lines.filter((l) => l.side === "deduction").map((l) => ({ label: l.label, amount: l.amount, detail: l.detail })),
    gross: s.grossTotal,
    deductionsTotal: s.deductionsTotal,
    net: s.netPayable,
    netWords: amountInWords(Math.max(0, rupeesToPaise(s.netPayable))),
    salaryNote: salary.message,
    warnings: (s.warnings ?? []).map((w) => w.message),
    generatedAt: new Date().toISOString(),
  };
  return { data, logo: biz.logoData ?? null, filename: `full-and-final-${s.number}.pdf` };
}

// The F&F-versus-payroll-run relation, read by the run side: employees whose settlement already exists.
export async function employeesWithSettlement(db: Reader, businessId: string, employeeIds: string[]): Promise<Set<string>> {
  if (employeeIds.length === 0) return new Set();
  const rows = await db.select({ employeeId: fnfSettlements.employeeId }).from(fnfSettlements).where(and(eq(fnfSettlements.businessId, businessId), inArray(fnfSettlements.employeeId, employeeIds), ne(fnfSettlements.status, "reversed")));
  return new Set(rows.map((r) => r.employeeId));
}

