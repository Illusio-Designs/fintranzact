/**
 * Plans shown on the public pricing page and during sign-up plan selection.
 * The data lives in @fintranzact/shared next to the limits the API enforces,
 * so prices, features and limits stay in one place.
 */
import { formatPlanPrice, PLANS, type PlanId, type PlanInfo } from "@fintranzact/shared";

export type { PlanId, PlanInfo };
export { PLAN_LIMITS, formatPlanLimit, formatPlanPrice } from "@fintranzact/shared";

export const PLAN_OPTIONS: Array<PlanInfo & { price: string }> = PLANS.map((plan) => ({
  ...plan,
  price: formatPlanPrice(plan),
}));
