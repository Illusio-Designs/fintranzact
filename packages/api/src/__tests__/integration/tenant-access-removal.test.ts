/**
 * tenant-access-removal.test.ts: "the client can remove access at any time".
 *
 * Integration (needs Postgres, TEST_DATABASE_URL). Covers tenant.removeMember
 * end to end for a CA: business grants, API keys, sessions, old invite links,
 * the access.removed security event, the notice, the guards, and the
 * every-request membership check (hasTenantAccess).
 */
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { createHash, randomUUID } from "crypto";
import { tenantMembers, invitations, businessMembers, apiKeys, sessions, securityEvents } from "@fintranzact/db";
import { createUser, createTenant, addMember, createSession, createBusiness } from "../helpers/fixtures.js";
import { getControlDb, getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createCallerFactory } from "../../trpc.js";
import { appRouter } from "../../router.js";
import { createContext } from "../../context.js";
import { clearTenantMembershipCache, ACCESS_REMOVED_MESSAGE } from "../../lib/tenant-membership.js";

const factory = createCallerFactory(appRouter);
type U = { id: string; email: string; name: string | null };

function caller(sessionId: string, user: U, tenantId: string | null, businessId: string | null = null) {
  return factory({
    user,
    tenantId,
    businessId,
    req: new Request("http://localhost:3000/api/trpc/test", {
      method: "POST",
      headers: new Headers({ "content-type": "application/json", cookie: `session_id=${sessionId}`, "x-requested-with": "fintranzact" }),
    }),
    resHeaders: new Headers(),
    ipAddress: null,
  });
}

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});
beforeEach(() => clearTenantMembershipCache());

async function makeOrg() {
  const tdb = getTenantTestDb();
  const owner = await createUser({ email: `owner.${randomUUID().slice(0, 8)}@biz.in`, name: "Rohit Sharma" });
  const admin = await createUser({ email: `admin.${randomUUID().slice(0, 8)}@biz.in`, name: "Asha Admin" });
  const tenant = await createTenant({ name: "Sharma Traders", plan: "business" });
  await addMember(tenant.id, owner.id, "owner");
  await addMember(tenant.id, admin.id, "admin");
  const shop = await createBusiness(tdb, owner.id, { name: "Shop One" });
  await tdb.insert(businessMembers).values([
    { businessId: shop.id, userId: owner.id, role: "admin" },
    { businessId: shop.id, userId: admin.id, role: "admin" },
  ]);
  const ownerSession = await createSession(owner.id, tenant.id);
  const adminSession = await createSession(admin.id, tenant.id);
  return {
    tenant, owner, admin, shop,
    asOwner: caller(ownerSession.id, owner, tenant.id),
    asAdmin: caller(adminSession.id, admin, tenant.id),
  };
}

async function addCa(org: Awaited<ReturnType<typeof makeOrg>>, role: "auditor" | "ca_filing" = "ca_filing") {
  const ca = await createUser({ email: `ca.${randomUUID().slice(0, 8)}@firm.in`, name: "Anita Shah" });
  await addMember(org.tenant.id, ca.id, role);
  await getTenantTestDb().insert(businessMembers).values({ businessId: org.shop.id, userId: ca.id, role: "member" });
  const session = await createSession(ca.id, org.tenant.id);
  const raw = `fintranzact_key_${randomUUID().replace(/-/g, "")}`;
  await getControlDb().insert(apiKeys).values({
    userId: ca.id, tenantId: org.tenant.id, keyHash: createHash("sha256").update(raw).digest("hex"), keyPrefix: raw.slice(0, 20), name: "CLI",
  });
  return { ca, session, rawKey: raw, asCa: caller(session.id, ca, org.tenant.id, org.shop.id) };
}

const keyContext = (raw: string, businessId: string) =>
  createContext({
    req: new Request("http://localhost/api/trpc/x", { headers: { authorization: `Bearer ${raw}`, "x-business-id": businessId } }),
    resHeaders: new Headers(),
    info: {} as never,
  } as never);

describe("tenant.removeMember revokes everything", () => {
  it("deletes the membership, business grants and tenant API keys; clears sessions; logs the event", async () => {
    const org = await makeOrg();
    const { ca, session } = await addCa(org);
    const other = await makeOrg();
    // The same person is also in another organisation: that must be untouched.
    await addMember(other.tenant.id, ca.id, "auditor");
    await getControlDb().insert(apiKeys).values({ userId: ca.id, tenantId: other.tenant.id, keyHash: "h-other", keyPrefix: "p", name: "other" });

    await expect(org.asOwner.tenant.removeMember({ userId: ca.id })).resolves.toEqual({ success: true });

    const cdb = getControlDb();
    expect(await cdb.select().from(tenantMembers).where(and(eq(tenantMembers.tenantId, org.tenant.id), eq(tenantMembers.userId, ca.id)))).toHaveLength(0);
    expect(await getTenantTestDb().select().from(businessMembers).where(and(eq(businessMembers.businessId, org.shop.id), eq(businessMembers.userId, ca.id)))).toHaveLength(0);
    expect(await cdb.select().from(apiKeys).where(and(eq(apiKeys.tenantId, org.tenant.id), eq(apiKeys.userId, ca.id)))).toHaveLength(0);
    const [s] = await cdb.select({ tenantId: sessions.tenantId }).from(sessions).where(eq(sessions.id, session.id));
    expect(s!.tenantId).toBeNull();

    // Other organisation untouched.
    expect(await cdb.select().from(tenantMembers).where(and(eq(tenantMembers.tenantId, other.tenant.id), eq(tenantMembers.userId, ca.id)))).toHaveLength(1);
    expect(await cdb.select().from(apiKeys).where(and(eq(apiKeys.tenantId, other.tenant.id), eq(apiKeys.userId, ca.id)))).toHaveLength(1);

    const [ev] = await cdb.select().from(securityEvents).where(and(eq(securityEvents.type, "access.removed"), eq(securityEvents.userId, ca.id)));
    expect(ev).toMatchObject({ actorUserId: org.owner.id, tenantId: org.tenant.id });
    expect(ev!.metadata).toMatchObject({ role: "ca_filing", email: ca.email, apiKeysRevoked: 1, businessesRevoked: 1, removedBy: org.owner.id });
  });

  it("the removed CA's API key no longer authenticates, and a stale key row is refused with FORBIDDEN", async () => {
    const org = await makeOrg();
    const { ca, rawKey } = await addCa(org);

    // Works while a member.
    const before = await keyContext(rawKey, org.shop.id);
    expect(before.user?.id).toBe(ca.id);
    await expect(factory(before).party.list({ page: 1, limit: 5 })).resolves.toBeDefined();

    await org.asOwner.tenant.removeMember({ userId: ca.id });
    expect((await keyContext(rawKey, org.shop.id)).user).toBeNull();

    // Legacy / other-instance state: the key row survives but the membership is gone.
    await getControlDb().insert(apiKeys).values({
      userId: ca.id, tenantId: org.tenant.id, keyHash: createHash("sha256").update(rawKey).digest("hex"), keyPrefix: rawKey.slice(0, 20), name: "stale",
    });
    clearTenantMembershipCache();
    const stale = await keyContext(rawKey, org.shop.id);
    expect(stale.user?.id).toBe(ca.id);
    await expect(factory(stale).party.list({ page: 1, limit: 5 })).rejects.toMatchObject({ code: "FORBIDDEN", message: ACCESS_REMOVED_MESSAGE });
  });

  it("a session still holding the old tenantId is refused (stale cache on another instance)", async () => {
    const org = await makeOrg();
    const { ca, asCa } = await addCa(org);
    await expect(asCa.party.list({ page: 1, limit: 5 })).resolves.toBeDefined();
    await org.asOwner.tenant.removeMember({ userId: ca.id });
    await expect(asCa.party.list({ page: 1, limit: 5 })).rejects.toMatchObject({ code: "FORBIDDEN", message: ACCESS_REMOVED_MESSAGE });
  });

  it("old invite link: accepted row deleted, link refused; pending row expired; a NEW invite works", async () => {
    const org = await makeOrg();
    const ca = await createUser({ email: `ca.${randomUUID().slice(0, 8)}@firm.in`, name: "Anita" });
    const caSession = await createSession(ca.id);
    const first = await org.asOwner.tenant.inviteMember({ email: ca.email, role: "ca_filing" });
    const asCa = caller(caSession.id, ca, null);
    await asCa.tenant.acceptInvitation({ token: first.token });
    // A second, still-pending invite for the same address.
    const second = await org.asOwner.tenant.inviteMember({ email: ca.email.toUpperCase(), role: "auditor" }).catch(() => null);

    await org.asOwner.tenant.removeMember({ userId: ca.id });

    const rows = await getControlDb().select().from(invitations).where(eq(invitations.tenantId, org.tenant.id));
    expect(rows.filter((r) => r.email.toLowerCase() === ca.email.toLowerCase() && r.acceptedAt)).toHaveLength(0);
    for (const r of rows.filter((r) => r.email.toLowerCase() === ca.email.toLowerCase())) expect(r.expiresAt.getTime()).toBeLessThanOrEqual(Date.now());

    await expect(asCa.tenant.acceptInvitation({ token: first.token })).rejects.toMatchObject({ code: "NOT_FOUND" });
    if (second) await expect(asCa.tenant.acceptInvitation({ token: second.token })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await getControlDb().select().from(tenantMembers).where(and(eq(tenantMembers.tenantId, org.tenant.id), eq(tenantMembers.userId, ca.id)))).toHaveLength(0);

    // A fresh invitation works and the CA gets the business grants back.
    const fresh = await org.asOwner.tenant.inviteMember({ email: ca.email, role: "auditor" });
    await expect(asCa.tenant.acceptInvitation({ token: fresh.token })).resolves.toMatchObject({ tenantId: org.tenant.id });
    expect(await getTenantTestDb().select().from(businessMembers).where(and(eq(businessMembers.businessId, org.shop.id), eq(businessMembers.userId, ca.id)))).toHaveLength(1);
  });

  it("an admin may remove a CA", async () => {
    const org = await makeOrg();
    const { ca } = await addCa(org, "auditor");
    await expect(org.asAdmin.tenant.removeMember({ userId: ca.id })).resolves.toEqual({ success: true });
  });

  it("nobody can remove the owner; a CA cannot remove anyone; you cannot remove yourself", async () => {
    const org = await makeOrg();
    const { ca, asCa } = await addCa(org);
    await expect(org.asAdmin.tenant.removeMember({ userId: org.owner.id })).rejects.toMatchObject({ code: "FORBIDDEN", message: "Cannot remove a superadmin" });
    await expect(asCa.tenant.removeMember({ userId: org.admin.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(org.asOwner.tenant.removeMember({ userId: org.owner.id })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Cannot remove yourself" });
    expect(await getControlDb().select().from(tenantMembers).where(and(eq(tenantMembers.tenantId, org.tenant.id), eq(tenantMembers.userId, ca.id)))).toHaveLength(1);
  });

  it("removing a non-member succeeds quietly and records nothing", async () => {
    const org = await makeOrg();
    const stranger = await createUser({ email: `s.${randomUUID().slice(0, 8)}@x.in` });
    await expect(org.asOwner.tenant.removeMember({ userId: stranger.id })).resolves.toEqual({ success: true });
    expect(await getControlDb().select().from(securityEvents).where(eq(securityEvents.userId, stranger.id))).toHaveLength(0);
  });
});
