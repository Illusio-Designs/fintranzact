import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { controlDb, billingPayments, govApiUsage } from "@fintranzact/db";
import { router, protectedProcedure } from "../trpc.js";
import { requirePlanManagerTenant } from "../lib/plan-manager.js";
import { formatBillingInvoiceNumber } from "../lib/billing/service.js";
import { GOV_DOC_LABELS, govRatePaise, usagePeriods, usageSummary, type GovDocKind } from "../lib/gov-usage.js";

const periodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM");

/**
 * Government API (e-invoice / e-way bill) usage, billed per document after
 * the month ends. Owner / billing-manager only, like routers/billing.ts.
 */
export const govUsageRouter = router({
  /** Documents, rates and amount for one month (default: this month), plus the rate card. */
  summary: protectedProcedure
    .input(z.object({ period: periodSchema.optional() }).optional())
    .query(async ({ input, ctx }) => {
      const tenantId = await requirePlanManagerTenant(ctx);
      const [summary, periods] = await Promise.all([
        usageSummary(tenantId, input?.period),
        usagePeriods(tenantId),
      ]);
      const rateCard = (Object.keys(GOV_DOC_LABELS) as GovDocKind[]).map((kind) => ({
        kind,
        label: GOV_DOC_LABELS[kind],
        ratePaise: govRatePaise(kind),
      }));
      return { summary, rateCard, periods };
    }),

  /** Past months with their totals and whether the statement has been raised. */
  statements: protectedProcedure.query(async ({ ctx }) => {
    const tenantId = await requirePlanManagerTenant(ctx);
    const periods = await usagePeriods(tenantId, 24);
    const stamped = await controlDb
      .selectDistinct({ period: govApiUsage.period, paymentId: govApiUsage.statementPaymentId })
      .from(govApiUsage)
      .where(eq(govApiUsage.tenantId, tenantId));
    const payments = await controlDb
      .select({ id: billingPayments.id, invoiceSeq: billingPayments.invoiceSeq, status: billingPayments.status })
      .from(billingPayments)
      .where(and(eq(billingPayments.tenantId, tenantId), eq(billingPayments.provider, "usage")))
      .orderBy(desc(billingPayments.createdAt));
    const paymentById = new Map(payments.map((p) => [p.id, p]));

    return Promise.all(periods.map(async (period) => {
      const s = await usageSummary(tenantId, period);
      const paymentId = stamped.find((r) => r.period === period && r.paymentId)?.paymentId ?? null;
      const payment = paymentId ? paymentById.get(paymentId) : undefined;
      return {
        period,
        documents: s.documents,
        basePaise: s.basePaise,
        gstPaise: s.gstPaise,
        totalPaise: s.totalPaise,
        closed: s.closed,
        billed: paymentId !== null,
        paymentId,
        paymentStatus: payment?.status ?? null,
        invoiceNumber: payment ? formatBillingInvoiceNumber(payment.invoiceSeq) : null,
      };
    }));
  }),
});
