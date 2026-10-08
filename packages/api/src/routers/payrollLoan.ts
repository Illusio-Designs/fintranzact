/**
 * Payroll Phase 4: loans and advances to employees. HR, accountants, owners and admins issue, cancel, skip and reschedule
 * (Payroll create / update); owners and admins approve or reject (Payroll "manage", not the person who requested it unless
 * the business has one user); disbursing and receiving money post to the books (PayrollPosting). Instalments are recovered
 * by payroll runs automatically (lib/payroll/run.ts) and the balance by the full and final settlement.
 * The employee-side read-only view (payrollSelf.loans) was NOT built (docs/architecture/payroll-phase-4.md).
 */

import { z } from "zod";
import { payrollSettings } from "@fintranzact/db";
import {
  loanCreateSchema,
  loanDisburseSchema,
  loanReceiveSchema,
  loanRescheduleSchema,
  loanSchedulePreviewSchema,
  loanSettingsSchema,
  loanSkipSchema,
  rupeesToPaise,
  LOAN_STATUSES,
} from "@fintranzact/shared";
import { router, viewerProcedure, memberProcedure } from "../trpc.js";
import { withAudit } from "../lib/audit.js";
import { assertPayroll, assertPayrollPosting } from "../lib/payroll/access.js";
import { loadPayrollSettings } from "../lib/payroll/data.js";
import {
  approveLoan,
  cancelLoan,
  createLoan,
  disburseLoan,
  listLoans,
  loanDetail,
  loanStatementCsv,
  previewSchedule,
  receiveLoanPayment,
  rejectLoan,
  rescheduleLoan,
  skipInstalment,
} from "../lib/payroll/loans.js";

const idInput = z.object({ id: z.string().uuid() });

function actorOf(ctx: { user: { id: string; name?: string | null; email?: string | null } }) {
  return { id: ctx.user.id, name: ctx.user.name ?? ctx.user.email ?? null };
}

export const payrollLoanRouter = router({
  list: viewerProcedure
    .input(z.object({ employeeId: z.string().uuid().optional(), status: z.enum(LOAN_STATUSES).optional() }))
    .query(async ({ ctx, input }) => {
      await assertPayroll(ctx, "read");
      return listLoans(ctx.db, ctx.businessId, input);
    }),

  /** A loan with its schedule, event log (the statement) and balance. */
  get: viewerProcedure.input(idInput).query(async ({ ctx, input }) => {
    await assertPayroll(ctx, "read");
    return loanDetail(ctx.db, ctx.businessId, input.id);
  }),

  /** The schedule a loan would have (EMI, interest per month, last-instalment adjustment) before it is issued. */
  schedulePreview: viewerProcedure.input(loanSchedulePreviewSchema).query(async ({ ctx, input }) => {
    await assertPayroll(ctx, "read");
    return previewSchedule(input);
  }),

  /** The business's cap on the share of net pay a run recovers for loan instalments. */
  settings: viewerProcedure.query(async ({ ctx }) => {
    await assertPayroll(ctx, "read");
    const s = await loadPayrollSettings(ctx.db, ctx.businessId);
    return { maxDeductionPercent: s.loanMaxDeductionPercent };
  }),

  updateSettings: memberProcedure.input(loanSettingsSchema).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "manage");
      const values = { businessId: ctx.businessId, loanMaxDeductionPercent: String(input.maxDeductionPercent), updatedAt: new Date() };
      await ctx.db.insert(payrollSettings).values(values).onConflictDoUpdate({ target: payrollSettings.businessId, set: { loanMaxDeductionPercent: values.loanMaxDeductionPercent, updatedAt: values.updatedAt } });
      return { maxDeductionPercent: input.maxDeductionPercent };
    }, (r) => ({ action: "payroll.loan.updateSettings", entityType: "payrollSettings", entityId: null, metadata: { maxDeductionPercent: r.maxDeductionPercent } })),
  ),

  create: memberProcedure.input(loanCreateSchema).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "create");
      return createLoan(ctx.db, { businessId: ctx.businessId, data: input, actor: actorOf(ctx) });
    }, (r) => ({ action: "payroll.loan.create", entityType: "employeeLoan", entityId: r.id, metadata: { number: r.number, principal: r.principal, employeeId: r.employeeId } })),
  ),

  approve: memberProcedure.input(idInput.extend({ note: z.string().trim().max(200).optional() })).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "manage");
      return approveLoan(ctx.db, { businessId: ctx.businessId, id: input.id, actor: actorOf(ctx), note: input.note || null });
    }, (r) => ({ action: "payroll.loan.approve", entityType: "employeeLoan", entityId: r.id, metadata: { number: r.number } })),
  ),

  reject: memberProcedure.input(idInput.extend({ note: z.string().trim().min(3, "Say why the loan is rejected.").max(200) })).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "manage");
      return rejectLoan(ctx.db, { businessId: ctx.businessId, id: input.id, actor: actorOf(ctx), note: input.note });
    }, (r) => ({ action: "payroll.loan.reject", entityType: "employeeLoan", entityId: r.id, metadata: { number: r.number } })),
  ),

  cancel: memberProcedure.input(idInput).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "update");
      return cancelLoan(ctx.db, { businessId: ctx.businessId, id: input.id, actor: actorOf(ctx) });
    }, (r) => ({ action: "payroll.loan.cancel", entityType: "employeeLoan", entityId: r.id, metadata: { number: r.number } })),
  ),

  /** Pay out an approved loan from a bank or cash account: Dr Loans and Advances to Employees / Cr bank or cash. Twice changes nothing. */
  disburse: memberProcedure.input(loanDisburseSchema).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayrollPosting(ctx);
      return disburseLoan(ctx.db, { businessId: ctx.businessId, id: input.id, bankAccountId: input.bankAccountId, paidOn: input.paidOn, reference: input.reference || null, actor: actorOf(ctx) });
    }, (r) => ({ action: "payroll.loan.disburse", entityType: "employeeLoan", entityId: r.loan.id, metadata: { number: r.loan.number, journalEntryId: r.journalEntryId } })),
  ),

  /** The employee repays part of the balance in cash or to the bank: the rest of the loan is re-planned at the same EMI. */
  prepay: memberProcedure.input(loanReceiveSchema.extend({ amount: z.number().positive().max(100_000_000) })).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayrollPosting(ctx);
      return receiveLoanPayment(ctx.db, {
        businessId: ctx.businessId,
        id: input.id,
        bankAccountId: input.bankAccountId,
        receivedOn: input.receivedOn,
        amountPaise: rupeesToPaise(input.amount),
        interestPaise: rupeesToPaise(input.interest),
        foreclose: false,
        reference: input.reference || null,
        actor: actorOf(ctx),
      });
    }, (r) => ({ action: "payroll.loan.prepay", entityType: "employeeLoan", entityId: r.loan.id, metadata: { number: r.loan.number, principalPaise: r.principalPaise, balancePaise: r.balancePaise } })),
  ),

  /** The employee repays the whole outstanding balance (and optionally interest): the loan is closed. */
  foreclose: memberProcedure.input(loanReceiveSchema.omit({ amount: true })).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayrollPosting(ctx);
      return receiveLoanPayment(ctx.db, {
        businessId: ctx.businessId,
        id: input.id,
        bankAccountId: input.bankAccountId,
        receivedOn: input.receivedOn,
        interestPaise: rupeesToPaise(input.interest),
        foreclose: true,
        reference: input.reference || null,
        actor: actorOf(ctx),
      });
    }, (r) => ({ action: "payroll.loan.foreclose", entityType: "employeeLoan", entityId: r.loan.id, metadata: { number: r.loan.number, principalPaise: r.principalPaise } })),
  ),

  /** Skip the next instalment (reason required); later instalments move one month. */
  skip: memberProcedure.input(loanSkipSchema).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "update");
      return skipInstalment(ctx.db, { businessId: ctx.businessId, id: input.id, reason: input.reason, actor: actorOf(ctx) });
    }, (r, input) => ({ action: "payroll.loan.skip", entityType: "employeeLoan", entityId: r.id, metadata: { number: r.number, reason: input.reason } })),
  ),

  /** Re-plan what is left: a new number of instalments or a new EMI, from a month (reason required). */
  reschedule: memberProcedure.input(loanRescheduleSchema).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "update");
      return rescheduleLoan(ctx.db, {
        businessId: ctx.businessId,
        id: input.id,
        reason: input.reason,
        installments: input.installments,
        emiPaise: input.emi != null ? rupeesToPaise(input.emi) : undefined,
        firstMonth: input.firstMonth,
        actor: actorOf(ctx),
      });
    }, (r, input) => ({ action: "payroll.loan.reschedule", entityType: "employeeLoan", entityId: r.id, metadata: { number: r.number, reason: input.reason } })),
  ),

  /** The statement of a loan as a CSV. */
  statementCsv: viewerProcedure.input(idInput).query(async ({ ctx, input }) => {
    await assertPayroll(ctx, "read");
    const s = await loanStatementCsv(ctx.db, ctx.businessId, input.id);
    return { filename: s.filename, contentType: "text/csv" as const, csv: s.csv, number: s.number };
  }),
});

