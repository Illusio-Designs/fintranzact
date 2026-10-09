/**
 * Payroll statutory (Phase 2): the registrations and rates behind PF, EPS, VPF,
 * ESI, professional tax, labour welfare fund and TDS on salary; each employee's
 * statutory fields and tax declarations; the statutory dues and their payment
 * (with challan details); and the downloadable files and registers.
 *
 * Who may do what (the same split as the rest of payroll): reading needs
 * Payroll "read"; the registrations and the rates (compliance-critical, every
 * figure is data per financial year) are changed by Payroll "manage" (owners
 * and admins); employee statutory fields, declarations, recording a payment and
 * downloading a file need Payroll "update" (owners, admins, accountants). The
 * files contain UAN, ESIC and PAN numbers in full, so they need "update" and
 * their contents are never logged. NOTHING is filed or paid with any
 * government system: these are files for the owner or the CA to upload.
 */

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { businesses, employeeSalaryAssignments, employeeTaxDeclarations, employees, payrollSettings, payrollStatutorySettings } from "@fintranzact/db";
import {
  PHASE4_REGISTERS,
  FILING_REGISTERS,
  VERIFY_WITH_CA_LABEL,
  WAGE_CATEGORIES,
  employeeStatutorySchema,
  effectiveEps,
  EMPTY_DECLARATION,
  fyInputSchema,
  fyLabel,
  fyStartYearOfMonth,
  istDateParts,
  isoDateSchema,
  ratesGaps,
  rupeesToPaise,
  statutoryBusinessSettingsSchema,
  statutoryPaymentSchema,
  statutoryRatesSaveSchema,
  suggestEpsEligibility,
  taxDeclarationSaveSchema,
  taxDeclarationSchema,
  validatePtRule,
  payrollMonthSchema,
} from "@fintranzact/shared";
import { router, viewerProcedure, memberProcedure } from "../trpc.js";
import { withAudit } from "../lib/audit.js";
import { assertPayroll, assertPayrollPosting, badRequest, notFound } from "../lib/payroll/access.js";
import { listDues, recordStatutoryPayment } from "../lib/payroll/dues.js";
import {
  buildAttendanceRegisterFile,
  buildBonusRegisterFile,
  buildEcrFile,
  buildEsicFile,
  buildForm16,
  buildForm24qFile,
  buildGratuityRegisterFile,
  buildLeaveRegisterFile,
  buildStateSheetFiles,
  buildWageRegisterFile,
} from "../lib/payroll/filings.js";
import { buildDeductionsRegisterFile, buildEmploymentRegisterFile, buildFnfRegisterFile, buildOvertimeRegisterFile, registerAsPdf } from "../lib/payroll/registers4.js";
import { generateForm16WorkingCopyPDF } from "../lib/payroll/form16-pdf.js";
import { loadStatutoryFlags, loadStatutoryRates, loadDeclarations } from "../lib/payroll/statutory.js";

const runInput = z.object({ runId: z.string().uuid() });
const fyOf = (input: { financialYear?: number } | undefined): number => input?.financialYear ?? fyStartYearOfMonth(currentMonth());

function currentMonth(): string {
  const p = istDateParts(new Date());
  return `${p.year}-${String(p.month).padStart(2, "0")}`;
}

function actorOf(ctx: { user: { id: string; name?: string | null; email?: string | null } }) {
  return { id: ctx.user.id, name: ctx.user.name ?? ctx.user.email ?? null };
}

export const payrollStatutoryRouter = router({
  // ── Settings ────────────────────────────────────────────────────────────────

  /**
   * The registrations (PF, ESI, PT states, LWF state, TDS), and the rates in
   * force for a financial year (the latest saved at or before it, else the
   * shipped defaults), with what is not configured. Every figure here needs
   * verifying with your CA.
   */
  settings: viewerProcedure.input(fyInputSchema.optional()).query(async ({ ctx, input }) => {
    await assertPayroll(ctx, "read");
    const fy = fyOf(input);
    const [flags, loaded, [biz]] = await Promise.all([
      loadStatutoryFlags(ctx.db, ctx.businessId),
      loadStatutoryRates(ctx.db, ctx.businessId, fy),
      ctx.db.select({ tan: businesses.tan }).from(businesses).where(eq(businesses.id, ctx.businessId)).limit(1),
    ]);
    return {
      financialYear: fy,
      financialYearLabel: fyLabel(fy),
      verifyLabel: VERIFY_WITH_CA_LABEL,
      flags,
      hasTan: !!biz?.tan,
      rates: loaded.rates,
      ratesSource: loaded.source,
      ratesSavedForFinancialYear: loaded.rowFinancialYear,
      verifiedNote: loaded.verifiedNote,
      verifiedOn: loaded.verifiedOn,
      gaps: ratesGaps(loaded.rates, { ptStates: flags.ptStates, lwfState: flags.lwfState }),
      canEdit: ctx.ability.can("manage", "Payroll"),
    };
  }),

  /** The registrations: PF (+ establishment code), ESI (+ code), PT states, LWF state, TDS on salary. Owners and admins. */
  updateBusinessSettings: memberProcedure.input(statutoryBusinessSettingsSchema).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "manage");
      const values = {
        businessId: ctx.businessId,
        pfRegistered: input.pfRegistered,
        pfEstablishmentCode: input.pfRegistered ? input.pfEstablishmentCode?.trim() || null : null,
        esiRegistered: input.esiRegistered,
        esiCode: input.esiRegistered ? input.esiCode?.trim() || null : null,
        ptStates: [...new Set(input.ptStates)].sort(),
        lwfState: input.lwfState || null,
        tdsEnabled: input.tdsEnabled,
        updatedAt: new Date(),
      };
      await ctx.db.insert(payrollSettings).values(values).onConflictDoUpdate({ target: payrollSettings.businessId, set: values });
      return { flags: await loadStatutoryFlags(ctx.db, ctx.businessId) };
    }, (r) => ({
      action: "payroll.statutory.updateBusinessSettings",
      entityType: "payrollSettings",
      entityId: null,
      metadata: { pf: r.flags.pfRegistered, esi: r.flags.esiRegistered, ptStates: r.flags.ptStates, lwfState: r.flags.lwfState, tds: r.flags.tdsEnabled },
    })),
  ),

  /**
   * Save the rates, ceilings, slabs and due dates for a financial year (and the
   * "last verified" note). A payroll run uses the latest saved year at or before
   * its own, so figures carry forward until you save new ones. Owners and admins.
   */
  saveRates: memberProcedure.input(statutoryRatesSaveSchema).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "manage");
      for (const [state, rule] of Object.entries(input.rates.pt)) {
        const problems = validatePtRule(rule);
        if (problems.length) throw badRequest(`Professional tax slabs for state ${state}: ${problems[0]}`);
      }
      const values = {
        businessId: ctx.businessId,
        financialYear: input.financialYear,
        rates: input.rates as unknown as Record<string, unknown>,
        verifiedNote: input.verifiedNote?.trim() || null,
        verifiedOn: input.verifiedOn || null,
        updatedByUserId: ctx.user.id,
        updatedAt: new Date(),
      };
      await ctx.db
        .insert(payrollStatutorySettings)
        .values(values)
        .onConflictDoUpdate({ target: [payrollStatutorySettings.businessId, payrollStatutorySettings.financialYear], set: values });
      return { financialYear: input.financialYear };
    }, (r) => ({ action: "payroll.statutory.saveRates", entityType: "payrollStatutorySettings", entityId: null, metadata: { financialYear: r.financialYear } })),
  ),

  // ── Employees ───────────────────────────────────────────────────────────────

  /** An employee's statutory fields, the EPS suggestion and their tax declaration for a financial year. */
  employeeSettings: viewerProcedure
    .input(z.object({ employeeId: z.string().uuid(), financialYear: z.number().int().min(2020).max(2100).optional() }))
    .query(async ({ ctx, input }) => {
      await assertPayroll(ctx, "read");
      const [e] = await ctx.db.select().from(employees).where(and(eq(employees.id, input.employeeId), eq(employees.businessId, ctx.businessId))).limit(1);
      if (!e) throw notFound("Employee");
      const fy = fyOf(input);
      const [loaded, [first], declarations] = await Promise.all([
        loadStatutoryRates(ctx.db, ctx.businessId, fy),
        ctx.db
          .select({ breakdown: employeeSalaryAssignments.breakdown })
          .from(employeeSalaryAssignments)
          .where(and(eq(employeeSalaryAssignments.employeeId, e.id), eq(employeeSalaryAssignments.businessId, ctx.businessId)))
          .orderBy(employeeSalaryAssignments.effectiveFrom)
          .limit(1),
        loadDeclarations(ctx.db, ctx.businessId, fy),
      ]);
      const wagesAtJoining = first
        ? first.breakdown.filter((b) => b.type === "earning" && (b.isWage || (WAGE_CATEGORIES as readonly string[]).includes(b.category))).reduce((s, b) => s + rupeesToPaise(b.monthly), 0)
        : null;
      const today = new Date().toISOString().slice(0, 10);
      const suggestion = suggestEpsEligibility({
        dateOfBirth: e.dateOfBirth,
        pfJoinDate: e.pfJoinDate ?? e.dateOfJoining,
        wagesAtJoiningPaise: wagesAtJoining,
        internationalWorker: e.internationalWorker,
        asOf: today,
        rates: loaded.rates.pf,
      });
      return {
        employeeId: e.id,
        employeeCode: e.employeeCode,
        name: e.name,
        taxRegime: e.taxRegime,
        pfApplicable: e.pfApplicable,
        pfExcluded: e.pfExcluded,
        epsEligible: e.epsEligible,
        pfOnActualWages: e.pfOnActualWages,
        vpfPercent: Number(e.vpfPercent),
        internationalWorker: e.internationalWorker,
        pfJoinDate: e.pfJoinDate,
        esiApplicable: e.esiApplicable,
        /** What payroll will use for EPS today (the flag, switched off from the age EPS stops at). */
        epsInEffect: effectiveEps({ epsFlag: e.epsEligible, dateOfBirth: e.dateOfBirth, month: currentMonth(), stopAge: loaded.rates.pf.epsStopAge }),
        epsSuggestion: suggestion,
        financialYear: fy,
        declaration: declarations.get(e.id) ?? EMPTY_DECLARATION,
      };
    }),

  /** An employee's PF, EPS, VPF and ESI settings. */
  employeeUpdate: memberProcedure.input(employeeStatutorySchema).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "update");
      const { employeeId, ...rest } = input;
      const [existing] = await ctx.db.select({ id: employees.id, code: employees.employeeCode }).from(employees).where(and(eq(employees.id, employeeId), eq(employees.businessId, ctx.businessId))).limit(1);
      if (!existing) throw notFound("Employee");
      const set: Partial<typeof employees.$inferInsert> = { updatedAt: new Date() };
      if (rest.pfApplicable !== undefined) set.pfApplicable = rest.pfApplicable;
      if (rest.pfExcluded !== undefined) set.pfExcluded = rest.pfExcluded;
      if (rest.epsEligible !== undefined) set.epsEligible = rest.epsEligible;
      if (rest.pfOnActualWages !== undefined) set.pfOnActualWages = rest.pfOnActualWages;
      if (rest.vpfPercent !== undefined) set.vpfPercent = rest.vpfPercent.toFixed(2);
      if (rest.internationalWorker !== undefined) set.internationalWorker = rest.internationalWorker;
      if (rest.pfJoinDate !== undefined) set.pfJoinDate = rest.pfJoinDate || null;
      if (rest.esiApplicable !== undefined) set.esiApplicable = rest.esiApplicable;
      await ctx.db.update(employees).set(set).where(and(eq(employees.id, employeeId), eq(employees.businessId, ctx.businessId)));
      return { employeeId, employeeCode: existing.code, fields: Object.keys(rest).filter((k) => (rest as Record<string, unknown>)[k] !== undefined) };
    }, (r) => ({ action: "payroll.statutory.employeeUpdate", entityType: "employee", entityId: r.employeeId, metadata: { employeeCode: r.employeeCode, fields: r.fields } })),
  ),

  /** An employee's investment declarations for a financial year (used under the old regime; amounts in rupees). */
  saveDeclaration: memberProcedure.input(taxDeclarationSaveSchema).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "update");
      const [existing] = await ctx.db.select({ id: employees.id }).from(employees).where(and(eq(employees.id, input.employeeId), eq(employees.businessId, ctx.businessId))).limit(1);
      if (!existing) throw notFound("Employee");
      const values = {
        businessId: ctx.businessId,
        employeeId: input.employeeId,
        financialYear: input.financialYear,
        amounts: taxDeclarationSchema.parse(input.amounts) as unknown as Record<string, number>,
        updatedByUserId: ctx.user.id,
        updatedAt: new Date(),
      };
      await ctx.db
        .insert(employeeTaxDeclarations)
        .values(values)
        .onConflictDoUpdate({ target: [employeeTaxDeclarations.employeeId, employeeTaxDeclarations.financialYear], set: values });
      return { employeeId: input.employeeId, financialYear: input.financialYear };
    }, (r) => ({ action: "payroll.statutory.saveDeclaration", entityType: "employee", entityId: r.employeeId, metadata: { financialYear: r.financialYear } })),
  ),

  // ── Dues and payments ───────────────────────────────────────────────────────

  /** What each approved run owes PF, ESI, professional tax, LWF and TDS, what has been paid and when it is due. */
  dues: viewerProcedure.input(fyInputSchema.optional()).query(async ({ ctx, input }) => {
    await assertPayroll(ctx, "read");
    const fy = fyOf(input);
    return { financialYear: fy, financialYearLabel: fyLabel(fy), rows: await listDues(ctx.db, ctx.businessId, fy) };
  }),

  /**
   * Record a payment of a statutory due: Dr the payable account, Cr cash or
   * bank, with the challan number and date. It records what you paid; it does
   * not pay anything.
   */
  recordPayment: memberProcedure.input(statutoryPaymentSchema).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayrollPosting(ctx);
      return recordStatutoryPayment(ctx.db, {
        businessId: ctx.businessId,
        runId: input.runId,
        kind: input.kind,
        amountPaise: rupeesToPaise(input.amount),
        paidOn: input.paidOn,
        bankAccountId: input.bankAccountId,
        challanNumber: input.challanNumber || null,
        challanDate: input.challanDate || null,
        reference: input.reference || null,
        actor: actorOf(ctx),
      });
    }, (r) => ({ action: "payroll.statutory.recordPayment", entityType: "payrollRun", entityId: r.runId, metadata: { kind: r.kind, journalEntryId: r.journalEntryId } })),
  ),

  // ── Files and registers (Payroll "update": they contain UAN, ESIC and PAN numbers) ─────

  /** The PF ECR file (EPFO ECR 2.0 text) for an approved run. Only PF members; no PF-less business has one. */
  ecrFile: viewerProcedure.input(runInput).query(async ({ ctx, input }) => {
    await assertPayroll(ctx, "update");
    return buildEcrFile(ctx.db, ctx.businessId, input.runId);
  }),

  /** The ESIC monthly contribution file (CSV) for an approved run. */
  esicFile: viewerProcedure.input(runInput).query(async ({ ctx, input }) => {
    await assertPayroll(ctx, "update");
    return buildEsicFile(ctx.db, ctx.businessId, input.runId);
  }),

  /** Professional tax working sheets, one per state, for an approved run. */
  ptSheets: viewerProcedure.input(runInput).query(async ({ ctx, input }) => {
    await assertPayroll(ctx, "update");
    return buildStateSheetFiles(ctx.db, ctx.businessId, input.runId, "pt");
  }),

  /** Labour welfare fund working sheets, one per state, for an approved run. */
  lwfSheets: viewerProcedure.input(runInput).query(async ({ ctx, input }) => {
    await assertPayroll(ctx, "update");
    return buildStateSheetFiles(ctx.db, ctx.businessId, input.runId, "lwf");
  }),

  /** Form 24Q working data for a quarter: deductee rows and challans (CSV). Not an FVU file. */
  form24q: viewerProcedure
    .input(z.object({ financialYear: z.number().int().min(2020).max(2100), quarter: z.number().int().min(1).max(4) }))
    .query(async ({ ctx, input }) => {
      await assertPayroll(ctx, "update");
      const [biz] = await ctx.db.select({ tan: businesses.tan }).from(businesses).where(eq(businesses.id, ctx.businessId)).limit(1);
      return buildForm24qFile(ctx.db, ctx.businessId, input.financialYear, input.quarter as 1 | 2 | 3 | 4, biz?.tan ?? null);
    }),

  /** A Form 16 working copy for one employee and financial year, as a PDF (base64). Labelled "working copy for CA review". */
  form16Pdf: viewerProcedure
    .input(z.object({ financialYear: z.number().int().min(2020).max(2100), employeeId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertPayroll(ctx, "update");
      const f = await buildForm16(ctx.db, ctx.businessId, input.financialYear, input.employeeId);
      const pdf = await generateForm16WorkingCopyPDF(f.data, { name: f.businessName, tan: f.tan });
      return { filename: `form16-working-copy-${f.data.fyLabel}-${f.data.employee.code}.pdf`, contentType: "application/pdf" as const, base64: pdf.toString("base64"), label: f.data.label };
    }),

  /** The same Form 16 working copy as data and a CSV. */
  form16Data: viewerProcedure
    .input(z.object({ financialYear: z.number().int().min(2020).max(2100), employeeId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertPayroll(ctx, "update");
      const f = await buildForm16(ctx.db, ctx.businessId, input.financialYear, input.employeeId);
      return { filename: `form16-working-copy-${f.data.fyLabel}-${f.data.employee.code}.csv`, contentType: "text/csv" as const, csv: f.csv, label: f.data.label, summary: {
        taxableIncome: f.data.taxableIncomePaise / 100,
        taxPayable: f.data.tax.totalPaise / 100,
        taxDeducted: f.data.tdsDeductedPaise / 100,
        difference: f.data.differencePaise / 100,
      } };
    }),

  /**
   * A register as a CSV (the default) or, with `format: "pdf"`, as a landscape PDF built from the same rows: wages and attendance
   * (a month), leave (a leave year), bonus, gratuity, employment, deductions, overtime and settlements (computed from existing
   * data; no payments). The PDF response has the same keys as the CSV one (`text` is empty) plus `base64` and `pages`.
   */
  register: viewerProcedure
    .input(
      z.object({
        register: z.enum([...FILING_REGISTERS, ...PHASE4_REGISTERS]),
        month: payrollMonthSchema.optional(),
        financialYear: z.number().int().min(2020).max(2100).optional(),
        leaveYear: z.number().int().min(2000).max(2200).optional(),
        asOf: isoDateSchema.optional(),
        format: z.enum(["csv", "pdf"]).default("csv"),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertPayroll(ctx, "update");
      const month = input.month ?? currentMonth();
      const file = await (async () => {
        switch (input.register) {
          case "wages":
            return buildWageRegisterFile(ctx.db, ctx.businessId, month);
          case "attendance":
            return buildAttendanceRegisterFile(ctx.db, ctx.businessId, month);
          case "leave":
            return buildLeaveRegisterFile(ctx.db, ctx.businessId, input.leaveYear);
          case "bonus":
            return buildBonusRegisterFile(ctx.db, ctx.businessId, fyOf(input));
          case "gratuity":
            return buildGratuityRegisterFile(ctx.db, ctx.businessId, input.asOf ?? new Date().toISOString().slice(0, 10), fyOf(input));
          // Phase 4 working registers (reformatted from existing data).
          case "employment":
            return buildEmploymentRegisterFile(ctx.db, ctx.businessId);
          case "deductions":
            return buildDeductionsRegisterFile(ctx.db, ctx.businessId, fyOf(input));
          case "overtime":
            return buildOvertimeRegisterFile(ctx.db, ctx.businessId, fyOf(input));
          case "fnf":
            return buildFnfRegisterFile(ctx.db, ctx.businessId, fyOf(input));
        }
      })();
      return input.format === "pdf" ? registerAsPdf(ctx.db, ctx.businessId, input.register, file) : file;
    }),
});
