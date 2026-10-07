/**
 * Payroll: salary components, templates and each employee's salary (annual CTC
 * to monthly amounts, effective-dated).
 *
 * The arithmetic is computeSalaryBreakdown in @fintranzact/shared. An
 * assignment stores a SNAPSHOT of the monthly breakdown, so later changes to a
 * template or a component never change what an employee was assigned.
 */

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { employeeSalaryAssignments, employees, salaryComponents, salaryTemplateLines, salaryTemplates, type TenantDatabase } from "@fintranzact/db";
import {
  PayrollRuleError,
  computeSalaryBreakdown,
  paiseToRupees,
  rupeesToPaise,
  salaryAssignSchema,
  salaryComponentSchema,
  salaryPreviewSchema,
  salaryTemplateSchema,
  type CalcType,
  type ComponentCategory,
  type ComponentType,
  type SalaryBreakdown,
  type SalaryLineDef,
} from "@fintranzact/shared";
import { router, viewerProcedure, memberProcedure } from "../trpc.js";
import { withAudit } from "../lib/audit.js";
import { assertPayroll, badRequest, isUniqueViolation, notFound } from "../lib/payroll/access.js";

const idInput = z.object({ id: z.string().uuid() });

type ComponentRow = typeof salaryComponents.$inferSelect;

interface LineInput {
  componentId: string;
  calcType: CalcType;
  value: number;
}

/** The standard components a new business starts with (the owner can edit or add to them). */
const DEFAULT_COMPONENTS: Array<Pick<ComponentRow, "code" | "name" | "type" | "category" | "prorate" | "isWage" | "sortOrder">> = [
  { code: "BASIC", name: "Basic", type: "earning", category: "basic", prorate: true, isWage: true, sortOrder: 10 },
  { code: "DA", name: "Dearness allowance", type: "earning", category: "da", prorate: true, isWage: true, sortOrder: 20 },
  { code: "RETAIN", name: "Retaining allowance", type: "earning", category: "retaining_allowance", prorate: true, isWage: true, sortOrder: 25 },
  { code: "HRA", name: "House rent allowance", type: "earning", category: "hra", prorate: true, isWage: false, sortOrder: 30 },
  { code: "CONV", name: "Conveyance", type: "earning", category: "conveyance", prorate: true, isWage: false, sortOrder: 40 },
  { code: "SPECIAL", name: "Special allowance", type: "earning", category: "special_allowance", prorate: true, isWage: false, sortOrder: 50 },
  { code: "BONUS", name: "Bonus", type: "earning", category: "bonus", prorate: false, isWage: false, sortOrder: 60 },
  { code: "INCENTIVE", name: "Incentive", type: "earning", category: "incentive", prorate: false, isWage: false, sortOrder: 70 },
  { code: "ADVANCE", name: "Advance recovery", type: "deduction", category: "advance_recovery", prorate: false, isWage: false, sortOrder: 200 },
  { code: "OTHERDED", name: "Other deduction", type: "deduction", category: "other_deduction", prorate: false, isWage: false, sortOrder: 210 },
];

function toDef(c: ComponentRow, line: LineInput): SalaryLineDef {
  return {
    componentId: c.id,
    code: c.code,
    name: c.name,
    type: c.type as ComponentType,
    category: c.category as ComponentCategory,
    isWage: c.isWage,
    prorate: c.prorate,
    statutoryKind: null,
    calcType: line.calcType,
    value: line.value,
  };
}

async function loadComponents(db: TenantDatabase, businessId: string, ids: string[]): Promise<Map<string, ComponentRow>> {
  const rows = ids.length
    ? await db.select().from(salaryComponents).where(and(eq(salaryComponents.businessId, businessId), inArray(salaryComponents.id, ids)))
    : [];
  const map = new Map(rows.map((r) => [r.id, r]));
  for (const id of ids) if (!map.has(id)) throw badRequest("A component in the list was not found in this business.");
  return map;
}

function compute(annualCtcRupees: number, defs: SalaryLineDef[]): SalaryBreakdown {
  try {
    return computeSalaryBreakdown({ annualCtcPaise: rupeesToPaise(annualCtcRupees), lines: defs });
  } catch (e) {
    if (e instanceof PayrollRuleError) throw badRequest(e.message);
    throw e;
  }
}

/** A breakdown as the API returns it: money as rupee strings. */
function presentBreakdown(b: SalaryBreakdown) {
  return {
    annualCtc: paiseToRupees(b.annualCtcPaise),
    monthlyCtc: paiseToRupees(b.monthlyCtcPaise),
    gross: paiseToRupees(b.grossPaise),
    employerContributions: paiseToRupees(b.employerPaise),
    deductions: paiseToRupees(b.deductionsPaise),
    takeHome: paiseToRupees(b.takeHomePaise),
    unallocated: paiseToRupees(b.unallocatedPaise),
    wages: paiseToRupees(b.wagesPaise),
    wagePercent: b.wagePercent,
    warnings: b.warnings,
    lines: b.lines.map((l) => ({
      componentId: l.componentId ?? null,
      code: l.code,
      name: l.name,
      type: l.type,
      category: l.category,
      isWage: l.isWage,
      prorate: l.prorate,
      calcType: l.calcType,
      value: l.value,
      monthly: paiseToRupees(l.monthlyPaise),
    })),
  };
}

export const payrollSalaryRouter = router({
  // ── Components ──────────────────────────────────────────────────────────────

  componentList: viewerProcedure.query(async ({ ctx }) => {
    await assertPayroll(ctx, "read");
    return ctx.db.select().from(salaryComponents).where(eq(salaryComponents.businessId, ctx.businessId)).orderBy(asc(salaryComponents.sortOrder), asc(salaryComponents.name));
  }),

  componentCreate: memberProcedure.input(salaryComponentSchema).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "create");
      try {
        const [row] = await ctx.db
          .insert(salaryComponents)
          .values({ businessId: ctx.businessId, code: input.code, name: input.name, type: input.type, category: input.category, prorate: input.prorate, isWage: input.isWage, statutoryKind: null, sortOrder: input.sortOrder })
          .returning();
        return row!;
      } catch (e) {
        if (isUniqueViolation(e)) throw new TRPCError({ code: "CONFLICT", message: `A component with code ${input.code} already exists.` });
        throw e;
      }
    }, (r) => ({ action: "payroll.component.create", entityType: "salaryComponent", entityId: r.id, metadata: { code: r.code } })),
  ),

  /** Edit a component. The type and category cannot change once templates may use it; rename, switch proration or retire it. */
  componentUpdate: memberProcedure
    .input(z.object({ id: z.string().uuid(), name: z.string().trim().min(1).max(80).optional(), prorate: z.boolean().optional(), isWage: z.boolean().optional(), isActive: z.boolean().optional(), sortOrder: z.number().int().min(0).max(999).optional() }))
    .mutation(
      withAudit(async ({ ctx, input }) => {
        await assertPayroll(ctx, "update");
        const { id, ...patch } = input;
        const set = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
        const [row] = await ctx.db
          .update(salaryComponents)
          .set({ ...set, updatedAt: new Date() })
          .where(and(eq(salaryComponents.id, id), eq(salaryComponents.businessId, ctx.businessId)))
          .returning();
        if (!row) throw notFound("Component");
        return row;
      }, (r) => ({ action: "payroll.component.update", entityType: "salaryComponent", entityId: r.id, metadata: { code: r.code } })),
    ),

  /** Add the standard components that are still missing (Basic, DA, HRA, conveyance, special, bonus, incentive, advance recovery, other deduction). */
  componentSeedDefaults: memberProcedure.mutation(
    withAudit(async ({ ctx }) => {
      await assertPayroll(ctx, "create");
      const rows = await ctx.db
        .insert(salaryComponents)
        .values(DEFAULT_COMPONENTS.map((c) => ({ ...c, businessId: ctx.businessId, statutoryKind: null })))
        .onConflictDoNothing()
        .returning({ id: salaryComponents.id });
      return { added: rows.length };
    }, (r) => ({ action: "payroll.component.seedDefaults", entityType: "salaryComponent", entityId: null, metadata: { added: r.added } })),
  ),

  // ── Templates ───────────────────────────────────────────────────────────────

  templateList: viewerProcedure.query(async ({ ctx }) => {
    await assertPayroll(ctx, "read");
    const templates = await ctx.db.select().from(salaryTemplates).where(eq(salaryTemplates.businessId, ctx.businessId)).orderBy(asc(salaryTemplates.name));
    const lines = templates.length
      ? await ctx.db
          .select({ line: salaryTemplateLines, code: salaryComponents.code, name: salaryComponents.name, type: salaryComponents.type, category: salaryComponents.category })
          .from(salaryTemplateLines)
          .innerJoin(salaryComponents, eq(salaryComponents.id, salaryTemplateLines.componentId))
          .where(inArray(salaryTemplateLines.templateId, templates.map((t) => t.id)))
          .orderBy(asc(salaryTemplateLines.sortOrder))
      : [];
    const used = await ctx.db
      .select({ templateId: employeeSalaryAssignments.templateId, n: sql<number>`count(DISTINCT ${employeeSalaryAssignments.employeeId})::int` })
      .from(employeeSalaryAssignments)
      .where(eq(employeeSalaryAssignments.businessId, ctx.businessId))
      .groupBy(employeeSalaryAssignments.templateId);
    const usedBy = new Map(used.map((u) => [u.templateId, u.n]));
    return templates.map((t) => ({
      ...t,
      employeeCount: usedBy.get(t.id) ?? 0,
      lines: lines
        .filter((l) => l.line.templateId === t.id)
        .map((l) => ({ id: l.line.id, componentId: l.line.componentId, code: l.code, name: l.name, type: l.type, category: l.category, calcType: l.line.calcType, value: l.line.value })),
    }));
  }),

  templateCreate: memberProcedure.input(salaryTemplateSchema).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "create");
      const comps = await loadComponents(ctx.db, ctx.businessId, input.lines.map((l) => l.componentId));
      if (new Set(input.lines.map((l) => l.componentId)).size !== input.lines.length) throw badRequest("A component can only be used once in a template.");
      // Check the structure on the sample CTC (or a large one when there is none), so a broken template is refused now.
      compute(input.sampleAnnualCtc > 0 ? input.sampleAnnualCtc : 10_000_000, input.lines.map((l) => toDef(comps.get(l.componentId)!, l)));
      return ctx.db.transaction(async (tx) => {
        let t;
        try {
          [t] = await tx
            .insert(salaryTemplates)
            .values({ businessId: ctx.businessId, name: input.name, description: input.description || null, sampleAnnualCtc: String(input.sampleAnnualCtc) })
            .returning();
        } catch (e) {
          if (isUniqueViolation(e)) throw new TRPCError({ code: "CONFLICT", message: `There is already a template called ${input.name}.` });
          throw e;
        }
        await tx.insert(salaryTemplateLines).values(input.lines.map((l, i) => ({ templateId: t!.id, componentId: l.componentId, calcType: l.calcType, value: String(l.value), sortOrder: i })));
        return t!;
      });
    }, (r) => ({ action: "payroll.template.create", entityType: "salaryTemplate", entityId: r.id })),
  ),

  templateUpdate: memberProcedure.input(salaryTemplateSchema.extend({ id: z.string().uuid(), isActive: z.boolean().optional() })).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "update");
      const [existing] = await ctx.db.select().from(salaryTemplates).where(and(eq(salaryTemplates.id, input.id), eq(salaryTemplates.businessId, ctx.businessId))).limit(1);
      if (!existing) throw notFound("Template");
      const comps = await loadComponents(ctx.db, ctx.businessId, input.lines.map((l) => l.componentId));
      if (new Set(input.lines.map((l) => l.componentId)).size !== input.lines.length) throw badRequest("A component can only be used once in a template.");
      compute(input.sampleAnnualCtc > 0 ? input.sampleAnnualCtc : 10_000_000, input.lines.map((l) => toDef(comps.get(l.componentId)!, l)));
      return ctx.db.transaction(async (tx) => {
        let t;
        try {
          [t] = await tx
            .update(salaryTemplates)
            .set({ name: input.name, description: input.description || null, sampleAnnualCtc: String(input.sampleAnnualCtc), ...(input.isActive === undefined ? {} : { isActive: input.isActive }), updatedAt: new Date() })
            .where(eq(salaryTemplates.id, existing.id))
            .returning();
        } catch (e) {
          if (isUniqueViolation(e)) throw new TRPCError({ code: "CONFLICT", message: `There is already a template called ${input.name}.` });
          throw e;
        }
        await tx.delete(salaryTemplateLines).where(eq(salaryTemplateLines.templateId, existing.id));
        await tx.insert(salaryTemplateLines).values(input.lines.map((l, i) => ({ templateId: existing.id, componentId: l.componentId, calcType: l.calcType, value: String(l.value), sortOrder: i })));
        return t!;
      });
    }, (r) => ({ action: "payroll.template.update", entityType: "salaryTemplate", entityId: r.id })),
  ),

  /** Delete a template. Employees already assigned keep their salary: assignments are snapshots. */
  templateDelete: memberProcedure.input(idInput).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "delete");
      const deleted = await ctx.db
        .delete(salaryTemplates)
        .where(and(eq(salaryTemplates.id, input.id), eq(salaryTemplates.businessId, ctx.businessId)))
        .returning({ id: salaryTemplates.id });
      if (deleted.length === 0) throw notFound("Template");
      return { id: input.id };
    }, (r) => ({ action: "payroll.template.delete", entityType: "salaryTemplate", entityId: r.id })),
  ),

  // ── CTC -> monthly ──────────────────────────────────────────────────────────

  /** Annual CTC and template lines to monthly amounts, with the 50% wage rule check. Nothing is saved. */
  preview: viewerProcedure.input(salaryPreviewSchema).query(async ({ ctx, input }) => {
    await assertPayroll(ctx, "read");
    const comps = await loadComponents(ctx.db, ctx.businessId, input.lines.map((l) => l.componentId));
    return presentBreakdown(compute(input.annualCtc, input.lines.map((l) => toDef(comps.get(l.componentId)!, l))));
  }),

  // ── Assignments ─────────────────────────────────────────────────────────────

  /** Give an employee a salary: a template and an annual CTC from a date. The monthly breakdown is stored. */
  assign: memberProcedure.input(salaryAssignSchema).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "update");
      const [emp] = await ctx.db.select({ id: employees.id, code: employees.employeeCode, doj: employees.dateOfJoining }).from(employees).where(and(eq(employees.id, input.employeeId), eq(employees.businessId, ctx.businessId))).limit(1);
      if (!emp) throw notFound("Employee");
      const [tpl] = await ctx.db.select().from(salaryTemplates).where(and(eq(salaryTemplates.id, input.templateId), eq(salaryTemplates.businessId, ctx.businessId))).limit(1);
      if (!tpl) throw notFound("Template");
      const tplLines = await ctx.db.select().from(salaryTemplateLines).where(eq(salaryTemplateLines.templateId, tpl.id)).orderBy(asc(salaryTemplateLines.sortOrder));
      const lines: LineInput[] = tplLines.map((l) => {
        const o = input.overrides?.[l.componentId];
        return { componentId: l.componentId, calcType: (o?.calcType ?? l.calcType) as CalcType, value: o ? o.value : Number(l.value) };
      });
      const comps = await loadComponents(ctx.db, ctx.businessId, lines.map((l) => l.componentId));
      const breakdown = compute(input.annualCtc, lines.map((l) => toDef(comps.get(l.componentId)!, l)));
      const [row] = await ctx.db
        .insert(employeeSalaryAssignments)
        .values({
          businessId: ctx.businessId,
          employeeId: emp.id,
          templateId: tpl.id,
          annualCtc: paiseToRupees(breakdown.annualCtcPaise),
          monthlyCtc: paiseToRupees(breakdown.monthlyCtcPaise),
          effectiveFrom: input.effectiveFrom,
          breakdown: breakdown.lines.map((l) => ({
            componentId: l.componentId ?? null,
            code: l.code,
            name: l.name,
            type: l.type,
            category: l.category,
            isWage: l.isWage,
            prorate: l.prorate,
            statutoryKind: null,
            calcType: l.calcType,
            value: String(l.value),
            monthly: paiseToRupees(l.monthlyPaise),
          })),
          createdByUserId: ctx.user.id,
        })
        .returning();
      return { assignment: row!, breakdown: presentBreakdown(breakdown), employeeCode: emp.code };
    }, (r) => ({ action: "payroll.salary.assign", entityType: "employee", entityId: r.assignment.employeeId, metadata: { employeeCode: r.employeeCode, effectiveFrom: r.assignment.effectiveFrom } })),
  ),

  /** An employee's salary history, newest first. */
  assignments: viewerProcedure.input(z.object({ employeeId: z.string().uuid() })).query(async ({ ctx, input }) => {
    await assertPayroll(ctx, "read");
    return ctx.db
      .select()
      .from(employeeSalaryAssignments)
      .where(and(eq(employeeSalaryAssignments.employeeId, input.employeeId), eq(employeeSalaryAssignments.businessId, ctx.businessId)))
      .orderBy(desc(employeeSalaryAssignments.effectiveFrom), desc(employeeSalaryAssignments.createdAt));
  }),

  /** Every active employee with the salary in force today (or none yet). */
  overview: viewerProcedure.query(async ({ ctx }) => {
    await assertPayroll(ctx, "read");
    const today = new Date().toISOString().slice(0, 10);
    const rows = await ctx.db
      .select({
        employeeId: employees.id,
        employeeCode: employees.employeeCode,
        name: employees.name,
        annualCtc: employeeSalaryAssignments.annualCtc,
        monthlyCtc: employeeSalaryAssignments.monthlyCtc,
        effectiveFrom: employeeSalaryAssignments.effectiveFrom,
        templateName: salaryTemplates.name,
      })
      .from(employees)
      .leftJoin(
        employeeSalaryAssignments,
        and(
          eq(employeeSalaryAssignments.employeeId, employees.id),
          eq(employeeSalaryAssignments.id, sql`(SELECT a.id FROM employee_salary_assignments a WHERE a.employee_id = ${employees.id} AND a.effective_from <= ${today} ORDER BY a.effective_from DESC, a.created_at DESC LIMIT 1)`),
        ),
      )
      .leftJoin(salaryTemplates, eq(salaryTemplates.id, employeeSalaryAssignments.templateId))
      .where(and(eq(employees.businessId, ctx.businessId), eq(employees.status, "active")))
      .orderBy(asc(employees.employeeCode));
    return rows;
  }),
});
