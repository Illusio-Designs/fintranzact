/**
 * Plan ids before the three-plan model (Starter / Growth / Business), and how
 * the migration maps them. This is the pure mirror of the CASE expressions in
 * packages/db/drizzle/0055_* and drizzle-control/0018_* (kept in step by the
 * integration test plan-migration.test.ts). It is the only place the old ids
 * still appear in code; nothing offers them.
 *
 *   forever_free -> business, grandfathered (permanent full access)
 *   free         -> starter
 *   pro          -> growth
 *   business     -> business
 *   enterprise   -> business
 */

import { z } from "zod";
import { PLAN_IDS, type PlanId } from "./plans.js";

export const LEGACY_PLAN_IDS = ["forever_free", "free", "pro", "business", "enterprise"] as const;

export interface MigratedPlan {
  plan: PlanId;
  /** True for organisations that had Forever Free: tenants.access_grandfathered. */
  grandfathered: boolean;
}

const MAP: Record<string, MigratedPlan> = {
  forever_free: { plan: "business", grandfathered: true },
  free: { plan: "starter", grandfathered: false },
  pro: { plan: "growth", grandfathered: false },
  business: { plan: "business", grandfathered: false },
  enterprise: { plan: "business", grandfathered: false },
};

/** What an old plan id becomes; null for anything that was never a plan id. */
export function oldPlanToNew(oldPlan: string): MigratedPlan | null {
  return MAP[oldPlan] ? { ...MAP[oldPlan] } : null;
}

/** Ids that were plans once and are gone now (business lives on under the same id). */
export const REMOVED_PLAN_IDS = ["forever_free", "free", "pro", "enterprise"] as const;

export function isRemovedPlanId(value: unknown): boolean {
  return typeof value === "string" && (REMOVED_PLAN_IDS as readonly string[]).includes(value);
}

/** The message for choosing a plan that no longer exists. */
export function removedPlanMessage(value: string): string {
  return `The ${value} plan has been removed. Choose Starter, Growth or Business.`;
}

/**
 * Input schema for a plan id on any API call: a current plan id passes; a
 * removed one is refused with a message that says so; anything else is unknown.
 */
export const planIdSchema = z.enum(PLAN_IDS, {
  errorMap: (_issue, ctx) => ({
    message: isRemovedPlanId(ctx.data) ? removedPlanMessage(String(ctx.data)) : "Unknown plan. Choose Starter, Growth or Business.",
  }),
});
