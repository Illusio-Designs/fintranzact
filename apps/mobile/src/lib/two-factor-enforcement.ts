/**
 * Mobile side of the organisation's two-factor requirement (docs/TWO-FACTOR.md).
 * The server is the enforcement; this turns a refusal into a clear prompt with
 * a way out: an Alert whose action opens the Security screen.
 */
import { Alert } from "react-native";
import { router } from "expo-router";
import { twoFactorFromError } from "@fintranzact/shared";
import { wasEntitlementHandledMark } from "./entitlement";

export const TWO_FACTOR_SECURITY_ROUTE = "/(app)/(more)/settings/security";

export function openTwoFactorSetup() {
  router.push(TWO_FACTOR_SECURITY_ROUTE as never);
}

let lastShown = 0;

/**
 * Central handler for a failed query or mutation. Returns true when the
 * organisation requires two-factor authentication and the user has not set it
 * up (one Alert per few seconds); every other error returns false.
 */
export function handleTwoFactorError(error: unknown): boolean {
  if (!twoFactorFromError(error)) return false;
  const message = (error as { message?: string }).message ?? "";
  wasEntitlementHandledMark(message);

  const now = Date.now();
  if (now - lastShown < 3000) return true;
  lastShown = now;

  Alert.alert(
    "Two-factor authentication required",
    message || "Your organisation requires two-factor authentication.",
    [{ text: "Not now", style: "cancel" }, { text: "Set up two-factor", onPress: openTwoFactorSetup }],
  );
  return true;
}

export function resetTwoFactorHandlerForTests() {
  lastShown = 0;
}
