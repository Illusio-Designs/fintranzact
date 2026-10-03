import { Link } from "@tanstack/react-router";
import type { PlanFlagKey } from "@fintranzact/shared";
import { useFeature } from "@/hooks/useFeature";
import { useEntitlements } from "@/hooks/useEntitlements";

/**
 * The "Not on your plan" state for a page whose feature the plan lacks. It
 * sits above the page's list, so existing data stays visible; the page's
 * create buttons are disabled with the same reason (see useFeature). Renders
 * nothing when the feature is included.
 *
 * Owners go to Billing, everyone else to the public pricing page.
 */
export function FeatureNotice({ flag, children }: { flag: PlanFlagKey; children?: React.ReactNode }) {
  const feature = useFeature(flag);
  const { canManageBilling } = useEntitlements();
  if (feature.allowed) return null;
  return (
    <div
      role="status"
      data-testid="feature-notice"
      className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border-light bg-surface-1 px-4 py-3 text-sm text-text-secondary"
    >
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-text-primary">{feature.featureName}: not on your plan</p>
        <p>
          {feature.message} {children ?? "Anything you already have here stays visible; creating and changing it needs the plan."}
        </p>
      </div>
      {canManageBilling ? (
        <Link to="/settings" search={{ tab: "billing" }} className="btn-primary whitespace-nowrap">
          See plans
        </Link>
      ) : (
        <Link to="/pricing" className="btn-secondary whitespace-nowrap">
          See plans
        </Link>
      )}
    </div>
  );
}
