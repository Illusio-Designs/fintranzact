/**
 * tenant-access-log.test.ts: the access log ("who was invited, who accepted,
 * role changes, removals, when the CA opened the books, what they downloaded").
 *
 * Integration (needs Postgres, TEST_DATABASE_URL). Covers: events written for
 * invite -> revoke -> accept -> role change -> remove; tenant.accessLog gated to
 * owner/admin with newest-first keyset paging; tenant.members lastOpenedAt for
 * CA members only; a CA's GSTR-1 JSON download producing access.export (and an
 * owner's not); org_opened throttled; a CA's filing writing an audit_log row
 * that carries the role.
 */
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { businessMembers, securityEvents } from "@fintranzact/db";
import { createUser, createTenant, addMember, createSession, createBusiness } from "../helpers/fixtures.js";
import { getControlDb, getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { waitForAudit } from "../helpers/assertions.js";
import { createCallerFactory } from "../../trpc.js";
import { appRouter } from "../../router.js";
import { clearTenantMembershipCache } from "../../lib/tenant-membership.js";
import { resetOrgOpenedThrottle } from "../../lib/access-events.js";

const factory = createCallerFactory(appRouter);
type U = { id: string; email: string; name: string | null };

function caller(sessionId: string, user: U, tenantId: string | null, businessId: string | null = null) {
  return factory({
    user,
    tenantId,
    businessId,
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

async function makeOrg() {
  const tdb = getTenantTestDb();
  const owner = await createUser({ email: `owner.${randomUUID().slice(0, 8)}@biz.in`, name: "Rohit Sharma" });
  const admin = await createUser({ email: `admin.${randomUUID().slice(0, 8)}@biz.in`, name: "Asha Admin" });
  const seller = await createUser({ email: `seller.${randomUUID().slice(0, 8)}@biz.in`, name: "Sam Seller" });
  const tenant = await createTenant({ name: "Sharma Traders", plan: "business" });
  await addMember(tenant.id, owner.id, "owner");
  await addMember(tenant.id, admin.id, "admin");
  await addMember(tenant.id, seller.id, "seller");
  const shop = await createBusiness(tdb, owner.id, { name: "Shop One" });
  await tdb.insert(businessMembers).values([
    { businessId: shop.id, userId: owner.id, role: "admin" },
    { businessId: shop.id, userId: admin.id, role: "admin" },
    { businessId: shop.id, userId: seller.id, role: "member" },
  ]);
  const ownerSession = await createSession(owner.id, tenant.id);
  const adminSession = await createSession(admin.id, tenant.id);
  const sellerSession = await createSession(seller.id, tenant.id);
  return {
    tenant, owner, admin, seller, shop,
    asOwner: caller(ownerSession.id, owner, tenant.id),
    asOwnerInShop: caller(ownerSession.id, owner, tenant.id, shop.id),
    asAdmin: caller(adminSession.id, admin, tenant.id),
    asSeller: caller(sellerSession.id, seller, tenant.id),
  };
}

const events = (tenantId: string, type?: string) =>
  getControlDb().select().from(securityEvents).where(type ? and(eq(securityEvents.tenantId, tenantId), eq(securityEvents.type, type)) : eq(securityEvents.tenantId, tenantId));

describe("lifecycle events: invite -> revoke -> accept -> role change -> remove", () => {
  it("writes one event per step with the right actor, subject and metadata", async () => {
    const org = await makeOrg();
    const ca = await createUser({ email: `ca.${randomUUID().slice(0, 8)}@firm.in`, name: "Anita Shah" });
    const caSession = await createSession(ca.id);
    const asCaNoOrg = caller(caSession.id, ca, null);

    // Invite to an e-mail with no account: subject is null.
    const nobody = `new.${randomUUID().slice(0, 8)}@firm.in`;
    await org.asOwner.tenant.inviteMember({ email: nobody, role: "auditor" });
    const [invNobody] = await events(org.tenant.id, "access.invited");
    expect(invNobody).toMatchObject({ actorUserId: org.owner.id, userId: null });
    expect(invNobody!.metadata).toEqual({ role: "auditor", email: nobody });

    // Withdraw it.
    const [pending] = await org.asOwner.tenant.pendingInvitations();
    await org.asOwner.tenant.revokeInvitation({ invitationId: pending!.id });
    const [revoked] = await events(org.tenant.id, "access.invite_revoked");
    expect(revoked).toMatchObject({ actorUserId: org.owner.id });
    expect(revoked!.metadata).toEqual({ role: "auditor", email: nobody });

    // Invite the CA (has an account): subject is the CA. Raw token never stored in the event.
    const inv = await org.asOwner.tenant.inviteMember({ email: ca.email, role: "auditor" });
    const invited = (await events(org.tenant.id, "access.invited")).find((e) => e.userId === ca.id);
    expect(invited).toBeTruthy();
    expect(JSON.stringify(invited)).not.toContain(inv.token);

    await asCaNoOrg.tenant.acceptInvitation({ token: inv.token });
    const [accepted] = await events(org.tenant.id, "access.accepted");
    expect(accepted).toMatchObject({ actorUserId: ca.id, userId: ca.id });
    expect(accepted!.metadata).toEqual({ role: "auditor" });

    await org.asOwner.tenant.updateMemberRole({ userId: ca.id, role: "ca_filing" });
    const [changed] = await events(org.tenant.id, "access.role_changed");
    expect(changed).toMatchObject({ actorUserId: org.owner.id, userId: ca.id });
    expect(changed!.metadata).toEqual({ from: "auditor", to: "ca_filing", email: ca.email });

    // Setting the same role again is not a change.
    await org.asOwner.tenant.updateMemberRole({ userId: ca.id, role: "ca_filing" });
    expect(await events(org.tenant.id, "access.role_changed")).toHaveLength(1);

    await org.asOwner.tenant.removeMember({ userId: ca.id });
    expect(await events(org.tenant.id, "access.removed")).toHaveLength(1);

    // The log shows it all, newest first.
    const log = await org.asOwner.tenant.accessLog();
    expect(log.items.map((i) => i.type)).toEqual([
      "access.removed", "access.role_changed", "access.accepted", "access.invited", "access.invite_revoked", "access.invited",
    ]);
    expect(log.items[0]!.subject).toMatchObject({ id: ca.id, name: "Anita Shah" });
    expect(log.items[0]!.actor).toMatchObject({ id: org.owner.id });
    expect(log.nextCursor).toBeNull();
  });
});

describe("tenant.accessLog", () => {
  it("is for owners and admins only", async () => {
    const org = await makeOrg();
    await expect(org.asOwner.tenant.accessLog()).resolves.toMatchObject({ items: [] });
    await expect(org.asAdmin.tenant.accessLog()).resolves.toMatchObject({ items: [] });
    await expect(org.asSeller.tenant.accessLog()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("only returns this organisation's access.* events", async () => {
    const org = await makeOrg();
    const other = await makeOrg();
    await org.asOwner.tenant.inviteMember({ email: `a.${randomUUID().slice(0, 8)}@firm.in`, role: "auditor" });
    await other.asOwner.tenant.inviteMember({ email: `b.${randomUUID().slice(0, 8)}@firm.in`, role: "auditor" });
    await getControlDb().insert(securityEvents).values({ tenantId: org.tenant.id, userId: org.owner.id, type: "2fa.enabled" });
    const log = await org.asOwner.tenant.accessLog();
    expect(log.items).toHaveLength(1);
    expect(log.items[0]!.type).toBe("access.invited");
  });

  it("pages with a (createdAt, id) keyset, with no skips or repeats across equal timestamps", async () => {
    const org = await makeOrg();
    const same = new Date("2026-09-01T10:00:00.123Z");
    await getControlDb().insert(securityEvents).values(
      Array.from({ length: 7 }, (_, i) => ({ tenantId: org.tenant.id, userId: org.owner.id, actorUserId: org.owner.id, type: "access.org_opened", metadata: { role: "auditor", n: i }, createdAt: same })),
    );
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard++) {
      const page = await org.asOwner.tenant.accessLog({ limit: 3, cursor });
      seen.push(...page.items.map((i) => i.id));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
  });

  it("filters by type and never returns unsafe metadata", async () => {
    const org = await makeOrg();
    await getControlDb().insert(securityEvents).values([
      { tenantId: org.tenant.id, userId: org.owner.id, actorUserId: org.owner.id, type: "access.org_opened", metadata: { role: "auditor", secret: "x" } },
      { tenantId: org.tenant.id, userId: org.owner.id, actorUserId: org.owner.id, type: "access.export", metadata: { procedure: "gst.gstr1Json", role: "auditor" } },
    ]);
    const only = await org.asOwner.tenant.accessLog({ type: "access.export" });
    expect(only.items.map((i) => i.type)).toEqual(["access.export"]);
    const many = await org.asOwner.tenant.accessLog({ type: ["access.export", "access.org_opened"] });
    expect(many.items).toHaveLength(2);
    expect(JSON.stringify(many)).not.toContain("secret");
  });
});

describe("CA activity", () => {
  async function orgWithCa(role: "auditor" | "ca_filing") {
    const org = await makeOrg();
    const ca = await createUser({ email: `ca.${randomUUID().slice(0, 8)}@firm.in`, name: "Anita Shah" });
    await addMember(org.tenant.id, ca.id, role);
    await getTenantTestDb().insert(businessMembers).values({ businessId: org.shop.id, userId: ca.id, role: "member" });
    const session = await createSession(ca.id, org.tenant.id);
    return { org, ca, asCa: caller(session.id, ca, org.tenant.id, org.shop.id), asCaTenant: caller(session.id, ca, org.tenant.id) };
  }

  it("a CA's GSTR-1 JSON download produces access.export; an owner's does not", async () => {
    const { org, ca, asCa } = await orgWithCa("auditor");
    await asCa.gst.gstr1Json({ year: 2026, month: 8 });
    await org.asOwnerInShop.gst.gstr1Json({ year: 2026, month: 8 });
    const exports = await events(org.tenant.id, "access.export");
    expect(exports).toHaveLength(1);
    expect(exports[0]).toMatchObject({ userId: ca.id, actorUserId: ca.id });
    expect(exports[0]!.metadata).toEqual({ procedure: "gst.gstr1Json", role: "auditor" });
  });

  it("opening the organisation is logged once an hour, and lastOpenedAt is shown to owners/admins for CA members only", async () => {
    const { org, ca, asCa } = await orgWithCa("ca_filing");
    await asCa.gst.gstr1Json({ year: 2026, month: 8 });
    await asCa.gst.gstr1Json({ year: 2026, month: 7 });
    expect(await events(org.tenant.id, "access.org_opened")).toHaveLength(1);

    const members = await org.asOwner.tenant.members();
    const caRow = members.find((m) => m.userId === ca.id)!;
    expect(caRow.lastOpenedAt).toBeInstanceOf(Date);
    expect(members.find((m) => m.userId === org.seller.id)!.lastOpenedAt).toBeNull();
    // Hidden from non-admins.
    const asSellerMembers = await org.asSeller.tenant.members();
    expect(asSellerMembers.every((m) => m.lastOpenedAt === null)).toBe(true);
  });

  it("a CA with no activity has lastOpenedAt null (never opened)", async () => {
    const { org, ca } = await orgWithCa("auditor");
    const row = (await org.asOwner.tenant.members()).find((m) => m.userId === ca.id)!;
    expect(row.lastOpenedAt).toBeNull();
  });

  it("filing writes an audit_log row with the CA's role", async () => {
    const { org, asCa } = await orgWithCa("ca_filing");
    await asCa.period.lockGstMonth({ returnPeriod: "2024-01" });
    const rows = await waitForAudit(org.shop.id, "period.lockGstMonth");
    expect(rows).toHaveLength(1);
    expect(JSON.parse(String(rows[0]!.metadata))).toMatchObject({ returnPeriod: "2024-01", role: "ca_filing" });
  });
});
