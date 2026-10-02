/**
 * Entitlements — what an organisation may do right now, from its plan,
 * add-ons, trial and subscription state.
 *
 * One pure function (deriveAccess) is the single source of truth. The API
 * enforces it on the server (lib/entitlements.ts); web and mobile read the
 * same result to show banners and disable buttons. Wording lives here too so
 * every surface says the same thing.
 *
 * Rules, in order:
 *  - a suspended or deleted organisation is blocked outright;
 *  - a live plan subscription (active, or past_due inside its grace period)
 *    is writable, and always beats an expired trial;
 *  - a halted subscription (or past_due past grace) is read-only;
 *  - with no live subscription: a trial that is still running is writable, an
 *    organisation that once had a plan subscription is read-only
 *    (subscription_ended), a trial that has run out is read-only
 *    (trial_expired);
 *  - an organisation that never had a plan subscription and has no trial
 *    (self sign-up forever_free, legacy free, admin-set plans, test fixtures)
 *    stays fully writable.
 * Read-only means reads, search, PDF downloads and exports still work; only
 * creating and editing is refused.
 */

import { ADDON_IDS, addonById, type AddonId, type SubscriptionStatus } from "./billing.js";

export type EntitlementReason =
  | "read_only_halted"
  | "read_only_trial_expired"
  | "read_only_subscription_ended"
  | "plan_limit"
  | "addon_required"
  | "tenant_suspended";

export type AccessState =
  | "free"
  | "trialing"
  | "active"
  | "past_due_grace"
  | "halted"
  | "trial_expired"
  | "ended"
  | "suspended";

/** Where the clients send an owner to fix a read-only or limit error. */
export const BILLING_UPGRADE_PATH = "/settings?tab=billing";

/** Shape of `error.data.entitlement` on every entitlement refusal from the API. */
export interface EntitlementErrorData {
  reason: EntitlementReason;
  upgradePath: string;
  addon?: AddonId;
}

export const READ_ONLY_MESSAGE =
  "Choose a plan to keep creating and editing — you can still view, search, download PDFs and export your data.";

export const READ_ONLY_REASON_MESSAGES: Record<EntitlementReason, string> = {
  read_only_halted:
    "Your last payment did not go through. Choose a plan to keep creating and editing — you can still view, search, download PDFs and export your data.",
  read_only_trial_expired:
    "Your trial has ended. Choose a plan to keep creating and editing — you can still view, search, download PDFs and export your data.",
  read_only_subscription_ended:
    "Your plan has ended. Choose a plan to keep creating and editing — you can still view, search, download PDFs and export your data.",
  plan_limit: "You have reached a limit on your plan. Upgrade to continue.",
  addon_required: "This feature needs an add-on. Add it from Settings → Billing.",
  tenant_suspended: "This organisation is suspended. Contact support to restore access.",
};

/** True for the reasons that put the whole organisation in read-only mode. */
export function isReadOnlyReason(reason: EntitlementReason | null | undefined): boolean {
  return reason === "read_only_halted" || reason === "read_only_trial_expired" || reason === "read_only_subscription_ended";
}

/* ── Client helpers (web + mobile) ─────────────────────────────────────────── */

export type EntitlementInfo = EntitlementErrorData;

export interface EntitlementPrompt {
  title: string;
  description: string;
  /** Button label, or null when the person cannot act on it (non-owner, suspended). */
  actionLabel: string | null;
  /** Suspended organisations get a message that stays until closed. */
  blocking: boolean;
}

const ENTITLEMENT_REASONS: readonly EntitlementReason[] = [
  "read_only_halted",
  "read_only_trial_expired",
  "read_only_subscription_ended",
  "plan_limit",
  "addon_required",
  "tenant_suspended",
];

/** Reads `error.data.entitlement` from a tRPC client error; null for every other error. */
export function entitlementFromError(error: unknown): EntitlementInfo | null {
  const data = (error as { data?: { entitlement?: Partial<EntitlementInfo> } } | null)?.data;
  const ent = data?.entitlement;
  if (!ent || typeof ent.reason !== "string" || !ENTITLEMENT_REASONS.includes(ent.reason)) return null;
  return {
    reason: ent.reason,
    upgradePath: typeof ent.upgradePath === "string" ? ent.upgradePath : BILLING_UPGRADE_PATH,
    addon: ent.addon,
  };
}

/**
 * What to show for a refusal. `canManageBilling` null means "not known yet":
 * treated as not allowed, so nobody is sent to a page they cannot open.
 */
export function describeEntitlement(
  info: EntitlementInfo,
  serverMessage: string,
  canManageBilling: boolean | null,
): EntitlementPrompt {
  const message = serverMessage.trim();
  if (info.reason === "tenant_suspended") {
    return {
      title: "Organisation suspended",
      description: message || "This organisation has been suspended. Contact support to restore access.",
      actionLabel: null,
      blocking: true,
    };
  }
  const readOnly = isReadOnlyReason(info.reason);
  const owner = canManageBilling === true;
  const ask = readOnly ? "Ask your organisation owner to choose a plan." : "Ask your organisation owner to upgrade.";
  return {
    title: readOnly ? "Your account is read-only" : info.reason === "addon_required" ? "Add-on required" : "Plan limit reached",
    description: owner ? message : `${message} ${ask}`.trim(),
    actionLabel: owner ? (readOnly ? "Choose a plan" : "Upgrade") : null,
    blocking: false,
  };
}

export function entitlementMessage(reason: EntitlementReason, addon?: AddonId): string {
  if (reason === "addon_required" && addon) {
    const name = addonById(addon)?.name ?? addon;
    return `The ${name} add-on is needed for this. Add it from Settings → Billing.`;
  }
  return READ_ONLY_REASON_MESSAGES[reason];
}

export interface AccessPlanSubscription {
  status: SubscriptionStatus;
  graceUntil: Date | null;
  currentPeriodEnd?: Date | null;
}

export interface AccessAddon {
  addon: string;
  status: SubscriptionStatus;
  /** The add-on subscription's own grace deadline, when it is past_due. */
  graceUntil?: Date | null;
}

export interface AccessInput {
  plan: string;
  tenantStatus: "active" | "suspended" | "deleted" | string;
  trialEndsAt: Date | null;
  planSubscription: AccessPlanSubscription | null;
  /** True when the organisation has ever had a plan subscription row (any status but "created"). */
  everHadPlanSubscription: boolean;
  addons: AccessAddon[];
  now: Date;
}

/**
 * What each add-on will unlock on the server, and where it is checked. Nothing
 * is gated by an add-on yet: no router or endpoint for any of these exists
 * (the AI assistant, payroll, and Store Pro's custom domain, themes and online
 * checkout are all roadmap items without code). When one lands, its procedures
 * call requireAddon(ctx.tenantId, "<id>") (packages/api/src/lib/entitlements.ts)
 * and this entry says what it covers. Do not add a requireAddon call for a
 * feature that does not exist. The basic online store is a PLAN limit
 * (onlineStore), not Store Pro.
 */
export const ADDON_FEATURES: Record<AddonId, { unlocks: string; implemented: boolean }> = {
  ai_assistant: { unlocks: "AI assistant questions (150 a month); a future ai.* router", implemented: false },
  ai_plus: { unlocks: "AI assistant questions (500 a month, priority); also grants ai_assistant", implemented: false },
  payroll: { unlocks: "Employees, attendance, leave, payroll runs and payslips; a future payroll.* router", implemented: false },
  store_pro: { unlocks: "Store custom domain, themes and page builder, online payments at checkout", implemented: false },
};

export interface Access {
  state: AccessState;
  /** True when creating and editing is refused (reads, search, PDFs, exports stay open). */
  readOnly: boolean;
  /** Set whenever the organisation is blocked or read-only, otherwise null. */
  reason: EntitlementReason | null;
  trialEndsAt: Date | null;
  /** Whole days left, rounded up; null unless trialing. */
  trialDaysLeft: number | null;
  graceUntil: Date | null;
  /** Add-ons the organisation may use right now (AI Plus also grants AI Assistant). */
  addons: Record<AddonId, boolean>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function emptyAddons(): Record<AddonId, boolean> {
  return Object.fromEntries(ADDON_IDS.map((id) => [id, false])) as Record<AddonId, boolean>;
}

/** Past its grace deadline. A missing deadline counts as still inside grace. */
function graceOver(graceUntil: Date | null | undefined, now: Date): boolean {
  return !!graceUntil && graceUntil.getTime() < now.getTime();
}

export function deriveAccess(input: AccessInput): Access {
  const { now } = input;
  const sub = input.planSubscription;
  const trialEndsAt = input.trialEndsAt;
  const base = { trialEndsAt, trialDaysLeft: null as number | null, graceUntil: sub?.graceUntil ?? null };

  const blocked = (state: AccessState, reason: EntitlementReason): Access => ({
    state,
    readOnly: true,
    reason,
    ...base,
    addons: emptyAddons(),
  });

  if (input.tenantStatus !== "active") return blocked("suspended", "tenant_suspended");

  let state: AccessState;
  let readOnly = false;
  let reason: EntitlementReason | null = null;
  let trialDaysLeft: number | null = null;

  if (sub && sub.status === "active") {
    state = "active";
  } else if (sub && sub.status === "past_due" && !graceOver(sub.graceUntil, now)) {
    state = "past_due_grace";
  } else if (sub && (sub.status === "halted" || sub.status === "past_due")) {
    state = "halted";
    readOnly = true;
    reason = "read_only_halted";
  } else {
    // No live (or halted) plan subscription.
    const trialRunning = !!trialEndsAt && trialEndsAt.getTime() > now.getTime();
    if (trialRunning) {
      state = "trialing";
      trialDaysLeft = Math.max(1, Math.ceil((trialEndsAt!.getTime() - now.getTime()) / DAY_MS));
    } else if (input.everHadPlanSubscription) {
      state = "ended";
      readOnly = true;
      reason = "read_only_subscription_ended";
    } else if (trialEndsAt) {
      state = "trial_expired";
      readOnly = true;
      reason = "read_only_trial_expired";
    } else {
      state = "free";
    }
  }

  const addons = emptyAddons();
  if (!readOnly) {
    for (const a of input.addons) {
      if (!(ADDON_IDS as readonly string[]).includes(a.addon)) continue;
      const live = a.status === "active" || (a.status === "past_due" && !graceOver(a.graceUntil, now));
      if (live) addons[a.addon as AddonId] = true;
    }
    if (addons.ai_plus) addons.ai_assistant = true;
  }

  return { state, readOnly, reason, ...base, trialDaysLeft, addons };
}
