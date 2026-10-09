/**
 * Payroll data helpers shared by the routers and the run engine: settings,
 * weekly offs and holidays per employee, the attendance lock check, and the
 * employee views (what a list or a detail screen may show).
 *
 * Identity and bank numbers: lists and every other view show them masked. Only
 * `employeeDetail(row, { full: true })` returns them in full, and the router
 * only asks for that when the caller holds Payroll "manage". They are never
 * written to logs or to the audit trail (audit metadata carries ids and the
 * NAMES of changed fields only).
 */

import { and, between, eq, ne, gte, lte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  attendanceRecords,
  employees,
  payrollHolidays,
  payrollRuns,
  payrollSettings,
  type TenantDatabase,
} from "@fintranzact/db";
import { formatPayrollMonth, maskSensitive, monthEnd, monthOf, monthStart } from "@fintranzact/shared";

export interface PayrollSettingsValues {
  defaultWeeklyOffDays: number[];
  standardHoursPerDay: number;
  overtimeMultiplier: number;
  leaveYearStartMonth: number;
  /** Phase 4: the most of net pay a run recovers for loan instalments, %. */
  loanMaxDeductionPercent: number;
}

export const DEFAULT_PAYROLL_SETTINGS: PayrollSettingsValues = {
  defaultWeeklyOffDays: [0],
  standardHoursPerDay: 8,
  overtimeMultiplier: 2,
  leaveYearStartMonth: 4,
  loanMaxDeductionPercent: 50,
};

type Reader = Pick<TenantDatabase, "select">;

export async function loadPayrollSettings(db: Reader, businessId: string): Promise<PayrollSettingsValues & { saved: boolean }> {
  const [row] = await db.select().from(payrollSettings).where(eq(payrollSettings.businessId, businessId)).limit(1);
  if (!row) return { ...DEFAULT_PAYROLL_SETTINGS, saved: false };
  return {
    defaultWeeklyOffDays: row.defaultWeeklyOffDays,
    standardHoursPerDay: Number(row.standardHoursPerDay),
    overtimeMultiplier: Number(row.overtimeMultiplier),
    leaveYearStartMonth: row.leaveYearStartMonth,
    loanMaxDeductionPercent: Number(row.loanMaxDeductionPercent),
    saved: true,
  };
}

export interface HolidayRow {
  date: string;
  name: string;
  scope: string;
  stateCode: string | null;
  branch: string | null;
}

export async function loadHolidays(db: Reader, businessId: string, from: string, to: string): Promise<HolidayRow[]> {
  return db
    .select({ date: payrollHolidays.date, name: payrollHolidays.name, scope: payrollHolidays.scope, stateCode: payrollHolidays.stateCode, branch: payrollHolidays.branch })
    .from(payrollHolidays)
    .where(and(eq(payrollHolidays.businessId, businessId), between(payrollHolidays.date, from, to)));
}

/** The holiday dates that apply to an employee: national ones, their state's and their branch's. */
export function holidayDatesFor(holidays: readonly HolidayRow[], emp: { workState: string | null; branch: string | null }): Set<string> {
  const out = new Set<string>();
  const branch = emp.branch?.trim().toLowerCase() ?? "";
  for (const h of holidays) {
    if (h.scope === "national") out.add(h.date);
    else if (h.scope === "state" && h.stateCode && emp.workState && h.stateCode === emp.workState) out.add(h.date);
    else if (h.scope === "branch" && h.branch && branch && h.branch.trim().toLowerCase() === branch) out.add(h.date);
  }
  return out;
}

/** The month's attendance is locked by a payroll run that has moved past "draft". */
export async function lockedRunForMonth(db: Reader, businessId: string, month: string) {
  const [run] = await db
    .select({ id: payrollRuns.id, status: payrollRuns.status })
    .from(payrollRuns)
    .where(and(eq(payrollRuns.businessId, businessId), eq(payrollRuns.month, month), ne(payrollRuns.status, "draft")))
    .limit(1);
  return run ?? null;
}

/** Refuse a change to attendance (or leave) on dates whose month is locked by a payroll run. */
export async function assertAttendanceOpen(db: Reader, businessId: string, dates: readonly string[]): Promise<void> {
  for (const month of new Set(dates.map(monthOf))) {
    const locked = await lockedRunForMonth(db, businessId, month);
    if (locked) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Attendance for ${formatPayrollMonth(month)} is locked by its payroll run. Reopen the run to change it.`,
      });
    }
  }
}

export async function loadMonthAttendance(db: Reader, businessId: string, month: string) {
  return db
    .select()
    .from(attendanceRecords)
    .where(and(eq(attendanceRecords.businessId, businessId), gte(attendanceRecords.date, monthStart(month)), lte(attendanceRecords.date, monthEnd(month))));
}

// ── Employee views ────────────────────────────────────────────────────────────

type EmployeeRow = typeof employees.$inferSelect;

/** What a list row shows: no full identity or bank numbers, no photo. */
export function employeeListItem(row: EmployeeRow, names: { department?: string | null; designation?: string | null }) {
  return {
    id: row.id,
    employeeCode: row.employeeCode,
    name: row.name,
    department: names.department ?? null,
    designation: names.designation ?? null,
    departmentId: row.departmentId,
    designationId: row.designationId,
    branch: row.branch,
    employmentType: row.employmentType,
    status: row.status,
    dateOfJoining: row.dateOfJoining,
    lastWorkingDay: row.lastWorkingDay,
    phone: row.phone,
    email: row.email,
    panMasked: maskSensitive(row.pan),
    uanMasked: maskSensitive(row.uan),
    bankAccountMasked: maskSensitive(row.bankAccountNumber),
    hasBankDetails: !!(row.bankAccountNumber && row.bankIfsc),
  };
}

/**
 * The full employee record for the detail screen. With `full` the identity and
 * bank numbers are included; without it only their masked forms are.
 */
export function employeeDetail(row: EmployeeRow, opts: { full: boolean }) {
  const sensitive = opts.full
    ? { pan: row.pan, aadhaar: row.aadhaar, uan: row.uan, esicNumber: row.esicNumber, bankAccountNumber: row.bankAccountNumber, bankIfsc: row.bankIfsc }
    : { pan: null, aadhaar: null, uan: null, esicNumber: null, bankAccountNumber: null, bankIfsc: null };
  return {
    id: row.id,
    employeeCode: row.employeeCode,
    name: row.name,
    dateOfBirth: row.dateOfBirth,
    gender: row.gender,
    fatherOrSpouseName: row.fatherOrSpouseName,
    address: row.address,
    phone: row.phone,
    email: row.email,
    photoDataUrl: row.photoDataUrl,
    dateOfJoining: row.dateOfJoining,
    departmentId: row.departmentId,
    designationId: row.designationId,
    branch: row.branch,
    workState: row.workState,
    managerId: row.managerId,
    shiftId: row.shiftId,
    employmentType: row.employmentType,
    taxRegime: row.taxRegime,
    bankAccountName: row.bankAccountName,
    bankName: row.bankName,
    status: row.status,
    lastWorkingDay: row.lastWorkingDay,
    exitReason: row.exitReason,
    exitNote: row.exitNote,
    fnfNote: row.fnfNote,
    fnfPayrollRunId: row.fnfPayrollRunId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...sensitive,
    panMasked: maskSensitive(row.pan),
    aadhaarMasked: maskSensitive(row.aadhaar),
    uanMasked: maskSensitive(row.uan),
    esicMasked: maskSensitive(row.esicNumber),
    bankAccountMasked: maskSensitive(row.bankAccountNumber),
    /** True when the full numbers above are included. */
    sensitiveIncluded: opts.full,
  };
}

/** Empty strings from a form become null; everything else is kept. */
export function blankToNull<T>(value: T): T | null {
  return value === "" || value === undefined ? null : value;
}

/** The names of the fields an update touched: what the audit trail records instead of values. */
export function changedFieldNames(input: Record<string, unknown>, skip: string[] = ["id"]): string[] {
  return Object.keys(input).filter((k) => !skip.includes(k) && input[k] !== undefined);
}
