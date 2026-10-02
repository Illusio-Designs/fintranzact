/**
 * The access log viewer (`tenant.accessLog`): pure helpers for paging,
 * cursors, the owner/admin gate and the safe shape that leaves the API.
 * Rows come from the control `security_events` table (type `access.*`).
 */

import { SECURITY_EVENT_LABELS, type AccessLogItem, type AccessLogMetadata, type AccessLogPerson } from "@fintranzact/shared";

export const ACCESS_LOG_DEFAULT_LIMIT = 25;
export const ACCESS_LOG_MAX_LIMIT = 100;

/** Same inline gate as the other Team admin screens (pending invitations, 2FA status). */
const ACCESS_LOG_ROLES = ["owner", "superadmin", "admin"];
export function canViewAccessLog(role: string | null | undefined): boolean {
  return !!role && ACCESS_LOG_ROLES.includes(role);
}

export function clampAccessLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return ACCESS_LOG_DEFAULT_LIMIT;
  return Math.min(ACCESS_LOG_MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

export interface AccessCursor {
  /** createdAt in whole milliseconds. */
  ms: number;
  id: string;
}

const CURSOR_RE = /^(\d{1,15})_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export function encodeAccessCursor(row: { createdAt: Date; id: string }): string {
  return `${row.createdAt.getTime()}_${row.id}`;
}

export function decodeAccessCursor(cursor: string | undefined | null): AccessCursor | null {
  if (!cursor) return null;
  const m = CURSOR_RE.exec(cursor);
  if (!m) return null;
  return { ms: Number(m[1]), id: m[2]!.toLowerCase() };
}

export interface AccessEventRow {
  id: string;
  userId: string | null;
  actorUserId: string | null;
  type: string;
  metadata: unknown;
  createdAt: Date;
}

export interface AccessUserRow {
  id: string;
  name: string | null;
  email: string | null;
}

const SAFE_KEYS = ["role", "from", "to", "email", "procedure"] as const;

/** Only the five short string fields the log shows; anything else in the row's metadata never leaves. */
export function safeAccessMetadata(metadata: unknown): AccessLogMetadata {
  const out: AccessLogMetadata = {};
  if (!metadata || typeof metadata !== "object") return out;
  const src = metadata as Record<string, unknown>;
  for (const k of SAFE_KEYS) {
    const v = src[k];
    if (typeof v === "string" && v.length <= 200) out[k] = v;
  }
  return out;
}

function person(id: string | null, users: Map<string, AccessUserRow>): AccessLogPerson | null {
  if (!id) return null;
  const u = users.get(id);
  return u ? { id: u.id, name: u.name ?? null, email: u.email ?? null } : null;
}

export function toAccessLogItem(row: AccessEventRow, users: Map<string, AccessUserRow>): AccessLogItem {
  return {
    id: row.id,
    type: row.type,
    label: (SECURITY_EVENT_LABELS as Record<string, string>)[row.type] ?? row.type,
    createdAt: row.createdAt.toISOString(),
    actor: person(row.actorUserId, users),
    subject: person(row.userId, users),
    metadata: safeAccessMetadata(row.metadata),
  };
}

/** Rows fetched with `limit + 1`: trim to `limit` and hand back the cursor of the last kept row when more exist. */
export function pageAccessRows<T extends { createdAt: Date; id: string }>(rows: T[], limit: number): { rows: T[]; nextCursor: string | null } {
  if (rows.length <= limit) return { rows, nextCursor: null };
  const kept = rows.slice(0, limit);
  return { rows: kept, nextCursor: encodeAccessCursor(kept[kept.length - 1]!) };
}

/** User ids an access-log page refers to (actors and subjects), for one lookup. */
export function accessUserIds(rows: AccessEventRow[]): string[] {
  const ids = new Set<string>();
  for (const r of rows) {
    if (r.userId) ids.add(r.userId);
    if (r.actorUserId) ids.add(r.actorUserId);
  }
  return [...ids];
}
