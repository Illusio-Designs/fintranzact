/**
 * Plan limits configuration.
 *
 * Free tier is generous enough to get hooked (unlimited invoices, parties, payments)
 * but gates features that matter at scale (team size, multi-business, integrations).
 *
 * Self-hosted defaults to "free" plan — same limits apply including PDF branding.
 */

import { eq, and, gt, gte, isNull, count, sql } from "drizzle-orm";
import { controlDb, tenants, tenantMembers, invitations } from "@fintranzact/db";
import type { TenantDatabase } from "../trpc.js";
import { businesses, recurringInvoiceRuns } from "@fintranzact/db";
import { PLAN_LIMITS, type PlanLimits } from "@fintranzact/shared";
import { getPlanLimits } from "./plan-catalog.js";
import { getEntitlements, assertWritable } from "./entitlements.js";
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
 * Creating another organisation is a write, and refused while any organisation
 * the user owns is read-only (trial over, payment failed, plan ended) or
 * suspended: otherwise a lapsed owner could start a fresh trial in a new
 * organisation instead of paying. The refusal carries that organisation's
 * entitlement reason. Users who own none, or only organisations in good
 * standing (including forever_free and legacy free), are unaffected.
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

/** The message for a plan without data export. */
export const DATA_EXPORT_DENIED_MESSAGE = "Data export is available on paid plans. Upgrade to export your data.";

/**
 * Enforce data export access. This checks the plan's `dataExport` flag only:
 * a read-only organisation (trial over, payment failed) can still export when
 * its plan allows it, and a suspended one is refused earlier by the callers'
 * own tenant-status checks. Used by business.exportData, selfExport.request
 * and GET /api/export/:tenantId.
 */
export async function enforceDataExport(tenantId: string): Promise<void> {
  const limits = await getTenantLimits(tenantId);
  if (!limits.dataExport) {
    throw limitError(DATA_EXPORT_DENIED_MESSAGE);
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

/**
 * Whether a recurring run may happen now. `runsThisMonth` counts successful
 * runs this month for the business; the limit is the plan's
 * recurringRunsPerMonth (Infinity = unlimited). Shared by the scheduler and
 * recurringInvoice.runNow so both count the same way.
 */
export function recurringRunAllowed(runsThisMonth: number, limit: number): boolean {
  return !Number.isFinite(limit) || runsThisMonth < limit;
}

/** Successful recurring runs this calendar month for a business: the one counter the limit uses. */
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

/** Refuse a manual recurring run once the plan's monthly allowance is used. */
export async function enforceRecurringRunLimit(
  tenantId: string | null,
  db: TenantDatabase,
  businessId: string,
): Promise<void> {
  // The organisation's own plan (a real tenant row exists in hosted AND
  // self-hosted mode here), not the scheduler's self-hosted free allowance.
  const limit = tenantId ? await getTenantLimits(tenantId).then((l) => l.recurringRunsPerMonth) : RECURRING_RUNS_PER_MONTH_FREE;
  if (!Number.isFinite(limit)) return;
  const used = await countRecurringRunsThisMonth(db, businessId);
  if (!recurringRunAllowed(used, limit)) {
    throw limitError(
      `Your plan allows ${limit} recurring invoice run${limit === 1 ? "" : "s"} a month per business, and this month's are used. Upgrade for more.`,
    );
  }
}

/**
 * Whether a PDF is printed WITHOUT the "Powered by Fintranzact" footer. The
 * plan's `pdfBranding` limit decides (so a platform admin's edit in
 * plan_settings takes effect). Defaults match the old `plan !== "free"` rule:
 * only the legacy free plan is branded. The PDF data field is still called
 * isPaidPlan for historical reasons.
 */
export async function pdfBrandingHidden(plan: string): Promise<boolean> {
  return !(await getLimits(plan)).pdfBranding;
}

/**
 * Whether an API key may authenticate. Existing keys keep working after a
 * downgrade, with two exceptions: a suspended organisation is shut (the same
 * as for a signed-in user), and a plan with no API keys at all
 * (maxApiKeys === 0, e.g. legacy free) stops honouring keys it once issued.
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

/** Message for a plan without the online store. Staff-facing only: buyers never see it. */
export const ONLINE_STORE_DENIED_MESSAGE = "The online store is available on paid plans. Upgrade to turn it on.";

/** Refuse enabling or configuring the online store on a plan without it. */
export async function enforceOnlineStore(tenantId: string): Promise<void> {
  if (!(await getTenantLimits(tenantId)).onlineStore) {
    throw limitError(ONLINE_STORE_DENIED_MESSAGE);
  }
}
