import { describe, expect, it } from "vitest";
import {
  BACKUP_CODE_COUNT,
  CHALLENGE_TTL_MS,
  MAX_CHALLENGE_ATTEMPTS,
  SECURITY_EVENT_LABELS,
  SECURITY_EVENT_TYPES,
  TRUSTED_DEVICE_DAYS,
  TWO_FACTOR_POLICIES,
  lockoutDuration,
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
  it("admins policy covers owner/superadmin/admin only", () => {
    for (const role of ["owner", "superadmin", "admin"]) {
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
