/**
 * Leave applications, shared by HR (payrollLeave.request) and employee self-service
 * (payrollSelf.leaveApply): the same checks, the same row, the same approval afterwards
 * (payrollLeave.decide). Plus the notices, which use the existing email notice mechanism.
 */

import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  controlDb,
  employeeLogins,
  employees,
  leaveApplications,
  leaveTypes,
  payrollHolidays,
  payrollShifts,
  tenantMembers,
  users,
  type TenantDatabase,
} from "@fintranzact/db";
import { countLeaveDays, formatPayrollMonth, type leaveApplySchema } from "@fintranzact/shared";
import type { z } from "zod";
import { emailService } from "../email.js";
import { logger } from "../logger.js";
import { badRequest, notFound } from "./access.js";
import { holidayDatesFor, loadPayrollSettings } from "./data.js";

type Reader = Pick<TenantDatabase, "select">;

/** Weekly offs and the holidays that apply to an employee between two dates. */
export async function employeeCalendar(tx: Reader, businessId: string, emp: typeof employees.$inferSelect, from: string, to: string) {
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

export type LeaveApplyInput = z.infer<typeof leaveApplySchema>;

/** Create a pending leave application for an employee of the business. */
export async function createLeaveApplication(
  db: TenantDatabase,
  args: { businessId: string; input: LeaveApplyInput; createdByUserId: string },
) {
  const { businessId, input } = args;
  const [emp] = await db.select().from(employees).where(and(eq(employees.id, input.employeeId), eq(employees.businessId, businessId))).limit(1);
  if (!emp) throw notFound("Employee");
  const [type] = await db.select().from(leaveTypes).where(and(eq(leaveTypes.id, input.leaveTypeId), eq(leaveTypes.businessId, businessId))).limit(1);
  if (!type) throw notFound("Leave type");
  if (!type.isActive) throw badRequest("That leave type is not in use any more.");
  if (input.fromDate < emp.dateOfJoining) throw badRequest("The leave starts before the employee's joining date.");
  if (emp.lastWorkingDay && input.toDate > emp.lastWorkingDay) throw badRequest("The leave ends after the employee's last working day.");
  const cal = await employeeCalendar(db, businessId, emp, input.fromDate, input.toDate);
  const counted = countLeaveDays({ from: input.fromDate, to: input.toDate, weeklyOffDays: cal.weeklyOffDays, holidays: cal.holidays, halfDayStart: input.halfDayStart, halfDayEnd: input.halfDayEnd });
  if (counted.days <= 0) throw badRequest("Those dates are all weekly offs or holidays, so no leave is needed.");
  const [overlap] = await db
    .select({ id: leaveApplications.id })
    .from(leaveApplications)
    .where(and(eq(leaveApplications.employeeId, emp.id), inArray(leaveApplications.status, ["pending", "approved"]), lte(leaveApplications.fromDate, input.toDate), gte(leaveApplications.toDate, input.fromDate)))
    .limit(1);
  if (overlap) throw new TRPCError({ code: "CONFLICT", message: "This employee already has leave for some of those dates." });
  const [row] = await db
    .insert(leaveApplications)
    .values({
      businessId,
      employeeId: emp.id,
      leaveTypeId: type.id,
      fromDate: input.fromDate,
      toDate: input.toDate,
      halfDayStart: input.halfDayStart,
      halfDayEnd: input.halfDayEnd,
      days: String(counted.days),
      reason: input.reason || null,
      createdByUserId: args.createdByUserId,
    })
    .returning();
  return { application: row!, employee: emp, leaveTypeName: type.name };
}

// ── Notices (existing email notice mechanism; best effort, never fails the action) ───────────────

async function emailsOfEmployee(db: Reader, emp: { id: string; email: string | null }): Promise<string[]> {
  const out = new Set<string>();
  if (emp.email) out.add(emp.email);
  const [login] = await db.select({ userId: employeeLogins.userId }).from(employeeLogins).where(eq(employeeLogins.employeeId, emp.id)).limit(1);
  if (login) {
    const [u] = await controlDb.select({ email: users.email }).from(users).where(eq(users.id, login.userId)).limit(1);
    if (u?.email) out.add(u.email);
  }
  return [...out];
}

/** The people who decide leave: owners, admins and HR of the organisation. */
async function deciderEmails(tenantId: string): Promise<string[]> {
  const rows = await controlDb
    .select({ email: users.email })
    .from(tenantMembers)
    .innerJoin(users, eq(users.id, tenantMembers.userId))
    .where(and(eq(tenantMembers.tenantId, tenantId), inArray(tenantMembers.role, ["owner", "superadmin", "admin", "hr"])))
    .limit(20);
  return rows.map((r) => r.email).filter((e): e is string => !!e);
}

const clean = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

export async function notifyLeaveRequested(
  tenantId: string,
  info: { employeeName: string; leaveTypeName: string; fromDate: string; toDate: string; days: string },
): Promise<void> {
  try {
    const subject = `Leave request from ${clean(info.employeeName)}`;
    const text = `${clean(info.employeeName)} has applied for ${info.days} day(s) of ${clean(info.leaveTypeName)} from ${info.fromDate} to ${info.toDate}.\n\nOpen Payroll, Leave in Fintranzact to approve or reject it.`;
    for (const to of await deciderEmails(tenantId)) await emailService.sendNotice(to, subject, text).catch(() => undefined);
  } catch (err) {
    logger.error({ err }, "Leave request notice failed");
  }
}

export async function notifyLeaveDecided(
  db: Reader,
  info: { employee: { id: string; email: string | null; name: string }; decision: "approved" | "rejected" | "cancelled"; fromDate: string; toDate: string; note: string | null; month?: string },
): Promise<void> {
  try {
    const verb = info.decision === "approved" ? "approved" : info.decision === "rejected" ? "not approved" : "cancelled";
    const subject = `Your leave request was ${verb}`;
    const text = [
      `Hello ${clean(info.employee.name)},`,
      "",
      `Your leave from ${info.fromDate} to ${info.toDate} was ${verb}.`,
      ...(info.note ? ["", `Note from HR: ${clean(info.note)}`] : []),
      ...(info.month ? ["", formatPayrollMonth(info.month)] : []),
    ].join("\n");
    for (const to of await emailsOfEmployee(db, info.employee)) await emailService.sendNotice(to, subject, text).catch(() => undefined);
  } catch (err) {
    logger.error({ err }, "Leave decision notice failed");
  }
}
