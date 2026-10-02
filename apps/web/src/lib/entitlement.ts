/**
 * Client side of the server's entitlement refusals (see docs/ENTITLEMENTS.md).
 * The server is the enforcement; this only turns a refusal into a clear
 * message with a way out ("Choose a plan" / "Upgrade").
 */
import { isReadOnlyReason, type EntitlementReason, type AddonId } from "@fintranzact/shared";

export interface EntitlementInfo {
  reason: EntitlementReason;
  upgradePath: string;
  addon?: AddonId;
}

export interface EntitlementPrompt {
  title: string;
  description: string;
  /** Button label, or null when the person cannot act on it (non-owner, suspended). */
  actionLabel: string | null;
  /** Suspended organisations get a message that stays until closed. */
  blocking: boolean;
}

const REASONS: readonly EntitlementReason[] = [
  "read_only_halted",
  "read_only_trial_expired",
  "read_only_subscription_ended",
  "plan_limit",
  "addon_required",
  "tenant_suspended",
];

/** Reads `error.data.entitlement` from a tRPC client error; null for every other error. */
export function getEntitlement(error: unknown): EntitlementInfo | null {
  const data = (error as { data?: { entitlement?: Partial<EntitlementInfo> } } | null)?.data;
  const ent = data?.entitlement;
  if (!ent || typeof ent.reason !== "string" || !REASONS.includes(ent.reason)) return null;
  return {
    reason: ent.reason,
    upgradePath: typeof ent.upgradePath === "string" ? ent.upgradePath : "/settings?tab=billing",
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

// ── shared state between the cache-level handler, the banner and the toast ──

let canManageBilling: boolean | null = null;
let navigateToBilling: (() => void) | null = null;

export function setCanManageBilling(value: boolean | null) {
  canManageBilling = value;
}
export function getCanManageBilling() {
  return canManageBilling;
}
export function registerBillingNavigator(fn: (() => void) | null) {
  navigateToBilling = fn;
}
export function goToBilling() {
  if (navigateToBilling) navigateToBilling();
  else if (typeof window !== "undefined") window.location.assign("/settings?tab=billing");
}

// Messages the central handler already showed, so a form's own
// `toast.error("Could not save", e.message)` does not show the same refusal twice.
const HANDLED_TTL_MS = 5000;
const handled = new Map<string, number>();

export function markEntitlementHandled(message: string) {
  handled.set(message, Date.now());
}
export function wasEntitlementHandled(...texts: Array<string | undefined>): boolean {
  const now = Date.now();
  for (const [msg, at] of handled) if (now - at > HANDLED_TTL_MS) handled.delete(msg);
  return texts.some((t) => !!t && handled.has(t));
}
export function resetEntitlementHandled() {
  handled.clear();
}
