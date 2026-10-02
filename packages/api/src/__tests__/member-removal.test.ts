import { describe, it, expect } from "vitest";
import { removeTenantMember, removalNoticeText, leftNoticeText, type RemovalStore, type ControlRevocation, type RemovalTarget } from "../lib/member-removal.js";
import type { SecurityEventInput } from "../lib/security-events.js";

interface FakeOpts {
  target?: RemovalTarget | null;
  control?: Partial<ControlRevocation>;
  grants?: number;
  owners?: string[];
  failStep?: "grants" | "control" | "email" | "event";
}

function makeStore(o: FakeOpts = {}) {
  const calls: string[] = [];
  const events: SecurityEventInput[] = [];
  const notices: Array<{ to: string; subject: string; text: string }> = [];
  const logged: string[] = [];
  const target = o.target === undefined ? { role: "ca_filing", email: "ca@firm.in", name: "CA" } : o.target;
  const store: RemovalStore = {
    async getTarget() { calls.push("getTarget"); return target; },
    async getUserEmail() { calls.push("getUserEmail"); return "ghost@x.in"; },
    async getTenantName() { calls.push("getTenantName"); return "Acme Traders"; },
    async getOwnerEmails() { calls.push("getOwnerEmails"); return o.owners ?? ["owner@acme.in"]; },
    async revokeBusinessGrants() {
      calls.push("grants");
      if (o.failStep === "grants") throw new Error("tenant db down");
      return o.grants ?? 2;
    },
    async revokeControlAccess(_t, _u, email) {
      calls.push(`control:${email}`);
      if (o.failStep === "control") throw new Error("control db down");
      return { membershipRemoved: !!target, apiKeysRevoked: 1, invitationsDeleted: 1, invitationsExpired: 0, sessionIds: ["s1", "s2"], ...o.control };
    },
    invalidateCaches(_t, _u, ids) { calls.push(`caches:${ids.join(",")}`); },
    async recordEvent(e) { calls.push("event"); if (o.failStep === "event") throw new Error("never"); events.push(e); },
    async sendNotice(to, subject, text) {
      calls.push("email");
      if (o.failStep === "email") throw new Error("smtp down");
      notices.push({ to, subject, text });
    },
    log: { error: (m) => { logged.push(m); } },
    now: () => new Date("2026-10-02T00:00:00Z"),
  };
  return { store, calls, events, notices, logged };
}

const owner = { id: "owner", role: "owner" };
const input = (over = {}) => ({ tenantId: "t1", actor: owner, targetUserId: "u1", ...over });

describe("removeTenantMember", () => {
  it("runs every step in order: tenant DB first, then the control transaction, caches, event, email", async () => {
    const f = makeStore();
    const r = await removeTenantMember(input(), f.store);
    expect(f.calls).toEqual(["getTarget", "grants", "control:ca@firm.in", "caches:s1,s2", "event", "getTenantName", "email"]);
    expect(r).toEqual({ success: true, removed: true, apiKeysRevoked: 1, businessesRevoked: 2, emailSent: true });
  });

  it("records access.removed with actor, subject, tenant and the agreed metadata", async () => {
    const f = makeStore();
    await removeTenantMember(input({ ip: "1.2.3.4", userAgent: "ua" }), f.store);
    expect(f.events).toEqual([{
      type: "access.removed",
      userId: "u1",
      actorUserId: "owner",
      tenantId: "t1",
      ip: "1.2.3.4",
      userAgent: "ua",
      metadata: { role: "ca_filing", email: "ca@firm.in", apiKeysRevoked: 1, businessesRevoked: 2, removedBy: "owner" },
    }]);
  });

  it("e-mails the removed person: 'Your access to {tenant} was removed'", async () => {
    const f = makeStore();
    await removeTenantMember(input(), f.store);
    expect(f.notices).toHaveLength(1);
    expect(f.notices[0]!.to).toBe("ca@firm.in");
    expect(f.notices[0]!.subject).toBe("Your access to Acme Traders was removed");
  });

  it("an e-mail failure is logged and does not fail the removal", async () => {
    const f = makeStore({ failStep: "email" });
    const r = await removeTenantMember(input(), f.store);
    expect(r.success).toBe(true);
    expect(r.emailSent).toBe(false);
    expect(f.logged).toHaveLength(1);
    expect(f.events).toHaveLength(1);
  });

  it("a tenant-DB failure stops before anything else changes (safe to retry)", async () => {
    const f = makeStore({ failStep: "grants" });
    await expect(removeTenantMember(input(), f.store)).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(f.calls).toEqual(["getTarget", "grants"]);
    expect(f.events).toHaveLength(0);
    expect(f.notices).toHaveLength(0);
  });

  it("a control-transaction failure surfaces, with no caches cleared, event or e-mail", async () => {
    const f = makeStore({ failStep: "control" });
    await expect(removeTenantMember(input(), f.store)).rejects.toThrow("control db down");
    expect(f.calls).toEqual(["getTarget", "grants", "control:ca@firm.in"]);
  });

  it("owner/superadmin cannot be removed", async () => {
    for (const role of ["owner", "superadmin"]) {
      const f = makeStore({ target: { role, email: "o@x.in", name: null } });
      await expect(removeTenantMember(input(), f.store)).rejects.toMatchObject({ code: "FORBIDDEN", message: "Cannot remove a superadmin" });
      expect(f.calls).toEqual(["getTarget"]);
    }
  });

  it("cannot remove yourself", async () => {
    const f = makeStore();
    await expect(removeTenantMember(input({ targetUserId: "owner" }), f.store)).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Cannot remove yourself" });
    expect(f.calls).toEqual([]);
  });

  it("only owner, superadmin and admin may remove; null role is refused", async () => {
    for (const role of ["seller", "accountant", "auditor", "ca_filing", "seller_manager", null]) {
      const f = makeStore();
      await expect(removeTenantMember(input({ actor: { id: "x", role } }), f.store)).rejects.toMatchObject({ code: "FORBIDDEN", message: "Only owners and admins can remove members" });
      expect(f.calls).toEqual([]);
    }
  });

  it("an admin may remove a CA member", async () => {
    for (const role of ["auditor", "ca_filing"]) {
      const f = makeStore({ target: { role, email: "ca@firm.in", name: null } });
      const r = await removeTenantMember(input({ actor: { id: "adm", role: "admin" } }), f.store);
      expect(r.removed).toBe(true);
    }
  });

  it("a non-member is a quiet no-op that still sweeps this organisation's leftovers (no event, no e-mail)", async () => {
    const f = makeStore({ target: null, control: { membershipRemoved: false, apiKeysRevoked: 0, sessionIds: [] } });
    const r = await removeTenantMember(input(), f.store);
    expect(r).toMatchObject({ success: true, removed: false });
    expect(f.calls).toEqual(["getTarget", "getUserEmail", "grants", "control:ghost@x.in", "caches:"]);
    expect(f.events).toHaveLength(0);
    expect(f.notices).toHaveLength(0);
  });
});

describe("removalNoticeText", () => {
  it("keeps the subject on one line", () => {
    expect(removalNoticeText("Acme\nTraders").subject).toBe("Your access to Acme Traders was removed");
  });
  it("tells them about the keys and who to ask", () => {
    const { text } = removalNoticeText("Acme");
    expect(text).toContain("API keys");
    expect(text).toContain("owner");
  });
});

describe("removeTenantMember: leaving (self)", () => {
  const me = { id: "u1", role: "auditor" };
  const leave = (over = {}) => ({ tenantId: "t1", actor: me, targetUserId: "u1", self: true, ...over });

  it("a CA may remove their own membership: same cleanup, event access.left, removedBy is themself", async () => {
    const f = makeStore({ target: { role: "auditor", email: "ca@firm.in", name: "Anita" } });
    const r = await removeTenantMember(leave({ ip: "1.1.1.1" }), f.store);
    expect(r).toMatchObject({ success: true, removed: true, apiKeysRevoked: 1, businessesRevoked: 2 });
    expect(f.calls.slice(0, 4)).toEqual(["getTarget", "grants", "control:ca@firm.in", "caches:s1,s2"]);
    expect(f.events).toEqual([{
      type: "access.left",
      userId: "u1",
      actorUserId: "u1",
      tenantId: "t1",
      ip: "1.1.1.1",
      userAgent: null,
      metadata: { role: "auditor", email: "ca@firm.in", apiKeysRevoked: 1, businessesRevoked: 2, removedBy: "u1" },
    }]);
  });

  it("tells the owners, not the person who left", async () => {
    const f = makeStore({ target: { role: "ca_filing", email: "ca@firm.in", name: "Anita Shah" }, owners: ["a@acme.in", "b@acme.in"] });
    await removeTenantMember(leave(), f.store);
    expect(f.notices.map((n) => n.to)).toEqual(["a@acme.in", "b@acme.in"]);
    expect(f.notices[0]!.subject).toBe("Anita Shah left your organisation");
  });

  it("an owner or superadmin cannot leave, and nothing is changed", async () => {
    for (const role of ["owner", "superadmin"]) {
      const f = makeStore({ target: { role, email: "o@acme.in", name: null } });
      await expect(removeTenantMember(leave({ actor: { id: "u1", role } }), f.store)).rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringContaining("cannot leave") });
      expect(f.calls).toEqual(["getTarget"]);
    }
  });

  it("any non-owner role may leave (admin, seller, accountant)", async () => {
    for (const role of ["admin", "seller", "accountant", "ca_filing"]) {
      const f = makeStore({ target: { role, email: "x@y.in", name: null } });
      expect((await removeTenantMember(leave({ actor: { id: "u1", role } }), f.store)).removed).toBe(true);
    }
  });

  it("not a member: NOT_FOUND and nothing is swept", async () => {
    const f = makeStore({ target: null });
    await expect(removeTenantMember(leave(), f.store)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(f.calls).toEqual(["getTarget"]);
  });

  it("self mode refuses a different target", async () => {
    const f = makeStore();
    await expect(removeTenantMember(leave({ targetUserId: "other" }), f.store)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("the normal path still refuses removing yourself", async () => {
    const f = makeStore();
    await expect(removeTenantMember({ tenantId: "t1", actor: owner, targetUserId: "owner" }, f.store)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("an owner e-mail failure is logged and does not fail leaving", async () => {
    const f = makeStore({ target: { role: "auditor", email: "ca@firm.in", name: "A" }, failStep: "email" });
    const r = await removeTenantMember(leave(), f.store);
    expect(r.removed).toBe(true);
    expect(f.logged.length).toBeGreaterThan(0);
  });
});

describe("leftNoticeText", () => {
  it("one-line subject", () => {
    expect(leftNoticeText("Anita\nShah", "Acme").subject).toBe("Anita Shah left your organisation");
  });
});
