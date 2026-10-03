/**
 * Platform-admin two-factor reset, after identity checks.
 *
 * Persistence and side effects are injected (ResetDeps) so the rules are unit
 * testable without a database. Production wiring is `drizzleResetStore` below
 * and routers/platform.ts.
 *
 * Rules: an admin never resets their own 2FA; the admin types the target's
 * email; the verification record (method, at least two checks, reason) is
 * validated by the same pure function the web form uses. Everything about the
 * user's 2FA goes in one transaction; then every session is revoked, the gate
 * cache is dropped, the event is recorded and the user is emailed. An email
 * failure never undoes the reset.
 *
 * No extra grace state is needed afterwards: a user blocked by an organisation
 * policy can still reach auth.* (including enrolment) and tenant.current, so
 * they sign in with the password alone and set 2FA up again from Settings.
 */

import { TRPCError } from "@trpc/server";
import {
  RESET_IDENTITY_CHECKS,
  RESET_VERIFICATION_METHODS,
  resetEmailConfirmed,
  validateResetVerification,
} from "@fintranzact/shared";
import type { SecurityEventInput } from "./security-events.js";

export interface ResetVerification {
  method: (typeof RESET_VERIFICATION_METHODS)[number];
  checks: string[];
  reference?: string;
  reason: string;
}

export interface ResetTarget {
  id: string;
  email: string;
  name: string | null;
  twoFactorEnabled: boolean;
}

export interface ResetStore {
  getTarget(userId: string): Promise<ResetTarget | null>;
  /** One transaction: secret, backup codes, trusted devices, pending challenges, users flag. */
  clearTwoFactor(userId: string, now: Date): Promise<void>;
}

export interface ResetDeps {
  store: ResetStore;
  /** Revokes ALL the user's sessions. */
  revokeAllSessions(userId: string): Promise<unknown>;
  invalidateGate(userId: string): void;
  record(event: SecurityEventInput): Promise<void>;
  sendNotice(to: string, subject: string, text: string): Promise<void>;
  log: { error(msg: string, meta?: unknown): void };
  now(): Date;
}

export interface ResetInput {
  userId: string;
  tenantId?: string;
  confirmEmail: string;
  verification: ResetVerification;
}

export type ResetResult =
  | { reset: true; emailSent: boolean; message: string }
  | { reset: false; message: string };

export const RESET_NOTICE_SUBJECT = "Two-factor authentication was reset on your Fintranzact account";

export function resetNoticeText(args: { name: string | null; at: Date }): string {
  return [
    `Hi ${args.name?.trim() || "there"},`,
    "",
    `Fintranzact platform support reset two-factor authentication on your account on ${args.at.toUTCString()}, after checking your identity.`,
    "",
    "What this means:",
    "- You were signed out everywhere.",
    "- Devices you had marked as trusted were forgotten.",
    "- Your old authenticator app entry and backup codes no longer work.",
    "",
    "Sign in with your password, then set up two-factor authentication again in Settings, Account, Security.",
    "",
    "If you did not ask for this, contact Fintranzact support straight away and change your password.",
    "",
    "The Fintranzact team",
  ].join("\n");
}

export async function resetTwoFactorByAdmin(
  deps: ResetDeps,
  args: { adminUserId: string; input: ResetInput; ip?: string | null; userAgent?: string | null },
): Promise<ResetResult> {
  const { adminUserId, input } = args;
  if (input.userId === adminUserId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "You cannot reset your own two-factor authentication. Ask another platform admin.",
    });
  }
  const problems = validateResetVerification(input.verification);
  if (problems.length > 0) throw new TRPCError({ code: "BAD_REQUEST", message: problems.join(" ") });

  const target = await deps.store.getTarget(input.userId);
  if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
  if (!resetEmailConfirmed(input.confirmEmail, target.email)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "The email you typed does not match this user." });
  }
  if (!target.twoFactorEnabled) {
    return { reset: false, message: "This user does not have two-factor authentication turned on. Nothing was changed." };
  }

  const now = deps.now();
  await deps.store.clearTwoFactor(target.id, now);
  deps.invalidateGate(target.id);
  const checks = [...new Set(input.verification.checks.filter((c) => (RESET_IDENTITY_CHECKS as readonly string[]).includes(c)))];
  await deps.record({
    type: "2fa.reset_by_admin",
    userId: target.id,
    actorUserId: adminUserId,
    tenantId: input.tenantId ?? null,
    ip: args.ip ?? null,
    userAgent: args.userAgent ?? null,
    metadata: {
      method: input.verification.method,
      checks,
      reference: input.verification.reference?.trim() || null,
      reason: input.verification.reason.trim(),
      ip: args.ip ?? null,
    },
  });
  // Every session, the admin's own is not the target's so nothing is kept.
  await deps.revokeAllSessions(target.id);

  let emailSent = true;
  try {
    await deps.sendNotice(target.email, RESET_NOTICE_SUBJECT, resetNoticeText({ name: target.name, at: now }));
  } catch (err) {
    emailSent = false;
    deps.log.error("2FA reset notice email failed", { userId: target.id, err: err instanceof Error ? err.message : String(err) });
  }
  return {
    reset: true,
    emailSent,
    message: emailSent
      ? "Two-factor authentication was reset. The user was signed out everywhere and emailed."
      : "Two-factor authentication was reset and the user was signed out everywhere, but the notice email could not be sent.",
  };
}
