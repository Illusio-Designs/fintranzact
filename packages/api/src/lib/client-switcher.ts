/**
 * The client switcher's list (tenant.listClients): the organisations the
 * caller belongs to, ordered pinned first, then most recently opened, then by
 * name, with a search, a scope filter and keyset paging.
 *
 * All pure. The router reads the caller's memberships in ONE join (members x
 * tenants x the caller's prefs) and hands the rows here. Doing the ordering,
 * search and paging in memory is deliberate: an accountant has at most a few
 * hundred organisations, one indexed join is cheap, and a composite keyset
 * ordering with nullable timestamps is easy to get wrong in SQL. The cursor
 * is a keyset (the last item's sort key), not an offset, so a page boundary
 * stays correct if something is pinned or opened between two page loads.
 */
import { isCaRole, memberRoleLabel } from "@fintranzact/shared";

export const CLIENT_SCOPES = ["all", "mine", "clients"] as const;
export type ClientScope = (typeof CLIENT_SCOPES)[number];

export const DEFAULT_CLIENT_PAGE = 30;
export const MAX_CLIENT_PAGE = 100;
/** How many organisations one person can pin. */
export const MAX_PINNED_TENANTS = 20;
/** tenant.select refreshes "last opened" at most this often (one write per click is pointless). */
export const LAST_OPENED_REFRESH_MS = 5 * 60 * 1000;

export interface ClientRow {
  tenantId: string;
  name: string;
  slug: string;
  role: string;
  plan: string;
  pinnedAt: Date | null;
  lastOpenedAt: Date | null;
}

export interface ClientItem {
  tenantId: string;
  name: string;
  slug: string;
  role: string;
  roleLabel: string;
  /** Owner/superadmin: the person's own organisation (their firm). */
  isOwnFirm: boolean;
  /** Not their own: a client's (or a colleague's) organisation. */
  isClient: boolean;
  /** An accountant (CA) access level: show the "CA" tag. */
  isCa: boolean;
  plan: string;
  pinned: boolean;
  lastOpenedAt: Date | null;
}

export interface ClientQuery {
  search?: string | null;
  scope?: ClientScope;
  cursor?: string | null;
  limit?: number | null;
}

export interface ClientPage {
  items: ClientItem[];
  nextCursor: string | null;
  /** Matches of the search/scope (all pages). */
  total: number;
  /** Whole-list counts, ignoring the search and scope: for the "12 clients" line. */
  counts: { all: number; mine: number; clients: number; pinned: number };
}

export const isOwnFirmRole = (role: string): boolean => role === "owner" || role === "superadmin";

export function toClientItem(r: ClientRow): ClientItem {
  const own = isOwnFirmRole(r.role);
  return {
    tenantId: r.tenantId,
    name: r.name,
    slug: r.slug,
    role: r.role,
    roleLabel: memberRoleLabel(r.role),
    isOwnFirm: own,
    isClient: !own,
    isCa: isCaRole(r.role),
    plan: r.plan,
    pinned: r.pinnedAt !== null,
    lastOpenedAt: r.lastOpenedAt,
  };
}

const lower = (s: string) => s.toLowerCase();

/** Total order: pinned first, lastOpenedAt desc (never-opened last), name asc, id asc. */
export function compareClients(a: ClientItem, b: ClientItem): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  const at = a.lastOpenedAt?.getTime() ?? null;
  const bt = b.lastOpenedAt?.getTime() ?? null;
  if (at !== bt) {
    if (at === null) return 1;
    if (bt === null) return -1;
    return bt - at;
  }
  const an = lower(a.name);
  const bn = lower(b.name);
  if (an !== bn) return an < bn ? -1 : 1;
  return a.tenantId < b.tenantId ? -1 : a.tenantId > b.tenantId ? 1 : 0;
}

interface CursorKey {
  p: 0 | 1;
  l: number | null;
  n: string;
  i: string;
}

export function encodeClientCursor(item: ClientItem): string {
  const key: CursorKey = { p: item.pinned ? 1 : 0, l: item.lastOpenedAt?.getTime() ?? null, n: item.name, i: item.tenantId };
  return Buffer.from(JSON.stringify(key)).toString("base64url");
}

/** Null for anything that is not a cursor this module made (the caller then starts from the top). */
export function decodeClientCursor(cursor: string | null | undefined): ClientItem | null {
  if (!cursor) return null;
  try {
    const k = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<CursorKey>;
    if ((k.p !== 0 && k.p !== 1) || typeof k.n !== "string" || typeof k.i !== "string") return null;
    if (k.l !== null && typeof k.l !== "number") return null;
    return {
      tenantId: k.i, name: k.n, slug: "", role: "", roleLabel: "", isOwnFirm: false, isClient: false, isCa: false, plan: "",
      pinned: k.p === 1, lastOpenedAt: k.l === null || k.l === undefined ? null : new Date(k.l),
    };
  } catch {
    return null;
  }
}

export function clampClientLimit(limit: number | null | undefined): number {
  if (!limit || !Number.isFinite(limit)) return DEFAULT_CLIENT_PAGE;
  return Math.min(MAX_CLIENT_PAGE, Math.max(1, Math.floor(limit)));
}

/** Literal, case-insensitive substring match over the name (no wildcard characters: "%" and "_" mean themselves). */
export function matchesSearch(name: string, search: string | null | undefined): boolean {
  const q = (search ?? "").trim();
  if (!q) return true;
  return lower(name).includes(lower(q));
}

export function orderAndPageClients(rows: readonly ClientRow[], q: ClientQuery = {}): ClientPage {
  const all = rows.map(toClientItem).sort(compareClients);
  const counts = {
    all: all.length,
    mine: all.filter((c) => c.isOwnFirm).length,
    clients: all.filter((c) => c.isClient).length,
    pinned: all.filter((c) => c.pinned).length,
  };
  const scope = q.scope ?? "all";
  const filtered = all.filter((c) =>
    (scope === "all" || (scope === "mine" ? c.isOwnFirm : c.isClient)) && matchesSearch(c.name, q.search));
  const limit = clampClientLimit(q.limit);
  const after = decodeClientCursor(q.cursor);
  // Keyset: everything strictly after the cursor's position in the total order.
  let start = 0;
  if (after) {
    start = filtered.findIndex((c) => compareClients(c, after) > 0);
    if (start === -1) start = filtered.length;
  }
  const items = filtered.slice(start, start + limit);
  const hasMore = start + limit < filtered.length;
  return { items, nextCursor: hasMore && items.length > 0 ? encodeClientCursor(items[items.length - 1]!) : null, total: filtered.length, counts };
}

// ── last opened ─────────────────────────────────────────────────────────────

/** True when "last opened" should be rewritten: never recorded, or older than the refresh window. */
export function shouldTouchLastOpened(previous: Date | null | undefined, now: Date, windowMs = LAST_OPENED_REFRESH_MS): boolean {
  if (!previous) return true;
  return now.getTime() - previous.getTime() >= windowMs;
}

/** The cutoff the upsert compares against: rows older than this are refreshed. */
export function lastOpenedCutoff(now: Date, windowMs = LAST_OPENED_REFRESH_MS): Date {
  return new Date(now.getTime() - windowMs);
}

// ── pinning ─────────────────────────────────────────────────────────────────

export type PinDecision = "ok" | "noop" | "limit";

/** Pinning past the limit is refused; pinning what is pinned (or unpinning what is not) is a no-op. */
export function decidePin(opts: { pinned: boolean; alreadyPinned: boolean; pinnedCount: number; max?: number }): PinDecision {
  if (opts.pinned === opts.alreadyPinned) return "noop";
  if (opts.pinned && opts.pinnedCount >= (opts.max ?? MAX_PINNED_TENANTS)) return "limit";
  return "ok";
}
