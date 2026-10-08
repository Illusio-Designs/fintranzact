/**
 * Payroll: the employee master, departments, designations and shifts.
 *
 * Every procedure needs the Payroll add-on and the Payroll permission (see
 * lib/payroll/access.ts). Lists show identity and bank numbers masked; only the
 * detail view returns them in full, and only to a role with Payroll "manage".
 * Identity numbers never reach logs or the audit trail: audit entries carry the
 * employee code and the NAMES of the fields that changed.
 */

import { and, asc, count, eq, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { employees, fnfSettlements, payrollDepartments, payrollDesignations, payrollShifts } from "@fintranzact/db";
import {
  departmentInputSchema,
  designationInputSchema,
  employeeExitSchema,
  employeeFieldsSchema,
  employeeListSchema,
  employeeUpdateSchema,
  shiftSchema,
} from "@fintranzact/shared";
import { router, viewerProcedure, memberProcedure } from "../trpc.js";
import { withAudit } from "../lib/audit.js";
import { assertInBusiness } from "../lib/business-scope.js";
import { escapeLike } from "../lib/escape-like.js";
import { getEntitlements } from "../lib/entitlements.js";
import { assertPayroll, badRequest, canSeeSensitive, countOrganisationActiveEmployees, enforceEmployeeCap, isUniqueViolation, notFound } from "../lib/payroll/access.js";
import { blankToNull, changedFieldNames, employeeDetail, employeeListItem } from "../lib/payroll/data.js";
import { revokeEmployeeAccess } from "../lib/payroll/employee-access.js";

const idInput = z.object({ id: z.string().uuid() });

/** Form fields -> columns: blanks become null, everything else is kept as sent. */
function toColumns(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined || k === "id") continue;
    out[k] = blankToNull(v);
  }
  return out;
}

export const payrollEmployeeRouter = router({
  list: viewerProcedure.input(employeeListSchema).query(async ({ ctx, input }) => {
    await assertPayroll(ctx, "read");
    const conds = [eq(employees.businessId, ctx.businessId)];
    if (input.status !== "all") conds.push(eq(employees.status, input.status));
    if (input.departmentId) conds.push(eq(employees.departmentId, input.departmentId));
    if (input.search) {
      const like = `%${escapeLike(input.search)}%`;
      conds.push(or(ilike(employees.name, like), ilike(employees.employeeCode, like))!);
    }
    const where = and(...conds);
    const [rows, [total]] = await Promise.all([
      ctx.db
        .select({
          e: employees,
          department: payrollDepartments.name,
          designation: payrollDesignations.name,
        })
        .from(employees)
        .leftJoin(payrollDepartments, eq(payrollDepartments.id, employees.departmentId))
        .leftJoin(payrollDesignations, eq(payrollDesignations.id, employees.designationId))
        .where(where)
        .orderBy(asc(employees.employeeCode))
        .limit(input.limit)
        .offset((input.page - 1) * input.limit),
      ctx.db.select({ n: count() }).from(employees).where(where),
    ]);
    return { data: rows.map((r) => employeeListItem(r.e, r)), total: total?.n ?? 0, page: input.page, limit: input.limit };
  }),

  /** One employee. Full identity and bank numbers only for roles with Payroll "manage"; masked for everyone else. */
  get: viewerProcedure.input(idInput).query(async ({ ctx, input }) => {
    await assertPayroll(ctx, "read");
    const [row] = await ctx.db.select().from(employees).where(and(eq(employees.id, input.id), eq(employees.businessId, ctx.businessId))).limit(1);
    if (!row) throw notFound("Employee");
    return employeeDetail(row, { full: canSeeSensitive(ctx.ability) });
  }),

  /** How many employees count toward the trial cap, and the cap (null outside a trial). */
  capacity: viewerProcedure.query(async ({ ctx }) => {
    await assertPayroll(ctx, "read");
    const ent = await getEntitlements(ctx.tenantId);
    const active = await countOrganisationActiveEmployees(ctx.tenantId, ctx.db);
    return { active, cap: ent.trial.active && ent.trial.caps ? ent.trial.caps.payrollEmployees : null };
  }),

  create: memberProcedure.input(employeeFieldsSchema).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "create");
      await enforceEmployeeCap(ctx.tenantId, ctx.db, 1);
      await assertInBusiness(ctx.db, payrollDepartments, input.departmentId, ctx.businessId, "Department");
      await assertInBusiness(ctx.db, payrollDesignations, input.designationId, ctx.businessId, "Designation");
      await assertInBusiness(ctx.db, payrollShifts, input.shiftId, ctx.businessId, "Shift");
      await assertInBusiness(ctx.db, employees, input.managerId, ctx.businessId, "Manager");
      try {
        const [row] = await ctx.db
          .insert(employees)
          .values({ ...(toColumns(input) as typeof employees.$inferInsert), businessId: ctx.businessId, createdByUserId: ctx.user.id })
          .returning();
        return employeeDetail(row!, { full: canSeeSensitive(ctx.ability) });
      } catch (e) {
        if (isUniqueViolation(e)) throw new TRPCError({ code: "CONFLICT", message: `An employee with code ${input.employeeCode} already exists.` });
        throw e;
      }
    }, (r) => ({ action: "payroll.employee.create", entityType: "employee", entityId: r.id, metadata: { employeeCode: r.employeeCode } })),
  ),

  update: memberProcedure.input(employeeUpdateSchema).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "update");
      const [existing] = await ctx.db.select().from(employees).where(and(eq(employees.id, input.id), eq(employees.businessId, ctx.businessId))).limit(1);
      if (!existing) throw notFound("Employee");
      await assertInBusiness(ctx.db, payrollDepartments, input.departmentId, ctx.businessId, "Department");
      await assertInBusiness(ctx.db, payrollDesignations, input.designationId, ctx.businessId, "Designation");
      await assertInBusiness(ctx.db, payrollShifts, input.shiftId, ctx.businessId, "Shift");
      await assertInBusiness(ctx.db, employees, input.managerId, ctx.businessId, "Manager");
      if (input.managerId === input.id) throw badRequest("An employee cannot be their own manager.");
      try {
        const [row] = await ctx.db
          .update(employees)
          .set({ ...(toColumns(input) as Partial<typeof employees.$inferInsert>), updatedAt: new Date() })
          .where(and(eq(employees.id, input.id), eq(employees.businessId, ctx.businessId)))
          .returning();
        return { employee: employeeDetail(row!, { full: canSeeSensitive(ctx.ability) }), fields: changedFieldNames(input) };
      } catch (e) {
        if (isUniqueViolation(e)) throw new TRPCError({ code: "CONFLICT", message: `An employee with code ${input.employeeCode} already exists.` });
        throw e;
      }
    }, (r) => ({ action: "payroll.employee.update", entityType: "employee", entityId: r.employee.id, metadata: { employeeCode: r.employee.employeeCode, fields: r.fields } })),
  ),

  /**
   * An employee leaves: last working day, reason, and a note for the full and
   * final settlement. They stay on file; payroll pays them up to the last
   * working day and the run that settles that month is linked to them as their
   * full and final run when it is approved.
   */
  exit: memberProcedure.input(employeeExitSchema).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "update");
      const [existing] = await ctx.db.select().from(employees).where(and(eq(employees.id, input.id), eq(employees.businessId, ctx.businessId))).limit(1);
      if (!existing) throw notFound("Employee");
      if (input.lastWorkingDay < existing.dateOfJoining) throw badRequest("The last working day cannot be before the joining date.");
      const [row] = await ctx.db
        .update(employees)
        .set({
          status: "exited",
          lastWorkingDay: input.lastWorkingDay,
          exitReason: input.reason,
          exitNote: blankToNull(input.note),
          fnfNote: blankToNull(input.fnfNote),
          fnfPayrollRunId: null,
          updatedAt: new Date(),
        })
        .where(eq(employees.id, existing.id))
        .returning();
      // A person who has left no longer signs in to the employee app (payslips and Form 16 reach them from HR).
      await revokeEmployeeAccess({
        tenantId: ctx.tenantId,
        db: ctx.db,
        businessId: ctx.businessId,
        employeeId: existing.id,
        actor: { id: ctx.user.id },
        reason: "exited",
        ip: ctx.ipAddress,
        userAgent: ctx.req.headers.get("user-agent"),
      });
      return employeeDetail(row!, { full: canSeeSensitive(ctx.ability) });
    }, (r) => ({ action: "payroll.employee.exit", entityType: "employee", entityId: r.id, metadata: { employeeCode: r.employeeCode, reason: r.exitReason, lastWorkingDay: r.lastWorkingDay } })),
  ),

  /** Bring a former employee back (counts toward the trial cap again). */
  reactivate: memberProcedure.input(idInput).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "update");
      const [existing] = await ctx.db.select().from(employees).where(and(eq(employees.id, input.id), eq(employees.businessId, ctx.businessId))).limit(1);
      if (!existing) throw notFound("Employee");
      if (existing.status === "active") return employeeDetail(existing, { full: canSeeSensitive(ctx.ability) });
      // A full and final settlement that is more than a draft is final: bringing the employee back would pay them twice.
      const [fnf] = await ctx.db.select({ id: fnfSettlements.id, status: fnfSettlements.status }).from(fnfSettlements).where(and(eq(fnfSettlements.employeeId, existing.id), eq(fnfSettlements.businessId, ctx.businessId))).limit(1);
      if (fnf && fnf.status !== "draft") throw badRequest("This employee's full and final settlement is already in progress or settled, so the employee cannot be brought back.");
      await enforceEmployeeCap(ctx.tenantId, ctx.db, 1);
      const [row] = await ctx.db
        .update(employees)
        .set({ status: "active", lastWorkingDay: null, exitReason: null, exitNote: null, fnfNote: null, fnfPayrollRunId: null, updatedAt: new Date() })
        .where(eq(employees.id, existing.id))
        .returning();
      // A draft settlement belongs to the exit that was just undone.
      if (fnf) await ctx.db.delete(fnfSettlements).where(eq(fnfSettlements.id, fnf.id));
      return employeeDetail(row!, { full: canSeeSensitive(ctx.ability) });
    }, (r) => ({ action: "payroll.employee.reactivate", entityType: "employee", entityId: r.id, metadata: { employeeCode: r.employeeCode } })),
  ),

  // ── Departments, designations, shifts ───────────────────────────────────────

  departmentList: viewerProcedure.query(async ({ ctx }) => {
    await assertPayroll(ctx, "read");
    return ctx.db
      .select({
        id: payrollDepartments.id,
        name: payrollDepartments.name,
        isActive: payrollDepartments.isActive,
        employeeCount: sql<number>`(SELECT count(*)::int FROM employees e WHERE e.department_id = payroll_departments.id AND e.status = 'active')`,
      })
      .from(payrollDepartments)
      .where(eq(payrollDepartments.businessId, ctx.businessId))
      .orderBy(asc(payrollDepartments.name));
  }),

  departmentCreate: memberProcedure.input(departmentInputSchema).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "create");
      try {
        const [row] = await ctx.db.insert(payrollDepartments).values({ businessId: ctx.businessId, name: input.name }).returning();
        return row!;
      } catch (e) {
        if (isUniqueViolation(e)) throw new TRPCError({ code: "CONFLICT", message: `There is already a department called ${input.name}.` });
        throw e;
      }
    }, (r) => ({ action: "payroll.department.create", entityType: "payrollDepartment", entityId: r.id })),
  ),

  departmentUpdate: memberProcedure.input(departmentInputSchema.extend({ id: z.string().uuid(), isActive: z.boolean().optional() })).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "update");
      const [row] = await ctx.db
        .update(payrollDepartments)
        .set({ name: input.name, ...(input.isActive === undefined ? {} : { isActive: input.isActive }) })
        .where(and(eq(payrollDepartments.id, input.id), eq(payrollDepartments.businessId, ctx.businessId)))
        .returning();
      if (!row) throw notFound("Department");
      return row;
    }, (r) => ({ action: "payroll.department.update", entityType: "payrollDepartment", entityId: r.id })),
  ),

  designationList: viewerProcedure.query(async ({ ctx }) => {
    await assertPayroll(ctx, "read");
    return ctx.db
      .select({
        id: payrollDesignations.id,
        name: payrollDesignations.name,
        isActive: payrollDesignations.isActive,
        employeeCount: sql<number>`(SELECT count(*)::int FROM employees e WHERE e.designation_id = payroll_designations.id AND e.status = 'active')`,
      })
      .from(payrollDesignations)
      .where(eq(payrollDesignations.businessId, ctx.businessId))
      .orderBy(asc(payrollDesignations.name));
  }),

  designationCreate: memberProcedure.input(designationInputSchema).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "create");
      try {
        const [row] = await ctx.db.insert(payrollDesignations).values({ businessId: ctx.businessId, name: input.name }).returning();
        return row!;
      } catch (e) {
        if (isUniqueViolation(e)) throw new TRPCError({ code: "CONFLICT", message: `There is already a designation called ${input.name}.` });
        throw e;
      }
    }, (r) => ({ action: "payroll.designation.create", entityType: "payrollDesignation", entityId: r.id })),
  ),

  designationUpdate: memberProcedure.input(designationInputSchema.extend({ id: z.string().uuid(), isActive: z.boolean().optional() })).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "update");
      const [row] = await ctx.db
        .update(payrollDesignations)
        .set({ name: input.name, ...(input.isActive === undefined ? {} : { isActive: input.isActive }) })
        .where(and(eq(payrollDesignations.id, input.id), eq(payrollDesignations.businessId, ctx.businessId)))
        .returning();
      if (!row) throw notFound("Designation");
      return row;
    }, (r) => ({ action: "payroll.designation.update", entityType: "payrollDesignation", entityId: r.id })),
  ),

  shiftList: viewerProcedure.query(async ({ ctx }) => {
    await assertPayroll(ctx, "read");
    return ctx.db.select().from(payrollShifts).where(eq(payrollShifts.businessId, ctx.businessId)).orderBy(asc(payrollShifts.name));
  }),

  shiftCreate: memberProcedure.input(shiftSchema).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "create");
      try {
        const [row] = await ctx.db
          .insert(payrollShifts)
          .values({ businessId: ctx.businessId, name: input.name, startTime: input.startTime, endTime: input.endTime, weeklyOffDays: input.weeklyOffDays, standardHours: String(input.standardHours) })
          .returning();
        return row!;
      } catch (e) {
        if (isUniqueViolation(e)) throw new TRPCError({ code: "CONFLICT", message: `There is already a shift called ${input.name}.` });
        throw e;
      }
    }, (r) => ({ action: "payroll.shift.create", entityType: "payrollShift", entityId: r.id })),
  ),

  shiftUpdate: memberProcedure.input(shiftSchema.extend({ id: z.string().uuid(), isActive: z.boolean().optional() })).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "update");
      const [row] = await ctx.db
        .update(payrollShifts)
        .set({
          name: input.name,
          startTime: input.startTime,
          endTime: input.endTime,
          weeklyOffDays: input.weeklyOffDays,
          standardHours: String(input.standardHours),
          ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
        })
        .where(and(eq(payrollShifts.id, input.id), eq(payrollShifts.businessId, ctx.businessId)))
        .returning();
      if (!row) throw notFound("Shift");
      return row;
    }, (r) => ({ action: "payroll.shift.update", entityType: "payrollShift", entityId: r.id })),
  ),
});
