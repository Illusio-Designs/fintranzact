import { controlDb, planSettings } from "@fintranzact/db";
import { clearEntitlementsCache } from "./entitlements-cache.js";
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
  // Entitlements carry the plan's limits; drop them with the catalogue.
  clearEntitlementsCache();
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
            yearlyPriceInr: row.yearlyPriceInr,
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


/** The limits enforced for a plan. An id the catalogue does not know gets Starter's limits (the tightest). */
export async function getPlanLimits(plan: string): Promise<PlanLimits> {
  const plans = await catalog();
  return (plans.get(plan as PlanId) ?? plans.get("starter")!).limits;
}

/** The plan as it is now (admin edits applied), or undefined for an id that is not a plan. */
export async function getCatalogPlan(plan: string): Promise<CatalogPlan | undefined> {
  return (await catalog()).get(plan as PlanId);
}

/**
 * Whether a plan can be bought online: it is offered on the pricing page and
 * carries a price. A plan with no price ("priced on request") is set up by
 * the Fintranzact team instead.
 */
export async function isPurchasablePlan(plan: string): Promise<boolean> {
  const found = (await catalog()).get(plan as PlanId);
  return !!found && found.visible && found.monthlyPriceInr !== null && found.monthlyPriceInr > 0;
}
