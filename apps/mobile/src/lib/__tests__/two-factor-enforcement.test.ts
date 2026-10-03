import { Alert } from "react-native";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));

import { handleTwoFactorError, resetTwoFactorHandlerForTests, TWO_FACTOR_SECURITY_ROUTE } from "../two-factor-enforcement";
import { wasEntitlementHandled, resetEntitlementHandlerForTests } from "../entitlement";

const MSG = "Your organisation requires two-factor authentication. Set it up in Settings → Account → Security to continue.";
const err = (message = MSG) => ({
  message,
  data: { code: "FORBIDDEN", twoFactor: { required: true, reason: "two_factor_setup_required", setupPath: "/settings?tab=account&pane=security" } },
});

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  resetTwoFactorHandlerForTests();
  resetEntitlementHandlerForTests();
  mockPush.mockClear();
  alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("handleTwoFactorError", () => {
  it("ignores other errors", () => {
    expect(handleTwoFactorError({ message: "x", data: { code: "FORBIDDEN" } })).toBe(false);
    expect(handleTwoFactorError(new Error("boom"))).toBe(false);
    expect(handleTwoFactorError(null)).toBe(false);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("shows one Alert whose action opens the Security screen", () => {
    expect(handleTwoFactorError(err())).toBe(true);
    const [title, text, buttons] = alertSpy.mock.calls[0];
    expect(title).toBe("Two-factor authentication required");
    expect(text).toBe(MSG);
    buttons.find((b: { text: string }) => b.text === "Set up two-factor").onPress();
    expect(mockPush).toHaveBeenCalledWith(TWO_FACTOR_SECURITY_ROUTE);
  });

  it("dedupes parallel failures but still reports handled", () => {
    expect(handleTwoFactorError(err())).toBe(true);
    expect(handleTwoFactorError(err())).toBe(true);
    expect(alertSpy).toHaveBeenCalledTimes(1);
  });

  it("marks the message handled so a screen's own Alert stays quiet", () => {
    handleTwoFactorError(err());
    expect(wasEntitlementHandled(MSG)).toBe(true);
  });
});
