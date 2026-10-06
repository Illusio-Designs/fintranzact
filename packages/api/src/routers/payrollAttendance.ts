/**
 * Payroll: daily attendance, the holiday calendar and the payroll settings
 * (weekly offs, standard hours, overtime multiplier, leave year).
 *
 * Attendance of a month is locked by its payroll run (status past "draft"):
 * marking, bulk marking, holidays and leave approvals for that month are
 * refused until the run is reopened.
 */

import { and, asc, between, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { attendanceRecords, employees, leaveTypes, payrollHolidays, payrollRuns, payrollSettings } from "@fintranzact/db";
import {
  attendanceBulkMarkSchema,
  attendanceMarkSchema,
  attendanceMonthSchema,
  datesOfMonth,
  holidaySchema,
  monthEnd,
  monthStart,
  payrollSettingsSchema,
} from "@fintranzact/shared";
import { router, viewerProcedure, memberProcedure } from "../trpc.js";
import { withAudit } from "../lib/audit.js";
import { assertInBusiness } from "../lib/business-scope.js";
import { assertPayroll, badRequest, notFound } from "../lib/payroll/access.js";
import { assertAttendanceOpen, loadHolidays, loadMonthAttendance, loadPayrollSettings } from "../lib/payroll/data.js";
import { attendanceSummaries } from "../lib/payroll/run.js";

const idInput = z.object({ id: z.string().uuid() });

export const payrollAttendanceRouter = router({
  /**
   * One month of attendance: every employee employed in the month with each
   * day's record, their weekly offs and holidays, and the month's summary
   * (paid days and loss-of-pay days that payroll will use).
   */
  month: viewerProcedure.input(attendanceMonthSchema).query(async ({ ctx, input }) => {
    await assertPayroll(ctx, "read");
    const month = input.month;
    const [summaries, recordRows, holidayRows, [run]] = await Promise.all([
      attendanceSummaries(ctx.db, ctx.businessId, month),
      loadMonthAttendance(ctx.db, ctx.businessId, month),
      loadHolidays(ctx.db, ctx.businessId, monthStart(month), monthEnd(month)),
      ctx.db.select({ id: payrollRuns.id, status: payrollRuns.status }).from(payrollRuns).where(and(eq(payrollRuns.businessId, ctx.businessId), eq(payrollRuns.month, month))).limit(1),
    ]);
    const byEmployee = new Map<string, Record<string, { status: string; leaveTypeId: string | null; checkIn: string | null; checkOut: string | null; overtimeHours: number; note: string | null; source: string }>>();
    for (const r of recordRows) {
      const m = byEmployee.get(r.employeeId) ?? {};
      m[r.date] = { status: r.status, leaveTypeId: r.leaveTypeId, checkIn: r.checkIn, checkOut: r.checkOut, overtimeHours: Number(r.overtimeHours), note: r.note, source: r.source };
      byEmployee.set(r.employeeId, m);
    }
    const rows = summaries
      .filter((s) => !input.departmentId || s.employee.departmentId === input.departmentId)
      .map((s) => ({
        id: s.employee.id,
        employeeCode: s.employee.employeeCode,
        name: s.employee.name,
        dateOfJoining: s.employee.dateOfJoining,
        lastWorkingDay: s.employee.lastWorkingDay,
        weeklyOffDays: s.weeklyOffDays,
        holidayDates: s.holidayDates,
        days: byEmployee.get(s.employee.id) ?? {},
        summary: s.summary,
      }));
    return {
      month,
      dates: datesOfMonth(month),
      employees: rows,
      holidays: holidayRows.sort((a, b) => a.date.localeCompare(b.date)),
      run: run ?? null,
      locked: !!run && run.status !== "draft",
    };
  }),

  /** Mark one employee's day (present, absent, half day, week off, holiday or leave), with optional check-in/out and overtime hours. */
  mark: memberProcedure.input(attendanceMarkSchema).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "update");
      const [emp] = await ctx.db.select().from(employees).where(and(eq(employees.id, input.employeeId), eq(employees.businessId, ctx.businessId))).limit(1);
      if (!emp) throw notFound("Employee");
      if (input.date < emp.dateOfJoining) throw badRequest("That date is before the employee's joining date.");
      if (emp.lastWorkingDay && input.date > emp.lastWorkingDay) throw badRequest("That date is after the employee's last working day.");
      if (input.status === "leave" && !input.leaveTypeId) throw badRequest("Choose the leave type.");
      if ((input.status === "absent" || input.status === "leave") && input.overtimeHours > 0) throw badRequest("Overtime hours need a day the employee worked.");
      await assertInBusiness(ctx.db, leaveTypes, input.leaveTypeId, ctx.businessId, "Leave type");
      await assertAttendanceOpen(ctx.db, ctx.businessId, [input.date]);
      const values = {
        businessId: ctx.businessId,
        employeeId: emp.id,
        date: input.date,
        status: input.status,
        leaveTypeId: input.leaveTypeId ?? null,
        checkIn: input.checkIn ?? null,
        checkOut: input.checkOut ?? null,
        overtimeHours: String(input.overtimeHours),
        note: input.note || null,
        source: "manual",
        markedByUserId: ctx.user.id,
        updatedAt: new Date(),
      };
      const [row] = await ctx.db
        .insert(attendanceRecords)
        .values(values)
        .onConflictDoUpdate({ target: [attendanceRecords.employeeId, attendanceRecords.date], set: values })
        .returning();
      return row!;
    }, (r) => ({ action: "payroll.attendance.mark", entityType: "attendance", entityId: r.id, metadata: { date: r.date, status: r.status } })),
  ),

  /** Mark the same status for many employees and dates. Days that are already marked are kept unless `overwrite` is on. */
  bulkMark: memberProcedure.input(attendanceBulkMarkSchema).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "update");
      await assertInBusiness(ctx.db, employees, input.employeeIds, ctx.businessId, "Employee");
      await assertAttendanceOpen(ctx.db, ctx.businessId, input.dates);
      const emps = await ctx.db.select().from(employees).where(and(eq(employees.businessId, ctx.businessId), inArray(employees.id, input.employeeIds)));
      let marked = 0;
      let skipped = 0;
      for (const e of emps) {
        const rows = input.dates
          .filter((d) => d >= e.dateOfJoining && (!e.lastWorkingDay || d <= e.lastWorkingDay))
          .map((date) => ({ businessId: ctx.businessId, employeeId: e.id, date, status: input.status, source: "manual", markedByUserId: ctx.user.id }));
        skipped += input.dates.length - rows.length;
        if (rows.length === 0) continue;
        if (input.overwrite) {
          // Days that leave applications wrote are never overwritten by a bulk mark.
          const res = await ctx.db
            .insert(attendanceRecords)
            .values(rows)
            .onConflictDoUpdate({
              target: [attendanceRecords.employeeId, attendanceRecords.date],
              set: { status: input.status, leaveTypeId: null, markedByUserId: ctx.user.id, updatedAt: new Date() },
              setWhere: sql`${attendanceRecords.source} <> 'leave'`,
            })
            .returning({ id: attendanceRecords.id });
          marked += res.length;
          skipped += rows.length - res.length;
        } else {
          const res = await ctx.db.insert(attendanceRecords).values(rows).onConflictDoNothing().returning({ id: attendanceRecords.id });
          marked += res.length;
          skipped += rows.length - res.length;
        }
      }
      return { marked, skipped };
    }, (r, input) => ({ action: "payroll.attendance.bulkMark", entityType: "attendance", entityId: null, metadata: { employees: input.employeeIds.length, dates: input.dates.length, status: input.status, marked: r.marked } })),
  ),

  // ── Holidays ────────────────────────────────────────────────────────────────

  holidayList: viewerProcedure.input(z.object({ year: z.number().int().min(2000).max(2200).optional() }).optional()).query(async ({ ctx, input }) => {
    await assertPayroll(ctx, "read");
    const year = input?.year ?? new Date().getUTCFullYear();
    return ctx.db
      .select()
      .from(payrollHolidays)
      .where(and(eq(payrollHolidays.businessId, ctx.businessId), between(payrollHolidays.date, `${year}-01-01`, `${year}-12-31`)))
      .orderBy(asc(payrollHolidays.date), asc(payrollHolidays.name));
  }),

  holidayCreate: memberProcedure.input(holidaySchema).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "update");
      await assertAttendanceOpen(ctx.db, ctx.businessId, [input.date]);
      const [row] = await ctx.db
        .insert(payrollHolidays)
        .values({
          businessId: ctx.businessId,
          date: input.date,
          name: input.name,
          scope: input.scope,
          stateCode: input.scope === "state" ? input.stateCode ?? null : null,
          branch: input.scope === "branch" ? input.branch || null : null,
        })
        .returning();
      return row!;
    }, (r) => ({ action: "payroll.holiday.create", entityType: "payrollHoliday", entityId: r.id, metadata: { date: r.date, scope: r.scope } })),
  ),

  holidayDelete: memberProcedure.input(idInput).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "update");
      const [row] = await ctx.db.select().from(payrollHolidays).where(and(eq(payrollHolidays.id, input.id), eq(payrollHolidays.businessId, ctx.businessId))).limit(1);
      if (!row) throw notFound("Holiday");
      await assertAttendanceOpen(ctx.db, ctx.businessId, [row.date]);
      await ctx.db.delete(payrollHolidays).where(eq(payrollHolidays.id, row.id));
      return { id: row.id, date: row.date };
    }, (r) => ({ action: "payroll.holiday.delete", entityType: "payrollHoliday", entityId: r.id, metadata: { date: r.date } })),
  ),

  /** Copy the holidays of a year onto another year (same dates, so move fixed-date holidays only; edit the rest by hand). */
  holidayCopyYear: memberProcedure
    .input(z.object({ fromYear: z.number().int().min(2000).max(2200), toYear: z.number().int().min(2000).max(2200) }))
    .mutation(
      withAudit(async ({ ctx, input }) => {
        await assertPayroll(ctx, "update");
        if (input.fromYear === input.toYear) throw badRequest("Choose two different years.");
        const src = await ctx.db
          .select()
          .from(payrollHolidays)
          .where(and(eq(payrollHolidays.businessId, ctx.businessId), between(payrollHolidays.date, `${input.fromYear}-01-01`, `${input.fromYear}-12-31`)));
        const existing = await ctx.db
          .select({ date: payrollHolidays.date, name: payrollHolidays.name, scope: payrollHolidays.scope })
          .from(payrollHolidays)
          .where(and(eq(payrollHolidays.businessId, ctx.businessId), between(payrollHolidays.date, `${input.toYear}-01-01`, `${input.toYear}-12-31`)));
        const have = new Set(existing.map((h) => `${h.date}|${h.name}|${h.scope}`));
        const rows = src
          .map((h) => ({ ...h, date: `${input.toYear}${h.date.slice(4)}` }))
          .filter((h) => !have.has(`${h.date}|${h.name}|${h.scope}`) && !(h.date.endsWith("-02-29") && ![0, 4].includes(input.toYear % 4)))
          .map((h) => ({ businessId: ctx.businessId, date: h.date, name: h.name, scope: h.scope, stateCode: h.stateCode, branch: h.branch }));
        await assertAttendanceOpen(ctx.db, ctx.businessId, rows.map((r) => r.date));
        if (rows.length) await ctx.db.insert(payrollHolidays).values(rows);
        return { copied: rows.length };
      }, (r) => ({ action: "payroll.holiday.copyYear", entityType: "payrollHoliday", entityId: null, metadata: { copied: r.copied } })),
    ),

  // ── Settings ────────────────────────────────────────────────────────────────

  settings: viewerProcedure.query(async ({ ctx }) => {
    await assertPayroll(ctx, "read");
    const { saved, ...values } = await loadPayrollSettings(ctx.db, ctx.businessId);
    void saved;
    return values;
  }),

  updateSettings: memberProcedure.input(payrollSettingsSchema).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "update");
      const values = {
        businessId: ctx.businessId,
        defaultWeeklyOffDays: [...new Set(input.defaultWeeklyOffDays)].sort(),
        standardHoursPerDay: String(input.standardHoursPerDay),
        overtimeMultiplier: String(input.overtimeMultiplier),
        leaveYearStartMonth: input.leaveYearStartMonth,
        updatedAt: new Date(),
      };
      await ctx.db.insert(payrollSettings).values(values).onConflictDoUpdate({ target: payrollSettings.businessId, set: values });
      return loadPayrollSettings(ctx.db, ctx.businessId).then(({ saved, ...v }) => { void saved; return v; });
    }, () => ({ action: "payroll.settings.update", entityType: "payrollSettings", entityId: null })),
  ),
});
