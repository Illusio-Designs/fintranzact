import { describe, it, expect, vi } from "vitest";
import { normalizeTrpcError, formatFintranzactError } from "../client.js";
import { handleTwoFactorRequired, EXIT } from "../output.js";
import { TWO_FACTOR_REQUIRED_MESSAGE } from "../plan.js";

const SERVER_MSG = "Your organisation requires two-factor authentication. Set it up in Settings → Account → Security to continue.";
const twoFactor = { required: true, reason: "two_factor_setup_required", setupPath: "/settings?tab=account&pane=security" };
const forbidden = (data: unknown) => ({ code: "FORBIDDEN", message: SERVER_MSG, data });

describe("normalizeTrpcError two-factor handling", () => {
  it("maps data.twoFactor.required to a distinct kind, not Permission denied", () => {
    const err = normalizeTrpcError(forbidden({ twoFactor }));
    expect(err).toEqual({ code: "two_factor_required", message: SERVER_MSG });
    expect(formatFintranzactError(err)).toBe(
      "Your organisation requires two-factor authentication. Turn it on in the web or mobile app (Settings → Account → Security) or use an API key.",
    );
    expect(formatFintranzactError(err)).toBe(TWO_FACTOR_REQUIRED_MESSAGE);
  });

  it("is not confused with an entitlement refusal", () => {
    expect(normalizeTrpcError(forbidden({ entitlement: { reason: "plan_limit" } })).code).toBe("plan_required");
  });

  it("an unrelated or malformed twoFactor object stays Permission denied", () => {
    expect(normalizeTrpcError(forbidden({ twoFactor: { required: true, reason: "other" } })).code).toBe("forbidden");
    expect(normalizeTrpcError(forbidden({ twoFactor: { required: false, reason: "two_factor_setup_required" } })).code).toBe("forbidden");
    expect(normalizeTrpcError(forbidden({})).code).toBe("forbidden");
  });
});

describe("handleTwoFactorRequired", () => {
  const err = { code: "two_factor_required" as const, message: SERVER_MSG };

  it("exit code 11 is new and unique", () => {
    expect(EXIT.TWO_FACTOR_REQUIRED).toBe(11);
    expect(Object.values(EXIT).filter((v) => v === 11)).toHaveLength(1);
  });

  it("human mode writes the message to stderr and exits 11", () => {
    const errOut = vi.fn();
    const out = vi.fn();
    const exit = vi.fn(() => { throw new Error("exit"); }) as never;
    expect(() => handleTwoFactorRequired(err, { json: false, errOut, out, exit })).toThrow("exit");
    expect(exit).toHaveBeenCalledWith(11);
    expect(out).not.toHaveBeenCalled();
    expect(errOut.mock.calls[0][0]).toContain("use an API key");
  });

  it("json mode prints a parseable body on stdout", () => {
    const out = vi.fn();
    const exit = vi.fn(() => { throw new Error("exit"); }) as never;
    expect(() => handleTwoFactorRequired(err, { json: true, out, errOut: vi.fn(), exit })).toThrow("exit");
    expect(JSON.parse(out.mock.calls[0][0])).toEqual({ error: { code: "two_factor_required", message: TWO_FACTOR_REQUIRED_MESSAGE } });
  });
});
