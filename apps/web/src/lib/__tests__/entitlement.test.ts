import { describe, it, expect, vi, beforeEach } from "vitest";

const gooey = vi.hoisted(() => ({
  success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn(), promise: vi.fn(),
}));
vi.mock("goey-toast", () => ({ gooeyToast: gooey }));

import { getEntitlement, describeEntitlement, resetEntitlementHandled, setCanManageBilling, registerBillingNavigator } from "@/lib/entitlement";
import { handleEntitlementError, resetEntitlementHandlerForTests } from "@/lib/entitlement-handler";
import { toast } from "@/hooks/useToast";

const err = (reason: string, message: string) => ({ message, data: { code: "FORBIDDEN", entitlement: { reason, upgradePath: "/settings?tab=billing" } } });
const MSG = "Your trial has ended. Choose a plan to keep creating and editing.";

describe("getEntitlement", () => {
  it("reads error.data.entitlement and ignores other errors", () => {
    expect(getEntitlement(err("plan_limit", "x"))?.reason).toBe("plan_limit");
    expect(getEntitlement({ data: { code: "FORBIDDEN" } })).toBeNull();
    expect(getEntitlement({ data: { entitlement: { reason: "nonsense" } } })).toBeNull();
    expect(getEntitlement(null)).toBeNull();
  });
});

describe("describeEntitlement", () => {
  const info = (reason: string) => getEntitlement(err(reason, ""))!;
  it.each(["read_only_halted", "read_only_trial_expired", "read_only_subscription_ended"])("%s: Choose a plan for owners", (r) => {
    const p = describeEntitlement(info(r), MSG, true);
    expect(p.actionLabel).toBe("Choose a plan");
    expect(p.description).toBe(MSG);
    expect(p.blocking).toBe(false);
  });
  it.each(["plan_limit", "addon_required"])("%s: Upgrade for owners", (r) => {
    expect(describeEntitlement(info(r), "Your plan allows up to 3.", true).actionLabel).toBe("Upgrade");
  });
  it("non-owners (and unknown) get no button and are told to ask the owner", () => {
    for (const can of [false, null]) {
      const p = describeEntitlement(info("read_only_halted"), MSG, can);
      expect(p.actionLabel).toBeNull();
      expect(p.description).toContain("Ask your organisation owner to choose a plan.");
    }
    expect(describeEntitlement(info("plan_limit"), "Limit.", false).description).toContain("Ask your organisation owner to upgrade.");
  });
  it("suspended is blocking with no action", () => {
    const p = describeEntitlement(info("tenant_suspended"), "Suspended.", true);
    expect(p).toMatchObject({ blocking: true, actionLabel: null });
  });
});

describe("handleEntitlementError", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetEntitlementHandled();
    resetEntitlementHandlerForTests();
    setCanManageBilling(true);
  });

  it("returns false and shows nothing for other errors", () => {
    expect(handleEntitlementError({ message: "boom", data: { code: "BAD_REQUEST" } })).toBe(false);
    expect(gooey.warning).not.toHaveBeenCalled();
  });

  it("shows a Choose a plan action that navigates to billing", () => {
    const go = vi.fn();
    registerBillingNavigator(go);
    expect(handleEntitlementError(err("read_only_trial_expired", MSG))).toBe(true);
    const opts = gooey.warning.mock.calls[0][1];
    expect(gooey.warning.mock.calls[0][0]).toBe("Your account is read-only");
    expect(opts.action.label).toBe("Choose a plan");
    opts.action.onClick();
    expect(go).toHaveBeenCalled();
    registerBillingNavigator(null);
  });

  it("non-owner sees no action", () => {
    setCanManageBilling(false);
    handleEntitlementError(err("plan_limit", "Your plan allows up to 1 business."));
    expect(gooey.warning.mock.calls[0][1].action).toBeUndefined();
  });

  describe("feature_not_in_plan", () => {
    const featureErr = (name = "E-invoicing", feature = "eInvoicing") => ({
      message: `${name} is available on the Growth plan and above.`,
      data: {
        code: "FORBIDDEN",
        entitlement: {
          reason: "feature_not_in_plan", code: "feature_not_in_plan", upgradePath: "/settings?tab=billing",
          feature, featureName: name, requiredPlan: "Growth", currentPlan: "Starter",
        },
      },
    });

    it("shows the plan prompt (not a generic toast) with See plans to the billing page for an owner", () => {
      const go = vi.fn();
      registerBillingNavigator(go);
      expect(handleEntitlementError(featureErr())).toBe(true);
      const [title, opts] = gooey.warning.mock.calls[0];
      expect(title).toBe("E-invoicing: not on your plan");
      expect(opts.description).toBe("E-invoicing is available on the Growth plan and above.");
      expect(opts.action.label).toBe("See plans");
      opts.action.onClick();
      expect(go).toHaveBeenCalled();
      registerBillingNavigator(null);
    });

    it("a non-owner still gets See plans, pointing at the pricing page, and is told to ask the owner", () => {
      setCanManageBilling(false);
      const assign = vi.fn();
      const original = window.location;
      Object.defineProperty(window, "location", { value: { ...original, assign }, writable: true });
      handleEntitlementError(featureErr());
      const opts = gooey.warning.mock.calls[0][1];
      expect(opts.description).toContain("Ask your organisation owner to upgrade");
      opts.action.onClick();
      expect(assign).toHaveBeenCalledWith("/pricing");
      Object.defineProperty(window, "location", { value: original, writable: true });
    });

    it("two different features in a row are two toasts", () => {
      handleEntitlementError(featureErr());
      handleEntitlementError(featureErr("Bank reconciliation", "bankReconciliation"));
      expect(gooey.warning).toHaveBeenCalledTimes(2);
    });

    it("a form's own toast with the same message stays quiet", () => {
      handleEntitlementError(featureErr());
      toast.error("Could not save", featureErr().message);
      expect(gooey.error).not.toHaveBeenCalled();
    });

    it("is read with its feature fields", () => {
      expect(getEntitlement(featureErr())).toMatchObject({ reason: "feature_not_in_plan", feature: "eInvoicing", featureName: "E-invoicing", requiredPlan: "Growth", currentPlan: "Starter" });
    });
  });

  it("suspended stays until closed", () => {
    handleEntitlementError(err("tenant_suspended", "Suspended."));
    expect(gooey.error.mock.calls[0][1].duration).toBe(Infinity);
  });

  it("a form repeating the same message with toast.error does not double-fire", () => {
    handleEntitlementError(err("read_only_trial_expired", MSG));
    toast.error("Could not save invoice", MSG);
    expect(gooey.error).not.toHaveBeenCalled();
    toast.error("Could not save invoice", "Some other failure");
    expect(gooey.error).toHaveBeenCalledTimes(1);
  });

  it("the same refusal from parallel calls shows one toast", () => {
    handleEntitlementError(err("read_only_halted", MSG));
    handleEntitlementError(err("read_only_halted", MSG));
    expect(gooey.warning).toHaveBeenCalledTimes(1);
  });
});
