import { Link } from "@tanstack/react-router";
import { isAddonAvailable } from "@fintranzact/shared";
import { useEntitlements } from "@/hooks/useEntitlements";

/** An AI add-on (and so extra question packs) can be bought today. False while neither tier is on sale. */
export function aiCanBuy(): boolean {
  return isAddonAvailable("ai_assistant") || isAddonAvailable("ai_plus");
}

/**
 * Whether the organisation has the AI assistant add-on right now, from
 * `billing.status` (a mirror for the page: the server refuses every question
 * without it). The add-on is on for an admin grant, a subscription (AI Plus also
 * grants AI Assistant) and during the Full Access Trial, with its cap on
 * questions (`trial.caps.aiQuestions`).
 */
export function useAiAccess() {
  const { status, isLoading, canManageBilling } = useEntitlements();
  const active = !!status?.addons?.ai_assistant || !!status?.addons?.ai_plus;
  const trialCap = status?.trial?.active && status.trial.caps ? status.trial.caps.aiQuestions : null;
  return {
    status,
    loading: isLoading && !status,
    active,
    /** An AI add-on can be bought today (false while neither is on sale). */
    canBuy: aiCanBuy(),
    canManageBilling,
    trialCap,
    readOnly: !!status?.readOnly,
  };
}

/**
 * Shown in the panel when the add-on is not active. No purchase button while
 * the add-on is not on sale (isAddonAvailable); an owner is pointed at Billing
 * only when it can be bought.
 */
export function AiAddonNotice() {
  const { canBuy, canManageBilling, trialCap } = useAiAccess();
  return (
    <div role="status" data-testid="ai-addon-notice" className="rounded-xl border border-border-light bg-surface-1 px-4 py-4 text-sm text-text-secondary">
      <p className="text-base font-semibold text-text-primary">AI is an add-on</p>
      <p className="mt-1">
        Ask Fintranzact AI answers questions about your business from your live data: sales, dues, stock, expiring batches, GST and cash. Your organisation does not have this add-on.
        {canBuy
          ? " You can add it from Billing."
          : ` It is not on sale yet. Organisations in the Full Access Trial can try it with up to ${trialCap ?? 50} questions.`}
      </p>
      {canBuy && (
        <div className="mt-3">
          {canManageBilling ? (
            <Link to="/settings" search={{ tab: "billing" }} className="btn-primary">
              See add-ons
            </Link>
          ) : (
            <p className="text-text-tertiary">Ask an owner of the organisation to add it from Billing.</p>
          )}
        </div>
      )}
    </div>
  );
}
