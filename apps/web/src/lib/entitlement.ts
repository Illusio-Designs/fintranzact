/**
 * Client side of the server's entitlement refusals (see docs/ENTITLEMENTS.md).
 * The server is the enforcement; this only turns a refusal into a clear
 * message with a way out ("Choose a plan" / "Upgrade"). The pure parsing and
 * wording live in @fintranzact/shared so web and mobile say the same thing.
 */
import { entitlementFromError, describeEntitlement } from "@fintranzact/shared";

export { describeEntitlement };
export type { EntitlementInfo, EntitlementPrompt } from "@fintranzact/shared";

/** Reads `error.data.entitlement` from a tRPC client error; null for every other error. */
export const getEntitlement = entitlementFromError;

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
