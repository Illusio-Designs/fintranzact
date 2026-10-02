import { describe, it, expect, vi, beforeEach } from "vitest";

const recorded: Array<Record<string, unknown>> = [];
vi.mock("../lib/security-events.js", () => ({
  recordSecurityEvent: vi.fn(async (e: Record<string, unknown>) => { recorded.push(e); }),
}));

import {
  buildAccessEvent,
  shouldRecordOrgOpened,
  recordCaExport,
  recordOrgOpened,
  ORG_OPENED_WINDOW_MS,
  type OpenedThrottle,
} from "../lib/access-events.js";

const who = { actorId: "u-owner", tenantId: "t1", ip: "1.2.3.4", userAgent: "UA" };

beforeEach(() => { recorded.length = 0; });

describe("buildAccessEvent", () => {
  it("invited: actor is the inviter, subject is null when the invitee has no account", () => {
    const e = buildAccessEvent({ kind: "invited", ...who, role: "auditor", email: "ca@firm.in" });
    expect(e).toMatchObject({ type: "access.invited", actorUserId: "u-owner", userId: null, tenantId: "t1", metadata: { role: "auditor", email: "ca@firm.in" } });
  });
  it("invited: subject is the invitee when they already have an account", () => {
    const e = buildAccessEvent({ kind: "invited", ...who, role: "ca_filing", email: "ca@firm.in", inviteeUserId: "u-ca" });
    expect(e.userId).toBe("u-ca");
  });
  it("invite_revoked keeps role and email", () => {
    const e = buildAccessEvent({ kind: "invite_revoked", ...who, role: "auditor", email: "ca@firm.in" });
    expect(e).toMatchObject({ type: "access.invite_revoked", userId: null, metadata: { role: "auditor", email: "ca@firm.in" } });
  });
  it("accepted: actor and subject are the person accepting", () => {
    const e = buildAccessEvent({ kind: "accepted", ...who, actorId: "u-ca", role: "auditor" });
    expect(e).toMatchObject({ type: "access.accepted", actorUserId: "u-ca", userId: "u-ca", metadata: { role: "auditor" } });
  });
  it("role_changed: subject is the member, metadata from/to/email", () => {
    const e = buildAccessEvent({ kind: "role_changed", ...who, targetUserId: "u-ca", from: "auditor", to: "ca_filing", email: "ca@firm.in" });
    expect(e).toMatchObject({ type: "access.role_changed", actorUserId: "u-owner", userId: "u-ca", metadata: { from: "auditor", to: "ca_filing", email: "ca@firm.in" } });
  });
  it("org_opened and export", () => {
    expect(buildAccessEvent({ kind: "org_opened", ...who, actorId: "u-ca", role: "auditor" })).toMatchObject({ type: "access.org_opened", userId: "u-ca", metadata: { role: "auditor" } });
    expect(buildAccessEvent({ kind: "export", ...who, actorId: "u-ca", role: "ca_filing", procedure: "gst.gstr1Json" })).toMatchObject({ type: "access.export", metadata: { procedure: "gst.gstr1Json", role: "ca_filing" } });
  });
  it("metadata never carries tokens, links or input data", () => {
    const events = [
      buildAccessEvent({ kind: "invited", ...who, role: "auditor", email: "a@b.in" }),
      buildAccessEvent({ kind: "invite_revoked", ...who, role: "auditor", email: "a@b.in" }),
      buildAccessEvent({ kind: "accepted", ...who, role: "auditor" }),
      buildAccessEvent({ kind: "role_changed", ...who, targetUserId: "x", from: "auditor", to: "ca_filing", email: "a@b.in" }),
      buildAccessEvent({ kind: "org_opened", ...who, role: "auditor" }),
      buildAccessEvent({ kind: "export", ...who, role: "auditor", procedure: "gst.gstr1CSV" }),
    ];
    const allowed = new Set(["role", "email", "from", "to", "procedure"]);
    for (const e of events) {
      for (const k of Object.keys(e.metadata ?? {})) expect(allowed.has(k)).toBe(true);
      expect(JSON.stringify(e)).not.toMatch(/token|invite\/|otp|password/i);
    }
  });
});

describe("shouldRecordOrgOpened (throttle)", () => {
  it("allows the first open, blocks within the hour, allows again after it", () => {
    const t: OpenedThrottle = new Map();
    const t0 = 1_000_000;
    expect(shouldRecordOrgOpened(t, "u", "t", t0)).toBe(true);
    expect(shouldRecordOrgOpened(t, "u", "t", t0 + 59 * 60_000)).toBe(false);
    expect(shouldRecordOrgOpened(t, "u", "t", t0 + ORG_OPENED_WINDOW_MS)).toBe(true);
  });
  it("is per user and per organisation", () => {
    const t: OpenedThrottle = new Map();
    expect(shouldRecordOrgOpened(t, "u1", "t1", 0)).toBe(true);
    expect(shouldRecordOrgOpened(t, "u2", "t1", 1)).toBe(true);
    expect(shouldRecordOrgOpened(t, "u1", "t2", 2)).toBe(true);
    expect(shouldRecordOrgOpened(t, "u1", "t1", 3)).toBe(false);
  });
  it("does not grow without bound", () => {
    const t: OpenedThrottle = new Map();
    for (let i = 0; i < 6_000; i++) shouldRecordOrgOpened(t, `u${i}`, "t", 0);
    expect(t.size).toBeLessThanOrEqual(5_000);
  });
});

describe("recordOrgOpened", () => {
  const ctx = { user: { id: "u-ca" }, tenantId: "t1", ipAddress: "9.9.9.9", req: { headers: { get: () => "UA" } } };
  it("writes once an hour for a CA role", async () => {
    const t: OpenedThrottle = new Map();
    expect(await recordOrgOpened(ctx, "auditor", 0, t)).toBe(true);
    expect(await recordOrgOpened(ctx, "auditor", 60_000, t)).toBe(false);
    expect(await recordOrgOpened(ctx, "auditor", ORG_OPENED_WINDOW_MS + 1, t)).toBe(true);
    expect(recorded).toHaveLength(2);
    expect(recorded[0]).toMatchObject({ type: "access.org_opened", userId: "u-ca", tenantId: "t1", userAgent: "UA" });
  });
  it("never for other roles", async () => {
    const t: OpenedThrottle = new Map();
    for (const r of ["owner", "admin", "accountant", "seller", null, undefined]) expect(await recordOrgOpened(ctx, r, 0, t)).toBe(false);
    expect(recorded).toHaveLength(0);
  });
});

describe("recordCaExport", () => {
  const base = { user: { id: "u-ca" }, tenantId: "t1", ipAddress: null };
  it("records for auditor and ca_filing", async () => {
    expect(await recordCaExport({ ...base, role: "auditor" }, "gst.gstr1Json")).toBe(true);
    expect(await recordCaExport({ ...base, role: "ca_filing" }, "tds.certificate")).toBe(true);
    expect(recorded.map((e) => (e.metadata as { procedure: string }).procedure)).toEqual(["gst.gstr1Json", "tds.certificate"]);
    expect(recorded[0]).toMatchObject({ type: "access.export", userId: "u-ca", actorUserId: "u-ca" });
  });
  it("does nothing for owners, admins, accountants and sellers", async () => {
    for (const role of ["owner", "superadmin", "admin", "accountant", "seller_manager", "seller", undefined]) {
      expect(await recordCaExport({ ...base, role }, "gst.gstr1Json")).toBe(false);
    }
    expect(recorded).toHaveLength(0);
  });
});
