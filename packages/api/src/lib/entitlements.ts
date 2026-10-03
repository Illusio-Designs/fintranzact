/**
 * Server-side entitlements: the one check that plan, add-ons, trial and
 * read-only state all go through. It loads what the control database knows
 * about an organisation and hands it to the shared pure deriveAccess, so web,
 * mobile and the API agree.
 *
 * What is cached (30s per organisation) is the subscription data, not the
 * verdict: the clock is applied on every call, so a trial or grace period ends
 * on time even inside the cache window. The organisation row (plan, status,
 * trial end) is read fresh on every call. Every billing change calls
 * invalidateEntitlements so the subscription data shows at once on this server.
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
  type PlanFeatures,
  type PlanLimits,
  type SubscriptionStatus,
} from "@fintranzact/shared";
import { getPlanLimits } from "./plan-catalog.js";
import { resolveFeatures } from "./plan-features.js";
import { applyLazyTransitions } from "./billing/service.js";
import { cacheGet, cacheSet } from "./entitlements-cache.js";
import { entitlementError } from "./entitlement-error.js";

export { invalidateEntitlements, clearEntitlementsCache } from "./entitlements-cache.js";

export interface Entitlements extends Access {
  plan: string;
  /** Permanent full access (a former Forever Free organisation): never trial-expired or read-only. */
  accessGrandfathered: boolean;
  tenantStatus: string;
  limits: PlanLimits;
  /**
   * The feature flags in force right now: the plan's stored flags, all on for a
   * grandfathered organisation, and Business-level during an active trial
   * (lib/plan-features.ts). Feature gates read this, never the plan name.
   */
  features: PlanFeatures;
}

/** What is cached: the subscription-derived data. The tenant row (plan, status, trial) is read fresh. */
interface Snapshot {
  planSubscription: AccessPlanSubscription | null;
  everHadPlanSubscription: boolean;
  addons: AccessAddon[];
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
  let subs = await loadSubs(tenantId);
  if (transitionDue(subs, new Date())) {
    await applyLazyTransitions(tenantId);
    subs = await loadSubs(tenantId);
  }

  const planRows = subs.filter((s) => s.kind === "plan");
  const planSub = planRows.find((s) => s.status === "active" || s.status === "past_due" || s.status === "halted") ?? null;

  return {
    planSubscription: planSub ? { status: planSub.status, graceUntil: planSub.graceUntil, currentPeriodEnd: planSub.currentPeriodEnd } : null,
    everHadPlanSubscription: planRows.length > 0,
    addons: subs
      .filter((s) => s.kind === "addon" && s.addon && (s.status === "active" || s.status === "past_due"))
      .map((s) => ({ addon: s.addon!, status: s.status, graceUntil: s.graceUntil })),
  };
}

/**
 * The organisation row is read on every call (one primary-key lookup), never
 * cached: a plan or status change made by anything that does not know about the
 * cache (another process, a direct database edit, a request already in flight
 * when the change landed) must show at once. A tenant that no longer exists
 * behaves like the legacy default so callers that only read limits keep working.
 */
async function loadTenant(
  tenantId: string,
): Promise<{ plan: string; tenantStatus: string; trialEndsAt: Date | null; accessGrandfathered: boolean }> {
  const [tenant] = await controlDb
    .select({
      plan: tenants.plan,
      status: tenants.status,
      trialEndsAt: tenants.trialEndsAt,
      accessGrandfathered: tenants.accessGrandfathered,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  return {
    plan: tenant?.plan ?? "starter",
    tenantStatus: tenant?.status ?? "active",
    trialEndsAt: tenant?.trialEndsAt ?? null,
    accessGrandfathered: tenant?.accessGrandfathered ?? false,
  };
}

/** What the organisation may do right now: access state, add-ons and plan limits. */
export async function getEntitlements(tenantId: string, now: Date = new Date()): Promise<Entitlements> {
  let snap = cacheGet<Snapshot>(tenantId);
  if (!snap) {
    snap = await loadSnapshot(tenantId);
    cacheSet(tenantId, snap);
  }
  const tenant = await loadTenant(tenantId);
  const access = deriveAccess({
    plan: tenant.plan,
    tenantStatus: tenant.tenantStatus,
    trialEndsAt: tenant.trialEndsAt,
    accessGrandfathered: tenant.accessGrandfathered,
    planSubscription: snap.planSubscription,
    everHadPlanSubscription: snap.everHadPlanSubscription,
    addons: snap.addons,
    now,
  });
  const planLimits = await getPlanLimits(tenant.plan);
  const features = await resolveFeatures(access.state, planLimits);
  // The feature flags inside `limits` follow the same rules (trial = Business-level, grandfathered = all), so
  // every existing read of limits.dataExport / limits.onlineStore sees them. Counts stay the plan's own.
  const limits: PlanLimits = { ...planLimits, ...features };
  return {
    ...access,
    plan: tenant.plan,
    accessGrandfathered: tenant.accessGrandfathered,
    tenantStatus: tenant.tenantStatus,
    limits,
    features,
  };
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
