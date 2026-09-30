import { describe, it, expect } from "vitest";
import { PLAN_LIMITS, PLANS } from "@fintranzact/shared";
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
    const free = json.find((p: { id: string }) => p.id === "forever_free");
    expect(free.limits.maxBusinesses).toBeNull();
    const pro = json.find((p: { id: string }) => p.id === "pro");
    expect(pro.limits.maxBusinesses).toBe(PLAN_LIMITS.pro.maxBusinesses);
  });
});
