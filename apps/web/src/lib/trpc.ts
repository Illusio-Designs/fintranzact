import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink, splitLink, httpLink, TRPCClientError, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { QueryClient, QueryCache, MutationCache } from "@tanstack/react-query";
import superjson from "superjson";
import type { AppRouter } from "@fintranzact/api";
import { isDesktop } from "./isDesktop";
import { ensureAccessToken } from "./desktop-session";
import { handleEntitlementError } from "@/lib/entitlement-handler";
import { handleTwoFactorError } from "@/lib/two-factor-handler";
import { isAuthPublicPath, isMarketingPath, isSharePath } from "@/lib/public-paths";

// The explicit `as any` cast avoids TS2742 "inferred type cannot be named" error caused
// by tRPC's internal .d.mts paths resolving through hoisted node_modules.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const trpc: ReturnType<typeof createTRPCReact<AppRouter>> = createTRPCReact<AppRouter>() as any;

// Business ID stored in memory — set after user selects a business
let currentBusinessId: string | null = null;
export function setBusinessId(id: string | null) {
  currentBusinessId = id;
}
export function getBusinessId() {
  return currentBusinessId;
}

export const OFFLINE_MESSAGE = "You appear to be offline. Check your internet connection and try again.";

function commonOptions() {
  // Desktop uses Bearer-token auth (see apps/web/src/lib/desktop-session.ts
  // for the rationale — SameSite=Lax cookies can't span `tauri.localhost`
  // and `api.fintranzact.com`). Web keeps the HttpOnly cookie for XSS resistance.
  //
  // TWO-TOKEN FLOW (desktop):
  // `headers()` is async — tRPC supports this. On desktop we await
  // `ensureAccessToken()` which either returns a cached short-lived access
  // token (at_*) or transparently issues a new one using the keychain
  // refresh token. The result is placed in `Authorization: Bearer at_*`.
  // This means the keychain refresh token is NEVER sent for normal API
  // calls; it is only used by the `auth.issueAccessToken` endpoint inside
  // `ensureAccessToken()` via a direct fetch.
  const desktop = isDesktop();
  return {
    transformer: superjson,
    async headers() {
      const headers: Record<string, string> = {
        "X-Requested-With": "fintranzact",
      };
      if (currentBusinessId) {
        headers["x-business-id"] = currentBusinessId;
      }
      if (desktop) {
        // Signals the server to skip Turnstile. Spoofable by design — see
        // auth router for the trade-off documentation.
        headers["x-fintranzact-client"] = "desktop";
        // Await the access token — issues a new one transparently if
        // the cached one has expired or is within the 30s refresh window.
        const token = await ensureAccessToken();
        if (token) {
          headers["Authorization"] = `Bearer ${token}`;
        }
      }
      return headers;
    },
    fetch(url: URL | RequestInfo, options?: RequestInit) {
      // Only include cookies on web. Desktop is cross-origin to the API and
      // sends Bearer instead; including credentials would make the browser
      // demand CORS `Access-Control-Allow-Credentials: true` on every
      // response to `tauri.localhost` without any auth benefit.
      const credentials: RequestCredentials = desktop ? "omit" : "include";
      // A request that cannot reach the server surfaces as a plain TypeError
      // ("Failed to fetch"); give people a message they can act on instead.
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        return Promise.reject(new Error(OFFLINE_MESSAGE));
      }
      return fetch(url, { ...options, credentials }).catch((error: unknown) => {
        throw error instanceof TypeError ? new Error(OFFLINE_MESSAGE) : error;
      });
    },
  };
}

const TRPC_URL = import.meta.env.API_URL
  ? `${import.meta.env.API_URL}/api/trpc`
  : "/api/trpc";

const GENERIC_MESSAGE = "Something went wrong. Please try again.";

/**
 * Turns whatever an error carries into a sentence a person can read: never
 * JSON, HTML, a stack trace or a library message. Used as a safety net so
 * every `error.message` the UI prints is friendly.
 */
export function friendlyErrorMessage(message: string | undefined | null): string {
  const text = (message ?? "").trim();
  if (!text) return GENERIC_MESSAGE;
  if (/failed to fetch|networkerror|network request failed|load failed/i.test(text)) return OFFLINE_MESSAGE;
  if (text.startsWith("[") || text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text);
      const first = Array.isArray(parsed) ? parsed[0] : parsed;
      const inner = typeof first?.message === "string" ? first.message : "";
      // An issue we wrote ourselves is fine to show; Zod's stock wording is not.
      if (inner && !/^(invalid|required|expected)/i.test(inner)) return inner;
    } catch {
      // not JSON after all; fall through
    }
    return "Please check the details you entered and try again.";
  }
  if (/^<(!doctype|html)/i.test(text) || /unable to transform response|unexpected token|is not valid json|unexpected end of json/i.test(text)) {
    return GENERIC_MESSAGE;
  }
  if (/\n\s+at /.test(text)) return GENERIC_MESSAGE;
  return text;
}

/** Rewrites every failed call's message with friendlyErrorMessage before the UI sees it. */
const friendlyErrorLink: TRPCLink<AppRouter> = () => ({ next, op }) =>
  observable((observer) =>
    next(op).subscribe({
      next: (value) => observer.next(value),
      error: (err) => {
        if (err instanceof TRPCClientError) err.message = friendlyErrorMessage(err.message);
        observer.error(err);
      },
      complete: () => observer.complete(),
    }),
  );

export function createTRPCClient() {
  return trpc.createClient({
    links: [
      friendlyErrorLink,
      // Mutations go through a non-batching link to avoid SuperJSON parse failures
      // when large mutation responses get combined with background query responses
      splitLink({
        condition: (op) => op.type === "mutation",
        true: httpLink({ url: TRPC_URL, ...commonOptions() }),
        false: httpBatchLink({ url: TRPC_URL, ...commonOptions() }),
      }),
    ],
  });
}

// Track whether we're already redirecting to avoid multiple redirects
let isRedirectingToLogin = false;

function handleAuthError(error: unknown) {
  if (isRedirectingToLogin) return;
  const trpcError = error as { data?: { code?: string } };
  if (trpcError?.data?.code === "UNAUTHORIZED") {
    // Public pages work signed out; a stray 401 there must not bounce the
    // visitor to the login screen.
    const path = window.location.pathname;
    if (isMarketingPath(path) || isAuthPublicPath(path) || isSharePath(path)) return;
    isRedirectingToLogin = true;
    // Use sessionStorage so the login page can show a message
    sessionStorage.setItem("sessionExpired", "1");
    window.location.href = "/login";
  }
}

/**
 * Runs for every failed query and mutation (before a form's own onError):
 * an entitlement refusal gets one toast with a "Choose a plan" / "Upgrade"
 * action, and billing.status is refetched so the banner is current.
 */
function handleEntitlement(error: unknown) {
  if (handleEntitlementError(error)) {
    void queryClient.invalidateQueries({ queryKey: [["billing", "status"]] });
    return;
  }
  // The organisation requires two-factor authentication: toast with a "Set up
  // two-factor" action, and refresh the requirement so the banner is current.
  if (handleTwoFactorError(error)) {
    void queryClient.invalidateQueries({ queryKey: [["tenant", "current"]] });
  }
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30, // 30 seconds
      retry: (failureCount, error) => {
        // Don't retry UNAUTHORIZED — session is gone
        const trpcError = error as { data?: { code?: string } };
        if (trpcError?.data?.code === "UNAUTHORIZED") return false;
        return failureCount < 1;
      },
      refetchOnWindowFocus: false,
    },
    mutations: {
      // Fail straight away when offline (so a form can show an error)
      // instead of waiting silently until the network returns.
      networkMode: "always",
      onError: handleAuthError,
    },
  },
  queryCache: new QueryCache({
    onError: (error) => {
      handleAuthError(error);
      handleEntitlement(error);
    },
  }),
  mutationCache: new MutationCache({
    onError: handleEntitlement,
  }),
});
