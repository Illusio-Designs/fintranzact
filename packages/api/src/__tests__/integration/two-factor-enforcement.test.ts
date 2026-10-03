/**
 * two-factor-enforcement.test.ts — organisation policy and the request-time
 * gate, end to end through the real routers and a real Postgres.
 *
 * Needs Postgres (like every file in this folder). Contexts are built with
 * authTokenKind "cookie" (a session) or null (an API key): createTestContext
 * defaults to null, which the gate deliberately skips.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { securityEvents, tenants } from "@fintranzact/db";
import { createUser, createTenant, createSession, addMember } from "../helpers/fixtures.js";
import { getControlDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createTestContext } from "../helpers/test-context.js";
import { createCallerFactory } from "../../trpc.js";
import { appRouter } from "../../router.js";
import { totpAt } from "../../lib/totp.js";
import { decryptTotpSecret } from "../../lib/field-encryption.js";
import { userTwoFactor } from "@fintranzact/db";
import { clearTwoFactorGateCache } from "../../lib/two-factor-gate-cache.js";

const factory = createCallerFactory(appRouter);

type U = { id: string; email: string; sessionId: string };
let tenantId: string;
let owner: U;
let admin: U;
let seller: U;
let ownerSecondary: U;

async function mkUser(role: "owner" | "admin" | "seller"): Promise<U> {
  const u = await createUser();
  await addMember(tenantId, u.id, role);
  const s = await createSession(u.id, tenantId);
  return { id: u.id, email: u.email, sessionId: s.id };
}

function as(u: U, kind: "cookie" | null = "cookie") {
  const base = createTestContext({ user: { id: u.id, email: u.email, name: "T" }, tenantId, authTokenKind: kind });
  const req = new Request("http://localhost:3000/api/trpc/x", {
    method: "POST",
    headers: { cookie: `session_id=${u.sessionId}`, "user-agent": "vitest", "x-requested-with": "fintranzact" },
  });
  return factory({ ...base, req });
}

async function enableTwoFactor(u: U) {
  const c = as(u);
  await c.auth.twoFactorBeginSetup();
  const [row] = await getControlDb().select().from(userTwoFactor).where(eq(userTwoFactor.userId, u.id));
  await c.auth.twoFactorConfirmSetup({ code: totpAt(decryptTotpSecret(row!.secretEnc), Date.now()) });
}

const TWO_FACTOR_MESSAGE = "Your organisation requires two-factor authentication. Set it up in Settings → Account → Security to continue.";

beforeAll(async () => {
  const t = await createTenant();
  tenantId = t.id;
  owner = await mkUser("owner");
  ownerSecondary = await mkUser("owner");
  admin = await mkUser("admin");
  seller = await mkUser("seller");
  clearTwoFactorGateCache();
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

describe("who may set the policy", () => {
  it("an admin is refused", async () => {
    await expect(as(admin).tenant.setSecurityPolicy({ policy: "all" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("an owner without 2FA of their own cannot set a policy", async () => {
    const err = await as(owner).tenant.setSecurityPolicy({ policy: "all", graceDays: 0 }).catch((e) => e);
    expect(err.message).toBe("Turn on two-factor authentication for your own account first.");
    const [row] = await getControlDb().select().from(tenants).where(eq(tenants.id, tenantId));
    expect(row!.twoFactorPolicy).toBe("off");
  });

  it("an owner with 2FA sets it, with an audit event", async () => {
    await enableTwoFactor(owner);
    const r = await as(owner).tenant.setSecurityPolicy({ policy: "all", graceDays: 0 });
    expect(r).toMatchObject({ policy: "all", graceDays: 0 });
    expect(r.enforcedAt).toBeInstanceOf(Date);
    const events = await getControlDb().select().from(securityEvents).where(and(eq(securityEvents.tenantId, tenantId), eq(securityEvents.type, "2fa.policy_changed")));
    expect(events).toHaveLength(1);
    expect(events[0]!.actorUserId).toBe(owner.id);
  });
});

describe("a blocked member (policy all, grace 0, no 2FA)", () => {
  it("is refused on a write and on a read with the stable error", async () => {
    for (const run of [
      () => as(seller).tenant.updateMemberRole({ userId: admin.id, role: "seller" }),
      () => as(seller).tenant.members(),
    ]) {
      const err = await run().catch((e) => e);
      expect(err.code).toBe("FORBIDDEN");
      expect(err.message).toBe(TWO_FACTOR_MESSAGE);
      expect(err.cause?.twoFactor).toEqual({ required: true, reason: "two_factor_setup_required", setupPath: "/settings?tab=account&pane=security" });
    }
  });

  it("can still reach tenant.current (with the requirement), auth.me and the 2FA setup", async () => {
    const c = as(seller);
    const cur = await c.tenant.current();
    expect(cur).toMatchObject({ twoFactorPolicy: "all", twoFactorGraceDays: 0, twoFactorRequirement: { required: true, blocked: true, policy: "all" } });
    expect((await c.auth.me()).twoFactor.enabled).toBe(false);
    expect((await c.auth.twoFactorBeginSetup()).otpauthUri).toMatch(/^otpauth:/);
    expect((await c.tenant.list()).length).toBeGreaterThan(0);
  });

  it("passes after enabling 2FA", async () => {
    await enableTwoFactor(seller);
    expect(await as(seller).tenant.members()).toBeInstanceOf(Array);
    expect((await as(seller).tenant.current())?.twoFactorRequirement).toMatchObject({ required: false, blocked: false });
  });

  it("an API key (authTokenKind null) is unaffected", async () => {
    expect(await as(admin, null).tenant.members()).toBeInstanceOf(Array);
  });

  it("the unenrolled admin is blocked until they enrol", async () => {
    await expect(as(admin).tenant.members()).rejects.toMatchObject({ message: TWO_FACTOR_MESSAGE });
  });
});

describe("members list", () => {
  it("shows twoFactorEnabled to owners and admins only", async () => {
    await enableTwoFactor(admin);
    const forOwner = await as(owner).tenant.members();
    expect(forOwner.find((m) => m.userId === seller.id)?.twoFactorEnabled).toBe(true);
    expect(forOwner.find((m) => m.userId === ownerSecondary.id)?.twoFactorEnabled).toBe(false);
    const forAdmin = await as(admin).tenant.members();
    expect(forAdmin.every((m) => typeof m.twoFactorEnabled === "boolean")).toBe(true);
    const forSeller = await as(seller).tenant.members();
    expect(forSeller.every((m) => m.twoFactorEnabled === undefined)).toBe(true);
  });
});

describe("relaxing", () => {
  it("off lifts the block and clears enforcement", async () => {
    await as(owner).tenant.setSecurityPolicy({ policy: "off" });
    const cur = await as(ownerSecondary).tenant.current();
    expect(cur?.twoFactorRequirement).toMatchObject({ required: false, blocked: false });
    expect(await as(ownerSecondary).tenant.members()).toBeInstanceOf(Array);
    const [row] = await getControlDb().select().from(tenants).where(eq(tenants.id, tenantId));
    expect(row!.twoFactorEnforcedAt).toBeNull();
  });
});
