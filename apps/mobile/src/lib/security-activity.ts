import { relativeTime, securityActivityDetail } from "@fintranzact/shared";

export interface ActivityItem {
  id: string;
  type: string;
  label: string;
  createdAt: string;
  ip: string | null;
  device: string | null;
  method: string | null;
}

export interface ActivityRow {
  id: string;
  title: string;
  detail: string;
  when: string;
  /** Wrong codes, lockouts and admin resets deserve a second look. */
  attention: boolean;
}

const ATTENTION_TYPES = new Set(["2fa.failed", "2fa.locked", "2fa.reset_by_admin"]);

/** auth.securityActivity items to display rows (newest first, as the server sends them). */
export function activityRows(items: readonly ActivityItem[], now: number = Date.now()): ActivityRow[] {
  return items.map((e) => ({
    id: e.id,
    title: e.label,
    detail: securityActivityDetail(e),
    when: relativeTime(e.createdAt, now),
    attention: ATTENTION_TYPES.has(e.type),
  }));
}
