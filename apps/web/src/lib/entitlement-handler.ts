import { toast } from "@/hooks/useToast";
import {
  describeEntitlement,
  getEntitlement,
  getCanManageBilling,
  goToBilling,
  markEntitlementHandled,
} from "@/lib/entitlement";

let lastShown = { key: "", at: 0 };

/**
 * Central handler for a failed query or mutation. Shows the refusal with a
 * "Choose a plan" / "Upgrade" action and returns true when the error was an
 * entitlement refusal (the caller then refreshes billing.status). Every other
 * error returns false and is left to the caller's own handling.
 */
export function handleEntitlementError(error: unknown): boolean {
  const info = getEntitlement(error);
  if (!info) return false;
  const serverMessage = (error as { message?: string }).message ?? "";
  // Recorded even when the toast is deduped below, so forms stay quiet.
  markEntitlementHandled(serverMessage);

  const prompt = describeEntitlement(info, serverMessage, getCanManageBilling());
  const key = `${info.reason}|${serverMessage}`;
  const now = Date.now();
  if (lastShown.key === key && now - lastShown.at < 3000) return true;
  lastShown = { key, at: now };

  toast({
    title: prompt.title,
    description: prompt.description,
    variant: prompt.blocking ? "error" : "warning",
    bypassEntitlementDedupe: true,
    duration: prompt.blocking ? Infinity : 10000,
    action: prompt.actionLabel ? { label: prompt.actionLabel, onClick: goToBilling } : undefined,
  });
  return true;
}

export function resetEntitlementHandlerForTests() {
  lastShown = { key: "", at: 0 };
}
