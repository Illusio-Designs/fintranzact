/**
 * two-factor.ts — enrolment, disable, backup-code regeneration and the shared
 * second-factor verifier (reused by the sign-in challenge).
 *
 * All persistence goes through the injected TwoFactorStore and all side effects
 * through TwoFactorDeps, so the logic is unit-testable without a database. The
 * real wiring lives in lib/two-factor-store.ts and routers/auth.ts.
 *
 * Error codes: wrong code -> BAD_REQUEST (never UNAUTHORIZED: web clients
 * redirect to sign-in on UNAUTHORIZED); locked -> TOO_MANY_REQUESTS;
 * organisation requires 2FA -> FORBIDDEN.
 */

import { TRPCError } from "@trpc/server";
import QRCode from "qrcode";
import {
  BACKUP_CODE_COUNT,
  twoFactorRequiredForMember,
  type TwoFactorPolicy,
} from "@fintranzact/shared";
import { generateSecret, otpauthUri, verifyTotp } from "./totp.js";
import { generateBackupCodes, hashBackupCode } from "./two-factor-codes.js";
import { decryptTotpSecret, encryptTotpSecret } from "./field-encryption.js";
import type { SecurityEventInput } from "./security-events.js";

export const TWO_FACTOR_ISSUER = "Fintranzact";

// ── Data layer ──────────────────────────────────────────────────────────────

export interface TwoFactorRecord {
  userId: string;
  secretEnc: string;
  /** Null while setup is pending. */
  confirmedAt: Date | null;
  lastUsedStep: number | null;
  failedCount: number;
  lockedUntil: Date | null;
  lockoutCount: number;
  createdAt: Date;
}

export interface UserAuthRecord {
  email: string;
  passwordHash: string | null;
  twoFactorEnabled: boolean;
}

export interface MembershipPolicy {
  tenantId: string;
  role: string;
  policy: string;
  enforcedAt: Date | null;
  graceDays: number;
  memberSince: Date;
}

export interface FailureOutcome {
  /** This failure tripped a lockout. */
  locked: boolean;
  lockedUntil: Date | null;
}

export interface TwoFactorStore {
  getRecord(userId: string): Promise<TwoFactorRecord | null>;
  getUserAuth(userId: string): Promise<UserAuthRecord | null>;
  /** Insert or replace a PENDING secret. Returns false (and changes nothing) if a confirmed row exists. */
  upsertPendingSecret(userId: string, secretEnc: string): Promise<boolean>;
  /** Atomic replay guard: set last_used_step only if it is null or lower. True when this call won. */
  advanceStep(userId: string, step: number): Promise<boolean>;
  /** failed_count++; at the threshold, lock for lockoutDuration(lockout_count) and escalate. One statement. */
  recordFailure(userId: string, now: Date): Promise<FailureOutcome>;
  /** Reset failed_count, lockout_count and locked_until. */
  recordSuccess(userId: string): Promise<void>;
  /** Atomic single use: true only for the one caller that flips used_at. */
  consumeBackupCode(userId: string, codeHash: string): Promise<boolean>;
  countUnusedBackupCodes(userId: string): Promise<number>;
  /** One transaction: confirm the pending row, set the flag, store the backup-code hashes. False if not pending. */
  completeEnrolment(userId: string, input: { step: number; codeHashes: string[]; now: Date }): Promise<boolean>;
  /** One transaction: delete every code, insert the new hashes. */
  replaceBackupCodes(userId: string, codeHashes: string[]): Promise<void>;
  /** One transaction: delete secret + codes, revoke trusted devices, clear the flag. (Enrolment also revokes devices: a new secret never inherits trust.) */
  disable(userId: string, now: Date): Promise<void>;
  membershipPolicies(userId: string): Promise<MembershipPolicy[]>;
  countTrustedDevices(userId: string, now: Date): Promise<number>;
}

export interface EventContext {
  ip?: string | null;
  userAgent?: string | null;
}

export interface TwoFactorDeps {
  store: TwoFactorStore;
  record(event: SecurityEventInput): Promise<void>;
  /** Revoke the user's other sessions (keepSessionId survives). */
  rotateSessions(userId: string, keepSessionId?: string): Promise<unknown>;
  /**
   * Counts wrong passwords typed into disable / regenerate. Keyed
   * `2fa-password:<userId>` and SEPARATE from the sign-in limiter: a session
   * holder who lacks the password must not be able to lock the real user out
   * of signing in.
   */
  passwordLimiter: {
    isBlocked(key: string): boolean;
    recordFailure(key: string): void;
  };
  verifyPassword(hash: string, password: string): Promise<boolean>;
  renderQr(uri: string): Promise<string>;
  now(): number;
}

// ── Verification ────────────────────────────────────────────────────────────

export type VerifyReason = "locked" | "not_enrolled" | "no_pending_setup" | "already_enabled" | "invalid";

export interface VerifyResult {
  ok: boolean;
  method: "totp" | "backup_code" | null;
  reason: VerifyReason | null;
  /** The matched TOTP step (setup mode, for the enrolment transaction). */
  step: number | null;
  lockedUntil: Date | null;
}

export interface VerifyOptions {
  allowBackup: boolean;
  /** Verify against the pending (unconfirmed) secret; no replay-advance, no 2fa.verified event. */
  setup?: boolean;
  purpose?: string;
  event?: EventContext;
}

const SIX_DIGITS = /^\d{6}$/;

function fail(reason: VerifyReason, lockedUntil: Date | null = null): VerifyResult {
  return { ok: false, method: null, reason, step: null, lockedUntil };
}

/**
 * Check a second factor for a user: lockout, TOTP (replay-guarded) or single-use
 * backup code, failure accounting and security events. `code` is auto-detected:
 * six digits is TOTP, anything else is a backup code (when allowed).
 */
export async function verifySecondFactor(
  deps: TwoFactorDeps,
  userId: string,
  code: string,
  opts: VerifyOptions,
): Promise<VerifyResult> {
  const { store } = deps;
  const now = new Date(deps.now());
  const rec = await store.getRecord(userId);
  const setup = opts.setup === true;

  if (!rec) return fail(setup ? "no_pending_setup" : "not_enrolled");
  if (setup && rec.confirmedAt) return fail("already_enabled");
  if (!setup && !rec.confirmedAt) return fail("not_enrolled");
  if (rec.lockedUntil && rec.lockedUntil.getTime() > now.getTime()) return fail("locked", rec.lockedUntil);

  const text = String(code ?? "").replace(/\s+/g, "");
  const eventBase = { userId, ip: opts.event?.ip ?? null, userAgent: opts.event?.userAgent ?? null };
  const purpose = opts.purpose ?? (setup ? "setup" : "verify");

  let method: "totp" | "backup_code" | null = null;
  let step: number | null = null;

  if (SIX_DIGITS.test(text)) {
    const secret = decryptTotpSecret(rec.secretEnc); // throws (fail closed) without the key
    const res = verifyTotp(secret, text, { now: now.getTime(), window: 1, lastUsedStep: rec.lastUsedStep });
    if (res.ok && res.step !== null) {
      // Setup mode stores the step inside the enrolment transaction instead.
      if (setup || (await store.advanceStep(userId, res.step))) {
        method = "totp";
        step = res.step;
      }
    }
  } else if (opts.allowBackup && !setup && text.length > 0) {
    if (await store.consumeBackupCode(userId, hashBackupCode(userId, text))) method = "backup_code";
  }

  if (method) {
    await store.recordSuccess(userId);
    if (!setup) {
      await deps.record({
        ...eventBase,
        type: method === "totp" ? "2fa.verified" : "2fa.backup_used",
        metadata: { method, purpose },
      });
    }
    return { ok: true, method, reason: null, step, lockedUntil: null };
  }

  const outcome = await store.recordFailure(userId, now);
  await deps.record({ ...eventBase, type: "2fa.failed", metadata: { purpose } });
  if (outcome.locked) {
    await deps.record({
      ...eventBase,
      type: "2fa.locked",
      metadata: { purpose, lockedUntil: outcome.lockedUntil?.toISOString() ?? null },
    });
    return fail("locked", outcome.lockedUntil);
  }
  return fail("invalid");
}

export function lockedError(until: Date | null, nowMs: number): TRPCError {
  const minutes = until ? Math.max(1, Math.ceil((until.getTime() - nowMs) / 60_000)) : null;
  return new TRPCError({
    code: "TOO_MANY_REQUESTS",
    message: until
      ? `Too many wrong codes. Try again in ${minutes} minute${minutes === 1 ? "" : "s"} (after ${until.toISOString()}).`
      : "Too many wrong codes. Please try again later.",
  });
}

const WRONG_SETUP_CODE =
  "That code is not right. Check the 6-digit code in your authenticator app (it changes every 30 seconds) and try again.";
const WRONG_PASSWORD_OR_CODE = "The password or code you entered is not right.";

/** Turn a failed verification into the TRPCError the API promises. */
export function throwForFailure(deps: TwoFactorDeps, r: VerifyResult, wrongMessage: string): never {
  switch (r.reason) {
    case "locked":
      throw lockedError(r.lockedUntil, deps.now());
    case "not_enrolled":
      throw new TRPCError({ code: "BAD_REQUEST", message: "Two-factor authentication is not turned on." });
    case "no_pending_setup":
      throw new TRPCError({ code: "BAD_REQUEST", message: "Start two-factor setup first." });
    case "already_enabled":
      throw new TRPCError({ code: "BAD_REQUEST", message: "Two-factor authentication is already on." });
    default:
      throw new TRPCError({ code: "BAD_REQUEST", message: wrongMessage });
  }
}

// ── Status ──────────────────────────────────────────────────────────────────

export interface TwoFactorStatus {
  enabled: boolean;
  pendingSetup: boolean;
  backupCodesRemaining: number;
  lockedUntil: Date | null;
  trustedDeviceCount: number;
  createdAt: Date | null;
}

export async function getTwoFactorStatus(deps: TwoFactorDeps, userId: string): Promise<TwoFactorStatus> {
  const now = new Date(deps.now());
  const [rec, auth] = await Promise.all([deps.store.getRecord(userId), deps.store.getUserAuth(userId)]);
  const enabled = !!rec?.confirmedAt && auth?.twoFactorEnabled === true;
  const [backupCodesRemaining, trustedDeviceCount] = enabled
    ? await Promise.all([deps.store.countUnusedBackupCodes(userId), deps.store.countTrustedDevices(userId, now)])
    : [0, 0];
  return {
    enabled,
    pendingSetup: !!rec && !rec.confirmedAt,
    backupCodesRemaining,
    lockedUntil: rec?.lockedUntil && rec.lockedUntil.getTime() > now.getTime() ? rec.lockedUntil : null,
    trustedDeviceCount,
    createdAt: rec?.createdAt ?? null,
  };
}

// ── Setup ───────────────────────────────────────────────────────────────────

/** The base32 secret in groups of four, for typing into an authenticator app. */
export function formatManualKey(secret: string): string {
  return secret.replace(/(.{4})(?=.)/g, "$1 ");
}

export interface BeginSetupResult {
  otpauthUri: string;
  qrDataUrl: string;
  manualKey: string;
  accountName: string;
  issuer: string;
}

export async function beginTwoFactorSetup(
  deps: TwoFactorDeps,
  user: { id: string; email: string },
  event: EventContext = {},
): Promise<BeginSetupResult> {
  const auth = await deps.store.getUserAuth(user.id);
  if (auth?.twoFactorEnabled) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Two-factor authentication is already on." });
  }
  const secret = generateSecret();
  const stored = await deps.store.upsertPendingSecret(user.id, encryptTotpSecret(secret));
  if (!stored) throw new TRPCError({ code: "BAD_REQUEST", message: "Two-factor authentication is already on." });

  const uri = otpauthUri({ secret, accountName: user.email, issuer: TWO_FACTOR_ISSUER });
  const qrDataUrl = await deps.renderQr(uri);
  await deps.record({ userId: user.id, type: "2fa.setup_started", ip: event.ip, userAgent: event.userAgent });
  return {
    otpauthUri: uri,
    qrDataUrl,
    manualKey: formatManualKey(secret),
    accountName: user.email,
    issuer: TWO_FACTOR_ISSUER,
  };
}

/** PNG data URL of the QR code for an otpauth URI. */
export function renderQrDataUrl(uri: string): Promise<string> {
  return QRCode.toDataURL(uri, { errorCorrectionLevel: "M", margin: 1, width: 240 });
}

export async function confirmTwoFactorSetup(
  deps: TwoFactorDeps,
  userId: string,
  code: string,
  opts: { currentSessionId?: string | null; event?: EventContext } = {},
): Promise<{ backupCodes: string[] }> {
  const r = await verifySecondFactor(deps, userId, code, { allowBackup: false, setup: true, purpose: "setup", event: opts.event });
  if (!r.ok || r.step === null) throwForFailure(deps, r, WRONG_SETUP_CODE);

  const backupCodes = generateBackupCodes(BACKUP_CODE_COUNT);
  const done = await deps.store.completeEnrolment(userId, {
    step: r.step,
    codeHashes: backupCodes.map((c) => hashBackupCode(userId, c)),
    now: new Date(deps.now()),
  });
  if (!done) throw new TRPCError({ code: "BAD_REQUEST", message: "Start two-factor setup first." });

  await deps.rotateSessions(userId, opts.currentSessionId ?? undefined);
  await deps.record({ userId, type: "2fa.enabled", ip: opts.event?.ip, userAgent: opts.event?.userAgent });
  return { backupCodes };
}

// ── Disable and regenerate ──────────────────────────────────────────────────

/** Organisations whose policy requires 2FA for this user (grace period ignored: turning it off is never allowed). */
export async function organisationsRequiringTwoFactor(deps: TwoFactorDeps, userId: string): Promise<string[]> {
  const now = new Date(deps.now());
  const memberships = await deps.store.membershipPolicies(userId);
  return memberships
    .filter(
      (m) =>
        twoFactorRequiredForMember({
          policy: m.policy as TwoFactorPolicy,
          role: m.role,
          enforcedAt: m.enforcedAt,
          graceDays: m.graceDays,
          memberSince: m.memberSince,
          hasTwoFactor: false,
          now,
        }).required,
    )
    .map((m) => m.tenantId);
}

/** Limiter key for password re-checks on the security screens (never the sign-in key). */
export function passwordLimiterKey(userId: string): string {
  return `2fa-password:${userId}`;
}

/** Re-check the account password through its own per-user limiter (5 per 15 minutes). Accounts with no password skip it. */
async function requirePassword(deps: TwoFactorDeps, userId: string, auth: UserAuthRecord, password: string): Promise<void> {
  if (!auth.passwordHash) return;
  const key = passwordLimiterKey(userId);
  if (deps.passwordLimiter.isBlocked(key)) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many wrong passwords. Please try again later." });
  }
  const ok = await deps.verifyPassword(auth.passwordHash, password);
  if (!ok) {
    deps.passwordLimiter.recordFailure(key);
    throw new TRPCError({ code: "BAD_REQUEST", message: WRONG_PASSWORD_OR_CODE });
  }
}

async function requireEnabled(deps: TwoFactorDeps, userId: string): Promise<UserAuthRecord> {
  const auth = await deps.store.getUserAuth(userId);
  if (!auth || !auth.twoFactorEnabled) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Two-factor authentication is not turned on." });
  }
  return auth;
}

export async function disableTwoFactor(
  deps: TwoFactorDeps,
  userId: string,
  input: { password: string; code: string },
  opts: { currentSessionId?: string | null; event?: EventContext } = {},
): Promise<{ success: true }> {
  const auth = await requireEnabled(deps, userId);

  if ((await organisationsRequiringTwoFactor(deps, userId)).length > 0) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Your organisation requires two-factor authentication. Ask an owner of the organisation to relax the policy first.",
    });
  }

  await requirePassword(deps, userId, auth, input.password);
  const r = await verifySecondFactor(deps, userId, input.code, { allowBackup: true, purpose: "disable", event: opts.event });
  if (!r.ok) throwForFailure(deps, r, WRONG_PASSWORD_OR_CODE);

  await deps.store.disable(userId, new Date(deps.now()));
  await deps.rotateSessions(userId, opts.currentSessionId ?? undefined);
  await deps.record({ userId, type: "2fa.disabled", ip: opts.event?.ip, userAgent: opts.event?.userAgent });
  return { success: true };
}

export async function regenerateBackupCodes(
  deps: TwoFactorDeps,
  userId: string,
  input: { password: string; code: string },
  opts: { event?: EventContext } = {},
): Promise<{ backupCodes: string[] }> {
  const auth = await requireEnabled(deps, userId);
  await requirePassword(deps, userId, auth, input.password);
  // A backup code is refused here so a stolen one cannot mint a fresh set.
  const r = await verifySecondFactor(deps, userId, input.code, { allowBackup: false, purpose: "regenerate_backup_codes", event: opts.event });
  if (!r.ok) throwForFailure(deps, r, WRONG_PASSWORD_OR_CODE);

  const backupCodes = generateBackupCodes(BACKUP_CODE_COUNT);
  await deps.store.replaceBackupCodes(userId, backupCodes.map((c) => hashBackupCode(userId, c)));
  await deps.record({ userId, type: "2fa.backup_regenerated", ip: opts.event?.ip, userAgent: opts.event?.userAgent });
  return { backupCodes };
}
