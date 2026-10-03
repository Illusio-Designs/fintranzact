import { featureAccess, type FeatureAccess, type PlanFlagKey } from "@fintranzact/shared";
import { useEntitlements } from "@/hooks/useEntitlements";

/**
 * Whether the organisation's plan includes a feature, from `billing.status`
 * (a mirror for badges, banners and disabled buttons: the server refuses the
 * write either way). While the status loads the feature counts as allowed, so
 * nothing flashes locked.
 *
 * `lockedProps` goes on a create/save button: it is disabled (never hidden)
 * and says why on hover and to screen readers.
 */
export function useFeature(flag: PlanFlagKey): FeatureAccess & {
  lockedProps: { disabled?: true; title?: string; "aria-disabled"?: true };
} {
  const { status } = useEntitlements();
  const access = featureAccess(status, flag);
  return {
    ...access,
    lockedProps: access.allowed ? {} : { disabled: true, title: access.message, "aria-disabled": true },
  };
}
