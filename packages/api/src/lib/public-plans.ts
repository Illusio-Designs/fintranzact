import { PLANS, PLAN_LIMITS, formatPlanPrice, type PlanInfo, type PlanLimits } from "@fintranzact/shared";

export interface PublicPlan extends PlanInfo {
  /** Display price, e.g. "₹0", "₹1,499" or "Custom". */
  price: string;
  /** The limits the API enforces for this plan. */
  limits: PlanLimits;
}

/** The plans offered to new sign-ups, in display order, with their enforced limits. */
export function listPublicPlans(): PublicPlan[] {
  return PLANS.map((plan) => ({
    ...plan,
    features: [...plan.features],
    price: formatPlanPrice(plan),
    limits: { ...PLAN_LIMITS[plan.id] },
  }));
}

/**
 * JSON-safe form for the REST endpoint: JSON has no Infinity, so unlimited
 * numeric limits are sent as null.
 */
export function listPublicPlansJson() {
  return listPublicPlans().map((plan) => ({
    ...plan,
    limits: Object.fromEntries(
      Object.entries(plan.limits).map(([key, value]) => [key, value === Infinity ? null : value]),
    ),
  }));
}
