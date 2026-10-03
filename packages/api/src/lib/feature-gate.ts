/**
 * Plan feature enforcement: the server half of FEATURE_GATES (shared).
 *
 * trpc.ts calls enforceFeatureGates from the entitlementGate middleware, AFTER
 * the read-only / suspended decision (so an expired trial still says "choose a
 * plan", not "upgrade to Growth"). A procedure the registry gates is refused
 * with FORBIDDEN + data.entitlement = { reason/code: "feature_not_in_plan",
 * feature, featureName, requiredPlan, currentPlan } when the organisation's
 * features (lib/plan-features.ts) lack the flag. Procedures the registry does
 * not name are never touched, so reads of existing data keep working.
 *
 * requireFeature / hasFeature are the same check for code that is not a tRPC
 * procedure (the recurring scheduler, the background IRN submission, REST).
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import { items, premises, warehouses, type TenantDatabase } from "@fintranzact/db";
import {
  FEATURE_GATES,
  PLAN_ORDER,
  featureGatesFor,
  featureNotInPlanMessage,
  planName,
  requiredPlanFor,
  type FeatureCondition,
  type PlanFlagKey,
} from "@fintranzact/shared";
import { getCatalogPlan, getPlanCatalog } from "./plan-catalog.js";
import { entitlementDataOf, featureNotInPlanError } from "./entitlement-error.js";
import { getEntitlements, type Entitlements } from "./entitlements.js";

/** What names the plan: the stored name (an admin may have renamed it), else the built-in one. */
async function currentPlanName(plan: string): Promise<string> {
  return (await getCatalogPlan(plan))?.name ?? planName(plan);
}

/**
 * For every flag: the cheapest plan whose STORED flag is on (by name), plus the
 * highest plan's name. Derived from the catalogue on each call, never from a
 * hard-coded plan name, so an admin's edit shows at once.
 */
export async function featureCatalogInfo(): Promise<{
  requiredPlans: Record<PlanFlagKey, string | null>;
  topPlanName: string | null;
}> {
  const catalog = await getPlanCatalog();
  const plans = catalog.map((p) => ({ id: p.id, name: p.name, limits: p.limits }));
  const requiredPlans = {} as Record<PlanFlagKey, string | null>;
  for (const flag of Object.keys(FEATURE_GATES) as PlanFlagKey[]) requiredPlans[flag] = requiredPlanFor(flag, plans)?.name ?? null;
  const top = catalog.find((p) => p.id === PLAN_ORDER[PLAN_ORDER.length - 1]);
  return { requiredPlans, topPlanName: top?.name ?? null };
}

/** The refusal for a flag the plan lacks. */
export async function featureRefusal(flag: PlanFlagKey, plan: string) {
  const def = FEATURE_GATES[flag];
  const { requiredPlans, topPlanName } = await featureCatalogInfo();
  const requiredPlan = requiredPlans[flag];
  return featureNotInPlanError({
    feature: flag,
    featureName: def.name,
    requiredPlan,
    currentPlan: await currentPlanName(plan),
    message: featureNotInPlanMessage(flag, requiredPlan, topPlanName),
  });
}

/**
 * The cheapest plan that includes API access (maxApiKeys above zero), by name,
 * from the stored plan settings. API access is a count limit, not a flag, so it
 * is not in FEATURE_GATES; apiKey.create and the key checks use this for wording.
 */
export async function apiAccessRequiredPlan(): Promise<{ name: string; isTop: boolean } | null> {
  const catalog = await getPlanCatalog();
  for (const id of PLAN_ORDER) {
    const plan = catalog.find((p) => p.id === id);
    if (plan && plan.limits.maxApiKeys !== 0) return { name: plan.name, isTop: id === PLAN_ORDER[PLAN_ORDER.length - 1] };
  }
  return null;
}

/** "API access is available on the Growth plan and above." */
export async function apiAccessMessage(): Promise<string> {
  const req = await apiAccessRequiredPlan();
  if (!req) return "API access is not available on your plan.";
  return `API access is available on the ${req.name} plan${req.isTop ? "" : " and above"}.`;
}

/** The 403 JSON body REST routes send for a feature the plan lacks (same data as the tRPC error). */
export async function featureRefusalBody(flag: PlanFlagKey, plan: string) {
  const err = await featureRefusal(flag, plan);
  return { error: err.message, entitlement: entitlementDataOf(err)! };
}

// ── Conditions ────────────────────────────────────────────────────────────

const BATCH_KEYS = new Set(["batchId", "batchNumber", "expiryDate", "mfgDate", "newBatch", "openingBatch"]);

/** True when any object inside the raw input carries a non-empty batch / expiry field. */
export function writesBatchFields(raw: unknown, depth = 0): boolean {
  if (raw === null || typeof raw !== "object" || depth > 8) return false;
  if (Array.isArray(raw)) return raw.some((v) => writesBatchFields(v, depth + 1));
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (BATCH_KEYS.has(k) && v !== null && v !== undefined && v !== "") return true;
    if (writesBatchFields(v, depth + 1)) return true;
  }
  return false;
}

interface Scope {
  db?: TenantDatabase;
  businessId?: string;
}

async function conditionHolds(condition: FeatureCondition, path: string, raw: unknown, scope: Scope): Promise<boolean> {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  switch (condition) {
    case "batch_fields":
      return writesBatchFields(raw);
    case "pos_sale":
      return input.source === "pos";
    case "item_batch_flags": {
      // item.create: any on-flag. item.update: only turning a flag ON for an item that does not have it yet,
      // so editing other fields of an item that already tracks batches stays possible.
      const data = (path === "item.update" ? input.data : input) as Record<string, unknown> | undefined;
      const wantsBatches = data?.trackBatches === true;
      const wantsExpiry = data?.trackExpiry === true;
      if (path === "item.create") return wantsBatches || wantsExpiry || !!data?.openingBatch;
      if (!wantsBatches && !wantsExpiry) return false;
      if (!scope.db || !scope.businessId || typeof input.id !== "string") return true;
      const [before] = await scope.db
        .select({ trackBatches: items.trackBatches, trackExpiry: items.trackExpiry })
        .from(items)
        .where(and(eq(items.id, input.id), eq(items.businessId, scope.businessId), isNull(items.deletedAt)))
        .limit(1);
      if (!before) return false; // the procedure answers NOT_FOUND itself
      return (wantsBatches && !before.trackBatches) || (wantsExpiry && !before.trackExpiry);
    }
    case "second_warehouse":
    case "second_premise": {
      if (!scope.db || !scope.businessId) return true;
      const table = condition === "second_warehouse" ? warehouses : premises;
      const [row] = await scope.db
        .select({ n: sql<number>`count(*)::int` })
        .from(table)
        .where(eq(table.businessId, scope.businessId));
      return (row?.n ?? 0) >= 1;
    }
  }
}

/**
 * Throws the feature refusal when the procedure is gated by a flag the
 * organisation lacks. `getRawInput` is only awaited when a condition needs it.
 */
export async function enforceFeatureGates(args: {
  path: string;
  type: "query" | "mutation" | "subscription";
  entitlements: Pick<Entitlements, "features" | "plan">;
  getRawInput: () => Promise<unknown>;
  db?: TenantDatabase;
  businessId?: string;
}): Promise<void> {
  const matches = featureGatesFor(args.path, args.type);
  if (matches.length === 0) return;
  for (const m of matches) {
    if (args.entitlements.features[m.flag]) continue;
    if (m.condition) {
      const raw = await args.getRawInput().catch(() => undefined);
      if (!(await conditionHolds(m.condition, args.path, raw, { db: args.db, businessId: args.businessId }))) continue;
    }
    throw await featureRefusal(m.flag, args.entitlements.plan);
  }
}

// ── For code outside tRPC procedures ──────────────────────────────────────

/** Whether the organisation's plan (trial, grandfathered included) has the feature right now. */
export async function hasFeature(tenantId: string, flag: PlanFlagKey): Promise<boolean> {
  return (await getEntitlements(tenantId)).features[flag];
}

/** Throws the feature refusal unless the organisation has the feature. */
export async function requireFeature(tenantId: string, flag: PlanFlagKey): Promise<Entitlements> {
  const ent = await getEntitlements(tenantId);
  if (!ent.features[flag]) throw await featureRefusal(flag, ent.plan);
  return ent;
}
