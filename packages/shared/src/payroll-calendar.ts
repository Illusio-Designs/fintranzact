/**
 * Payroll calendar and attendance rules (pure: no database, no clock).
 *
 * Dates are plain calendar days, "YYYY-MM-DD" (Indian calendar days, like
 * everything else in the books); a payroll month is "YYYY-MM". Weekdays are
 * numbered 0 = Sunday ... 6 = Saturday.
 *
 * Paid days and loss-of-pay (LOP) days are counted in HALF days internally
 * (integers), so a half-day never meets floating point. The functions return
 * days as numbers (x.0 or x.5).
 *
 * The rule, in words (docs/architecture/payroll.md):
 *   - A day outside the employee's employment (before the joining date, after
 *     the last working day) is neither paid nor LOP: it simply is not part of
 *     that month's employment. The rest of the month is "employed days".
 *   - Weekly offs and holidays inside the employment are paid.
 *   - Present = paid. Absent = LOP. Half day = half paid, half LOP (unless
 *     the other half is a paid leave: then the whole day is paid).
 *   - Leave = paid when the leave type is paid, otherwise LOP.
 *   - paid days = employed days - LOP days (for a full month: days in month - LOP).
 */

export const ATTENDANCE_STATUSES = ["present", "absent", "half_day", "week_off", "holiday", "leave"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: "Present",
  absent: "Absent",
  half_day: "Half day",
  week_off: "Week off",
  holiday: "Holiday",
  leave: "On leave",
};

export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function isPayrollMonth(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = MONTH_RE.exec(value);
  if (!m) return false;
  const mo = Number(m[2]);
  return mo >= 1 && mo <= 12 && Number(m[1]) >= 2000 && Number(m[1]) <= 2200;
}

/** Days in a payroll month ("2028-02" has 29: leap year). */
export function daysInMonth(month: string): number {
  const m = MONTH_RE.exec(month);
  if (!m) throw new Error(`Invalid payroll month: ${month}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
}

export function monthStart(month: string): string {
  return `${month}-01`;
}

export function monthEnd(month: string): string {
  return `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;
}

/** Every date of the month, "YYYY-MM-DD", in order. */
export function datesOfMonth(month: string): string[] {
  const n = daysInMonth(month);
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

/** Weekday of a date, 0 = Sunday. */
export function weekdayOf(date: string): number {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`Invalid date: ${date}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
}

export function addDays(date: string, days: number): string {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`Invalid date: ${date}`);
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return dt.toISOString().slice(0, 10);
}

/** Dates from `from` to `to`, inclusive. Empty when `to` is before `from`. */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  if (to < from) return out;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    out.push(d);
    if (out.length > 3700) break; // ten years: a guard against a runaway loop
  }
  return out;
}

/** "2026-10-17" -> "2026-10". */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** "2026-10" -> "October 2026". */
export function formatPayrollMonth(month: string): string {
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const m = MONTH_RE.exec(month);
  if (!m) return month;
  return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

// ── Daily classification ─────────────────────────────────────────────────────

/** One marked day. */
export interface DayRecord {
  status: AttendanceStatus;
  /** Leave (or a half-day leave): whether the leave type is paid. Ignored for other statuses. */
  leavePaid?: boolean;
  /** Overtime hours worked that day. */
  overtimeHours?: number;
}

export interface AttendanceSummaryInput {
  month: string;
  /** First day of employment ("YYYY-MM-DD"). */
  joiningDate: string;
  /** Last working day, when the employee has left. Inclusive. */
  lastWorkingDay?: string | null;
  /** Weekly off weekdays (0 = Sunday). */
  weeklyOffDays: readonly number[];
  /** Holiday dates that apply to the employee (national + state + branch). */
  holidays: ReadonlySet<string> | readonly string[];
  /** Marked days by date. */
  records: ReadonlyMap<string, DayRecord> | Readonly<Record<string, DayRecord>>;
  /** How a working day with no record counts. Default "absent" (loss of pay). */
  unmarkedAs?: "present" | "absent";
}

export interface AttendanceSummary {
  month: string;
  daysInMonth: number;
  /** Days of the month inside the employment (joining date to last working day). */
  employedDays: number;
  /** employedDays - lopDays, in 0.5 steps. */
  paidDays: number;
  lopDays: number;
  presentDays: number;
  halfDays: number;
  absentDays: number;
  weekOffDays: number;
  holidayDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  overtimeHours: number;
  /** Working days with no record (counted as `unmarkedAs`). Payroll refuses to lock while there are any. */
  unmarkedDates: string[];
}

function toLookup<T>(src: ReadonlyMap<string, T> | Readonly<Record<string, T>>): (key: string) => T | undefined {
  return src instanceof Map ? (k) => (src as ReadonlyMap<string, T>).get(k) : (k) => (src as Readonly<Record<string, T>>)[k];
}

function toSet(src: ReadonlySet<string> | readonly string[]): ReadonlySet<string> {
  return src instanceof Set ? (src as ReadonlySet<string>) : new Set(src as readonly string[]);
}

export function summarizeAttendance(input: AttendanceSummaryInput): AttendanceSummary {
  const dim = daysInMonth(input.month);
  const get = toLookup(input.records);
  const holidays = toSet(input.holidays);
  const offs = new Set(input.weeklyOffDays);
  const unmarkedAs = input.unmarkedAs ?? "absent";

  let employed = 0;
  let lopHalves = 0;
  let present = 0, half = 0, absent = 0, weekOff = 0, holiday = 0, paidLeave = 0, unpaidLeave = 0;
  let overtime = 0;
  const unmarked: string[] = [];

  for (const date of datesOfMonth(input.month)) {
    if (date < input.joiningDate) continue;
    if (input.lastWorkingDay && date > input.lastWorkingDay) continue;
    employed += 1;

    const rec = get(date);
    if (rec?.overtimeHours && rec.overtimeHours > 0) overtime += rec.overtimeHours;

    if (!rec) {
      if (offs.has(weekdayOf(date))) weekOff += 1;
      else if (holidays.has(date)) holiday += 1;
      else {
        unmarked.push(date);
        if (unmarkedAs === "present") present += 1;
        else {
          absent += 1;
          lopHalves += 2;
        }
      }
      continue;
    }

    switch (rec.status) {
      case "present":
        present += 1;
        break;
      case "absent":
        absent += 1;
        lopHalves += 2;
        break;
      case "half_day":
        if (rec.leavePaid) {
          paidLeave += 0.5;
          present += 0.5;
        } else {
          half += 1;
          lopHalves += 1;
        }
        break;
      case "week_off":
        weekOff += 1;
        break;
      case "holiday":
        holiday += 1;
        break;
      case "leave":
        if (rec.leavePaid) paidLeave += 1;
        else {
          unpaidLeave += 1;
          lopHalves += 2;
        }
        break;
    }
  }

  const lopDays = lopHalves / 2;
  return {
    month: input.month,
    daysInMonth: dim,
    employedDays: employed,
    paidDays: employed - lopDays,
    lopDays,
    presentDays: present,
    halfDays: half,
    absentDays: absent,
    weekOffDays: weekOff,
    holidayDays: holiday,
    paidLeaveDays: paidLeave,
    unpaidLeaveDays: unpaidLeave,
    overtimeHours: Math.round(overtime * 100) / 100,
    unmarkedDates: unmarked,
  };
}

// ── Leave ────────────────────────────────────────────────────────────────────

export const LEAVE_ACCRUAL_TYPES = ["none", "annual", "monthly"] as const;
export type LeaveAccrualType = (typeof LEAVE_ACCRUAL_TYPES)[number];

export const LEAVE_APPLICATION_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;
export type LeaveApplicationStatus = (typeof LEAVE_APPLICATION_STATUSES)[number];

/** The default leave types a business starts with (the owner edits them). */
export const DEFAULT_LEAVE_TYPES = [
  { code: "CL", name: "Casual leave", isPaid: true, accrualType: "annual" as LeaveAccrualType, accrualDays: 12, carryForward: false, carryForwardMax: 0, encashable: false },
  { code: "SL", name: "Sick leave", isPaid: true, accrualType: "annual" as LeaveAccrualType, accrualDays: 7, carryForward: false, carryForwardMax: 0, encashable: false },
  { code: "EL", name: "Earned / privilege leave", isPaid: true, accrualType: "monthly" as LeaveAccrualType, accrualDays: 1.5, carryForward: true, carryForwardMax: 30, encashable: true },
  { code: "LOP", name: "Loss of pay", isPaid: false, accrualType: "none" as LeaveAccrualType, accrualDays: 0, carryForward: false, carryForwardMax: 0, encashable: false },
];

/** First day ("YYYY-MM-DD") of the leave year a date falls in. `startMonth` 1-12 (4 = April). */
export function leaveYearStart(date: string, startMonth = 4): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const startYear = m >= startMonth ? y : y - 1;
  return `${startYear}-${String(startMonth).padStart(2, "0")}-01`;
}

/** The leave year label a date falls in: the year it starts, e.g. 2026 for 1 Apr 2026 - 31 Mar 2027. */
export function leaveYearOf(date: string, startMonth = 4): number {
  return Number(leaveYearStart(date, startMonth).slice(0, 4));
}

/** The months ("YYYY-MM") of a leave year, in order. */
export function monthsOfLeaveYear(leaveYear: number, startMonth = 4): string[] {
  return Array.from({ length: 12 }, (_, i) => {
    const m0 = startMonth - 1 + i;
    const y = leaveYear + Math.floor(m0 / 12);
    return `${y}-${String((m0 % 12) + 1).padStart(2, "0")}`;
  });
}

/**
 * The days a leave application uses: every date from `from` to `to` that is not
 * a weekly off or a holiday (those are paid anyway and never use balance), with
 * 0.5 for a half day at the start or end of the range.
 */
export function countLeaveDays(input: {
  from: string;
  to: string;
  weeklyOffDays: readonly number[];
  holidays: ReadonlySet<string> | readonly string[];
  halfDayStart?: boolean;
  halfDayEnd?: boolean;
}): { dates: Array<{ date: string; fraction: 1 | 0.5 }>; days: number } {
  const offs = new Set(input.weeklyOffDays);
  const holidays = toSet(input.holidays);
  const dates: Array<{ date: string; fraction: 1 | 0.5 }> = [];
  for (const date of dateRange(input.from, input.to)) {
    if (offs.has(weekdayOf(date)) || holidays.has(date)) continue;
    const single = input.from === input.to;
    const half = single ? !!(input.halfDayStart || input.halfDayEnd) : (date === input.from && !!input.halfDayStart) || (date === input.to && !!input.halfDayEnd);
    dates.push({ date, fraction: half ? 0.5 : 1 });
  }
  return { dates, days: dates.reduce((s, d) => s + d.fraction, 0) };
}

/**
 * Days that become paid leave and days that spill over into loss of pay, for a
 * leave type that is paid: what is available is used first, the rest is LOP.
 */
export function splitLeaveAgainstBalance(requested: number, available: number): { paid: number; lop: number } {
  const avail = Math.max(0, available);
  const paid = Math.min(requested, avail);
  return { paid, lop: Math.round((requested - paid) * 2) / 2 };
}

/** Carry-forward at the end of a leave year: what carries over and what lapses. */
export function carryForward(balance: number, rule: { carryForward: boolean; carryForwardMax: number }): { carried: number; lapsed: number } {
  const bal = Math.max(0, balance);
  if (!rule.carryForward) return { carried: 0, lapsed: bal };
  const carried = Math.min(bal, Math.max(0, rule.carryForwardMax));
  return { carried, lapsed: Math.round((bal - carried) * 100) / 100 };
}
