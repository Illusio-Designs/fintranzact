import Constants from "expo-constants";
import { BILLING_UPGRADE_PATH } from "@fintranzact/shared";

export function getApiUrl(): string {
  // Read process.env via a local variable so the babel-preset-expo
  // inline-env-vars plugin does not bake EXPO_PUBLIC_API_URL into the bundle
  // as a compile-time constant.  The plugin only substitutes direct
  // `process.env.EXPO_PUBLIC_*` member-expression patterns; accessing through
  // an intermediate reference keeps the read dynamic.
  //
  // Why this matters for tests: babel-preset-expo inlines EXPO_PUBLIC_ vars
  // when the caller lacks `isDev: true`.  Jest runs with NODE_ENV='test', so
  // inlining would be enabled, causing per-test process.env mutations to have
  // no effect.  Using an intermediary reference avoids the pattern match.
  const env = process.env as Record<string, string | undefined>;

  // Priority 1: app.json / eas.json `extra.apiUrl` (set at EAS build time)
  // Priority 2: EXPO_PUBLIC_API_URL env var (set in .env or CI pipeline)
  // Priority 3: hardcoded production fallback
  const envUrl =
    (Constants.expoConfig?.extra?.apiUrl as string | undefined) ||
    env["EXPO_PUBLIC_API_URL"];
  if (envUrl) return envUrl;

  // Production default — the URL every Play Store / App Store user hits.
  // Changing this value is a production-impacting deployment decision.
  const globalEnv = typeof globalThis !== "undefined" ? (globalThis as any).importMeta?.env : undefined;
  return process.env.EXPO_PUBLIC_API_URL ?? globalEnv?.API_URL ?? "https://api.fintranzact.com";
}

/**
 * Origin of the web app, where billing is managed (the mobile app has no
 * billing screens). Priority: app.json `extra.webUrl`, EXPO_PUBLIC_WEB_URL,
 * the API origin with its `api.` host swapped for `app.`, then production.
 */
export function getWebUrl(): string {
  const env = process.env as Record<string, string | undefined>;
  const explicit = (Constants.expoConfig?.extra?.webUrl as string | undefined) || env["EXPO_PUBLIC_WEB_URL"];
  if (explicit) return explicit.replace(/\/+$/, "");
  const api = getApiUrl();
  if (/^https?:\/\/api\./.test(api)) return api.replace("://api.", "://app.").replace(/\/+$/, "");
  return "https://app.fintranzact.com";
}

/** Where an owner picks or changes a plan. */
export function getBillingUrl(): string {
  return `${getWebUrl()}${BILLING_UPGRADE_PATH}`;
}
