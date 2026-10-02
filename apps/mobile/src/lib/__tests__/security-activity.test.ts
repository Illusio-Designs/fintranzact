import { activityRows } from "../security-activity";

const NOW = Date.parse("2026-10-02T12:00:00Z");
const item = (over: Record<string, unknown> = {}) => ({
  id: "e1",
  type: "2fa.verified",
  label: "Signed in with a verification code",
  createdAt: "2026-10-02T11:55:00Z",
  ip: "203.0.113.7",
  device: "Chrome 126 on macOS",
  method: "totp",
  ...over,
});

describe("activityRows", () => {
  it("maps an item to title, detail and relative time", () => {
    expect(activityRows([item()], NOW)).toEqual([
      { id: "e1", title: "Signed in with a verification code", detail: "Chrome 126 on macOS · 203.0.113.7 · Authenticator app", when: "5m ago", attention: false },
    ]);
  });
  it("keeps the server order and flags failures, lockouts and resets", () => {
    const rows = activityRows(
      [item({ id: "a", type: "2fa.reset_by_admin" }), item({ id: "b", type: "2fa.failed" }), item({ id: "c", type: "2fa.locked" }), item({ id: "d" })],
      NOW,
    );
    expect(rows.map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
    expect(rows.map((r) => r.attention)).toEqual([true, true, true, false]);
  });
  it("copes with missing optional fields", () => {
    expect(activityRows([item({ ip: null, device: null, method: null })], NOW)[0]!.detail).toBe("");
    expect(activityRows([], NOW)).toEqual([]);
  });
});
