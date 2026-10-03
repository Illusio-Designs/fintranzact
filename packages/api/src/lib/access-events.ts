/**
 * The access log: who was invited, who accepted, role changes, removals, when a
 * CA opened the books and what they downloaded. Lifecycle events go to the
 * control `security_events` table (type `access.*`, never retention-limited);
 * what a CA changes or files goes to the business audit log (lib/audit.ts).
 *
 * This file holds the pure parts (event builders, the throttle, the CA-role
 * check) so they can be unit-tested; the small recorders at the bottom are the
 * only code that touches the database, through `recordSecurityEvent`, which
 * never throws.
 */

import { isCaRole } from "@fintranzact/shared";
import { recordSecurityEvent, type SecurityEventInput } from "./security-events.js";

export type AccessEventKind =
  | "invited"
  | "invite_revoked"
  | "accepted"
  | "role_changed"
  | "org_opened"
  | "export"
  | "partner_attributed";

interface Who {
  /** The signed-in person who did it. */
  actorId: string;
  tenantId: string;
  ip?: string | null;
  userAgent?: string | null;
}

export type AccessEventParams =
  | (Who & { kind: "invited"; role: string; email: string; inviteeUserId?: string | null })
  | (Who & { kind: "invite_revoked"; role: string; email: string })
  | (Who & { kind: "accepted"; role: string })
  | (Who & { kind: "role_changed"; from: string; to: string; email: string; targetUserId: string })
  | (Who & { kind: "org_opened"; role: string })
  | (Who & { kind: "export"; procedure: string; role: string })
  | (Who & { kind: "partner_attributed"; role: string; partnerName: string });

/**
 * Build a `security_events` row for an access event. Metadata is a fixed,
 * small shape (role, email, from, to, procedure): never tokens, invite URLs,
 * codes or inputs.
 */
export function buildAccessEvent(p: AccessEventParams): SecurityEventInput {
  const base = { actorUserId: p.actorId, tenantId: p.tenantId, ip: p.ip ?? null, userAgent: p.userAgent ?? null };
  switch (p.kind) {
    case "invited":
      // Subject: the invitee when they already have an account, otherwise nobody yet.
      return { ...base, type: "access.invited", userId: p.inviteeUserId ?? null, metadata: { role: p.role, email: p.email } };
    case "invite_revoked":
      return { ...base, type: "access.invite_revoked", userId: null, metadata: { role: p.role, email: p.email } };
    case "accepted":
      return { ...base, type: "access.accepted", userId: p.actorId, metadata: { role: p.role } };
    case "role_changed":
      return { ...base, type: "access.role_changed", userId: p.targetUserId, metadata: { from: p.from, to: p.to, email: p.email } };
    case "org_opened":
      return { ...base, type: "access.org_opened", userId: p.actorId, metadata: { role: p.role } };
    case "export":
      return { ...base, type: "access.export", userId: p.actorId, metadata: { procedure: p.procedure, role: p.role } };
    case "partner_attributed":
      // The CA accepting is the subject; the partner is named by company, never by contact details.
      return { ...base, type: "access.partner_attributed", userId: p.actorId, metadata: { role: p.role, partnerName: p.partnerName } };
  }
}

export async function recordAccessEvent(p: AccessEventParams): Promise<void> {
  await recordSecurityEvent(buildAccessEvent(p));
}

// ── Opened the organisation: throttled ──────────────────────────────────────

export const ORG_OPENED_WINDOW_MS = 60 * 60 * 1000;
const THROTTLE_MAX_ENTRIES = 5_000;

/** (user, tenant) -> last time an `access.org_opened` was written by THIS process. */
export type OpenedThrottle = Map<string, number>;
const processThrottle: OpenedThrottle = new Map();

/**
 * True when an `org_opened` event should be written for this (user, tenant)
 * now, and marks it written. At most once per hour. The clock is injected.
 * In-process only: with several API instances a CA can produce one row per
 * instance per hour, which is fine for "when did they last open the books".
 */
export function shouldRecordOrgOpened(
  throttle: OpenedThrottle,
  userId: string,
  tenantId: string,
  now: number,
  windowMs = ORG_OPENED_WINDOW_MS,
): boolean {
  const key = `${tenantId}:${userId}`;
  const last = throttle.get(key);
  if (last !== undefined && now - last < windowMs) return false;
  if (throttle.size >= THROTTLE_MAX_ENTRIES) {
    for (const [k, t] of throttle) if (now - t >= windowMs) throttle.delete(k);
    if (throttle.size >= THROTTLE_MAX_ENTRIES) throttle.clear();
  }
  throttle.set(key, now);
  return true;
}

/** Test hook. */
export function resetOrgOpenedThrottle(): void {
  processThrottle.clear();
}

interface RequestLike {
  headers?: { get?: (name: string) => string | null } | null;
}

export interface AccessCtx {
  user: { id: string } | null;
  tenantId?: string | null;
  role?: string | null;
  ipAddress?: string | null;
  req?: RequestLike | null;
}

function userAgentOf(ctx: AccessCtx): string | null {
  try {
    return ctx.req?.headers?.get?.("user-agent") ?? null;
  } catch {
    return null;
  }
}

/** Record that a CA opened the organisation (CA roles only, once an hour per user and organisation). */
export async function recordOrgOpened(
  ctx: AccessCtx,
  role: string | null | undefined = ctx.role,
  now: number = Date.now(),
  throttle: OpenedThrottle = processThrottle,
): Promise<boolean> {
  if (!isCaRole(role) || !ctx.user || !ctx.tenantId) return false;
  if (!shouldRecordOrgOpened(throttle, ctx.user.id, ctx.tenantId, now)) return false;
  await recordAccessEvent({
    kind: "org_opened",
    actorId: ctx.user.id,
    tenantId: ctx.tenantId,
    role,
    ip: ctx.ipAddress ?? null,
    userAgent: userAgentOf(ctx),
  });
  return true;
}

// ── Downloads by a CA ───────────────────────────────────────────────────────

/**
 * Record that a CA (auditor / ca_filing) downloaded a file-producing report.
 * Called by the download procedures; does nothing for every other role, so the
 * owner's own exports are not logged. Never throws.
 */
export async function recordCaExport(ctx: AccessCtx, path: string): Promise<boolean> {
  const role = ctx.role;
  if (!isCaRole(role) || !ctx.user || !ctx.tenantId) return false;
  await recordAccessEvent({
    kind: "export",
    actorId: ctx.user.id,
    tenantId: ctx.tenantId,
    procedure: path,
    role,
    ip: ctx.ipAddress ?? null,
    userAgent: userAgentOf(ctx),
  });
  return true;
}
