/** gateDecision: the pure read-only / suspended decision, no database. */

import { describe, it, expect } from "vitest";
import type { EntitlementReason } from "@fintranzact/shared";
import { gateDecision, READ_ONLY_EXEMPT, SUSPENDED_ALLOWED } from "../lib/entitlement-exempt.js";

const writable = { readOnly: false, reason: null };
const ro = (reason: EntitlementReason) => ({ readOnly: true, reason });
const READ_ONLY_REASONS: EntitlementReason[] = ["read_only_halted", "read_only_trial_expired", "read_only_subscription_ended"];

describe("gateDecision, writable organisation", () => {
  it("allows everything", () => {
    for (const type of ["query", "mutation", "subscription"] as const) {
      expect(gateDecision({ type, path: "party.create", entitlements: writable })).toEqual({ allow: true });
    }
  });
});

describe("gateDecision, read-only organisation", () => {
  for (const reason of READ_ONLY_REASONS) {
    describe(reason, () => {
      it("allows queries and subscriptions", () => {
        expect(gateDecision({ type: "query", path: "party.list", entitlements: ro(reason) })).toEqual({ allow: true });
        expect(gateDecision({ type: "subscription", path: "x.y", entitlements: ro(reason) })).toEqual({ allow: true });
      });
      it("refuses a mutation not on the allowlist, with the same reason", () => {
        for (const path of ["party.create", "invoice.create", "brand.newMutation"]) {
          expect(gateDecision({ type: "mutation", path, entitlements: ro(reason) })).toEqual({ allow: false, reason });
        }
      });
      it("allows every allowlisted mutation", () => {
        for (const path of READ_ONLY_EXEMPT) {
          expect(gateDecision({ type: "mutation", path, entitlements: ro(reason) })).toEqual({ allow: true });
        }
      });
    });
  }

  it("does not exempt a path by prefix or case", () => {
    expect(gateDecision({ type: "mutation", path: "billing", entitlements: ro("read_only_halted") }).allow).toBe(false);
    expect(gateDecision({ type: "mutation", path: "Auth.logout", entitlements: ro("read_only_halted") }).allow).toBe(false);
    expect(gateDecision({ type: "mutation", path: "auth.logout.extra", entitlements: ro("read_only_halted") }).allow).toBe(false);
  });
});

describe("gateDecision, suspended organisation", () => {
  const suspended = ro("tenant_suspended");
  it("refuses ordinary queries and mutations, including allowlisted tenant mutations", () => {
    expect(gateDecision({ type: "query", path: "party.list", entitlements: suspended })).toEqual({ allow: false, reason: "tenant_suspended" });
    expect(gateDecision({ type: "mutation", path: "party.create", entitlements: suspended })).toEqual({ allow: false, reason: "tenant_suspended" });
    expect(gateDecision({ type: "mutation", path: "business.exportData", entitlements: suspended })).toEqual({ allow: false, reason: "tenant_suspended" });
  });
  it("lets the client render the suspended state", () => {
    for (const path of SUSPENDED_ALLOWED) {
      expect(gateDecision({ type: "query", path, entitlements: suspended })).toEqual({ allow: true });
    }
    expect(SUSPENDED_ALLOWED.has("billing.status")).toBe(true);
  });
});
