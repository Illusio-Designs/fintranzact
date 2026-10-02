/**
 * Pure decisions behind the remaining plan-limit enforcement (no database):
 * store availability, recurring-run allowance, API key usability, the audit
 * window, the scheduler's read-only skip and its date fast-forward, and the
 * add-on map.
 */

import { describe, it, expect, vi } from "vitest";
import { ADDON_FEATURES, ADDON_IDS, PLAN_IDS, PLAN_LIMITS } from "@fintranzact/shared";
import { storeAvailable, recurringRunAllowed, apiKeyUsable, auditWindowStart } from "../lib/plan-limits.js";
import { tickTenant, type TenantTickDeps } from "../lib/recurring-invoice-scheduler.js";
import { nextRunDateAfter } from "../lib/recurring-invoice-generator.js";

describe("storeAvailable", () => {
  const ok = { readOnly: false, reason: null, limits: { onlineStore: true } };
  it("serves a writable organisation whose plan has the store", () => expect(storeAvailable(ok)).toBe(true));
  it("refuses a plan without the online store", () => expect(storeAvailable({ ...ok, limits: { onlineStore: false } })).toBe(false));
  it("refuses a read-only organisation (orders are writes)", () =>
    expect(storeAvailable({ ...ok, readOnly: true, reason: "trial_ended" })).toBe(false));
  it("refuses a suspended organisation", () =>
    expect(storeAvailable({ ...ok, readOnly: false, reason: "tenant_suspended" })).toBe(false));
});

describe("recurringRunAllowed", () => {
  it("allows below the limit and refuses at it", () => {
    expect(recurringRunAllowed(4, 5)).toBe(true);
    expect(recurringRunAllowed(5, 5)).toBe(false);
    expect(recurringRunAllowed(9, 5)).toBe(false);
  });
  it("is unlimited for Infinity", () => expect(recurringRunAllowed(10_000, Infinity)).toBe(true));
  it("refuses everything for a limit of 0", () => expect(recurringRunAllowed(0, 0)).toBe(false));
});

describe("apiKeyUsable", () => {
  it("honours keys on a plan that has them", () => expect(apiKeyUsable({ reason: null, limits: { maxApiKeys: 3 } })).toBe(true));
  it("honours keys while read-only (the gate refuses their writes)", () =>
    expect(apiKeyUsable({ reason: "trial_ended", limits: { maxApiKeys: 3 } })).toBe(true));
  it("refuses keys of a suspended organisation", () =>
    expect(apiKeyUsable({ reason: "tenant_suspended", limits: { maxApiKeys: 3 } })).toBe(false));
  it("refuses keys when the plan allows none", () => expect(apiKeyUsable({ reason: null, limits: { maxApiKeys: 0 } })).toBe(false));
  it("honours keys on an unlimited plan", () => expect(apiKeyUsable({ reason: null, limits: { maxApiKeys: Infinity } })).toBe(true));
});

describe("auditWindowStart", () => {
  const now = new Date("2026-06-30T00:00:00Z");
  it("is the cut-off for a finite retention", () =>
    expect(auditWindowStart(30, now)).toEqual(new Date("2026-05-31T00:00:00Z")));
  it("has no cut-off when unlimited", () => {
    expect(auditWindowStart(null, now)).toBeNull();
    expect(auditWindowStart(Infinity, now)).toBeNull();
  });
});

describe("PDF branding defaults", () => {
  it("match the old `plan !== free` rule for every plan", () => {
    for (const id of PLAN_IDS) expect(!PLAN_LIMITS[id].pdfBranding, id).toBe(id !== "free");
  });
});

describe("ADDON_FEATURES", () => {
  it("describes every add-on, none implemented yet", () => {
    expect(Object.keys(ADDON_FEATURES).sort()).toEqual([...ADDON_IDS].sort());
    for (const id of ADDON_IDS) expect(ADDON_FEATURES[id].implemented).toBe(false);
  });
});

describe("tickTenant", () => {
  function deps(readOnly: boolean): TenantTickDeps & { process: ReturnType<typeof vi.fn>; skip: ReturnType<typeof vi.fn> } {
    const db = {} as never;
    return {
      readOnly: async () => readOnly,
      runsPerMonth: async () => 5,
      getDb: async () => db,
      process: vi.fn(async () => {}),
      skip: vi.fn(async () => {}),
    };
  }
  it("skips a read-only organisation without generating", async () => {
    const d = deps(true);
    expect(await tickTenant("t1", d)).toBe("skipped");
    expect(d.skip).toHaveBeenCalledTimes(1);
    expect(d.process).not.toHaveBeenCalled();
  });
  it("processes a writable organisation with its plan allowance", async () => {
    const d = deps(false);
    expect(await tickTenant("t1", d)).toBe("processed");
    expect(d.process).toHaveBeenCalledWith(expect.anything(), 5);
    expect(d.skip).not.toHaveBeenCalled();
  });
});

describe("nextRunDateAfter", () => {
  const now = new Date("2026-06-15T12:00:00Z");
  it("steps a lapsed monthly template to the next future date, no burst", () => {
    const next = nextRunDateAfter(new Date("2026-03-01T00:00:00Z"), "monthly", null, now);
    expect(next).toEqual(new Date("2026-07-01T00:00:00Z"));
  });
  it("leaves a future date alone", () => {
    const future = new Date("2026-07-01T00:00:00Z");
    expect(nextRunDateAfter(future, "monthly", null, now)).toEqual(future);
  });
  it("handles custom intervals and stops on an unknown frequency", () => {
    expect(nextRunDateAfter(new Date("2026-06-01T00:00:00Z"), "custom", 10, now)).toEqual(new Date("2026-06-21T00:00:00Z"));
    const stuck = new Date("2026-01-01T00:00:00Z");
    expect(nextRunDateAfter(stuck, "bogus", null, now)).toEqual(stuck);
  });
});
