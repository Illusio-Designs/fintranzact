/** The two-factor gate: pure decision, allowlist, error shape and cache invalidation. No database. */

import { describe, it, expect, beforeEach } from "vitest";
import { TWO_FACTOR_GATE_ALLOWED_PATHS as SHARED_ALLOWED, TWO_FACTOR_SETUP_PATH } from "@fintranzact/shared";
import { twoFactorGateDecision, twoFactorRequirementView, TWO_FACTOR_GATE_ALLOWED_PATHS, type GateDecisionInput } from "../lib/two-factor-gate.js";
import { twoFactorDataOf, twoFactorRequiredError } from "../lib/two-factor-error.js";
import {
  clearTwoFactorGateCache,
  gateCacheGet,
  gateCacheSet,
  invalidateTwoFactorGateMember,
  invalidateTwoFactorGateTenant,
  invalidateTwoFactorGateUser,
  TWO_FACTOR_GATE_CACHE_MS,
  type GateMembership,
} from "../lib/two-factor-gate-cache.js";
import { READ_ONLY_EXEMPT } from "../lib/entitlement-exempt.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-06-15T12:00:00Z");
const base: GateDecisionInput = {
  authTokenKind: "cookie",
  userHasTwoFactor: false,
  policy: "all",
  role: "seller",
  enforcedAt: new Date(NOW.getTime() - 30 * DAY),
  graceDays: 7,
  memberSince: new Date(NOW.getTime() - 60 * DAY),
  now: NOW,
  path: "party.list",
};
const decide = (o: Partial<GateDecisionInput>) => twoFactorGateDecision({ ...base, ...o });

describe("twoFactorGateDecision", () => {
  it("skips API keys (authTokenKind null) even when blocked otherwise", () => {
    expect(decide({ authTokenKind: null }).allow).toBe(true);
    expect(decide({ authTokenKind: null }).requirement.required).toBe(false);
  });

  it("session kinds are all gated", () => {
    for (const k of ["cookie", "access", "refresh"] as const) expect(decide({ authTokenKind: k }).allow).toBe(false);
  });

  it("skips a user who has 2FA", () => {
    expect(decide({ userHasTwoFactor: true })).toEqual({ allow: true, requirement: { required: false, blocked: false, graceEndsAt: null } });
  });

  it("policy off never gates", () => {
    expect(decide({ policy: "off", role: "owner" }).allow).toBe(true);
  });

  it("an unknown policy fails open", () => {
    expect(decide({ policy: "weird" }).allow).toBe(true);
  });

  describe("policy x role, past the grace period", () => {
    const roles = ["owner", "superadmin", "admin", "seller_manager", "seller", "accountant"];
    for (const role of roles) {
      const isAdmin = ["owner", "superadmin", "admin"].includes(role);
      it(`admins policy, ${role}: ${isAdmin ? "blocked" : "not covered"}`, () => {
        expect(decide({ policy: "admins", role }).allow).toBe(!isAdmin);
      });
      it(`all policy, ${role}: blocked`, () => {
        expect(decide({ policy: "all", role }).allow).toBe(false);
      });
    }
  });

  describe("grace period", () => {
    it("is allowed during grace, with the countdown", () => {
      const r = decide({ enforcedAt: new Date(NOW.getTime() - 2 * DAY), memberSince: new Date(NOW.getTime() - 90 * DAY) });
      expect(r.allow).toBe(true);
      expect(r.requirement.required).toBe(true);
      expect(r.requirement.blocked).toBe(false);
      expect(r.requirement.graceEndsAt?.getTime()).toBe(NOW.getTime() - 2 * DAY + 7 * DAY);
    });
    it("blocks exactly at the deadline", () => {
      const enforcedAt = new Date(NOW.getTime() - 7 * DAY);
      expect(decide({ enforcedAt, memberSince: enforcedAt }).allow).toBe(false);
    });
    it("graceDays 0 blocks immediately", () => {
      expect(decide({ graceDays: 0, enforcedAt: NOW, memberSince: NOW }).allow).toBe(false);
    });
    it("a new member's own clock starts when they join", () => {
      const r = decide({ memberSince: new Date(NOW.getTime() - DAY), enforcedAt: new Date(NOW.getTime() - 30 * DAY) });
      expect(r.allow).toBe(true);
      expect(r.requirement.graceEndsAt?.getTime()).toBe(NOW.getTime() - DAY + 7 * DAY);
    });
  });

  describe("allowlist while blocked", () => {
    it("lets the setup-prompt queries through but nothing else", () => {
      for (const path of TWO_FACTOR_GATE_ALLOWED_PATHS) {
        const r = decide({ path });
        expect(r.allow).toBe(true);
        expect(r.requirement.blocked).toBe(true);
      }
      for (const path of ["tenant.members", "party.list", "invoice.create", "tenant.setSecurityPolicy", "tenant.currentX", "billing.overview"]) {
        expect(decide({ path }).allow).toBe(false);
      }
    });
    it("is exactly tenant.current and billing.status, the same list the clients import", () => {
      expect([...TWO_FACTOR_GATE_ALLOWED_PATHS].sort()).toEqual(["billing.status", "tenant.current"]);
      expect(TWO_FACTOR_GATE_ALLOWED_PATHS).toBe(SHARED_ALLOWED);
    });
  });

  it("a platform admin with no membership is never gated", () => {
    expect(decide({ memberSince: null, role: "" }).allow).toBe(true);
  });
});

describe("twoFactorRequirementView", () => {
  it("reports blocked and the setup path for the caller", () => {
    const v = twoFactorRequirementView({ ...base });
    expect(v).toMatchObject({ required: true, blocked: true, policy: "all", setupPath: TWO_FACTOR_SETUP_PATH });
  });
  it("API keys and members with 2FA get required false", () => {
    expect(twoFactorRequirementView({ ...base, authTokenKind: null }).required).toBe(false);
    expect(twoFactorRequirementView({ ...base, userHasTwoFactor: true }).required).toBe(false);
  });
});

describe("error shape", () => {
  it("is FORBIDDEN with the stable message and data.twoFactor", () => {
    const e = twoFactorRequiredError();
    expect(e.code).toBe("FORBIDDEN");
    expect(e.message).toBe("Your organisation requires two-factor authentication. Set it up in Settings → Account → Security to continue.");
    expect(twoFactorDataOf(e)).toEqual({ required: true, reason: "two_factor_setup_required", setupPath: "/settings?tab=account&pane=security" });
  });
  it("other errors carry no twoFactor data", () => {
    expect(twoFactorDataOf(new Error("x"))).toBeNull();
    expect(twoFactorDataOf(null)).toBeNull();
  });
});

describe("gate cache", () => {
  const entry: GateMembership = { role: "seller", memberSince: NOW, policy: "all", enforcedAt: null, graceDays: 7, hasTwoFactor: false };
  beforeEach(() => clearTwoFactorGateCache());

  it("hits within the TTL and expires after it", () => {
    gateCacheSet("t1", "u1", entry, 1000);
    expect(gateCacheGet("t1", "u1", 1000 + TWO_FACTOR_GATE_CACHE_MS - 1)?.value).toBe(entry);
    expect(gateCacheGet("t1", "u1", 1000 + TWO_FACTOR_GATE_CACHE_MS)).toBeUndefined();
  });

  it("invalidates one member, a whole tenant, or every organisation of a user", () => {
    for (const [t, u] of [["t1", "u1"], ["t1", "u2"], ["t2", "u1"], ["t2", "u2"]] as const) gateCacheSet(t, u, entry);
    invalidateTwoFactorGateMember("t1", "u1");
    expect(gateCacheGet("t1", "u1")).toBeUndefined();
    expect(gateCacheGet("t1", "u2")).toBeDefined();
    invalidateTwoFactorGateTenant("t1");
    expect(gateCacheGet("t1", "u2")).toBeUndefined();
    expect(gateCacheGet("t2", "u1")).toBeDefined();
    invalidateTwoFactorGateUser("u1");
    expect(gateCacheGet("t2", "u1")).toBeUndefined();
    expect(gateCacheGet("t2", "u2")).toBeDefined();
  });

  it("a user id that is a suffix of another is not over-invalidated", () => {
    gateCacheSet("t1", "abc", entry);
    gateCacheSet("t1", "xabc", entry);
    invalidateTwoFactorGateUser("abc");
    expect(gateCacheGet("t1", "abc")).toBeUndefined();
    expect(gateCacheGet("t1", "xabc")).toBeDefined();
  });
});

describe("setSecurityPolicy is allowed while read-only", () => {
  it("is in READ_ONLY_EXEMPT", () => {
    expect(READ_ONLY_EXEMPT.has("tenant.setSecurityPolicy")).toBe(true);
  });
});
