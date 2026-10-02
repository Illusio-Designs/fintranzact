/**
 * Server-side entitlements: the one check that plan, add-ons, trial and
 * read-only state all go through. It loads what the control database knows
 * about an organisation and hands it to the shared pure deriveAccess, so web,
 * mobile and the API agree.
 *
 * What is cached (30s per organisation) is the loaded data, not the verdict:
 * the clock is applied on every call, so a trial or grace period ends on time
 * even inside the cache window. Every billing, plan, trial and status change
 * calls invalidateEntitlements so the change shows at once on this server.
 *
 * Overdue billing transitions (grace over → halted, cancel at period end,
 * scheduled downgrade, demo renewal) are applied here, once per load and only
 * when one is actually due — an organisation goes read-only on time even if
 * its owner never opens the Billing tab.
 */

import { and, eq, ne } from "drizzle-orm";
import { billingSubscriptions, controlDb, tenants } from "@fintranzact/db";
import {
  deriveAccess,
  isReadOnlyReason,
  type Access,
  type AccessAddon,
  type AccessPlanSubscription,
  type AddonId,
  type PlanLimits,
  type SubscriptionStatus,
} from "@fintranzact/shared";
import { getPlanLimits } from "./plan-catalog.js";
import { applyLazyTransitions } from "./billing/service.js";
import { cacheGet, cacheSet } from "./entitlements-cache.js";
import { entitlementError } from "./entitlement-error.js";

export { invalidateEntitlements, clearEntitlementsCache } from "./entitlements-cache.js";

export interface Entitlements extends Access {
  plan: string;
  tenantStatus: string;
  limits: PlanLimits;
}

interface Snapshot {
  plan: string;
  tenantStatus: string;
  trialEndsAt: Date | null;
  planSubscription: AccessPlanSubscription | null;
  everHadPlanSubscription: boolean;
  addons: AccessAddon[];
  limits: PlanLimits;
}

type SubRow = {
  kind: string;
  addon: string | null;
  status: SubscriptionStatus;
  graceUntil: Date | null;
  currentPeriodEnd: Date | null;
};

/** True when applyLazyTransitions would change something for these rows. */
function transitionDue(subs: SubRow[], now: Date): boolean {
  return subs.some(
    (s) =>
      (s.status === "active" || s.status === "past_due") &&
      ((s.status === "past_due" && !!s.graceUntil && s.graceUntil < now) ||
        (!!s.currentPeriodEnd && s.currentPeriodEnd <= now)),
  );
}

async function loadSubs(tenantId: string): Promise<SubRow[]> {
  return controlDb
    .select({
      kind: billingSubscriptions.kind,
      addon: billingSubscriptions.addon,
      status: billingSubscriptions.status,
      graceUntil: billingSubscriptions.graceUntil,
      currentPeriodEnd: billingSubscriptions.currentPeriodEnd,
    })
    .from(billingSubscriptions)
    .where(and(eq(billingSubscriptions.tenantId, tenantId), ne(billingSubscriptions.status, "created")));
}

async function loadSnapshot(tenantId: string): Promise<Snapshot> {
  const [tenant] = await controlDb
    .select({ plan: tenants.plan, status: tenants.status, trialEndsAt: tenants.trialEndsAt })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  let subs = await loadSubs(tenantId);
  if (transitionDue(subs, new Date())) {
    await applyLazyTransitions(tenantId);
    subs = await loadSubs(tenantId);
  }

  const planRows = subs.filter((s) => s.kind === "plan");
  const planSub = planRows.find((s) => s.status === "active" || s.status === "past_due" || s.status === "halted") ?? null;

  // A tenant that no longer exists behaves like the legacy default so callers
  // that only read limits keep working.
  const plan = tenant?.plan ?? "free";
  return {
    plan,
    tenantStatus: tenant?.status ?? "active",
    trialEndsAt: tenant?.trialEndsAt ?? null,
    planSubscription: planSub ? { status: planSub.status, graceUntil: planSub.graceUntil, currentPeriodEnd: planSub.currentPeriodEnd } : null,
    everHadPlanSubscription: planRows.length > 0,
    addons: subs
      .filter((s) => s.kind === "addon" && s.addon && (s.status === "active" || s.status === "past_due"))
      .map((s) => ({ addon: s.addon!, status: s.status, graceUntil: s.graceUntil })),
    limits: await getPlanLimits(plan),
  };
}

/** What the organisation may do right now: access state, add-ons and plan limits. */
export async function getEntitlements(tenantId: string, now: Date = new Date()): Promise<Entitlements> {
  let snap = cacheGet<Snapshot>(tenantId);
  if (!snap) {
    snap = await loadSnapshot(tenantId);
    cacheSet(tenantId, snap);
  }
  const access = deriveAccess({
    plan: snap.plan,
    tenantStatus: snap.tenantStatus,
    trialEndsAt: snap.trialEndsAt,
    planSubscription: snap.planSubscription,
    everHadPlanSubscription: snap.everHadPlanSubscription,
    addons: snap.addons,
    now,
  });
  return { ...access, plan: snap.plan, tenantStatus: snap.tenantStatus, limits: snap.limits };
}

/**
 * Refuse a create/edit when the organisation is read-only (trial over, payment
 * failed, plan ended) or suspended. FORBIDDEN with `data.entitlement.reason`.
 */
export async function assertWritable(tenantId: string): Promise<Entitlements> {
  const ent = await getEntitlements(tenantId);
  if (ent.readOnly && ent.reason) throw entitlementError(ent.reason);
  return ent;
}

/**
 * Refuse unless the add-on is enabled. A read-only organisation gets the
 * read-only message instead (its add-ons are all off, and "buy the add-on"
 * would be the wrong advice).
 */
export async function requireAddon(tenantId: string, addon: AddonId): Promise<Entitlements> {
  const ent = await getEntitlements(tenantId);
  if (ent.reason && (isReadOnlyReason(ent.reason) || ent.reason === "tenant_suspended")) throw entitlementError(ent.reason);
  if (!ent.addons[addon]) throw entitlementError("addon_required", { addon });
  return ent;
}

export { limitError } from "./entitlement-error.js";
