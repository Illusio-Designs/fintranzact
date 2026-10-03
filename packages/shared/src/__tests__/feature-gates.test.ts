import { describe, it, expect } from "vitest";
import {
  FEATURE_GATES,
  FEATURE_GATE_EXEMPT,
  PLAN_FLAG_KEYS,
  PLAN_FLAGS_ENFORCED,
  PLAN_FLAGS_NOT_BUILT,
  PLAN_FLAGS_OPERATIONAL,
  PLAN_DEFAULTS,
  PLAN_IDS,
  allFeatures,
  featureAccess,
  featureGatesFor,
  featureNotInPlanMessage,
  featuresOf,
  planFlagNote,
  requiredPlanFor,
  describeEntitlement,
  entitlementFromError,
  type PlanFlagKey,
} from "../index.js";

const plans = PLAN_IDS.map((id) => ({ id, name: PLAN_DEFAULTS[id].name, limits: PLAN_DEFAULTS[id].limits }));

describe("FEATURE_GATES registry", () => {
  it.each(PLAN_FLAG_KEYS.map((k) => [k]))("%s has exactly one entry, keyed by itself", (flag) => {
    expect(FEATURE_GATES[flag]).toBeDefined();
    expect(FEATURE_GATES[flag].flag).toBe(flag);
    expect(FEATURE_GATES[flag].name.length).toBeGreaterThan(2);
  });

  it.each(PLAN_FLAG_KEYS.map((k) => [k]))("%s is gated, enforced elsewhere, operational or not built, and says so consistently", (flag) => {
    const def = FEATURE_GATES[flag];
    const hasGates = def.routers.length + def.procedures.length + Object.keys(def.conditional).length > 0;
    if (def.kind === "gated") expect(hasGates, `${flag} is gated but names no procedure`).toBe(true);
    else expect(hasGates, `${flag} is ${def.kind} but names procedures`).toBe(false);
    if (def.kind === "operational" || def.kind === "enforced_elsewhere") expect(def.elsewhere.length).toBeGreaterThan(0);
  });

  it("never names a plan: which plan a feature needs comes from the stored plan settings", () => {
    const text = JSON.stringify(FEATURE_GATES) + JSON.stringify(FEATURE_GATE_EXEMPT);
    expect(text).not.toMatch(/\b(starter|growth|business)\b/i);
    // (the word "business" as in "business-wide" would trip this; the registry avoids it on purpose)
  });

  it("partitions the flags into enforced, operational and not built", () => {
    const all = [...PLAN_FLAGS_ENFORCED, ...PLAN_FLAGS_OPERATIONAL, ...PLAN_FLAGS_NOT_BUILT].sort();
    expect(all).toEqual([...PLAN_FLAG_KEYS].sort());
    expect(PLAN_FLAGS_OPERATIONAL).toEqual(["prioritySupport", "onboardingHelp"]);
    expect(PLAN_FLAGS_NOT_BUILT).toEqual(["approvals"]);
    for (const f of ["dataExport", "onlineStore", "pdfBranding", "eInvoicing", "multiWarehouse", "batchesExpiry", "bankReconciliation", "manufacturing", "gstReports", "eWayBills", "recurringInvoices", "pos"] as const) {
      expect(PLAN_FLAGS_ENFORCED).toContain(f);
    }
  });

  it("only operational and not-built flags get an editor note", () => {
    for (const f of PLAN_FLAG_KEYS) {
      const note = planFlagNote(f);
      if (PLAN_FLAGS_OPERATIONAL.includes(f) || PLAN_FLAGS_NOT_BUILT.includes(f)) expect(note).toBeTruthy();
      else expect(note).toBeUndefined();
      expect(note ?? "").not.toMatch(/not enforced yet/i);
    }
  });

  it("an exempt path is never gated unconditionally", () => {
    for (const path of Object.keys(FEATURE_GATE_EXEMPT)) expect(featureGatesFor(path, "mutation").filter((m) => !m.condition)).toEqual([]);
    expect(featureGatesFor("recurringInvoice.pause", "mutation")).toEqual([]);
    expect(featureGatesFor("recurringInvoice.create", "mutation")).toEqual([{ flag: "recurringInvoices" }]);
  });
});

describe("featureGatesFor", () => {
  it.each([
    ["eInvoice.generate", "mutation", [{ flag: "eInvoicing" }]],
    ["eInvoice.testConnection", "mutation", [{ flag: "eInvoicing" }]],
    ["eInvoice.dashboard", "query", []],
    ["ewayBill.generate", "mutation", [{ flag: "eWayBills" }]],
    ["ewayBill.getByInvoice", "query", []],
    ["bankRecon.uploadCSV", "mutation", [{ flag: "bankReconciliation" }]],
    ["manufacturing.bomCreate", "mutation", [{ flag: "manufacturing" }]],
    ["manufacturing.bomList", "query", []],
    ["batch.create", "mutation", [{ flag: "batchesExpiry" }]],
    ["batch.list", "query", []],
    ["stock.transfer", "mutation", [{ flag: "multiWarehouse" }]],
    ["stock.adjust", "mutation", [{ flag: "batchesExpiry", condition: "batch_fields" }]],
    ["stock.setup", "mutation", []],
    ["pos.catalog", "query", [{ flag: "pos" }]],
    ["gstReturns.fileGstr1", "mutation", [{ flag: "gstReports" }]],
    ["gstr2b.upload", "mutation", [{ flag: "gstReports" }]],
    ["party.create", "mutation", []],
  ] as const)("%s (%s)", (path, type, expected) => {
    expect(featureGatesFor(path, type)).toEqual(expected);
  });

  it("an invoice save can be gated by two flags, each with its own condition", () => {
    expect(featureGatesFor("invoice.create", "mutation")).toEqual([
      { flag: "pos", condition: "pos_sale" },
      { flag: "batchesExpiry", condition: "batch_fields" },
    ]);
  });
});

describe("requiredPlanFor: derived from stored plan settings", () => {
  const withEdit = (edit: Partial<Record<PlanFlagKey, boolean>>, planId: (typeof PLAN_IDS)[number]) =>
    plans.map((p) => (p.id === planId ? { ...p, limits: { ...p.limits, ...edit } } : p));

  it("gives the cheapest plan that has the flag by default", () => {
    expect(requiredPlanFor("eInvoicing", plans)).toEqual({ id: "growth", name: "Growth" });
    expect(requiredPlanFor("manufacturing", plans)).toEqual({ id: "business", name: "Business" });
    expect(requiredPlanFor("pos", plans)).toEqual({ id: "starter", name: "Starter" });
  });

  it("follows an admin edit: switching a flag off for Growth moves the requirement up", () => {
    expect(requiredPlanFor("eInvoicing", withEdit({ eInvoicing: false }, "growth"))).toEqual({ id: "business", name: "Business" });
  });

  it("follows an admin edit: switching a flag on for Starter moves it down", () => {
    expect(requiredPlanFor("eInvoicing", withEdit({ eInvoicing: true }, "starter"))).toEqual({ id: "starter", name: "Starter" });
  });

  it("uses the stored (renamed) plan name", () => {
    const renamed = plans.map((p) => (p.id === "growth" ? { ...p, name: "Pro" } : p));
    expect(requiredPlanFor("eInvoicing", renamed)).toEqual({ id: "growth", name: "Pro" });
  });

  it("is null when no plan has the flag", () => {
    const none = plans.map((p) => ({ ...p, limits: { ...p.limits, eInvoicing: false } }));
    expect(requiredPlanFor("eInvoicing", none)).toBeNull();
  });
});

describe("messages", () => {
  it("reads like the owner asked", () => {
    expect(featureNotInPlanMessage("eInvoicing", "Growth", "Business")).toBe("E-invoicing is available on the Growth plan and above.");
  });
  it("uses are for plural names and drops 'and above' for the top plan", () => {
    expect(featureNotInPlanMessage("multiWarehouse", "Growth", "Business")).toBe("Multiple warehouses are available on the Growth plan and above.");
    expect(featureNotInPlanMessage("manufacturing", "Business", "Business")).toBe(
      "Manufacturing and bill of materials is available on the Business plan.",
    );
  });
  it("says so when no plan has it", () => {
    expect(featureNotInPlanMessage("eInvoicing", null)).toBe("E-invoicing is not available on your plan.");
  });
});

describe("featureAccess (client helper)", () => {
  const status = {
    features: { ...featuresOf(PLAN_DEFAULTS.starter.limits) },
    featureRequiredPlans: { eInvoicing: "Growth", manufacturing: "Business" },
    topPlanName: "Business",
  };

  it("allows while status is unknown, so nothing flashes locked", () => {
    expect(featureAccess(undefined, "eInvoicing").allowed).toBe(true);
    expect(featureAccess({}, "eInvoicing").allowed).toBe(true);
  });

  it("locks a gated flag the plan lacks, with the name, plan badge and message", () => {
    expect(featureAccess(status, "eInvoicing")).toEqual({
      allowed: false,
      feature: "eInvoicing",
      featureName: "E-invoicing",
      requiredPlan: "Growth",
      badge: "Growth",
      message: "E-invoicing is available on the Growth plan and above.",
    });
    expect(featureAccess(status, "manufacturing").message).toBe("Manufacturing and bill of materials is available on the Business plan.");
  });

  it("allows a flag the plan has, and never locks operational or not-built flags", () => {
    expect(featureAccess(status, "pos")).toMatchObject({ allowed: true, badge: null, message: "" });
    expect(featureAccess(status, "approvals").allowed).toBe(true);
    expect(featureAccess(status, "prioritySupport").allowed).toBe(true);
  });

  it("allFeatures turns everything on", () => {
    expect(featureAccess({ features: allFeatures() }, "eInvoicing").allowed).toBe(true);
  });
});

describe("feature_not_in_plan prompt", () => {
  const error = {
    message: "E-invoicing is available on the Growth plan and above.",
    data: {
      code: "FORBIDDEN",
      entitlement: {
        reason: "feature_not_in_plan",
        code: "feature_not_in_plan",
        upgradePath: "/settings?tab=billing",
        feature: "eInvoicing",
        featureName: "E-invoicing",
        requiredPlan: "Growth",
        currentPlan: "Starter",
      },
    },
  };

  it("is read from error.data.entitlement", () => {
    expect(entitlementFromError(error)).toMatchObject({ reason: "feature_not_in_plan", feature: "eInvoicing", featureName: "E-invoicing", requiredPlan: "Growth", currentPlan: "Starter" });
  });

  it("shows See plans to the owner (billing) and to members (pricing page)", () => {
    const info = entitlementFromError(error)!;
    expect(describeEntitlement(info, error.message, true)).toMatchObject({ title: "E-invoicing: not on your plan", actionLabel: "See plans", actionTarget: "billing", blocking: false });
    const member = describeEntitlement(info, error.message, false);
    expect(member).toMatchObject({ actionLabel: "See plans", actionTarget: "pricing" });
    expect(member.description).toContain("Ask your organisation owner to upgrade");
  });
});
