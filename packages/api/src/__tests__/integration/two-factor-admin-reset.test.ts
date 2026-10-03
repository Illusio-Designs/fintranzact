/**
 * two-factor-admin-reset.test.ts — platform.resetTwoFactor and the audit views,
 * end to end through the real routers and a real Postgres (like every file in
 * this folder). Not run in the authoring sandbox: no Postgres there.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import * as argon2 from "argon2";
import { securityEvents, sessions, trustedDevices, twoFactorBackupCodes, userTwoFactor, users } from "@fintranzact/db";
import { createUser, createTenant, createSession, addMember } from "../helpers/fixtures.js";
import { getControlDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createTestContext } from "../helpers/test-context.js";
import { createCallerFactory } from "../../trpc.js";
import { appRouter } from "../../router.js";
import { totpAt } from "../../lib/totp.js";
import { decryptTotpSecret } from "../../lib/field-encryption.js";

const factory = createCallerFactory(appRouter);
const ADMIN_EMAIL = "ops.reset@fintranzact.com";
const PASSWORD = "Sup3r-Secret!2026";

type U = { id: string; email: string; sessionId: string };
let tenantId: string;
let admin: U;
let victim: U;
let stranger: U;
let savedEnv: NodeJS.ProcessEnv;

async function mk(overrides: { email?: string; passwordHash?: string } = {}): Promise<U> {
  const u = await createUser(overrides);
  await addMember(tenantId, u.id, "owner");
  const s = await createSession(u.id, tenantId);
  return { id: u.id, email: u.email, sessionId: s.id };
}

function as(u: U, ip = "203.0.113.7") {
  const base = createTestContext({ user: { id: u.id, email: u.email, name: "T" }, tenantId, authTokenKind: "cookie" });
  const req = new Request("http://localhost:3000/api/trpc/x", {
    method: "POST",
    headers: { cookie: `session_id=${u.sessionId}`, "user-agent": "vitest", "x-requested-with": "fintranzact" },
  });
  return factory({ ...base, req, ipAddress: ip, resHeaders: new Headers() });
}

async function enableTwoFactor(u: U) {
  const c = as(u);
  await c.auth.twoFactorBeginSetup();
  const [row] = await getControlDb().select().from(userTwoFactor).where(eq(userTwoFactor.userId, u.id));
  await c.auth.twoFactorConfirmSetup({ code: totpAt(decryptTotpSecret(row!.secretEnc), Date.now()) });
  // Confirming revokes the user's OTHER sessions; start from a fresh one.
  const s = await createSession(u.id, tenantId);
  u.sessionId = s.id;
}

const verification = {
  method: "video_call" as const,
  checks: ["name_matches_account", "email_ownership_confirmed"],
  reference: "TCK-1",
  reason: "User lost phone and backup codes; verified on video call.",
};

beforeAll(async () => {
  savedEnv = { ...process.env };
  process.env.PLATFORM_ADMIN_EMAIL = ADMIN_EMAIL;
  delete process.env.PLATFORM_ADMIN_EMAILS;
  tenantId = (await createTenant()).id;
  admin = await mk({ email: ADMIN_EMAIL });
  victim = await mk({ passwordHash: await argon2.hash(PASSWORD) });
  stranger = await mk();
  await enableTwoFactor(victim);
  await getControlDb().insert(trustedDevices).values({
    userId: victim.id,
    tokenHash: "hash-of-a-remembered-device",
    label: "Chrome 126 on macOS",
    expiresAt: new Date(Date.now() + 30 * 86_400_000),
  });
});

afterAll(async () => {
  process.env = savedEnv;
  await truncateAllTables();
  await closeTestDb();
});

describe("platform.resetTwoFactor", () => {
  it("refuses a non-admin", async () => {
    await expect(
      as(stranger).platform.resetTwoFactor({ userId: victim.id, confirmEmail: victim.email, verification }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const [u] = await getControlDb().select().from(users).where(eq(users.id, victim.id));
    expect(u!.twoFactorEnabled).toBe(true);
  });

  it("refuses an admin resetting themselves", async () => {
    await expect(
      as(admin).platform.resetTwoFactor({ userId: admin.id, confirmEmail: admin.email, verification }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("refuses a wrong typed email and leaves 2FA on", async () => {
    await expect(
      as(admin).platform.resetTwoFactor({ userId: victim.id, confirmEmail: "wrong@example.com", verification }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const [u] = await getControlDb().select().from(users).where(eq(users.id, victim.id));
    expect(u!.twoFactorEnabled).toBe(true);
  });

  it("resets: sessions dead, 2FA data gone, devices revoked, event recorded, password-only sign-in works", async () => {
    const db = getControlDb();
    const r = await as(admin).platform.resetTwoFactor({
      userId: victim.id,
      tenantId,
      confirmEmail: victim.email.toUpperCase(),
      verification,
    });
    expect(r.reset).toBe(true);

    expect(await db.select().from(sessions).where(eq(sessions.userId, victim.id))).toHaveLength(0);
    expect(await db.select().from(userTwoFactor).where(eq(userTwoFactor.userId, victim.id))).toHaveLength(0);
    expect(await db.select().from(twoFactorBackupCodes).where(eq(twoFactorBackupCodes.userId, victim.id))).toHaveLength(0);
    const live = await db.select().from(trustedDevices).where(eq(trustedDevices.userId, victim.id));
    expect(live.every((d) => d.revokedAt !== null)).toBe(true);
    const [u] = await db.select().from(users).where(eq(users.id, victim.id));
    expect(u!.twoFactorEnabled).toBe(false);

    const [ev] = await db
      .select()
      .from(securityEvents)
      .where(and(eq(securityEvents.userId, victim.id), eq(securityEvents.type, "2fa.reset_by_admin")));
    expect(ev).toBeTruthy();
    expect(ev!.actorUserId).toBe(admin.id);
    expect(ev!.tenantId).toBe(tenantId);
    expect(ev!.metadata).toMatchObject({ method: "video_call", reference: "TCK-1", checks: verification.checks });

    // Password alone now signs them in: no second step is asked for.
    const req = new Request("http://localhost:3000/api/trpc/auth.login", {
      method: "POST",
      headers: { "user-agent": "vitest", "x-requested-with": "fintranzact" },
    });
    const login = await factory({ ...createTestContext({}), req, resHeaders: new Headers(), ipAddress: "198.51.100.77" }).auth.login({
      email: victim.email,
      password: PASSWORD,
    });
    expect(login.twoFactorRequired).toBe(false);
  });

  it("a second reset is a no-op with reset:false and records nothing more", async () => {
    const before = await getControlDb().select().from(securityEvents).where(eq(securityEvents.type, "2fa.reset_by_admin"));
    const r = await as(admin).platform.resetTwoFactor({ userId: victim.id, confirmEmail: victim.email, verification });
    expect(r.reset).toBe(false);
    const after = await getControlDb().select().from(securityEvents).where(eq(securityEvents.type, "2fa.reset_by_admin"));
    expect(after).toHaveLength(before.length);
  });
});

describe("audit views", () => {
  it("auth.securityActivity returns only the caller's own events with safe fields", async () => {
    const mine = await as(admin).auth.securityActivity({ limit: 500 });
    expect(mine.every((e) => !("metadata" in e) && !("userAgent" in e))).toBe(true);
    const theirs = await as(stranger).auth.securityActivity();
    expect(theirs.find((e) => e.type === "2fa.reset_by_admin")).toBeUndefined();
  });

  it("platform.securityEvents shows the reset with actor and metadata to admins only", async () => {
    const r = await as(admin).platform.securityEvents({ tenantId, type: "2fa.reset_by_admin" });
    expect(r.items[0]).toMatchObject({ type: "2fa.reset_by_admin", actor: { id: admin.id }, user: { id: victim.id } });
    expect(r.items[0]!.metadata).toMatchObject({ method: "video_call" });
    await expect(as(stranger).platform.securityEvents({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
