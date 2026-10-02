import { describe, it, expect } from "vitest";
import { groupClientSections, flattenClientSections, mergeClientPages, clientCountText, leaveClientWarning, CLIENT_RECENT_COUNT, type ClientListItem } from "../client-switcher.js";

let n = 0;
const c = (name: string, over: Partial<ClientListItem> = {}): ClientListItem => ({
  tenantId: `t${++n}`, name, slug: name, role: "auditor", roleLabel: "Accountant (read-only)", isOwnFirm: false, isClient: true, isCa: true, plan: "pro", pinned: false, lastOpenedAt: null, ...over,
});
const firm = (name: string, over: Partial<ClientListItem> = {}) => c(name, { role: "owner", roleLabel: "Owner", isOwnFirm: true, isClient: false, isCa: false, ...over });

describe("groupClientSections", () => {
  it("pinned, recent (top 5 by last opened, not pinned), my firm, clients, each organisation once", () => {
    const items = [
      c("P", { pinned: true, lastOpenedAt: "2026-09-30T00:00:00Z" }),
      ...Array.from({ length: 7 }, (_, i) => c(`R${i}`, { lastOpenedAt: new Date(Date.UTC(2026, 8, 1 + i)).toISOString() })),
      firm("My Firm"),
      c("Never"),
    ];
    const s = groupClientSections(items);
    expect(s.map((x) => x.key)).toEqual(["pinned", "recent", "firm", "clients"]);
    expect(s[0]!.items.map((i) => i.name)).toEqual(["P"]);
    expect(s[1]!.items.map((i) => i.name)).toEqual(["R6", "R5", "R4", "R3", "R2"]);
    expect(s[1]!.items).toHaveLength(CLIENT_RECENT_COUNT);
    expect(s[2]!.items.map((i) => i.name)).toEqual(["My Firm"]);
    expect(s[3]!.items.map((i) => i.name)).toEqual(["R0", "R1", "Never"].sort((a, b) => items.findIndex((i) => i.name === a) - items.findIndex((i) => i.name === b)));
    expect(flattenClientSections(s)).toHaveLength(items.length);
    expect(new Set(flattenClientSections(s).map((i) => i.tenantId)).size).toBe(items.length);
  });
  it("a recently opened own firm sits in Recent, not My firm", () => {
    const s = groupClientSections([firm("F", { lastOpenedAt: "2026-09-01T00:00:00Z" }), c("X")]);
    expect(s.map((x) => x.key)).toEqual(["recent", "clients"]);
  });
  it("showRecent false (a search is active) leaves out Recent", () => {
    const s = groupClientSections([c("A", { lastOpenedAt: "2026-09-01T00:00:00Z" }), firm("F")], { showRecent: false });
    expect(s.map((x) => x.key)).toEqual(["firm", "clients"]);
  });
  it("empty sections are omitted; empty input gives nothing", () => {
    expect(groupClientSections([])).toEqual([]);
    expect(groupClientSections([c("A")]).map((x) => x.key)).toEqual(["clients"]);
  });
});

describe("helpers", () => {
  it("mergeClientPages appends and de-duplicates", () => {
    const a = c("A"); const b = c("B"); const d = c("D");
    expect(mergeClientPages([a, b], [b, d]).map((i) => i.name)).toEqual(["A", "B", "D"]);
  });
  it("count text", () => {
    expect(clientCountText(1)).toBe("1 client");
    expect(clientCountText(12)).toBe("12 clients");
  });
  it("leave warning says access ends immediately and the owner is notified", () => {
    const w = leaveClientWarning("Acme");
    expect(w.title).toBe("Leave Acme?");
    expect(w.description).toContain("ends immediately");
    expect(w.description).toContain("owner is notified");
  });
});
