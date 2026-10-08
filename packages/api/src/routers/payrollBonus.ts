/**
 * Payroll Phase 4: bonus runs (Payment of Bonus Act), one per financial year.
 *
 * Who may do what, like a payroll run: HR, accountants, owners and admins prepare (Payroll create / update); approving needs
 * Payroll "manage" (owners and admins) and is not the person who last calculated it (unless the business has one user);
 * posting to the books and recording the payment need PayrollPosting (owners, admins, accountants). The bonus settings
 * (ceilings, percentages) are the `bonus` part of the statutory rates, edited by payrollStatutory.saveRates. Rules and the
 * figures a CA must confirm: docs/architecture/payroll-phase-4.md and docs/PAYROLL-CA-VERIFICATION.md.
 */

import { z } from "zod";
import { fyLabel, bonusLineExcludeSchema, bonusMarkPaidSchema, bonusRunCreateSchema, bonusRunUpdateSchema, bonusRulesGaps, VERIFY_WITH_CA_LABEL } from "@fintranzact/shared";
import { router, viewerProcedure, memberProcedure } from "../trpc.js";
import { withAudit } from "../lib/audit.js";
import { assertPayroll, assertPayrollPosting } from "../lib/payroll/access.js";
import {
  approveBonusRun,
  bonusBankFile,
  bonusRunDetail,
  bonusStatement,
  calculateBonusRun,
  createBonusRun,
  currentFinancialYear,
  deleteBonusRun,
  listBonusRuns,
  markBonusPaid,
  postBonusRun,
  reopenBonusRun,
  setBonusExclusion,
  submitBonusRun,
  updateBonusRun,
} from "../lib/payroll/bonus.js";
import { loadStatutoryRates } from "../lib/payroll/statutory.js";
import { generateBonusStatementPDF } from "../lib/payroll/phase4-pdf.js";
import { approverAllowed, MAKER_CHECKER_MESSAGE } from "@fintranzact/shared";

const idInput = z.object({ id: z.string().uuid() });

function actorOf(ctx: { user: { id: string; name?: string | null; email?: string | null } }) {
  return { id: ctx.user.id, name: ctx.user.name ?? ctx.user.email ?? null };
}

export const payrollBonusRouter = router({
  /** The bonus settings of a financial year and what is still missing (they ship empty on purpose). */
  rules: viewerProcedure.input(z.object({ financialYear: z.number().int().min(2020).max(2100).optional() })).query(async ({ ctx, input }) => {
    await assertPayroll(ctx, "read");
    const fy = input.financialYear ?? currentFinancialYear();
    const loaded = await loadStatutoryRates(ctx.db, ctx.businessId, fy);
    return {
      financialYear: fy,
      label: fyLabel(fy),
      rules: loaded.rates.bonus,
      gaps: bonusRulesGaps(loaded.rates.bonus),
      source: loaded.source,
      verifiedNote: loaded.verifiedNote,
      verifiedOn: loaded.verifiedOn,
      verifyLabel: VERIFY_WITH_CA_LABEL,
    };
  }),

  list: viewerProcedure.query(async ({ ctx }) => {
    await assertPayroll(ctx, "read");
    return listBonusRuns(ctx.db, ctx.businessId);
  }),

  /** A run with its employee lines and whether the signed-in person may approve it. */
  get: viewerProcedure.input(idInput).query(async ({ ctx, input }) => {
    await assertPayroll(ctx, "read");
    const { run, lines, memberCount } = await bonusRunDetail(ctx.db, ctx.businessId, input.id);
    const canManage = ctx.ability.can("manage", "Payroll");
    const allowed = approverAllowed({ approverUserId: ctx.user.id, calculatedByUserId: run.calculatedByUserId, businessMemberCount: memberCount });
    return {
      run,
      lines,
      approval: {
        canApprove: canManage && allowed && run.status === "pending_approval",
        reason: !canManage ? "Only an owner or admin can approve a bonus run." : !allowed ? MAKER_CHECKER_MESSAGE.replace(/payroll/g, "bonus run") : null,
      },
    };
  }),

  create: memberProcedure.input(bonusRunCreateSchema).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "create");
      return createBonusRun(ctx.db, { businessId: ctx.businessId, financialYear: input.financialYear, percent: input.percent, note: input.note || null, actor: actorOf(ctx) });
    }, (r) => ({ action: "payroll.bonus.create", entityType: "bonusRun", entityId: r.id, metadata: { number: r.number, percent: r.percent } })),
  ),

  update: memberProcedure.input(bonusRunUpdateSchema).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "update");
      return updateBonusRun(ctx.db, { businessId: ctx.businessId, id: input.id, percent: input.percent, note: input.note });
    }, (r) => ({ action: "payroll.bonus.update", entityType: "bonusRun", entityId: r.id, metadata: { percent: r.percent } })),
  ),

  /** Mark an employee not eligible (with the reason) or eligible again (empty reason). Calculate again afterwards. */
  setExclusion: memberProcedure.input(bonusLineExcludeSchema).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "update");
      return setBonusExclusion(ctx.db, { businessId: ctx.businessId, runId: input.runId, employeeId: input.employeeId, reason: input.reason });
    }, (r, input) => ({ action: "payroll.bonus.exclusion", entityType: "bonusRun", entityId: r.id, metadata: { employeeId: input.employeeId, excluded: !!input.reason.trim() } })),
  ),

  calculate: memberProcedure.input(idInput).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "update");
      return calculateBonusRun(ctx.db, { businessId: ctx.businessId, runId: input.id, actor: actorOf(ctx) });
    }, (r) => ({ action: "payroll.bonus.calculate", entityType: "bonusRun", entityId: r.run.id, metadata: { employees: r.run.employeeCount, eligible: r.run.eligibleCount, total: r.run.totalBonus } })),
  ),

  submit: memberProcedure.input(idInput).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "update");
      return submitBonusRun(ctx.db, { businessId: ctx.businessId, id: input.id, actor: actorOf(ctx) });
    }, (r) => ({ action: "payroll.bonus.submit", entityType: "bonusRun", entityId: r.id })),
  ),

  /** Owners and admins only; not the person who calculated it, unless the business has one user. */
  approve: memberProcedure.input(idInput).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "manage");
      return approveBonusRun(ctx.db, { businessId: ctx.businessId, id: input.id, actor: actorOf(ctx) });
    }, (r) => ({ action: "payroll.bonus.approve", entityType: "bonusRun", entityId: r.id, metadata: { number: r.number, total: r.totalBonus } })),
  ),

  reopen: memberProcedure.input(idInput).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "update");
      return reopenBonusRun(ctx.db, { businessId: ctx.businessId, id: input.id });
    }, (r) => ({ action: "payroll.bonus.reopen", entityType: "bonusRun", entityId: r.id })),
  ),

  delete: memberProcedure.input(idInput).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "update");
      await deleteBonusRun(ctx.db, { businessId: ctx.businessId, id: input.id });
      return { id: input.id };
    }, (r) => ({ action: "payroll.bonus.delete", entityType: "bonusRun", entityId: r.id })),
  ),

  /** Post the approved run to the books: Dr Bonus & Incentives / Cr Bonus Payable. Posting twice changes nothing. */
  post: memberProcedure.input(idInput).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayrollPosting(ctx);
      return postBonusRun(ctx.db, { businessId: ctx.businessId, id: input.id, actor: actorOf(ctx) });
    }, (r) => ({ action: "payroll.bonus.post", entityType: "bonusRun", entityId: r.run.id, metadata: { journalEntryId: r.journalEntryId, created: r.created } })),
  ),

  markPaid: memberProcedure.input(bonusMarkPaidSchema).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayrollPosting(ctx);
      return markBonusPaid(ctx.db, { businessId: ctx.businessId, id: input.runId, bankAccountId: input.bankAccountId, paidOn: input.paidOn, reference: input.reference || null, actor: actorOf(ctx) });
    }, (r) => ({ action: "payroll.bonus.markPaid", entityType: "bonusRun", entityId: r.run.id, metadata: { created: r.created } })),
  ),

  /** The bonus statement as a CSV. */
  statementCsv: viewerProcedure.input(idInput).query(async ({ ctx, input }) => {
    await assertPayroll(ctx, "read");
    const s = await bonusStatement(ctx.db, ctx.businessId, input.id);
    return { filename: `${s.filename}.csv`, contentType: "text/csv" as const, csv: s.csv, count: s.lines.length };
  }),

  /** The bonus statement as a PDF (base64). */
  statementPdf: viewerProcedure.input(idInput).query(async ({ ctx, input }) => {
    await assertPayroll(ctx, "read");
    const s = await bonusStatement(ctx.db, ctx.businessId, input.id);
    const b = s.business;
    const pdf = await generateBonusStatementPDF(
      {
        business: { name: b.name, legalName: b.legalName, address: b.address, city: b.city, state: b.state, pincode: b.pincode, phone: b.phone, email: b.email },
        number: s.run.number,
        fyLabel: s.label,
        status: s.run.status.replace(/_/g, " "),
        percent: s.run.percent,
        total: s.run.totalBonus,
        note: s.run.note,
        lines: s.lines.map((l) => ({ code: l.employeeCode, name: l.employeeName, monthsPaid: l.monthsPaid, daysPaid: l.daysPaid, wages: l.wages, calculationWages: l.calculationWages, eligible: l.eligible, reasonText: l.reasonText, bonus: l.bonus })),
        generatedAt: new Date().toISOString(),
      },
      { logo: b.logoData ?? null },
    );
    return { filename: `${s.filename}.pdf`, contentType: "application/pdf" as const, base64: pdf.toString("base64") };
  }),

  /** A generic bank payment file for the eligible employees (full account numbers: needs Payroll "update"). */
  bankFile: viewerProcedure.input(idInput).query(async ({ ctx, input }) => {
    await assertPayroll(ctx, "update");
    return bonusBankFile(ctx.db, ctx.businessId, input.id);
  }),
});
