/**
 * Payroll Phase 4: gratuity. The eligibility and liability estimate (what would be payable today), the provision history and
 * the manual "post provision" action. Paying gratuity happens in the full and final settlement (payrollFnf). Tax on
 * gratuity is not computed.
 */

import { z } from "zod";
import { gratuityProvisionSchema, istDateParts, isoDateSchema, paiseToRupees, VERIFY_WITH_CA_LABEL } from "@fintranzact/shared";
import { router, viewerProcedure, memberProcedure } from "../trpc.js";
import { withAudit } from "../lib/audit.js";
import { assertPayroll, assertPayrollPosting } from "../lib/payroll/access.js";
import { estimateGratuity, postGratuityProvision, provisionBalancePaise, provisionHistory } from "../lib/payroll/gratuity.js";

function actorOf(ctx: { user: { id: string; name?: string | null; email?: string | null } }) {
  return { id: ctx.user.id, name: ctx.user.name ?? ctx.user.email ?? null };
}

function today(): string {
  const p = istDateParts(new Date());
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export const payrollGratuityRouter = router({
  /** Per active employee: years of service, eligibility and the amount payable on the date, plus the total liability and the provision already in the books. */
  estimate: viewerProcedure.input(z.object({ asOf: isoDateSchema.optional() })).query(async ({ ctx, input }) => {
    await assertPayroll(ctx, "read");
    const asOf = input.asOf ?? today();
    const est = await estimateGratuity(ctx.db, ctx.businessId, asOf);
    const balance = await provisionBalancePaise(ctx.db, ctx.businessId);
    return {
      asOf,
      verifyLabel: VERIFY_WITH_CA_LABEL,
      rules: est.rules,
      liability: paiseToRupees(est.payableTodayPaise),
      ifEligible: paiseToRupees(est.ifEligiblePaise),
      eligibleCount: est.eligibleCount,
      provisionInBooks: paiseToRupees(balance),
      toProvide: paiseToRupees(est.payableTodayPaise - balance),
      rows: est.rows.map((r) => ({
        employeeId: r.employeeId,
        employeeCode: r.employeeCode,
        name: r.name,
        joinedOn: r.joinedOn,
        employmentType: r.employmentType,
        hasSalary: r.hasSalary,
        lastDrawnWages: paiseToRupees(r.lastDrawnWagesPaise),
        completedYears: r.detail.completedYears,
        yearsUsed: r.detail.yearsForFormula,
        minYearsRequired: r.detail.minYearsRequired,
        rule: r.detail.rule,
        eligible: r.detail.eligible,
        amount: paiseToRupees(r.detail.amountPaise),
        ifEligible: paiseToRupees(r.detail.ifEligiblePaise),
        capped: r.detail.capped,
      })),
    };
  }),

  provisionHistory: viewerProcedure.query(async ({ ctx }) => {
    await assertPayroll(ctx, "read");
    return provisionHistory(ctx.db, ctx.businessId);
  }),

  /**
   * Book the provision: the difference between the liability on the date and the balance of the Gratuity Provision account
   * (Dr Salary - Gratuity / Cr Gratuity Provision). A second press with nothing to add posts nothing.
   */
  postProvision: memberProcedure.input(gratuityProvisionSchema).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayrollPosting(ctx);
      return postGratuityProvision(ctx.db, { businessId: ctx.businessId, asOf: input.asOf, note: input.note || null, actor: actorOf(ctx) });
    }, (r, input) => ({ action: "payroll.gratuity.postProvision", entityType: "gratuityProvision", entityId: r.id, metadata: { asOf: input.asOf, amountPaise: r.amountPaise, journalEntryId: r.journalEntryId } })),
  ),
});
