import { controlDb, planSettings } from "@fintranzact/db";
import {
  PLAN_DEFAULTS,
  PLAN_IDS,
  limitsFromStored,
  type PlanDefinition,
  type PlanId,
  type PlanLimits,
} from "@fintranzact/shared";

/**
 * Plans as they are now: each plan's built-in definition, replaced by a
 * platform admin's edits where there are any (plan_settings).
 *
 * Limit checks run on most writes, so the catalogue is cached for a short
 * time. Saving a plan clears the cache on this server; other servers pick the
 * change up within CACHE_MS.
 */
export interface CatalogPlan extends PlanDefinition {
  /** True when a platform admin has edited this plan. */
  edited: boolean;
  updatedAt: string | null;
}

const CACHE_MS = 30_000;
let cache: { at: number; plans: Map<PlanId, CatalogPlan> } | null = null;

export function invalidatePlanCatalog(): void {
  cache = null;
}

async function load(): Promise<Map<PlanId, CatalogPlan>> {
  const rows = await controlDb.select().from(planSettings);
  const byId = new Map(rows.map((r) => [r.plan as PlanId, r]));
  const plans = new Map<PlanId, CatalogPlan>();
  for (const id of PLAN_IDS) {
    const base = PLAN_DEFAULTS[id];
    const row = byId.get(id);
    plans.set(
      id,
      row
        ? {
            id,
            name: row.name,
            tagline: row.tagline,
            monthlyPriceInr: row.monthlyPriceInr,
            features: [...row.features],
            highlight: row.highlight,
            visible: row.visible,
            limits: limitsFromStored(row.limits, base.limits),
            edited: true,
            updatedAt: row.updatedAt.toISOString(),
          }
        : { ...base, features: [...base.features], limits: { ...base.limits }, edited: false, updatedAt: null },
    );
  }
  return plans;
}

async function catalog(): Promise<Map<PlanId, CatalogPlan>> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.plans;
  const plans = await load();
  cache = { at: Date.now(), plans };
  return plans;
}

/** Every plan, in display order. */
export async function getPlanCatalog(): Promise<CatalogPlan[]> {
  const plans = await catalog();
  return PLAN_IDS.map((id) => plans.get(id)!);
}

/** The limits enforced for a plan. Unknown plans get the legacy free plan's limits. */
export async function getPlanLimits(plan: string): Promise<PlanLimits> {
  const plans = await catalog();
  return (plans.get(plan as PlanId) ?? plans.get("free")!).limits;
}

/** Whether an owner may pick this plan themselves: it must be free and offered. */
export async function isSelfServePlan(plan: string): Promise<boolean> {
  const found = (await catalog()).get(plan as PlanId);
  return !!found && found.visible && found.monthlyPriceInr === 0;
}
