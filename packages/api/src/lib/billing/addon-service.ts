/**
 * Add-on subscription changes that are not a first purchase (service.ts):
 *
 *  - changeAddon: move between the tiers of one add-on (AI Assistant <-> AI Plus), or change the
 *    billing cycle of the one held. An upgrade (dearer per month) applies now: the new
 *    subscription is bought and, once it activates, the old one is retired with a credit note for
 *    its unused time (service.ts retireReplacedAddon). A downgrade, or a cycle change, is
 *    scheduled for the period end and applied lazily (applyLazyTransitions), like a plan downgrade.
 *    Either way the organisation is never billed for both tiers.
 *  - grantAddonByAdmin / revokeAddonGrant: a platform admin gives an add-on free (a subscription row
 *    with provider "admin", price 0 and no period end) and takes it back.
 */

import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { controlDb, billingSubscriptions, tenants } from "@fintranzact/db";
import { ADDONS, YEARLY_CYCLE_MONTHS, addonById, addonCycleAmount, type AddonId, type BillingCycle } from "@fintranzact/shared";
import { invalidateEntitlements } from "../entitlements-cache.js";
import { getAddonPrices } from "./addon-prices.js";
import { getGateway } from "./gateway.js";
import { activateSubscription, endSubscription, recordBillingEvent, startCheckout } from "./service.js";

export interface ChangeAddonResult {
  applied: "now" | "at_period_end";
  /** Set when the new subscription still needs the Razorpay checkout to be completed. */
  checkout?: { subscriptionId: string; providerSubscriptionId: string; totalPaise: number };
}

export async function changeAddon(opts: { tenantId: string; addon: AddonId; cycle: BillingCycle }): Promise<ChangeAddonResult> {
  const target = addonById(opts.addon);
  if (!target) throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown add-on." });
  const group = ADDONS.filter((a) => a.group === target.group).map((a) => a.id);

  const live = await controlDb
    .select()
    .from(billingSubscriptions)
    .where(and(
      eq(billingSubscriptions.tenantId, opts.tenantId),
      eq(billingSubscriptions.kind, "addon"),
      inArray(billingSubscriptions.addon, group),
      inArray(billingSubscriptions.status, ["active", "past_due"]),
    ));
  const current = live[0];
  if (!current) {
    throw new TRPCError({ code: "NOT_FOUND", message: "No add-on to change. Subscribe to it instead." });
  }
  if (current.provider === "admin") {
    throw new TRPCError({ code: "CONFLICT", message: "This add-on was granted by Fintranzact. Ask us to change it." });
  }
  if (current.addon === opts.addon && current.cycle === opts.cycle) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "You already have this add-on on this billing cycle." });
  }
  if (current.cancelAtPeriodEnd) {
    throw new TRPCError({ code: "CONFLICT", message: "This add-on is set to end. Wait until it ends, then subscribe again." });
  }

  const overrides = await getAddonPrices();
  const currentMonthly = current.basePaise / (current.cycle === "yearly" ? YEARLY_CYCLE_MONTHS : 1);
  const targetMonthly = addonCycleAmount(opts.addon, "monthly", overrides).basePaise;
  // Another tier that costs more per month applies now; the same add-on on another cycle, or a cheaper
  // tier, waits for the end of what was paid for.
  const isUpgrade = current.addon !== opts.addon && targetMonthly > currentMonthly;

  if (!isUpgrade) {
    if (current.providerSubscriptionId) await getGateway().cancelSubscription(current.providerSubscriptionId, true);
    await controlDb
      .update(billingSubscriptions)
      .set({ scheduledAddon: opts.addon, scheduledCycle: opts.cycle, scheduledPlan: null, cancelAtPeriodEnd: false, updatedAt: new Date() })
      .where(eq(billingSubscriptions.id, current.id));
    await recordBillingEvent({
      provider: "local",
      type: "subscription.addon_downgrade_scheduled",
      tenantId: opts.tenantId,
      subscriptionId: current.id,
      payload: { from: current.addon, to: opts.addon, toCycle: opts.cycle, at: current.currentPeriodEnd?.toISOString() ?? null },
    });
    invalidateEntitlements(opts.tenantId);
    return { applied: "at_period_end" };
  }

  const checkout = await startCheckout({
    tenantId: opts.tenantId,
    kind: "addon",
    addon: opts.addon,
    cycle: opts.cycle,
    replacesSubscriptionId: current.id,
  });
  if (checkout.provider === "demo") {
    // Retires the old tier and issues the new invoice and the credit note.
    await activateSubscription({ subscriptionId: checkout.subscription.id, method: "upgrade" });
  }
  await recordBillingEvent({
    provider: "local",
    type: "subscription.addon_upgrade_started",
    tenantId: opts.tenantId,
    subscriptionId: checkout.subscription.id,
    payload: { from: current.addon, to: opts.addon, replacedSubscriptionId: current.id },
  });
  invalidateEntitlements(opts.tenantId);
  return {
    applied: "now",
    ...(checkout.provider === "razorpay"
      ? { checkout: { subscriptionId: checkout.subscription.id, providerSubscriptionId: checkout.providerSubscriptionId, totalPaise: checkout.totalPaise } }
      : {}),
  };
}

// ── Admin grants ───────────────────────────────────────────────────────────

/** Give an add-on free. It runs until the admin revokes it (no period end), and is never billed. */
export async function grantAddonByAdmin(opts: { tenantId: string; addon: AddonId; actorUserId: string; reason: string }): Promise<{ id: string }> {
  const addon = addonById(opts.addon);
  if (!addon) throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown add-on." });
  const [tenant] = await controlDb.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, opts.tenantId)).limit(1);
  if (!tenant) throw new TRPCError({ code: "NOT_FOUND", message: "Organisation not found" });

  const group = ADDONS.filter((a) => a.group === addon.group).map((a) => a.id);
  const rows = await controlDb
    .select({ id: billingSubscriptions.id, addon: billingSubscriptions.addon, status: billingSubscriptions.status, provider: billingSubscriptions.provider })
    .from(billingSubscriptions)
    .where(and(
      eq(billingSubscriptions.tenantId, opts.tenantId),
      eq(billingSubscriptions.kind, "addon"),
      inArray(billingSubscriptions.addon, group),
      inArray(billingSubscriptions.status, ["created", "active", "past_due", "halted"]),
    ));
  const blocking = rows.find((r) => r.status === "active" || r.status === "past_due");
  if (blocking) {
    throw new TRPCError({
      code: "CONFLICT",
      message: blocking.addon === opts.addon
        ? "The organisation already has this add-on."
        : "The organisation already has another tier of this add-on. Revoke or cancel it first, so it is never billed for both.",
    });
  }
  // A half-finished checkout or a halted (unpaid) one gives way to the grant.
  const now = new Date();
  for (const r of rows) {
    await controlDb.update(billingSubscriptions).set({ status: "cancelled", endedAt: now, updatedAt: now }).where(eq(billingSubscriptions.id, r.id));
  }
  const [row] = await controlDb
    .insert(billingSubscriptions)
    .values({
      tenantId: opts.tenantId,
      kind: "addon",
      addon: opts.addon,
      cycle: "monthly",
      status: "active",
      provider: "admin",
      basePaise: 0,
      currentPeriodStart: now,
      currentPeriodEnd: null,
    })
    .returning({ id: billingSubscriptions.id });
  await recordBillingEvent({
    provider: "local",
    type: "platform.addon_granted",
    tenantId: opts.tenantId,
    subscriptionId: row!.id,
    payload: { addon: opts.addon, reason: opts.reason, actorUserId: opts.actorUserId },
  });
  invalidateEntitlements(opts.tenantId);
  return { id: row!.id };
}

/** Take back an admin grant. A paid subscription is never touched here (the owner cancels that). */
export async function revokeAddonGrant(opts: { tenantId: string; addon: AddonId; actorUserId: string }): Promise<void> {
  const [row] = await controlDb
    .select({ id: billingSubscriptions.id })
    .from(billingSubscriptions)
    .where(and(
      eq(billingSubscriptions.tenantId, opts.tenantId),
      eq(billingSubscriptions.kind, "addon"),
      eq(billingSubscriptions.addon, opts.addon),
      eq(billingSubscriptions.provider, "admin"),
      inArray(billingSubscriptions.status, ["active", "past_due", "halted"]),
    ))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "No admin grant of this add-on to revoke." });
  await endSubscription(row.id);
  await recordBillingEvent({
    provider: "local",
    type: "platform.addon_revoked",
    tenantId: opts.tenantId,
    subscriptionId: row.id,
    payload: { addon: opts.addon, actorUserId: opts.actorUserId },
  });
}
