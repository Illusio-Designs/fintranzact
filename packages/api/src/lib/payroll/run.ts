/**
 * The payroll run engine: create, lock attendance, calculate, submit, approve,
 * reopen, post to the books and mark paid. The arithmetic is in
 * @fintranzact/shared (payroll-calc.ts); this file loads the data, applies the
 * status machine and writes the results.
 *
 * Status machine (docs/architecture/payroll.md):
 *   draft -> attendance_locked -> calculated -> pending_approval -> approved -> posted -> paid
 * Before approval a run can be reopened to draft (its lines are discarded);
 * recalculating is allowed from locked, calculated and pending approval. An
 * approved run is final: its lines, payslips and bank details never change.
 *
 * Maker-checker: whoever last calculated the run cannot approve it, unless the
 * business has a single user.
 */

import { and, asc, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  attendanceRecords,
  bankAccounts,
  bankTransactions,
  businessMembers,
  businesses,
  employeeSalaryAssignments,
  employees,
  leaveEncashments,
  leaveTypes,
  payrollDepartments,
  payrollDesignations,
  payrollRunAdjustments,
  payrollRunLines,
  payrollRuns,
  payrollShifts,
  payslips,
  type TenantDatabase,
} from "@fintranzact/db";
import {
  approverAllowed,
  buildPostingTotals,
  canTransitionRun,
  computePayrollLine,
  daysInMonth,
  formatPayrollMonth,
  istDateParts,
  isRunEditable,
  MAKER_CHECKER_MESSAGE,
  maskSensitive,
  monthEnd,
  monthStart,
  paiseToRupees,
  payslipNumber,
  rupeesToPaise,
  sumRunTotals,
  summarizeAttendance,
  type AssignedComponent,
  type ComponentCategory,
  type ComponentType,
  type DayRecord,
  type PayrollRunStatus,
  type PayrollWarning,
  type PayrollLineResult,
  type StatutoryKind,
} from "@fintranzact/shared";
import { amountInWords } from "../invoice-templates/model.js";
import { assertPeriodOpen } from "../period-lock.js";
import { bookDate, cashOrBankAccountId, ensurePayrollAccounts, writeJournalEntry, type PayrollAccountKey } from "./books.js";
import { holidayDatesFor, loadHolidays, loadMonthAttendance, loadPayrollSettings, type PayrollSettingsValues } from "./data.js";
import { badRequest, isUniqueViolation, notFound } from "./access.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

export interface Actor {
  id: string;
  name: string | null;
}

type RunRow = typeof payrollRuns.$inferSelect;
type EmployeeRow = typeof employees.$inferSelect;

// ── Loading ───────────────────────────────────────────────────────────────────

export async function getRun(db: Pick<TenantDatabase, "select">, businessId: string, runId: string): Promise<RunRow> {
  const [run] = await db.select().from(payrollRuns).where(and(eq(payrollRuns.id, runId), eq(payrollRuns.businessId, businessId))).limit(1);
  if (!run) throw notFound("Payroll run");
  return run;
}

/** Lock the run row for the rest of the transaction and return it. */
async function lockRun(tx: Tx, businessId: string, runId: string): Promise<RunRow> {
  const [run] = await tx
    .select()
    .from(payrollRuns)
    .where(and(eq(payrollRuns.id, runId), eq(payrollRuns.businessId, businessId)))
    .for("update")
    .limit(1);
  if (!run) throw notFound("Payroll run");
  return run as RunRow;
}

function requireStatus(run: RunRow, allowed: PayrollRunStatus[], what: string) {
  if (!allowed.includes(run.status as PayrollRunStatus)) {
    throw badRequest(`${what} is not possible while the run is "${run.status.replace(/_/g, " ")}".`);
  }
}

/** Employees whose employment overlaps the month. */
async function eligibleEmployees(tx: Tx, businessId: string, month: string): Promise<EmployeeRow[]> {
  return tx
    .select()
    .from(employees)
    .where(
      and(
        eq(employees.businessId, businessId),
        lte(employees.dateOfJoining, monthEnd(month)),
        sql`(${employees.lastWorkingDay} IS NULL OR ${employees.lastWorkingDay} >= ${monthStart(month)})`,
      ),
    )
    .orderBy(asc(employees.employeeCode));
}

interface MonthContext {
  settings: PayrollSettingsValues;
  employees: EmployeeRow[];
  weeklyOffs: Map<string, number[]>;
  holidays: Map<string, Set<string>>;
  records: Map<string, Map<string, DayRecord>>;
  recordRows: Map<string, Set<string>>;
}

async function loadMonthContext(tx: Tx, businessId: string, month: string): Promise<MonthContext> {
  const settings = await loadPayrollSettings(tx, businessId);
  const emps = await eligibleEmployees(tx, businessId, month);
  const shifts = await tx.select().from(payrollShifts).where(eq(payrollShifts.businessId, businessId));
  const shiftOffs = new Map<string, number[]>(shifts.map((s: typeof payrollShifts.$inferSelect) => [s.id, s.weeklyOffDays]));
  const holidayRows = await loadHolidays(tx, businessId, monthStart(month), monthEnd(month));
  const types = await tx.select({ id: leaveTypes.id, isPaid: leaveTypes.isPaid }).from(leaveTypes).where(eq(leaveTypes.businessId, businessId));
  const paid = new Map<string, boolean>(types.map((t: { id: string; isPaid: boolean }) => [t.id, t.isPaid]));
  const rows = await loadMonthAttendance(tx, businessId, month);

  const weeklyOffs = new Map<string, number[]>();
  const holidays = new Map<string, Set<string>>();
  for (const e of emps) {
    weeklyOffs.set(e.id, (e.shiftId && shiftOffs.get(e.shiftId)) || settings.defaultWeeklyOffDays);
    holidays.set(e.id, holidayDatesFor(holidayRows, e));
  }
  const records = new Map<string, Map<string, DayRecord>>();
  const recordRows = new Map<string, Set<string>>();
  for (const r of rows) {
    const m = records.get(r.employeeId) ?? new Map<string, DayRecord>();
    m.set(r.date, {
      status: r.status as DayRecord["status"],
      leavePaid: r.leaveTypeId ? paid.get(r.leaveTypeId) ?? true : false,
      overtimeHours: Number(r.overtimeHours),
    });
    records.set(r.employeeId, m);
    const s = recordRows.get(r.employeeId) ?? new Set<string>();
    s.add(r.date);
    recordRows.set(r.employeeId, s);
  }
  return { settings, employees: emps, weeklyOffs, holidays, records, recordRows };
}

function summaryFor(ctx: MonthContext, emp: EmployeeRow, month: string, unmarkedAs?: "present" | "absent") {
  return summarizeAttendance({
    month,
    joiningDate: emp.dateOfJoining,
    lastWorkingDay: emp.lastWorkingDay,
    weeklyOffDays: ctx.weeklyOffs.get(emp.id) ?? ctx.settings.defaultWeeklyOffDays,
    holidays: ctx.holidays.get(emp.id) ?? new Set(),
    records: ctx.records.get(emp.id) ?? new Map(),
    unmarkedAs,
  });
}

/** Per employee: the month's attendance summary (for the attendance and payroll screens). */
export async function attendanceSummaries(db: TenantDatabase, businessId: string, month: string) {
  const ctx = await loadMonthContext(db, businessId, month);
  return ctx.employees.map((e) => ({
    employee: e,
    summary: summaryFor(ctx, e, month),
    weeklyOffDays: ctx.weeklyOffs.get(e.id) ?? ctx.settings.defaultWeeklyOffDays,
    holidayDates: [...(ctx.holidays.get(e.id) ?? [])].sort(),
  }));
}

// ── Create, lock, calculate ───────────────────────────────────────────────────

export async function createRun(db: TenantDatabase, input: { businessId: string; month: string; actor: Actor }): Promise<RunRow> {
  const now = istDateParts(new Date());
  const current = `${now.year}-${String(now.month).padStart(2, "0")}`;
  if (input.month > current) throw badRequest(`${formatPayrollMonth(input.month)} has not started yet. Payroll can be run for the current month and earlier months.`);
  const [existing] = await db
    .select({ id: payrollRuns.id })
    .from(payrollRuns)
    .where(and(eq(payrollRuns.businessId, input.businessId), eq(payrollRuns.month, input.month)))
    .limit(1);
  if (existing) throw new TRPCError({ code: "CONFLICT", message: `There is already a payroll run for ${formatPayrollMonth(input.month)}.` });
  try {
    const [run] = await db
      .insert(payrollRuns)
      .values({ businessId: input.businessId, month: input.month, daysInMonth: daysInMonth(input.month), createdByUserId: input.actor.id, createdByName: input.actor.name })
      .returning();
    return run!;
  } catch (e) {
    // Two requests at once: the unique (business, month) index picks one.
    if (isUniqueViolation(e)) throw new TRPCError({ code: "CONFLICT", message: `There is already a payroll run for ${formatPayrollMonth(input.month)}.` });
    throw e;
  }
}

export interface LockResult {
  run: RunRow;
  filled: number;
}

/**
 * Lock the month's attendance. Every working day of every employee must have a
 * record; otherwise `fillUnmarked` says how the gaps are filled ("present" or
 * "absent"), and without it the lock is refused with the list of what is missing.
 */
export async function lockAttendance(
  db: TenantDatabase,
  input: { businessId: string; runId: string; fillUnmarked?: "present" | "absent"; actor: Actor },
): Promise<LockResult> {
  return db.transaction(async (tx) => {
    const run = await lockRun(tx, input.businessId, input.runId);
    requireStatus(run, ["draft"], "Locking attendance");
    const ctx = await loadMonthContext(tx, input.businessId, run.month);
    if (ctx.employees.length === 0) throw badRequest(`No employee was employed in ${formatPayrollMonth(run.month)}. Add employees first.`);

    const gaps: Array<{ employee: EmployeeRow; dates: string[] }> = [];
    for (const e of ctx.employees) {
      const s = summaryFor(ctx, e, run.month);
      if (s.unmarkedDates.length) gaps.push({ employee: e, dates: s.unmarkedDates });
    }
    let filled = 0;
    if (gaps.length) {
      if (!input.fillUnmarked) {
        const days = gaps.reduce((n, g) => n + g.dates.length, 0);
        throw badRequest(
          `${gaps.length} employee${gaps.length === 1 ? " has" : "s have"} ${days} working day${days === 1 ? "" : "s"} with no attendance (${gaps
            .slice(0, 3)
            .map((g) => g.employee.name)
            .join(", ")}${gaps.length > 3 ? "..." : ""}). Mark them, or lock with the missing days counted as present or absent.`,
        );
      }
      for (const g of gaps) {
        await tx
          .insert(attendanceRecords)
          .values(
            g.dates.map((date) => ({
              businessId: input.businessId,
              employeeId: g.employee.id,
              date,
              status: input.fillUnmarked!,
              source: "lock",
              markedByUserId: input.actor.id,
            })),
          )
          .onConflictDoNothing();
        filled += g.dates.length;
      }
    }
    const [updated] = await tx
      .update(payrollRuns)
      .set({ status: "attendance_locked", attendanceLockedAt: new Date(), attendanceLockedByUserId: input.actor.id, updatedAt: new Date() })
      .where(eq(payrollRuns.id, run.id))
      .returning();
    return { run: updated!, filled };
  });
}

type ComponentJson = (typeof payrollRunLines.$inferInsert)["components"];

function componentsToJson(result: PayrollLineResult): ComponentJson {
  return result.components.map((c) => ({
    componentId: c.componentId ?? null,
    code: c.code,
    name: c.name,
    type: c.type,
    category: c.category,
    isWage: c.isWage,
    statutoryKind: c.statutoryKind ?? null,
    source: c.source,
    full: paiseToRupees(c.fullPaise),
    amount: paiseToRupees(c.amountPaise),
  }));
}

/** Recalculate the whole run from the locked attendance, the salary assignments and the run's adjustments. */
export async function calculateRun(
  db: TenantDatabase,
  input: { businessId: string; runId: string; actor: Actor },
): Promise<{ run: RunRow; warnings: Array<PayrollWarning & { employeeId?: string }> }> {
  return db.transaction(async (tx) => {
    const run = await lockRun(tx, input.businessId, input.runId);
    requireStatus(run, ["attendance_locked", "calculated", "pending_approval"], "Calculating");
    const month = run.month;
    const dim = daysInMonth(month);
    const ctx = await loadMonthContext(tx, input.businessId, month);

    const [deptRows, desigRows] = await Promise.all([
      tx.select().from(payrollDepartments).where(eq(payrollDepartments.businessId, input.businessId)),
      tx.select().from(payrollDesignations).where(eq(payrollDesignations.businessId, input.businessId)),
    ]);
    const deptName = new Map<string, string>(deptRows.map((d: { id: string; name: string }) => [d.id, d.name]));
    const desigName = new Map<string, string>(desigRows.map((d: { id: string; name: string }) => [d.id, d.name]));

    const empIds = ctx.employees.map((e) => e.id);
    const assignments: Array<typeof employeeSalaryAssignments.$inferSelect> = empIds.length
      ? await tx
          .select()
          .from(employeeSalaryAssignments)
          .where(and(eq(employeeSalaryAssignments.businessId, input.businessId), inArray(employeeSalaryAssignments.employeeId, empIds), lte(employeeSalaryAssignments.effectiveFrom, monthEnd(month))))
          .orderBy(desc(employeeSalaryAssignments.effectiveFrom), desc(employeeSalaryAssignments.createdAt))
      : [];
    const latest = new Map<string, typeof employeeSalaryAssignments.$inferSelect>();
    for (const a of assignments) if (!latest.has(a.employeeId)) latest.set(a.employeeId, a);

    const adjustments: Array<typeof payrollRunAdjustments.$inferSelect> = await tx.select().from(payrollRunAdjustments).where(eq(payrollRunAdjustments.runId, run.id));

    // Encashments: release this run's, then take every unattached one for the employees in the run.
    await tx.update(leaveEncashments).set({ payrollRunId: null }).where(eq(leaveEncashments.payrollRunId, run.id));
    const encashments: Array<typeof leaveEncashments.$inferSelect> = empIds.length
      ? await tx.select().from(leaveEncashments).where(and(eq(leaveEncashments.businessId, input.businessId), isNull(leaveEncashments.payrollRunId), inArray(leaveEncashments.employeeId, empIds)))
      : [];

    const warnings: Array<PayrollWarning & { employeeId?: string }> = [];
    const lines: Array<typeof payrollRunLines.$inferInsert & { _result: PayrollLineResult }> = [];

    for (const emp of ctx.employees) {
      const assignment = latest.get(emp.id);
      if (!assignment) {
        warnings.push({ code: "no_salary_structure", message: `${emp.name} (${emp.employeeCode}) has no salary structure effective by ${formatPayrollMonth(month)} and was left out of this run.`, employeeId: emp.id });
        continue;
      }
      const summary = summaryFor(ctx, emp, month);
      if (summary.unmarkedDates.length) {
        warnings.push({ code: "unmarked_days", message: `${emp.name} has ${summary.unmarkedDates.length} day(s) with no attendance; they were counted as loss of pay.`, employeeId: emp.id });
      }
      const components: AssignedComponent[] = assignment.breakdown.map((b) => ({
        componentId: b.componentId ?? undefined,
        code: b.code,
        name: b.name,
        type: b.type as ComponentType,
        category: b.category as ComponentCategory,
        isWage: b.isWage,
        prorate: b.prorate,
        statutoryKind: (b.statutoryKind as StatutoryKind | null) ?? null,
        monthlyPaise: rupeesToPaise(b.monthly),
      }));
      const adj = adjustments
        .filter((a) => a.employeeId === emp.id)
        .map((a) => ({ id: a.id, name: a.name, type: a.type as "earning" | "deduction", amountPaise: rupeesToPaise(a.amount) }));
      for (const en of encashments.filter((x) => x.employeeId === emp.id)) {
        adj.push({ id: en.id, name: "Leave encashment", type: "earning", amountPaise: rupeesToPaise(en.amount) });
      }
      const result = computePayrollLine({
        components,
        daysInMonth: dim,
        employedDays: summary.employedDays,
        paidDays: summary.paidDays,
        lopDays: summary.lopDays,
        overtimeHours: summary.overtimeHours,
        overtimeMultiplier: ctx.settings.overtimeMultiplier,
        standardHoursPerDay: ctx.settings.standardHoursPerDay,
        adjustments: adj,
      });
      for (const w of result.warnings) warnings.push({ ...w, message: `${emp.name}: ${w.message}`, employeeId: emp.id });
      const finalSettlement = !!emp.lastWorkingDay && emp.lastWorkingDay >= monthStart(month) && emp.lastWorkingDay <= monthEnd(month);
      lines.push({
        runId: run.id,
        businessId: input.businessId,
        employeeId: emp.id,
        employeeCode: emp.employeeCode,
        employeeName: emp.name,
        department: emp.departmentId ? deptName.get(emp.departmentId) ?? null : null,
        designation: emp.designationId ? desigName.get(emp.designationId) ?? null : null,
        daysInMonth: dim,
        employedDays: summary.employedDays,
        paidDays: summary.paidDays.toFixed(1),
        lopDays: summary.lopDays.toFixed(1),
        overtimeHours: summary.overtimeHours.toFixed(2),
        components: componentsToJson(result),
        grossEarnings: paiseToRupees(result.grossPaise),
        totalDeductions: paiseToRupees(result.deductionsPaise),
        employerContributions: paiseToRupees(result.employerPaise),
        netPay: paiseToRupees(result.netPaise),
        warnings: result.warnings.map((w) => ({ code: w.code, message: w.message })),
        isFinalSettlement: finalSettlement,
        _result: result,
      });
    }

    await tx.delete(payrollRunLines).where(eq(payrollRunLines.runId, run.id));
    if (lines.length) {
      await tx.insert(payrollRunLines).values(lines.map(({ _result, ...row }) => { void _result; return row; }));
    }
    const used = encashments.filter((en) => lines.some((l) => l.employeeId === en.employeeId));
    if (used.length) await tx.update(leaveEncashments).set({ payrollRunId: run.id }).where(inArray(leaveEncashments.id, used.map((u) => u.id)));

    const totals = sumRunTotals(lines.map((l) => ({
      grossPaise: l._result.grossPaise,
      deductionsPaise: l._result.deductionsPaise,
      employerPaise: l._result.employerPaise,
      netPaise: l._result.netPaise,
    })));
    const [updated] = await tx
      .update(payrollRuns)
      .set({
        status: "calculated",
        employeeCount: totals.employees,
        grossTotal: paiseToRupees(totals.grossPaise),
        deductionsTotal: paiseToRupees(totals.deductionsPaise),
        employerTotal: paiseToRupees(totals.employerPaise),
        netTotal: paiseToRupees(totals.netPaise),
        warnings,
        calculatedAt: new Date(),
        calculatedByUserId: input.actor.id,
        calculatedByName: input.actor.name,
        submittedAt: null,
        submittedByUserId: null,
        updatedAt: new Date(),
      })
      .where(eq(payrollRuns.id, run.id))
      .returning();
    return { run: updated!, warnings };
  });
}

// ── Adjustments ───────────────────────────────────────────────────────────────

export async function addAdjustment(
  db: TenantDatabase,
  input: { businessId: string; runId: string; employeeId: string; name: string; type: "earning" | "deduction"; amountPaise: number; note?: string | null; actor: Actor },
) {
  return db.transaction(async (tx) => {
    const run = await lockRun(tx, input.businessId, input.runId);
    requireStatus(run, ["draft", "attendance_locked", "calculated", "pending_approval"], "Adding an adjustment");
    const [emp] = await tx.select({ id: employees.id }).from(employees).where(and(eq(employees.id, input.employeeId), eq(employees.businessId, input.businessId))).limit(1);
    if (!emp) throw notFound("Employee");
    const [row] = await tx
      .insert(payrollRunAdjustments)
      .values({
        businessId: input.businessId,
        runId: run.id,
        employeeId: input.employeeId,
        name: input.name,
        type: input.type,
        amount: paiseToRupees(input.amountPaise),
        note: input.note ?? null,
        createdByUserId: input.actor.id,
      })
      .returning();
    // A calculated run is stale now: it must be calculated again before it can be approved.
    if (run.status === "pending_approval") {
      await tx.update(payrollRuns).set({ status: "calculated", submittedAt: null, submittedByUserId: null, updatedAt: new Date() }).where(eq(payrollRuns.id, run.id));
    }
    return row!;
  });
}

export async function removeAdjustment(db: TenantDatabase, input: { businessId: string; runId: string; adjustmentId: string }) {
  return db.transaction(async (tx) => {
    const run = await lockRun(tx, input.businessId, input.runId);
    requireStatus(run, ["draft", "attendance_locked", "calculated", "pending_approval"], "Removing an adjustment");
    const deleted = await tx
      .delete(payrollRunAdjustments)
      .where(and(eq(payrollRunAdjustments.id, input.adjustmentId), eq(payrollRunAdjustments.runId, run.id), eq(payrollRunAdjustments.businessId, input.businessId)))
      .returning({ id: payrollRunAdjustments.id });
    if (deleted.length === 0) throw notFound("Adjustment");
    if (run.status === "pending_approval") {
      await tx.update(payrollRuns).set({ status: "calculated", submittedAt: null, submittedByUserId: null, updatedAt: new Date() }).where(eq(payrollRuns.id, run.id));
    }
    return { removed: true };
  });
}

// ── Submit, approve, reopen, delete ───────────────────────────────────────────

export async function submitRun(db: TenantDatabase, input: { businessId: string; runId: string; actor: Actor }): Promise<RunRow> {
  return db.transaction(async (tx) => {
    const run = await lockRun(tx, input.businessId, input.runId);
    requireStatus(run, ["calculated"], "Submitting for approval");
    const lines = await tx.select().from(payrollRunLines).where(eq(payrollRunLines.runId, run.id));
    if (lines.length === 0) throw badRequest("The run has no employee lines. Calculate it after adding salary structures.");
    const negative = lines.filter((l: typeof payrollRunLines.$inferSelect) => rupeesToPaise(l.netPay) < 0);
    if (negative.length) {
      throw badRequest(`Net pay is below zero for ${negative.map((l: typeof payrollRunLines.$inferSelect) => l.employeeName).join(", ")}. Reduce a deduction and calculate again.`);
    }
    const [updated] = await tx
      .update(payrollRuns)
      .set({ status: "pending_approval", submittedAt: new Date(), submittedByUserId: input.actor.id, updatedAt: new Date() })
      .where(eq(payrollRuns.id, run.id))
      .returning();
    return updated!;
  });
}

export interface PayslipSnapshot {
  business: { name: string; legalName: string | null; address: string | null; city: string | null; state: string | null; pincode: string | null; phone: string | null; email: string | null; pan: string | null };
  month: string;
  monthLabel: string;
  number: string;
  employee: {
    code: string;
    name: string;
    department: string | null;
    designation: string | null;
    branch: string | null;
    employmentType: string;
    dateOfJoining: string;
    lastWorkingDay: string | null;
    panMasked: string | null;
    uanMasked: string | null;
    esicMasked: string | null;
    bankAccountMasked: string | null;
    bankName: string | null;
  };
  attendance: { daysInMonth: number; employedDays: number; paidDays: string; lopDays: string; overtimeHours: string };
  earnings: Array<{ name: string; full: string; amount: string }>;
  deductions: Array<{ name: string; amount: string }>;
  grossEarnings: string;
  totalDeductions: string;
  netPay: string;
  netPayWords: string;
  finalSettlement: boolean;
  generatedAt: string;
}

/** The payslip data for one line: business header, employee (masked identity numbers), amounts, net pay in words. */
export function buildPayslipSnapshot(input: {
  business: typeof businesses.$inferSelect;
  month: string;
  line: typeof payrollRunLines.$inferSelect;
  employee: EmployeeRow;
}): PayslipSnapshot {
  const { business: biz, line: l, employee: e } = input;
  const earnings = l.components.filter((c) => c.type === "earning" && rupeesToPaise(c.amount) > 0).map((c) => ({ name: c.name, full: c.full, amount: c.amount }));
  const deductions = l.components.filter((c) => c.type === "deduction" && rupeesToPaise(c.amount) > 0).map((c) => ({ name: c.name, amount: c.amount }));
  return {
    business: { name: biz.name, legalName: biz.legalName, address: biz.address, city: biz.city, state: biz.state, pincode: biz.pincode, phone: biz.phone, email: biz.email, pan: biz.pan },
    month: input.month,
    monthLabel: formatPayrollMonth(input.month),
    number: payslipNumber(input.month, l.employeeCode),
    employee: {
      code: l.employeeCode,
      name: l.employeeName,
      department: l.department,
      designation: l.designation,
      branch: e.branch,
      employmentType: e.employmentType,
      dateOfJoining: e.dateOfJoining,
      lastWorkingDay: e.lastWorkingDay,
      panMasked: maskSensitive(e.pan),
      uanMasked: maskSensitive(e.uan),
      esicMasked: maskSensitive(e.esicNumber),
      bankAccountMasked: maskSensitive(e.bankAccountNumber),
      bankName: e.bankName,
    },
    attendance: { daysInMonth: l.daysInMonth, employedDays: l.employedDays, paidDays: l.paidDays, lopDays: l.lopDays, overtimeHours: l.overtimeHours },
    earnings,
    deductions,
    grossEarnings: l.grossEarnings,
    totalDeductions: l.totalDeductions,
    netPay: l.netPay,
    netPayWords: amountInWords(rupeesToPaise(l.netPay)),
    finalSettlement: l.isFinalSettlement,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Approve the run (maker-checker). Freezes everything: the bank details go
 * onto the lines for the payment file and a payslip snapshot is stored per
 * employee. After this nothing in the run changes.
 */
export async function approveRun(db: TenantDatabase, input: { businessId: string; runId: string; actor: Actor }): Promise<RunRow> {
  return db.transaction(async (tx) => {
    const run = await lockRun(tx, input.businessId, input.runId);
    requireStatus(run, ["pending_approval"], "Approving");

    const [members] = await tx.select({ n: sql<number>`count(*)::int` }).from(businessMembers).where(eq(businessMembers.businessId, input.businessId));
    if (!approverAllowed({ approverUserId: input.actor.id, calculatedByUserId: run.calculatedByUserId, businessMemberCount: members?.n ?? 1 })) {
      throw new TRPCError({ code: "FORBIDDEN", message: MAKER_CHECKER_MESSAGE });
    }

    const lines: Array<typeof payrollRunLines.$inferSelect> = await tx.select().from(payrollRunLines).where(eq(payrollRunLines.runId, run.id)).orderBy(asc(payrollRunLines.employeeCode));
    if (lines.length === 0) throw badRequest("The run has no employee lines.");
    if (lines.some((l) => rupeesToPaise(l.netPay) < 0)) throw badRequest("A line has negative net pay. Fix it and calculate again.");
    // The totals must still be the sum of the lines (nothing edited them behind the run's back).
    const sums = sumRunTotals(lines.map((l) => ({
      grossPaise: rupeesToPaise(l.grossEarnings),
      deductionsPaise: rupeesToPaise(l.totalDeductions),
      employerPaise: rupeesToPaise(l.employerContributions),
      netPaise: rupeesToPaise(l.netPay),
    })));
    if (paiseToRupees(sums.netPaise) !== run.netTotal || paiseToRupees(sums.grossPaise) !== run.grossTotal) {
      throw badRequest("The run's totals no longer match its lines. Calculate it again before approving.");
    }

    const [biz] = await tx.select().from(businesses).where(eq(businesses.id, input.businessId)).limit(1);
    const emps: EmployeeRow[] = await tx.select().from(employees).where(and(eq(employees.businessId, input.businessId), inArray(employees.id, lines.map((l) => l.employeeId))));
    const empById = new Map(emps.map((e) => [e.id, e]));

    for (const l of lines) {
      const e = empById.get(l.employeeId)!;
      const snapshot = buildPayslipSnapshot({ business: biz!, month: run.month, line: l, employee: e });
      await tx.insert(payslips).values({
        businessId: input.businessId,
        runId: run.id,
        lineId: l.id,
        employeeId: l.employeeId,
        month: run.month,
        number: snapshot.number,
        snapshot: snapshot as unknown as Record<string, unknown>,
      });
      await tx
        .update(payrollRunLines)
        .set({ bankAccountNumber: e.bankAccountNumber, bankIfsc: e.bankIfsc, bankAccountName: e.bankAccountName || e.name })
        .where(eq(payrollRunLines.id, l.id));
      if (l.isFinalSettlement) await tx.update(employees).set({ fnfPayrollRunId: run.id, updatedAt: new Date() }).where(eq(employees.id, l.employeeId));
    }

    const [updated] = await tx
      .update(payrollRuns)
      .set({ status: "approved", approvedAt: new Date(), approvedByUserId: input.actor.id, approvedByName: input.actor.name, updatedAt: new Date() })
      .where(eq(payrollRuns.id, run.id))
      .returning();
    return updated!;
  });
}

/** Back to draft, before approval only. The calculated lines are discarded; adjustments and attendance stay. */
export async function reopenRun(db: TenantDatabase, input: { businessId: string; runId: string }): Promise<RunRow> {
  return db.transaction(async (tx) => {
    const run = await lockRun(tx, input.businessId, input.runId);
    if (!isRunEditable(run.status as PayrollRunStatus) || !canTransitionRun(run.status as PayrollRunStatus, "draft")) {
      throw badRequest(run.status === "draft" ? "The run is already a draft." : "An approved payroll run cannot be reopened. Its payslips are final.");
    }
    await tx.delete(payrollRunLines).where(eq(payrollRunLines.runId, run.id));
    await tx.update(leaveEncashments).set({ payrollRunId: null }).where(eq(leaveEncashments.payrollRunId, run.id));
    const [updated] = await tx
      .update(payrollRuns)
      .set({
        status: "draft",
        employeeCount: 0,
        grossTotal: "0",
        deductionsTotal: "0",
        employerTotal: "0",
        netTotal: "0",
        warnings: [],
        attendanceLockedAt: null,
        attendanceLockedByUserId: null,
        calculatedAt: null,
        calculatedByUserId: null,
        calculatedByName: null,
        submittedAt: null,
        submittedByUserId: null,
        updatedAt: new Date(),
      })
      .where(eq(payrollRuns.id, run.id))
      .returning();
    return updated!;
  });
}

export async function deleteRun(db: TenantDatabase, input: { businessId: string; runId: string }) {
  return db.transaction(async (tx) => {
    const run = await lockRun(tx, input.businessId, input.runId);
    requireStatus(run, ["draft"], "Deleting");
    await tx.update(leaveEncashments).set({ payrollRunId: null }).where(eq(leaveEncashments.payrollRunId, run.id));
    await tx.delete(payrollRuns).where(eq(payrollRuns.id, run.id));
    return { deleted: true };
  });
}

// ── Posting to the books and paying ───────────────────────────────────────────

export interface PostResult {
  run: RunRow;
  journalEntryId: string;
  /** False when the run was already posted (a repeated call changes nothing). */
  created: boolean;
}

/** Post an approved run: one balanced journal entry, once. A second call returns the same entry. */
export async function postRun(db: TenantDatabase, input: { businessId: string; runId: string; actor: Actor }): Promise<PostResult> {
  const first = await getRun(db, input.businessId, input.runId);
  if (first.accrualJournalEntryId) return { run: first, journalEntryId: first.accrualJournalEntryId, created: false };
  requireStatus(first, ["approved"], "Posting to the books");
  const entryDate = monthEnd(first.month);
  await assertPeriodOpen(db, input.businessId, [entryDate]);

  return db.transaction(async (tx) => {
    const run = await lockRun(tx, input.businessId, input.runId);
    if (run.accrualJournalEntryId) return { run, journalEntryId: run.accrualJournalEntryId, created: false };
    requireStatus(run, ["approved"], "Posting to the books");

    const lines = await tx.select().from(payrollRunLines).where(eq(payrollRunLines.runId, run.id));
    const totals = buildPostingTotals(
      lines.map((l: typeof payrollRunLines.$inferSelect) => ({
        netPaise: rupeesToPaise(l.netPay),
        components: l.components.map((c) => ({ type: c.type as ComponentType, category: c.category as ComponentCategory, amountPaise: rupeesToPaise(c.amount) })),
      })),
    );
    const keys = new Set<PayrollAccountKey>();
    for (const [group, paise] of Object.entries(totals.expense)) if (paise > 0) keys.add(group as PayrollAccountKey);
    if (totals.netPayablePaise > 0) keys.add("salaries_payable");
    if (totals.deductionsPayablePaise > 0) keys.add("deductions_payable");
    if (totals.employerPayablePaise > 0) keys.add("employer_payable");
    if (keys.size === 0) throw badRequest("There is nothing to post: every employee's pay is zero.");
    const acc = await ensurePayrollAccounts(tx, input.businessId, [...keys]);

    const label = formatPayrollMonth(run.month);
    const jl: Parameters<typeof writeJournalEntry>[1]["lines"] = [];
    for (const [group, paise] of Object.entries(totals.expense)) {
      if (paise > 0) jl.push({ accountId: acc[group]!, debitPaise: paise, creditPaise: 0, narration: `Payroll ${label}` });
    }
    if (totals.netPayablePaise > 0) jl.push({ accountId: acc.salaries_payable!, debitPaise: 0, creditPaise: totals.netPayablePaise, narration: `Net salaries payable ${label}` });
    if (totals.deductionsPayablePaise > 0) jl.push({ accountId: acc.deductions_payable!, debitPaise: 0, creditPaise: totals.deductionsPayablePaise, narration: `Deductions held ${label}` });
    if (totals.employerPayablePaise > 0) jl.push({ accountId: acc.employer_payable!, debitPaise: 0, creditPaise: totals.employerPayablePaise, narration: `Employer contributions ${label}` });

    const entry = await writeJournalEntry(tx, {
      businessId: input.businessId,
      entryDate: bookDate(entryDate),
      narration: `Payroll for ${label}`,
      userId: input.actor.id,
      userName: input.actor.name,
      lines: jl,
    });
    const [updated] = await tx
      .update(payrollRuns)
      .set({ status: "posted", postedAt: new Date(), postedByUserId: input.actor.id, accrualJournalEntryId: entry.id, updatedAt: new Date() })
      .where(eq(payrollRuns.id, run.id))
      .returning();
    return { run: updated!, journalEntryId: entry.id, created: true };
  });
}

export interface PaidResult {
  run: RunRow;
  journalEntryId: string | null;
  created: boolean;
}

/**
 * Record the salary payment: Dr Salaries Payable / Cr cash or bank, and a
 * withdrawal on the chosen bank or cash account. Once; a repeat changes nothing.
 */
export async function markRunPaid(
  db: TenantDatabase,
  input: { businessId: string; runId: string; bankAccountId: string; paidOn: string; reference?: string | null; actor: Actor },
): Promise<PaidResult> {
  const first = await getRun(db, input.businessId, input.runId);
  if (first.status === "paid") return { run: first, journalEntryId: first.paymentJournalEntryId, created: false };
  requireStatus(first, ["posted"], "Marking as paid");
  await assertPeriodOpen(db, input.businessId, [input.paidOn]);

  return db.transaction(async (tx) => {
    const run = await lockRun(tx, input.businessId, input.runId);
    if (run.status === "paid") return { run, journalEntryId: run.paymentJournalEntryId, created: false };
    requireStatus(run, ["posted"], "Marking as paid");

    const [account] = await tx
      .select()
      .from(bankAccounts)
      .where(and(eq(bankAccounts.id, input.bankAccountId), eq(bankAccounts.businessId, input.businessId)))
      .for("update")
      .limit(1);
    if (!account) throw notFound("Bank or cash account");

    const netPaise = rupeesToPaise(run.netTotal);
    let journalEntryId: string | null = null;
    if (netPaise > 0) {
      const acc = await ensurePayrollAccounts(tx, input.businessId, ["salaries_payable"]);
      const payFrom = await cashOrBankAccountId(tx, input.businessId, account.accountType);
      const label = formatPayrollMonth(run.month);
      const entry = await writeJournalEntry(tx, {
        businessId: input.businessId,
        entryDate: bookDate(input.paidOn),
        narration: `Salaries paid for ${label}`,
        userId: input.actor.id,
        userName: input.actor.name,
        lines: [
          { accountId: acc.salaries_payable!, debitPaise: netPaise, creditPaise: 0, narration: `Salaries paid ${label}` },
          { accountId: payFrom, debitPaise: 0, creditPaise: netPaise, narration: `Salaries paid ${label} from ${account.accountName}` },
        ],
      });
      journalEntryId = entry.id;
      await tx.insert(bankTransactions).values({
        businessId: input.businessId,
        bankAccountId: account.id,
        type: "withdrawal",
        amount: paiseToRupees(netPaise),
        description: `Salaries for ${label}`,
        referenceType: "payroll_run",
        referenceId: run.id,
        transactionDate: bookDate(input.paidOn),
      });
      await tx
        .update(bankAccounts)
        .set({ currentBalance: paiseToRupees(rupeesToPaise(account.currentBalance) - netPaise), updatedAt: new Date() })
        .where(eq(bankAccounts.id, account.id));
    }
    const [updated] = await tx
      .update(payrollRuns)
      .set({
        status: "paid",
        paidAt: new Date(),
        paidOn: input.paidOn,
        paidByUserId: input.actor.id,
        paidFromBankAccountId: account.id,
        paidReference: input.reference ?? null,
        paymentJournalEntryId: journalEntryId,
        updatedAt: new Date(),
      })
      .where(eq(payrollRuns.id, run.id))
      .returning();
    return { run: updated!, journalEntryId, created: true };
  });
}
