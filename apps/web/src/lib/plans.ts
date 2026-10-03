/**
 * Plans shown on the public pricing page, the home page and sign-up plan
 * selection. They are fetched from the API's public `plan.list` endpoint, so
 * prices, features and limits come from the backend that enforces them.
 */
import {
  formatPlanPrice,
  formatYearlyPlanPrice,
  PLAN_GST_RATE_PERCENT,
  YEARLY_SAVING_MONTHS,
  type BillingCycle,
  PLAN_LIMITS,
  PLANS,
  type PlanId,
  type PlanInfo,
  type PlanLimits,
} from "@fintranzact/shared";
import { trpc } from "@/lib/trpc";

export type { PlanId, PlanInfo, PlanLimits };
export { formatPlanLimit, formatPlanPrice } from "@fintranzact/shared";

export type PlanOption = PlanInfo & { price: string; yearlyPrice: string; limits: PlanLimits };

/**
 * Shown only while the first request is in flight (and if it fails), so the
 * page never renders empty. It is the same catalogue the API serves.
 */
export const FALLBACK_PLANS: PlanOption[] = PLANS.map((plan) => ({
  ...plan,
  price: formatPlanPrice(plan),
  yearlyPrice: formatYearlyPlanPrice(plan),
  limits: PLAN_LIMITS[plan.id],
}));

export interface PlanPriceDisplay {
  /** "₹699", "₹6,999" or "Custom". */
  amount: string;
  /** "/month", "/year" or "" for a plan priced on request. */
  unit: string;
  /** "2 months free" on the yearly cycle, otherwise null. */
  saving: string | null;
  /** "+ 18% GST"; empty for a plan priced on request. */
  gst: string;
}

/** The price line a plan card shows for the chosen billing cycle: ex-GST, with the GST note. */
export function planPriceDisplay(plan: Pick<PlanOption, "monthlyPriceInr" | "price" | "yearlyPrice">, cycle: BillingCycle): PlanPriceDisplay {
  if (plan.monthlyPriceInr === null) return { amount: "Custom", unit: "", saving: null, gst: "" };
  const yearly = cycle === "yearly";
  return {
    amount: yearly ? plan.yearlyPrice : plan.price,
    unit: yearly ? "/year" : "/month",
    saving: yearly ? `${YEARLY_SAVING_MONTHS} months free` : null,
    gst: `+ ${PLAN_GST_RATE_PERCENT}% GST`,
  };
}

/** Plans from the backend (`plan.list`), in display order. */
export function usePlans(): { plans: PlanOption[]; isLoading: boolean } {
  const query = trpc.plan.list.useQuery(undefined, {
    staleTime: 5 * 60_000,
    retry: 1,
  });
  return { plans: query.data ?? FALLBACK_PLANS, isLoading: query.isLoading };
}
