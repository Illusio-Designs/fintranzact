import { describe, it, expect } from "vitest";
import {
  orderAndPageClients, compareClients, toClientItem, decodeClientCursor, encodeClientCursor, clampClientLimit, matchesSearch,
  shouldTouchLastOpened, lastOpenedCutoff, decidePin, DEFAULT_CLIENT_PAGE, MAX_CLIENT_PAGE, MAX_PINNED_TENANTS, LAST_OPENED_REFRESH_MS,
  type ClientRow,
} from "../lib/client-switcher.js";

let n = 0;
const row = (name: string, over: Partial<ClientRow> = {}): ClientRow => ({
  tenantId: `00000000-0000-0000-0000-${String(++n).padStart(12, "0")}`,
  name, slug: name.toLowerCase().replace(/\W+/g, "-"), role: "auditor", plan: "growth", pinnedAt: null, lastOpenedAt: null, ...over,
});
const d = (iso: string) => new Date(iso);
const names = (rows: ClientRow[], q = {}) => orderAndPageClients(rows, q).items.map((i) => i.name);

describe("toClientItem", () => {
  it("labels roles, flags own firm vs client and the CA tag", () => {
    const own = toClientItem(row("My Firm", { role: "owner" }));
    expect(own).toMatchObject({ roleLabel: "Owner", isOwnFirm: true, isClient: false, isCa: false, pinned: false });
    const ca = toClientItem(row("Acme", { role: "auditor", pinnedAt: d("2026-01-01") }));
    expect(ca).toMatchObject({ roleLabel: "Accountant (read-only)", isOwnFirm: false, isClient: true, isCa: true, pinned: true });
    expect(toClientItem(row("X", { role: "ca_filing" })).roleLabel).toBe("Accountant (filing)");
    expect(toClientItem(row("Y", { role: "superadmin" })).isOwnFirm).toBe(true);
    const seller = toClientItem(row("Z", { role: "seller" }));
    expect(seller).toMatchObject({ isClient: true, isCa: false });
  });
});

describe("ordering", () => {
  it("pinned first, then most recently opened, never-opened last, then name", () => {
    const rows = [
      row("Delta"),
      row("Alpha"),
      row("Opened old", { lastOpenedAt: d("2026-01-01") }),
      row("Opened new", { lastOpenedAt: d("2026-09-01") }),
      row("Pinned never", { pinnedAt: d("2026-02-01") }),
      row("Pinned opened", { pinnedAt: d("2026-02-01"), lastOpenedAt: d("2026-08-01") }),
    ];
    expect(names(rows)).toEqual(["Pinned opened", "Pinned never", "Opened new", "Opened old", "Alpha", "Delta"]);
  });

  it("name order is case-insensitive and ties break on id, so the order is total", () => {
    const a = row("bravo");
    const b = row("Alpha");
    const c = row("Alpha");
    const sorted = orderAndPageClients([a, b, c]).items;
    expect(sorted.map((i) => i.name)).toEqual(["Alpha", "Alpha", "bravo"]);
    expect(sorted[0]!.tenantId < sorted[1]!.tenantId).toBe(true);
    expect(compareClients(toClientItem(b), toClientItem(b))).toBe(0);
  });

  it("does not depend on the input order", () => {
    const rows = [row("C", { lastOpenedAt: d("2026-03-01") }), row("A"), row("B", { lastOpenedAt: d("2026-04-01") }), row("D", { pinnedAt: d("2026-01-01") })];
    expect(names([...rows].reverse())).toEqual(names(rows));
  });
});

describe("search", () => {
  const rows = [row("Acme Traders"), row("acme exports"), row("Bharat 100% Pvt"), row("Bharat_A Co"), row("Zen Foods")];
  it("is a case-insensitive substring over the name", () => {
    expect(names(rows, { search: "ACME" })).toEqual(["acme exports", "Acme Traders"]);
    expect(names(rows, { search: "foods" })).toEqual(["Zen Foods"]);
    expect(names(rows, { search: "  traders " })).toEqual(["Acme Traders"]);
  });
  it("blank search matches everything", () => {
    expect(names(rows, { search: "   " })).toHaveLength(5);
    expect(names(rows, { search: "" })).toHaveLength(5);
    expect(names(rows, { search: null })).toHaveLength(5);
  });
  it("treats % _ and \\ literally, never as wildcards", () => {
    expect(names(rows, { search: "%" })).toEqual(["Bharat 100% Pvt"]);
    expect(names(rows, { search: "_" })).toEqual(["Bharat_A Co"]);
    expect(names(rows, { search: "a_c" })).toEqual([]);
    expect(names(rows, { search: "\\" })).toEqual([]);
    expect(names(rows, { search: ".*" })).toEqual([]);
    expect(matchesSearch("a%b", "a%b")).toBe(true);
  });
  it("total counts matches, whole-list counts ignore the search", () => {
    const p = orderAndPageClients(rows, { search: "acme" });
    expect(p.total).toBe(2);
    expect(p.counts.all).toBe(5);
  });
});

describe("scope and counts", () => {
  const rows = [row("My firm", { role: "owner" }), row("Second firm", { role: "superadmin" }), row("Client A", { role: "auditor" }), row("Client B", { role: "ca_filing", pinnedAt: d("2026-01-01") }), row("Team org", { role: "admin" })];
  it("mine = own firms, clients = everything else, all = both", () => {
    expect(names(rows, { scope: "mine" })).toEqual(["My firm", "Second firm"]);
    expect(names(rows, { scope: "clients" })).toEqual(["Client B", "Client A", "Team org"]);
    expect(names(rows, { scope: "all" })).toHaveLength(5);
    expect(names(rows)).toHaveLength(5);
  });
  it("counts are independent of scope", () => {
    expect(orderAndPageClients(rows, { scope: "mine" }).counts).toEqual({ all: 5, mine: 2, clients: 3, pinned: 1 });
  });
  it("search and scope combine", () => {
    expect(names(rows, { scope: "clients", search: "client a" })).toEqual(["Client A"]);
    expect(names(rows, { scope: "mine", search: "client" })).toEqual([]);
  });
  it("empty input", () => {
    expect(orderAndPageClients([])).toEqual({ items: [], nextCursor: null, total: 0, counts: { all: 0, mine: 0, clients: 0, pinned: 0 } });
  });
});

describe("paging", () => {
  const many = Array.from({ length: 25 }, (_, i) => row(`Client ${String(i).padStart(2, "0")}`, i % 7 === 0 ? { pinnedAt: d("2026-01-01") } : i % 3 === 0 ? { lastOpenedAt: new Date(Date.UTC(2026, 0, 1 + i)) } : {}));
  it("walks every item exactly once in order", () => {
    const expected = orderAndPageClients(many, { limit: 100 }).items.map((i) => i.tenantId);
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const p = orderAndPageClients(many, { limit: 4, cursor });
      seen.push(...p.items.map((i) => i.tenantId));
      expect(p.total).toBe(25);
      cursor = p.nextCursor ?? undefined;
      pages++;
    } while (cursor);
    expect(seen).toEqual(expected);
    expect(pages).toBe(7);
  });
  it("the last page has no cursor, an exact multiple does not produce an empty extra page", () => {
    const p = orderAndPageClients(many.slice(0, 8), { limit: 4 });
    expect(p.nextCursor).not.toBeNull();
    expect(orderAndPageClients(many.slice(0, 8), { limit: 4, cursor: p.nextCursor! }).nextCursor).toBeNull();
    expect(orderAndPageClients(many.slice(0, 4), { limit: 4 }).nextCursor).toBeNull();
  });
  it("paging respects the search", () => {
    const p1 = orderAndPageClients(many, { search: "client 1", limit: 3 });
    expect(p1.total).toBe(10);
    const all = [...p1.items];
    let c = p1.nextCursor;
    while (c) { const p = orderAndPageClients(many, { search: "client 1", limit: 3, cursor: c }); all.push(...p.items); c = p.nextCursor; }
    expect(all).toHaveLength(10);
    expect(all.every((i) => i.name.startsWith("Client 1"))).toBe(true);
  });
  it("a cursor stays valid when the list changes between pages (a pin moves an item already seen)", () => {
    const p1 = orderAndPageClients(many, { limit: 5 });
    const seen = new Set(p1.items.map((i) => i.tenantId));
    // Pin the last item: it jumps to the front, so it is not served again after the cursor.
    const last = many.find((r) => r.name === "Client 24")!;
    const changed = many.map((r) => (r === last ? { ...r, pinnedAt: d("2026-05-05") } : r));
    const p2 = orderAndPageClients(changed, { limit: 100, cursor: p1.nextCursor! });
    expect(p2.items.some((i) => seen.has(i.tenantId))).toBe(false);
  });
  it("a bad cursor starts from the top; limit is clamped", () => {
    expect(orderAndPageClients(many, { cursor: "not-base64-json!!", limit: 2 }).items).toHaveLength(2);
    expect(decodeClientCursor("%%%")).toBeNull();
    expect(decodeClientCursor(Buffer.from(JSON.stringify({ p: 3 })).toString("base64url"))).toBeNull();
    expect(clampClientLimit(undefined)).toBe(DEFAULT_CLIENT_PAGE);
    expect(clampClientLimit(0)).toBe(DEFAULT_CLIENT_PAGE);
    expect(clampClientLimit(5000)).toBe(MAX_CLIENT_PAGE);
    expect(clampClientLimit(2.9)).toBe(2);
    expect(orderAndPageClients(many).items).toHaveLength(DEFAULT_CLIENT_PAGE > 25 ? 25 : DEFAULT_CLIENT_PAGE);
  });
  it("cursor round-trips including null lastOpenedAt", () => {
    const it = toClientItem(row("Q"));
    const back = decodeClientCursor(encodeClientCursor(it))!;
    expect(back.lastOpenedAt).toBeNull();
    expect(compareClients(back, it)).toBe(0);
    const opened = toClientItem(row("Q2", { lastOpenedAt: d("2026-06-06T10:00:00Z"), pinnedAt: d("2026-01-01") }));
    expect(compareClients(decodeClientCursor(encodeClientCursor(opened))!, opened)).toBe(0);
  });
});

describe("last opened throttle", () => {
  const now = d("2026-10-02T12:00:00Z");
  it("writes when never recorded or older than 5 minutes", () => {
    expect(shouldTouchLastOpened(null, now)).toBe(true);
    expect(shouldTouchLastOpened(undefined, now)).toBe(true);
    expect(shouldTouchLastOpened(new Date(now.getTime() - LAST_OPENED_REFRESH_MS), now)).toBe(true);
    expect(shouldTouchLastOpened(new Date(now.getTime() - LAST_OPENED_REFRESH_MS + 1), now)).toBe(false);
    expect(shouldTouchLastOpened(new Date(now.getTime() - 1000), now)).toBe(false);
  });
  it("the SQL cutoff is the same boundary", () => {
    expect(lastOpenedCutoff(now).getTime()).toBe(now.getTime() - 5 * 60 * 1000);
  });
});

describe("pin limit", () => {
  it("allows pinning below the limit, refuses at it", () => {
    expect(decidePin({ pinned: true, alreadyPinned: false, pinnedCount: MAX_PINNED_TENANTS - 1 })).toBe("ok");
    expect(decidePin({ pinned: true, alreadyPinned: false, pinnedCount: MAX_PINNED_TENANTS })).toBe("limit");
    expect(MAX_PINNED_TENANTS).toBe(20);
  });
  it("re-pinning and re-unpinning are no-ops, even at the limit; unpinning always works", () => {
    expect(decidePin({ pinned: true, alreadyPinned: true, pinnedCount: 20 })).toBe("noop");
    expect(decidePin({ pinned: false, alreadyPinned: false, pinnedCount: 0 })).toBe("noop");
    expect(decidePin({ pinned: false, alreadyPinned: true, pinnedCount: 20 })).toBe("ok");
  });
});
