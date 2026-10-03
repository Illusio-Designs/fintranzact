import { switcherRows, showSearch, nextOrgAfterLeaving, SIMPLE_LIST_MAX } from "../client-switcher";

let n = 0;
const org = (name: string, over: Record<string, unknown> = {}) => ({
  tenantId: `t${++n}`, name, slug: name, role: "auditor", roleLabel: "Accountant (read-only)", isOwnFirm: false, isClient: true, isCa: true,
  plan: "pro", pinned: false, lastOpenedAt: null, ...over,
}) as never as import("@fintranzact/shared").ClientListItem;
const firm = (name: string) => org(name, { role: "owner", roleLabel: "Owner", isOwnFirm: true, isClient: false, isCa: false });

describe("switcherRows", () => {
  it("a few organisations: one flat list in the API's order, no headers", () => {
    const items = [org("A"), firm("F")];
    const rows = switcherRows(items, { total: 2, searching: false });
    expect(rows.map((r) => r.kind)).toEqual(["org", "org"]);
    expect(rows.map((r) => (r.kind === "org" ? r.org.name : ""))).toEqual(["A", "F"]);
  });
  it("many organisations: headers per section", () => {
    const items = [
      org("P", { pinned: true }),
      org("R", { lastOpenedAt: "2026-09-01T00:00:00Z" }),
      firm("Firm"),
      ...Array.from({ length: SIMPLE_LIST_MAX }, (_, i) => org(`C${i}`)),
    ];
    const rows = switcherRows(items, { total: items.length, searching: false });
    expect(rows.filter((r) => r.kind === "header").map((r) => (r as { title: string }).title)).toEqual(["Pinned", "Recent", "My firm", "Clients"]);
    expect(rows[0]).toMatchObject({ kind: "header", title: "Pinned" });
    expect(rows.filter((r) => r.kind === "org")).toHaveLength(items.length);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  });
  it("while searching there is no Recent section, even for a short result", () => {
    const items = [org("R", { lastOpenedAt: "2026-09-01T00:00:00Z" })];
    const rows = switcherRows(items, { total: 1, searching: true });
    expect(rows.filter((r) => r.kind === "header").map((r) => (r as { title: string }).title)).toEqual(["Clients"]);
  });
});

describe("showSearch", () => {
  it("only for long lists or once something is typed", () => {
    expect(showSearch(SIMPLE_LIST_MAX, "")).toBe(false);
    expect(showSearch(SIMPLE_LIST_MAX + 1, "")).toBe(true);
    expect(showSearch(2, " x ")).toBe(true);
    expect(showSearch(2, "   ")).toBe(false);
  });
});

describe("nextOrgAfterLeaving", () => {
  it("prefers the person's own firm, otherwise the first in order, never the one left", () => {
    const a = org("A"); const b = org("B"); const f = firm("F");
    expect(nextOrgAfterLeaving([a, b, f], a.tenantId)?.name).toBe("F");
    expect(nextOrgAfterLeaving([a, b], a.tenantId)?.name).toBe("B");
    expect(nextOrgAfterLeaving([a], a.tenantId)).toBeNull();
    expect(nextOrgAfterLeaving([], "x")).toBeNull();
  });
});
