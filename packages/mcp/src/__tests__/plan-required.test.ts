import { describe, it, expect } from "vitest";
import { normalizeTrpcError, formatFintranzactError, FintranzactApiError } from "../client.js";
import { wrapTool } from "../lib/errors.js";
import { buildBillingUrl, resolveWebUrl, ENTITLEMENT_REASONS } from "../lib/plan.js";

const forbidden = (entitlement?: unknown, message = "Choose a plan to keep creating and editing.") => ({
  code: "FORBIDDEN",
  message,
  data: entitlement ? { entitlement } : {},
});

describe("normalizeTrpcError entitlement handling", () => {
  it.each(ENTITLEMENT_REASONS)("maps %s to plan_required, not Permission denied", (reason) => {
    const err = normalizeTrpcError(forbidden({ reason, upgradePath: "/settings?tab=billing" }), "https://api.fintranzact.com");
    expect(err).toMatchObject({ code: "plan_required", reason, upgradeUrl: "https://app.fintranzact.com/settings?tab=billing" });
    expect(formatFintranzactError(err)).not.toContain("Permission denied");
  });

  it("read-only text is clear to an agent", () => {
    const err = normalizeTrpcError(forbidden({ reason: "read_only_trial_expired", upgradePath: "/settings?tab=billing" }, "Your trial has ended."), "https://api.x.test");
    const text = formatFintranzactError(err);
    expect(text).toContain("read-only (trial ended)");
    expect(text).toContain("Reads, search and exports still work");
    expect(text).toContain("Your trial has ended.");
    expect(text).toContain("Ask the organisation owner to choose a plan: https://app.x.test/settings?tab=billing");
  });

  it("covers payment failed, plan ended, limit, add-on and suspended", () => {
    const t = (reason: string) => formatFintranzactError(normalizeTrpcError(forbidden({ reason, upgradePath: "/p" }, "m")));
    expect(t("read_only_halted")).toContain("payment failed");
    expect(t("read_only_subscription_ended")).toContain("plan ended");
    expect(t("plan_limit")).toContain("plan limit");
    expect(t("addon_required")).toContain("add-on");
    expect(t("tenant_suspended")).toContain("suspended");
  });

  it("a normal FORBIDDEN is still Permission denied", () => {
    const err = normalizeTrpcError(forbidden(undefined, "Not allowed"));
    expect(formatFintranzactError(err)).toBe("Permission denied: Not allowed");
  });

  it("leaves non-entitlement errors unchanged", () => {
    expect(normalizeTrpcError({ code: "PRECONDITION_FAILED", message: "x" })).toEqual({ code: "api_error", message: "x" });
  });
});

describe("billing URL", () => {
  const info = { reason: "plan_limit" as const, upgradePath: "/settings?tab=billing" };
  it("prefers FINTRANZACT_WEB_URL", () => {
    expect(buildBillingUrl(info, "https://api.fintranzact.com", { FINTRANZACT_WEB_URL: "https://web.test/" })).toBe("https://web.test/settings?tab=billing");
  });
  it("derives app. from api. and falls back to production", () => {
    expect(resolveWebUrl("https://api.example.com", {})).toBe("https://app.example.com");
    expect(resolveWebUrl("http://localhost:3000", {})).toBe("https://app.fintranzact.com");
  });
});

describe("wrapTool with a plan-required error", () => {
  it("returns isError text with the link and no Permission denied", async () => {
    const handler = wrapTool(async () => {
      throw new FintranzactApiError(normalizeTrpcError(forbidden({ reason: "read_only_halted", upgradePath: "/settings?tab=billing" }), "https://api.fintranzact.com"));
    });
    const result = await handler({});
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("https://app.fintranzact.com/settings?tab=billing");
    expect(text).not.toContain("Permission denied");
  });
});
