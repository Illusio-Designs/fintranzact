import { isCaRole } from "@fintranzact/shared";
import { accessLogRows, caLastOpened } from "../access-log";

const NOW = Date.parse("2026-10-02T12:00:00Z");
const owner = { id: "o", name: "Rohit", email: "o@x.in" };
const ca = { id: "c", name: "Anita Shah", email: "a@x.in" };
const ev = (type: string, over: Record<string, unknown> = {}) => ({
  id: type, type, label: type, createdAt: "2026-10-02T11:55:00Z", actor: owner, subject: null, metadata: {}, ...over,
});

describe("accessLogRows", () => {
  it("maps events to sentence, relative time and icon", () => {
    const rows = accessLogRows(
      [
        ev("access.invited", { subject: ca, metadata: { role: "auditor", email: ca.email } }),
        ev("access.removed", { subject: ca, metadata: { role: "auditor" } }),
        ev("access.export", { actor: ca, metadata: { role: "ca_filing", procedure: "gst.gstr1Json" } }),
      ] as never,
      "o",
      NOW,
    );
    expect(rows[0]).toMatchObject({ text: "Anita Shah (CA) was invited as Accountant (read-only) by You", when: "5m ago", icon: "mail-outline", attention: false });
    expect(rows[1]).toMatchObject({ text: "Access removed for Anita Shah (CA) by You", attention: true });
    expect(rows[2]).toMatchObject({ text: "Anita Shah (CA) downloaded GSTR-1 JSON", icon: "download-outline" });
  });
  it("unknown types still render", () => {
    expect(accessLogRows([ev("access.future", { label: "Something" })] as never, null, NOW)[0]).toMatchObject({ text: "Something", icon: "ellipse-outline" });
  });
});

describe("caLastOpened", () => {
  it("CA members only: relative time or Never opened", () => {
    expect(caLastOpened({ role: "auditor", lastOpenedAt: new Date("2026-10-02T09:00:00Z") }, isCaRole, NOW)).toBe("Last opened 3h ago");
    expect(caLastOpened({ role: "ca_filing", lastOpenedAt: null }, isCaRole, NOW)).toBe("Never opened");
    expect(caLastOpened({ role: "seller", lastOpenedAt: null }, isCaRole, NOW)).toBeNull();
  });
});
