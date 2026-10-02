/**
 * The access log shown to organisation owners and admins (Team tab, mobile
 * Team screen): which events it holds, the filter groups, and the one-line
 * sentence for each event. Shared so web and mobile read identically.
 */

import { memberRoleLabel, isCaRole } from "./accountant-access.js";

export const ACCESS_EVENT_TYPES = [
  "access.invited",
  "access.invite_revoked",
  "access.accepted",
  "access.role_changed",
  "access.removed",
  "access.left",
  "access.org_opened",
  "access.export",
] as const;
export type AccessEventType = (typeof ACCESS_EVENT_TYPES)[number];

export const ACCESS_LOG_FILTERS: ReadonlyArray<{ key: string; label: string; types: readonly AccessEventType[] | null }> = [
  { key: "all", label: "All", types: null },
  { key: "invites", label: "Invites", types: ["access.invited", "access.invite_revoked", "access.accepted"] },
  { key: "roles", label: "Role changes", types: ["access.role_changed"] },
  { key: "removals", label: "Removals", types: ["access.removed", "access.left"] },
  { key: "opened", label: "Opened", types: ["access.org_opened"] },
  { key: "downloads", label: "Downloads", types: ["access.export"] },
];

/** Plain names for the download procedures a CA's export is logged under. */
export const EXPORT_PROCEDURE_LABELS: Record<string, string> = {
  "gst.gstr1Json": "GSTR-1 JSON",
  "gst.gstr1CSV": "GSTR-1 CSV",
  "gst.gstr9Json": "GSTR-9 JSON",
  "gst.gstr4Json": "GSTR-4 JSON",
  "party.ledgerReportCSV": "a party ledger CSV",
  "party.tallyExport": "the Tally CSV export",
  "reports.tallyExport": "the Tally XML export",
  "tds.certificate": "a TDS certificate",
};

export function exportLabel(procedure: string | undefined | null): string {
  if (!procedure) return "a file";
  return EXPORT_PROCEDURE_LABELS[procedure] ?? procedure;
}

export interface AccessLogPerson {
  id: string;
  name: string | null;
  email: string | null;
}

export interface AccessLogMetadata {
  role?: string;
  from?: string;
  to?: string;
  email?: string;
  procedure?: string;
}

export interface AccessLogItem {
  id: string;
  type: string;
  label: string;
  createdAt: string;
  actor: AccessLogPerson | null;
  subject: AccessLogPerson | null;
  metadata: AccessLogMetadata;
}

const personName = (p: AccessLogPerson | null | undefined): string | null => (p ? p.name || p.email || null : null);

/** "You" for the viewer, otherwise the person's name or e-mail ("Someone" when unknown). */
export function accessActorName(item: Pick<AccessLogItem, "actor">, viewerId?: string | null): string {
  if (item.actor && viewerId && item.actor.id === viewerId) return "You";
  return personName(item.actor) ?? "Someone";
}

function subjectName(item: AccessLogItem, viewerId?: string | null, withTag = true): string {
  if (item.subject && viewerId && item.subject.id === viewerId) return "You";
  const name = personName(item.subject) ?? item.metadata.email ?? "Someone";
  const role = item.metadata.role ?? item.metadata.to;
  return withTag && isCaRole(role) ? `${name} (CA)` : name;
}

/** One sentence per event: "Anita Shah (CA) was invited as Accountant (read-only) by You". */
export function accessEventSentence(item: AccessLogItem, viewerId?: string | null): string {
  const actor = accessActorName(item, viewerId);
  const m = item.metadata;
  switch (item.type) {
    case "access.invited":
      return `${subjectName(item, viewerId)} was invited as ${m.role ? memberRoleLabel(m.role) : "a member"} by ${actor}`;
    case "access.invite_revoked":
      return `The invitation to ${m.email ?? "a member"}${m.role ? ` (${memberRoleLabel(m.role)})` : ""} was withdrawn by ${actor}`;
    case "access.accepted":
      return `${actor} accepted the invitation${m.role ? ` as ${memberRoleLabel(m.role)}` : ""}`;
    case "access.role_changed":
      return `${subjectName(item, viewerId, false)}'s access changed from ${m.from ? memberRoleLabel(m.from) : "unknown"} to ${m.to ? memberRoleLabel(m.to) : "unknown"} by ${actor}`;
    case "access.removed":
      return `Access removed for ${subjectName(item, viewerId)} by ${actor}`;
    case "access.left":
      return `${subjectName(item, viewerId)} left the organisation`;
    case "access.org_opened":
      return `${actor}${isCaRole(m.role) ? " (CA)" : ""} opened this organisation`;
    case "access.export":
      return `${actor}${isCaRole(m.role) ? " (CA)" : ""} downloaded ${exportLabel(m.procedure)}`;
    default:
      return item.label;
  }
}

/** "Last opened 3 hours ago" / "Never opened" for a CA member row. */
export function lastOpenedText(lastOpenedAt: string | Date | null | undefined, relative: (d: Date) => string): string {
  if (!lastOpenedAt) return "Never opened";
  return `Last opened ${relative(new Date(lastOpenedAt))}`;
}
