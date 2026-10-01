import { describe, it, expect } from "vitest";
import { needsPlanSelection, planSelectionMode } from "../plan-selection";

describe("planSelectionMode", () => {
  it("lets the owner of a free organisation choose a plan", () => {
    expect(planSelectionMode({ role: "owner", tenantPlan: "forever_free" })).toBe("choose");
    expect(planSelectionMode({ role: "owner", tenantPlan: "free" })).toBe("choose");
    expect(planSelectionMode({ role: "superadmin", tenantPlan: "free" })).toBe("choose");
  });

  it("keeps a paid plan instead of resetting it to Forever Free", () => {
    for (const plan of ["pro", "business", "enterprise"]) {
      expect(planSelectionMode({ role: "owner", tenantPlan: plan })).toBe("managed");
    }
  });

  it("never lets a non-owner change the plan", () => {
    for (const role of ["admin", "member", "viewer", "seller_manager", "seller", "accountant"]) {
      expect(planSelectionMode({ role, tenantPlan: "forever_free" })).toBe("not-owner");
      expect(planSelectionMode({ role, tenantPlan: "pro" })).toBe("not-owner");
    }
  });
});

describe("needsPlanSelection", () => {
  it("sends the owner of an organisation that has not chosen a plan to the plan page", () => {
    expect(needsPlanSelection({ role: "owner", planSelectedAt: null })).toBe(true);
    expect(needsPlanSelection({ role: "superadmin", planSelectedAt: null })).toBe(true);
  });

  it("lets through an organisation that has chosen", () => {
    expect(needsPlanSelection({ role: "owner", planSelectedAt: "2026-10-01T10:00:00.000Z" })).toBe(false);
  });

  it("never holds up other roles", () => {
    for (const role of ["admin", "member", "viewer", "seller_manager", "seller", "accountant"]) {
      expect(needsPlanSelection({ role, planSelectedAt: null })).toBe(false);
    }
  });

  it("waits until the organisation is known", () => {
    expect(needsPlanSelection(undefined)).toBe(false);
    expect(needsPlanSelection(null)).toBe(false);
  });
});
