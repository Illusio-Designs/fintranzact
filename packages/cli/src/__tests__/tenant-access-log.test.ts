import { describe, it, expect } from "vitest";
import { FILTERS, summary } from "../commands/tenant/access-log.js";

const ev = (over: object) => ({ createdAt: "2026-10-01T10:00:00Z", label: "Member invited", actor: { name: "Rohit", email: "r@x.in" }, subject: null, metadata: {}, ...over });

describe("tenant access-log", () => {
  it("filters mirror the Team tab groups", () => {
    expect(Object.keys(FILTERS)).toEqual(["all", "invites", "roles", "removals", "opened", "downloads"]);
    expect(FILTERS["downloads"]).toEqual(["access.export"]);
    expect(FILTERS["all"]).toBeNull();
  });
  it("summarises an event with people and safe details", () => {
    expect(summary(ev({ subject: { name: "Anita", email: "a@x.in" }, metadata: { role: "auditor" } }))).toBe("Member invited (Anita, auditor) by Rohit");
    expect(summary(ev({ label: "Accountant downloaded a report or export", actor: { name: "Anita", email: null }, metadata: { procedure: "gst.gstr1Json", role: "ca_filing" } })))
      .toBe("Accountant downloaded a report or export (ca_filing, gst.gstr1Json) by Anita");
    expect(summary(ev({ metadata: { role: "auditor", email: "new@x.in" } }))).toBe("Member invited (new@x.in, auditor) by Rohit");
  });
});
