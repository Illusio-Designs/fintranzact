/**
 * The client switcher's display logic, shared by web and mobile: which section
 * each organisation sits in (Pinned, Recent, My firm, Clients), merging "Load
 * more" pages, and the status line. The API (tenant.listClients) orders the
 * list; this only groups it.
 */

/** One organisation as tenant.listClients returns it (dates may arrive as Date or ISO string). */
export interface ClientListItem {
  tenantId: string;
  name: string;
  slug: string;
  role: string;
  roleLabel: string;
  isOwnFirm: boolean;
  isClient: boolean;
  isCa: boolean;
  plan: string;
  pinned: boolean;
  lastOpenedAt: string | Date | null;
}

export const CLIENT_RECENT_COUNT = 5;

export type ClientSectionKey = "pinned" | "recent" | "firm" | "clients";

export const CLIENT_SECTION_TITLES: Record<ClientSectionKey, string> = {
  pinned: "Pinned",
  recent: "Recent",
  firm: "My firm",
  clients: "Clients",
};

export interface ClientSection {
  key: ClientSectionKey;
  title: string;
  items: ClientListItem[];
}

const time = (v: string | Date | null): number => (v ? new Date(v).getTime() : 0);

/**
 * Groups an already ordered list into sections, each organisation once:
 * pinned first; then (when `showRecent`, i.e. no search is active) the
 * CLIENT_RECENT_COUNT most recently opened of the rest; then the person's own
 * firm(s); then everything else. Empty sections are left out.
 */
export function groupClientSections(items: readonly ClientListItem[], opts: { showRecent?: boolean } = {}): ClientSection[] {
  const pinned = items.filter((c) => c.pinned);
  const rest = items.filter((c) => !c.pinned);
  const recent = opts.showRecent === false
    ? []
    : rest.filter((c) => c.lastOpenedAt).sort((a, b) => time(b.lastOpenedAt) - time(a.lastOpenedAt)).slice(0, CLIENT_RECENT_COUNT);
  const recentIds = new Set(recent.map((c) => c.tenantId));
  const others = rest.filter((c) => !recentIds.has(c.tenantId));
  const sections: ClientSection[] = [
    { key: "pinned", title: CLIENT_SECTION_TITLES.pinned, items: pinned },
    { key: "recent", title: CLIENT_SECTION_TITLES.recent, items: recent },
    { key: "firm", title: CLIENT_SECTION_TITLES.firm, items: others.filter((c) => c.isOwnFirm) },
    { key: "clients", title: CLIENT_SECTION_TITLES.clients, items: others.filter((c) => !c.isOwnFirm) },
  ];
  return sections.filter((s) => s.items.length > 0);
}

/** The sections' items in display order (what the arrow keys walk through). */
export function flattenClientSections(sections: readonly ClientSection[]): ClientListItem[] {
  return sections.flatMap((s) => s.items);
}

/** Appends a "Load more" page, dropping organisations already shown. */
export function mergeClientPages(prev: readonly ClientListItem[], next: readonly ClientListItem[]): ClientListItem[] {
  const seen = new Set(prev.map((c) => c.tenantId));
  return [...prev, ...next.filter((c) => !seen.has(c.tenantId))];
}

/** "12 clients" / "1 client" for the switcher's count line. */
export function clientCountText(count: number): string {
  return `${count} ${count === 1 ? "client" : "clients"}`;
}

/** The warning shown before leaving a client, naming the organisation. */
export function leaveClientWarning(name: string): { title: string; description: string; confirmLabel: string } {
  return {
    title: `Leave ${name}?`,
    description: "Your access ends immediately: you can no longer open its books and your API keys for it stop working. The owner is notified. To come back, the owner must invite you again.",
    confirmLabel: "Leave this client",
  };
}
