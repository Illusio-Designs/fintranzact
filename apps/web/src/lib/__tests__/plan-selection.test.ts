import { describe, it, expect } from "vitest";
import { needsPlanSelection, planSelectionMode } from "../plan-selection";

describe("planSelectionMode", () => {
  it("lets the owner choose a plan, whichever plan the organisation is on", () => {
    for (const plan of ["starter", "growth", "business"]) {
      expect(planSelectionMode({ role: "owner", tenantPlan: plan })).toBe("choose");
      expect(planSelectionMode({ role: "superadmin", tenantPlan: plan })).toBe("choose");
    }
  });

  it("never lets a non-owner change the plan", () => {
    for (const role of ["admin", "member", "viewer", "seller_manager", "seller", "accountant"]) {
      expect(planSelectionMode({ role, tenantPlan: "starter" })).toBe("not-owner");
      expect(planSelectionMode({ role, tenantPlan: "growth" })).toBe("not-owner");
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
