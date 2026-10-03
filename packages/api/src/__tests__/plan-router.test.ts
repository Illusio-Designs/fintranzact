import { describe, it, expect } from "vitest";
import { PLAN_LIMITS, PLANS, REMOVED_PLAN_IDS } from "@fintranzact/shared";
import { createCallerFactory, router } from "../trpc.js";
import { planRouter } from "../routers/plan.js";
import { listPublicPlansJson } from "../lib/public-plans.js";

const createCaller = createCallerFactory(router({ plan: planRouter }));

function anonymousCaller() {
  const req = new Request("http://localhost/api/trpc/plan.list", { method: "GET" });
  return createCaller({ user: null, tenantId: null, businessId: null, req, resHeaders: new Headers(), ipAddress: null });
}

describe("plan.list — public plan catalogue", () => {
  it("works without signing in and lists the offered plans in order", async () => {
    const plans = await anonymousCaller().plan.list();
    expect(plans.map((p) => p.id)).toEqual(PLANS.map((p) => p.id));
  });

  it("returns the limits the API enforces and a display price", async () => {
    const plans = await anonymousCaller().plan.list();
    for (const plan of plans) {
      expect(plan.limits).toEqual(PLAN_LIMITS[plan.id]);
      expect(plan.price).toMatch(/^(₹[\d,]+|Custom)$/);
    }
  });
});

describe("GET /api/plans payload", () => {
  it("sends unlimited limits as null so the JSON is valid", async () => {
    const json = JSON.parse(JSON.stringify(await listPublicPlansJson()));
    const business = json.find((p: { id: string }) => p.id === "business");
    expect(business.limits.maxBusinesses).toBeNull();
    const growth = json.find((p: { id: string }) => p.id === "growth");
    expect(growth.limits.maxBusinesses).toBe(PLAN_LIMITS.growth.maxBusinesses);
  });

  it("lists exactly Starter, Growth and Business with monthly and yearly prices, Growth highlighted", async () => {
    const json = JSON.parse(JSON.stringify(await listPublicPlansJson()));
    expect(json.map((p: { id: string }) => p.id)).toEqual(["starter", "growth", "business"]);
    expect(json.map((p: { monthlyPriceInr: number }) => p.monthlyPriceInr)).toEqual([299, 699, 1499]);
    expect(json.map((p: { yearlyPriceInr: number }) => p.yearlyPriceInr)).toEqual([2999, 6999, 14999]);
    expect(json.map((p: { yearlyPrice: string }) => p.yearlyPrice)).toEqual(["₹2,999", "₹6,999", "₹14,999"]);
    expect(json.filter((p: { highlight: boolean }) => p.highlight).map((p: { id: string }) => p.id)).toEqual(["growth"]);
    expect(json.some((p: { id: string }) => (REMOVED_PLAN_IDS as readonly string[]).includes(p.id))).toBe(false);
  });
});
