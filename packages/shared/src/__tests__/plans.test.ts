import { describe, it, expect } from "vitest";
import {
  DEFAULT_SIGNUP_PLAN,
  PLANS,
  PLAN_DEFAULTS,
  PLAN_FLAG_KEYS,
  PLAN_IDS,
  PLAN_LIMITS,
  PLAN_ORDER,
  PLAN_PRICES,
  YEARLY_SAVING_MONTHS,
  effectiveYearlyPriceInr,
  formatPlanLimit,
  formatPlanPrice,
  formatYearlyPlanPrice,
  gstOn,
  isPlanId,
  limitsFromStored,
  limitsToStored,
  planCheckoutAmount,
  planSettingsSchema,
  planSettingsWarnings,
  withGst,
  yearlyPrice,
} from "../plans.js";
import { LEGACY_PLAN_IDS, REMOVED_PLAN_IDS, isRemovedPlanId, oldPlanToNew, removedPlanMessage } from "../plan-migration.js";

describe("plan catalogue", () => {
  it("has exactly three paid plans, cheapest first, and no free plan", () => {
    expect([...PLAN_IDS]).toEqual(["starter", "growth", "business"]);
    expect([...PLAN_ORDER]).toEqual(["starter", "growth", "business"]);
    expect(PLANS.map((p) => p.id)).toEqual(["starter", "growth", "business"]);
    for (const plan of PLANS) expect(plan.monthlyPriceInr).toBeGreaterThan(0);
    for (const id of REMOVED_PLAN_IDS) expect(isPlanId(id)).toBe(false);
  });

  it("every plan has limits the API can enforce and a full definition", () => {
    for (const plan of PLANS) {
      expect(PLAN_LIMITS[plan.id]).toBeDefined();
      expect(PLAN_DEFAULTS[plan.id].visible).toBe(true);
      for (const key of PLAN_FLAG_KEYS) expect(typeof PLAN_LIMITS[plan.id][key]).toBe("boolean");
    }
  });

  it("highlights Growth and only Growth", () => {
    expect(PLANS.filter((p) => p.highlight).map((p) => p.id)).toEqual(["growth"]);
    expect(PLAN_DEFAULTS.growth.highlight).toBe(true);
  });

  it("new sign-ups default to Growth", () => {
    expect(DEFAULT_SIGNUP_PLAN).toBe("growth");
  });

  it("has the published monthly and yearly prices, ex-GST", () => {
    expect(PLAN_PRICES).toEqual({
      starter: { monthlyInr: 299, yearlyInr: 2999 },
      growth: { monthlyInr: 699, yearlyInr: 6999 },
      business: { monthlyInr: 1499, yearlyInr: 14999 },
    });
    for (const p of PLANS) {
      expect(p.monthlyPriceInr).toBe(PLAN_PRICES[p.id].monthlyInr);
      expect(p.yearlyPriceInr).toBe(PLAN_PRICES[p.id].yearlyInr);
    }
  });

  it("yearly is two months free: ten months of the monthly price, give or take the rounding to a 9", () => {
    expect(YEARLY_SAVING_MONTHS).toBe(2);
    expect(yearlyPrice(299)).toBe(2990);
    for (const { monthlyInr, yearlyInr } of Object.values(PLAN_PRICES)) {
      expect(yearlyInr - monthlyInr * 10).toBe(9);
      expect(yearlyInr).toBeLessThan(monthlyInr * 12);
    }
  });

  it("derives the yearly price when none is set", () => {
    expect(effectiveYearlyPriceInr({ monthlyPriceInr: 500, yearlyPriceInr: null })).toBe(5000);
    expect(effectiveYearlyPriceInr({ monthlyPriceInr: 500 })).toBe(5000);
    expect(effectiveYearlyPriceInr({ monthlyPriceInr: 500, yearlyPriceInr: 4999 })).toBe(4999);
    expect(effectiveYearlyPriceInr({ monthlyPriceInr: null, yearlyPriceInr: null })).toBeNull();
  });

  it("adds 18% GST in rupees and paise", () => {
    expect(gstOn(299)).toBe(54); // 53.82
    expect(withGst(1000)).toBe(1180);
    const monthly = planCheckoutAmount(699, "monthly");
    expect(monthly).toEqual({ basePaise: 69_900, gstPaise: 12_582, totalPaise: 82_482 });
    const yearly = planCheckoutAmount(699, "yearly", 6999);
    expect(yearly.basePaise).toBe(699_900);
    expect(yearly.totalPaise).toBe(699_900 + 125_982);
    expect(planCheckoutAmount(699, "yearly").basePaise).toBe(699_000); // derived: ten months
  });

  it("formats prices", () => {
    expect(formatPlanPrice({ monthlyPriceInr: 299 })).toBe("₹299");
    expect(formatPlanPrice({ monthlyPriceInr: 149900 })).toBe("₹1,49,900");
    expect(formatPlanPrice({ monthlyPriceInr: null })).toBe("Custom");
    expect(formatYearlyPlanPrice({ monthlyPriceInr: 299, yearlyPriceInr: 2999 })).toBe("₹2,999");
    expect(formatYearlyPlanPrice({ monthlyPriceInr: 299, yearlyPriceInr: null })).toBe("₹2,990");
  });

  it("formats limits the way the pricing page shows them", () => {
    expect(formatPlanLimit(Infinity)).toBe("Unlimited");
    expect(formatPlanLimit(null, "days")).toBe("Unlimited");
    expect(formatPlanLimit(15)).toBe("15");
    expect(formatPlanLimit(365, "days")).toBe("1 year");
    expect(formatPlanLimit(30, "days")).toBe("30 days");
  });
});

describe("plan limits per plan", () => {
  it("Starter: 1 business, 3 users, no API, no export or store, no PDF branding", () => {
    expect(PLAN_LIMITS.starter).toMatchObject({
      maxBusinesses: 1,
      maxTeamMembers: 3,
      maxOwnedOrgs: 1,
      maxApiKeys: 0,
      dataExport: false,
      onlineStore: false,
      pdfBranding: false,
      gstReports: true,
      eWayBills: true,
      recurringInvoices: true,
      pos: true,
      eInvoicing: false,
    });
  });

  it("Growth: 3 businesses, 10 users and everything in Starter plus its extras", () => {
    expect(PLAN_LIMITS.growth).toMatchObject({
      maxBusinesses: 3,
      maxTeamMembers: 10,
      maxApiKeys: 3,
      dataExport: true,
      onlineStore: true,
      pdfBranding: false,
      eInvoicing: true,
      multiWarehouse: true,
      batchesExpiry: true,
      bankReconciliation: true,
      manufacturing: false,
      approvals: false,
    });
    for (const key of PLAN_FLAG_KEYS) {
      if (PLAN_LIMITS.starter[key]) expect(PLAN_LIMITS.growth[key]).toBe(true);
    }
  });

  it("Business: unlimited businesses and users, everything in Growth plus its extras", () => {
    expect(PLAN_LIMITS.business).toMatchObject({
      maxBusinesses: Infinity,
      maxTeamMembers: Infinity,
      maxApiKeys: Infinity,
      auditRetentionDays: null,
      manufacturing: true,
      approvals: true,
      prioritySupport: true,
      onboardingHelp: true,
    });
    for (const key of PLAN_FLAG_KEYS) {
      if (PLAN_LIMITS.growth[key] && key !== "pdfBranding") expect(PLAN_LIMITS.business[key]).toBe(true);
    }
  });

  it("no plan shows Fintranzact branding on PDFs", () => {
    for (const id of PLAN_IDS) expect(PLAN_LIMITS[id].pdfBranding).toBe(false);
  });
});

describe("stored limits", () => {
  it("round-trips every limit through JSON (Infinity <-> null)", () => {
    for (const id of PLAN_IDS) {
      const stored = JSON.parse(JSON.stringify(limitsToStored(PLAN_LIMITS[id])));
      expect(limitsFromStored(stored, PLAN_LIMITS.starter)).toEqual(PLAN_LIMITS[id]);
    }
  });

  it("falls back to the defaults for missing or malformed values, including new flags", () => {
    const got = limitsFromStored({ maxBusinesses: 7, eInvoicing: "yes" } as never, PLAN_LIMITS.growth);
    expect(got.maxBusinesses).toBe(7);
    expect(got.eInvoicing).toBe(true);
    expect(got.maxTeamMembers).toBe(10);
  });
});

describe("planSettingsSchema and warnings", () => {
  const valid = () => ({
    name: "Growth",
    tagline: "x",
    monthlyPriceInr: 699,
    yearlyPriceInr: 6999,
    features: ["a"],
    highlight: true,
    visible: true,
    limits: limitsToStored(PLAN_LIMITS.growth),
  });

  it("accepts the built-in plans as settings", () => {
    for (const id of PLAN_IDS) {
      const d = PLAN_DEFAULTS[id];
      const r = planSettingsSchema.safeParse({
        name: d.name,
        tagline: d.tagline,
        monthlyPriceInr: d.monthlyPriceInr,
        yearlyPriceInr: d.yearlyPriceInr,
        features: d.features,
        highlight: !!d.highlight,
        visible: d.visible,
        limits: limitsToStored(d.limits),
      });
      expect(r.success).toBe(true);
    }
  });

  it("rejects negative prices and non-integers", () => {
    expect(planSettingsSchema.safeParse({ ...valid(), monthlyPriceInr: -1 }).success).toBe(false);
    expect(planSettingsSchema.safeParse({ ...valid(), yearlyPriceInr: -5 }).success).toBe(false);
    expect(planSettingsSchema.safeParse({ ...valid(), yearlyPriceInr: 10.5 }).success).toBe(false);
    expect(planSettingsSchema.safeParse({ ...valid(), yearlyPriceInr: null }).success).toBe(true);
  });

  it("warns, but does not fail, when yearly costs more than 12 months", () => {
    expect(planSettingsWarnings({ monthlyPriceInr: 699, yearlyPriceInr: 6999 })).toEqual([]);
    expect(planSettingsWarnings({ monthlyPriceInr: 699, yearlyPriceInr: 8388 })).toEqual([]); // exactly 12x
    expect(planSettingsWarnings({ monthlyPriceInr: 699, yearlyPriceInr: 8389 })).toHaveLength(1);
    expect(planSettingsWarnings({ monthlyPriceInr: null, yearlyPriceInr: 100 })).toHaveLength(1);
    expect(planSettingsSchema.safeParse({ ...valid(), yearlyPriceInr: 99_999 }).success).toBe(true);
  });
});

describe("oldPlanToNew (the migration's mapping)", () => {
  it("maps every old plan id as the migration does", () => {
    expect(oldPlanToNew("forever_free")).toEqual({ plan: "business", grandfathered: true });
    expect(oldPlanToNew("free")).toEqual({ plan: "starter", grandfathered: false });
    expect(oldPlanToNew("pro")).toEqual({ plan: "growth", grandfathered: false });
    expect(oldPlanToNew("business")).toEqual({ plan: "business", grandfathered: false });
    expect(oldPlanToNew("enterprise")).toEqual({ plan: "business", grandfathered: false });
  });

  it("covers every legacy id, always lands on a current plan, and grandfathers only forever_free", () => {
    for (const old of LEGACY_PLAN_IDS) {
      const m = oldPlanToNew(old)!;
      expect(isPlanId(m.plan)).toBe(true);
      expect(m.grandfathered).toBe(old === "forever_free");
    }
    expect(oldPlanToNew("platinum")).toBeNull();
    expect(oldPlanToNew("starter")).toBeNull();
  });

  it("knows which ids were removed", () => {
    expect([...REMOVED_PLAN_IDS].sort()).toEqual(["enterprise", "forever_free", "free", "pro"]);
    expect(isRemovedPlanId("free")).toBe(true);
    expect(isRemovedPlanId("business")).toBe(false);
    expect(isRemovedPlanId("growth")).toBe(false);
    expect(removedPlanMessage("free")).toMatch(/removed.*Starter, Growth or Business/);
  });
});
