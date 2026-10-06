/**
 * Payroll: leave types, balances (a ledger per employee, leave type and leave
 * year), applications with approval, accrual, carry-forward and encashment.
 *
 * A balance is the sum of the employee's ledger rows. An approved application
 * for a paid leave type uses the balance first and turns the rest into loss of
 * pay; it writes the days into attendance (source "leave"), so payroll sees
 * them. Applications are decided in one leave year: the one the first day is in.
 */

import { and, asc, desc, eq, inArray, lte, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { attendanceRecords, employees, leaveApplications, leaveEncashments, leaveLedger, leaveTypes, payrollHolidays, payrollShifts } from "@fintranzact/db";
import {
  DEFAULT_LEAVE_TYPES,
  carryForward,
  countLeaveDays,
  isPayrollMonth,
  leaveApplySchema,
  leaveEncashSchema,
  leaveTypeSchema,
  leaveYearOf,
  leaveYearStart,
  monthEnd,
  monthStart,
  rupeesToPaise,
  paiseToRupees,
  splitLeaveAgainstBalance,
} from "@fintranzact/shared";
import { router, viewerProcedure, memberProcedure } from "../trpc.js";
import { withAudit } from "../lib/audit.js";
import { assertInBusiness } from "../lib/business-scope.js";
import { assertPayroll, badRequest, isUniqueViolation, notFound } from "../lib/payroll/access.js";
import { assertAttendanceOpen, holidayDatesFor, loadPayrollSettings } from "../lib/payroll/data.js";

const idInput = z.object({ id: z.string().uuid() });
const num = (v: string | null | undefined) => Number(v ?? 0);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

async function balanceOf(tx: Tx, employeeId: string, leaveTypeId: string, leaveYear: number): Promise<number> {
  const [row] = await tx
    .select({ n: sql<string>`COALESCE(SUM(${leaveLedger.days}), 0)::text` })
    .from(leaveLedger)
    .where(and(eq(leaveLedger.employeeId, employeeId), eq(leaveLedger.leaveTypeId, leaveTypeId), eq(leaveLedger.leaveYear, leaveYear)));
  return num(row?.n);
}

/** The system "LOP" leave type, made when it is missing (an unpaid leave type is needed to record the part of a leave that has no balance). */
async function ensureLopType(tx: Tx, businessId: string) {
  const [lop] = await tx.select().from(leaveTypes).where(and(eq(leaveTypes.businessId, businessId), eq(leaveTypes.code, "LOP"))).limit(1);
  if (lop) return lop as typeof leaveTypes.$inferSelect;
  const def = DEFAULT_LEAVE_TYPES.find((t) => t.code === "LOP")!;
  const [row] = await tx
    .insert(leaveTypes)
    .values({ businessId, code: def.code, name: def.name, isPaid: false, accrualType: "none", accrualDays: "0", carryForward: false, carryForwardMax: "0", encashable: false })
    .returning();
  return row as typeof leaveTypes.$inferSelect;
}

async function employeeCalendar(tx: Tx, businessId: string, emp: typeof employees.$inferSelect, from: string, to: string) {
  const settings = await loadPayrollSettings(tx, businessId);
  let weeklyOffDays = settings.defaultWeeklyOffDays;
  if (emp.shiftId) {
    const [shift] = await tx.select().from(payrollShifts).where(eq(payrollShifts.id, emp.shiftId)).limit(1);
    if (shift) weeklyOffDays = shift.weeklyOffDays;
  }
  const hol = await tx
    .select({ date: payrollHolidays.date, name: payrollHolidays.name, scope: payrollHolidays.scope, stateCode: payrollHolidays.stateCode, branch: payrollHolidays.branch })
    .from(payrollHolidays)
    .where(and(eq(payrollHolidays.businessId, businessId), gte(payrollHolidays.date, from), lte(payrollHolidays.date, to)));
  return { settings, weeklyOffDays, holidays: holidayDatesFor(hol, emp) };
}

export const payrollLeaveRouter = router({
  // ── Leave types ─────────────────────────────────────────────────────────────

  typeList: viewerProcedure.query(async ({ ctx }) => {
    await assertPayroll(ctx, "read");
    return ctx.db.select().from(leaveTypes).where(eq(leaveTypes.businessId, ctx.businessId)).orderBy(asc(leaveTypes.code));
  }),

  typeCreate: memberProcedure.input(leaveTypeSchema).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "create");
      try {
        const [row] = await ctx.db
          .insert(leaveTypes)
          .values({
            businessId: ctx.businessId,
            code: input.code,
            name: input.name,
            isPaid: input.isPaid,
            accrualType: input.accrualType,
            accrualDays: String(input.accrualDays),
            carryForward: input.carryForward,
            carryForwardMax: String(input.carryForwardMax),
            encashable: input.encashable,
          })
          .returning();
        return row!;
      } catch (e) {
        if (isUniqueViolation(e)) throw new TRPCError({ code: "CONFLICT", message: `A leave type with code ${input.code} already exists.` });
        throw e;
      }
    }, (r) => ({ action: "payroll.leaveType.create", entityType: "leaveType", entityId: r.id, metadata: { code: r.code } })),
  ),

  typeUpdate: memberProcedure.input(leaveTypeSchema.partial().extend({ id: z.string().uuid(), isActive: z.boolean().optional() })).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "update");
      const { id, accrualDays, carryForwardMax, code, ...rest } = input;
      void code; // The code identifies the type in reports and cannot change.
      const set: Record<string, unknown> = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
      if (accrualDays !== undefined) set.accrualDays = String(accrualDays);
      if (carryForwardMax !== undefined) set.carryForwardMax = String(carryForwardMax);
      if (Object.keys(set).length === 0) throw badRequest("Nothing to change.");
      const [row] = await ctx.db
        .update(leaveTypes)
        .set(set)
        .where(and(eq(leaveTypes.id, id), eq(leaveTypes.businessId, ctx.businessId)))
        .returning();
      if (!row) throw notFound("Leave type");
      return row;
    }, (r) => ({ action: "payroll.leaveType.update", entityType: "leaveType", entityId: r.id, metadata: { code: r.code } })),
  ),

  /** Add the standard types that are missing: casual (CL), sick (SL), earned/privilege (EL) and loss of pay (LOP). */
  typeSeedDefaults: memberProcedure.mutation(
    withAudit(async ({ ctx }) => {
      await assertPayroll(ctx, "create");
      const rows = await ctx.db
        .insert(leaveTypes)
        .values(
          DEFAULT_LEAVE_TYPES.map((t) => ({
            businessId: ctx.businessId,
            code: t.code,
            name: t.name,
            isPaid: t.isPaid,
            accrualType: t.accrualType,
            accrualDays: String(t.accrualDays),
            carryForward: t.carryForward,
            carryForwardMax: String(t.carryForwardMax),
            encashable: t.encashable,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: leaveTypes.id });
      return { added: rows.length };
    }, (r) => ({ action: "payroll.leaveType.seedDefaults", entityType: "leaveType", entityId: null, metadata: { added: r.added } })),
  ),

  // ── Balances ────────────────────────────────────────────────────────────────

  /** Balances per employee and leave type for a leave year (the year it starts in; the current one by default). */
  balances: viewerProcedure.input(z.object({ leaveYear: z.number().int().min(2000).max(2200).optional(), employeeId: z.string().uuid().optional() }).optional()).query(async ({ ctx, input }) => {
    await assertPayroll(ctx, "read");
    const settings = await loadPayrollSettings(ctx.db, ctx.businessId);
    const leaveYear = input?.leaveYear ?? leaveYearOf(new Date().toISOString().slice(0, 10), settings.leaveYearStartMonth);
    const types = await ctx.db.select().from(leaveTypes).where(and(eq(leaveTypes.businessId, ctx.businessId), eq(leaveTypes.isActive, true))).orderBy(asc(leaveTypes.code));
    const emps = await ctx.db
      .select({ id: employees.id, employeeCode: employees.employeeCode, name: employees.name })
      .from(employees)
      .where(and(eq(employees.businessId, ctx.businessId), eq(employees.status, "active"), ...(input?.employeeId ? [eq(employees.id, input.employeeId)] : [])))
      .orderBy(asc(employees.employeeCode));
    const sums = await ctx.db
      .select({ employeeId: leaveLedger.employeeId, leaveTypeId: leaveLedger.leaveTypeId, n: sql<string>`SUM(${leaveLedger.days})::text` })
      .from(leaveLedger)
      .where(and(eq(leaveLedger.businessId, ctx.businessId), eq(leaveLedger.leaveYear, leaveYear)))
      .groupBy(leaveLedger.employeeId, leaveLedger.leaveTypeId);
    const map = new Map(sums.map((s) => [`${s.employeeId}|${s.leaveTypeId}`, num(s.n)]));
    return {
      leaveYear,
      yearStart: leaveYearStart(`${leaveYear}-${String(settings.leaveYearStartMonth).padStart(2, "0")}-01`, settings.leaveYearStartMonth),
      types: types.map((t) => ({ id: t.id, code: t.code, name: t.name, isPaid: t.isPaid })),
      employees: emps.map((e) => ({ ...e, balances: Object.fromEntries(types.map((t) => [t.id, map.get(`${e.id}|${t.id}`) ?? 0])) })),
    };
  }),

  /** One employee's leave ledger for a leave year: accruals, leave taken, carry-forward, encashment. */
  ledger: viewerProcedure.input(z.object({ employeeId: z.string().uuid(), leaveYear: z.number().int().min(2000).max(2200) })).query(async ({ ctx, input }) => {
    await assertPayroll(ctx, "read");
    return ctx.db
      .select({ id: leaveLedger.id, leaveTypeId: leaveLedger.leaveTypeId, code: leaveTypes.code, kind: leaveLedger.kind, days: leaveLedger.days, entryDate: leaveLedger.entryDate, periodKey: leaveLedger.periodKey, note: leaveLedger.note })
      .from(leaveLedger)
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveLedger.leaveTypeId))
      .where(and(eq(leaveLedger.businessId, ctx.businessId), eq(leaveLedger.employeeId, input.employeeId), eq(leaveLedger.leaveYear, input.leaveYear)))
      .orderBy(desc(leaveLedger.entryDate), desc(leaveLedger.createdAt));
  }),

  // ── Applications ────────────────────────────────────────────────────────────

  applications: viewerProcedure
    .input(z.object({ status: z.enum(["pending", "approved", "rejected", "cancelled", "all"]).default("all"), employeeId: z.string().uuid().optional(), limit: z.number().int().min(1).max(200).default(100) }).optional())
    .query(async ({ ctx, input }) => {
      await assertPayroll(ctx, "read");
      const conds = [eq(leaveApplications.businessId, ctx.businessId)];
      if (input?.status && input.status !== "all") conds.push(eq(leaveApplications.status, input.status));
      if (input?.employeeId) conds.push(eq(leaveApplications.employeeId, input.employeeId));
      return ctx.db
        .select({
          app: leaveApplications,
          employeeName: employees.name,
          employeeCode: employees.employeeCode,
          leaveCode: leaveTypes.code,
          leaveName: leaveTypes.name,
        })
        .from(leaveApplications)
        .innerJoin(employees, eq(employees.id, leaveApplications.employeeId))
        .innerJoin(leaveTypes, eq(leaveTypes.id, leaveApplications.leaveTypeId))
        .where(and(...conds))
        .orderBy(desc(leaveApplications.fromDate), desc(leaveApplications.createdAt))
        .limit(input?.limit ?? 100)
        .then((rows) => rows.map((r) => ({ ...r.app, employeeName: r.employeeName, employeeCode: r.employeeCode, leaveCode: r.leaveCode, leaveName: r.leaveName })));
    }),

  request: memberProcedure.input(leaveApplySchema).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "create");
      const [emp] = await ctx.db.select().from(employees).where(and(eq(employees.id, input.employeeId), eq(employees.businessId, ctx.businessId))).limit(1);
      if (!emp) throw notFound("Employee");
      const [type] = await ctx.db.select().from(leaveTypes).where(and(eq(leaveTypes.id, input.leaveTypeId), eq(leaveTypes.businessId, ctx.businessId))).limit(1);
      if (!type) throw notFound("Leave type");
      if (!type.isActive) throw badRequest("That leave type is not in use any more.");
      if (input.fromDate < emp.dateOfJoining) throw badRequest("The leave starts before the employee's joining date.");
      if (emp.lastWorkingDay && input.toDate > emp.lastWorkingDay) throw badRequest("The leave ends after the employee's last working day.");
      const cal = await employeeCalendar(ctx.db, ctx.businessId, emp, input.fromDate, input.toDate);
      const counted = countLeaveDays({ from: input.fromDate, to: input.toDate, weeklyOffDays: cal.weeklyOffDays, holidays: cal.holidays, halfDayStart: input.halfDayStart, halfDayEnd: input.halfDayEnd });
      if (counted.days <= 0) throw badRequest("Those dates are all weekly offs or holidays, so no leave is needed.");
      const [overlap] = await ctx.db
        .select({ id: leaveApplications.id })
        .from(leaveApplications)
        .where(and(eq(leaveApplications.employeeId, emp.id), inArray(leaveApplications.status, ["pending", "approved"]), lte(leaveApplications.fromDate, input.toDate), gte(leaveApplications.toDate, input.fromDate)))
        .limit(1);
      if (overlap) throw new TRPCError({ code: "CONFLICT", message: "This employee already has leave for some of those dates." });
      const [row] = await ctx.db
        .insert(leaveApplications)
        .values({
          businessId: ctx.businessId,
          employeeId: emp.id,
          leaveTypeId: type.id,
          fromDate: input.fromDate,
          toDate: input.toDate,
          halfDayStart: input.halfDayStart,
          halfDayEnd: input.halfDayEnd,
          days: String(counted.days),
          reason: input.reason || null,
          createdByUserId: ctx.user.id,
        })
        .returning();
      return row!;
    }, (r) => ({ action: "payroll.leave.apply", entityType: "leaveApplication", entityId: r.id, metadata: { days: r.days, from: r.fromDate, to: r.toDate } })),
  ),

  /** Approve or reject a pending application. Approval uses the balance first, turns the rest into loss of pay and marks the days in attendance. */
  decide: memberProcedure.input(z.object({ id: z.string().uuid(), decision: z.enum(["approve", "reject"]), note: z.string().trim().max(300).optional() })).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "update");
      return ctx.db.transaction(async (tx) => {
        const [app] = await tx.select().from(leaveApplications).where(and(eq(leaveApplications.id, input.id), eq(leaveApplications.businessId, ctx.businessId))).for("update").limit(1);
        if (!app) throw notFound("Leave application");
        if (app.status !== "pending") throw badRequest(`This application is already ${app.status}.`);
        const decided = { decidedByUserId: ctx.user.id, decidedByName: ctx.user.name ?? null, decidedAt: new Date(), decisionNote: input.note || null };
        if (input.decision === "reject") {
          const [row] = await tx.update(leaveApplications).set({ status: "rejected", ...decided }).where(eq(leaveApplications.id, app.id)).returning();
          return row!;
        }

        const [emp] = await tx.select().from(employees).where(eq(employees.id, app.employeeId)).limit(1);
        const [type] = await tx.select().from(leaveTypes).where(eq(leaveTypes.id, app.leaveTypeId)).limit(1);
        if (!emp || !type) throw notFound("Employee");
        const cal = await employeeCalendar(tx, ctx.businessId, emp, app.fromDate, app.toDate);
        const counted = countLeaveDays({ from: app.fromDate, to: app.toDate, weeklyOffDays: cal.weeklyOffDays, holidays: cal.holidays, halfDayStart: app.halfDayStart, halfDayEnd: app.halfDayEnd });
        await assertAttendanceOpen(tx, ctx.businessId, counted.dates.map((d) => d.date));

        const leaveYear = leaveYearOf(app.fromDate, cal.settings.leaveYearStartMonth);
        const available = type.isPaid ? await balanceOf(tx, emp.id, type.id, leaveYear) : 0;
        const split = type.isPaid ? splitLeaveAgainstBalance(counted.days, available) : { paid: 0, lop: counted.days };
        const lop = split.lop > 0 ? await ensureLopType(tx, ctx.businessId) : null;

        // Day by day: the balance pays for the first days, the rest is loss of pay.
        let remainingPaid = split.paid;
        const rows: Array<typeof attendanceRecords.$inferInsert> = [];
        for (const d of counted.dates) {
          const paidPart = Math.min(d.fraction, remainingPaid);
          remainingPaid -= paidPart;
          const fullyPaid = paidPart === d.fraction;
          const usesPaidType = fullyPaid && type.isPaid;
          rows.push({
            businessId: ctx.businessId,
            employeeId: emp.id,
            date: d.date,
            status: d.fraction === 1 ? "leave" : "half_day",
            leaveTypeId: usesPaidType ? type.id : lop?.id ?? type.id,
            source: "leave",
            note: `Leave application ${app.id}`,
            markedByUserId: ctx.user.id,
          });
        }
        if (rows.length) {
          await tx
            .insert(attendanceRecords)
            .values(rows)
            .onConflictDoUpdate({
              target: [attendanceRecords.employeeId, attendanceRecords.date],
              set: { status: sql`excluded.status`, leaveTypeId: sql`excluded.leave_type_id`, source: "leave", note: sql`excluded.note`, markedByUserId: ctx.user.id, checkIn: null, checkOut: null, overtimeHours: "0", updatedAt: new Date() },
            });
        }
        if (split.paid > 0) {
          await tx.insert(leaveLedger).values({
            businessId: ctx.businessId,
            employeeId: emp.id,
            leaveTypeId: type.id,
            leaveYear,
            entryDate: app.fromDate,
            kind: "taken",
            days: String(-split.paid),
            applicationId: app.id,
            note: `${type.code} ${app.fromDate} to ${app.toDate}`,
            createdByUserId: ctx.user.id,
          });
        }
        const [row] = await tx
          .update(leaveApplications)
          .set({ status: "approved", paidDays: String(split.paid), lopDays: String(split.lop), ...decided })
          .where(eq(leaveApplications.id, app.id))
          .returning();
        return row!;
      });
    }, (r) => ({ action: `payroll.leave.${r.status === "approved" ? "approve" : "reject"}`, entityType: "leaveApplication", entityId: r.id, metadata: { paidDays: r.paidDays, lopDays: r.lopDays } })),
  ),

  /** Cancel an application. An approved one gives the balance back and clears the attendance it wrote. */
  cancel: memberProcedure.input(idInput).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "update");
      return ctx.db.transaction(async (tx) => {
        const [app] = await tx.select().from(leaveApplications).where(and(eq(leaveApplications.id, input.id), eq(leaveApplications.businessId, ctx.businessId))).for("update").limit(1);
        if (!app) throw notFound("Leave application");
        if (app.status === "cancelled" || app.status === "rejected") throw badRequest(`This application is already ${app.status}.`);
        if (app.status === "approved") {
          const days = await tx
            .select({ date: attendanceRecords.date })
            .from(attendanceRecords)
            .where(and(eq(attendanceRecords.employeeId, app.employeeId), eq(attendanceRecords.source, "leave"), eq(attendanceRecords.note, `Leave application ${app.id}`)));
          await assertAttendanceOpen(tx, ctx.businessId, days.map((d: { date: string }) => d.date));
          await tx.delete(attendanceRecords).where(and(eq(attendanceRecords.employeeId, app.employeeId), eq(attendanceRecords.source, "leave"), eq(attendanceRecords.note, `Leave application ${app.id}`)));
          if (num(app.paidDays) > 0) {
            const settings = await loadPayrollSettings(tx, ctx.businessId);
            await tx.insert(leaveLedger).values({
              businessId: ctx.businessId,
              employeeId: app.employeeId,
              leaveTypeId: app.leaveTypeId,
              leaveYear: leaveYearOf(app.fromDate, settings.leaveYearStartMonth),
              entryDate: app.fromDate,
              kind: "cancelled",
              days: String(num(app.paidDays)),
              applicationId: app.id,
              note: "Leave cancelled",
              createdByUserId: ctx.user.id,
            });
          }
        }
        const [row] = await tx.update(leaveApplications).set({ status: "cancelled", decidedByUserId: ctx.user.id, decidedByName: ctx.user.name ?? null, decidedAt: new Date() }).where(eq(leaveApplications.id, app.id)).returning();
        return row!;
      });
    }, (r) => ({ action: "payroll.leave.cancel", entityType: "leaveApplication", entityId: r.id })),
  ),

  // ── Accrual, carry-forward, encashment ──────────────────────────────────────

  /**
   * Grant leave for a month: monthly types get their monthly days, annual types
   * their yearly grant once per leave year (to everyone who has not had it yet).
   * Safe to run again: a grant is written once per employee, type and period.
   */
  accrue: memberProcedure.input(z.object({ month: z.string().refine(isPayrollMonth, "Enter a month like 2026-04.") })).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "update");
      const settings = await loadPayrollSettings(ctx.db, ctx.businessId);
      const leaveYear = leaveYearOf(`${input.month}-01`, settings.leaveYearStartMonth);
      const types = await ctx.db.select().from(leaveTypes).where(and(eq(leaveTypes.businessId, ctx.businessId), eq(leaveTypes.isActive, true)));
      const emps = await ctx.db
        .select({ id: employees.id })
        .from(employees)
        .where(and(eq(employees.businessId, ctx.businessId), lte(employees.dateOfJoining, monthEnd(input.month)), sql`(${employees.lastWorkingDay} IS NULL OR ${employees.lastWorkingDay} >= ${monthStart(input.month)})`));
      let created = 0;
      for (const t of types) {
        const days = num(t.accrualDays);
        if (t.accrualType === "none" || days <= 0 || emps.length === 0) continue;
        const periodKey = t.accrualType === "monthly" ? input.month : String(leaveYear);
        const res = await ctx.db
          .insert(leaveLedger)
          .values(emps.map((e) => ({ businessId: ctx.businessId, employeeId: e.id, leaveTypeId: t.id, leaveYear, entryDate: monthStart(input.month), kind: "accrual", days: String(days), periodKey, note: `${t.code} accrual ${periodKey}`, createdByUserId: ctx.user.id })))
          .onConflictDoNothing()
          .returning({ id: leaveLedger.id });
        created += res.length;
      }
      return { created, leaveYear };
    }, (r, input) => ({ action: "payroll.leave.accrue", entityType: "leaveLedger", entityId: null, metadata: { month: input.month, created: r.created } })),
  ),

  /**
   * Close a leave year: each balance is carried into the next year up to the
   * leave type's maximum (when it carries forward) and the rest lapses. Run it
   * once at the end of the year; running it again changes nothing.
   */
  closeYear: memberProcedure.input(z.object({ leaveYear: z.number().int().min(2000).max(2200) })).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "update");
      const settings = await loadPayrollSettings(ctx.db, ctx.businessId);
      const types = await ctx.db.select().from(leaveTypes).where(eq(leaveTypes.businessId, ctx.businessId));
      const sums = await ctx.db
        .select({ employeeId: leaveLedger.employeeId, leaveTypeId: leaveLedger.leaveTypeId, n: sql<string>`SUM(${leaveLedger.days})::text` })
        .from(leaveLedger)
        .where(and(eq(leaveLedger.businessId, ctx.businessId), eq(leaveLedger.leaveYear, input.leaveYear)))
        .groupBy(leaveLedger.employeeId, leaveLedger.leaveTypeId);
      const typeById = new Map(types.map((t) => [t.id, t]));
      const periodKey = `close:${input.leaveYear}`;
      const nextStart = `${input.leaveYear + 1}-${String(settings.leaveYearStartMonth).padStart(2, "0")}-01`;
      const yearEnd = `${input.leaveYear + 1}-${String(settings.leaveYearStartMonth).padStart(2, "0")}-01`;
      let carried = 0;
      let lapsed = 0;
      for (const s of sums) {
        const balance = num(s.n);
        const t = typeById.get(s.leaveTypeId);
        if (!t || balance <= 0) continue;
        const cf = carryForward(balance, { carryForward: t.carryForward, carryForwardMax: num(t.carryForwardMax) });
        const closed = await ctx.db
          .insert(leaveLedger)
          .values({ businessId: ctx.businessId, employeeId: s.employeeId, leaveTypeId: s.leaveTypeId, leaveYear: input.leaveYear, entryDate: yearEnd, kind: "closing", days: String(-balance), periodKey, note: `Closed ${input.leaveYear}: ${cf.carried} carried, ${cf.lapsed} lapsed`, createdByUserId: ctx.user.id })
          .onConflictDoNothing()
          .returning({ id: leaveLedger.id });
        if (closed.length === 0) continue;
        lapsed += cf.lapsed;
        if (cf.carried > 0) {
          await ctx.db
            .insert(leaveLedger)
            .values({ businessId: ctx.businessId, employeeId: s.employeeId, leaveTypeId: s.leaveTypeId, leaveYear: input.leaveYear + 1, entryDate: nextStart, kind: "carry_forward", days: String(cf.carried), periodKey, note: `Carried from ${input.leaveYear}`, createdByUserId: ctx.user.id })
            .onConflictDoNothing();
          carried += cf.carried;
        }
      }
      return { carried, lapsed };
    }, (r, input) => ({ action: "payroll.leave.closeYear", entityType: "leaveLedger", entityId: null, metadata: { leaveYear: input.leaveYear, carried: r.carried, lapsed: r.lapsed } })),
  ),

  /**
   * Encash leave: the days leave the balance and the amount you enter is added
   * as an earning to the employee's next payroll run.
   */
  encash: memberProcedure.input(leaveEncashSchema).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "update");
      await assertInBusiness(ctx.db, employees, input.employeeId, ctx.businessId, "Employee");
      const [type] = await ctx.db.select().from(leaveTypes).where(and(eq(leaveTypes.id, input.leaveTypeId), eq(leaveTypes.businessId, ctx.businessId))).limit(1);
      if (!type) throw notFound("Leave type");
      if (!type.encashable) throw badRequest(`${type.name} cannot be encashed. Turn on encashment for the leave type first.`);
      const settings = await loadPayrollSettings(ctx.db, ctx.businessId);
      const leaveYear = leaveYearOf(new Date().toISOString().slice(0, 10), settings.leaveYearStartMonth);
      return ctx.db.transaction(async (tx) => {
        const bal = await balanceOf(tx, input.employeeId, type.id, leaveYear);
        if (input.days > bal) throw badRequest(`Only ${bal} day${bal === 1 ? "" : "s"} of ${type.code} left to encash.`);
        const [enc] = await tx
          .insert(leaveEncashments)
          .values({ businessId: ctx.businessId, employeeId: input.employeeId, leaveTypeId: type.id, days: String(input.days), amount: paiseToRupees(rupeesToPaise(input.amount)), note: input.note || null, createdByUserId: ctx.user.id })
          .returning();
        await tx.insert(leaveLedger).values({
          businessId: ctx.businessId,
          employeeId: input.employeeId,
          leaveTypeId: type.id,
          leaveYear,
          entryDate: new Date().toISOString().slice(0, 10),
          kind: "encashment",
          days: String(-input.days),
          note: `${type.code} encashed`,
          createdByUserId: ctx.user.id,
        });
        return enc!;
      });
    }, (r) => ({ action: "payroll.leave.encash", entityType: "leaveEncashment", entityId: r.id, metadata: { days: r.days } })),
  ),

  /** Encashments waiting for the next payroll run. */
  encashments: viewerProcedure.query(async ({ ctx }) => {
    await assertPayroll(ctx, "read");
    return ctx.db
      .select({ enc: leaveEncashments, employeeName: employees.name, employeeCode: employees.employeeCode, leaveCode: leaveTypes.code })
      .from(leaveEncashments)
      .innerJoin(employees, eq(employees.id, leaveEncashments.employeeId))
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveEncashments.leaveTypeId))
      .where(eq(leaveEncashments.businessId, ctx.businessId))
      .orderBy(desc(leaveEncashments.createdAt))
      .limit(100)
      .then((rows) => rows.map((r) => ({ ...r.enc, employeeName: r.employeeName, employeeCode: r.employeeCode, leaveCode: r.leaveCode })));
  }),
});
