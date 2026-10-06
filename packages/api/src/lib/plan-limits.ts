/**
 * Plan limits configuration.
 *
 * Three paid plans (Starter, Growth, Business; see @fintranzact/shared plans.ts). Every plan
 * has unlimited invoices, parties and payments; the plans differ in businesses, users, API and more.
 *
 * A self-hosted install uses the same plans and limits.
 */

import { eq, and, gt, gte, isNull, count, sql, inArray, notInArray } from "drizzle-orm";
import { controlDb, tenantMembers, invitations } from "@fintranzact/db";
import type { TenantDatabase } from "../trpc.js";
import { businesses, recurringInvoiceRuns } from "@fintranzact/db";
import { CA_ROLES, type PlanLimits } from "@fintranzact/shared";
import { getPlanLimits } from "./plan-catalog.js";
import { getEntitlements, assertWritable } from "./entitlements.js";
import { limitError } from "./entitlement-error.js";
import { apiAccessMessage, featureRefusal } from "./feature-gate.js";

// ── Plan limit definitions ────────────────────────────────────────────────────
// Defined once in @fintranzact/shared so the pricing page shows exactly the
// limits enforced here.

export type { PlanLimits };

// ── Helpers ───────────────────────────────────────────────────────────────────

/** The limits enforced for a plan, including any edits a platform admin made. */
export function getLimits(plan: string): Promise<PlanLimits> {
  return getPlanLimits(plan);
}

// ── Enforcement helpers ───────────────────────────────────────────────────────

/** The limits in force for an organisation: one source, shared with the read-only/add-on checks. */
async function getTenantLimits(tenantId: string): Promise<PlanLimits> {
  return (await getEntitlements(tenantId)).limits;
}

/**
 * A user's effective plan is the best plan across the orgs they own, or null
 * when they own none. It starts from the plans actually owned (not an assumed
 * default). A grandfathered organisation sits on Business, the top plan.
 */
export function effectiveOwnerPlan(ownedOrgs: Array<{ plan: string | null }>): string | null {
  const planRank: Record<string, number> = { starter: 0, growth: 1, business: 2 };
  let bestPlan: string | null = null;
  for (const org of ownedOrgs) {
    const plan = org.plan ?? "starter";
    if (bestPlan === null || (planRank[plan] ?? 0) > (planRank[bestPlan] ?? 0)) {
      bestPlan = plan;
    }
  }
  return bestPlan;
}

/**
 * The organisations a user owns, each with the plan whose limits apply to it
 * right now (Business while its Full Access Trial runs, otherwise its own
 * plan), so the owned-organisation limit follows the same rules as every other
 * count limit.
 */
export async function ownedOrgEffectivePlans(userId: string): Promise<Array<{ tenantId: string; plan: string }>> {
  const owned = await controlDb.select({ tenantId: tenantMembers.tenantId })
    .from(tenantMembers)
    .where(and(eq(tenantMembers.userId, userId), eq(tenantMembers.role, "owner")));
  return Promise.all(owned.map(async ({ tenantId }) => ({ tenantId, plan: (await getEntitlements(tenantId)).effectivePlan })));
}

/** The owned-organisation cap for a user: from the best effective plan across the organisations they own, or null when they own none. */
export async function ownedOrgLimit(userId: string): Promise<{ owned: number; max: number } | null> {
  const ownedOrgs = await ownedOrgEffectivePlans(userId);
  const bestPlan = effectiveOwnerPlan(ownedOrgs);
  // Owning no org yet: nothing to limit.
  if (bestPlan === null) return null;
  return { owned: ownedOrgs.length, max: (await getLimits(bestPlan)).maxOwnedOrgs };
}

/**
 * Enforce org creation limit.
 * Counts orgs the user owns and checks against the highest effective plan they
 * have (an organisation in its Full Access Trial counts as Business).
 */
export async function enforceOrgCreationLimit(userId: string): Promise<void> {
  const cap = await ownedOrgLimit(userId);
  if (!cap || cap.max === Infinity) return;

  if (cap.owned >= cap.max) {
    throw limitError(
      `Your plan allows up to ${cap.max} organization${cap.max === 1 ? "" : "s"}. Upgrade to create more.`,
    );
  }
}

/**
 * Creating another organisation is a write, and refused while any organisation
 * the user owns is read-only (trial over, payment failed, plan ended) or
 * suspended: otherwise a lapsed owner could start a fresh trial in a new
 * organisation instead of paying. The refusal carries that organisation's
 * entitlement reason. Users who own none, or only organisations in good
 * standing (including grandfathered organisations), are unaffected.
 */
export async function assertOwnedOrgsWritable(userId: string): Promise<void> {
  const owned = await controlDb.select({ tenantId: tenantMembers.tenantId })
    .from(tenantMembers)
    .where(and(eq(tenantMembers.userId, userId), eq(tenantMembers.role, "owner")));
  for (const { tenantId } of owned) {
    await assertWritable(tenantId);
  }
}

/**
 * Businesses an organisation has. A hosted organisation has its own database,
 * so every business in it is its own. A single-database install keeps every
 * organisation's businesses in one table, so only those created by the
 * organisation's members count: otherwise one organisation's businesses would
 * use up another's plan limit.
 */
export async function countOrganisationBusinesses(tenantId: string, tenantDb: TenantDatabase): Promise<number> {
  if (process.env.MULTI_TENANT === "true") {
    const [{ count: n }] = await tenantDb.select({ count: count() }).from(businesses);
    return n;
  }
  const [{ count: n }] = await tenantDb
    .select({ count: count() })
    .from(businesses)
    .where(sql`${businesses.createdByUserId} IN (SELECT ${tenantMembers.userId} FROM ${tenantMembers} WHERE ${tenantMembers.tenantId} = ${tenantId})`);
  return n;
}

/**
 * Enforce business creation limit.
 * Counts existing businesses in the tenant DB and compares against the plan limit.
 */
export async function enforceBusinessLimit(tenantId: string, tenantDb: TenantDatabase): Promise<void> {
  const limits = await getTenantLimits(tenantId);
  if (limits.maxBusinesses === Infinity) return;

  const bizCount = await countOrganisationBusinesses(tenantId, tenantDb);

  if (bizCount >= limits.maxBusinesses) {
    throw limitError(
      `Your plan allows up to ${limits.maxBusinesses} business${limits.maxBusinesses === 1 ? "" : "es"}. Upgrade to add more.`,
    );
  }
}

/**
 * Enforce team member limit.
 * Counts current members + pending invitations against the plan limit.
 * Accountant (CA) roles are outside the limit (see countsTowardTeamLimit in
 * invite-rules.ts); they have their own per-organisation cap.
 */
export async function enforceTeamMemberLimit(tenantId: string): Promise<void> {
  const limits = await getTenantLimits(tenantId);
  if (limits.maxTeamMembers === Infinity) return;

  const [[members], [pending]] = await Promise.all([
    controlDb.select({ count: count() }).from(tenantMembers)
      .where(and(eq(tenantMembers.tenantId, tenantId), notInArray(tenantMembers.role, [...CA_ROLES]))),
    controlDb.select({ count: count() }).from(invitations)
      .where(and(
        eq(invitations.tenantId, tenantId),
        notInArray(invitations.role, [...CA_ROLES]),
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

/** Accountant (CA) members and unexpired pending CA invitations of an organisation. */
export async function countCaSlots(tenantId: string): Promise<{ memberCaCount: number; pendingCaCount: number }> {
  const [[members], [pending]] = await Promise.all([
    controlDb.select({ count: count() }).from(tenantMembers)
      .where(and(eq(tenantMembers.tenantId, tenantId), inArray(tenantMembers.role, [...CA_ROLES]))),
    controlDb.select({ count: count() }).from(invitations)
      .where(and(
        eq(invitations.tenantId, tenantId),
        inArray(invitations.role, [...CA_ROLES]),
        gt(invitations.expiresAt, new Date()),
        isNull(invitations.acceptedAt),
      )),
  ]);
  return { memberCaCount: members?.count ?? 0, pendingCaCount: pending?.count ?? 0 };
}

/**
 * Enforce API key limit.
 * Called from apiKey.create — counts existing keys for the user+tenant.
 */
export async function enforceApiKeyLimit(tenantId: string): Promise<void> {
  const limits = await getTenantLimits(tenantId);
  if (limits.maxApiKeys === 0) {
    // API access is the plan's maxApiKeys: the wording names the cheapest plan that has it, from the stored settings.
    throw limitError(`${await apiAccessMessage()} Upgrade to use the CLI and MCP server.`);
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

  const limits = membership ? await getTenantLimits(membership.tenantId) : await getLimits("starter");
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
 * Enforce data export access. This checks the plan's `dataExport` flag only:
 * a read-only organisation (trial over, payment failed) can still export when
 * its plan allows it, and a suspended one is refused earlier by the callers'
 * own tenant-status checks. Used by business.exportData, selfExport.request
 * and GET /api/export/:tenantId.
 */
export async function enforceDataExport(tenantId: string): Promise<void> {
  const ent = await getEntitlements(tenantId);
  if (!ent.limits.dataExport) {
    // feature_not_in_plan: "Data export is available on the Growth plan and above."
    throw await featureRefusal("dataExport", ent.plan);
  }
}

/**
 * Whether the online store may serve buyers: the plan includes it and the
 * organisation is not read-only or suspended. Pure so it can be unit-tested.
 */
export function storeAvailable(ent: { readOnly: boolean; reason: unknown; limits: { onlineStore: boolean } }): boolean {
  return ent.limits.onlineStore && !ent.readOnly && !ent.reason;
}

/** Whether a hosted organisation's public store may serve buyers right now. */
export async function storeServesTenant(tenantId: string): Promise<boolean> {
  return storeAvailable(await getEntitlements(tenantId));
}

/** Successful recurring runs this calendar month for a business (shown as usage; nothing is capped). */
export async function countRecurringRunsThisMonth(
  db: TenantDatabase,
  businessId: string,
  now: Date = new Date(),
): Promise<number> {
  const monthStart = new Date(now);
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const [{ count: n }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(recurringInvoiceRuns)
    .where(and(
      eq(recurringInvoiceRuns.businessId, businessId),
      eq(recurringInvoiceRuns.status, "success"),
      gte(recurringInvoiceRuns.executedAt, monthStart),
    ));
  return n;
}

/**
 * Whether a PDF is printed WITHOUT the "Powered by Fintranzact" footer. The
 * plan's `pdfBranding` limit decides (so a platform admin's edit in
 * plan_settings takes effect). All three built-in plans show the small line
 * (pdfBranding true); a plan can later switch it off. The PDF data field is still called
 * isPaidPlan for historical reasons.
 */
export async function pdfBrandingHidden(plan: string): Promise<boolean> {
  return !(await getLimits(plan)).pdfBranding;
}

/**
 * Whether an API key may authenticate. Existing keys keep working after a
 * downgrade, with two exceptions: a suspended organisation is shut (the same
 * as for a signed-in user), and a plan with no API keys at all
 * (maxApiKeys === 0, e.g. Starter) stops honouring keys it once issued.
 * Writes by a key in a read-only organisation are refused by the entitlement
 * gate like any other caller's (a key sets ctx.tenantId, so it passes through
 * the same tenant-scoped bases). Keys beyond a reduced maxApiKeys above zero
 * are NOT individually disabled; the cap applies to creating new ones.
 */
export function apiKeyUsable(ent: { reason: unknown; limits: { maxApiKeys: number } }): boolean {
  return ent.reason !== "tenant_suspended" && ent.limits.maxApiKeys !== 0;
}

/**
 * auditRetentionDays means a VISIBLE WINDOW, not deletion: business.auditTrail
 * hides entries older than this many days. Nothing is purged, so upgrading the
 * plan (or raising the limit) shows the older history again. null = unlimited.
 * Returns the oldest createdAt that may be shown, or null for no cut-off.
 */
export function auditWindowStart(retentionDays: number | null, now: Date = new Date()): Date | null {
  if (retentionDays === null || !Number.isFinite(retentionDays)) return null;
  return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
}

/** Refuse enabling or configuring the online store on a plan without it. Staff-facing only: buyers never see it. */
export async function enforceOnlineStore(tenantId: string): Promise<void> {
  const ent = await getEntitlements(tenantId);
  if (!ent.limits.onlineStore) {
    throw await featureRefusal("onlineStore", ent.plan);
  }
}
