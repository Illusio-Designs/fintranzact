import { effectiveYearlyPriceInr, formatPlanPrice, formatYearlyPlanPrice, type PlanInfo, type PlanLimits } from "@fintranzact/shared";
import { getPlanCatalog } from "./plan-catalog.js";

export interface PublicPlan extends PlanInfo {
  /** Display monthly price, e.g. "₹299", "₹1,499" or "Custom". */
  price: string;
  /** Display yearly price (two months free), e.g. "₹2,990". */
  yearlyPrice: string;
  /** The limits the API enforces for this plan. */
  limits: PlanLimits;
}

/**
 * The plans offered to new sign-ups (those a platform admin has not hidden),
 * in display order, with their enforced limits.
 */
export async function listPublicPlans(): Promise<PublicPlan[]> {
  return (await getPlanCatalog())
    .filter((plan) => plan.visible)
    .map((plan) => ({
      id: plan.id,
      name: plan.name,
      tagline: plan.tagline,
      monthlyPriceInr: plan.monthlyPriceInr,
      yearlyPriceInr: effectiveYearlyPriceInr(plan),
      features: [...plan.features],
      highlight: plan.highlight,
      price: formatPlanPrice(plan),
      yearlyPrice: formatYearlyPlanPrice(plan),
      limits: { ...plan.limits },
    }));
}

/**
 * JSON-safe form for the REST endpoint: JSON has no Infinity, so unlimited
 * numeric limits are sent as null.
 */
export async function listPublicPlansJson() {
  return (await listPublicPlans()).map((plan) => ({
    ...plan,
    limits: Object.fromEntries(
      Object.entries(plan.limits).map(([key, value]) => [key, value === Infinity ? null : value]),
    ),
  }));
}
