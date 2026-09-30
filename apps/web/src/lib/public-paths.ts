/**
 * Which paths are public. Kept free of UI imports so low-level modules (the
 * tRPC client) can use it without pulling in the marketing components.
 */

/** Paths served by the marketing layout instead of the app shell. */
export const MARKETING_PATHS = [
  "/features",
  "/pricing",
  "/about",
  "/contact",
  "/partners",
  "/privacy",
  "/terms",
  "/refund-policy",
  "/widgets",
];

// ── Solutions pages ─────────────────────────────────────────────
/** The /solutions index; every /solutions/<slug> page under it is public too. */
export const SOLUTION_PATHS = ["/solutions"];

/** /solutions and any /solutions/<slug> (an unknown slug shows a not-found page). */
export function isSolutionPath(pathname: string) {
  const path = pathname.replace(/\/+$/, "") || "/";
  return SOLUTION_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}
// ────────────────────────────────────────────────────────────────

/** Sign-in and invite pages a signed-out visitor may open. */
export const AUTH_PUBLIC_PATHS = [
  "/login",
  "/register",
  "/auth/verify",
  "/auth/complete-profile",
  "/auth/verify-email-change",
  "/invite",
];

export function isMarketingPath(pathname: string) {
  const path = pathname.replace(/\/+$/, "") || "/";
  return MARKETING_PATHS.includes(path) || isSolutionPath(path);
}

export function isAuthPublicPath(pathname: string) {
  return AUTH_PUBLIC_PATHS.some((p) => pathname.startsWith(p));
}

/** Shared document pages (/i/<token>): public, and outside the app shell. */
export function isSharePath(pathname: string) {
  return pathname.startsWith("/i/");
}
