/**
 * Plan / entitlement errors.
 *
 * The API refuses writes for read-only organisations (trial ended, payment
 * failed, plan ended), plan-limit and add-on refusals, and suspended
 * organisations with a tRPC FORBIDDEN carrying `error.data.entitlement`.
 * That is NOT a permissions problem, so it must not be reported as
 * "Permission denied". The CLI cannot depend on @fintranzact/shared (it is
 * published standalone), so the tiny pure parse is replicated here; keep the
 * reasons in sync with packages/shared/src/entitlements.ts.
 */

export const ENTITLEMENT_REASONS = [
  "read_only_halted",
  "read_only_trial_expired",
  "read_only_subscription_ended",
  "plan_limit",
  "addon_required",
  "tenant_suspended",
] as const;

export type EntitlementReason = (typeof ENTITLEMENT_REASONS)[number];

export const BILLING_UPGRADE_PATH = "/settings?tab=billing";

export interface EntitlementInfo {
  reason: EntitlementReason;
  upgradePath: string;
  addon?: string;
}

/** Reads `error.data.entitlement` from a tRPC error object; null for every other error. */
export function parseEntitlement(raw: unknown): EntitlementInfo | null {
  const ent = (raw as { data?: { entitlement?: Record<string, unknown> } } | null)?.data?.entitlement;
  if (!ent || typeof ent["reason"] !== "string") return null;
  const reason = ent["reason"] as EntitlementReason;
  if (!ENTITLEMENT_REASONS.includes(reason)) return null;
  return {
    reason,
    upgradePath: typeof ent["upgradePath"] === "string" ? (ent["upgradePath"] as string) : BILLING_UPGRADE_PATH,
    addon: typeof ent["addon"] === "string" ? (ent["addon"] as string) : undefined,
  };
}

/**
 * Origin of the web app, where billing is managed. Order: explicit
 * FINTRANZACT_WEB_URL, the API origin with `api.` swapped for `app.`, then production.
 */
export function resolveWebUrl(apiUrl?: string, env: Record<string, string | undefined> = process.env): string {
  const explicit = env["FINTRANZACT_WEB_URL"];
  if (explicit) return explicit.replace(/\/+$/, "");
  if (apiUrl && /^https?:\/\/api\./.test(apiUrl)) {
    return apiUrl.replace("://api.", "://app.").replace(/\/+$/, "");
  }
  return "https://app.fintranzact.com";
}

export function buildBillingUrl(info: EntitlementInfo, apiUrl?: string, env?: Record<string, string | undefined>): string {
  const path = info.upgradePath.startsWith("/") ? info.upgradePath : `/${info.upgradePath}`;
  return `${resolveWebUrl(apiUrl, env)}${path}`;
}

export interface PlanRequiredError {
  code: "plan_required";
  reason: string;
  message: string;
  upgradeUrl: string;
}

/** Human text: the server message, then where to fix it. */
export function formatPlanRequired(err: PlanRequiredError): string {
  if (err.reason === "tenant_suspended") {
    return `${err.message}\nThis organisation is suspended. Contact support to restore access.`;
  }
  return `${err.message}\nChoose a plan (organisation owner): ${err.upgradeUrl}`;
}

/** JSON-mode body. */
export function planRequiredJson(err: PlanRequiredError): { error: { code: "plan_required"; reason: string; message: string; upgradeUrl: string } } {
  return { error: { code: "plan_required", reason: err.reason, message: err.message, upgradeUrl: err.upgradeUrl } };
}

// ── Two-factor required ─────────────────────────────────────────────────────
// An organisation that requires two-factor authentication refuses a session
// that has not set it up (FORBIDDEN with `error.data.twoFactor`). API keys
// never are, so the way out here is an API key or the web/mobile app. Keep in
// sync with packages/shared/src/two-factor.ts.

export const TWO_FACTOR_REQUIRED_REASON = "two_factor_setup_required";

export const TWO_FACTOR_REQUIRED_MESSAGE =
  "Your organisation requires two-factor authentication. Turn it on in the web or mobile app (Settings → Account → Security) or use an API key.";

export interface TwoFactorRequiredError {
  code: "two_factor_required";
  message: string;
}

/** True when a tRPC error object carries `data.twoFactor.required` with the stable reason. */
export function parseTwoFactorRequired(raw: unknown): boolean {
  const tf = (raw as { data?: { twoFactor?: { required?: unknown; reason?: unknown } } } | null)?.data?.twoFactor;
  return !!tf && tf.required === true && tf.reason === TWO_FACTOR_REQUIRED_REASON;
}

export function formatTwoFactorRequired(): string {
  return TWO_FACTOR_REQUIRED_MESSAGE;
}
