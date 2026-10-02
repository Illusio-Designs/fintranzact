/**
 * Removing a member from an organisation ("the client can remove access at any
 * time"). One flow, store injected so every step is unit-testable.
 *
 * What is revoked:
 *   1. the user's business_members rows in the organisation's businesses
 *      (tenant DB), first, because it is idempotent: if it fails nothing else
 *      has changed and the owner can simply retry;
 *   2. in ONE control-DB transaction: the tenant_members row, the user's
 *      api_keys for this organisation, the invitation rows for their e-mail
 *      (accepted ones deleted, pending ones expired, so an old link cannot
 *      re-add them) and tenantId on their sessions for this organisation;
 *   3. the per-process caches (membership check, 2FA gate, session cache);
 *   4. a `access.removed` security event;
 *   5. a notice e-mail to the removed person (best effort).
 * A person who is not a member is a no-op that still sweeps leftovers (keys,
 * invitations, grants) of this organisation only, so a retry is always safe.
 */
import { TRPCError } from "@trpc/server";
import type { SecurityEventInput } from "./security-events.js";

export const REMOVER_ROLES = ["owner", "superadmin", "admin"] as const;
const PROTECTED_ROLES = ["owner", "superadmin"] as const;

export interface RemovalTarget {
  role: string;
  email: string;
  name: string | null;
}

export interface ControlRevocation {
  membershipRemoved: boolean;
  apiKeysRevoked: number;
  invitationsDeleted: number;
  invitationsExpired: number;
  /** Sessions whose tenantId was cleared (their cache entries must go). */
  sessionIds: string[];
}

export interface RemovalStore {
  /** The target's membership in the organisation, or null. Also yields the e-mail for the notice and invitations. */
  getTarget(tenantId: string, userId: string): Promise<RemovalTarget | null>;
  getUserEmail(userId: string): Promise<string | null>;
  getTenantName(tenantId: string): Promise<string | null>;
  /** Tenant DB: delete the user's business_members rows in this organisation's businesses. Returns how many. */
  revokeBusinessGrants(tenantId: string, userId: string): Promise<number>;
  /** Control DB, ONE transaction (see the module comment). `email` is the target's e-mail for the invitation sweep. */
  revokeControlAccess(tenantId: string, userId: string, email: string | null, now: Date): Promise<ControlRevocation>;
  invalidateCaches(tenantId: string, userId: string, sessionIds: string[]): void;
  recordEvent(event: SecurityEventInput): Promise<void>;
  sendNotice(to: string, subject: string, text: string): Promise<void>;
  log: { error(msg: string, meta?: unknown): void };
  now(): Date;
}

export interface RemovalInput {
  tenantId: string;
  actor: { id: string; role: string | null };
  targetUserId: string;
  ip?: string | null;
  userAgent?: string | null;
}

export interface RemovalResult {
  success: true;
  removed: boolean;
  apiKeysRevoked: number;
  businessesRevoked: number;
  emailSent: boolean;
}

export function removalNoticeText(tenantName: string): { subject: string; text: string } {
  const name = tenantName.replace(/[\r\n]+/g, " ").trim() || "an organisation";
  return {
    subject: `Your access to ${name} was removed`,
    text: [
      `Your access to ${name} on Fintranzact was removed by the organisation.`,
      "",
      "You can no longer open its books, and any API keys you made for it have stopped working.",
      "If you think this is a mistake, please contact the organisation's owner.",
    ].join("\n"),
  };
}

export async function removeTenantMember(input: RemovalInput, store: RemovalStore): Promise<RemovalResult> {
  if (!input.actor.role || !(REMOVER_ROLES as readonly string[]).includes(input.actor.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Only owners and admins can remove members" });
  }
  if (input.targetUserId === input.actor.id) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot remove yourself" });
  }
  const target = await store.getTarget(input.tenantId, input.targetUserId);
  if (target && (PROTECTED_ROLES as readonly string[]).includes(target.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Cannot remove a superadmin" });
  }

  const email = target?.email ?? (await store.getUserEmail(input.targetUserId));

  // 1. Tenant DB first (idempotent): a failure leaves the membership intact for a retry.
  let businessesRevoked: number;
  try {
    businessesRevoked = await store.revokeBusinessGrants(input.tenantId, input.targetUserId);
  } catch (err) {
    store.log.error("Member removal: business access cleanup failed", { tenantId: input.tenantId, userId: input.targetUserId, err: errMsg(err) });
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not remove access. Nothing else was changed, please try again." });
  }

  // 2. Control DB, one transaction.
  const control = await store.revokeControlAccess(input.tenantId, input.targetUserId, email, store.now());

  // 3. Caches on this instance.
  store.invalidateCaches(input.tenantId, input.targetUserId, control.sessionIds);

  const removed = control.membershipRemoved;
  if (!removed && !target) {
    // Not a member: nothing was removed, no event, no e-mail.
    return { success: true, removed: false, apiKeysRevoked: control.apiKeysRevoked, businessesRevoked, emailSent: false };
  }

  // 4. Audit trail (recordSecurityEvent never throws).
  await store.recordEvent({
    type: "access.removed",
    userId: input.targetUserId,
    actorUserId: input.actor.id,
    tenantId: input.tenantId,
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
    metadata: {
      role: target?.role ?? null,
      email,
      apiKeysRevoked: control.apiKeysRevoked,
      businessesRevoked,
      removedBy: input.actor.id,
    },
  });

  // 5. Notice, best effort.
  let emailSent = false;
  if (email) {
    try {
      const tenantName = (await store.getTenantName(input.tenantId)) ?? "";
      const { subject, text } = removalNoticeText(tenantName);
      await store.sendNotice(email, subject, text);
      emailSent = true;
    } catch (err) {
      store.log.error("Member removal: notice email failed", { tenantId: input.tenantId, userId: input.targetUserId, err: errMsg(err) });
    }
  }

  return { success: true, removed, apiKeysRevoked: control.apiKeysRevoked, businessesRevoked, emailSent };
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
