import dayjs from "dayjs";
import { trialBannerFor } from "@fintranzact/shared";

export interface BillingStatusLike {
  state: string;
  readOnly: boolean;
  reason: string | null;
  message: string | null;
  trialDaysLeft: number | null;
  /** The Full Access Trial block from billing.status. */
  trial?: { active: boolean; daysLeft: number; source: string | null; totalDays: number | null } | null;
  trialMessage?: string | null;
  graceUntil: Date | string | null;
  canManageBilling: boolean;
}

export type BannerTone = "danger" | "warning" | "info";

export interface BannerSpec {
  kind: "suspended" | "read_only" | "past_due" | "trial";
  tone: BannerTone;
  /** Bold lead-in. */
  title: string;
  text: string;
  /** CTA label, null when the person cannot act on it (non-owner, suspended). */
  cta: string | null;
  dismissible: boolean;
}

const READ_ONLY_LEAD: Record<string, string> = {
  read_only_trial_expired: "Your trial has ended.",
  read_only_halted: "Your last payment did not go through.",
  read_only_subscription_ended: "Your plan has ended.",
};

/**
 * Which billing notice to show, if any. Pure: `today` is "YYYY-MM-DD" and
 * `dismissedDay` the day the trial notice was last dismissed.
 */
export function bannerFor(
  status: BillingStatusLike | null | undefined,
  opts: { today?: string; dismissedDay?: string | null } = {},
): BannerSpec | null {
  if (!status) return null;
  const owner = status.canManageBilling === true;
  const today = opts.today ?? dayjs().format("YYYY-MM-DD");

  if (status.state === "suspended") {
    return {
      kind: "suspended",
      tone: "danger",
      title: "Organisation suspended",
      text: status.message ?? "This organisation has been suspended. Contact support to restore access.",
      cta: null,
      dismissible: false,
    };
  }

  // Full Access Trial: countdown while it runs, "Trial ended: read-only" after.
  if (status.state === "trialing" || status.state === "trial_expired") {
    const spec = trialBannerFor(
      { state: status.state, readOnly: status.readOnly, trial: status.trial, trialMessage: status.trialMessage, canManageBilling: owner },
      { today, dismissedDay: opts.dismissedDay },
    );
    if (!spec) return null;
    return {
      kind: spec.kind === "trial" ? "trial" : "read_only",
      tone: spec.tone === "calm" ? "info" : spec.tone,
      title: spec.title,
      text: spec.text,
      cta: spec.cta,
      dismissible: spec.dismissible,
    };
  }

  if (status.readOnly) {
    return {
      kind: "read_only",
      tone: "danger",
      title: (status.reason && READ_ONLY_LEAD[status.reason]) || "Your account is read-only.",
      text: owner
        ? "You can view, search and download, but not create or edit. Choose a plan."
        : "You can view, search and download, but not create or edit. Ask your organisation owner to choose a plan.",
      cta: owner ? "Choose a plan" : null,
      dismissible: false,
    };
  }

  if (status.state === "past_due_grace") {
    const days = status.graceUntil
      ? Math.max(0, dayjs(status.graceUntil).startOf("day").diff(dayjs(today).startOf("day"), "day"))
      : null;
    const when = days === null ? "soon" : days === 0 ? "today" : `in ${days} day${days === 1 ? "" : "s"}`;
    return {
      kind: "past_due",
      tone: "warning",
      title: "Payment failed.",
      text: `Your account becomes read-only ${when} unless the payment goes through.${owner ? "" : " Ask your organisation owner to update the payment."}`,
      cta: owner ? "Update payment" : null,
      dismissible: false,
    };
  }

  return null;
}
