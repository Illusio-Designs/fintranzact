/**
 * two-factor-enrolment.test.ts — end to end through the real routers and a
 * real Postgres: enrol -> status -> sign-in-style verification -> disable, with
 * session rotation (the other session is revoked, the current one kept) and the
 * organisation-enforcement refusal.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import * as argon2 from "argon2";
import { sessions, securityEvents, tenants, trustedDevices, twoFactorBackupCodes, userTwoFactor, users } from "@fintranzact/db";
import { createUser, createTenant, createSession, addMember } from "../helpers/fixtures.js";
import { getControlDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createTestContext } from "../helpers/test-context.js";
import { createCallerFactory } from "../../trpc.js";
import { appRouter } from "../../router.js";
import { totpAt } from "../../lib/totp.js";
import { decryptTotpSecret } from "../../lib/field-encryption.js";

const factory = createCallerFactory(appRouter);
const PASSWORD = "Sup3r-Secret!2026";

let userId: string;
let tenantId: string;
let email: string;
let currentSession: string;
let otherSession: string;

function callerFor(sessionId: string) {
  const base = createTestContext({ user: { id: userId, email, name: "T" }, tenantId, authTokenKind: "cookie" });
  const req = new Request("http://localhost:3000/api/trpc/auth.x", {
    method: "POST",
    headers: { cookie: `session_id=${sessionId}`, "user-agent": "vitest", "x-requested-with": "fintranzact" },
  });
  return factory({ ...base, req });
}

/**
 * The replay guard rejects any TOTP step at or before the last one used, and only
 * the steps within one of now are accepted, so a test that makes several attempts
 * inside one 30-second window runs out of valid steps. Clear the guard to stand in
 * for time passing between attempts.
 */
async function resetReplayGuard(): Promise<void> {
  await getControlDb().update(userTwoFactor).set({ lastUsedStep: null }).where(eq(userTwoFactor.userId, userId));
}

async function currentCode(offsetSteps = 0): Promise<string> {
  const [row] = await getControlDb().select().from(userTwoFactor).where(eq(userTwoFactor.userId, userId));
  return totpAt(decryptTotpSecret(row.secretEnc), Date.now() + offsetSteps * 30_000);
}

beforeAll(async () => {
  const user = await createUser({ passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }) });
  const tenant = await createTenant();
  await addMember(tenant.id, user.id, "owner");
  userId = user.id;
  email = user.email;
  tenantId = tenant.id;
  currentSession = (await createSession(userId, tenantId)).id;
  otherSession = (await createSession(userId, tenantId)).id;
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

describe("two-factor enrolment, end to end", () => {
  it("starts off", async () => {
    const c = callerFor(currentSession);
    expect(await c.auth.twoFactorStatus()).toMatchObject({ enabled: false, pendingSetup: false, backupCodesRemaining: 0, lockedUntil: null, trustedDeviceCount: 0 });
    expect((await c.auth.me()).twoFactor).toEqual({ enabled: false });
  });

  it("begin setup stores an encrypted pending secret", async () => {
    const c = callerFor(currentSession);
    const r = await c.auth.twoFactorBeginSetup();
    expect(r.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    expect(r.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    const [row] = await getControlDb().select().from(userTwoFactor).where(eq(userTwoFactor.userId, userId));
    expect(row.confirmedAt).toBeNull();
    expect(row.secretEnc).not.toContain(r.manualKey.replace(/ /g, ""));
    expect(await c.auth.twoFactorStatus()).toMatchObject({ enabled: false, pendingSetup: true });
  });

  it("a wrong code is BAD_REQUEST and leaves 2FA off", async () => {
    await expect(callerFor(currentSession).auth.twoFactorConfirmSetup({ code: "000000" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await callerFor(currentSession).auth.me()).twoFactor.enabled).toBe(false);
  });

  it("confirming enables 2FA, returns 10 codes once, revokes the other session and keeps this one", async () => {
    const c = callerFor(currentSession);
    const { backupCodes } = await c.auth.twoFactorConfirmSetup({ code: await currentCode() });
    expect(backupCodes).toHaveLength(10);

    const db = getControlDb();
    const left = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, userId));
    expect(left.map((s) => s.id)).toEqual([currentSession]);
    expect(left.map((s) => s.id)).not.toContain(otherSession);

    const hashes = await db.select().from(twoFactorBackupCodes).where(eq(twoFactorBackupCodes.userId, userId));
    expect(hashes).toHaveLength(10);
    expect(hashes.some((h) => backupCodes.includes(h.codeHash))).toBe(false);

    expect(await c.auth.twoFactorStatus()).toMatchObject({ enabled: true, pendingSetup: false, backupCodesRemaining: 10 });
    expect((await c.auth.me()).twoFactor).toEqual({ enabled: true });
    const events = await db.select({ type: securityEvents.type }).from(securityEvents).where(eq(securityEvents.userId, userId));
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(["2fa.setup_started", "2fa.failed", "2fa.enabled"]));
  });

  it("begin setup is refused while enabled", async () => {
    await expect(callerFor(currentSession).auth.twoFactorBeginSetup()).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("regenerate needs a TOTP code (not a backup code) and replaces every code", async () => {
    const c = callerFor(currentSession);
    const db = getControlDb();
    const [oldRow] = await db.select().from(twoFactorBackupCodes).where(eq(twoFactorBackupCodes.userId, userId));
    await expect(c.auth.regenerateBackupCodes({ password: PASSWORD, code: "ABCDEF-GHJKMN" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(c.auth.regenerateBackupCodes({ password: "wrong-password", code: await currentCode(1) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const { backupCodes } = await c.auth.regenerateBackupCodes({ password: PASSWORD, code: await currentCode(1) });
    expect(backupCodes).toHaveLength(10);
    const after = await db.select().from(twoFactorBackupCodes).where(eq(twoFactorBackupCodes.userId, userId));
    expect(after).toHaveLength(10);
    expect(after.map((a) => a.id)).not.toContain(oldRow.id);
  });

  it("disable is refused while an organisation enforces 2FA", async () => {
    const db = getControlDb();
    await db.update(tenants).set({ twoFactorPolicy: "all", twoFactorEnforcedAt: new Date() }).where(eq(tenants.id, tenantId));
    await expect(
      callerFor(currentSession).auth.twoFactorDisable({ password: PASSWORD, code: await currentCode(2) }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringMatching(/^Your organisation requires two-factor authentication/) });
    await db.update(tenants).set({ twoFactorPolicy: "off" }).where(eq(tenants.id, tenantId));
  });

  it("disable clears everything, revokes trusted devices and keeps this session", async () => {
    const db = getControlDb();
    await db.insert(trustedDevices).values({
      userId,
      tokenHash: "x".repeat(64),
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    const extra = (await createSession(userId, tenantId)).id;
    await resetReplayGuard();
    await expect(callerFor(currentSession).auth.twoFactorDisable({ password: "wrong-password", code: await currentCode(0) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await resetReplayGuard();
    await callerFor(currentSession).auth.twoFactorDisable({ password: PASSWORD, code: await currentCode(0) });

    expect(await db.select().from(userTwoFactor).where(eq(userTwoFactor.userId, userId))).toHaveLength(0);
    expect(await db.select().from(twoFactorBackupCodes).where(eq(twoFactorBackupCodes.userId, userId))).toHaveLength(0);
    const [u] = await db.select({ f: users.twoFactorEnabled }).from(users).where(eq(users.id, userId));
    expect(u.f).toBe(false);
    const [dev] = await db.select().from(trustedDevices).where(eq(trustedDevices.userId, userId));
    expect(dev.revokedAt).not.toBeNull();
    const left = await db.select({ id: sessions.id }).from(sessions).where(inArray(sessions.id, [currentSession, extra]));
    expect(left.map((s) => s.id)).toEqual([currentSession]);
    expect((await callerFor(currentSession).auth.twoFactorStatus()).enabled).toBe(false);
  });
});
