import { Alert, Linking } from "react-native";
import {
  handleEntitlementError,
  resetEntitlementHandlerForTests,
  setCanManageBilling,
  wasEntitlementHandled,
} from "../entitlement";

const err = (reason: string, message: string) => ({
  message,
  data: { code: "FORBIDDEN", entitlement: { reason, upgradePath: "/settings?tab=billing" } },
});
const MSG = "Your trial has ended. Choose a plan to keep creating and editing.";

let alertSpy: jest.SpyInstance;
let openSpy: jest.SpyInstance;

beforeEach(() => {
  resetEntitlementHandlerForTests();
  alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  openSpy = jest.spyOn(Linking, "openURL").mockResolvedValue(true as never);
});
afterEach(() => jest.restoreAllMocks());

describe("handleEntitlementError", () => {
  it("ignores errors that are not entitlement refusals", () => {
    expect(handleEntitlementError({ message: "x", data: { code: "FORBIDDEN" } })).toBe(false);
    expect(handleEntitlementError(new Error("boom"))).toBe(false);
    expect(handleEntitlementError(null)).toBe(false);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it.each(["read_only_halted", "read_only_trial_expired", "read_only_subscription_ended"])(
    "owner gets a 'Choose a plan' action for %s that opens the web billing page",
    (reason) => {
      setCanManageBilling(true);
      expect(handleEntitlementError(err(reason, MSG))).toBe(true);
      const [title, text, buttons] = alertSpy.mock.calls[0];
      expect(title).toBe("Your account is read-only");
      expect(text).toBe(MSG);
      const action = buttons.find((b: { text: string }) => b.text === "Choose a plan");
      action.onPress();
      expect(openSpy).toHaveBeenCalledWith(expect.stringMatching(/\/settings\?tab=billing$/));
    },
  );

  it("owner gets 'Upgrade' for plan_limit and addon_required", () => {
    setCanManageBilling(true);
    handleEntitlementError(err("plan_limit", "Limit reached."));
    expect(alertSpy.mock.calls[0][0]).toBe("Plan limit reached");
    expect(alertSpy.mock.calls[0][2].map((b: { text: string }) => b.text)).toContain("Upgrade");
    resetEntitlementHandlerForTests();
    setCanManageBilling(true);
    handleEntitlementError(err("addon_required", "Needs add-on."));
    expect(alertSpy.mock.calls[1][0]).toBe("Add-on required");
  });

  it("non-owner and unknown role are told to ask the owner, with no action", () => {
    for (const role of [false, null]) {
      resetEntitlementHandlerForTests();
      alertSpy.mockClear();
      setCanManageBilling(role);
      handleEntitlementError(err("read_only_trial_expired", MSG));
      const [, text, buttons] = alertSpy.mock.calls[0];
      expect(text).toContain("Ask your organisation owner to choose a plan");
      expect(buttons.map((b: { text: string }) => b.text)).toEqual(["OK"]);
    }
  });

  describe("feature_not_in_plan", () => {
    const featureErr = () => ({
      message: "E-invoicing is available on the Growth plan and above.",
      data: {
        code: "FORBIDDEN",
        entitlement: {
          reason: "feature_not_in_plan", code: "feature_not_in_plan", upgradePath: "/settings?tab=billing",
          feature: "eInvoicing", featureName: "E-invoicing", requiredPlan: "Growth", currentPlan: "Starter",
        },
      },
    });

    it("owner: a plan prompt with See plans that opens the web billing page", () => {
      setCanManageBilling(true);
      expect(handleEntitlementError(featureErr())).toBe(true);
      const [title, text, buttons] = alertSpy.mock.calls[0];
      expect(title).toBe("E-invoicing: not on your plan");
      expect(text).toBe("E-invoicing is available on the Growth plan and above.");
      buttons.find((b: { text: string }) => b.text === "See plans").onPress();
      expect(openSpy).toHaveBeenCalledWith(expect.stringMatching(/\/settings\?tab=billing$/));
    });

    it("non-owner: still See plans, opening the public pricing page, and told to ask the owner", () => {
      setCanManageBilling(false);
      handleEntitlementError(featureErr());
      const [, text, buttons] = alertSpy.mock.calls[0];
      expect(text).toContain("Ask your organisation owner to upgrade");
      buttons.find((b: { text: string }) => b.text === "See plans").onPress();
      expect(openSpy).toHaveBeenCalledWith(expect.stringMatching(/\/pricing$/));
    });
  });

  it("suspended is a blocking message with no action, even for owners", () => {
    setCanManageBilling(true);
    handleEntitlementError(err("tenant_suspended", "Suspended."));
    const [title, , buttons, options] = alertSpy.mock.calls[0];
    expect(title).toBe("Organisation suspended");
    expect(buttons.map((b: { text: string }) => b.text)).toEqual(["OK"]);
    expect(options.cancelable).toBe(false);
  });

  it("dedupes identical refusals fired together but shows a different one", () => {
    setCanManageBilling(true);
    handleEntitlementError(err("read_only_halted", MSG));
    handleEntitlementError(err("read_only_halted", MSG));
    expect(alertSpy).toHaveBeenCalledTimes(1);
    handleEntitlementError(err("plan_limit", "Limit reached."));
    expect(alertSpy).toHaveBeenCalledTimes(2);
  });

  it("shows the same refusal again after the dedupe window", () => {
    const now = jest.spyOn(Date, "now");
    now.mockReturnValue(1_000_000);
    handleEntitlementError(err("read_only_halted", MSG));
    now.mockReturnValue(1_000_000 + 4000);
    handleEntitlementError(err("read_only_halted", MSG));
    expect(alertSpy).toHaveBeenCalledTimes(2);
  });

  it("records handled messages so a screen can skip its own alert", () => {
    handleEntitlementError(err("plan_limit", "Limit reached."));
    expect(wasEntitlementHandled("Limit reached.")).toBe(true);
    expect(wasEntitlementHandled("Something else")).toBe(false);
  });
});
