/**
 * Server-side entitlements with the data layer scripted (no Postgres):
 * what getEntitlements loads, what the 30s cache keeps, when lazy billing
 * transitions run, and the exact error shape of the refusals.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  tenant: { plan: "pro", status: "active", trialEndsAt: null } as { plan: string; status: string; trialEndsAt: Date | null } | null,
  subs: [] as Array<Record<string, unknown>>,
  loads: 0, // organisation-row reads (every call)
  wheres: 0, // all where() calls: row reads + subscription loads
  lazy: vi.fn(async () => {}),
}));

vi.mock("@fintranzact/db", async () => {
  const actual = await vi.importActual<typeof import("@fintranzact/db")>("@fintranzact/db");
  // Tenant row comes through .where().limit(); the subscription list is awaited after .where().
  const where = () => {
    h.wheres++;
    return Object.assign(Promise.resolve(h.subs), {
      limit: async () => {
        h.loads++;
        return h.tenant ? [h.tenant] : [];
      },
    });
  };
  const chain = { from: () => chain, where };
  return { ...actual, controlDb: { select: () => chain } };
});

vi.mock("../lib/plan-catalog.js", async () => {
  const { PLAN_DEFAULTS } = await vi.importActual<typeof import("@fintranzact/shared")>("@fintranzact/shared");
  return { getPlanLimits: async (plan: string) => (PLAN_DEFAULTS[plan as keyof typeof PLAN_DEFAULTS] ?? PLAN_DEFAULTS.free).limits };
});

vi.mock("../lib/billing/service.js", () => ({ applyLazyTransitions: h.lazy }));

import { TRPCError } from "@trpc/server";
import { PLAN_DEFAULTS } from "@fintranzact/shared";
import { assertWritable, clearEntitlementsCache, getEntitlements, invalidateEntitlements, requireAddon } from "../lib/entitlements.js";
import { entitlementDataOf, entitlementError, limitError } from "../lib/entitlement-error.js";
import { router } from "../trpc.js";

const DAY = 86_400_000;
/** Subscription-list loads: the where() calls that were not organisation-row reads. */
const subLoads = () => h.wheres - h.loads;
const planSub = (over: Record<string, unknown> = {}) => ({
  kind: "plan", addon: null, status: "active", graceUntil: null, currentPeriodEnd: new Date(Date.now() + 10 * DAY), ...over,
});

beforeEach(() => {
  clearEntitlementsCache();
  h.tenant = { plan: "pro", status: "active", trialEndsAt: null };
  h.subs = [];
  h.loads = 0;
  h.wheres = 0;
  h.lazy.mockClear();
});

async function refusal(p: Promise<unknown>): Promise<TRPCError> {
  try {
    await p;
  } catch (e) {
    return e as TRPCError;
  }
  throw new Error("expected a refusal");
}

describe("getEntitlements", () => {
  it("never-subscribed organisations are writable and carry the plan's limits", async () => {
    h.tenant!.plan = "business";
    const ent = await getEntitlements("t1");
    expect(ent).toMatchObject({ state: "free", readOnly: false, reason: null, plan: "business" });
    expect(ent.limits).toEqual(PLAN_DEFAULTS.business.limits);
    await expect(assertWritable("t1")).resolves.toBeTruthy();
  });

  it("an unknown organisation falls back to the legacy free defaults and stays writable", async () => {
    h.tenant = null;
    expect(await getEntitlements("ghost")).toMatchObject({ plan: "free", readOnly: false });
  });

  it("reads add-ons from active add-on subscriptions", async () => {
    h.subs = [planSub(), { kind: "addon", addon: "payroll", status: "active", graceUntil: null, currentPeriodEnd: null }];
    expect((await getEntitlements("t1")).addons).toMatchObject({ payroll: true, store_pro: false });
  });

  it("caches the subscription data per organisation for the cache window and reloads it after invalidation", async () => {
    await getEntitlements("t1");
    await getEntitlements("t1");
    expect(subLoads()).toBe(1);
    expect(h.loads).toBe(2); // the organisation row is read on every call
    await getEntitlements("t2");
    expect(subLoads()).toBe(2);
    h.subs = [planSub({ status: "halted" })];
    expect((await getEntitlements("t1")).readOnly).toBe(false); // still the cached subscription picture
    invalidateEntitlements("t1");
    expect((await getEntitlements("t1")).readOnly).toBe(true);
  });

  it("shows a plan, status or trial change at once, with no invalidation (the organisation row is never cached)", async () => {
    h.tenant!.plan = "free";
    expect((await getEntitlements("t1")).limits.maxBusinesses).toBe(PLAN_DEFAULTS.free.limits.maxBusinesses);
    h.tenant!.plan = "forever_free"; // changed behind the cache's back (another process, a direct edit, a request in flight)
    expect((await getEntitlements("t1")).limits).toEqual(PLAN_DEFAULTS.forever_free.limits);
    h.tenant!.status = "suspended";
    expect(await getEntitlements("t1")).toMatchObject({ readOnly: true, reason: "tenant_suspended" });
  });

  it("applies the clock on every call, so a trial ends on time inside the cache window", async () => {
    const now = new Date("2026-10-02T10:00:00Z");
    h.tenant!.trialEndsAt = new Date(now.getTime() + DAY / 2);
    expect(await getEntitlements("t1", now)).toMatchObject({ state: "trialing", trialDaysLeft: 1 });
    const later = new Date(now.getTime() + DAY);
    expect(await getEntitlements("t1", later)).toMatchObject({ state: "trial_expired", readOnly: true });
    expect(subLoads()).toBe(1);
  });

  describe("lazy billing transitions", () => {
    it("run only when one is due", async () => {
      h.subs = [planSub()];
      await getEntitlements("t1");
      expect(h.lazy).not.toHaveBeenCalled();
    });

    it("run when grace is over, and the reloaded state is used", async () => {
      h.subs = [planSub({ status: "past_due", graceUntil: new Date(Date.now() - 1000) })];
      h.lazy.mockImplementationOnce(async () => {
        h.subs = [planSub({ status: "halted" })];
      });
      const ent = await getEntitlements("t1");
      expect(h.lazy).toHaveBeenCalledWith("t1");
      expect(ent).toMatchObject({ state: "halted", readOnly: true, reason: "read_only_halted" });
    });

    it("run when a period has ended (cancel at period end, downgrade, demo renewal)", async () => {
      h.subs = [planSub({ currentPeriodEnd: new Date(Date.now() - 1000) })];
      await getEntitlements("t1");
      expect(h.lazy).toHaveBeenCalledTimes(1);
    });

    it("run once per load, not once per call", async () => {
      h.subs = [planSub({ currentPeriodEnd: new Date(Date.now() - 1000) })];
      await getEntitlements("t1");
      await getEntitlements("t1");
      expect(h.lazy).toHaveBeenCalledTimes(1);
    });
  });
});

describe("assertWritable", () => {
  it("refuses a halted organisation with FORBIDDEN, 'Choose a plan' and the reason", async () => {
    h.subs = [planSub({ status: "halted" })];
    const err = await refusal(assertWritable("t1"));
    expect(err).toBeInstanceOf(TRPCError);
    expect(err.code).toBe("FORBIDDEN");
    expect(err.message).toContain("Choose a plan");
    expect(entitlementDataOf(err)).toEqual({ reason: "read_only_halted", upgradePath: "/settings?tab=billing" });
  });

  it("refuses an expired trial and an ended plan with their own reasons", async () => {
    h.tenant!.trialEndsAt = new Date(Date.now() - DAY);
    expect(entitlementDataOf(await refusal(assertWritable("t1")))?.reason).toBe("read_only_trial_expired");
    clearEntitlementsCache();
    h.subs = [planSub({ status: "cancelled" })];
    expect(entitlementDataOf(await refusal(assertWritable("t1")))?.reason).toBe("read_only_subscription_ended");
  });

  it("refuses a suspended organisation", async () => {
    h.tenant!.status = "suspended";
    expect(entitlementDataOf(await refusal(assertWritable("t1")))?.reason).toBe("tenant_suspended");
  });

  it("lets a live subscription beat an expired trial", async () => {
    h.tenant!.trialEndsAt = new Date(Date.now() - DAY);
    h.subs = [planSub()];
    await expect(assertWritable("t1")).resolves.toBeTruthy();
  });
});

describe("requireAddon", () => {
  it("passes when the add-on is active", async () => {
    h.subs = [planSub(), { kind: "addon", addon: "store_pro", status: "active", graceUntil: null, currentPeriodEnd: null }];
    await expect(requireAddon("t1", "store_pro")).resolves.toBeTruthy();
  });

  it("refuses with addon_required naming the add-on", async () => {
    const err = await refusal(requireAddon("t1", "payroll"));
    expect(err.code).toBe("FORBIDDEN");
    expect(err.message).toContain("Payroll");
    expect(entitlementDataOf(err)).toEqual({ reason: "addon_required", upgradePath: "/settings?tab=billing", addon: "payroll" });
  });

  it("gives the read-only message, not 'buy the add-on', to a read-only organisation", async () => {
    h.subs = [planSub({ status: "halted" }), { kind: "addon", addon: "payroll", status: "active", graceUntil: null, currentPeriodEnd: null }];
    const err = await refusal(requireAddon("t1", "payroll"));
    expect(entitlementDataOf(err)?.reason).toBe("read_only_halted");
  });
});

describe("error shape", () => {
  it("limitError keeps the caller's message and tags plan_limit", () => {
    const err = limitError("Your plan allows up to 3 businesses. Upgrade to add more.");
    expect(err.code).toBe("FORBIDDEN");
    expect(err.message).toBe("Your plan allows up to 3 businesses. Upgrade to add more.");
    expect(entitlementDataOf(err)).toEqual({ reason: "plan_limit", upgradePath: "/settings?tab=billing" });
  });

  it("an ordinary error carries no entitlement data", () => {
    expect(entitlementDataOf(new TRPCError({ code: "FORBIDDEN", message: "nope" }))).toBeNull();
  });

  it("the tRPC error formatter surfaces it as data.entitlement", () => {
    const err = entitlementError("read_only_trial_expired");
    const config = (router({}) as unknown as { _def: { _config: { errorFormatter: (o: unknown) => { message: string; data: Record<string, unknown> } } } })._def._config;
    const shape = config.errorFormatter({
      error: err,
      type: "mutation",
      path: "invoice.create",
      input: undefined,
      ctx: undefined,
      shape: { message: err.message, code: -32003, data: { code: "FORBIDDEN", httpStatus: 403, path: "invoice.create" } },
    });
    expect(shape.message).toContain("Choose a plan");
    expect(shape.data.entitlement).toEqual({ reason: "read_only_trial_expired", upgradePath: "/settings?tab=billing" });
    expect(shape.data.code).toBe("FORBIDDEN");
  });
});
