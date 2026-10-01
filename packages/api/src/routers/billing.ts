import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { controlDb, tenants } from "@fintranzact/db";
import { BILLING_CYCLES, PLAN_IDS, planCheckoutAmount } from "@fintranzact/shared";
import { router, publicProcedure, protectedProcedure } from "../trpc.js";
import { getPlanCatalog } from "../lib/plan-catalog.js";
import { requirePlanManagerTenant } from "../lib/plan-manager.js";

/**
 * Demo checkout: lets a new organisation "pay" for a paid plan in our own
 * checkout UI, without a payment gateway. Real Razorpay comes later.
 *
 * In production it is off unless DEMO_PAYMENTS=true, otherwise anyone could
 * take a paid plan for free.
 */
export function demoPaymentsEnabled(): boolean {
  return process.env.DEMO_PAYMENTS === "true" || process.env.NODE_ENV !== "production";
}

export const billingRouter = router({
  config: publicProcedure.query(() => ({ demoPayments: demoPaymentsEnabled() })),

  demoCheckout: protectedProcedure
    .input(z.object({
      plan: z.enum(PLAN_IDS),
      cycle: z.enum(BILLING_CYCLES),
      method: z.enum(["upi", "card", "netbanking"]),
    }))
    .mutation(async ({ input, ctx }) => {
      if (!demoPaymentsEnabled()) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Online payments are not available yet. Contact us to upgrade." });
      }
      const tenantId = await requirePlanManagerTenant(ctx);

      // Only plans on offer with a price can be bought here: free plans are
      // chosen with tenant.updatePlan, plans priced on request need us.
      const plan = (await getPlanCatalog()).find((p) => p.id === input.plan);
      if (!plan || !plan.visible || plan.monthlyPriceInr === null || plan.monthlyPriceInr <= 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This plan cannot be bought online. Pick a paid plan with a listed price." });
      }

      const { totalPaise } = planCheckoutAmount(plan.monthlyPriceInr, input.cycle);
      const now = new Date();
      await controlDb.update(tenants)
        .set({ plan: plan.id, planSelectedAt: now, updatedAt: now })
        .where(eq(tenants.id, tenantId));

      return {
        paymentId: "pay_demo_" + nanoid(14),
        plan: plan.id,
        amountPaise: totalPaise,
        cycle: input.cycle,
      };
    }),
});
