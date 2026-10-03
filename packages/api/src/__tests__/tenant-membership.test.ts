import { describe, it, expect, beforeEach } from "vitest";
import {
  MEMBERSHIP_CACHE_MS,
  ACCESS_REMOVED_MESSAGE,
  isCurrentTenantMember,
  requireTenantMembership,
  invalidateTenantMembership,
  clearTenantMembershipCache,
  type MembershipDeps,
} from "../lib/tenant-membership.js";

function fakeDeps(members: Set<string>) {
  const calls: string[] = [];
  let t = 1_000_000;
  const deps: MembershipDeps = {
    async lookup(tenantId, userId) {
      calls.push(`${tenantId}/${userId}`);
      return members.has(`${tenantId}/${userId}`);
    },
    now: () => t,
  };
  return { deps, calls, advance: (ms: number) => { t += ms; } };
}

beforeEach(() => clearTenantMembershipCache());

describe("tenant membership check", () => {
  it("is 15 seconds, shorter than the 60s session cache", () => {
    expect(MEMBERSHIP_CACHE_MS).toBe(15_000);
  });

  it("caches a positive answer for 15s, then asks again", async () => {
    const f = fakeDeps(new Set(["t1/u1"]));
    expect(await isCurrentTenantMember("t1", "u1", f.deps)).toBe(true);
    expect(await isCurrentTenantMember("t1", "u1", f.deps)).toBe(true);
    f.advance(14_999);
    expect(await isCurrentTenantMember("t1", "u1", f.deps)).toBe(true);
    expect(f.calls).toHaveLength(1);
    f.advance(2);
    expect(await isCurrentTenantMember("t1", "u1", f.deps)).toBe(true);
    expect(f.calls).toHaveLength(2);
  });

  it("never caches a refusal, so a person added later is let in at once", async () => {
    const members = new Set<string>();
    const f = fakeDeps(members);
    expect(await isCurrentTenantMember("t1", "u1", f.deps)).toBe(false);
    members.add("t1/u1");
    expect(await isCurrentTenantMember("t1", "u1", f.deps)).toBe(true);
  });

  it("is keyed by organisation and user", async () => {
    const f = fakeDeps(new Set(["t1/u1"]));
    expect(await isCurrentTenantMember("t1", "u1", f.deps)).toBe(true);
    expect(await isCurrentTenantMember("t2", "u1", f.deps)).toBe(false);
    expect(await isCurrentTenantMember("t1", "u2", f.deps)).toBe(false);
  });

  it("invalidation makes the next request re-check, so a removal on this instance is immediate", async () => {
    const members = new Set(["t1/u1"]);
    const f = fakeDeps(members);
    await isCurrentTenantMember("t1", "u1", f.deps);
    members.delete("t1/u1");
    expect(await isCurrentTenantMember("t1", "u1", f.deps)).toBe(true); // stale on another instance, <= 15s
    invalidateTenantMembership("t1", "u1");
    expect(await isCurrentTenantMember("t1", "u1", f.deps)).toBe(false);
  });

  it("another instance's stale yes ends within 15s", async () => {
    const members = new Set(["t1/u1"]);
    const f = fakeDeps(members);
    await isCurrentTenantMember("t1", "u1", f.deps);
    members.delete("t1/u1");
    f.advance(MEMBERSHIP_CACHE_MS);
    expect(await isCurrentTenantMember("t1", "u1", f.deps)).toBe(false);
  });

  it("requireTenantMembership throws a plain FORBIDDEN with the access-removed message", async () => {
    const f = fakeDeps(new Set());
    await expect(requireTenantMembership("t1", "u1", f.deps)).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: ACCESS_REMOVED_MESSAGE,
    });
    expect(ACCESS_REMOVED_MESSAGE).toBe("You no longer have access to this organisation");
  });

  it("requireTenantMembership passes for a current member", async () => {
    const f = fakeDeps(new Set(["t1/u1"]));
    await expect(requireTenantMembership("t1", "u1", f.deps)).resolves.toBeUndefined();
  });
});
