import { isHelpPath } from "./help-paths";

/**
 * Which paths are public. Kept free of UI imports so low-level modules (the
 * tRPC client) can use it without pulling in the marketing components.
 */
import { isDeveloperPath } from "./developer-paths";

/** Paths served by the marketing layout instead of the app shell. */
export const MARKETING_PATHS = [
  "/features",
  "/pricing",
  "/about",
  "/contact",
  "/partners",
  "/find-a-partner",
  "/privacy",
  "/terms",
  "/refund-policy",
  "/security",
  "/widgets",
];

// ── Solutions pages ─────────────────────────────────────────────
/** The /solutions index; every /solutions/<slug> page under it is public too. */
export const SOLUTION_PATHS = ["/solutions"];

/**
 * The slug of every solutions page, kept here (free of UI imports) so the
 * build-time sitemap can list them. lib/solutions-content.ts must have a page
 * for each; a test checks the two agree.
 */
export const SOLUTION_SLUGS = [
  "retail",
  "wholesale",
  "manufacturing",
  "services",
  "pharmacy",
  "restaurants",
  "electronics",
  "apparel",
  "freelancers",
  "growing-businesses",
  "multi-branch",
  "accountants",
] as const;

/** The solutions index and every solutions page, for the sitemap. */
export const SOLUTION_PAGE_PATHS = [...SOLUTION_PATHS, ...SOLUTION_SLUGS.map((s) => `/solutions/${s}`)];

/** /solutions and any /solutions/<slug> (an unknown slug shows a not-found page). */
export function isSolutionPath(pathname: string) {
  const path = pathname.replace(/\/+$/, "") || "/";
  return SOLUTION_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}
// ────────────────────────────────────────────────────────────────

// ── Feature pages ───────────────────────────────────────────────
/** /features (in MARKETING_PATHS) and any /features/<slug> (an unknown slug shows a not-found page). */
export function isFeaturePath(pathname: string) {
  const path = pathname.replace(/\/+$/, "") || "/";
  return path === "/features" || path.startsWith("/features/");
}
export { FEATURE_PAGE_PATHS, FEATURE_SLUGS } from "./feature-slugs";
// ────────────────────────────────────────────────────────────────

// ── Help centre ─────────────────────────────────────────────────
/** The help centre: /help and every /help/<article> page (see lib/help-paths.ts). */
export { HELP_PAGE_PATHS, isHelpPath } from "./help-paths";
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
  return (
    MARKETING_PATHS.includes(path) ||
    isFeaturePath(path) ||
    isSolutionPath(path) ||
    isHelpPath(path) ||
    isDeveloperPath(path)
  );
}

export function isAuthPublicPath(pathname: string) {
  return AUTH_PUBLIC_PATHS.some((p) => pathname.startsWith(p));
}

/** Shared document pages (/i/<token>): public, and outside the app shell. */
export function isSharePath(pathname: string) {
  return pathname.startsWith("/i/");
}
