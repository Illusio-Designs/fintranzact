/**
 * Payroll Phase 3, HR side of self-service: employee logins (invite, resend, remove) and releasing Form 16
 * to employees. Needs Payroll "update" and the Payroll add-on like the rest of Payroll (HR, accountants,
 * owners and admins). The employee side is payrollSelf.
 */

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { employees, form16Releases, payrollRuns } from "@fintranzact/db";
import { employeeInviteSchema, fyLabel, fyStartYearOfMonth } from "@fintranzact/shared";
import { router, viewerProcedure, memberProcedure } from "../trpc.js";
import { withAudit } from "../lib/audit.js";
import { assertPayroll, notFound } from "../lib/payroll/access.js";
import { inviteEmployee, loginStatuses, revokeEmployeeAccess } from "../lib/payroll/employee-access.js";

const employeeInput = z.object({ employeeId: z.string().uuid() });
const yearInput = z.object({ financialYear: z.number().int().min(2020).max(2100) });

export const payrollAccessRouter = router({
  /** Every current employee with the state of their login: none, invited (pending, with expiry) or active. */
  loginList: viewerProcedure.query(async ({ ctx }) => {
    await assertPayroll(ctx, "read");
    const [rows, states] = await Promise.all([
      ctx.db
        .select({ id: employees.id, code: employees.employeeCode, name: employees.name, email: employees.email })
        .from(employees)
        .where(and(eq(employees.businessId, ctx.businessId), eq(employees.status, "active")))
        .orderBy(asc(employees.employeeCode)),
      loginStatuses(ctx.db, ctx.tenantId, ctx.businessId),
    ]);
    return rows.map((e) => {
      const s = states.get(e.id);
      return { employeeId: e.id, code: e.code, name: e.name, email: e.email, state: s?.state ?? ("none" as const), loginEmail: s?.email ?? null, invitationExpiresAt: s?.invitationExpiresAt ?? null, linkedAt: s?.linkedAt ?? null };
    });
  }),

  /**
   * Invite an employee to the employee app by email (also used to resend: a pending invitation is replaced and
   * its old link stops working). The login uses no team seat. The link expires in 7 days and works once.
   */
  invite: memberProcedure.input(employeeInviteSchema).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "update");
      const r = await inviteEmployee({
        tenantId: ctx.tenantId,
        db: ctx.db,
        businessId: ctx.businessId,
        employeeId: input.employeeId,
        email: input.email,
        inviter: { id: ctx.user.id, name: ctx.user.name ?? null },
        ip: ctx.ipAddress,
        userAgent: ctx.req.headers.get("user-agent"),
      });
      return { employeeId: input.employeeId, inviteUrl: r.inviteUrl, expiresAt: r.expiresAt, replaced: r.replaced };
      // inviteEmployee writes its own audit entry (with the invitation facts); nothing more to add here.
    }, () => null),
  ),

  /** Remove an employee's login: the link, their access to the business, and a pending invitation. Their records stay. */
  revokeLogin: memberProcedure.input(employeeInput).mutation(async ({ ctx, input }) => {
    await assertPayroll(ctx, "update");
    const [emp] = await ctx.db.select({ id: employees.id }).from(employees).where(and(eq(employees.id, input.employeeId), eq(employees.businessId, ctx.businessId))).limit(1);
    if (!emp) throw notFound("Employee");
    const r = await revokeEmployeeAccess({
      tenantId: ctx.tenantId,
      db: ctx.db,
      businessId: ctx.businessId,
      employeeId: emp.id,
      actor: { id: ctx.user.id },
      reason: "removed",
      ip: ctx.ipAddress,
      userAgent: ctx.req.headers.get("user-agent"),
    });
    return { employeeId: emp.id, ...r };
  }),

  // ── Form 16 release ─────────────────────────────────────────────────────────

  /** Financial years with approved payroll, and whether each Form 16 working copy has been released to employees. */
  form16List: viewerProcedure.query(async ({ ctx }) => {
    await assertPayroll(ctx, "read");
    const [runs, released] = await Promise.all([
      ctx.db.select({ month: payrollRuns.month }).from(payrollRuns).where(and(eq(payrollRuns.businessId, ctx.businessId), inArray(payrollRuns.status, ["approved", "posted", "paid"]))),
      ctx.db.select().from(form16Releases).where(eq(form16Releases.businessId, ctx.businessId)).orderBy(desc(form16Releases.financialYear)),
    ]);
    const years = new Set([...runs.map((r) => fyStartYearOfMonth(r.month)), ...released.map((r) => r.financialYear)]);
    const at = new Map(released.map((r) => [r.financialYear, r.releasedAt]));
    return [...years]
      .sort((a, b) => b - a)
      .map((y) => ({ financialYear: y, label: fyLabel(y), released: at.has(y), releasedAt: at.get(y) ?? null }));
  }),

  /** Let employees download their own Form 16 working copy for a year. It stays labelled as a working copy for CA review. */
  form16Release: memberProcedure.input(yearInput).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "update");
      await ctx.db
        .insert(form16Releases)
        .values({ businessId: ctx.businessId, financialYear: input.financialYear, releasedByUserId: ctx.user.id })
        .onConflictDoNothing();
      return { financialYear: input.financialYear };
    }, (r) => ({ action: "payroll.form16.release", entityType: "form16", entityId: null, metadata: { financialYear: r.financialYear } })),
  ),

  /** Take a year's Form 16 back from employees (they can no longer download it). */
  form16Unrelease: memberProcedure.input(yearInput).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "update");
      await ctx.db.delete(form16Releases).where(and(eq(form16Releases.businessId, ctx.businessId), eq(form16Releases.financialYear, input.financialYear)));
      return { financialYear: input.financialYear };
    }, (r) => ({ action: "payroll.form16.unrelease", entityType: "form16", entityId: null, metadata: { financialYear: r.financialYear } })),
  ),
});
