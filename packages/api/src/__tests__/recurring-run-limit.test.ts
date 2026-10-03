import { describe, it, expect, vi, afterEach } from "vitest";

const { planRow } = vi.hoisted(() => ({ planRow: { plan: "business" as string | null, status: "active", trialEndsAt: null, accessGrandfathered: false } }));

vi.mock("@fintranzact/db", async () => {
  const actual = await vi.importActual<typeof import("@fintranzact/db")>("@fintranzact/db");
  // Tenant row via .where().limit(); the (empty) subscription list is awaited after .where().
  const where = () => Object.assign(Promise.resolve([] as unknown[]), { limit: async () => [planRow] });
  const chain = { from: () => chain, where };
  return { ...actual, controlDb: { select: () => chain } };
});

// No platform-admin edits: each plan has its built-in limits.
vi.mock("../lib/plan-catalog.js", async () => {
  const { PLAN_DEFAULTS } = await vi.importActual<typeof import("@fintranzact/shared")>("@fintranzact/shared");
  return {
    getPlanLimits: async (plan: string) =>
      (PLAN_DEFAULTS[plan as keyof typeof PLAN_DEFAULTS] ?? PLAN_DEFAULTS.starter).limits,
  };
});

import { PLAN_LIMITS } from "@fintranzact/shared";
import { clearEntitlementsCache } from "../lib/entitlements-cache.js";
import { recurringRunLimit, RECURRING_RUNS_PER_MONTH_SELF_HOSTED } from "../lib/plan-limits.js";

describe("recurringRunLimit — monthly recurring-invoice runs by plan", () => {
  const original = process.env.MULTI_TENANT;
  afterEach(() => {
    clearEntitlementsCache();
    process.env.MULTI_TENANT = original;
  });

  it("follows each plan's own allowance on the hosted service (all three plans: unlimited by default)", async () => {
    process.env.MULTI_TENANT = "true";
    for (const plan of ["starter", "growth", "business"] as const) {
      planRow.plan = plan;
      clearEntitlementsCache();
      expect(await recurringRunLimit("tenant-1")).toBe(PLAN_LIMITS[plan].recurringRunsPerMonth);
      expect(await recurringRunLimit("tenant-1")).toBe(Infinity);
    }
  });

  it("uses the Starter allowance on self-hosted installs", async () => {
    process.env.MULTI_TENANT = "false";
    planRow.plan = "business";
    expect(await recurringRunLimit("single")).toBe(RECURRING_RUNS_PER_MONTH_SELF_HOSTED);
    expect(RECURRING_RUNS_PER_MONTH_SELF_HOSTED).toBe(PLAN_LIMITS.starter.recurringRunsPerMonth);
  });
});
