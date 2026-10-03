import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, gte, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { controlDb, getTenantDb, billingPayments, billingSubscriptions, invoices, tenants, tenantMembers } from "@fintranzact/db";
import {
  ADDONS,
  ADDON_IDS,
  BILLING_UPGRADE_PATH,
  BILLING_CYCLES,
  planIdSchema,
  effectiveYearlyPriceInr,
  isStateCode,
  SUBSCRIPTION_STATUS_LABELS,
  cycleAmount,
  entitlementMessage,
  planCheckoutAmount,
  TRIAL_ALREADY_USED_MESSAGE,
  type SubscriptionStatus,
} from "@fintranzact/shared";
import { router, publicProcedure, protectedProcedure, tenantProcedure } from "../trpc.js";
import { getEntitlements } from "../lib/entitlements.js";
import { featureCatalogInfo } from "../lib/feature-gate.js";
import { PLAN_MANAGER_ROLES } from "../lib/plan-manager.js";
import { getPlanCatalog } from "../lib/plan-catalog.js";
import { requirePlanManagerTenant } from "../lib/plan-manager.js";
import { razorpayConfigured, razorpayKeyId, verifyRazorpayCheckoutSignature } from "../lib/billing/gateway.js";
import {
  activateSubscription,
  cancelAtPeriodEnd,
  changePlan,
  formatBillingInvoiceNumber,
  getBillingState,
  startCheckout,
  type SubscriptionRow,
} from "../lib/billing/service.js";

/**
 * Subscription billing for organisation owners: buy a plan or add-on, see the
 * current subscriptions and invoices, change or cancel. Backed by Razorpay
 * subscriptions once keys are configured; the demo checkout flow before that.
 *
 * In production the demo flow is off unless DEMO_PAYMENTS=true, otherwise
 * anyone could take a paid plan for free.
 */
export function demoPaymentsEnabled(): boolean {
  if (razorpayConfigured()) return false;
  return process.env.DEMO_PAYMENTS === "true" || process.env.NODE_ENV !== "production";
}

/** A subscription row as the billing page shows it. */
function subscriptionForOwner(sub: SubscriptionRow) {
  return {
    id: sub.id,
    kind: sub.kind,
    plan: sub.plan,
    addon: sub.addon,
    cycle: sub.cycle,
    status: sub.status as SubscriptionStatus,
    statusLabel: SUBSCRIPTION_STATUS_LABELS[sub.status as SubscriptionStatus],
    basePaise: sub.basePaise,
    currentPeriodEnd: sub.currentPeriodEnd,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    scheduledPlan: sub.scheduledPlan,
    scheduledCycle: sub.scheduledCycle,
    graceUntil: sub.graceUntil,
    provider: sub.provider,
  };
}

export const billingRouter = router({
  config: publicProcedure.query(() => ({
    demoPayments: demoPaymentsEnabled(),
    provider: razorpayConfigured() ? ("razorpay" as const) : ("demo" as const),
    razorpayKeyId: razorpayConfigured() ? razorpayKeyId() : null,
  })),

  /**
   * Demo plan checkout (sign-up flow and Billing tab while no gateway is
   * configured). Creates a real subscription + GST invoice, just without a
   * payment gateway behind it.
   */
  demoCheckout: protectedProcedure
    .input(z.object({
      plan: planIdSchema,
      cycle: z.enum(BILLING_CYCLES),
      method: z.enum(["upi", "card", "netbanking"]),
    }))
    .mutation(async ({ input, ctx }) => {
      if (!demoPaymentsEnabled()) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Online payments are not available yet. Contact us to upgrade." });
      }
      const tenantId = await requirePlanManagerTenant(ctx);
      const checkout = await startCheckout({ tenantId, kind: "plan", plan: input.plan, cycle: input.cycle });
      await activateSubscription({ subscriptionId: checkout.subscription.id, method: input.method });
      return {
        paymentId: "pay_demo_" + nanoid(14),
        plan: input.plan,
        amountPaise: checkout.totalPaise,
        cycle: input.cycle,
      };
    }),

  /**
   * Buy the first plan subscription (sign-up flow and Billing tab). Demo:
   * active immediately. Razorpay: returns what the Razorpay checkout popup
   * needs; verifyCheckout (or the webhook) activates it. An organisation that
   * already has a plan subscription changes it with changePlan instead.
   */
  subscribePlan: protectedProcedure
    .input(z.object({ plan: planIdSchema, cycle: z.enum(BILLING_CYCLES) }))
    .mutation(async ({ input, ctx }) => {
      if (!razorpayConfigured() && !demoPaymentsEnabled()) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Online payments are not available yet. Contact us to upgrade." });
      }
      const tenantId = await requirePlanManagerTenant(ctx);
      const checkout = await startCheckout({ tenantId, kind: "plan", plan: input.plan, cycle: input.cycle });
      if (checkout.provider === "demo") {
        await activateSubscription({ subscriptionId: checkout.subscription.id, method: "demo" });
        return { status: "active" as const, subscriptionId: checkout.subscription.id, totalPaise: checkout.totalPaise };
      }
      return {
        status: "checkout" as const,
        subscriptionId: checkout.subscription.id,
        providerSubscriptionId: checkout.providerSubscriptionId,
        razorpayKeyId: razorpayKeyId(),
        totalPaise: checkout.totalPaise,
      };
    }),

  /**
   * Buy an add-on. Demo: active immediately. Razorpay: returns what the
   * Razorpay checkout needs; verifyCheckout (or the webhook) activates it.
   */
  subscribeAddon: protectedProcedure
    .input(z.object({ addon: z.enum(ADDON_IDS), cycle: z.enum(BILLING_CYCLES) }))
    .mutation(async ({ input, ctx }) => {
      const tenantId = await requirePlanManagerTenant(ctx);
      if (!razorpayConfigured() && !demoPaymentsEnabled()) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Online payments are not available yet. Contact us to upgrade." });
      }
      const checkout = await startCheckout({ tenantId, kind: "addon", addon: input.addon, cycle: input.cycle });
      if (checkout.provider === "demo") {
        await activateSubscription({ subscriptionId: checkout.subscription.id, method: "demo" });
        return { status: "active" as const, subscriptionId: checkout.subscription.id, totalPaise: checkout.totalPaise };
      }
      return {
        status: "checkout" as const,
        subscriptionId: checkout.subscription.id,
        providerSubscriptionId: checkout.providerSubscriptionId,
        razorpayKeyId: razorpayKeyId(),
        totalPaise: checkout.totalPaise,
      };
    }),

  /** Razorpay checkout callback: verify the signature, then activate. */
  verifyCheckout: protectedProcedure
    .input(z.object({
      subscriptionId: z.string().uuid(),
      razorpayPaymentId: z.string().min(1).max(100),
      razorpaySignature: z.string().min(1).max(200),
    }))
    .mutation(async ({ input, ctx }) => {
      const tenantId = await requirePlanManagerTenant(ctx);
      const [row] = await controlDb
        .select()
        .from(billingSubscriptions)
        .where(and(eq(billingSubscriptions.id, input.subscriptionId), eq(billingSubscriptions.tenantId, tenantId)))
        .limit(1);
      if (!row?.providerSubscriptionId) throw new TRPCError({ code: "NOT_FOUND", message: "Subscription not found." });
      const ok = verifyRazorpayCheckoutSignature({
        paymentId: input.razorpayPaymentId,
        subscriptionId: row.providerSubscriptionId,
        signature: input.razorpaySignature,
      });
      if (!ok) throw new TRPCError({ code: "BAD_REQUEST", message: "Payment could not be verified." });
      await activateSubscription({ subscriptionId: row.id, providerPaymentId: input.razorpayPaymentId });
      return { status: "active" as const };
    }),

  /**
   * Lightweight status for the banners every member sees (trial countdown,
   * read-only, past-due grace, suspended). Open to every member of the
   * organisation, unlike overview, and allowed while read-only or suspended.
   * `canManageBilling` tells the client whether to offer "Choose a plan" or
   * "Ask your organization owner".
   */
  status: tenantProcedure.query(async ({ ctx }) => {
    const ent = await getEntitlements(ctx.tenantId);
    const [membership] = await controlDb
      .select({ role: tenantMembers.role })
      .from(tenantMembers)
      .where(and(eq(tenantMembers.tenantId, ctx.tenantId), eq(tenantMembers.userId, ctx.user.id)))
      .limit(1);
    const featureInfo = await featureCatalogInfo();
    return {
      state: ent.state,
      readOnly: ent.readOnly,
      reason: ent.reason,
      message: ent.reason ? entitlementMessage(ent.reason) : null,
      trialEndsAt: ent.trialEndsAt,
      trialDaysLeft: ent.trialDaysLeft,
      /** The Full Access Trial: active, window, source, add-on caps (additive). */
      trial: ent.trial,
      /** Why there is no trial, when there is none because one was already used. */
      trialMessage: ent.trial.source === "none" && ent.readOnly ? TRIAL_ALREADY_USED_MESSAGE : null,
      effectivePlan: ent.effectivePlan,
      graceUntil: ent.graceUntil,
      addons: ent.addons,
      // The plan's feature flags in force now (trial = Business-level, grandfathered = all), and
      // for each flag the cheapest plan that has it in the stored plan settings (for badges and prompts).
      plan: ent.plan,
      features: ent.features,
      featureRequiredPlans: featureInfo.requiredPlans,
      topPlanName: featureInfo.topPlanName,
      upgradePath: BILLING_UPGRADE_PATH,
      canManageBilling: !!membership && PLAN_MANAGER_ROLES.includes(membership.role),
    };
  }),

  /** Everything the Billing tab shows, in one query. */
  overview: protectedProcedure.query(async ({ ctx }) => {
    const tenantId = await requirePlanManagerTenant(ctx);
    const state = await getBillingState(tenantId);

    const [tenant] = await controlDb
      .select({
        plan: tenants.plan,
        name: tenants.name,
        billingName: tenants.billingName,
        billingGstin: tenants.billingGstin,
        billingAddress: tenants.billingAddress,
        billingState: tenants.billingState,
        billingEmail: tenants.billingEmail,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    if (!tenant) throw new TRPCError({ code: "NOT_FOUND", message: "Organization not found." });

    const catalog = await getPlanCatalog();
    const currentPlan = catalog.find((p) => p.id === tenant.plan);

    const payRows = await controlDb
      .select()
      .from(billingPayments)
      .where(eq(billingPayments.tenantId, tenantId))
      .orderBy(desc(billingPayments.createdAt))
      .limit(24);

    // Usage this month: invoices across the organisation's businesses. AI
    // questions and payroll employee counts join in when those add-ons ship.
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    let invoicesThisMonth = 0;
    try {
      const db = await getTenantDb(tenantId);
      const [row] = await db
        .select({ n: count() })
        .from(invoices)
        .where(and(
          eq(invoices.documentType, "invoice"),
          gte(invoices.invoiceDate, monthStart),
          isNull(invoices.deletedAt),
        ));
      invoicesThisMonth = row?.n ?? 0;
    } catch {
      // A brand-new organisation may have no tenant DB yet.
    }

    return {
      plan: {
        id: tenant.plan,
        name: currentPlan?.name ?? tenant.plan,
        monthlyPriceInr: currentPlan?.monthlyPriceInr ?? null,
      },
      planSubscription: state.planSubscription ? subscriptionForOwner(state.planSubscription) : null,
      addonSubscriptions: state.addonSubscriptions.map(subscriptionForOwner),
      readOnly: state.readOnly,
      graceUntil: state.graceUntil,
      addons: ADDONS.map((a) => ({
        ...a,
        monthly: cycleAmount(a.monthlyPriceInr, "monthly"),
        yearly: cycleAmount(a.monthlyPriceInr, "yearly"),
      })),
      plans: catalog
        .filter((p) => p.visible && p.monthlyPriceInr !== null && p.monthlyPriceInr > 0)
        .map((p) => ({
          id: p.id,
          name: p.name,
          tagline: p.tagline,
          monthlyPriceInr: p.monthlyPriceInr!,
          features: p.features,
          highlight: !!p.highlight,
          yearlyPriceInr: effectiveYearlyPriceInr(p),
          monthly: planCheckoutAmount(p.monthlyPriceInr!, "monthly"),
          yearly: planCheckoutAmount(p.monthlyPriceInr!, "yearly", p.yearlyPriceInr),
        })),
      billingDetails: {
        name: tenant.billingName ?? tenant.name,
        gstin: tenant.billingGstin,
        address: tenant.billingAddress,
        email: tenant.billingEmail,
        /** GST state code, or null. When a GSTIN is set the GSTIN's state decides the tax (see billingPlaceOfSupply). */
        state: tenant.billingState,
      },
      usage: {
        invoicesThisMonth,
        aiQuestions: null as number | null,
        payrollEmployees: null as number | null,
      },
      payments: payRows.map((p) => ({
        id: p.id,
        invoiceNumber: formatBillingInvoiceNumber(p.invoiceSeq),
        status: p.status,
        description: p.description,
        totalPaise: p.totalPaise,
        method: p.method,
        failureReason: p.failureReason,
        createdAt: p.createdAt,
      })),
    };
  }),

  /** The details printed on Finvera's GST invoices to this organisation. */
  updateBillingDetails: protectedProcedure
    .input(z.object({
      name: z.string().trim().min(1).max(160),
      gstin: z.string().trim().toUpperCase().regex(/^[0-9]{2}[A-Z0-9]{13}$/, "Enter a valid 15-character GSTIN").nullable(),
      address: z.string().trim().max(500).nullable(),
      email: z.string().trim().email().max(254).nullable(),
      /** GST state code (e.g. "24"), from the shared list; null clears it. Omitted = unchanged. */
      state: z.string().trim().nullable().optional().refine((v) => v == null || v === "" || isStateCode(v), "Choose a state or UT from the list"),
    }))
    .mutation(async ({ input, ctx }) => {
      const tenantId = await requirePlanManagerTenant(ctx);
      await controlDb
        .update(tenants)
        .set({
          billingName: input.name,
          billingGstin: input.gstin,
          billingAddress: input.address,
          billingEmail: input.email,
          ...(input.state === undefined ? {} : { billingState: input.state || null }),
          updatedAt: new Date(),
        })
        .where(eq(tenants.id, tenantId));
      return { ok: true };
    }),

  /** Upgrade now (prorated) or schedule a downgrade for the period end. */
  changePlan: protectedProcedure
    .input(z.object({ plan: planIdSchema, cycle: z.enum(BILLING_CYCLES) }))
    .mutation(async ({ input, ctx }) => {
      if (!razorpayConfigured() && !demoPaymentsEnabled()) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Online payments are not available yet. Contact us to upgrade." });
      }
      const tenantId = await requirePlanManagerTenant(ctx);
      return changePlan({ tenantId, plan: input.plan, cycle: input.cycle });
    }),

  /** Cancel at the period end: what was paid for runs until it runs out. */
  cancelSubscription: protectedProcedure
    .input(z.object({ subscriptionId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const tenantId = await requirePlanManagerTenant(ctx);
      await cancelAtPeriodEnd({ tenantId, subscriptionId: input.subscriptionId });
      return { ok: true };
    }),
});
