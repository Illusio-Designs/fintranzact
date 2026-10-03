import { twoFactorFromError, TWO_FACTOR_SETUP_PATH } from "@fintranzact/shared";
import { toast } from "@/hooks/useToast";
import { markEntitlementHandled } from "@/lib/entitlement";

let lastShown = 0;
let navigateToSetup: ((setupPath: string) => void) | null = null;

/** Registered by the banner so the toast action uses client-side navigation. */
export function registerTwoFactorNavigator(fn: ((setupPath: string) => void) | null) {
  navigateToSetup = fn;
}

function goToSetup(setupPath: string) {
  if (navigateToSetup) navigateToSetup(setupPath);
  else if (typeof window !== "undefined") window.location.assign(setupPath || TWO_FACTOR_SETUP_PATH);
}

/**
 * Central handler for a failed query or mutation: when the organisation
 * requires two-factor authentication and the user has not set it up, show one
 * toast with a "Set up two-factor" action. Returns true when it was such an
 * error (even when the toast is deduped); every other error returns false.
 */
export function handleTwoFactorError(error: unknown): boolean {
  const info = twoFactorFromError(error);
  if (!info) return false;
  // Forms' own `toast.error(e.message)` stays quiet for the same refusal.
  markEntitlementHandled((error as { message?: string }).message ?? "");

  const now = Date.now();
  if (now - lastShown < 3000) return true;
  lastShown = now;

  toast({
    title: "Two-factor authentication required",
    description: (error as { message?: string }).message || "Your organisation requires two-factor authentication.",
    variant: "warning",
    bypassEntitlementDedupe: true,
    duration: Infinity,
    action: { label: "Set up two-factor", onClick: () => goToSetup(info.setupPath) },
  });
  return true;
}

export function resetTwoFactorHandlerForTests() {
  lastShown = 0;
}
