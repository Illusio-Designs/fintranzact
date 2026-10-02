import { describe, it, expect, vi } from "vitest";
import { normalizeTrpcError, formatFintranzactError } from "../client.js";
import { handlePlanRequired, EXIT } from "../output.js";
import { buildBillingUrl, resolveWebUrl, ENTITLEMENT_REASONS } from "../plan.js";

const forbidden = (entitlement?: unknown, message = "Choose a plan to keep creating and editing.") => ({
  code: "FORBIDDEN",
  message,
  data: entitlement ? { entitlement } : {},
});

describe("normalizeTrpcError entitlement handling", () => {
  it.each(ENTITLEMENT_REASONS)("maps %s to plan_required, not Permission denied", (reason) => {
    const err = normalizeTrpcError(forbidden({ reason, upgradePath: "/settings?tab=billing" }), "https://api.fintranzact.com");
    expect(err).toMatchObject({
      code: "plan_required",
      reason,
      upgradeUrl: "https://app.fintranzact.com/settings?tab=billing",
    });
    expect(formatFintranzactError(err)).not.toContain("Permission denied");
  });

  it("includes the server message and a Choose a plan link", () => {
    const err = normalizeTrpcError(forbidden({ reason: "read_only_trial_expired", upgradePath: "/settings?tab=billing" }, "Your trial has ended."), "https://api.x.test");
    const text = formatFintranzactError(err);
    expect(text).toContain("Your trial has ended.");
    expect(text).toContain("Choose a plan (organisation owner): https://app.x.test/settings?tab=billing");
  });

  it("suspended does not tell the user to choose a plan", () => {
    const err = normalizeTrpcError(forbidden({ reason: "tenant_suspended", upgradePath: "/settings?tab=billing" }, "Suspended."));
    expect(formatFintranzactError(err)).not.toContain("Choose a plan");
  });

  it("a normal FORBIDDEN is still Permission denied", () => {
    const err = normalizeTrpcError(forbidden(undefined, "Not allowed"));
    expect(err).toEqual({ code: "forbidden", message: "Not allowed" });
    expect(formatFintranzactError(err)).toBe("Permission denied: Not allowed");
  });

  it("ignores an unknown entitlement reason", () => {
    expect(normalizeTrpcError(forbidden({ reason: "weird" })).code).toBe("forbidden");
  });

  it("leaves non-entitlement errors unchanged", () => {
    expect(normalizeTrpcError({ code: "PRECONDITION_FAILED", message: "x" })).toEqual({ code: "api_error", message: "x" });
    expect(normalizeTrpcError({ code: "UNAUTHORIZED", message: "x" })).toEqual({ code: "unauthorized", message: "x" });
  });
});

describe("billing URL", () => {
  const info = { reason: "plan_limit" as const, upgradePath: "/settings?tab=billing" };
  it("prefers FINTRANZACT_WEB_URL", () => {
    expect(buildBillingUrl(info, "https://api.fintranzact.com", { FINTRANZACT_WEB_URL: "https://web.test/" })).toBe("https://web.test/settings?tab=billing");
  });
  it("derives app. from api.", () => {
    expect(resolveWebUrl("https://api.example.com/", {})).toBe("https://app.example.com");
  });
  it("falls back to production", () => {
    expect(resolveWebUrl("http://localhost:3000", {})).toBe("https://app.fintranzact.com");
    expect(resolveWebUrl(undefined, {})).toBe("https://app.fintranzact.com");
  });
});

describe("handlePlanRequired", () => {
  const err = { code: "plan_required" as const, reason: "read_only_halted", message: "Payment failed.", upgradeUrl: "https://app.x/settings?tab=billing" };

  it("exit code is distinct from the existing ones", () => {
    expect(EXIT.PLAN_REQUIRED).toBe(10);
    expect(Object.values(EXIT).filter((v) => v === 10)).toHaveLength(1);
  });

  it("human mode writes message and link to stderr and exits PLAN_REQUIRED", () => {
    const errOut = vi.fn();
    const out = vi.fn();
    const exit = vi.fn(() => { throw new Error("exit"); }) as never;
    expect(() => handlePlanRequired(err, { json: false, errOut, out, exit })).toThrow("exit");
    expect(exit).toHaveBeenCalledWith(10);
    expect(out).not.toHaveBeenCalled();
    const text = errOut.mock.calls[0][0] as string;
    expect(text).toContain("Payment failed.");
    expect(text).toContain("Choose a plan (organisation owner): https://app.x/settings?tab=billing");
  });

  it("json mode writes the error body", () => {
    const out = vi.fn();
    const exit = vi.fn(() => { throw new Error("exit"); }) as never;
    expect(() => handlePlanRequired(err, { json: true, out, errOut: vi.fn(), exit })).toThrow("exit");
    expect(JSON.parse(out.mock.calls[0][0] as string)).toEqual({
      error: { code: "plan_required", reason: "read_only_halted", message: "Payment failed.", upgradeUrl: "https://app.x/settings?tab=billing" },
    });
  });
});
