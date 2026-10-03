import { featureAccess, type FeatureAccess, type PlanFlagKey } from "@fintranzact/shared";
import { trpc } from "../lib/trpc";

/**
 * Whether the organisation's plan includes a feature, from `billing.status`
 * (shared with the billing banner's query). A mirror for notices and disabled
 * buttons; the server refuses the write either way. While the status loads the
 * feature counts as allowed, so nothing flashes locked.
 */
export function useFeature(flag: PlanFlagKey): FeatureAccess & { canManageBilling: boolean } {
  const { data: status } = trpc.billing.status.useQuery(undefined, { staleTime: 60_000, retry: 1 });
  return { ...featureAccess(status, flag), canManageBilling: status?.canManageBilling === true };
}
