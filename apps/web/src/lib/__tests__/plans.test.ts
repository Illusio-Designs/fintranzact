import { describe, it, expect } from "vitest";
import { FALLBACK_PLANS, planPriceDisplay } from "../plans";

describe("planPriceDisplay", () => {
  const growth = FALLBACK_PLANS.find((p) => p.id === "growth")!;

  it("shows the monthly price ex-GST", () => {
    expect(planPriceDisplay(growth, "monthly")).toEqual({ amount: "₹699", unit: "/month", saving: null, gst: "+ 18% GST" });
  });

  it("shows the yearly price with the two-months-free note", () => {
    expect(planPriceDisplay(growth, "yearly")).toEqual({ amount: "₹6,999", unit: "/year", saving: "2 months free", gst: "+ 18% GST" });
  });

  it("shows Custom, with no GST note, for a plan priced on request", () => {
    expect(planPriceDisplay({ monthlyPriceInr: null, price: "Custom", yearlyPrice: "Custom" }, "yearly")).toEqual({
      amount: "Custom",
      unit: "",
      saving: null,
      gst: "",
    });
  });

  it("offers exactly Starter, Growth and Business, with Growth highlighted and no free plan", () => {
    expect(FALLBACK_PLANS.map((p) => p.id)).toEqual(["starter", "growth", "business"]);
    expect(FALLBACK_PLANS.filter((p) => p.highlight).map((p) => p.id)).toEqual(["growth"]);
    for (const plan of FALLBACK_PLANS) expect(plan.monthlyPriceInr).toBeGreaterThan(0);
  });
});
