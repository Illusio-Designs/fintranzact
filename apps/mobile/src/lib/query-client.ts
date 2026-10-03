import { QueryClient, QueryCache, MutationCache } from "@tanstack/react-query";
import * as SecureStore from "expo-secure-store";
import { useAuthStore } from "../stores/auth";
import { handleEntitlementError } from "./entitlement";
import { handleTwoFactorError } from "./two-factor-enforcement";
import { isPortalSessionError } from "@fintranzact/shared";

/** Entitlement refusals get one prompt, and billing.status is refreshed so the banner is current. */
function handleEntitlement(error: unknown) {
  if (handleEntitlementError(error)) {
    void queryClient.invalidateQueries({ queryKey: [["billing", "status"]] });
    return;
  }
  // The organisation requires two-factor authentication: one Alert with a way
  // to the Security screen, and the requirement is refreshed for the banner.
  if (handleTwoFactorError(error)) {
    void queryClient.invalidateQueries({ queryKey: [["tenant", "current"]] });
  }
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30,
      retry: (failureCount, error) => {
        const trpcError = error as any;
        if (trpcError?.data?.code === "UNAUTHORIZED") return false;
        return failureCount < 1;
      },
      refetchOnWindowFocus: false,
    },
  },
  queryCache: new QueryCache({
    onError: (error, query) => {
      const trpcError = error as any;
      if (__DEV__) {
        console.warn("[QueryCache error]", {
          queryKey: query.queryKey,
          code: trpcError?.data?.code,
          message: trpcError?.message,
          httpStatus: trpcError?.data?.httpStatus,
        });
      }
      // A GST portal session that ended is not the app's sign-in (the filing screen asks for a new OTP).
      if (isPortalSessionError(error)) return;
      if (trpcError?.data?.code === "UNAUTHORIZED") {
        SecureStore.setItemAsync("sessionExpired", "1");
        useAuthStore.getState().logout();
        return;
      }
      handleEntitlement(error);
    },
  }),
  mutationCache: new MutationCache({
    onError: handleEntitlement,
  }),
});
