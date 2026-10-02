import { useEffect, useState } from "react";
import dayjs from "dayjs";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEntitlements } from "@/hooks/useEntitlements";
import { registerBillingNavigator } from "@/lib/entitlement";

/** A trial notice only appears in the last week. */
const TRIAL_BANNER_DAYS = 7;
const DISMISS_KEY = "fintranzact:trial-banner-dismissed";

function readDismissedDay(): string | null {
  try {
    return localStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}
function writeDismissedDay(day: string) {
  try {
    localStorage.setItem(DISMISS_KEY, day);
  } catch {
    // storage blocked or full: the banner just comes back next visit
  }
}

const READ_ONLY_COPY: Record<string, string> = {
  read_only_trial_expired: "Your trial has ended.",
  read_only_halted: "Your last payment did not go through.",
  read_only_subscription_ended: "Your plan has ended.",
};

/**
 * One persistent notice about the organisation's billing state, shown under
 * the maintenance banner in the signed-in layout. Renders nothing for `free`
 * and `active` organisations (including every tenant with no subscription).
 */
export function BillingBanner() {
  const navigate = useNavigate();
  const { status, canManageBilling } = useEntitlements();
  const [dismissedDay, setDismissedDay] = useState<string | null>(() => readDismissedDay());
  const today = dayjs().format("YYYY-MM-DD");

  useEffect(() => {
    registerBillingNavigator(() => void navigate({ to: "/settings", search: { tab: "billing" } }));
    return () => registerBillingNavigator(null);
  }, [navigate]);

  if (!status) return null;

  const cta = (label: string) =>
    canManageBilling ? (
      <Link
        to="/settings"
        search={{ tab: "billing" }}
        className="ml-2 inline-block font-semibold underline underline-offset-2 whitespace-nowrap"
      >
        {label}
      </Link>
    ) : null;
  const askOwner = (what: string) =>
    canManageBilling ? null : <span className="ml-1">Ask your organisation owner to {what}.</span>;

  const box = "px-4 py-2 text-center text-sm";

  if (status.state === "suspended") {
    return (
      <div role="alert" data-testid="billing-banner" className={`${box} font-medium bg-red-600 text-white`}>
        {status.message ?? "This organisation has been suspended. Contact support to restore access."}
      </div>
    );
  }

  if (status.readOnly) {
    const lead = (status.reason && READ_ONLY_COPY[status.reason]) || "Your account is read-only.";
    return (
      <div role="status" data-testid="billing-banner" className={`${box} bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-100 border-b border-red-200 dark:border-red-900`}>
        <span className="font-semibold">{lead}</span> You can view, search, download and export, but not create or edit.{" "}
        {canManageBilling ? "Choose a plan to continue." : null}
        {cta("Choose a plan")}
        {askOwner("choose a plan")}
      </div>
    );
  }

  if (status.state === "past_due_grace") {
    const days = status.graceUntil ? Math.max(0, dayjs(status.graceUntil).startOf("day").diff(dayjs().startOf("day"), "day")) : null;
    const when = days === null ? "soon" : days === 0 ? "today" : `in ${days} day${days === 1 ? "" : "s"}`;
    return (
      <div role="status" data-testid="billing-banner" className={`${box} bg-amber-50 text-amber-950 dark:bg-amber-950 dark:text-amber-100 border-b border-amber-200 dark:border-amber-900`}>
        <span className="font-semibold">Payment failed.</span> Your account becomes read-only {when} unless the payment goes through.
        {cta("Update payment")}
        {askOwner("update the payment")}
      </div>
    );
  }

  if (status.state === "trialing" && status.trialDaysLeft !== null && status.trialDaysLeft <= TRIAL_BANNER_DAYS) {
    if (dismissedDay === today) return null;
    const left = status.trialDaysLeft;
    const text = left <= 0 ? "Your trial ends today." : `${left} day${left === 1 ? "" : "s"} left in your trial.`;
    return (
      <div role="status" data-testid="billing-banner" className={`${box} relative bg-brand-600/10 text-text-primary border-b border-border-light`}>
        <span className="font-semibold">{text}</span> Choose a plan to keep creating and editing.
        {cta("Choose a plan")}
        {askOwner("choose a plan")}
        <button
          type="button"
          aria-label="Dismiss trial reminder for today"
          className="ml-3 align-middle text-text-tertiary hover:text-text-primary"
          onClick={() => {
            writeDismissedDay(today);
            setDismissedDay(today);
          }}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
    );
  }

  return null;
}
