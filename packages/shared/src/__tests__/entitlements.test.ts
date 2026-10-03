import { describe, it, expect } from "vitest";
import { deriveAccess, entitlementMessage, isReadOnlyReason, READ_ONLY_MESSAGE, READ_ONLY_REASON_MESSAGES, type AccessInput } from "../entitlements.js";

const now = new Date("2026-10-02T10:00:00Z");
const day = 86_400_000;
const at = (ms: number) => new Date(now.getTime() + ms);

function input(over: Partial<AccessInput> = {}): AccessInput {
  return {
    plan: "growth",
    tenantStatus: "active",
    trialEndsAt: null,
    planSubscription: null,
    everHadPlanSubscription: false,
    addons: [],
    now,
    ...over,
  };
}
const sub = (status: "active" | "past_due" | "halted" | "cancelled" | "created", graceUntil: Date | null = null) => ({
  status,
  graceUntil,
  currentPeriodEnd: at(10 * day),
});

describe("deriveAccess", () => {
  it("never-subscribed, no trial organisations stay writable (fixtures, admin-created organisations)", () => {
    for (const plan of ["starter", "growth", "business"]) {
      const a = deriveAccess(input({ plan }));
      expect(a).toMatchObject({ state: "free", readOnly: false, reason: null, trialDaysLeft: null });
    }
  });

  describe("grandfathered organisations (former Forever Free)", () => {
    it("have permanent full access whatever the billing state", () => {
      const states = [
        input({}),
        input({ trialEndsAt: at(-30 * day) }), // trial long over
        input({ trialEndsAt: at(-1) , everHadPlanSubscription: true }),
        input({ planSubscription: sub("halted"), everHadPlanSubscription: true }),
        input({ planSubscription: sub("past_due", at(-day)), everHadPlanSubscription: true }),
      ];
      for (const s of states) {
        const a = deriveAccess({ ...s, plan: "business", accessGrandfathered: true });
        expect(a).toMatchObject({ state: "grandfathered", readOnly: false, reason: null, trialDaysLeft: null });
      }
    });

    it("can still buy add-ons, but a suspended organisation is blocked even if grandfathered", () => {
      const a = deriveAccess(input({ accessGrandfathered: true, addons: [{ addon: "payroll", status: "active" }] }));
      expect(a.addons.payroll).toBe(true);
      const s = deriveAccess(input({ accessGrandfathered: true, tenantStatus: "suspended" }));
      expect(s).toMatchObject({ state: "suspended", readOnly: true, reason: "tenant_suspended" });
    });

    it("are not read-only when the flag is false or missing (trial over still bites)", () => {
      expect(deriveAccess(input({ trialEndsAt: at(-day) })).readOnly).toBe(true);
      expect(deriveAccess(input({ trialEndsAt: at(-day), accessGrandfathered: false })).readOnly).toBe(true);
    });
  });

  it("suspended and deleted organisations are blocked and have no add-ons", () => {
    for (const tenantStatus of ["suspended", "deleted"]) {
      const a = deriveAccess(input({
        tenantStatus,
        planSubscription: sub("active"),
        addons: [{ addon: "payroll", status: "active" }],
      }));
      expect(a).toMatchObject({ state: "suspended", readOnly: true, reason: "tenant_suspended" });
      expect(a.addons.payroll).toBe(false);
    }
  });

  it("active plan subscription is writable", () => {
    expect(deriveAccess(input({ planSubscription: sub("active"), everHadPlanSubscription: true }))).toMatchObject({
      state: "active", readOnly: false, reason: null,
    });
  });

  it("past_due inside grace is writable and reports the deadline", () => {
    const grace = at(3 * day);
    const a = deriveAccess(input({ planSubscription: sub("past_due", grace), everHadPlanSubscription: true }));
    expect(a).toMatchObject({ state: "past_due_grace", readOnly: false, reason: null });
    expect(a.graceUntil).toEqual(grace);
  });

  it("grace boundary: exactly at the deadline is still writable, one ms later is read-only", () => {
    const grace = new Date(now);
    expect(deriveAccess(input({ planSubscription: sub("past_due", grace), everHadPlanSubscription: true })).readOnly).toBe(false);
    const past = at(-1);
    const a = deriveAccess(input({ planSubscription: sub("past_due", past), everHadPlanSubscription: true }));
    expect(a).toMatchObject({ state: "halted", readOnly: true, reason: "read_only_halted" });
  });

  it("past_due with no deadline counts as inside grace", () => {
    expect(deriveAccess(input({ planSubscription: sub("past_due"), everHadPlanSubscription: true })).state).toBe("past_due_grace");
  });

  it("halted subscription is read-only", () => {
    expect(deriveAccess(input({ planSubscription: sub("halted"), everHadPlanSubscription: true }))).toMatchObject({
      state: "halted", readOnly: true, reason: "read_only_halted",
    });
  });

  it("running trial is writable with days left rounded up", () => {
    expect(deriveAccess(input({ trialEndsAt: at(14 * day) })).trialDaysLeft).toBe(14);
    expect(deriveAccess(input({ trialEndsAt: at(13 * day + 1) })).trialDaysLeft).toBe(14);
    expect(deriveAccess(input({ trialEndsAt: at(1) })).trialDaysLeft).toBe(1);
    const a = deriveAccess(input({ trialEndsAt: at(2.5 * day) }));
    expect(a).toMatchObject({ state: "trialing", readOnly: false, reason: null, trialDaysLeft: 3 });
  });

  it("expired trial with no subscription is read-only; exactly at the end is expired", () => {
    expect(deriveAccess(input({ trialEndsAt: at(-day) }))).toMatchObject({
      state: "trial_expired", readOnly: true, reason: "read_only_trial_expired", trialDaysLeft: null,
    });
    expect(deriveAccess(input({ trialEndsAt: new Date(now) })).state).toBe("trial_expired");
  });

  it("a live subscription beats an expired trial", () => {
    expect(deriveAccess(input({ trialEndsAt: at(-day), planSubscription: sub("active"), everHadPlanSubscription: true }))).toMatchObject({
      state: "active", readOnly: false,
    });
    expect(deriveAccess(input({ trialEndsAt: at(-day), planSubscription: sub("past_due", at(day)), everHadPlanSubscription: true })).readOnly).toBe(false);
  });

  it("a live subscription beats a running trial too (no trialDaysLeft)", () => {
    const a = deriveAccess(input({ trialEndsAt: at(5 * day), planSubscription: sub("active"), everHadPlanSubscription: true }));
    expect(a.state).toBe("active");
    expect(a.trialDaysLeft).toBeNull();
  });

  it("ended / cancelled plan with no live subscription is read-only", () => {
    expect(deriveAccess(input({ everHadPlanSubscription: true }))).toMatchObject({
      state: "ended", readOnly: true, reason: "read_only_subscription_ended",
    });
    // …even when an old trial date is in the past
    expect(deriveAccess(input({ everHadPlanSubscription: true, trialEndsAt: at(-day) })).reason).toBe("read_only_subscription_ended");
  });

  it("a running trial keeps an organisation whose earlier plan ended writable", () => {
    expect(deriveAccess(input({ everHadPlanSubscription: true, trialEndsAt: at(3 * day) })).state).toBe("trialing");
  });

  describe("add-ons", () => {
    const addons = [
      { addon: "payroll", status: "active" as const },
      { addon: "store_pro", status: "past_due" as const, graceUntil: at(day) },
      { addon: "ai_assistant", status: "halted" as const },
    ];

    it("enabled while active or past_due within grace; halted or unknown ones are not", () => {
      const a = deriveAccess(input({ planSubscription: sub("active"), everHadPlanSubscription: true, addons: [...addons, { addon: "bogus", status: "active" }] }));
      expect(a.addons).toEqual({ ai_assistant: false, ai_plus: false, payroll: true, store_pro: true });
    });

    it("past_due add-on past its grace is disabled", () => {
      const a = deriveAccess(input({ addons: [{ addon: "payroll", status: "past_due", graceUntil: at(-1) }] }));
      expect(a.addons.payroll).toBe(false);
    });

    it("all disabled while the organisation is read-only", () => {
      for (const over of [
        { planSubscription: sub("halted"), everHadPlanSubscription: true },
        { trialEndsAt: at(-day) },
        { everHadPlanSubscription: true },
      ]) {
        const a = deriveAccess(input({ ...over, addons: [{ addon: "payroll", status: "active" }] }));
        expect(a.readOnly).toBe(true);
        expect(a.addons.payroll).toBe(false);
      }
    });

    it("AI Plus also grants AI Assistant", () => {
      const a = deriveAccess(input({ addons: [{ addon: "ai_plus", status: "active" }] }));
      expect(a.addons).toMatchObject({ ai_plus: true, ai_assistant: true });
    });

    it("add-ons work for a free, never-subscribed organisation", () => {
      expect(deriveAccess(input({ addons: [{ addon: "payroll", status: "active" }] })).addons.payroll).toBe(true);
    });
  });

  describe("wording", () => {
    it("every read-only reason says Choose a plan", () => {
      expect(READ_ONLY_MESSAGE).toContain("Choose a plan");
      for (const r of ["read_only_halted", "read_only_trial_expired", "read_only_subscription_ended"] as const) {
        expect(READ_ONLY_REASON_MESSAGES[r]).toContain("Choose a plan");
        expect(isReadOnlyReason(r)).toBe(true);
      }
      expect(isReadOnlyReason("plan_limit")).toBe(false);
      expect(isReadOnlyReason(null)).toBe(false);
    });

    it("the add-on message names the add-on", () => {
      expect(entitlementMessage("addon_required", "payroll")).toContain("Payroll");
    });
  });
});
