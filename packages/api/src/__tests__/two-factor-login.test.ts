/**
 * two-factor-login.test.ts — the sign-in challenge, trusted devices and cookie
 * rules, with the data layer faked in memory (no database).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, beforeEach } from "vitest";
import { CHALLENGE_TTL_MS, MAX_CHALLENGE_ATTEMPTS, TRUSTED_DEVICE_DAYS, lockoutDuration } from "@fintranzact/shared";
import { generateSecret, totpAt } from "../lib/totp.js";
import { encryptTotpSecret } from "../lib/field-encryption.js";
import { hashBackupCode, hashOpaqueToken, newOpaqueToken } from "../lib/two-factor-codes.js";
import { createFixedWindowLimiter } from "../lib/fixed-window-limiter.js";
import type { SecurityEventInput } from "../lib/security-events.js";
import type { FailureOutcome, TwoFactorDeps, TwoFactorRecord, TwoFactorStore } from "../lib/two-factor.js";
import {
  CHALLENGE_EXPIRED_MESSAGE,
  TRUSTED_DEVICE_COOKIE,
  appendSetCookies,
  canRememberDevice,
  decideSignIn,
  deviceLabel,
  issueTrustedDevice,
  listTrustedDevices,
  planTrustedDeviceDelivery,
  presentedTrustedDeviceToken,
  readTrustedDeviceCookie,
  resolveClientKind,
  revokeAllTrustedDevices,
  revokeTrustedDevice,
  trustedDeviceClearCookie,
  trustedDeviceSetCookie,
  verifySignInChallenge,
  type ChallengeRow,
  type TrustedDeviceRow,
  type TwoFactorLoginDeps,
  type TwoFactorLoginStore,
} from "../lib/two-factor-login.js";

const USER = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const T0 = Date.UTC(2026, 9, 2, 12, 0, 0);
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const EVENT = { ip: "203.0.113.9", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36" };

interface Fake {
  deps: TwoFactorLoginDeps;
  clock: { now: number };
  events: SecurityEventInput[];
  secret: string;
  rec: TwoFactorRecord;
  codes: { hash: string; used: boolean }[];
  challenges: Array<ChallengeRow & { tokenHash: string; ip: string | null; userAgent: string | null }>;
  devices: Array<TrustedDeviceRow & { tokenHash: string; userAgent: string | null }>;
  touched: string[];
  deleted: { expiredCalls: number };
}

function makeFake(limits: { ip?: number; challenge?: number } = {}): Fake {
  const clock = { now: T0 };
  const events: SecurityEventInput[] = [];
  const secret = generateSecret();
  const rec: TwoFactorRecord = {
    userId: USER,
    secretEnc: encryptTotpSecret(secret),
    confirmedAt: new Date(T0 - DAY),
    lastUsedStep: null,
    failedCount: 0,
    lockedUntil: null,
    lockoutCount: 0,
    createdAt: new Date(T0 - DAY),
  };
  const codes: Fake["codes"] = [];
  const challenges: Fake["challenges"] = [];
  const devices: Fake["devices"] = [];
  const touched: string[] = [];
  const deleted = { expiredCalls: 0 };

  const base: TwoFactorStore = {
    async getRecord() {
      return { ...rec };
    },
    async getUserAuth() {
      return { email: "a@example.in", passwordHash: "x", twoFactorEnabled: true };
    },
    async upsertPendingSecret() {
      return false;
    },
    async advanceStep(_u, step) {
      if (rec.lastUsedStep !== null && rec.lastUsedStep >= step) return false;
      rec.lastUsedStep = step;
      return true;
    },
    async recordFailure(_u, now): Promise<FailureOutcome> {
      if (rec.failedCount + 1 >= 5) {
        rec.failedCount = 0;
        rec.lockedUntil = new Date(now.getTime() + lockoutDuration(rec.lockoutCount));
        rec.lockoutCount += 1;
        return { locked: true, lockedUntil: rec.lockedUntil };
      }
      rec.failedCount += 1;
      return { locked: false, lockedUntil: null };
    },
    async recordSuccess() {
      Object.assign(rec, { failedCount: 0, lockoutCount: 0, lockedUntil: null });
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
    async completeEnrolment() {
      return false;
    },
    async replaceBackupCodes() {},
    async disable() {},
    async membershipPolicies() {
      return [];
    },
    async countTrustedDevices() {
      return 0;
    },
  };

  const store: TwoFactorLoginStore = {
    async createChallenge(i) {
      challenges.push({ id: `c${challenges.length + 1}`, attempts: 0, consumedAt: null, ...i });
    },
    async deleteExpiredChallenges(now) {
      deleted.expiredCalls++;
      for (let i = challenges.length - 1; i >= 0; i--) if (challenges[i].expiresAt.getTime() < now.getTime()) challenges.splice(i, 1);
    },
    async getChallengeByHash(h) {
      const c = challenges.find((x) => x.tokenHash === h);
      return c ? { ...c } : null;
    },
    async consumeChallenge(id, now) {
      const c = challenges.find((x) => x.id === id);
      if (!c || c.consumedAt || c.expiresAt.getTime() <= now.getTime()) return false;
      c.consumedAt = now;
      return true;
    },
    async recordChallengeFailure(id, max, now) {
      const c = challenges.find((x) => x.id === id)!;
      c.attempts += 1;
      if (c.attempts >= max && !c.consumedAt) c.consumedAt = now;
      return { attempts: c.attempts, killed: c.attempts >= max };
    },
    async findTrustedDevice(userId, hash, now) {
      const d = devices.find((x) => x.tokenHash === hash && x.userId === userId && !x.revokedAt && x.expiresAt.getTime() > now.getTime());
      return d ? { ...d } : null;
    },
    async touchTrustedDevice(id, now) {
      touched.push(id);
      devices.find((d) => d.id === id)!.lastUsedAt = now;
    },
    async createTrustedDevice(i) {
      const id = `d${devices.length + 1}`;
      devices.push({ id, createdAt: new Date(clock.now), lastUsedAt: null, revokedAt: null, ...i });
      return { id };
    },
    async listTrustedDevices(userId, now) {
      return devices.filter((d) => d.userId === userId && !d.revokedAt && d.expiresAt.getTime() > now.getTime());
    },
    async revokeTrustedDevice(userId, id, now) {
      const d = devices.find((x) => x.id === id && x.userId === userId && !x.revokedAt);
      if (!d) return false;
      d.revokedAt = now;
      return true;
    },
    async revokeAllTrustedDevices(userId, now) {
      let n = 0;
      for (const d of devices) {
        if (d.userId !== userId || d.revokedAt) continue;
        d.revokedAt = now;
        n++;
      }
      return n;
    },
  };

  const baseDeps: TwoFactorDeps = {
    store: base,
    async record(e) {
      events.push(e);
    },
    async rotateSessions() {},
    passwordLimiter: { isBlocked: () => false, recordFailure: () => {} },
    async verifyPassword() {
      return true;
    },
    async renderQr() {
      return "";
    },
    now: () => clock.now,
  };

  const deps: TwoFactorLoginDeps = {
    base: baseDeps,
    store,
    ipLimiter: createFixedWindowLimiter({ limit: limits.ip ?? 1000, windowMs: 15 * MIN }),
    challengeLimiter: createFixedWindowLimiter({ limit: limits.challenge ?? 1000, windowMs: 5 * MIN }),
    newToken: newOpaqueToken,
  };
  return { deps, clock, events, secret, rec, codes, challenges, devices, touched, deleted };
}

let f: Fake;
beforeEach(() => {
  f = makeFake();
});

const types = () => f.events.map((e) => e.type);
const codeAt = (offsetSteps = 0) => totpAt(f.secret, f.clock.now + offsetSteps * 30_000);

async function startChallenge(client: "web" | "mobile" | "desktop" | "cli" = "web"): Promise<string> {
  const d = await decideSignIn(f.deps, { userId: USER, twoFactorEnabled: true, trustedDeviceToken: null, client, event: EVENT });
  if (d.kind !== "challenge") throw new Error("expected a challenge");
  return d.challengeToken;
}

async function errOf(p: Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await p;
  } catch (e) {
    return e as { code: string; message: string };
  }
  throw new Error("expected a rejection");
}

const verify = (token: string, code: string, ipKey = "ip") =>
  verifySignInChallenge(f.deps, { challengeToken: token, code, ipKey, event: EVENT });

function addDevice(over: Partial<Fake["devices"][number]> & { token: string }): void {
  const { token, ...rest } = over;
  f.devices.push({
    id: `d${f.devices.length + 1}`,
    userId: USER,
    tokenHash: hashOpaqueToken(token),
    label: "Chrome 126 on macOS",
    ip: null,
    userAgent: null,
    createdAt: new Date(T0 - DAY),
    lastUsedAt: null,
    expiresAt: new Date(T0 + 10 * DAY),
    revokedAt: null,
    ...rest,
  });
}

describe("decideSignIn: challenge creation", () => {
  it("a user without 2FA goes straight to a session and creates nothing", async () => {
    const d = await decideSignIn(f.deps, { userId: USER, twoFactorEnabled: false, trustedDeviceToken: null, client: "web", event: EVENT });
    expect(d).toEqual({ kind: "session", method: "none" });
    expect(f.challenges).toHaveLength(0);
    expect(f.events).toHaveLength(0);
  });

  it("creates a 5-minute challenge, stores only the hash, and records client, ip and user agent", async () => {
    const token = await startChallenge("mobile");
    expect(f.challenges).toHaveLength(1);
    const c = f.challenges[0];
    expect(c.tokenHash).toBe(hashOpaqueToken(token));
    expect(JSON.stringify(c)).not.toContain(token);
    expect(c.expiresAt.getTime()).toBe(T0 + CHALLENGE_TTL_MS);
    expect(c.userId).toBe(USER);
    expect(c.clientKind).toBe("mobile");
    expect(c.ip).toBe(EVENT.ip);
    expect(c.userAgent).toBe(EVENT.userAgent);
    expect(token.length).toBeGreaterThanOrEqual(43);
  });

  it("offers TOTP and backup codes", async () => {
    const d = await decideSignIn(f.deps, { userId: USER, twoFactorEnabled: true, trustedDeviceToken: null, client: "web", event: EVENT });
    expect(d.kind === "challenge" && d.methods).toEqual(["totp", "backup_code"]);
  });

  it("sweeps expired challenges opportunistically", async () => {
    await startChallenge();
    f.clock.now += CHALLENGE_TTL_MS + MIN;
    await startChallenge();
    await Promise.resolve();
    expect(f.deleted.expiredCalls).toBe(2);
    expect(f.challenges).toHaveLength(1);
  });
});

describe("decideSignIn: trusted devices", () => {
  const TOKEN = "trusted-token-1";
  const run = (token: string | null) =>
    decideSignIn(f.deps, { userId: USER, twoFactorEnabled: true, trustedDeviceToken: token, client: "web", event: EVENT });

  it("a valid device skips the challenge, updates last_used_at and records 2fa.verified (trusted_device)", async () => {
    addDevice({ token: TOKEN });
    expect(await run(TOKEN)).toEqual({ kind: "session", method: "trusted_device" });
    expect(f.challenges).toHaveLength(0);
    expect(f.touched).toEqual(["d1"]);
    expect(f.devices[0].lastUsedAt?.getTime()).toBe(T0);
    expect(f.events).toHaveLength(1);
    expect(f.events[0]).toMatchObject({ type: "2fa.verified", userId: USER, metadata: { method: "trusted_device" } });
  });

  it("an expired device shows the challenge", async () => {
    addDevice({ token: TOKEN, expiresAt: new Date(T0 - 1) });
    expect((await run(TOKEN)).kind).toBe("challenge");
    expect(f.touched).toEqual([]);
  });

  it("a revoked device shows the challenge", async () => {
    addDevice({ token: TOKEN, revokedAt: new Date(T0 - MIN) });
    expect((await run(TOKEN)).kind).toBe("challenge");
  });

  it("another user's device token shows the challenge", async () => {
    addDevice({ token: TOKEN, userId: OTHER });
    expect((await run(TOKEN)).kind).toBe("challenge");
    expect(f.touched).toEqual([]);
  });

  it("an unknown token or none shows the challenge", async () => {
    addDevice({ token: TOKEN });
    expect((await run("something-else")).kind).toBe("challenge");
    expect((await run(null)).kind).toBe("challenge");
  });

  it("a device does not matter for a user without 2FA", async () => {
    addDevice({ token: TOKEN });
    const d = await decideSignIn(f.deps, { userId: USER, twoFactorEnabled: false, trustedDeviceToken: TOKEN, client: "web", event: EVENT });
    expect(d).toEqual({ kind: "session", method: "none" });
    expect(f.touched).toEqual([]);
  });
});

describe("verifySignInChallenge", () => {
  it("success consumes the challenge and returns the user and method", async () => {
    const token = await startChallenge();
    const r = await verify(token, codeAt());
    expect(r).toEqual({ userId: USER, method: "totp" });
    expect(f.challenges[0].consumedAt).not.toBeNull();
    expect(types()).toEqual(["2fa.verified"]);
    expect(f.events[0].metadata).toMatchObject({ method: "totp", purpose: "login" });
  });

  it("the same challenge cannot be used twice (replay fails with the generic message)", async () => {
    const token = await startChallenge();
    await verify(token, codeAt());
    const e = await errOf(verify(token, codeAt(1)));
    expect(e.code).toBe("BAD_REQUEST");
    expect(e.message).toBe(CHALLENGE_EXPIRED_MESSAGE);
    expect(e.message).toBe("This sign-in has expired. Enter your password again.");
  });

  it("the same TOTP code cannot be replayed on a second challenge", async () => {
    const t1 = await startChallenge();
    await verify(t1, codeAt());
    const t2 = await startChallenge();
    const e = await errOf(verify(t2, codeAt()));
    expect(e.code).toBe("BAD_REQUEST");
  });

  it("an unknown token is the generic expired error", async () => {
    const e = await errOf(verify("nope", "123456"));
    expect(e).toMatchObject({ code: "BAD_REQUEST", message: CHALLENGE_EXPIRED_MESSAGE });
  });

  it("an expired challenge is the generic expired error and counts nothing", async () => {
    const token = await startChallenge();
    f.clock.now += CHALLENGE_TTL_MS + 1;
    const e = await errOf(verify(token, codeAt()));
    expect(e).toMatchObject({ code: "BAD_REQUEST", message: CHALLENGE_EXPIRED_MESSAGE });
    expect(f.rec.failedCount).toBe(0);
  });

  it("a wrong code is BAD_REQUEST (never UNAUTHORIZED), bumps attempts and the user's failure count", async () => {
    const token = await startChallenge();
    const e = await errOf(verify(token, "000000"));
    expect(e.code).toBe("BAD_REQUEST");
    expect(f.challenges[0].attempts).toBe(1);
    expect(f.challenges[0].consumedAt).toBeNull();
    expect(f.rec.failedCount).toBe(1);
    expect(types()).toEqual(["2fa.failed"]);
    // The right code still works afterwards.
    expect((await verify(token, codeAt())).userId).toBe(USER);
  });

  it(`the ${MAX_CHALLENGE_ATTEMPTS}th wrong code kills the challenge: even the right code then fails`, async () => {
    const token = await startChallenge();
    for (let i = 0; i < MAX_CHALLENGE_ATTEMPTS - 1; i++) expect((await errOf(verify(token, "000000"))).code).toBe("BAD_REQUEST");
    // The user-level lockout trips on the same fifth failure, so this one is
    // a lockout; either way the challenge is dead.
    await errOf(verify(token, "000000"));
    expect(f.challenges[0].attempts).toBe(MAX_CHALLENGE_ATTEMPTS);
    expect(f.challenges[0].consumedAt).not.toBeNull();
    const e = await errOf(verify(token, codeAt()));
    expect(e.message).toBe(CHALLENGE_EXPIRED_MESSAGE);
  });

  it("a challenge killed before the user lockout says to enter the password again", async () => {
    // Failures on earlier challenges leave the user one short of a lockout... so
    // pre-load the challenge with 4 attempts but the user with none.
    const token = await startChallenge();
    f.challenges[0].attempts = MAX_CHALLENGE_ATTEMPTS - 1;
    const e = await errOf(verify(token, "000000"));
    expect(e.code).toBe("BAD_REQUEST");
    expect(e.message).toMatch(/Enter your password again/);
    expect(f.challenges[0].consumedAt).not.toBeNull();
  });

  it("lockout: the fifth wrong code is TOO_MANY_REQUESTS with the unlock time; a correct code is refused while locked", async () => {
    for (let i = 0; i < 4; i++) {
      const t = await startChallenge();
      expect((await errOf(verify(t, "000000"))).code).toBe("BAD_REQUEST");
    }
    const t5 = await startChallenge();
    const locked = await errOf(verify(t5, "000000"));
    expect(locked.code).toBe("TOO_MANY_REQUESTS");
    expect(locked.message).toMatch(/15 minutes/);
    expect(locked.message).toContain(new Date(T0 + lockoutDuration(0)).toISOString());
    expect(types()).toContain("2fa.locked");

    const t6 = await startChallenge();
    const still = await errOf(verify(t6, codeAt()));
    expect(still.code).toBe("TOO_MANY_REQUESTS");
    expect(f.rec.failedCount).toBe(0);
  });

  it("lockout escalates to an hour on the second lockout and clears after a success", async () => {
    const lockOnce = async () => {
      for (let i = 0; i < 5; i++) {
        const t = await startChallenge();
        await errOf(verify(t, "000000"));
      }
    };
    await lockOnce();
    expect(f.rec.lockoutCount).toBe(1);
    f.clock.now += lockoutDuration(0) + MIN; // first lockout over
    await lockOnce();
    expect(f.rec.lockoutCount).toBe(2);
    expect(f.rec.lockedUntil!.getTime()).toBe(f.clock.now + lockoutDuration(1));
    f.clock.now += lockoutDuration(1) + MIN;
    const t = await startChallenge();
    await verify(t, codeAt());
    expect(f.rec).toMatchObject({ failedCount: 0, lockoutCount: 0, lockedUntil: null });
  });

  it("a backup code works once", async () => {
    f.codes.push({ hash: hashBackupCode(USER, "ABCDEF-234567"), used: false });
    const t1 = await startChallenge();
    expect(await verify(t1, "abcdef 234567")).toEqual({ userId: USER, method: "backup_code" });
    expect(types()).toEqual(["2fa.backup_used"]);
    const t2 = await startChallenge();
    expect((await errOf(verify(t2, "ABCDEF-234567"))).code).toBe("BAD_REQUEST");
  });

  it("the per-IP limiter is the first line of defence (before any lookup)", async () => {
    f = makeFake({ ip: 3 });
    const token = await startChallenge();
    for (let i = 0; i < 3; i++) await errOf(verify(token, "000000", "ip-a"));
    const e = await errOf(verify(token, codeAt(), "ip-a"));
    expect(e.code).toBe("TOO_MANY_REQUESTS");
    // A different IP is unaffected.
    expect((await errOf(verify("nope", "1", "ip-b"))).code).toBe("BAD_REQUEST");
  });

  it("the per-challenge limiter blocks a single challenge hammered from many IPs", async () => {
    f = makeFake({ challenge: 2 });
    const token = await startChallenge();
    await errOf(verify(token, "000000", "ip-1"));
    await errOf(verify(token, "000000", "ip-2"));
    expect((await errOf(verify(token, codeAt(), "ip-3"))).code).toBe("TOO_MANY_REQUESTS");
  });
});

describe("trusted device issue, list, revoke", () => {
  it("issues a device with a fixed 30-day expiry, a hashed token and a parsed label", async () => {
    const d = await issueTrustedDevice(f.deps, { userId: USER, client: "web", event: EVENT });
    expect(TRUSTED_DEVICE_DAYS).toBe(30);
    expect(d.expiresAt.getTime()).toBe(T0 + 30 * DAY);
    expect(f.devices).toHaveLength(1);
    const row = f.devices[0];
    expect(row.tokenHash).toBe(hashOpaqueToken(d.token));
    expect(JSON.stringify(row)).not.toContain(d.token);
    expect(row.label).toBe("Chrome 126 on macOS");
    expect(row.ip).toBe(EVENT.ip);
    expect(row.userAgent).toBe(EVENT.userAgent);
    expect(f.events.at(-1)).toMatchObject({ type: "2fa.device_trusted", userId: USER });
  });

  it("the expiry is fixed, not sliding: using the device never extends it", async () => {
    const d = await issueTrustedDevice(f.deps, { userId: USER, client: "web", event: EVENT });
    f.clock.now += 20 * DAY;
    await decideSignIn(f.deps, { userId: USER, twoFactorEnabled: true, trustedDeviceToken: d.token, client: "web", event: EVENT });
    expect(f.devices[0].expiresAt.getTime()).toBe(T0 + 30 * DAY);
    f.clock.now += 11 * DAY; // day 31
    const after = await decideSignIn(f.deps, { userId: USER, twoFactorEnabled: true, trustedDeviceToken: d.token, client: "web", event: EVENT });
    expect(after.kind).toBe("challenge");
  });

  it("labels desktop and mobile apps without a browser user agent", () => {
    expect(deviceLabel(null, "desktop")).toBe("Fintranzact desktop app");
    expect(deviceLabel(undefined, "mobile")).toBe("Fintranzact mobile app");
    expect(deviceLabel(null, "web")).toBe("Unknown device");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0) Firefox/128.0", "web")).toBe("Firefox 128 on Windows");
  });

  it("list marks only the device whose token matches as current", async () => {
    const a = await issueTrustedDevice(f.deps, { userId: USER, client: "web", event: EVENT });
    const b = await issueTrustedDevice(f.deps, { userId: USER, client: "web", event: EVENT });
    await issueTrustedDevice(f.deps, { userId: OTHER, client: "web", event: EVENT });
    const list = await listTrustedDevices(f.deps, USER, b.token);
    expect(list).toHaveLength(2);
    expect(list.find((d) => d.id === b.id)!.current).toBe(true);
    expect(list.find((d) => d.id === a.id)!.current).toBe(false);
    expect(Object.keys(list[0]).sort()).toEqual(["createdAt", "current", "expiresAt", "id", "ip", "label", "lastUsedAt"]);
    expect((await listTrustedDevices(f.deps, USER, null)).every((d) => !d.current)).toBe(true);
  });

  it("revoke works on your own device only, and records 2fa.device_revoked", async () => {
    const mine = await issueTrustedDevice(f.deps, { userId: USER, client: "web", event: EVENT });
    const theirs = await issueTrustedDevice(f.deps, { userId: OTHER, client: "web", event: EVENT });
    expect((await errOf(revokeTrustedDevice(f.deps, USER, theirs.id))).code).toBe("NOT_FOUND");
    expect(f.devices.find((d) => d.id === theirs.id)!.revokedAt).toBeNull();
    await revokeTrustedDevice(f.deps, USER, mine.id, EVENT);
    expect(f.devices.find((d) => d.id === mine.id)!.revokedAt).not.toBeNull();
    expect(f.events.at(-1)).toMatchObject({ type: "2fa.device_revoked", metadata: { deviceId: mine.id } });
    // A revoked token no longer skips the challenge.
    const d = await decideSignIn(f.deps, { userId: USER, twoFactorEnabled: true, trustedDeviceToken: mine.token, client: "web", event: EVENT });
    expect(d.kind).toBe("challenge");
  });

  it("revoke all revokes only this user's devices", async () => {
    await issueTrustedDevice(f.deps, { userId: USER, client: "web", event: EVENT });
    await issueTrustedDevice(f.deps, { userId: USER, client: "desktop", event: EVENT });
    await issueTrustedDevice(f.deps, { userId: OTHER, client: "web", event: EVENT });
    const r = await revokeAllTrustedDevices(f.deps, USER, EVENT, "logout_all");
    expect(r.revoked).toBe(2);
    expect(f.devices.filter((d) => d.userId === USER).every((d) => d.revokedAt)).toBe(true);
    expect(f.devices.filter((d) => d.userId === OTHER).every((d) => !d.revokedAt)).toBe(true);
    expect(f.events.at(-1)).toMatchObject({ type: "2fa.device_revoked", metadata: { all: true, count: 2, reason: "logout_all" } });
    // Nothing to revoke -> no event noise.
    const n = f.events.length;
    expect((await revokeAllTrustedDevices(f.deps, USER)).revoked).toBe(0);
    expect(f.events.length).toBe(n);
  });
});

describe("cookie and delivery rules (pure)", () => {
  it("builds the ftz_td cookie: HttpOnly, SameSite=Lax, Path=/, 30 days, Secure only on https", () => {
    const c = trustedDeviceSetCookie("tok", false);
    expect(c).toBe("ftz_td=tok; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000");
    expect(trustedDeviceSetCookie("tok", true)).toBe("ftz_td=tok; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=2592000");
    expect(trustedDeviceClearCookie(true)).toBe("ftz_td=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0");
    expect(TRUSTED_DEVICE_COOKIE).toBe("ftz_td");
  });

  it("appending keeps the session cookie that was written with .set", () => {
    const headers = new Headers();
    headers.set("Set-Cookie", "session_id=abc; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000");
    const plan = planTrustedDeviceDelivery("web", "tok", true);
    appendSetCookies(headers, plan.setCookies);
    const all = headers.getSetCookie();
    expect(all).toHaveLength(2);
    expect(all[0]).toMatch(/^session_id=abc;/);
    expect(all[1]).toMatch(/^ftz_td=tok;.*Secure/);
  });

  it("web gets a cookie and no body token; desktop and mobile get the body token and no cookie; cli gets nothing", () => {
    expect(planTrustedDeviceDelivery("web", "t", false)).toEqual({ setCookies: [trustedDeviceSetCookie("t", false)] });
    expect(planTrustedDeviceDelivery("desktop", "t", true)).toEqual({ setCookies: [], bodyToken: "t" });
    expect(planTrustedDeviceDelivery("mobile", "t", true)).toEqual({ setCookies: [], bodyToken: "t" });
    expect(planTrustedDeviceDelivery("cli", "t", true)).toEqual({ setCookies: [] });
  });

  it("the CLI never remembers; everyone else may", () => {
    expect(canRememberDevice("cli")).toBe(false);
    for (const c of ["web", "mobile", "desktop"] as const) expect(canRememberDevice(c)).toBe(true);
  });

  it("the client header wins over the input; unknown values fall back to web", () => {
    expect(resolveClientKind("desktop", "mobile")).toBe("desktop");
    expect(resolveClientKind(null, "mobile")).toBe("mobile");
    expect(resolveClientKind(null, "cli")).toBe("cli");
    expect(resolveClientKind(null, undefined)).toBe("web");
    expect(resolveClientKind("weird", undefined)).toBe("web");
  });

  it("reads the cookie token on web, the input token on mobile/desktop, nothing for the CLI", () => {
    const cookie = "session_id=s; ftz_td=abc123; theme=dark";
    expect(readTrustedDeviceCookie(cookie)).toBe("abc123");
    expect(readTrustedDeviceCookie("session_id=s")).toBeNull();
    expect(readTrustedDeviceCookie("xftz_td=bad")).toBeNull();
    expect(presentedTrustedDeviceToken("web", cookie, "from-input")).toBe("abc123");
    expect(presentedTrustedDeviceToken("web", null, "from-input")).toBeNull();
    expect(presentedTrustedDeviceToken("mobile", cookie, "from-input")).toBe("from-input");
    expect(presentedTrustedDeviceToken("desktop", null, undefined)).toBeNull();
    expect(presentedTrustedDeviceToken("cli", cookie, "from-input")).toBeNull();
  });
});

describe("sensitive actions never accept a trusted device", () => {
  it("lib/two-factor.ts (disable, regenerate, enrolment) has no trusted-device lookup at all", () => {
    const src = readFileSync(new URL("../lib/two-factor.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/findTrustedDevice|trusted_device|presentedTrustedDeviceToken|ftz_td/);
  });

  it("the router passes no device token to disable or regenerate", () => {
    const src = readFileSync(new URL("../routers/auth.ts", import.meta.url), "utf8");
    for (const proc of ["twoFactorDisable", "regenerateBackupCodes"]) {
      const start = src.indexOf(`${proc}: protectedProcedure`);
      expect(start).toBeGreaterThan(0);
      const body = src.slice(start, src.indexOf("}),", start));
      expect(body).not.toMatch(/trusted|ftz_td/i);
    }
  });
});
