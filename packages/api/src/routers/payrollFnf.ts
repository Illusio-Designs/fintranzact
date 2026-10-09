/**
 * Payroll Phase 4: full and final settlement on exit. Same split as a payroll run: HR, accountants, owners and admins prepare
 * (create, edit, calculate, submit); owners and admins approve (maker-checker); owners, admins and accountants post to the
 * books and record the payment (PayrollPosting). The last month's salary is paid by the exit month's payroll run, not here
 * (lib/payroll/fnf.ts explains why and how double payment is prevented).
 */

import { z } from "zod";
import { MAKER_CHECKER_MESSAGE, approverAllowed, fnfCreateSchema, fnfMarkPaidSchema, fnfUpdateSchema, FNF_TDS_WARNING } from "@fintranzact/shared";
import { router, viewerProcedure, memberProcedure } from "../trpc.js";
import { withAudit } from "../lib/audit.js";
import { assertPayroll, assertPayrollPosting } from "../lib/payroll/access.js";
import { approveFnf, calculateFnf, createFnf, deleteFnf, fnfDetail, fnfStatementData, listFnf, markFnfPaid, postFnf, reopenFnf, submitFnf, updateFnf } from "../lib/payroll/fnf.js";
import { generateFnfStatementPDF } from "../lib/payroll/phase4-pdf.js";

const idInput = z.object({ id: z.string().uuid() });

function actorOf(ctx: { user: { id: string; name?: string | null; email?: string | null } }) {
  return { id: ctx.user.id, name: ctx.user.name ?? ctx.user.email ?? null };
}

export const payrollFnfRouter = router({
  list: viewerProcedure.query(async ({ ctx }) => {
    await assertPayroll(ctx, "read");
    return listFnf(ctx.db, ctx.businessId);
  }),

  /** A settlement with its lines, the leave that can be encashed, the state of the last month's salary and whether the signed-in person may approve it. */
  get: viewerProcedure.input(idInput).query(async ({ ctx, input }) => {
    await assertPayroll(ctx, "read");
    const d = await fnfDetail(ctx.db, ctx.businessId, input.id);
    const canManage = ctx.ability.can("manage", "Payroll");
    const allowed = approverAllowed({ approverUserId: ctx.user.id, calculatedByUserId: d.settlement.calculatedByUserId, businessMemberCount: d.memberCount });
    return {
      settlement: d.settlement,
      employee: d.employee,
      lines: d.lines,
      salary: d.salary,
      encashable: d.encashable,
      tdsWarning: FNF_TDS_WARNING,
      approval: {
        canApprove: canManage && allowed && d.settlement.status === "pending_approval",
        reason: !canManage ? "Only an owner or admin can approve a settlement." : !allowed ? MAKER_CHECKER_MESSAGE.replace(/payroll/g, "settlement") : null,
      },
    };
  }),

  /** Start the settlement of an employee who has left; it is calculated straight away. */
  create: memberProcedure.input(fnfCreateSchema).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "create");
      return createFnf(ctx.db, { businessId: ctx.businessId, employeeId: input.employeeId, encashmentBasis: input.encashmentBasis, note: input.note || null, actor: actorOf(ctx) });
    }, (r) => ({ action: "payroll.fnf.create", entityType: "fnfSettlement", entityId: r.id, metadata: { number: r.number, employeeId: r.employeeId } })),
  ),

  /** Save the leave days, notice shortfall, manual TDS and manual lines; the settlement is calculated again. */
  update: memberProcedure.input(fnfUpdateSchema).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "update");
      const { id, ...patch } = input;
      return updateFnf(ctx.db, { businessId: ctx.businessId, id, actor: actorOf(ctx), patch: { ...patch, note: patch.note } });
    }, (r) => ({ action: "payroll.fnf.update", entityType: "fnfSettlement", entityId: r.id, metadata: { number: r.number, net: r.netPayable } })),
  ),

  calculate: memberProcedure.input(idInput).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "update");
      return calculateFnf(ctx.db, { businessId: ctx.businessId, id: input.id, actor: actorOf(ctx) });
    }, (r) => ({ action: "payroll.fnf.calculate", entityType: "fnfSettlement", entityId: r.id, metadata: { number: r.number, net: r.netPayable } })),
  ),

  submit: memberProcedure.input(idInput).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "update");
      return submitFnf(ctx.db, { businessId: ctx.businessId, id: input.id, actor: actorOf(ctx) });
    }, (r) => ({ action: "payroll.fnf.submit", entityType: "fnfSettlement", entityId: r.id })),
  ),

  /** Owners and admins only; not the person who calculated it, unless the business has one user. Records the leave encashed and the loans recovered. */
  approve: memberProcedure.input(idInput).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "manage");
      return approveFnf(ctx.db, { businessId: ctx.businessId, id: input.id, actor: actorOf(ctx) });
    }, (r) => ({ action: "payroll.fnf.approve", entityType: "fnfSettlement", entityId: r.id, metadata: { number: r.number, net: r.netPayable } })),
  ),

  /** Back to draft before approval. */
  reopen: memberProcedure.input(idInput).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "update");
      return reopenFnf(ctx.db, { businessId: ctx.businessId, id: input.id });
    }, (r) => ({ action: "payroll.fnf.reopen", entityType: "fnfSettlement", entityId: r.id })),
  ),

  delete: memberProcedure.input(idInput).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "update");
      await deleteFnf(ctx.db, { businessId: ctx.businessId, id: input.id });
      return { id: input.id };
    }, (r) => ({ action: "payroll.fnf.delete", entityType: "fnfSettlement", entityId: r.id })),
  ),

  post: memberProcedure.input(idInput).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayrollPosting(ctx);
      return postFnf(ctx.db, { businessId: ctx.businessId, id: input.id, actor: actorOf(ctx) });
    }, (r) => ({ action: "payroll.fnf.post", entityType: "fnfSettlement", entityId: r.settlement.id, metadata: { journalEntryId: r.journalEntryId, created: r.created } })),
  ),

  markPaid: memberProcedure.input(fnfMarkPaidSchema).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayrollPosting(ctx);
      return markFnfPaid(ctx.db, { businessId: ctx.businessId, id: input.id, bankAccountId: input.bankAccountId, paidOn: input.paidOn, reference: input.reference || null, actor: actorOf(ctx) });
    }, (r) => ({ action: "payroll.fnf.markPaid", entityType: "fnfSettlement", entityId: r.settlement.id, metadata: { created: r.created } })),
  ),

  /** The settlement statement as a PDF (base64). */
  statementPdf: viewerProcedure.input(idInput).query(async ({ ctx, input }) => {
    await assertPayroll(ctx, "read");
    const s = await fnfStatementData(ctx.db, ctx.businessId, input.id);
    const pdf = await generateFnfStatementPDF(s.data, { logo: s.logo });
    return { filename: s.filename, contentType: "application/pdf" as const, base64: pdf.toString("base64") };
  }),
});
