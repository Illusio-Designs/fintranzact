/**
 * Plans shown on the public pricing page, the home page and sign-up plan
 * selection. They are fetched from the API's public `plan.list` endpoint, so
 * prices, features and limits come from the backend that enforces them.
 */
import {
  formatPlanPrice,
  PLAN_LIMITS,
  PLANS,
  type PlanId,
  type PlanInfo,
  type PlanLimits,
} from "@fintranzact/shared";
import { trpc } from "@/lib/trpc";

export type { PlanId, PlanInfo, PlanLimits };
export { formatPlanLimit, formatPlanPrice } from "@fintranzact/shared";

export type PlanOption = PlanInfo & { price: string; limits: PlanLimits };

/**
 * Shown only while the first request is in flight (and if it fails), so the
 * page never renders empty. It is the same catalogue the API serves.
 */
export const FALLBACK_PLANS: PlanOption[] = PLANS.map((plan) => ({
  ...plan,
  price: formatPlanPrice(plan),
  limits: PLAN_LIMITS[plan.id],
}));

/** Plans from the backend (`plan.list`), in display order. */
export function usePlans(): { plans: PlanOption[]; isLoading: boolean } {
  const query = trpc.plan.list.useQuery(undefined, {
    staleTime: 5 * 60_000,
    retry: 1,
  });
  return { plans: query.data ?? FALLBACK_PLANS, isLoading: query.isLoading };
}
