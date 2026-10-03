/** tenant.setSecurityPolicy rules with a faked store. */

import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";
import { nextPolicyState, setSecurityPolicy, OWN_TWO_FACTOR_FIRST_MESSAGE, type PolicyDeps, type PolicyState } from "../lib/two-factor-policy.js";
import type { SecurityEventInput } from "../lib/security-events.js";

const NOW = new Date("2026-06-15T12:00:00Z");
const EARLIER = new Date("2026-05-01T00:00:00Z");

function fake(opts: { state?: PolicyState; caller?: { role: string; hasTwoFactor: boolean } | null } = {}) {
  let state: PolicyState = opts.state ?? { policy: "off", graceDays: 7, enforcedAt: null };
  const events: SecurityEventInput[] = [];
  const invalidated: string[] = [];
  const caller = opts.caller === undefined ? { role: "owner", hasTwoFactor: true } : opts.caller;
  const deps: PolicyDeps = {
    getPolicy: async () => state,
    getCaller: async () => caller,
    save: async (_t, next) => { state = next; },
    record: async (e) => { events.push(e); },
    invalidate: (t) => { invalidated.push(t); },
    now: () => NOW,
  };
  return { deps, events, invalidated, get state() { return state; } };
}
const run = (f: ReturnType<typeof fake>, input: Parameters<typeof setSecurityPolicy>[1]["input"]) =>
  setSecurityPolicy(f.deps, { tenantId: "t1", actorId: "u1", input });

describe("nextPolicyState", () => {
  const enforcing = (policy: "admins" | "all", graceDays = 7): PolicyState => ({ policy, graceDays, enforcedAt: EARLIER });
  it("tightening sets enforcedAt to now", () => {
    expect(nextPolicyState({ policy: "off", graceDays: 7, enforcedAt: null }, { policy: "admins" }, NOW)?.enforcedAt).toEqual(NOW);
    expect(nextPolicyState({ policy: "off", graceDays: 7, enforcedAt: null }, { policy: "all" }, NOW)?.enforcedAt).toEqual(NOW);
    expect(nextPolicyState(enforcing("admins"), { policy: "all" }, NOW)?.enforcedAt).toEqual(NOW);
  });
  it("relaxing keeps enforcedAt", () => {
    expect(nextPolicyState(enforcing("all"), { policy: "admins" }, NOW)?.enforcedAt).toEqual(EARLIER);
  });
  it("off clears enforcedAt and keeps the grace days", () => {
    expect(nextPolicyState(enforcing("all", 14), { policy: "off" }, NOW)).toEqual({ policy: "off", graceDays: 14, enforcedAt: null });
  });
  it("changing grace days while enforcing restarts the clock", () => {
    expect(nextPolicyState(enforcing("all", 7), { policy: "all", graceDays: 3 }, NOW)).toEqual({ policy: "all", graceDays: 3, enforcedAt: NOW });
  });
  it("changing grace days while off does not enforce", () => {
    expect(nextPolicyState({ policy: "off", graceDays: 7, enforcedAt: null }, { policy: "off", graceDays: 3 }, NOW)).toEqual({ policy: "off", graceDays: 3, enforcedAt: null });
  });
  it("omitted grace days keep the current value; no change returns null", () => {
    expect(nextPolicyState(enforcing("all", 9), { policy: "admins" }, NOW)?.graceDays).toBe(9);
    expect(nextPolicyState(enforcing("all", 9), { policy: "all" }, NOW)).toBeNull();
    expect(nextPolicyState(enforcing("all", 9), { policy: "all", graceDays: 9 }, NOW)).toBeNull();
  });
});

describe("setSecurityPolicy", () => {
  it("lets the owner switch it on, audits old to new and invalidates the cache", async () => {
    const f = fake();
    const r = await run(f, { policy: "all", graceDays: 3 });
    expect(r).toEqual({ policy: "all", graceDays: 3, enforcedAt: NOW });
    expect(f.state).toEqual(r);
    expect(f.invalidated).toEqual(["t1"]);
    expect(f.events).toHaveLength(1);
    expect(f.events[0]).toMatchObject({
      type: "2fa.policy_changed",
      tenantId: "t1",
      actorUserId: "u1",
      metadata: { tenant_id: "t1", actor: "u1", from: { policy: "off", graceDays: 7 }, to: { policy: "all", graceDays: 3 } },
    });
  });

  it("allows a superadmin", async () => {
    await expect(run(fake({ caller: { role: "superadmin", hasTwoFactor: true } }), { policy: "admins" })).resolves.toMatchObject({ policy: "admins" });
  });

  it("refuses admins, members and non-members", async () => {
    for (const caller of [{ role: "admin", hasTwoFactor: true }, { role: "seller", hasTwoFactor: true }, null]) {
      const f = fake({ caller });
      await expect(run(f, { policy: "all" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(f.events).toHaveLength(0);
      expect(f.state.policy).toBe("off");
    }
  });

  it("refuses a policy when the caller has no 2FA (so the owner cannot strand themselves), even with grace 0", async () => {
    const f = fake({ caller: { role: "owner", hasTwoFactor: false } });
    for (const policy of ["admins", "all"] as const) {
      const err = await run(f, { policy, graceDays: 0 }).catch((e) => e);
      expect(err).toBeInstanceOf(TRPCError);
      expect(err.message).toBe(OWN_TWO_FACTOR_FIRST_MESSAGE);
    }
    expect(f.state.policy).toBe("off");
    expect(f.events).toHaveLength(0);
  });

  it("an owner without 2FA may still turn it off", async () => {
    const f = fake({ state: { policy: "all", graceDays: 7, enforcedAt: EARLIER }, caller: { role: "owner", hasTwoFactor: false } });
    await expect(run(f, { policy: "off" })).resolves.toMatchObject({ policy: "off", enforcedAt: null });
  });

  it("enforces grace-day bounds 0..30", async () => {
    for (const graceDays of [-1, 31, 1.5, Number.NaN]) {
      await expect(run(fake(), { policy: "all", graceDays })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    await expect(run(fake(), { policy: "all", graceDays: 0 })).resolves.toMatchObject({ graceDays: 0 });
    await expect(run(fake(), { policy: "all", graceDays: 30 })).resolves.toMatchObject({ graceDays: 30 });
  });

  it("a no-op change records nothing", async () => {
    const f = fake({ state: { policy: "all", graceDays: 7, enforcedAt: EARLIER } });
    await run(f, { policy: "all" });
    expect(f.events).toHaveLength(0);
    expect(f.invalidated).toHaveLength(0);
  });
});
