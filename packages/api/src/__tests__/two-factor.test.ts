/**
 * two-factor.test.ts — enrolment, disable, regenerate and verifySecondFactor,
 * with the data layer faked in memory (no database).
 */
import { describe, expect, it, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";
import { BACKUP_CODE_COUNT, lockoutDuration } from "@fintranzact/shared";
import { totpAt, base32Decode } from "../lib/totp.js";
import { hashBackupCode } from "../lib/two-factor-codes.js";
import { decryptTotpSecret } from "../lib/field-encryption.js";
import {
  beginTwoFactorSetup,
  confirmTwoFactorSetup,
  disableTwoFactor,
  formatManualKey,
  getTwoFactorStatus,
  regenerateBackupCodes,
  renderQrDataUrl,
  verifySecondFactor,
  type MembershipPolicy,
  type TwoFactorDeps,
  type TwoFactorRecord,
  type TwoFactorStore,
} from "../lib/two-factor.js";
import type { SecurityEventInput } from "../lib/security-events.js";

const USER = "11111111-1111-1111-1111-111111111111";
const EMAIL = "Rahul@Example.in";
const T0 = Date.UTC(2026, 9, 2, 12, 0, 0);

interface Fake {
  deps: TwoFactorDeps;
  rec: () => TwoFactorRecord | null;
  secret: () => string;
  codes: { hash: string; used: boolean }[];
  events: SecurityEventInput[];
  rotations: Array<[string, string | undefined]>;
  user: { email: string; passwordHash: string | null; twoFactorEnabled: boolean };
  policies: MembershipPolicy[];
  limiterFails: string[];
  devicesRevoked: () => boolean;
  clock: { now: number };
  passwords: Set<string>;
}

function makeFake(): Fake {
  const clock = { now: T0 };
  let record: TwoFactorRecord | null = null;
  const codes: { hash: string; used: boolean }[] = [];
  const events: SecurityEventInput[] = [];
  const rotations: Array<[string, string | undefined]> = [];
  const limiterFails: string[] = [];
  const policies: MembershipPolicy[] = [];
  let devicesRevoked = false;
  const user = { email: EMAIL, passwordHash: "hash:right-password", twoFactorEnabled: false };
  const passwords = new Set(["right-password"]);

  const store: TwoFactorStore = {
    async getRecord() {
      return record ? { ...record } : null;
    },
    async getUserAuth() {
      return { ...user };
    },
    async upsertPendingSecret(_u, secretEnc) {
      if (record?.confirmedAt) return false;
      record = record
        ? { ...record, secretEnc, lastUsedStep: null }
        : { userId: USER, secretEnc, confirmedAt: null, lastUsedStep: null, failedCount: 0, lockedUntil: null, lockoutCount: 0, createdAt: new Date(clock.now) };
      return true;
    },
    async advanceStep(_u, step) {
      if (!record || (record.lastUsedStep !== null && record.lastUsedStep >= step)) return false;
      record.lastUsedStep = step;
      return true;
    },
    async recordFailure(_u, now) {
      if (!record) return { locked: false, lockedUntil: null };
      if (record.failedCount + 1 >= 5) {
        record.failedCount = 0;
        record.lockedUntil = new Date(now.getTime() + lockoutDuration(record.lockoutCount));
        record.lockoutCount += 1;
        return { locked: true, lockedUntil: record.lockedUntil };
      }
      record.failedCount += 1;
      return { locked: false, lockedUntil: null };
    },
    async recordSuccess() {
      if (record) Object.assign(record, { failedCount: 0, lockoutCount: 0, lockedUntil: null });
    },
    async consumeBackupCode(_u, hash) {
      const c = codes.find((x) => x.hash === hash && !x.used);
      if (!c) return false;
      c.used = true;
      return true;
    },
    async countUnusedBackupCodes() {
      return codes.filter((c) => !c.used).length;
    },
    async completeEnrolment(_u, { step, codeHashes, now }) {
      if (!record || record.confirmedAt) return false;
      Object.assign(record, { confirmedAt: now, lastUsedStep: step, failedCount: 0, lockoutCount: 0, lockedUntil: null });
      user.twoFactorEnabled = true;
      codes.length = 0;
      for (const hash of codeHashes) codes.push({ hash, used: false });
      return true;
    },
    async replaceBackupCodes(_u, hashes) {
      codes.length = 0;
      for (const hash of hashes) codes.push({ hash, used: false });
    },
    async disable() {
      record = null;
      codes.length = 0;
      devicesRevoked = true;
      user.twoFactorEnabled = false;
    },
    async membershipPolicies() {
      return policies;
    },
    async countTrustedDevices() {
      return 0;
    },
  };

  const deps: TwoFactorDeps = {
    store,
    async record(e) {
      events.push(e);
    },
    async rotateSessions(userId, keep) {
      rotations.push([userId, keep]);
    },
    passwordLimiter: {
      isBlocked: (k: string) => limiterFails.filter((x) => x === k).length >= 5,
      recordFailure: (k: string) => void limiterFails.push(k),
    },
    async verifyPassword(hash, pw) {
      return hash === `hash:${pw}` && passwords.has(pw);
    },
    renderQr: renderQrDataUrl,
    now: () => clock.now,
  };

  return {
    deps,
    rec: () => record,
    secret: () => decryptTotpSecret(record!.secretEnc),
    codes,
    events,
    rotations,
    user,
    policies,
    limiterFails,
    devicesRevoked: () => devicesRevoked,
    clock,
    passwords,
  };
}

const codeNow = (f: Fake, offsetSteps = 0) => totpAt(f.secret(), f.clock.now + offsetSteps * 30_000);
const types = (f: Fake) => f.events.map((e) => e.type);

async function enrol(f: Fake): Promise<string[]> {
  await beginTwoFactorSetup(f.deps, { id: USER, email: EMAIL });
  const { backupCodes } = await confirmTwoFactorSetup(f.deps, USER, codeNow(f), { currentSessionId: "sess-current" });
  return backupCodes;
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(TRPCError);
    return (e as TRPCError).code;
  }
  return "OK";
}

let f: Fake;
beforeEach(() => {
  f = makeFake();
});

describe("beginTwoFactorSetup", () => {
  it("returns a valid otpauth URI, a PNG data URL and a grouped manual key", async () => {
    const r = await beginTwoFactorSetup(f.deps, { id: USER, email: EMAIL });
    const url = new URL(r.otpauthUri);
    expect(url.protocol).toBe("otpauth:");
    expect(url.host).toBe("totp");
    expect(url.searchParams.get("secret")).toBe(f.secret());
    expect(url.searchParams.get("issuer")).toBe("Fintranzact");
    expect(r.qrDataUrl).toMatch(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/);
    expect(r.manualKey).toMatch(/^([A-Z2-7]{4} ){7}[A-Z2-7]{4}$/);
    expect(r.manualKey.replace(/ /g, "")).toBe(f.secret());
    expect(r.accountName).toBe(EMAIL);
    expect(r.issuer).toBe("Fintranzact");
    expect(f.rec()!.confirmedAt).toBeNull();
    expect(f.rec()!.secretEnc).not.toContain(f.secret()); // stored encrypted
    expect(types(f)).toEqual(["2fa.setup_started"]);
  });

  it("replaces an earlier pending secret", async () => {
    await beginTwoFactorSetup(f.deps, { id: USER, email: EMAIL });
    const first = f.secret();
    await beginTwoFactorSetup(f.deps, { id: USER, email: EMAIL });
    expect(f.secret()).not.toBe(first);
    expect((await getTwoFactorStatus(f.deps, USER)).pendingSetup).toBe(true);
  });

  it("is refused when 2FA is already on", async () => {
    await enrol(f);
    expect(await code(beginTwoFactorSetup(f.deps, { id: USER, email: EMAIL }))).toBe("BAD_REQUEST");
  });

  it("formats the manual key in groups of four", () => {
    expect(formatManualKey("ABCDEFGHIJ")).toBe("ABCD EFGH IJ");
  });
});

describe("confirmTwoFactorSetup", () => {
  it("enables 2FA, stores only hashes, returns plaintext codes once, rotates other sessions", async () => {
    const codes = await enrol(f);
    expect(codes).toHaveLength(BACKUP_CODE_COUNT);
    expect(f.codes).toHaveLength(BACKUP_CODE_COUNT);
    for (const c of codes) expect(f.codes.map((x) => x.hash)).toContain(hashBackupCode(USER, c));
    expect(f.codes.some((x) => codes.includes(x.hash))).toBe(false);
    expect(f.user.twoFactorEnabled).toBe(true);
    expect(f.rec()!.confirmedAt).not.toBeNull();
    expect(f.rec()!.lastUsedStep).not.toBeNull();
    expect(f.rotations).toEqual([[USER, "sess-current"]]);
    expect(types(f)).toEqual(["2fa.setup_started", "2fa.enabled"]);
    const status = await getTwoFactorStatus(f.deps, USER);
    expect(status).toMatchObject({ enabled: true, pendingSetup: false, backupCodesRemaining: BACKUP_CODE_COUNT, lockedUntil: null, trustedDeviceCount: 0 });
  });

  it("accepts a code from the adjacent step (clock drift)", async () => {
    await beginTwoFactorSetup(f.deps, { id: USER, email: EMAIL });
    await confirmTwoFactorSetup(f.deps, USER, codeNow(f, -1));
    expect(f.user.twoFactorEnabled).toBe(true);
  });

  it("wrong code is BAD_REQUEST (not UNAUTHORIZED), counted, and nothing is enabled", async () => {
    await beginTwoFactorSetup(f.deps, { id: USER, email: EMAIL });
    const err = await confirmTwoFactorSetup(f.deps, USER, "000000").catch((e) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect(err.code).toBe("BAD_REQUEST");
    expect(err.message).toMatch(/^That code is not right/);
    expect(f.rec()!.failedCount).toBe(1);
    expect(f.user.twoFactorEnabled).toBe(false);
    expect(f.rotations).toEqual([]);
    expect(types(f)).toContain("2fa.failed");
  });

  it("a backup-code-shaped value is not accepted at setup", async () => {
    await beginTwoFactorSetup(f.deps, { id: USER, email: EMAIL });
    expect(await code(confirmTwoFactorSetup(f.deps, USER, "ABCDEF-GHJKMN"))).toBe("BAD_REQUEST");
  });

  it("locks after 5 consecutive wrong codes and refuses even the right code while locked", async () => {
    await beginTwoFactorSetup(f.deps, { id: USER, email: EMAIL });
    for (let i = 0; i < 4; i++) expect(await code(confirmTwoFactorSetup(f.deps, USER, "000000"))).toBe("BAD_REQUEST");
    const err = await confirmTwoFactorSetup(f.deps, USER, "000000").catch((e) => e);
    expect(err.code).toBe("TOO_MANY_REQUESTS");
    expect(err.message).toContain(new Date(T0 + lockoutDuration(0)).toISOString());
    expect(types(f)).toContain("2fa.locked");
    expect(await code(confirmTwoFactorSetup(f.deps, USER, codeNow(f)))).toBe("TOO_MANY_REQUESTS");
    expect(f.user.twoFactorEnabled).toBe(false);
    // The lock expires.
    f.clock.now += lockoutDuration(0) + 1000;
    await confirmTwoFactorSetup(f.deps, USER, codeNow(f));
    expect(f.user.twoFactorEnabled).toBe(true);
  });

  it("without a pending setup it asks to start setup", async () => {
    const err = await confirmTwoFactorSetup(f.deps, USER, "123456").catch((e) => e);
    expect(err.code).toBe("BAD_REQUEST");
    expect(err.message).toMatch(/Start two-factor setup/);
  });

  it("cannot be run again once enabled", async () => {
    await enrol(f);
    expect(await code(confirmTwoFactorSetup(f.deps, USER, codeNow(f, 1)))).toBe("BAD_REQUEST");
  });

  it("the setup code cannot be replayed afterwards (same step twice)", async () => {
    await enrol(f);
    const stale = codeNow(f); // same 30s step as the one used to confirm
    const r = await verifySecondFactor(f.deps, USER, stale, { allowBackup: false });
    expect(r).toMatchObject({ ok: false, reason: "invalid" });
  });
});

describe("verifySecondFactor", () => {
  it("not enrolled / pending", async () => {
    expect((await verifySecondFactor(f.deps, USER, "123456", { allowBackup: true })).reason).toBe("not_enrolled");
    await beginTwoFactorSetup(f.deps, { id: USER, email: EMAIL });
    expect((await verifySecondFactor(f.deps, USER, "123456", { allowBackup: true })).reason).toBe("not_enrolled");
  });

  it("accepts a TOTP once; the same step is then rejected, the next step accepted", async () => {
    await enrol(f);
    f.clock.now += 60_000;
    const c = codeNow(f);
    expect(await verifySecondFactor(f.deps, USER, c, { allowBackup: true })).toMatchObject({ ok: true, method: "totp", reason: null });
    expect(await verifySecondFactor(f.deps, USER, c, { allowBackup: true })).toMatchObject({ ok: false, method: null, reason: "invalid" });
    f.clock.now += 30_000;
    expect((await verifySecondFactor(f.deps, USER, codeNow(f), { allowBackup: true })).ok).toBe(true);
    expect(types(f).filter((t) => t === "2fa.verified")).toHaveLength(2);
  });

  it("accepts a backup code once only, in any format", async () => {
    const codes = await enrol(f);
    const sloppy = codes[0].toLowerCase().replace("-", " ");
    expect(await verifySecondFactor(f.deps, USER, sloppy, { allowBackup: true })).toMatchObject({ ok: true, method: "backup_code" });
    expect(await verifySecondFactor(f.deps, USER, codes[0], { allowBackup: true })).toMatchObject({ ok: false, reason: "invalid" });
    expect(types(f)).toContain("2fa.backup_used");
    expect((await getTwoFactorStatus(f.deps, USER)).backupCodesRemaining).toBe(BACKUP_CODE_COUNT - 1);
  });

  it("refuses a backup code when not allowed, and counts it as a failure", async () => {
    const codes = await enrol(f);
    expect(await verifySecondFactor(f.deps, USER, codes[0], { allowBackup: false })).toMatchObject({ ok: false, reason: "invalid" });
    expect(f.rec()!.failedCount).toBe(1);
    expect(f.codes.every((c) => !c.used)).toBe(true);
  });

  it("success resets the failure counter", async () => {
    await enrol(f);
    f.clock.now += 60_000;
    for (let i = 0; i < 3; i++) await verifySecondFactor(f.deps, USER, "000000", { allowBackup: true });
    expect(f.rec()!.failedCount).toBe(3);
    await verifySecondFactor(f.deps, USER, codeNow(f), { allowBackup: true });
    expect(f.rec()!.failedCount).toBe(0);
  });

  it("locks after 5 failures with escalating durations", async () => {
    await enrol(f);
    f.clock.now += 60_000;
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await verifySecondFactor(f.deps, USER, "000000", { allowBackup: true }));
    expect(results.slice(0, 4).every((r) => r.reason === "invalid")).toBe(true);
    expect(results[4]).toMatchObject({ ok: false, reason: "locked" });
    expect(results[4].lockedUntil!.getTime()).toBe(f.clock.now + lockoutDuration(0));
    // While locked the right code is still refused and no failure is added.
    expect(await verifySecondFactor(f.deps, USER, codeNow(f), { allowBackup: true })).toMatchObject({ reason: "locked" });
    // Second lockout is an hour.
    f.clock.now += lockoutDuration(0) + 1000;
    let last;
    for (let i = 0; i < 5; i++) last = await verifySecondFactor(f.deps, USER, "000000", { allowBackup: true });
    expect(last!.lockedUntil!.getTime()).toBe(f.clock.now + lockoutDuration(1));
    expect(types(f).filter((t) => t === "2fa.locked")).toHaveLength(2);
    expect((await getTwoFactorStatus(f.deps, USER)).lockedUntil).not.toBeNull();
  });
});

describe("disableTwoFactor", () => {
  const good = () => ({ password: "right-password", code: codeNow(f, 1) });

  it("needs 2FA to be on", async () => {
    expect(await code(disableTwoFactor(f.deps, USER, { password: "right-password", code: "123456" }))).toBe("BAD_REQUEST");
  });

  it("succeeds with password + TOTP: clears everything, revokes devices, rotates sessions", async () => {
    await enrol(f);
    await disableTwoFactor(f.deps, USER, good(), { currentSessionId: "sess-current" });
    expect(f.user.twoFactorEnabled).toBe(false);
    expect(f.rec()).toBeNull();
    expect(f.codes).toHaveLength(0);
    expect(f.devicesRevoked()).toBe(true);
    expect(f.rotations.at(-1)).toEqual([USER, "sess-current"]);
    expect(types(f).at(-1)).toBe("2fa.disabled");
  });

  it("accepts an unused backup code", async () => {
    const codes = await enrol(f);
    await disableTwoFactor(f.deps, USER, { password: "right-password", code: codes[3] });
    expect(f.user.twoFactorEnabled).toBe(false);
  });

  it("wrong password: generic BAD_REQUEST, feeds the per-user password limiter, no 2FA failure counted", async () => {
    await enrol(f);
    const err = await disableTwoFactor(f.deps, USER, { password: "nope", code: codeNow(f, 1) }).catch((e) => e);
    expect(err.code).toBe("BAD_REQUEST");
    expect(f.limiterFails).toEqual([`2fa-password:${USER}`]);
    expect(f.rec()!.failedCount).toBe(0);
    expect(f.user.twoFactorEnabled).toBe(true);
  });

  it("the password limiter blocks brute force after 5 wrong passwords", async () => {
    await enrol(f);
    for (let i = 0; i < 5; i++) await code(disableTwoFactor(f.deps, USER, { password: "nope", code: "123456" }));
    expect(await code(disableTwoFactor(f.deps, USER, good()))).toBe("TOO_MANY_REQUESTS");
    expect(f.user.twoFactorEnabled).toBe(true);
  });

  it("wrong code leaves 2FA on and counts a failure", async () => {
    await enrol(f);
    expect(await code(disableTwoFactor(f.deps, USER, { password: "right-password", code: "000000" }))).toBe("BAD_REQUEST");
    expect(f.user.twoFactorEnabled).toBe(true);
    expect(f.rec()!.failedCount).toBe(1);
  });

  it("is refused when an organisation enforces 2FA on this member", async () => {
    await enrol(f);
    f.policies.push({ tenantId: "t1", role: "admin", policy: "admins", enforcedAt: null, graceDays: 7, memberSince: new Date(T0 - 1000) });
    const err = await disableTwoFactor(f.deps, USER, good()).catch((e) => e);
    expect(err.code).toBe("FORBIDDEN");
    expect(err.message).toMatch(/^Your organisation requires two-factor authentication/);
    expect(f.user.twoFactorEnabled).toBe(true);
  });

  it("still refused during the grace window of a fresh policy", async () => {
    await enrol(f);
    f.policies.push({ tenantId: "t1", role: "member", policy: "all", enforcedAt: new Date(T0), graceDays: 30, memberSince: new Date(T0 - 1e9) });
    expect(await code(disableTwoFactor(f.deps, USER, good()))).toBe("FORBIDDEN");
  });

  it("is allowed when the policy does not cover the member's role, or is off", async () => {
    await enrol(f);
    f.policies.push({ tenantId: "t1", role: "member", policy: "admins", enforcedAt: null, graceDays: 7, memberSince: new Date(T0 - 1000) });
    f.policies.push({ tenantId: "t2", role: "owner", policy: "off", enforcedAt: null, graceDays: 7, memberSince: new Date(T0 - 1000) });
    await disableTwoFactor(f.deps, USER, good());
    expect(f.user.twoFactorEnabled).toBe(false);
  });

  it("accounts with no password only need the code", async () => {
    await enrol(f);
    f.user.passwordHash = null;
    await disableTwoFactor(f.deps, USER, { password: "x", code: codeNow(f, 1) });
    expect(f.user.twoFactorEnabled).toBe(false);
  });
});

describe("regenerateBackupCodes", () => {
  it("replaces ALL codes; the old ones stop working", async () => {
    const old = await enrol(f);
    const { backupCodes } = await regenerateBackupCodes(f.deps, USER, { password: "right-password", code: codeNow(f, 1) });
    expect(backupCodes).toHaveLength(BACKUP_CODE_COUNT);
    expect(backupCodes.some((c) => old.includes(c))).toBe(false);
    expect(f.codes).toHaveLength(BACKUP_CODE_COUNT);
    expect(types(f).at(-1)).toBe("2fa.backup_regenerated");
    f.clock.now += 60_000;
    expect((await verifySecondFactor(f.deps, USER, old[0], { allowBackup: true })).ok).toBe(false);
    expect((await verifySecondFactor(f.deps, USER, backupCodes[0], { allowBackup: true })).ok).toBe(true);
    expect(f.rotations).toHaveLength(1); // enrolment only: regeneration does not rotate sessions
    expect(f.devicesRevoked()).toBe(false);
  });

  it("refuses a backup code (TOTP only) and leaves the codes untouched", async () => {
    const old = await enrol(f);
    expect(await code(regenerateBackupCodes(f.deps, USER, { password: "right-password", code: old[0] }))).toBe("BAD_REQUEST");
    expect(f.codes.map((c) => c.hash)).toEqual(old.map((c) => hashBackupCode(USER, c)));
    expect(f.codes.every((c) => !c.used)).toBe(true);
  });

  it("needs the right password and 2FA on", async () => {
    expect(await code(regenerateBackupCodes(f.deps, USER, { password: "right-password", code: "123456" }))).toBe("BAD_REQUEST");
    await enrol(f);
    expect(await code(regenerateBackupCodes(f.deps, USER, { password: "wrong", code: codeNow(f, 1) }))).toBe("BAD_REQUEST");
  });
});

describe("secret handling", () => {
  it("the stored secret decodes to 20 bytes and is not plaintext", async () => {
    await beginTwoFactorSetup(f.deps, { id: USER, email: EMAIL });
    expect(base32Decode(f.secret())).toHaveLength(20);
    expect(f.rec()!.secretEnc).toMatch(/^v\d+:/);
  });
});
