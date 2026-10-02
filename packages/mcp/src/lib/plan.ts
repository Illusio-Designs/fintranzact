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

const READ_ONLY_REASONS = ["read_only_halted", "read_only_trial_expired", "read_only_subscription_ended"];

/**
 * Agent-readable text. Says plainly that this is a plan problem, not a
 * permissions one, what still works, and who can fix it.
 */
export function formatPlanRequired(err: PlanRequiredError): string {
  if (err.reason === "tenant_suspended") {
    return `Organisation suspended: ${err.message} Nothing can be done from this tool; ask the organisation owner to contact Fintranzact support.`;
  }
  if (READ_ONLY_REASONS.includes(err.reason)) {
    const why =
      err.reason === "read_only_trial_expired"
        ? "trial ended"
        : err.reason === "read_only_halted"
          ? "payment failed"
          : "plan ended";
    return (
      `This organisation is read-only (${why}). Creating and editing are refused until a plan is chosen. ` +
      `Reads, search and exports still work. ${err.message} ` +
      `Ask the organisation owner to choose a plan: ${err.upgradeUrl}`
    );
  }
  if (err.reason === "addon_required") {
    return `This needs an add-on that the organisation does not have. ${err.message} Ask the organisation owner to add it: ${err.upgradeUrl}`;
  }
  return `The organisation's plan limit has been reached. ${err.message} Ask the organisation owner to upgrade: ${err.upgradeUrl}`;
}
