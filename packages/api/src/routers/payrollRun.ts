/**
 * Payroll: the monthly run (create, lock attendance, calculate, adjustments,
 * submit, approve, reopen, post to the books, mark paid), payslips and the
 * bank payment file.
 *
 * Who may do what: preparing a run (create, lock, calculate, adjust, submit,
 * post, mark paid, payslip email, bank file) needs Payroll "update" (owners,
 * admins and accountants); approving needs Payroll "manage" (owners and
 * admins) and the approver cannot be the person who last calculated the run,
 * unless the business has a single user. See lib/payroll/run.ts.
 */

import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { businessMembers, businesses, employees, payrollRunAdjustments, payrollRunLines, payrollRuns, payslips, type TenantDatabase } from "@fintranzact/db";
import {
  MAKER_CHECKER_MESSAGE,
  approverAllowed,
  buildBankPaymentCsv,
  formatPayrollMonth,
  markPaidSchema,
  maskEmail,
  rupeesToPaise,
  runAdjustmentSchema,
  runCreateSchema,
} from "@fintranzact/shared";
import { router, viewerProcedure, memberProcedure } from "../trpc.js";
import { withAudit } from "../lib/audit.js";
import { emailService } from "../lib/email.js";
import { assertPayroll, assertPayrollPosting, notFound, badRequest } from "../lib/payroll/access.js";
import { generatePayslipPDF } from "../lib/payroll/payslip-pdf.js";
import {
  addAdjustment,
  approveRun,
  buildPayslipSnapshot,
  calculateRun,
  createRun,
  deleteRun,
  getRun,
  lockAttendance,
  markRunPaid,
  postRun,
  registrationsOfRun,
  removeAdjustment,
  reopenRun,
  submitRun,
  type PayslipSnapshot,
} from "../lib/payroll/run.js";

const idInput = z.object({ id: z.string().uuid() });

function actorOf(ctx: { user: { id: string; name?: string | null; email?: string | null } }) {
  return { id: ctx.user.id, name: ctx.user.name ?? ctx.user.email ?? null };
}

/**
 * A run as the API returns it: the money columns are rupee strings already. The
 * statutory snapshot is trimmed to what a screen needs (the financial year, the
 * registrations the run was calculated with and where the rates came from); the
 * whole rates document stays in the database.
 */
function presentRun(r: typeof payrollRuns.$inferSelect) {
  const { statutory, ...rest } = r;
  const snap = statutory as { financialYear?: number; ratesSource?: string; flags?: Record<string, unknown> } | null;
  return {
    ...rest,
    statutory: snap ? { financialYear: snap.financialYear ?? null, ratesSource: snap.ratesSource ?? null, flags: snap.flags ?? {} } : null,
  };
}

async function loadPayslipSource(ctx: { db: TenantDatabase; businessId: string }, runId: string, employeeId: string) {
  const run = await getRun(ctx.db, ctx.businessId, runId);
  const [slip] = await ctx.db.select().from(payslips).where(and(eq(payslips.runId, run.id), eq(payslips.employeeId, employeeId), eq(payslips.businessId, ctx.businessId))).limit(1);
  if (slip) return { run, snapshot: slip.snapshot as unknown as PayslipSnapshot, draft: false, slipId: slip.id };

  // Not approved yet: a draft payslip from the calculated line.
  const [line] = await ctx.db.select().from(payrollRunLines).where(and(eq(payrollRunLines.runId, run.id), eq(payrollRunLines.employeeId, employeeId))).limit(1);
  if (!line) throw notFound("Payslip");
  const [emp] = await ctx.db.select().from(employees).where(eq(employees.id, employeeId)).limit(1);
  const [biz] = await ctx.db.select().from(businesses).where(eq(businesses.id, ctx.businessId)).limit(1);
  if (!emp || !biz) throw notFound("Payslip");
  return { run, snapshot: buildPayslipSnapshot({ business: biz, month: run.month, line, employee: emp, registrations: registrationsOfRun(run) }), draft: true, slipId: null as string | null };
}

export const payrollRunRouter = router({
  list: viewerProcedure.query(async ({ ctx }) => {
    await assertPayroll(ctx, "read");
    const rows = await ctx.db.select().from(payrollRuns).where(eq(payrollRuns.businessId, ctx.businessId)).orderBy(desc(payrollRuns.month));
    return rows.map(presentRun);
  }),

  /** A run with its employee lines, adjustments and whether the signed-in person may approve it. */
  get: viewerProcedure.input(idInput).query(async ({ ctx, input }) => {
    await assertPayroll(ctx, "read");
    const run = await getRun(ctx.db, ctx.businessId, input.id);
    const [lines, adjustments, members, slips] = await Promise.all([
      ctx.db.select().from(payrollRunLines).where(eq(payrollRunLines.runId, run.id)).orderBy(asc(payrollRunLines.employeeCode)),
      ctx.db.select().from(payrollRunAdjustments).where(eq(payrollRunAdjustments.runId, run.id)).orderBy(asc(payrollRunAdjustments.createdAt)),
      ctx.db.select({ n: sql<number>`count(*)::int` }).from(businessMembers).where(eq(businessMembers.businessId, ctx.businessId)),
      ctx.db.select({ employeeId: payslips.employeeId, number: payslips.number, emailedAt: payslips.emailedAt }).from(payslips).where(eq(payslips.runId, run.id)),
    ]);
    const canManage = ctx.ability.can("manage", "Payroll");
    const allowed = approverAllowed({ approverUserId: ctx.user.id, calculatedByUserId: run.calculatedByUserId, businessMemberCount: members[0]?.n ?? 1 });
    const slipByEmployee = new Map(slips.map((s) => [s.employeeId, s]));
    return {
      run: presentRun(run),
      lines: lines.map((l) => {
        // Bank details are for the payment file only: the line view carries masked forms.
        const { bankAccountNumber, bankIfsc, bankAccountName, ...rest } = l;
        void bankIfsc;
        void bankAccountName;
        return { ...rest, hasBankDetails: !!bankAccountNumber, payslipNumber: slipByEmployee.get(l.employeeId)?.number ?? null, payslipEmailedAt: slipByEmployee.get(l.employeeId)?.emailedAt ?? null };
      }),
      adjustments,
      approval: {
        canApprove: canManage && allowed && run.status === "pending_approval",
        reason: !canManage ? "Only an owner or admin can approve payroll." : !allowed ? MAKER_CHECKER_MESSAGE : null,
      },
    };
  }),

  create: memberProcedure.input(runCreateSchema).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "create");
      return createRun(ctx.db, { businessId: ctx.businessId, month: input.month, actor: actorOf(ctx) });
    }, (r) => ({ action: "payroll.run.create", entityType: "payrollRun", entityId: r.id, metadata: { month: r.month } })),
  ),

  delete: memberProcedure.input(idInput).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "update");
      await deleteRun(ctx.db, { businessId: ctx.businessId, runId: input.id });
      return { id: input.id };
    }, (r) => ({ action: "payroll.run.delete", entityType: "payrollRun", entityId: r.id })),
  ),

  /** Step 1: lock the month's attendance. Missing working days are refused unless `fillUnmarked` says how to count them. */
  lockAttendance: memberProcedure.input(idInput.extend({ fillUnmarked: z.enum(["present", "absent"]).optional() })).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "update");
      return lockAttendance(ctx.db, { businessId: ctx.businessId, runId: input.id, fillUnmarked: input.fillUnmarked, actor: actorOf(ctx) });
    }, (r) => ({ action: "payroll.run.lockAttendance", entityType: "payrollRun", entityId: r.run.id, metadata: { filled: r.filled } })),
  ),

  /** Step 2: calculate (or recalculate) every employee's pay. */
  calculate: memberProcedure.input(idInput).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "update");
      return calculateRun(ctx.db, { businessId: ctx.businessId, runId: input.id, actor: actorOf(ctx) });
    }, (r) => ({ action: "payroll.run.calculate", entityType: "payrollRun", entityId: r.run.id, metadata: { employees: r.run.employeeCount, warnings: r.warnings.length } })),
  ),

  /** A one-off amount for one employee in this run: a manual deduction, an advance recovery or an incentive. Recalculate afterwards. */
  addAdjustment: memberProcedure.input(runAdjustmentSchema).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "update");
      return addAdjustment(ctx.db, { businessId: ctx.businessId, runId: input.runId, employeeId: input.employeeId, name: input.name, type: input.type, amountPaise: rupeesToPaise(input.amount), note: input.note || null, actor: actorOf(ctx) });
    }, (r) => ({ action: "payroll.run.addAdjustment", entityType: "payrollRun", entityId: r.runId, metadata: { type: r.type } })),
  ),

  removeAdjustment: memberProcedure.input(z.object({ runId: z.string().uuid(), adjustmentId: z.string().uuid() })).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "update");
      await removeAdjustment(ctx.db, { businessId: ctx.businessId, runId: input.runId, adjustmentId: input.adjustmentId });
      return { runId: input.runId };
    }, (r) => ({ action: "payroll.run.removeAdjustment", entityType: "payrollRun", entityId: r.runId })),
  ),

  /** Step 3: send the calculated run for approval. */
  submit: memberProcedure.input(idInput).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "update");
      return submitRun(ctx.db, { businessId: ctx.businessId, runId: input.id, actor: actorOf(ctx) });
    }, (r) => ({ action: "payroll.run.submit", entityType: "payrollRun", entityId: r.id })),
  ),

  /** Step 4: approve (maker-checker). Owners and admins only; not the person who calculated, unless the business has one user. Payslips are created and final. */
  approve: memberProcedure.input(idInput).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "manage");
      return approveRun(ctx.db, { businessId: ctx.businessId, runId: input.id, actor: actorOf(ctx) });
    }, (r) => ({ action: "payroll.run.approve", entityType: "payrollRun", entityId: r.id, metadata: { month: r.month, employees: r.employeeCount, net: r.netTotal } })),
  ),

  /** Back to draft before approval (the calculated lines are discarded). An approved run cannot be reopened. */
  reopen: memberProcedure.input(idInput).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "update");
      return reopenRun(ctx.db, { businessId: ctx.businessId, runId: input.id });
    }, (r) => ({ action: "payroll.run.reopen", entityType: "payrollRun", entityId: r.id })),
  ),

  /** Step 5: post the approved run to the books (one balanced journal entry). Posting twice changes nothing. */
  post: memberProcedure.input(idInput).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayrollPosting(ctx);
      return postRun(ctx.db, { businessId: ctx.businessId, runId: input.id, actor: actorOf(ctx) });
    }, (r) => ({ action: "payroll.run.post", entityType: "payrollRun", entityId: r.run.id, metadata: { journalEntryId: r.journalEntryId, created: r.created } })),
  ),

  /** Step 6: record the payment of net salaries out of a bank or cash account. */
  markPaid: memberProcedure.input(markPaidSchema).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayrollPosting(ctx);
      return markRunPaid(ctx.db, { businessId: ctx.businessId, runId: input.runId, bankAccountId: input.bankAccountId, paidOn: input.paidOn, reference: input.reference || null, actor: actorOf(ctx) });
    }, (r) => ({ action: "payroll.run.markPaid", entityType: "payrollRun", entityId: r.run.id, metadata: { created: r.created } })),
  ),

  // ── Payslips and the bank file ──────────────────────────────────────────────

  /** The payslip as a PDF (base64). Before approval it is a marked draft; after approval it is the frozen payslip. */
  payslipPdf: viewerProcedure.input(z.object({ runId: z.string().uuid(), employeeId: z.string().uuid() })).query(async ({ ctx, input }) => {
    await assertPayroll(ctx, "read");
    const src = await loadPayslipSource(ctx, input.runId, input.employeeId);
    const [biz] = await ctx.db.select({ logo: businesses.logoData }).from(businesses).where(eq(businesses.id, ctx.businessId)).limit(1);
    const pdf = await generatePayslipPDF(src.snapshot, { draft: src.draft, logo: biz?.logo ?? null });
    return { filename: `${src.snapshot.number}${src.draft ? "-draft" : ""}.pdf`, contentType: "application/pdf" as const, base64: pdf.toString("base64"), draft: src.draft };
  }),

  /** Email an approved payslip (PDF attached) to the employee's email address. */
  payslipEmail: memberProcedure.input(z.object({ runId: z.string().uuid(), employeeId: z.string().uuid() })).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "update");
      const src = await loadPayslipSource(ctx, input.runId, input.employeeId);
      if (src.draft || !src.slipId) throw badRequest("Payslips can be emailed once the run is approved.");
      const [emp] = await ctx.db.select({ email: employees.email, name: employees.name }).from(employees).where(and(eq(employees.id, input.employeeId), eq(employees.businessId, ctx.businessId))).limit(1);
      if (!emp?.email) throw badRequest("This employee has no email address. Add one on the employee's page first.");
      const [biz] = await ctx.db.select().from(businesses).where(eq(businesses.id, ctx.businessId)).limit(1);
      const pdf = await generatePayslipPDF(src.snapshot, { logo: biz?.logoData ?? null });
      const s = src.snapshot;
      try {
        await emailService.sendPayslip({
          to: emp.email,
          fromName: s.business.name,
          replyTo: s.business.email,
          subject: `Your payslip for ${s.monthLabel} from ${s.business.name}`,
          text: `Hello ${emp.name},\n\nYour payslip for ${s.monthLabel} is attached. Net pay: INR ${s.netPay}.\n\nIf anything looks wrong, reply to this email or speak to ${s.business.name}.`,
          filename: `${s.number}.pdf`,
          pdf,
        });
      } catch {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The email could not be sent. Check the address and try again." });
      }
      await ctx.db.update(payslips).set({ emailedAt: new Date(), emailedTo: maskEmail(emp.email) }).where(eq(payslips.id, src.slipId));
      return { runId: input.runId, employeeId: input.employeeId, sentTo: maskEmail(emp.email) };
    }, (r) => ({ action: "payroll.payslip.email", entityType: "payrollRun", entityId: r.runId, metadata: { employeeId: r.employeeId } })),
  ),

  /**
   * The bank payment file for an approved run: a generic NEFT/RTGS-style CSV
   * (employee, account, IFSC, amount, narration). It is NOT any bank's own
   * upload format; rearrange the columns if your bank asks for a different one.
   * It contains full bank account numbers, so it needs Payroll "update".
   */
  bankFile: viewerProcedure.input(idInput).query(async ({ ctx, input }) => {
    await assertPayroll(ctx, "update");
    const run = await getRun(ctx.db, ctx.businessId, input.id);
    if (!["approved", "posted", "paid"].includes(run.status)) throw badRequest("The bank file is available once the run is approved.");
    const lines = await ctx.db.select().from(payrollRunLines).where(eq(payrollRunLines.runId, run.id)).orderBy(asc(payrollRunLines.employeeCode));
    const label = formatPayrollMonth(run.month);
    const built = buildBankPaymentCsv(
      lines.map((l) => ({
        employeeCode: l.employeeCode,
        beneficiaryName: l.bankAccountName || l.employeeName,
        accountNumber: l.bankAccountNumber ?? "",
        ifsc: l.bankIfsc ?? "",
        amountPaise: rupeesToPaise(l.netPay),
        narration: `Salary ${label}`,
      })),
    );
    return {
      filename: `salary-${run.month}.csv`,
      contentType: "text/csv" as const,
      csv: built.csv,
      count: built.count,
      total: `${Math.floor(built.totalPaise / 100)}.${String(built.totalPaise % 100).padStart(2, "0")}`,
      /** Employees left out because they have no bank account or IFSC. */
      skipped: built.skipped,
    };
  }),
});
