import { describe, it, expect, vi, beforeEach } from "vitest";

const gooey = vi.hoisted(() => ({
  success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn(), promise: vi.fn(),
}));
vi.mock("goey-toast", () => ({ gooeyToast: gooey }));

import { handleTwoFactorError, registerTwoFactorNavigator, resetTwoFactorHandlerForTests } from "@/lib/two-factor-handler";
import { resetEntitlementHandled } from "@/lib/entitlement";
import { toast } from "@/hooks/useToast";

const MSG = "Your organisation requires two-factor authentication. Set it up in Settings → Account → Security to continue.";
const err = (message = MSG) => ({
  message,
  data: { code: "FORBIDDEN", twoFactor: { required: true, reason: "two_factor_setup_required", setupPath: "/settings?tab=account&pane=security" } },
});

describe("handleTwoFactorError", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetEntitlementHandled();
    resetTwoFactorHandlerForTests();
    registerTwoFactorNavigator(null);
  });

  it("ignores every other error", () => {
    expect(handleTwoFactorError({ message: "boom", data: { code: "FORBIDDEN" } })).toBe(false);
    expect(handleTwoFactorError({ data: { twoFactor: { required: true, reason: "other" } } })).toBe(false);
    expect(handleTwoFactorError(null)).toBe(false);
    expect(gooey.warning).not.toHaveBeenCalled();
  });

  it("shows a toast with a Set up two-factor action that navigates to the setup path", () => {
    const go = vi.fn();
    registerTwoFactorNavigator(go);
    expect(handleTwoFactorError(err())).toBe(true);
    const opts = gooey.warning.mock.calls[0][1];
    expect(opts.action.label).toBe("Set up two-factor");
    opts.action.onClick();
    expect(go).toHaveBeenCalledWith("/settings?tab=account&pane=security");
  });

  it("dedupes parallel failures to one toast but still reports handled", () => {
    expect(handleTwoFactorError(err())).toBe(true);
    expect(handleTwoFactorError(err())).toBe(true);
    expect(gooey.warning).toHaveBeenCalledTimes(1);
  });

  it("a form repeating the same message with toast.error stays quiet", () => {
    handleTwoFactorError(err());
    toast.error("Could not save", MSG);
    expect(gooey.error).not.toHaveBeenCalled();
  });
});
