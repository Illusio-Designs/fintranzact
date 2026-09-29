import { describe, it, expect } from "vitest";
import { PLANS, PLAN_LIMITS, formatPlanLimit, formatPlanPrice } from "../plans.js";

describe("plan catalogue", () => {
  it("every offered plan has limits the API can enforce", () => {
    for (const plan of PLANS) expect(PLAN_LIMITS[plan.id]).toBeDefined();
  });

  it("formats prices", () => {
    expect(formatPlanPrice({ monthlyPriceInr: 0 })).toBe("₹0");
    expect(formatPlanPrice({ monthlyPriceInr: 149900 })).toBe("₹1,49,900");
    expect(formatPlanPrice({ monthlyPriceInr: null })).toBe("Custom");
  });

  it("formats limits the way the pricing page shows them", () => {
    expect(formatPlanLimit(Infinity)).toBe("Unlimited");
    expect(formatPlanLimit(null, "days")).toBe("Unlimited");
    expect(formatPlanLimit(15)).toBe("15");
    expect(formatPlanLimit(365, "days")).toBe("1 year");
    expect(formatPlanLimit(30, "days")).toBe("30 days");
  });

  it("keeps the enforced Pro limits", () => {
    expect(PLAN_LIMITS.pro).toMatchObject({ maxOwnedOrgs: 3, maxBusinesses: 5, maxTeamMembers: 15, maxApiKeys: 3 });
  });
});
