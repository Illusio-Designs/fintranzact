/**
 * The origin shown in the code samples: API_URL when the build sets one,
 * otherwise this site (which forwards /api to the API server), and the
 * production API as a last resort outside the browser.
 */
export const API_BASE_URL = (
  (import.meta.env.API_URL as string | undefined) ||
  (typeof window !== "undefined" ? window.location.origin : "https://fintranzact-production.up.railway.app")
).replace(/\/$/, "");
