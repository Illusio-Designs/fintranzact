/**
 * Pure helpers for organisation-enforced two-factor authentication on the web:
 * where a blocked user may still go, how the setup link maps to Settings, the
 * policy wording and the Team tab summary. The server is the enforcement
 * (packages/api/src/lib/two-factor-gate.ts); this only guides the user.
 */
import { TWO_FACTOR_ADMIN_ROLES, TWO_FACTOR_SETUP_PATH, type TwoFactorPolicy } from "@fintranzact/shared";

/** Pages a blocked user may stay on so they can set 2FA up, sign out or read public pages. */
const EXEMPT_PREFIXES = [
  "/settings",
  "/auth",
  "/login",
  "/register",
  "/pricing",
  "/invite",
  "/help",
  "/about",
  "/contact",
  "/privacy",
  "/terms",
  "/refund-policy",
  // Not organisation-scoped: their calls never pass the organisation gate.
  "/platform",
  "/partner-portal",
] as const;

export function isTwoFactorExemptPath(pathname: string): boolean {
  return EXEMPT_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** True when a blocked user on `pathname` should be sent to the Security tab. */
export function shouldRedirectToTwoFactorSetup(blocked: boolean, pathname: string): boolean {
  return blocked && !isTwoFactorExemptPath(pathname);
}

/** `/settings?tab=account&pane=security` -> the router search params. */
export function setupSearch(setupPath: string | undefined): { tab: string; pane: string } {
  try {
    const url = new URL(setupPath || TWO_FACTOR_SETUP_PATH, "http://local");
    return { tab: url.searchParams.get("tab") ?? "account", pane: url.searchParams.get("pane") ?? "security" };
  } catch {
    return { tab: "account", pane: "security" };
  }
}

/** Largest grace period the API accepts. */
export const MAX_GRACE_DAYS_UI = 30;

export const POLICY_OPTIONS: Array<{ value: TwoFactorPolicy; label: string; hint: string }> = [
  { value: "off", label: "Off", hint: "Two-factor authentication is optional." },
  { value: "admins", label: "Owners and admins", hint: "Owners, superadmins and admins must use it." },
  { value: "all", label: "Everyone", hint: "Every member must use it." },
];

export function policyLabel(policy: string | undefined | null): string {
  return POLICY_OPTIONS.find((o) => o.value === policy)?.label ?? "Off";
}

/** The confirmation text shown before a policy is saved. */
export function describePolicyChange(policy: TwoFactorPolicy, graceDays: number): string {
  if (policy === "off") {
    return "Two-factor authentication becomes optional again. Nobody is blocked, and members who have already set it up keep it.";
  }
  const who = policy === "all" ? "Every member" : "Every owner, superadmin and admin";
  const when =
    graceDays === 0
      ? "Anyone who has not set it up will be blocked straight away until they do."
      : `Anyone who has not set it up has ${graceDays} day${graceDays === 1 ? "" : "s"} from now, then is blocked until they do.`;
  return `${who} must use two-factor authentication. ${when} API keys are not affected.`;
}

export interface MemberTwoFactorSummary {
  total: number;
  /** Covered by the policy and not set up (only meaningful when twoFactorEnabled is known). */
  missing: number;
}


/** "N of M members still need to set up", for members the policy covers. */
export function summariseMembers(
  members: Array<{ role: string; twoFactorEnabled?: boolean }>,
  policy: string | undefined | null,
): MemberTwoFactorSummary {
  // With the policy off nobody is "required"; count everyone so owners still see adoption.
  const covered = policy === "off" || !policy ? members : members.filter((m) => policyCoversRole(policy, m.role));
  return { total: covered.length, missing: covered.filter((m) => m.twoFactorEnabled === false).length };
}

/** Does the organisation's policy cover a member with this role? (off and unknown: no) */
export function policyCoversRole(policy: string | undefined | null, role: string | undefined | null): boolean {
  if (policy === "all") return true;
  if (policy === "admins") return (TWO_FACTOR_ADMIN_ROLES as readonly string[]).includes(role ?? "");
  return false;
}
