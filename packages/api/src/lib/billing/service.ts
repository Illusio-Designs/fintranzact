/**
 * Subscription lifecycle — the one place that moves billing_subscriptions
 * between states and writes billing_payments / billing_events.
 *
 * Who calls it:
 *  - routers/billing.ts: checkout, plan change, cancel (owner actions)
 *  - http/razorpayWebhook.ts: activated / charged / pending / halted / cancelled
 *  - routers/platform.ts: the admin's billing views (reads only)
 *
 * The grace period is applied lazily: nothing has to run at the moment grace
 * ends. getBillingState compares grace_until with the clock and flips the row
 * to halted on the next read, so a crashed scheduler can never leave an
 * unpaid organisation writable.
 */

import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { controlDb, billingEvents, billingPayments, billingSubscriptions, tenants } from "@fintranzact/db";
import {
  ADDONS,
  BILLING_GRACE_DAYS,
  addonById,
  cycleAmount,
  gstOnPaise,
  nextPeriodEnd,
  prorationCreditPaise,
  subscriptionIsLive,
  YEARLY_CYCLE_MONTHS,
  type AddonId,
  type BillingCycle,
  type SubscriptionStatus,
} from "@fintranzact/shared";
import { getPlanCatalog } from "../plan-catalog.js";
import { getGateway, type BillingProvider } from "./gateway.js";
import { logger } from "../logger.js";

export type SubscriptionRow = typeof billingSubscriptions.$inferSelect;

const LIVE_STATUSES: SubscriptionStatus[] = ["created", "active", "past_due", "halted"];

/** "Pro plan — monthly" / "AI Assistant add-on — yearly". */
function describeSubscription(sub: Pick<SubscriptionRow, "kind" | "plan" | "addon" | "cycle">, itemName: string): string {
  return `${itemName}${sub.kind === "addon" ? " add-on" : " plan"} — ${sub.cycle}`;
}

async function itemNameFor(sub: Pick<SubscriptionRow, "kind" | "plan" | "addon">): Promise<string> {
  if (sub.kind === "addon") return addonById(sub.addon ?? "")?.name ?? sub.addon ?? "Add-on";
  const plan = (await getPlanCatalog()).find((p) => p.id === sub.plan);
  return plan?.name ?? sub.plan ?? "Plan";
}

/** The billing audit trail; `local` provider = a step the API took itself. */
export async function recordBillingEvent(opts: {
  provider: BillingProvider | "local";
  type: string;
  tenantId?: string | null;
  subscriptionId?: string | null;
  eventId?: string | null;
  payload?: unknown;
  error?: string | null;
}): Promise<void> {
  await controlDb.insert(billingEvents).values({
    provider: opts.provider,
    type: opts.type,
    tenantId: opts.tenantId ?? null,
    subscriptionId: opts.subscriptionId ?? null,
    eventId: opts.eventId ?? null,
    payload: opts.payload === undefined ? null : opts.payload,
    error: opts.error ?? null,
  });
}

// ── Payments & GST invoices ────────────────────────────────────────────────

/**
 * Record a charge. Captured (and credit) rows take the next GST invoice
 * number from billing_invoice_seq and freeze the customer's billing details;
 * failed rows record the reason and never consume an invoice number.
 */
export async function recordPayment(opts: {
  tenantId: string;
  subscriptionId: string | null;
  status: "captured" | "failed" | "refunded" | "credit";
  description: string;
  basePaise: number;
  provider: BillingProvider;
  method?: string | null;
  providerPaymentId?: string | null;
  providerInvoiceId?: string | null;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  failureReason?: string | null;
}): Promise<{ id: string; invoiceNumber: string | null }> {
  const gstPaise = gstOnPaise(opts.basePaise);
  const numbered = opts.status === "captured" || opts.status === "credit";
  const [tenant] = await controlDb
    .select({ name: tenants.name, billingName: tenants.billingName, billingGstin: tenants.billingGstin, billingAddress: tenants.billingAddress })
    .from(tenants)
    .where(eq(tenants.id, opts.tenantId))
    .limit(1);

  const [row] = await controlDb
    .insert(billingPayments)
    .values({
      tenantId: opts.tenantId,
      subscriptionId: opts.subscriptionId,
      invoiceSeq: numbered ? sql`nextval('billing_invoice_seq')::int` : null,
      status: opts.status,
      description: opts.description,
      basePaise: opts.basePaise,
      gstPaise,
      totalPaise: opts.basePaise + gstPaise,
      method: opts.method ?? null,
      provider: opts.provider,
      providerPaymentId: opts.providerPaymentId ?? null,
      providerInvoiceId: opts.providerInvoiceId ?? null,
      periodStart: opts.periodStart ?? null,
      periodEnd: opts.periodEnd ?? null,
      billingName: tenant?.billingName ?? tenant?.name ?? null,
      billingGstin: tenant?.billingGstin ?? null,
      billingAddress: tenant?.billingAddress ?? null,
      failureReason: opts.failureReason ?? null,
    })
    .returning({ id: billingPayments.id, invoiceSeq: billingPayments.invoiceSeq });

  return { id: row!.id, invoiceNumber: formatBillingInvoiceNumber(row!.invoiceSeq) };
}

/** "FIN-00042" from the sequence value; null for unnumbered (failed) rows. */
export function formatBillingInvoiceNumber(seq: number | null): string | null {
  return seq === null ? null : "FIN-" + String(seq).padStart(5, "0");
}

// ── Checkout ───────────────────────────────────────────────────────────────

export interface StartCheckoutResult {
  subscription: SubscriptionRow;
  provider: BillingProvider;
  providerSubscriptionId: string;
  totalPaise: number;
}

/**
 * Start buying a plan or add-on: price the item from the live catalogue,
 * create the gateway subscription and a `created` row. The demo gateway's
 * caller then activates immediately; Razorpay rows activate from the checkout
 * callback (verifyCheckout) or the subscription.activated webhook.
 */
export async function startCheckout(opts: {
  tenantId: string;
  kind: "plan" | "addon";
  plan?: string;
  addon?: AddonId;
  cycle: BillingCycle;
}): Promise<StartCheckoutResult> {
  let itemKey: string;
  let itemName: string;
  let monthlyPriceInr: number;

  if (opts.kind === "plan") {
    const plan = (await getPlanCatalog()).find((p) => p.id === opts.plan);
    if (!plan || !plan.visible || plan.monthlyPriceInr === null || plan.monthlyPriceInr <= 0) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "This plan cannot be bought online. Pick a paid plan with a listed price." });
    }
    itemKey = `plan:${plan.id}`;
    itemName = plan.name;
    monthlyPriceInr = plan.monthlyPriceInr;
  } else {
    const addon = addonById(opts.addon ?? "");
    if (!addon) throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown add-on." });
    // AI Assistant and AI Plus are tiers of one add-on.
    const clash = ADDONS.filter((a) => a.group === addon.group).map((a) => a.id);
    const [existing] = await controlDb
      .select({ id: billingSubscriptions.id, addon: billingSubscriptions.addon, status: billingSubscriptions.status })
      .from(billingSubscriptions)
      .where(and(
        eq(billingSubscriptions.tenantId, opts.tenantId),
        eq(billingSubscriptions.kind, "addon"),
        inArray(billingSubscriptions.addon, clash),
        inArray(billingSubscriptions.status, ["active", "past_due", "halted"]),
      ))
      .limit(1);
    if (existing) {
      throw new TRPCError({
        code: "CONFLICT",
        message: existing.addon === addon.id
          ? "This add-on is already on your account."
          : "You already have the other tier of this add-on. Cancel it first to switch.",
      });
    }
    // An abandoned checkout for this add-on gives way to a fresh one.
    await controlDb
      .update(billingSubscriptions)
      .set({ status: "cancelled", endedAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(billingSubscriptions.tenantId, opts.tenantId),
        eq(billingSubscriptions.kind, "addon"),
        eq(billingSubscriptions.addon, addon.id),
        eq(billingSubscriptions.status, "created"),
      ));
    itemKey = `addon:${addon.id}`;
    itemName = addon.name;
    monthlyPriceInr = addon.monthlyPriceInr;
  }

  // A live plan subscription blocks a second one: plan changes go through
  // changePlan so proration and the old gateway subscription are handled.
  if (opts.kind === "plan") {
    const [live] = await controlDb
      .select({ id: billingSubscriptions.id })
      .from(billingSubscriptions)
      .where(and(
        eq(billingSubscriptions.tenantId, opts.tenantId),
        eq(billingSubscriptions.kind, "plan"),
        inArray(billingSubscriptions.status, ["active", "past_due", "halted"]),
      ))
      .limit(1);
    if (live) {
      throw new TRPCError({ code: "CONFLICT", message: "This organisation already has a plan subscription. Change the plan instead." });
    }
    // A stale half-finished checkout gives way to a fresh one.
    await controlDb
      .update(billingSubscriptions)
      .set({ status: "cancelled", endedAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(billingSubscriptions.tenantId, opts.tenantId),
        eq(billingSubscriptions.kind, "plan"),
        eq(billingSubscriptions.status, "created"),
      ));
  }

  const amount = cycleAmount(monthlyPriceInr, opts.cycle);
  const gateway = getGateway();
  const created = await gateway.createSubscription({
    itemKey,
    itemName: `Fintranzact ${itemName} (${opts.cycle})`,
    cycle: opts.cycle,
    totalPaise: amount.totalPaise,
    notes: { tenantId: opts.tenantId, item: itemKey, cycle: opts.cycle },
  });

  const [sub] = await controlDb
    .insert(billingSubscriptions)
    .values({
      tenantId: opts.tenantId,
      kind: opts.kind,
      plan: opts.kind === "plan" ? opts.plan : null,
      addon: opts.kind === "addon" ? opts.addon : null,
      cycle: opts.cycle,
      status: "created",
      provider: gateway.name,
      providerSubscriptionId: created.id,
      basePaise: amount.basePaise,
    })
    .returning();

  await recordBillingEvent({
    provider: "local",
    type: "checkout.started",
    tenantId: opts.tenantId,
    subscriptionId: sub!.id,
    payload: { item: itemKey, cycle: opts.cycle, totalPaise: amount.totalPaise, provider: gateway.name },
  });

  return { subscription: sub!, provider: gateway.name, providerSubscriptionId: created.id, totalPaise: amount.totalPaise };
}

// ── Activation & renewals ──────────────────────────────────────────────────

/**
 * First successful charge: the subscription becomes active for one period,
 * the GST invoice is issued, and a plan purchase switches tenants.plan.
 */
export async function activateSubscription(opts: {
  subscriptionId: string;
  method?: string | null;
  providerPaymentId?: string | null;
  /** Credit already applied to this first charge (upgrade proration). */
  creditPaise?: number;
}): Promise<void> {
  const [sub] = await controlDb.select().from(billingSubscriptions).where(eq(billingSubscriptions.id, opts.subscriptionId)).limit(1);
  if (!sub) throw new TRPCError({ code: "NOT_FOUND", message: "Subscription not found." });
  if (sub.status === "active") return; // webhook + callback can both fire
  if (sub.status === "cancelled") throw new TRPCError({ code: "CONFLICT", message: "This subscription has ended." });

  const now = new Date();
  const periodEnd = nextPeriodEnd(now, sub.cycle);
  await controlDb
    .update(billingSubscriptions)
    .set({
      status: "active",
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      graceUntil: null,
      updatedAt: now,
    })
    .where(eq(billingSubscriptions.id, sub.id));

  if (sub.kind === "plan" && sub.plan) {
    await controlDb
      .update(tenants)
      .set({ plan: sub.plan as typeof tenants.$inferSelect.plan, planSelectedAt: now, updatedAt: now })
      .where(eq(tenants.id, sub.tenantId));
  }

  const itemName = await itemNameFor(sub);
  const credit = Math.min(opts.creditPaise ?? 0, sub.basePaise);
  await recordPayment({
    tenantId: sub.tenantId,
    subscriptionId: sub.id,
    status: "captured",
    description: describeSubscription(sub, itemName) + (credit > 0 ? " (first charge, credit applied)" : ""),
    basePaise: sub.basePaise - credit,
    provider: sub.provider as BillingProvider,
    method: opts.method,
    providerPaymentId: opts.providerPaymentId,
    periodStart: now,
    periodEnd,
  });

  await recordBillingEvent({
    provider: "local",
    type: "subscription.activated",
    tenantId: sub.tenantId,
    subscriptionId: sub.id,
    payload: { providerPaymentId: opts.providerPaymentId ?? null, creditPaise: credit },
  });
}

/** A renewal charge succeeded: extend the period and issue the next invoice. */
export async function recordRenewal(sub: SubscriptionRow, opts: {
  providerPaymentId?: string | null;
  providerInvoiceId?: string | null;
  method?: string | null;
}): Promise<void> {
  const now = new Date();
  const start = sub.currentPeriodEnd && sub.currentPeriodEnd > now ? sub.currentPeriodEnd : now;
  const periodEnd = nextPeriodEnd(start, sub.cycle);
  await controlDb
    .update(billingSubscriptions)
    .set({ status: "active", currentPeriodStart: start, currentPeriodEnd: periodEnd, graceUntil: null, updatedAt: now })
    .where(eq(billingSubscriptions.id, sub.id));

  await recordPayment({
    tenantId: sub.tenantId,
    subscriptionId: sub.id,
    status: "captured",
    description: describeSubscription(sub, await itemNameFor(sub)) + " renewal",
    basePaise: sub.basePaise,
    provider: sub.provider as BillingProvider,
    method: opts.method,
    providerPaymentId: opts.providerPaymentId,
    providerInvoiceId: opts.providerInvoiceId,
    periodStart: start,
    periodEnd,
  });
}

/**
 * A renewal charge failed: past_due with a grace deadline (set once — the
 * gateway's own retries keep failing without pushing the deadline out).
 */
export async function recordRenewalFailure(sub: SubscriptionRow, reason: string | null): Promise<void> {
  const now = new Date();
  const graceUntil = sub.graceUntil ?? new Date(now.getTime() + BILLING_GRACE_DAYS * 24 * 60 * 60 * 1000);
  await controlDb
    .update(billingSubscriptions)
    .set({ status: "past_due", graceUntil, updatedAt: now })
    .where(and(eq(billingSubscriptions.id, sub.id), inArray(billingSubscriptions.status, ["active", "past_due"])));

  await recordPayment({
    tenantId: sub.tenantId,
    subscriptionId: sub.id,
    status: "failed",
    description: describeSubscription(sub, await itemNameFor(sub)) + " renewal",
    basePaise: sub.basePaise,
    provider: sub.provider as BillingProvider,
    failureReason: reason,
  });
}

/** Grace ran out or the gateway halted the subscription: the account goes read-only (enforced by P4). */
export async function haltSubscription(subscriptionId: string): Promise<void> {
  await controlDb
    .update(billingSubscriptions)
    .set({ status: "halted", updatedAt: new Date() })
    .where(and(eq(billingSubscriptions.id, subscriptionId), inArray(billingSubscriptions.status, ["active", "past_due"])));
}

/** The subscription ended at the gateway (period ran out after a cancel, or admin action). */
export async function endSubscription(subscriptionId: string): Promise<void> {
  await controlDb
    .update(billingSubscriptions)
    .set({ status: "cancelled", endedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(billingSubscriptions.id, subscriptionId), sql`${billingSubscriptions.status} <> 'cancelled'`));
}

// ── Owner actions ──────────────────────────────────────────────────────────

/** Cancel at the period end: what was paid for keeps running until it runs out. */
export async function cancelAtPeriodEnd(opts: { tenantId: string; subscriptionId: string }): Promise<void> {
  const [sub] = await controlDb
    .select()
    .from(billingSubscriptions)
    .where(and(eq(billingSubscriptions.id, opts.subscriptionId), eq(billingSubscriptions.tenantId, opts.tenantId)))
    .limit(1);
  if (!sub || !subscriptionIsLive(sub.status as SubscriptionStatus)) {
    throw new TRPCError({ code: "NOT_FOUND", message: "No active subscription to cancel." });
  }
  if (sub.cancelAtPeriodEnd) return;

  if (sub.providerSubscriptionId) {
    await getGateway().cancelSubscription(sub.providerSubscriptionId, true);
  }
  await controlDb
    .update(billingSubscriptions)
    .set({ cancelAtPeriodEnd: true, scheduledPlan: null, scheduledCycle: null, updatedAt: new Date() })
    .where(eq(billingSubscriptions.id, sub.id));

  await recordBillingEvent({
    provider: "local",
    type: "subscription.cancel_scheduled",
    tenantId: sub.tenantId,
    subscriptionId: sub.id,
    payload: { runsOutAt: sub.currentPeriodEnd?.toISOString() ?? null },
  });
}

/**
 * Change the plan subscription to another paid plan.
 *
 * Upgrade (dearer per month): takes effect now. The old gateway subscription
 * is cancelled, the unused time becomes a credit note, and the new
 * subscription's first charge is reduced by that credit (fully automatic in
 * demo mode; with Razorpay the credit note stands for a manual refund, since
 * Razorpay cannot charge a reduced first cycle on a new subscription).
 *
 * Downgrade (cheaper): scheduled for the period end — the old subscription is
 * cancelled at cycle end and the switch is applied lazily when the period is
 * over (applyScheduledChanges), so nothing has to run at midnight.
 */
export interface ChangePlanResult {
  applied: "now" | "at_period_end";
  /** Set when the new subscription still needs the Razorpay checkout to be completed. */
  checkout?: { subscriptionId: string; providerSubscriptionId: string; totalPaise: number };
}

export async function changePlan(opts: { tenantId: string; plan: string; cycle: BillingCycle }): Promise<ChangePlanResult> {
  const [current] = await controlDb
    .select()
    .from(billingSubscriptions)
    .where(and(
      eq(billingSubscriptions.tenantId, opts.tenantId),
      eq(billingSubscriptions.kind, "plan"),
      inArray(billingSubscriptions.status, ["active", "past_due"]),
    ))
    .limit(1);
  if (!current) {
    throw new TRPCError({ code: "NOT_FOUND", message: "No plan subscription to change. Buy a plan first." });
  }
  if (current.plan === opts.plan && current.cycle === opts.cycle) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "You are already on this plan." });
  }

  const target = (await getPlanCatalog()).find((p) => p.id === opts.plan);
  if (!target || !target.visible || target.monthlyPriceInr === null || target.monthlyPriceInr <= 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "This plan cannot be bought online." });
  }

  const currentMonthly = current.basePaise / (current.cycle === "yearly" ? YEARLY_CYCLE_MONTHS : 1);
  const targetMonthly = cycleAmount(target.monthlyPriceInr, "monthly").basePaise;
  const isUpgrade = targetMonthly > currentMonthly;

  if (!isUpgrade) {
    // Downgrade at period end.
    if (current.providerSubscriptionId) {
      await getGateway().cancelSubscription(current.providerSubscriptionId, true);
    }
    await controlDb
      .update(billingSubscriptions)
      .set({ scheduledPlan: opts.plan, scheduledCycle: opts.cycle, cancelAtPeriodEnd: false, updatedAt: new Date() })
      .where(eq(billingSubscriptions.id, current.id));
    await recordBillingEvent({
      provider: "local",
      type: "subscription.downgrade_scheduled",
      tenantId: opts.tenantId,
      subscriptionId: current.id,
      payload: { toPlan: opts.plan, toCycle: opts.cycle, at: current.currentPeriodEnd?.toISOString() ?? null },
    });
    return { applied: "at_period_end" };
  }

  // Upgrade now: credit the unused time, end the old subscription…
  const credit =
    current.currentPeriodStart && current.currentPeriodEnd
      ? prorationCreditPaise({
          basePaise: current.basePaise,
          periodStart: current.currentPeriodStart,
          periodEnd: current.currentPeriodEnd,
        })
      : 0;

  if (current.providerSubscriptionId) {
    await getGateway().cancelSubscription(current.providerSubscriptionId, false);
  }
  await controlDb
    .update(billingSubscriptions)
    .set({ status: "cancelled", endedAt: new Date(), updatedAt: new Date() })
    .where(eq(billingSubscriptions.id, current.id));

  if (credit > 0) {
    await recordPayment({
      tenantId: opts.tenantId,
      subscriptionId: current.id,
      status: "credit",
      description: `Credit note: unused ${await itemNameFor(current)} plan time`,
      basePaise: -credit,
      provider: current.provider as BillingProvider,
    });
  }

  // …and start the new one. Demo mode activates right away with the credit
  // applied; Razorpay returns a checkout the owner completes (the credit note
  // already stands on the account).
  const checkout = await startCheckout({ tenantId: opts.tenantId, kind: "plan", plan: opts.plan, cycle: opts.cycle });
  if (checkout.provider === "demo") {
    await activateSubscription({ subscriptionId: checkout.subscription.id, method: "upgrade", creditPaise: credit });
  }

  await recordBillingEvent({
    provider: "local",
    type: "subscription.upgraded",
    tenantId: opts.tenantId,
    subscriptionId: checkout.subscription.id,
    payload: { fromPlan: current.plan, toPlan: opts.plan, creditPaise: credit },
  });
  return {
    applied: "now",
    ...(checkout.provider === "razorpay"
      ? { checkout: { subscriptionId: checkout.subscription.id, providerSubscriptionId: checkout.providerSubscriptionId, totalPaise: checkout.totalPaise } }
      : {}),
  };
}

// ── Billing state (read side) ──────────────────────────────────────────────

export interface BillingState {
  planSubscription: SubscriptionRow | null;
  addonSubscriptions: SubscriptionRow[];
  /** True once a plan subscription is halted (grace over) — P4 enforces it. */
  readOnly: boolean;
  graceUntil: Date | null;
}

/**
 * The live billing picture for one organisation, applying overdue lazy
 * transitions first: past_due past its grace flips to halted, and a period
 * that ran out applies its scheduled downgrade / cancel.
 */
export async function getBillingState(tenantId: string): Promise<BillingState> {
  await applyLazyTransitions(tenantId);

  const subs = await controlDb
    .select()
    .from(billingSubscriptions)
    .where(and(eq(billingSubscriptions.tenantId, tenantId), inArray(billingSubscriptions.status, LIVE_STATUSES)))
    .orderBy(desc(billingSubscriptions.createdAt));

  const planSub = subs.find((s) => s.kind === "plan" && s.status !== "created") ?? null;
  const addonSubs = subs.filter((s) => s.kind === "addon" && s.status !== "created");
  return {
    planSubscription: planSub,
    addonSubscriptions: addonSubs,
    readOnly: planSub?.status === "halted",
    graceUntil: planSub?.graceUntil ?? null,
  };
}

/** Overdue state changes applied on read, so no scheduler is needed. */
async function applyLazyTransitions(tenantId: string): Promise<void> {
  const now = new Date();
  const subs = await controlDb
    .select()
    .from(billingSubscriptions)
    .where(and(eq(billingSubscriptions.tenantId, tenantId), inArray(billingSubscriptions.status, ["active", "past_due"])));

  for (const sub of subs) {
    try {
      // Grace over without a successful retry → halted (read-only).
      if (sub.status === "past_due" && sub.graceUntil && sub.graceUntil < now) {
        await haltSubscription(sub.id);
        await recordBillingEvent({ provider: "local", type: "subscription.halted", tenantId, subscriptionId: sub.id, payload: { reason: "grace period over" } });
        continue;
      }
      if (!sub.currentPeriodEnd || sub.currentPeriodEnd > now) continue;

      // The paid-for period is over…
      if (sub.cancelAtPeriodEnd) {
        await endSubscription(sub.id);
        await recordBillingEvent({ provider: "local", type: "subscription.ended", tenantId, subscriptionId: sub.id, payload: { reason: "cancelled at period end" } });
      } else if (sub.scheduledPlan && sub.scheduledCycle) {
        // …and a downgrade was waiting for it.
        await endSubscription(sub.id);
        const checkout = await startCheckout({ tenantId, kind: "plan", plan: sub.scheduledPlan, cycle: sub.scheduledCycle });
        if (checkout.provider === "demo") {
          await activateSubscription({ subscriptionId: checkout.subscription.id, method: "downgrade" });
        }
        await recordBillingEvent({
          provider: "local",
          type: "subscription.downgraded",
          tenantId,
          subscriptionId: checkout.subscription.id,
          payload: { fromPlan: sub.plan, toPlan: sub.scheduledPlan },
        });
      }
      // Otherwise the gateway's renewal charge is on its way (webhook will
      // extend the period); demo subscriptions renew here.
      else if (sub.provider === "demo") {
        await recordRenewal(sub, { method: "auto-renew" });
      }
    } catch (err) {
      logger.error({ err, subscriptionId: sub.id }, "[billing] lazy transition failed");
    }
  }
}
