import { describe, it, expect } from "vitest";
import { planSelectionMode } from "../plan-selection";

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
