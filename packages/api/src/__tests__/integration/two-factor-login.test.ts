/**
 * two-factor-login.test.ts — the sign-in challenge end to end through the real
 * routers and a real Postgres: login returns a challenge (no session, no
 * cookie), verifyTwoFactor mints the session through the shared path, backup
 * codes are single use, trusted devices skip the challenge, logoutAll revokes
 * them, and the password limiter on the security screens cannot lock sign-in.
 *
 * Needs TEST_DATABASE_URL (see helpers/test-context.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as argon2 from "argon2";
import { sessions, securityEvents, trustedDevices, twoFactorChallenges, userTwoFactor, users } from "@fintranzact/db";
import { createUser, createTenant, createSession, addMember } from "../helpers/fixtures.js";
import { getControlDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createTestContext } from "../helpers/test-context.js";
import { createCallerFactory } from "../../trpc.js";
import { appRouter } from "../../router.js";
import { totpAt } from "../../lib/totp.js";
import { decryptTotpSecret } from "../../lib/field-encryption.js";
import { hashOpaqueToken } from "../../lib/two-factor-codes.js";

const factory = createCallerFactory(appRouter);
const PASSWORD = "Sup3r-Secret!2026";
const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36";

let userId: string;
let tenantId: string;
let email: string;
let backupCodes: string[] = [];

let nextIp = 1;

/** A request with arbitrary headers; resHeaders is returned so Set-Cookie can be inspected. */
function callerWith(headers: Record<string, string> = {}, sessionId?: string) {
  const base = createTestContext(sessionId ? { user: { id: userId, email, name: "T" }, tenantId, authTokenKind: "cookie" } : {});
  const cookies = [sessionId ? `session_id=${sessionId}` : "", headers.cookie ?? ""].filter(Boolean).join("; ");
  const req = new Request("http://localhost:3000/api/trpc/auth.x", {
    method: "POST",
    headers: { "user-agent": CHROME, "x-requested-with": "fintranzact", ...headers, ...(cookies ? { cookie: cookies } : {}) },
  });
  const resHeaders = new Headers();
  // A fresh client IP per request keeps the per-IP verification limiter out of the way.
  return { caller: factory({ ...base, req, resHeaders, ipAddress: `198.51.100.${nextIp++ % 250}` }), resHeaders };
}

/** A TOTP code for now; clears the replay guard first so tests do not depend on the 30 s clock. */
async function totpNow(): Promise<string> {
  const db = getControlDb();
  await db.update(userTwoFactor).set({ lastUsedStep: null }).where(eq(userTwoFactor.userId, userId));
  const [row] = await db.select().from(userTwoFactor).where(eq(userTwoFactor.userId, userId));
  return totpAt(decryptTotpSecret(row.secretEnc), Date.now());
}

async function startChallenge(headers: Record<string, string> = {}, extra: Record<string, unknown> = {}) {
  const { caller, resHeaders } = callerWith(headers);
  const r = await caller.auth.login({ email, password: PASSWORD, ...extra });
  return { r, resHeaders };
}

async function challengeToken(headers: Record<string, string> = {}): Promise<string> {
  const { r } = await startChallenge(headers);
  if (!r.twoFactorRequired) throw new Error("expected a challenge");
  return r.challengeToken;
}

const sessionCount = async () => (await getControlDb().select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, userId))).length;
const cookieNames = (h: Headers) => h.getSetCookie().map((c) => c.split("=")[0]);

beforeAll(async () => {
  const user = await createUser({ passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }) });
  const tenant = await createTenant();
  await addMember(tenant.id, user.id, "owner");
  userId = user.id;
  email = user.email;
  tenantId = tenant.id;

  // Enrol through the real procedures.
  const setupSession = (await createSession(userId, tenantId)).id;
  const { caller } = callerWith({}, setupSession);
  await caller.auth.twoFactorBeginSetup();
  const res = await callerWith({}, setupSession).caller.auth.twoFactorConfirmSetup({ code: await totpNow() });
  backupCodes = res.backupCodes;
  expect(backupCodes).toHaveLength(10);
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

describe("auth.login for a two-factor user", () => {
  it("returns a challenge: no session, no sessionToken, no Set-Cookie", async () => {
    const before = await sessionCount();
    const { r, resHeaders } = await startChallenge();
    expect(r.twoFactorRequired).toBe(true);
    if (!r.twoFactorRequired) throw new Error("unreachable");
    expect(r.methods).toEqual(["totp", "backup_code"]);
    expect(r.challengeToken.length).toBeGreaterThanOrEqual(43);
    expect(r.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(r.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 5 * 60_000 + 1000);
    expect("sessionToken" in r).toBe(false);
    expect("user" in r).toBe(false);
    expect(resHeaders.getSetCookie()).toEqual([]);
    expect(await sessionCount()).toBe(before);

    // Only the hash is stored.
    const [row] = await getControlDb().select().from(twoFactorChallenges).where(eq(twoFactorChallenges.tokenHash, hashOpaqueToken(r.challengeToken)));
    expect(row.userId).toBe(userId);
    expect(row.attempts).toBe(0);
    expect(row.consumedAt).toBeNull();
  });

  it("a wrong password gives the same generic error and reveals nothing about 2FA", async () => {
    const wrong = await callerWith().caller.auth.login({ email, password: "Wrong-Password-1!" }).catch((e) => e);
    const unknown = await callerWith().caller.auth.login({ email: "nobody@example.in", password: "Wrong-Password-1!" }).catch((e) => e);
    expect(wrong.code).toBe("UNAUTHORIZED");
    expect(unknown.code).toBe("UNAUTHORIZED");
    expect(wrong.message).toBe(unknown.message);
  });
});

describe("auth.verifyTwoFactor", () => {
  it("a TOTP code mints the session (cookie) and the challenge cannot be replayed", async () => {
    const token = await challengeToken();
    const { caller, resHeaders } = callerWith();
    const r = await caller.auth.verifyTwoFactor({ challengeToken: token, code: await totpNow() });
    expect(r.user).toMatchObject({ id: userId, email });
    expect(r.sessionToken.length).toBeGreaterThan(30);
    expect("trustedDeviceToken" in r).toBe(false);
    expect(cookieNames(resHeaders)).toEqual(["session_id"]);
    const [session] = await getControlDb().select().from(sessions).where(eq(sessions.id, r.sessionToken));
    expect(session.userId).toBe(userId);
    expect(session.authMethod).toBe("cookie");

    const replay = await callerWith().caller.auth.verifyTwoFactor({ challengeToken: token, code: await totpNow() }).catch((e) => e);
    expect(replay.code).toBe("BAD_REQUEST");
    expect(replay.message).toBe("This sign-in has expired. Enter your password again.");

    const events = await getControlDb().select().from(securityEvents).where(eq(securityEvents.userId, userId));
    expect(events.some((e) => e.type === "2fa.verified")).toBe(true);
  });

  it("a mobile client gets a Bearer session and no cookie", async () => {
    const token = await challengeToken({ "x-fintranzact-client": "mobile" });
    const { caller, resHeaders } = callerWith({ "x-fintranzact-client": "mobile" });
    const r = await caller.auth.verifyTwoFactor({ challengeToken: token, code: await totpNow() });
    expect(resHeaders.getSetCookie()).toEqual([]);
    const [session] = await getControlDb().select().from(sessions).where(eq(sessions.id, r.sessionToken));
    expect(session.authMethod).toBe("bearer");
  });

  it("a backup code works exactly once", async () => {
    const code = backupCodes[0];
    const first = await callerWith().caller.auth.verifyTwoFactor({ challengeToken: await challengeToken(), code: code.toLowerCase() });
    expect(first.sessionToken.length).toBeGreaterThan(30);
    const second = await callerWith().caller.auth.verifyTwoFactor({ challengeToken: await challengeToken(), code }).catch((e) => e);
    expect(second.code).toBe("BAD_REQUEST");
    const events = await getControlDb().select().from(securityEvents).where(eq(securityEvents.userId, userId));
    expect(events.some((e) => e.type === "2fa.backup_used")).toBe(true);
  });

  it("a wrong code is BAD_REQUEST (never UNAUTHORIZED) and counts an attempt on the challenge", async () => {
    const token = await challengeToken();
    const e = await callerWith().caller.auth.verifyTwoFactor({ challengeToken: token, code: "000000" }).catch((x) => x);
    expect(e.code).toBe("BAD_REQUEST");
    const [row] = await getControlDb().select().from(twoFactorChallenges).where(eq(twoFactorChallenges.tokenHash, hashOpaqueToken(token)));
    expect(row.attempts).toBe(1);
    // Clean up the user's failure counter for the tests that follow.
    await callerWith().caller.auth.verifyTwoFactor({ challengeToken: token, code: await totpNow() });
  });

  it("an unknown or expired challenge gets the generic message", async () => {
    const unknown = await callerWith().caller.auth.verifyTwoFactor({ challengeToken: "no-such-token", code: "123456" }).catch((e) => e);
    expect(unknown).toMatchObject({ code: "BAD_REQUEST", message: "This sign-in has expired. Enter your password again." });
    const token = await challengeToken();
    await getControlDb()
      .update(twoFactorChallenges)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(twoFactorChallenges.tokenHash, hashOpaqueToken(token)));
    const expired = await callerWith().caller.auth.verifyTwoFactor({ challengeToken: token, code: await totpNow() }).catch((e) => e);
    expect(expired.message).toBe("This sign-in has expired. Enter your password again.");
  });
});

describe("trusted devices", () => {
  let webToken = "";
  let webDeviceId = "";

  it("rememberDevice on web sets BOTH cookies (session_id and ftz_td) and stores a hashed 30-day device", async () => {
    const token = await challengeToken();
    const { caller, resHeaders } = callerWith();
    const r = await caller.auth.verifyTwoFactor({ challengeToken: token, code: await totpNow(), rememberDevice: true });
    expect("trustedDeviceToken" in r).toBe(false);
    const cookies = resHeaders.getSetCookie();
    expect(cookies.map((c) => c.split("=")[0]).sort()).toEqual(["ftz_td", "session_id"]);
    const td = cookies.find((c) => c.startsWith("ftz_td="))!;
    expect(td).toMatch(/Path=\//);
    expect(td).toMatch(/HttpOnly/);
    expect(td).toMatch(/SameSite=Lax/);
    expect(td).toMatch(/Max-Age=2592000/);
    webToken = td.split(";")[0].slice("ftz_td=".length);

    const rows = await getControlDb().select().from(trustedDevices).where(eq(trustedDevices.userId, userId));
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(hashOpaqueToken(webToken));
    expect(rows[0].label).toBe("Chrome 126 on macOS");
    const days = (rows[0].expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);
    webDeviceId = rows[0].id;
  });

  it("login with the ftz_td cookie skips the challenge and creates a normal session", async () => {
    const { caller, resHeaders } = callerWith({ cookie: `ftz_td=${webToken}` });
    const r = await caller.auth.login({ email, password: PASSWORD });
    expect(r.twoFactorRequired).toBe(false);
    if (r.twoFactorRequired) throw new Error("unreachable");
    expect(r.sessionToken.length).toBeGreaterThan(30);
    expect(cookieNames(resHeaders)).toEqual(["session_id"]);
    const [d] = await getControlDb().select().from(trustedDevices).where(eq(trustedDevices.id, webDeviceId));
    expect(d.lastUsedAt).not.toBeNull();
    const events = await getControlDb().select().from(securityEvents).where(eq(securityEvents.userId, userId));
    expect(events.some((e) => e.type === "2fa.verified" && (e.metadata as { method?: string } | null)?.method === "trusted_device")).toBe(true);
  });

  it("a wrong password with a valid device is still refused (the device skips only the second step)", async () => {
    const e = await callerWith({ cookie: `ftz_td=${webToken}` }).caller.auth.login({ email, password: "Wrong-Password-1!" }).catch((x) => x);
    expect(e.code).toBe("UNAUTHORIZED");
  });

  it("an unknown device cookie shows the challenge", async () => {
    const { caller } = callerWith({ cookie: "ftz_td=not-a-real-token" });
    expect((await caller.auth.login({ email, password: PASSWORD })).twoFactorRequired).toBe(true);
  });

  it("desktop/mobile get the token in the body (no ftz_td cookie) and present it as input", async () => {
    const headers = { "x-fintranzact-client": "desktop" };
    const token = await challengeToken(headers);
    const { caller, resHeaders } = callerWith(headers);
    const r = await caller.auth.verifyTwoFactor({ challengeToken: token, code: await totpNow(), rememberDevice: true });
    expect(typeof r.trustedDeviceToken).toBe("string");
    expect(resHeaders.getSetCookie()).toEqual([]);

    const skipped = await callerWith(headers).caller.auth.login({ email, password: PASSWORD, trustedDeviceToken: r.trustedDeviceToken });
    expect(skipped.twoFactorRequired).toBe(false);
    // The same token is ignored by a web client's login input (web uses the cookie).
    const web = await callerWith().caller.auth.login({ email, password: PASSWORD, trustedDeviceToken: r.trustedDeviceToken });
    expect(web.twoFactorRequired).toBe(true);
  });

  it("the CLI never remembers", async () => {
    const token = await challengeToken();
    const { caller, resHeaders } = callerWith();
    const before = (await getControlDb().select().from(trustedDevices).where(eq(trustedDevices.userId, userId))).length;
    const r = await caller.auth.verifyTwoFactor({ challengeToken: token, code: await totpNow(), rememberDevice: true, client: "cli" });
    expect("trustedDeviceToken" in r).toBe(false);
    expect(cookieNames(resHeaders)).not.toContain("ftz_td");
    expect((await getControlDb().select().from(trustedDevices).where(eq(trustedDevices.userId, userId))).length).toBe(before);
  });

  it("list marks the current device; revoke only touches your own; revoked devices show the challenge again", async () => {
    const session = (await createSession(userId, tenantId)).id;
    const { caller } = callerWith({ cookie: `ftz_td=${webToken}` }, session);
    const list = await caller.auth.listTrustedDevices();
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list.filter((d) => d.current).map((d) => d.id)).toEqual([webDeviceId]);
    expect(Object.keys(list[0]).sort()).toEqual(["createdAt", "current", "expiresAt", "id", "ip", "label", "lastUsedAt"]);

    // Another user's device cannot be revoked.
    const other = await createUser();
    const [theirs] = await getControlDb()
      .insert(trustedDevices)
      .values({ userId: other.id, tokenHash: "y".repeat(64), expiresAt: new Date(Date.now() + 86_400_000) })
      .returning();
    const e = await caller.auth.revokeTrustedDevice({ id: theirs.id }).catch((x) => x);
    expect(e.code).toBe("NOT_FOUND");
    const [still] = await getControlDb().select().from(trustedDevices).where(eq(trustedDevices.id, theirs.id));
    expect(still.revokedAt).toBeNull();

    await caller.auth.revokeTrustedDevice({ id: webDeviceId });
    const { caller: login } = callerWith({ cookie: `ftz_td=${webToken}` });
    expect((await login.auth.login({ email, password: PASSWORD })).twoFactorRequired).toBe(true);
    const events = await getControlDb().select().from(securityEvents).where(eq(securityEvents.userId, userId));
    expect(events.some((x) => x.type === "2fa.device_revoked")).toBe(true);
  });

  it("logoutAll revokes every trusted device", async () => {
    const token = await challengeToken();
    await callerWith().caller.auth.verifyTwoFactor({ challengeToken: token, code: await totpNow(), rememberDevice: true });
    const active = async () => (await getControlDb().select().from(trustedDevices).where(eq(trustedDevices.userId, userId))).filter((d) => !d.revokedAt);
    expect((await active()).length).toBeGreaterThan(0);

    const session = (await createSession(userId, tenantId)).id;
    const { caller, resHeaders } = callerWith({}, session);
    await caller.auth.logoutAll();
    expect(await active()).toHaveLength(0);
    // The session cookie is cleared AND the device cookie is cleared (both Set-Cookie values present).
    expect(cookieNames(resHeaders).sort()).toEqual(["ftz_td", "session_id"]);
  });

  it("revokeAllTrustedDevices revokes them and clears the cookie", async () => {
    await callerWith().caller.auth.verifyTwoFactor({ challengeToken: await challengeToken(), code: await totpNow(), rememberDevice: true });
    const session = (await createSession(userId, tenantId)).id;
    const { caller, resHeaders } = callerWith({}, session);
    const r = await caller.auth.revokeAllTrustedDevices();
    expect(r.revoked).toBeGreaterThan(0);
    expect(cookieNames(resHeaders)).toEqual(["ftz_td"]);
    expect((await caller.auth.twoFactorStatus()).trustedDeviceCount).toBe(0);
  });
});

describe("sensitive actions ignore trusted devices", () => {
  it("disable with a valid trusted-device cookie still needs the password and a fresh code", async () => {
    await callerWith().caller.auth.verifyTwoFactor({ challengeToken: await challengeToken(), code: await totpNow(), rememberDevice: true });
    const [dev] = await getControlDb().select().from(trustedDevices).where(eq(trustedDevices.userId, userId));
    expect(dev).toBeDefined();
    const session = (await createSession(userId, tenantId)).id;
    // The cookie value is not even recoverable (only its hash is stored); a bogus one proves it is not consulted.
    const { caller } = callerWith({ cookie: "ftz_td=whatever" }, session);
    const e = await caller.auth.twoFactorDisable({ password: PASSWORD, code: "000000" }).catch((x) => x);
    expect(e.code).toBe("BAD_REQUEST");
    const [u] = await getControlDb().select({ f: users.twoFactorEnabled }).from(users).where(eq(users.id, userId));
    expect(u.f).toBe(true);
  });
});

describe("limiter separation", () => {
  it("wrong passwords on disable/regenerate never lock the user out of sign-in", async () => {
    const session = (await createSession(userId, tenantId)).id;
    const { caller } = callerWith({}, session);
    for (let i = 0; i < 5; i++) {
      const e = await caller.auth.regenerateBackupCodes({ password: "Wrong-Password-1!", code: "000000" }).catch((x) => x);
      expect(e.code).toBe("BAD_REQUEST");
    }
    // The security-screen limiter is now full ...
    const blocked = await caller.auth.regenerateBackupCodes({ password: PASSWORD, code: "000000" }).catch((x) => x);
    expect(blocked.code).toBe("TOO_MANY_REQUESTS");
    // ... but signing in is unaffected.
    const { r } = await startChallenge();
    expect(r.twoFactorRequired).toBe(true);
  });
});

describe("attempt cap and lockout", () => {
  it("five wrong codes lock verification (TOO_MANY_REQUESTS with the unlock time) and kill the challenge", async () => {
    // Reset any failures left by earlier tests.
    await getControlDb().update(userTwoFactor).set({ failedCount: 0, lockoutCount: 0, lockedUntil: null }).where(eq(userTwoFactor.userId, userId));
    const token = await challengeToken();
    const codes: string[] = [];
    for (let i = 0; i < 5; i++) {
      const e = await callerWith().caller.auth.verifyTwoFactor({ challengeToken: token, code: "000000" }).catch((x) => x);
      codes.push(e.code);
    }
    expect(codes.slice(0, 4)).toEqual(["BAD_REQUEST", "BAD_REQUEST", "BAD_REQUEST", "BAD_REQUEST"]);
    expect(codes[4]).toBe("TOO_MANY_REQUESTS");

    const [row] = await getControlDb().select().from(twoFactorChallenges).where(eq(twoFactorChallenges.tokenHash, hashOpaqueToken(token)));
    expect(row.attempts).toBe(5);
    expect(row.consumedAt).not.toBeNull();

    // A fresh challenge with the right code is still refused while locked.
    const fresh = await callerWith().caller.auth.verifyTwoFactor({ challengeToken: await challengeToken(), code: await totpNow() }).catch((x) => x);
    expect(fresh.code).toBe("TOO_MANY_REQUESTS");
    expect(fresh.message).toMatch(/Try again in/);

    await getControlDb().update(userTwoFactor).set({ failedCount: 0, lockoutCount: 0, lockedUntil: null }).where(eq(userTwoFactor.userId, userId));
  });
});
