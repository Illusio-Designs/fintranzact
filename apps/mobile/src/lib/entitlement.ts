/**
 * Mobile side of the server's entitlement refusals (docs/ENTITLEMENTS.md).
 * The server is the enforcement; this turns a refusal into a clear message
 * with a way out. The mobile app has no billing screens, so "Choose a plan" /
 * "Upgrade" open the web billing page.
 */
import { Alert, Linking } from "react-native";
import { describeEntitlement, entitlementFromError } from "@fintranzact/shared";
import { getBillingUrl } from "./api-url";

let canManageBilling: boolean | null = null;

export function setCanManageBilling(value: boolean | null) {
  canManageBilling = value;
}
export function getCanManageBilling() {
  return canManageBilling;
}

export function openBilling() {
  Linking.openURL(getBillingUrl()).catch(() => {
    Alert.alert("Could not open the browser", `Open ${getBillingUrl()} to manage your plan.`);
  });
}

// Refusals already shown, so a screen's own Alert for the same message can stay quiet.
const HANDLED_TTL_MS = 5000;
const handled = new Map<string, number>();

export function wasEntitlementHandled(...texts: Array<string | undefined>): boolean {
  const now = Date.now();
  for (const [msg, at] of handled) if (now - at > HANDLED_TTL_MS) handled.delete(msg);
  return texts.some((t) => !!t && handled.has(t));
}

/** Record a refusal message another handler already showed (the two-factor one), so a screen's own Alert stays quiet. */
export function wasEntitlementHandledMark(message: string) {
  handled.set(message, Date.now());
}

let lastShown = { key: "", at: 0 };

/**
 * Central handler for a failed query or mutation. Shows the refusal with a
 * "Choose a plan" / "Upgrade" action (owners) and returns true when the error
 * was an entitlement refusal; every other error returns false.
 */
export function handleEntitlementError(error: unknown): boolean {
  const info = entitlementFromError(error);
  if (!info) return false;
  const serverMessage = (error as { message?: string }).message ?? "";
  handled.set(serverMessage, Date.now());

  const key = `${info.reason}|${serverMessage}`;
  const now = Date.now();
  if (lastShown.key === key && now - lastShown.at < 3000) return true;
  lastShown = { key, at: now };

  const prompt = describeEntitlement(info, serverMessage, canManageBilling);
  const buttons = prompt.actionLabel
    ? [{ text: "Not now", style: "cancel" as const }, { text: prompt.actionLabel, onPress: openBilling }]
    : [{ text: "OK" }];
  Alert.alert(prompt.title, prompt.description, buttons, { cancelable: !prompt.blocking });
  return true;
}

export function resetEntitlementHandlerForTests() {
  lastShown = { key: "", at: 0 };
  handled.clear();
  canManageBilling = null;
}
