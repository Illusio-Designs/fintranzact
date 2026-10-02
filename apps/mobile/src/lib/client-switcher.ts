import { groupClientSections, type ClientListItem } from "@fintranzact/shared";

/** Up to this many organisations the sheet stays a plain list (no search, no section headers). */
export const SIMPLE_LIST_MAX = 5;

export type SwitcherRow =
  | { kind: "header"; key: string; title: string }
  | { kind: "org"; key: string; org: ClientListItem };

/**
 * The sheet's rows. A few organisations: one flat list in the API's order.
 * Many (or a search is active): Pinned / Recent / My firm / Clients with a
 * header row before each section (no Recent while searching).
 */
export function switcherRows(items: readonly ClientListItem[], opts: { total: number; searching: boolean }): SwitcherRow[] {
  if (opts.total <= SIMPLE_LIST_MAX && !opts.searching) {
    return items.map((org) => ({ kind: "org", key: org.tenantId, org }));
  }
  const rows: SwitcherRow[] = [];
  for (const s of groupClientSections(items, { showRecent: !opts.searching })) {
    rows.push({ kind: "header", key: `h:${s.key}`, title: s.title });
    for (const org of s.items) rows.push({ kind: "org", key: `${s.key}:${org.tenantId}`, org });
  }
  return rows;
}

/** Search box only once the list is long enough to need it (or a search is already typed). */
export function showSearch(total: number, query: string): boolean {
  return total > SIMPLE_LIST_MAX || query.trim().length > 0;
}

/**
 * After leaving the organisation that was open, the session has none selected
 * and mobile has no start-up picker, so pick the next one to open: the person's
 * own firm if they have one, otherwise the first in the list's order (pinned,
 * then most recent). Null when nothing is left.
 */
export function nextOrgAfterLeaving(items: readonly ClientListItem[], leftTenantId: string): ClientListItem | null {
  const rest = items.filter((o) => o.tenantId !== leftTenantId);
  return rest.find((o) => o.isOwnFirm) ?? rest[0] ?? null;
}

