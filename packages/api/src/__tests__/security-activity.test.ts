/** auth.securityActivity: own events only, safe fields, limit clamp. */

import { describe, it, expect } from "vitest";
import { clampLimit, ownSecurityActivity, toOwnActivity, type ActivityStore, type SecurityEventRow } from "../lib/security-activity.js";

const row = (over: Partial<SecurityEventRow> = {}): SecurityEventRow => ({
  id: "e1",
  userId: "u1",
  actorUserId: null,
  tenantId: null,
  type: "2fa.verified",
  ip: "198.51.100.4",
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36",
  metadata: { method: "totp", secret: "JBSWY3DPEHPK3PXP", code: "123456" },
  createdAt: new Date("2026-10-02T09:00:00Z"),
  ...over,
});

function fakeStore(rows: SecurityEventRow[]) {
  const seen: Array<{ userId: string; limit: number }> = [];
  const store: ActivityStore = {
    async listForUser(userId, limit) {
      seen.push({ userId, limit });
      return rows.filter((r) => r.userId === userId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit);
    },
  };
  return { store, seen };
}

describe("toOwnActivity", () => {
  it("exposes only safe fields", () => {
    const out = toOwnActivity(row());
    expect(Object.keys(out).sort()).toEqual(["createdAt", "device", "id", "ip", "label", "method", "type"]);
    expect(out).toMatchObject({ label: "Signed in with a verification code", method: "totp", device: "Chrome 126 on macOS", createdAt: "2026-10-02T09:00:00.000Z" });
    expect(JSON.stringify(out)).not.toMatch(/JBSWY3|123456|secret|userAgent|Mozilla/);
  });
  it("tolerates missing metadata, user agent and unknown types", () => {
    const out = toOwnActivity(row({ metadata: null, userAgent: null, type: "2fa.future_thing" }));
    expect(out).toMatchObject({ method: null, device: null, label: "2fa.future_thing" });
  });
  it("ignores a non-string or oversized method", () => {
    expect(toOwnActivity(row({ metadata: { method: { a: 1 } } })).method).toBeNull();
    expect(toOwnActivity(row({ metadata: { method: "x".repeat(100) } })).method).toBeNull();
  });
});

describe("clampLimit", () => {
  it("defaults to 20 and clamps to 1..100", () => {
    expect(clampLimit(undefined)).toBe(20);
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(-5)).toBe(1);
    expect(clampLimit(500)).toBe(100);
    expect(clampLimit(7.9)).toBe(7);
    expect(clampLimit(Number.NaN)).toBe(20);
  });
});

describe("ownSecurityActivity", () => {
  it("returns only the caller's events, newest first, with the clamped limit", async () => {
    const f = fakeStore([
      row({ id: "a", createdAt: new Date("2026-10-01T00:00:00Z") }),
      row({ id: "b", createdAt: new Date("2026-10-02T00:00:00Z") }),
      row({ id: "other", userId: "u2" }),
    ]);
    const out = await ownSecurityActivity(f.store, "u1", 1000);
    expect(out.map((e) => e.id)).toEqual(["b", "a"]);
    expect(f.seen).toEqual([{ userId: "u1", limit: 100 }]);
    expect((await ownSecurityActivity(f.store, "u1")).length).toBe(2);
    expect(f.seen[1]!.limit).toBe(20);
  });
});
