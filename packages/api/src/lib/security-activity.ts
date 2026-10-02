/**
 * Security activity views. Rows come from the control `security_events` table;
 * what leaves the API is a fixed, safe subset (never raw metadata for users).
 */

import { SECURITY_EVENT_LABELS, type SecurityEventType } from "@fintranzact/shared";
import { deviceLabel } from "./two-factor-login.js";

export const DEFAULT_ACTIVITY_LIMIT = 20;
export const MAX_ACTIVITY_LIMIT = 100;
export const ADMIN_EVENTS_DEFAULT_LIMIT = 50;

export function clampLimit(limit: number | undefined, fallback = DEFAULT_ACTIVITY_LIMIT, max = MAX_ACTIVITY_LIMIT): number {
  if (limit === undefined || !Number.isFinite(limit)) return fallback;
  return Math.min(max, Math.max(1, Math.floor(limit)));
}

export interface SecurityEventRow {
  id: string;
  userId: string | null;
  actorUserId: string | null;
  tenantId: string | null;
  type: string;
  ip: string | null;
  userAgent: string | null;
  metadata: unknown;
  createdAt: Date;
}

export function eventLabel(type: string): string {
  return (SECURITY_EVENT_LABELS as Record<string, string>)[type] ?? type;
}

/** `method` from metadata when it is a plain short string (totp, trusted_device, ...). */
function methodOf(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const m = (metadata as Record<string, unknown>).method;
  return typeof m === "string" && m.length <= 40 ? m : null;
}

export interface OwnActivityItem {
  id: string;
  type: SecurityEventType | string;
  label: string;
  createdAt: string;
  ip: string | null;
  device: string | null;
  method: string | null;
}

/** The caller's own view: type, label, time, ip, device summary, method. Nothing else. */
export function toOwnActivity(row: SecurityEventRow): OwnActivityItem {
  return {
    id: row.id,
    type: row.type,
    label: eventLabel(row.type),
    createdAt: row.createdAt.toISOString(),
    ip: row.ip,
    device: row.userAgent ? deviceLabel(row.userAgent) : null,
    method: methodOf(row.metadata),
  };
}

export interface ActivityStore {
  /** Newest first, only this user's events. */
  listForUser(userId: string, limit: number): Promise<SecurityEventRow[]>;
}

export async function ownSecurityActivity(store: ActivityStore, userId: string, limit?: number): Promise<OwnActivityItem[]> {
  const rows = await store.listForUser(userId, clampLimit(limit));
  return rows.map(toOwnActivity);
}
