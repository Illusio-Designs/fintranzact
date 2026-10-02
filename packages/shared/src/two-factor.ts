/**
 * Two-factor authentication — constants and the pure rules shared by the API
 * and every client (web, mobile, desktop): organisation policy, lockout
 * escalation, security-event names and the "is 2FA required for this member"
 * decision with its grace period.
 */

// ── Constants ───────────────────────────────────────────────────────────────

export const TWO_FACTOR_POLICIES = ["off", "admins", "all"] as const;
export type TwoFactorPolicy = (typeof TWO_FACTOR_POLICIES)[number];

export const DEFAULT_TWO_FACTOR_GRACE_DAYS = 7;
export const TRUSTED_DEVICE_DAYS = 30;
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const MAX_CHALLENGE_ATTEMPTS = 5;
/** Consecutive wrong codes that trigger a lockout. */
export const LOCKOUT_FAILURE_THRESHOLD = 5;
export const BACKUP_CODE_COUNT = 10;

/** Roles an "admins" policy applies to. */
export const TWO_FACTOR_ADMIN_ROLES = ["owner", "superadmin", "admin"] as const;

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * How long to lock 2FA verification once the failure threshold is hit.
 * `lockoutCount` is the number of lockouts this user has *already* had:
 * first lockout 15 min, second 1 h, third and later 24 h.
 */
export function lockoutDuration(lockoutCount: number): number {
  if (!Number.isFinite(lockoutCount) || lockoutCount <= 0) return 15 * MINUTE_MS;
  if (lockoutCount === 1) return HOUR_MS;
  return 24 * HOUR_MS;
}

// ── Security events ─────────────────────────────────────────────────────────

export const SECURITY_EVENT_TYPES = [
  "2fa.setup_started",
  "2fa.enabled",
  "2fa.disabled",
  "2fa.verified",
  "2fa.failed",
  "2fa.locked",
  "2fa.backup_used",
  "2fa.backup_regenerated",
  "2fa.device_trusted",
  "2fa.device_revoked",
  "2fa.reset_by_admin",
  "2fa.policy_changed",
] as const;
export type SecurityEventType = (typeof SECURITY_EVENT_TYPES)[number];

export const SECURITY_EVENT_LABELS: Record<SecurityEventType, string> = {
  "2fa.setup_started": "Two-factor setup started",
  "2fa.enabled": "Two-factor authentication turned on",
  "2fa.disabled": "Two-factor authentication turned off",
  "2fa.verified": "Signed in with a verification code",
  "2fa.failed": "Wrong verification code",
  "2fa.locked": "Verification locked after repeated wrong codes",
  "2fa.backup_used": "Signed in with a backup code",
  "2fa.backup_regenerated": "Backup codes regenerated",
  "2fa.device_trusted": "Device trusted",
  "2fa.device_revoked": "Trusted device removed",
  "2fa.reset_by_admin": "Two-factor reset by a platform administrator",
  "2fa.policy_changed": "Organisation two-factor policy changed",
};

// ── Enforcement ─────────────────────────────────────────────────────────────

export interface TwoFactorRequirementInput {
  policy: TwoFactorPolicy;
  role: string;
  /** When the policy was switched on (null = unknown; the member's own start date is used). */
  enforcedAt: Date | null;
  graceDays: number;
  /** When the user joined the organisation. */
  memberSince: Date;
  hasTwoFactor: boolean;
  now: Date;
}

export interface TwoFactorRequirement {
  /** The member must have 2FA under this organisation's policy. */
  required: boolean;
  /** Required, not set up, and the grace period is over: access should be blocked. */
  blocked: boolean;
  /** End of the grace period; null when not required. */
  graceEndsAt: Date | null;
}

const DAY_MS = 24 * HOUR_MS;

export function twoFactorRequiredForMember(input: TwoFactorRequirementInput): TwoFactorRequirement {
  const { policy, role, enforcedAt, graceDays, memberSince, hasTwoFactor, now } = input;
  const none: TwoFactorRequirement = { required: false, blocked: false, graceEndsAt: null };

  if (policy === "off") return none;
  if (policy === "admins" && !(TWO_FACTOR_ADMIN_ROLES as readonly string[]).includes(role)) return none;
  if (policy !== "admins" && policy !== "all") return none; // unknown value: fail open, not locked out
  if (hasTwoFactor) return none;

  const start = enforcedAt && enforcedAt.getTime() > memberSince.getTime() ? enforcedAt : memberSince;
  const days = Number.isFinite(graceDays) && graceDays > 0 ? graceDays : 0;
  const graceEndsAt = new Date(start.getTime() + days * DAY_MS);
  return { required: true, blocked: now.getTime() >= graceEndsAt.getTime(), graceEndsAt };
}
