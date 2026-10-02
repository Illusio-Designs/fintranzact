/**
 * Plan limits configuration.
 *
 * Free tier is generous enough to get hooked (unlimited invoices, parties, payments)
 * but gates features that matter at scale (team size, multi-business, integrations).
 *
 * Self-hosted defaults to "free" plan — same limits apply including PDF branding.
 */

import { eq, and, gt, isNull, count } from "drizzle-orm";
import { controlDb, tenants, tenantMembers, invitations } from "@fintranzact/db";
import type { TenantDatabase } from "../trpc.js";
import { businesses } from "@fintranzact/db";
import { PLAN_LIMITS, type PlanLimits } from "@fintranzact/shared";
import { getPlanLimits } from "./plan-catalog.js";
import { getEntitlements } from "./entitlements.js";
import { limitError } from "./entitlement-error.js";

// ── Plan limit definitions ────────────────────────────────────────────────────
// Defined once in @fintranzact/shared so the pricing page shows exactly the
// limits enforced here.

export type { PlanLimits };

// ── Helpers ───────────────────────────────────────────────────────────────────

/** The limits enforced for a plan, including any edits a platform admin made. */
export function getLimits(plan: string): Promise<PlanLimits> {
  return getPlanLimits(plan);
}

/** Backwards-compat export used by recurring invoice scheduler. */
export const RECURRING_RUNS_PER_MONTH_FREE = PLAN_LIMITS.free.recurringRunsPerMonth;

// ── Enforcement helpers ───────────────────────────────────────────────────────

/** The limits in force for an organisation: one source, shared with the read-only/add-on checks. */
async function getTenantLimits(tenantId: string): Promise<PlanLimits> {
  return (await getEntitlements(tenantId)).limits;
}

/**
 * Recurring-invoice runs a tenant may make per month, per business. Hosted
 * (multi-tenant) deployments use the organization's plan; a self-hosted
 * single-tenant install keeps the original free-plan allowance.
 */
export async function recurringRunLimit(tenantId: string | null): Promise<number> {
  if (!tenantId || process.env.MULTI_TENANT !== "true") return RECURRING_RUNS_PER_MONTH_FREE;
  return (await getTenantLimits(tenantId)).recurringRunsPerMonth;
}

/**
 * A user's effective plan is the best plan across the orgs they own, or null
 * when they own none. It starts from the plans actually owned (not an assumed
 * default), so owning only legacy "free" orgs keeps the free limits.
 * forever_free outranks free because it is the unlimited successor plan.
 */
export function effectiveOwnerPlan(ownedOrgs: Array<{ plan: string | null }>): string | null {
  const planRank: Record<string, number> = { free: 0, forever_free: 1, pro: 2, business: 3, enterprise: 4 };
  let bestPlan: string | null = null;
  for (const org of ownedOrgs) {
    const plan = org.plan ?? "free";
    if (bestPlan === null || (planRank[plan] ?? 0) > (planRank[bestPlan] ?? 0)) {
      bestPlan = plan;
    }
  }
  return bestPlan;
}

/**
 * Enforce org creation limit.
 * Counts orgs the user owns and checks against the highest plan they have.
 * A user's effective plan is the best plan across all orgs they own.
 */
export async function enforceOrgCreationLimit(userId: string): Promise<void> {
  // Count orgs this user owns
  const ownedOrgs = await controlDb.select({ tenantId: tenantMembers.tenantId, plan: tenants.plan })
    .from(tenantMembers)
    .innerJoin(tenants, eq(tenants.id, tenantMembers.tenantId))
    .where(and(
      eq(tenantMembers.userId, userId),
      eq(tenantMembers.role, "owner"),
    ));

  const bestPlan = effectiveOwnerPlan(ownedOrgs);
  // Owning no org yet: nothing to limit.
  if (bestPlan === null) return;

  const limits = await getLimits(bestPlan);
  if (limits.maxOwnedOrgs === Infinity) return;

  if (ownedOrgs.length >= limits.maxOwnedOrgs) {
    throw limitError(
      `Your plan allows up to ${limits.maxOwnedOrgs} organization${limits.maxOwnedOrgs === 1 ? "" : "s"}. Upgrade to create more.`,
    );
  }
}

/**
 * Enforce business creation limit.
 * Counts existing businesses in the tenant DB and compares against the plan limit.
 */
export async function enforceBusinessLimit(tenantId: string, tenantDb: TenantDatabase): Promise<void> {
  const limits = await getTenantLimits(tenantId);
  if (limits.maxBusinesses === Infinity) return;

  const [{ count: bizCount }] = await tenantDb
    .select({ count: count() })
    .from(businesses);

  if (bizCount >= limits.maxBusinesses) {
    throw limitError(
      `Your plan allows up to ${limits.maxBusinesses} business${limits.maxBusinesses === 1 ? "" : "es"}. Upgrade to add more.`,
    );
  }
}

/**
 * Enforce team member limit.
 * Counts current members + pending invitations against the plan limit.
 */
export async function enforceTeamMemberLimit(tenantId: string): Promise<void> {
  const limits = await getTenantLimits(tenantId);
  if (limits.maxTeamMembers === Infinity) return;

  const [[members], [pending]] = await Promise.all([
    controlDb.select({ count: count() }).from(tenantMembers)
      .where(eq(tenantMembers.tenantId, tenantId)),
    controlDb.select({ count: count() }).from(invitations)
      .where(and(
        eq(invitations.tenantId, tenantId),
        gt(invitations.expiresAt, new Date()),
        isNull(invitations.acceptedAt),
      )),
  ]);

  const total = (members?.count ?? 0) + (pending?.count ?? 0);
  if (total >= limits.maxTeamMembers) {
    throw limitError(
      `Your plan allows up to ${limits.maxTeamMembers} team members (including pending invites). Upgrade to invite more.`,
    );
  }
}

/**
 * Enforce API key limit.
 * Called from apiKey.create — counts existing keys for the user+tenant.
 */
export async function enforceApiKeyLimit(tenantId: string): Promise<void> {
  const limits = await getTenantLimits(tenantId);
  if (limits.maxApiKeys === 0) {
    throw limitError(
      "API keys are available on paid plans. Upgrade to Pro to use the CLI and MCP server.",
    );
  }
  if (limits.maxApiKeys === Infinity) return;

  const { apiKeys } = await import("@fintranzact/db");
  const [{ count: keyCount }] = await controlDb
    .select({ count: count() })
    .from(apiKeys)
    .where(eq(apiKeys.tenantId, tenantId));

  if (keyCount >= limits.maxApiKeys) {
    throw limitError(
      `Your plan allows up to ${limits.maxApiKeys} API key${limits.maxApiKeys === 1 ? "" : "s"}. Upgrade to create more.`,
    );
  }
}

/**
 * Enforce concurrent session limit.
 * Called when creating a new session. If at the limit, the oldest session
 * is automatically revoked (FIFO) rather than blocking login.
 *
 * Accepts an optional `parentTx` so the eviction DELETE participates in the
 * surrounding sign-in transaction. Without this, a rollback of the parent tx
 * would leave the user with FEWER sessions than they started with (the old
 * session was evicted via the non-transactional controlDb, the new session
 * insert inside the tx was rolled back).
 */
type ControlTxLike = Parameters<Parameters<typeof controlDb.transaction>[0]>[0];

export async function enforceSessionLimit(userId: string, parentTx?: ControlTxLike): Promise<void> {
  const { sessions } = await import("@fintranzact/db");
  const { asc } = await import("drizzle-orm");
  const db = parentTx ?? controlDb;

  // Get the user's tenant to determine plan
  const [membership] = await db
    .select({ tenantId: tenantMembers.tenantId })
    .from(tenantMembers)
    .where(eq(tenantMembers.userId, userId))
    .limit(1);

  const limits = membership ? await getTenantLimits(membership.tenantId) : await getLimits("free");
  if (limits.maxConcurrentSessions === Infinity) return;

  const activeSessions = await db
    .select({ id: sessions.id, createdAt: sessions.createdAt })
    .from(sessions)
    .where(and(
      eq(sessions.userId, userId),
      gt(sessions.expiresAt, new Date()),
    ))
    .orderBy(asc(sessions.createdAt));

  // If at/over limit, evict the oldest session(s) to make room for the new one
  const toEvict = activeSessions.length - limits.maxConcurrentSessions + 1;
  if (toEvict > 0) {
    const evictIds = activeSessions.slice(0, toEvict).map((s) => s.id);
    const { inArray } = await import("drizzle-orm");
    await db.delete(sessions).where(inArray(sessions.id, evictIds));
  }
}

/**
 * Enforce data export access.
 */
export async function enforceDataExport(tenantId: string): Promise<void> {
  const limits = await getTenantLimits(tenantId);
  if (!limits.dataExport) {
    throw limitError(
      "Data export is available on paid plans. Upgrade to export your data.",
    );
  }
}
