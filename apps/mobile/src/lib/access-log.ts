import { accessEventSentence, lastOpenedText, relativeTime, type AccessLogItem } from "@fintranzact/shared";

export interface AccessLogRow {
  id: string;
  text: string;
  when: string;
  /** Ionicons name. */
  icon: string;
  /** Removals deserve a second look. */
  attention: boolean;
}

const ICONS: Record<string, string> = {
  "access.invited": "mail-outline",
  "access.invite_revoked": "close-circle-outline",
  "access.accepted": "checkmark-circle-outline",
  "access.role_changed": "swap-horizontal-outline",
  "access.removed": "person-remove-outline",
  "access.left": "exit-outline",
  "access.org_opened": "log-in-outline",
  "access.export": "download-outline",
  "access.partner_attributed": "ribbon-outline",
};

/** tenant.accessLog items to display rows (newest first, as the server sends them). */
export function accessLogRows(items: readonly AccessLogItem[], viewerId?: string | null, now: number = Date.now()): AccessLogRow[] {
  return items.map((e) => ({
    id: e.id,
    text: accessEventSentence(e, viewerId),
    when: relativeTime(e.createdAt, now),
    icon: ICONS[e.type] ?? "ellipse-outline",
    attention: e.type === "access.removed",
  }));
}

/** "Last opened 3h ago" / "Never opened" for a CA member row; null for everyone else or when the API hid it. */
export function caLastOpened(
  member: { role: string; lastOpenedAt?: string | Date | null },
  isCa: (role: string) => boolean,
  now: number = Date.now(),
): string | null {
  if (!isCa(member.role)) return null;
  return lastOpenedText(member.lastOpenedAt ?? null, (d) => relativeTime(d.toISOString(), now));
}
