/**
 * tenant-client-switcher.test.ts: the accountant's client switcher.
 *
 * Integration (needs Postgres, TEST_DATABASE_URL). Covers: a CA with three
 * organisations (own firm + two clients) sees roles and pinned-first ordering
 * from tenant.listClients; search narrows; scope filters; paging; tenant.select
 * records last opened (throttled); tenant.setPinned needs membership and has a
 * limit; tenant.leave removes membership + API keys + prefs and the client's
 * access log shows access.left; owners cannot leave.
 */
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { apiKeys, sessions, securityEvents, tenantMembers, userTenantPrefs, tenants } from "@fintranzact/db";
import { createUser, createTenant, addMember, createSession } from "../helpers/fixtures.js";
import { getControlDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createCallerFactory } from "../../trpc.js";
import { appRouter } from "../../router.js";
import { clearTenantMembershipCache } from "../../lib/tenant-membership.js";
import { resetOrgOpenedThrottle } from "../../lib/access-events.js";

const factory = createCallerFactory(appRouter);
type U = { id: string; email: string; name: string | null };

function caller(sessionId: string, user: U, tenantId: string | null) {
  return factory({
    user,
    tenantId,
    businessId: null,
    req: new Request("http://localhost:3000/api/trpc/test", {
      method: "POST",
      headers: new Headers({ "content-type": "application/json", cookie: `session_id=${sessionId}`, "x-requested-with": "fintranzact", "user-agent": "vitest" }),
    }),
    resHeaders: new Headers(),
    ipAddress: "10.0.0.1",
  });
}

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});
beforeEach(() => {
  clearTenantMembershipCache();
  resetOrgOpenedThrottle();
});

async function world() {
  const ca = await createUser({ email: `ca.${randomUUID().slice(0, 8)}@firm.in`, name: "Anita Shah" });
  const ownerA = await createUser({ email: `a.${randomUUID().slice(0, 8)}@a.in`, name: "Owner A" });
  const ownerB = await createUser({ email: `b.${randomUUID().slice(0, 8)}@b.in`, name: "Owner B" });
  const firm = await createTenant({ name: "Shah & Associates", plan: "business" });
  const clientA = await createTenant({ name: "Acme Traders", plan: "business" });
  const clientB = await createTenant({ name: "Bharat Foods", plan: "business" });
  await addMember(firm.id, ca.id, "owner");
  await addMember(clientA.id, ownerA.id, "owner");
  await addMember(clientA.id, ca.id, "auditor");
  await addMember(clientB.id, ownerB.id, "owner");
  await addMember(clientB.id, ca.id, "ca_filing");
  const session = await createSession(ca.id, firm.id);
  const ownerASession = await createSession(ownerA.id, clientA.id);
  return {
    ca, firm, clientA, clientB, ownerA, ownerB, session,
    asCa: caller(session.id, ca, firm.id),
    asOwnerA: caller(ownerASession.id, ownerA, clientA.id),
  };
}

describe("tenant.listClients", () => {
  it("shows every organisation with its role, own firm vs client, and orders pinned first", async () => {
    const w = await world();
    let list = await w.asCa.tenant.listClients();
    expect(list.total).toBe(3);
    expect(list.items.map((i) => i.name)).toEqual(["Acme Traders", "Bharat Foods", "Shah & Associates"]);
    const byName = Object.fromEntries(list.items.map((i) => [i.name, i]));
    expect(byName["Shah & Associates"]).toMatchObject({ role: "owner", isOwnFirm: true, isClient: false, roleLabel: "Owner" });
    expect(byName["Acme Traders"]).toMatchObject({ role: "auditor", isClient: true, isCa: true, roleLabel: "Accountant (read-only)" });
    expect(byName["Bharat Foods"]).toMatchObject({ roleLabel: "Accountant (filing)" });

    await w.asCa.tenant.setPinned({ tenantId: w.clientB.id, pinned: true });
    list = await w.asCa.tenant.listClients();
    expect(list.items[0]).toMatchObject({ name: "Bharat Foods", pinned: true });
    expect(list.counts).toEqual({ all: 3, mine: 1, clients: 2, pinned: 1 });
  });

  it("search narrows, scope filters, paging continues", async () => {
    const w = await world();
    expect((await w.asCa.tenant.listClients({ search: "ACME" })).items.map((i) => i.name)).toEqual(["Acme Traders"]);
    expect((await w.asCa.tenant.listClients({ search: "%" })).items).toHaveLength(0);
    expect((await w.asCa.tenant.listClients({ scope: "mine" })).items.map((i) => i.name)).toEqual(["Shah & Associates"]);
    expect((await w.asCa.tenant.listClients({ scope: "clients" })).items).toHaveLength(2);
    const p1 = await w.asCa.tenant.listClients({ limit: 2 });
    expect(p1.items).toHaveLength(2);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = await w.asCa.tenant.listClients({ limit: 2, cursor: p1.nextCursor! });
    expect(p2.items).toHaveLength(1);
    expect(p2.nextCursor).toBeNull();
  });

  it("lists only the caller's own organisations and hides suspended ones", async () => {
    const w = await world();
    expect((await w.asOwnerA.tenant.listClients()).items.map((i) => i.name)).toEqual(["Acme Traders"]);
    await getControlDb().update(tenants).set({ status: "suspended" }).where(eq(tenants.id, w.clientB.id));
    expect((await w.asCa.tenant.listClients()).total).toBe(2);
  });

  it("tenant.select records last opened (not rewritten within 5 minutes) and Recent ordering follows", async () => {
    const w = await world();
    await w.asCa.tenant.select({ tenantId: w.clientB.id });
    const [first] = await getControlDb().select().from(userTenantPrefs).where(and(eq(userTenantPrefs.userId, w.ca.id), eq(userTenantPrefs.tenantId, w.clientB.id)));
    expect(first!.lastOpenedAt).toBeInstanceOf(Date);
    await w.asCa.tenant.select({ tenantId: w.clientB.id });
    const [second] = await getControlDb().select().from(userTenantPrefs).where(and(eq(userTenantPrefs.userId, w.ca.id), eq(userTenantPrefs.tenantId, w.clientB.id)));
    expect(second!.lastOpenedAt!.getTime()).toBe(first!.lastOpenedAt!.getTime());
    expect((await w.asCa.tenant.listClients()).items[0]!.name).toBe("Bharat Foods");
  });
});

describe("tenant.setPinned", () => {
  it("requires membership", async () => {
    const w = await world();
    await expect(w.asOwnerA.tenant.setPinned({ tenantId: w.clientB.id, pinned: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("pins and unpins, and refuses a 21st pin", async () => {
    const w = await world();
    await w.asCa.tenant.setPinned({ tenantId: w.clientA.id, pinned: true });
    await w.asCa.tenant.setPinned({ tenantId: w.clientA.id, pinned: true });
    await w.asCa.tenant.setPinned({ tenantId: w.clientA.id, pinned: false });
    expect((await w.asCa.tenant.listClients()).counts.pinned).toBe(0);
    for (let i = 0; i < 20; i++) {
      const t = await createTenant({ name: `Client ${i}`, plan: "business" });
      await addMember(t.id, w.ca.id, "auditor");
      await w.asCa.tenant.setPinned({ tenantId: t.id, pinned: true });
    }
    await expect(w.asCa.tenant.setPinned({ tenantId: w.clientA.id, pinned: true })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("tenant.leave", () => {
  it("removes membership, API keys and prefs; clears the session; logs access.left for the owner", async () => {
    const w = await world();
    const cdb = getControlDb();
    await cdb.insert(apiKeys).values({ userId: w.ca.id, tenantId: w.clientA.id, keyHash: "h-leave", keyPrefix: "p", name: "k" });
    await w.asCa.tenant.setPinned({ tenantId: w.clientA.id, pinned: true });
    await cdb.update(sessions).set({ tenantId: w.clientA.id }).where(eq(sessions.id, w.session.id));

    await expect(w.asCa.tenant.leave({ tenantId: w.clientA.id })).resolves.toEqual({ success: true });

    expect(await cdb.select().from(tenantMembers).where(and(eq(tenantMembers.tenantId, w.clientA.id), eq(tenantMembers.userId, w.ca.id)))).toHaveLength(0);
    expect(await cdb.select().from(apiKeys).where(and(eq(apiKeys.tenantId, w.clientA.id), eq(apiKeys.userId, w.ca.id)))).toHaveLength(0);
    expect(await cdb.select().from(userTenantPrefs).where(and(eq(userTenantPrefs.tenantId, w.clientA.id), eq(userTenantPrefs.userId, w.ca.id)))).toHaveLength(0);
    const [s] = await cdb.select().from(sessions).where(eq(sessions.id, w.session.id));
    expect(s!.tenantId).toBeNull();

    const left = await cdb.select().from(securityEvents).where(and(eq(securityEvents.tenantId, w.clientA.id), eq(securityEvents.type, "access.left")));
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ userId: w.ca.id, actorUserId: w.ca.id });
    expect(await cdb.select().from(securityEvents).where(and(eq(securityEvents.tenantId, w.clientA.id), eq(securityEvents.type, "access.removed")))).toHaveLength(0);

    const log = await w.asOwnerA.tenant.accessLog({});
    expect(log.items.some((i) => i.type === "access.left" && i.subject?.id === w.ca.id)).toBe(true);
    // The other clients are untouched.
    expect((await w.asCa.tenant.listClients()).items.map((i) => i.name)).toEqual(["Bharat Foods", "Shah & Associates"]);
  });

  it("an owner cannot leave their own organisation", async () => {
    const w = await world();
    await expect(w.asCa.tenant.leave({ tenantId: w.firm.id })).rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringContaining("cannot leave") });
    await expect(w.asOwnerA.tenant.leave({ tenantId: w.clientA.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("someone who is not a member cannot leave (NOT_FOUND), nothing changes", async () => {
    const w = await world();
    await expect(w.asOwnerA.tenant.leave({ tenantId: w.clientB.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await getControlDb().select().from(tenantMembers).where(eq(tenantMembers.tenantId, w.clientB.id))).toHaveLength(2);
  });
});
