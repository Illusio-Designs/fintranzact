import { describe, expect, it } from "vitest";
import {
  BACKUP_CODE_COUNT,
  CHALLENGE_TTL_MS,
  MAX_CHALLENGE_ATTEMPTS,
  SECURITY_EVENT_LABELS,
  SECURITY_EVENT_TYPES,
  TRUSTED_DEVICE_DAYS,
  TWO_FACTOR_POLICIES,
  TWO_FACTOR_SETUP_PATH,
  lockoutDuration,
  twoFactorBannerText,
  twoFactorFromError,
  twoFactorRequiredForMember,
} from "../two-factor.js";

const D = 24 * 60 * 60 * 1000;
const t0 = new Date("2026-01-10T00:00:00Z");
const base = {
  policy: "all" as const,
  role: "member",
  enforcedAt: t0,
  graceDays: 7,
  memberSince: new Date("2025-01-01T00:00:00Z"),
  hasTwoFactor: false,
  now: new Date(t0.getTime() + D),
};

describe("constants", () => {
  it("has the agreed values", () => {
    expect(TWO_FACTOR_POLICIES).toEqual(["off", "admins", "all"]);
    expect(TRUSTED_DEVICE_DAYS).toBe(30);
    expect(CHALLENGE_TTL_MS).toBe(300_000);
    expect(MAX_CHALLENGE_ATTEMPTS).toBe(5);
    expect(BACKUP_CODE_COUNT).toBe(10);
  });
  it("labels every security event type", () => {
    for (const t of SECURITY_EVENT_TYPES) expect(SECURITY_EVENT_LABELS[t]).toBeTruthy();
    expect(SECURITY_EVENT_TYPES).toHaveLength(12);
  });
});

describe("lockoutDuration", () => {
  it("escalates 15 min, 1 h, 24 h", () => {
    expect(lockoutDuration(0)).toBe(15 * 60_000);
    expect(lockoutDuration(1)).toBe(3_600_000);
    expect(lockoutDuration(2)).toBe(24 * 3_600_000);
    expect(lockoutDuration(9)).toBe(24 * 3_600_000);
  });
  it("treats negative / NaN as the first lockout", () => {
    expect(lockoutDuration(-1)).toBe(15 * 60_000);
    expect(lockoutDuration(NaN)).toBe(15 * 60_000);
  });
});

describe("twoFactorRequiredForMember", () => {
  it("policy off: never required", () => {
    expect(twoFactorRequiredForMember({ ...base, policy: "off", role: "owner" })).toEqual({
      required: false, blocked: false, graceEndsAt: null,
    });
  });
  it("admins policy covers owner/superadmin/admin and the accountant access roles only", () => {
    for (const role of ["owner", "superadmin", "admin", "auditor", "ca_filing"]) {
      expect(twoFactorRequiredForMember({ ...base, policy: "admins", role }).required).toBe(true);
    }
    for (const role of ["member", "viewer", "seller", "seller_manager", "accountant"]) {
      expect(twoFactorRequiredForMember({ ...base, policy: "admins", role }).required).toBe(false);
    }
  });
  it("all policy covers every role", () => {
    for (const role of ["owner", "member", "viewer", "accountant"]) {
      expect(twoFactorRequiredForMember({ ...base, role }).required).toBe(true);
    }
  });
  it("members who already have 2FA are not required", () => {
    const r = twoFactorRequiredForMember({ ...base, hasTwoFactor: true, now: new Date(t0.getTime() + 100 * D) });
    expect(r).toEqual({ required: false, blocked: false, graceEndsAt: null });
  });
  it("grace runs from enforcedAt for long-standing members", () => {
    const r = twoFactorRequiredForMember(base);
    expect(r.graceEndsAt).toEqual(new Date(t0.getTime() + 7 * D));
    expect(r.blocked).toBe(false);
  });
  it("grace runs from memberSince for members who joined after enforcement", () => {
    const memberSince = new Date(t0.getTime() + 3 * D);
    const r = twoFactorRequiredForMember({ ...base, memberSince, now: new Date(t0.getTime() + 9 * D) });
    expect(r.graceEndsAt).toEqual(new Date(memberSince.getTime() + 7 * D));
    expect(r.blocked).toBe(false);
  });
  it("blocks exactly at the deadline, not before", () => {
    const end = t0.getTime() + 7 * D;
    expect(twoFactorRequiredForMember({ ...base, now: new Date(end - 1) }).blocked).toBe(false);
    expect(twoFactorRequiredForMember({ ...base, now: new Date(end) }).blocked).toBe(true);
    expect(twoFactorRequiredForMember({ ...base, now: new Date(end + D) }).blocked).toBe(true);
  });
  it("graceDays 0 blocks immediately", () => {
    const r = twoFactorRequiredForMember({ ...base, graceDays: 0, now: t0 });
    expect(r.required).toBe(true);
    expect(r.blocked).toBe(true);
  });
  it("null enforcedAt falls back to memberSince", () => {
    const r = twoFactorRequiredForMember({ ...base, enforcedAt: null });
    expect(r.graceEndsAt).toEqual(new Date(base.memberSince.getTime() + 7 * D));
    expect(r.blocked).toBe(true);
  });
  it("negative grace is treated as zero", () => {
    expect(twoFactorRequiredForMember({ ...base, graceDays: -3, now: t0 }).blocked).toBe(true);
  });
});

describe("enforcement error shape and banner text", () => {
  const data = { twoFactor: { required: true, reason: "two_factor_setup_required", setupPath: "/settings?tab=account&pane=security" } };

  it("twoFactorFromError reads error.data.twoFactor and nothing else", () => {
    expect(twoFactorFromError({ data })).toEqual(data.twoFactor);
    expect(twoFactorFromError({ data: {} })).toBeNull();
    expect(twoFactorFromError({ data: { twoFactor: { required: true, reason: "other" } } })).toBeNull();
    expect(twoFactorFromError({ data: { twoFactor: { required: false, reason: "two_factor_setup_required" } } })).toBeNull();
    expect(twoFactorFromError(null)).toBeNull();
  });

  it("falls back to the default setup path when it is missing or not a path", () => {
    expect(twoFactorFromError({ data: { twoFactor: { ...data.twoFactor, setupPath: undefined } } })?.setupPath).toBe(TWO_FACTOR_SETUP_PATH);
    expect(twoFactorFromError({ data: { twoFactor: { ...data.twoFactor, setupPath: "https://evil.example" } } })?.setupPath).toBe(TWO_FACTOR_SETUP_PATH);
  });

  it("twoFactorBannerText: nothing, grace with date, blocked", () => {
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    expect(twoFactorBannerText(null, fmt)).toBeNull();
    expect(twoFactorBannerText({ required: false, blocked: false, graceEndsAt: null }, fmt)).toBeNull();
    expect(twoFactorBannerText({ required: true, blocked: false, graceEndsAt: new Date("2026-07-01T00:00:00Z") }, fmt)).toEqual({
      kind: "grace",
      text: "Your organisation requires two-factor authentication. Set it up by 2026-07-01.",
    });
    expect(twoFactorBannerText({ required: true, blocked: true, graceEndsAt: null }, fmt)?.kind).toBe("blocked");
  });
});

import {
  RESET_IDENTITY_CHECKS,
  RESET_IDENTITY_CHECK_LABELS,
  RESET_VERIFICATION_METHODS,
  RESET_VERIFICATION_METHOD_LABELS,
  resetEmailConfirmed,
  validateResetVerification,
} from "../two-factor";

describe("reset verification", () => {
  const ok = { method: "video_call", checks: ["name_matches_account", "last_login_detail_confirmed"], reason: "x".repeat(20) };
  it("has a label for every method and check", () => {
    for (const m of RESET_VERIFICATION_METHODS) expect(RESET_VERIFICATION_METHOD_LABELS[m]).toBeTruthy();
    for (const c of RESET_IDENTITY_CHECKS) expect(RESET_IDENTITY_CHECK_LABELS[c]).toBeTruthy();
  });
  it("accepts method + two distinct checks + 20 char reason", () => {
    expect(validateResetVerification(ok)).toEqual([]);
  });
  it("rejects each failure on its own", () => {
    expect(validateResetVerification({ ...ok, method: "nope" })).toHaveLength(1);
    expect(validateResetVerification({ ...ok, checks: ["name_matches_account"] })).toHaveLength(1);
    expect(validateResetVerification({ ...ok, checks: ["name_matches_account", "name_matches_account", "zzz"] })).toHaveLength(1);
    expect(validateResetVerification({ ...ok, reason: " ".repeat(10) + "short" })).toHaveLength(1);
  });
  it("matches the typed email case-insensitively", () => {
    expect(resetEmailConfirmed(" Asha@Example.COM ", "asha@example.com")).toBe(true);
    expect(resetEmailConfirmed("a@example.com", "asha@example.com")).toBe(false);
  });
});
