/**
 * What a new organisation starts with (no database): the plan it is on, the
 * trial it gets, and the refusal of removed plan ids.
 */

import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";
import { DEFAULT_SIGNUP_PLAN, TRIAL_DAYS, deriveAccess } from "@fintranzact/shared";
import { newOrganisationPlanFields, resolveSignupPlan, trialEndsAtFrom } from "../lib/signup-plan.js";

const now = new Date("2026-10-03T09:00:00Z");
const DAY = 86_400_000;

describe("resolveSignupPlan", () => {
  it("keeps a current plan id", () => {
    expect(resolveSignupPlan("starter")).toBe("starter");
    expect(resolveSignupPlan("growth")).toBe("growth");
    expect(resolveSignupPlan("business")).toBe("business");
    expect(resolveSignupPlan("  starter ")).toBe("starter");
  });

  it("defaults to Growth when none is named", () => {
    expect(DEFAULT_SIGNUP_PLAN).toBe("growth");
    expect(resolveSignupPlan(undefined)).toBe("growth");
    expect(resolveSignupPlan(null)).toBe("growth");
    expect(resolveSignupPlan("")).toBe("growth");
  });

  it("defaults to Growth for an id nobody ever had", () => {
    expect(resolveSignupPlan("platinum")).toBe("growth");
  });

  it("refuses every removed plan id with a clear BAD_REQUEST", () => {
    for (const removed of ["free", "forever_free", "pro", "enterprise"]) {
      let err: unknown;
      try {
        resolveSignupPlan(removed);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe("BAD_REQUEST");
      expect((err as TRPCError).message).toBe(`The ${removed} plan has been removed. Choose Starter, Growth or Business.`);
    }
  });
});

describe("newOrganisationPlanFields", () => {
  it("starts a 14-day trial", () => {
    expect(TRIAL_DAYS).toBe(14);
    expect(trialEndsAtFrom(now)).toEqual(new Date(now.getTime() + 14 * DAY));
    expect(newOrganisationPlanFields(null, now).trialEndsAt).toEqual(new Date("2026-10-17T09:00:00Z"));
  });

  it("records the plan as chosen only when the owner named one", () => {
    expect(newOrganisationPlanFields("starter", now)).toMatchObject({ plan: "starter", planSelectedAt: now });
    expect(newOrganisationPlanFields(undefined, now)).toMatchObject({ plan: "growth", planSelectedAt: null });
    expect(newOrganisationPlanFields("platinum", now)).toMatchObject({ plan: "growth", planSelectedAt: null });
  });

  it("refuses a removed plan before building anything", () => {
    expect(() => newOrganisationPlanFields("free", now)).toThrow(/has been removed/);
  });

  it("gives full access through the trial (deriveAccess), then read-only until a plan is bought", () => {
    const { plan, trialEndsAt } = newOrganisationPlanFields("growth", now);
    const input = { plan, tenantStatus: "active", trialEndsAt, planSubscription: null, everHadPlanSubscription: false, addons: [] };
    expect(deriveAccess({ ...input, now })).toMatchObject({ state: "trialing", readOnly: false, trialDaysLeft: 14 });
    expect(deriveAccess({ ...input, now: new Date(now.getTime() + 13 * DAY) })).toMatchObject({ state: "trialing", readOnly: false, trialDaysLeft: 1 });
    expect(deriveAccess({ ...input, now: new Date(now.getTime() + 15 * DAY) })).toMatchObject({
      state: "trial_expired",
      readOnly: true,
      reason: "read_only_trial_expired",
    });
  });
});
