import { describe, it, expect } from "vitest";
import { normalizeTrpcError, formatFintranzactError, FintranzactApiError } from "../client.js";
import { wrapTool } from "../lib/errors.js";

const SERVER_MSG = "Your organisation requires two-factor authentication. Set it up in Settings → Account → Security to continue.";
const twoFactor = { required: true, reason: "two_factor_setup_required", setupPath: "/settings?tab=account&pane=security" };
const forbidden = (data: unknown) => ({ code: "FORBIDDEN", message: SERVER_MSG, data });
const CLEAR =
  "Your organisation requires two-factor authentication. Turn it on in the web or mobile app (Settings → Account → Security) or use an API key.";

describe("MCP two-factor error mapping", () => {
  it("maps data.twoFactor.required to its own kind with the clear message", () => {
    const err = normalizeTrpcError(forbidden({ twoFactor }));
    expect(err).toEqual({ code: "two_factor_required", message: SERVER_MSG });
    expect(formatFintranzactError(err)).toBe(CLEAR);
  });

  it("leaves entitlement and plain forbidden errors alone", () => {
    expect(normalizeTrpcError(forbidden({ entitlement: { reason: "plan_limit" } })).code).toBe("plan_required");
    expect(normalizeTrpcError(forbidden({})).code).toBe("forbidden");
    expect(normalizeTrpcError(forbidden({ twoFactor: { required: true, reason: "x" } })).code).toBe("forbidden");
  });

  it("a tool surfaces the clear message as an error result", async () => {
    const tool = wrapTool(async () => {
      throw new FintranzactApiError(normalizeTrpcError(forbidden({ twoFactor })));
    });
    const result = await tool({});
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toBe(CLEAR);
  });
});
