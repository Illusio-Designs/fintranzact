import { describe, it, expect, vi, afterEach } from "vitest";

const { planRow } = vi.hoisted(() => ({ planRow: { plan: "forever_free" as string | null } }));

vi.mock("@fintranzact/db", async () => {
  const actual = await vi.importActual<typeof import("@fintranzact/db")>("@fintranzact/db");
  const chain = { from: () => chain, where: () => chain, limit: async () => [planRow] };
  return { ...actual, controlDb: { select: () => chain } };
});

// No platform-admin edits: each plan has its built-in limits.
vi.mock("../lib/plan-catalog.js", async () => {
  const { PLAN_DEFAULTS } = await vi.importActual<typeof import("@fintranzact/shared")>("@fintranzact/shared");
  return {
    getPlanLimits: async (plan: string) =>
      (PLAN_DEFAULTS[plan as keyof typeof PLAN_DEFAULTS] ?? PLAN_DEFAULTS.free).limits,
  };
});

import { recurringRunLimit, RECURRING_RUNS_PER_MONTH_FREE } from "../lib/plan-limits.js";

describe("recurringRunLimit — monthly recurring-invoice runs by plan", () => {
  const original = process.env.MULTI_TENANT;
  afterEach(() => {
    process.env.MULTI_TENANT = original;
  });

  it("is unlimited for Forever Free organizations on the hosted service", async () => {
    process.env.MULTI_TENANT = "true";
    planRow.plan = "forever_free";
    expect(await recurringRunLimit("tenant-1")).toBe(Infinity);
  });

  it("keeps the legacy free allowance for legacy free organizations", async () => {
    process.env.MULTI_TENANT = "true";
    planRow.plan = "free";
    expect(await recurringRunLimit("tenant-1")).toBe(RECURRING_RUNS_PER_MONTH_FREE);
  });

  it("keeps the original allowance on self-hosted installs", async () => {
    process.env.MULTI_TENANT = "false";
    planRow.plan = "forever_free";
    expect(await recurringRunLimit("single")).toBe(RECURRING_RUNS_PER_MONTH_FREE);
  });
});
