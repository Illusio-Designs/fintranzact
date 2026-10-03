import { describe, it, expect } from "vitest";
import {
  describePolicyChange,
  isTwoFactorExemptPath,
  policyCoversRole,
  policyLabel,
  setupSearch,
  shouldRedirectToTwoFactorSetup,
  summariseMembers,
} from "@/lib/two-factor-enforcement";

describe("shouldRedirectToTwoFactorSetup", () => {
  it("never redirects an unblocked user", () => {
    expect(shouldRedirectToTwoFactorSetup(false, "/invoices")).toBe(false);
  });
  it("redirects a blocked user away from app pages", () => {
    for (const p of ["/", "/invoices", "/parties/123", "/pos", "/gst"]) expect(shouldRedirectToTwoFactorSetup(true, p)).toBe(true);
  });
  it("lets a blocked user stay on settings, auth, pricing and public pages", () => {
    for (const p of ["/settings", "/auth/complete-profile", "/login", "/pricing", "/invite/abc", "/help/settings", "/platform"]) {
      expect(shouldRedirectToTwoFactorSetup(true, p)).toBe(false);
    }
  });
  it("matches whole path segments, not prefixes", () => {
    expect(isTwoFactorExemptPath("/settingsx")).toBe(false);
    expect(isTwoFactorExemptPath("/pricing-old")).toBe(false);
  });
});

describe("setupSearch", () => {
  it("maps the server's setup path to Settings search params", () => {
    expect(setupSearch("/settings?tab=account&pane=security")).toEqual({ tab: "account", pane: "security" });
  });
  it("falls back to the Security pane", () => {
    expect(setupSearch(undefined)).toEqual({ tab: "account", pane: "security" });
    expect(setupSearch("/settings")).toEqual({ tab: "account", pane: "security" });
  });
});

describe("policy helpers", () => {
  it("labels", () => {
    expect(policyLabel("all")).toBe("Everyone");
    expect(policyLabel("admins")).toBe("Owners and admins");
    expect(policyLabel("weird")).toBe("Off");
  });
  it("policyCoversRole", () => {
    expect(policyCoversRole("off", "owner")).toBe(false);
    expect(policyCoversRole("admins", "admin")).toBe(true);
    expect(policyCoversRole("admins", "seller")).toBe(false);
    expect(policyCoversRole("all", "accountant")).toBe(true);
    expect(policyCoversRole("all", undefined)).toBe(true);
    expect(policyCoversRole("admins", undefined)).toBe(false);
  });
  it("describePolicyChange covers off, grace and immediate", () => {
    expect(describePolicyChange("off", 7)).toContain("optional");
    expect(describePolicyChange("all", 7)).toContain("Every member must use two-factor authentication. Anyone who has not set it up has 7 days");
    expect(describePolicyChange("admins", 1)).toContain("1 day from now");
    expect(describePolicyChange("all", 0)).toContain("blocked straight away");
    expect(describePolicyChange("admins", 3)).toContain("owner, superadmin and admin");
  });
});

describe("summariseMembers", () => {
  const members = [
    { role: "owner", twoFactorEnabled: true },
    { role: "admin", twoFactorEnabled: false },
    { role: "seller", twoFactorEnabled: false },
    { role: "accountant", twoFactorEnabled: true },
  ];
  it("counts covered members still missing 2FA", () => {
    expect(summariseMembers(members, "all")).toEqual({ total: 4, missing: 2 });
    expect(summariseMembers(members, "admins")).toEqual({ total: 2, missing: 1 });
    expect(summariseMembers(members, "off")).toEqual({ total: 4, missing: 2 });
  });
  it("members whose status is unknown are not counted as missing", () => {
    expect(summariseMembers([{ role: "seller" }], "all")).toEqual({ total: 1, missing: 0 });
  });
});
