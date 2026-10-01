/**
 * security-headers.ts — Hono's secureHeaders, minus one overwrite.
 *
 * secureHeaders() sets its headers after the route has run, with
 * `headers.set`, so it replaced the Cross-Origin-Resource-Policy a route chose
 * for itself: the business logo / signature ("same-site", shown by the web
 * app on its own subdomain or port) and the share-page logo ("cross-origin")
 * all went out as "same-origin", and the browser refused to show them
 * (ERR_BLOCKED_BY_RESPONSE.NotSameOrigin) whenever the web app and the API
 * are on different origins.
 *
 * Every other response still gets the strict "same-origin" default.
 */
import type { MiddlewareHandler } from "hono";
import { secureHeaders } from "hono/secure-headers";

export const DEFAULT_RESOURCE_POLICY = "same-origin";

export function apiSecureHeaders(): MiddlewareHandler[] {
  return [
    secureHeaders({ crossOriginResourcePolicy: false }),
    async (c, next) => {
      await next();
      if (!c.res.headers.has("Cross-Origin-Resource-Policy")) {
        c.res.headers.set("Cross-Origin-Resource-Policy", DEFAULT_RESOURCE_POLICY);
      }
    },
  ];
}
