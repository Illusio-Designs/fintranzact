import { useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { setCanManageBilling } from "@/lib/entitlement";

/**
 * What the organisation may do right now, from `billing.status` (open to every
 * member). A mirror for banners and hints only; the server is the enforcement.
 * Cached for a minute, refetched on window focus, and refreshed by the central
 * handler after any entitlement refusal.
 */
export function useEntitlements(options: { enabled?: boolean } = {}) {
  const query = trpc.billing.status.useQuery(undefined, {
    enabled: options.enabled ?? true,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
  const status = query.data;
  const canManageBilling = status?.canManageBilling ?? null;

  useEffect(() => {
    setCanManageBilling(canManageBilling);
  }, [canManageBilling]);

  return {
    status,
    isLoading: query.isLoading,
    readOnly: status?.readOnly ?? false,
    suspended: status?.state === "suspended",
    canManageBilling: canManageBilling === true,
  };
}
