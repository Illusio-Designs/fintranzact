/**
 * tenant-ca-invite.test.ts — Integration tests for "Invite my CA".
 *
 *   - mixed-case invite e-mail is stored lowercased, shows in the CA's in-app
 *     list (myInvitations) and accepts by token and by id
 *   - CA roles: owner may invite, admin may not; cap of 3 (members + pending);
 *     not counted towards the free plan's team limit
 *   - role changes to/from a CA role are owner-only
 *   - accepting creates the tenant_members role, business_members grants and
 *     the organisation appears in the CA's tenant.list
 *   - business.ensureWalkInParty is refused for the CA roles
 *
 * Needs Postgres (like every integration test here).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { tenantMembers, invitations, businessMembers } from "@fintranzact/db";
import { randomUUID } from "crypto";
import { createUser, createTenant, addMember, createSession, createBusiness } from "../helpers/fixtures.js";
import { getControlDb, getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createCallerFactory } from "../../trpc.js";
import { appRouter } from "../../router.js";
import { CA_READ_ONLY_MESSAGE } from "../../lib/permissions.js";
import { CA_CAP_MESSAGE, CA_INVITE_OWNER_ONLY_MESSAGE } from "../../lib/invite-rules.js";

const factory = createCallerFactory(appRouter);

function caller(sessionId: string, user: { id: string; email: string; name: string | null }, tenantId: string | null) {
  const headers = new Headers({
    "content-type": "application/json",
    cookie: `session_id=${sessionId}`,
    "x-requested-with": "fintranzact",
  });
  return factory({
    user,
    tenantId,
    businessId: null,
    req: new Request("http://localhost:3000/api/trpc/test", { method: "POST", headers }),
    resHeaders: new Headers(),
    ipAddress: null,
  });
}

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

async function makeOrg(plan: "starter" | "business") {
  const owner = await createUser({ email: `owner.${randomUUID().slice(0, 8)}@biz.in`, name: "Rohit Sharma" });
  const admin = await createUser({ email: `admin.${randomUUID().slice(0, 8)}@biz.in`, name: "Asha Admin" });
  const tenant = await createTenant({ name: "Sharma Traders", plan });
  await addMember(tenant.id, owner.id, "owner");
  await addMember(tenant.id, admin.id, "admin");
  const ownerSession = await createSession(owner.id, tenant.id);
  const adminSession = await createSession(admin.id, tenant.id);
  return {
    tenant, owner, admin,
    asOwner: caller(ownerSession.id, owner, tenant.id),
    asAdmin: caller(adminSession.id, admin, tenant.id),
  };
}

describe("mixed-case invite e-mail", () => {
  let org: Awaited<ReturnType<typeof makeOrg>>;
  beforeAll(async () => { org = await makeOrg("business"); });

  it("is stored lowercased, appears in the CA's in-app list and accepts via token", async () => {
    const tdb = getTenantTestDb();
    const shop = await createBusiness(tdb, org.owner.id, { name: "Shop One" });
    await tdb.insert(businessMembers).values({ businessId: shop.id, userId: org.owner.id, role: "admin" });

    const ca = await createUser({ email: "anita.shah@firm.in", name: "Anita Shah" });
    const caSession = await createSession(ca.id);

    const res = await org.asOwner.tenant.inviteMember({ email: "  Anita.Shah@Firm.IN ", role: "ca_filing" });
    expect(res.role).toBe("ca_filing");
    expect(res.inviteUrl).toContain(`/invite/${res.token}`);
    const [row] = await getControlDb().select().from(invitations).where(eq(invitations.tenantId, org.tenant.id));
    expect(row!.email).toBe("anita.shah@firm.in");

    const asCa = caller(caSession.id, ca, null);
    const mine = await asCa.tenant.myInvitations();
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      tenantName: "Sharma Traders", role: "ca_filing", invitedByName: "Rohit Sharma", roleLabel: "Accountant (filing)",
    });
    expect(mine[0]!.accessDescription).toContain("file GST returns");

    const peek = await asCa.tenant.peekInvitation({ token: res.token });
    expect(peek).toMatchObject({ tenantName: "Sharma Traders", invitedByName: "Rohit Sharma", role: "ca_filing" });

    await asCa.tenant.acceptInvitation({ token: res.token });
    const [member] = await getControlDb().select().from(tenantMembers)
      .where(and(eq(tenantMembers.tenantId, org.tenant.id), eq(tenantMembers.userId, ca.id)));
    expect(member!.role).toBe("ca_filing");
    const grants = await tdb.select().from(businessMembers).where(eq(businessMembers.userId, ca.id));
    expect(grants.map((g) => g.businessId)).toEqual([shop.id]);
    expect((await asCa.tenant.list()).map((t) => t.tenantId)).toContain(org.tenant.id);
  });

  it("accepts a legacy mixed-case row by id and refuses a duplicate in another case", async () => {
    const user = await createUser({ email: "legacy.ca@firm.in", name: "Legacy CA" });
    await getControlDb().insert(invitations).values({
      tenantId: org.tenant.id, email: "Legacy.CA@Firm.in", role: "auditor", token: randomUUID(),
      invitedBy: org.owner.id, expiresAt: new Date(Date.now() + 86_400_000),
    });
    await expect(org.asOwner.tenant.inviteMember({ email: "LEGACY.ca@firm.in", role: "auditor" }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    const asUser = caller((await createSession(user.id)).id, user, null);
    const [inv] = await asUser.tenant.myInvitations();
    expect(inv!.roleLabel).toBe("Accountant (read-only)");
    await asUser.tenant.acceptById({ invitationId: inv!.id });
  });

  it("an existing user is found whatever case the invite is typed in", async () => {
    const existing = await createUser({ email: "member.already@biz.in", name: "Already" });
    await addMember(org.tenant.id, existing.id, "seller");
    await expect(org.asOwner.tenant.inviteMember({ email: "Member.Already@BIZ.in", role: "seller" }))
      .rejects.toMatchObject({ code: "CONFLICT", message: "User is already a member" });
  });
});

describe("CA invite rules", () => {
  it("owner may invite a CA, admin may not (but admin may invite staff)", async () => {
    const org = await makeOrg("business");
    await expect(org.asAdmin.tenant.inviteMember({ email: "ca1@firm.in", role: "auditor" }))
      .rejects.toMatchObject({ code: "FORBIDDEN", message: CA_INVITE_OWNER_ONLY_MESSAGE });
    await expect(org.asAdmin.tenant.inviteMember({ email: "ca1@firm.in", role: "ca_filing" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(org.asAdmin.tenant.inviteMember({ email: "staff1@biz.in", role: "seller" })).resolves.toBeDefined();
    await expect(org.asOwner.tenant.inviteMember({ email: "ca1@firm.in", role: "auditor" })).resolves.toMatchObject({ role: "auditor" });
  });

  it("caps CAs at 3 per organisation, counting members and pending invites", async () => {
    const org = await makeOrg("business");
    const existingCa = await createUser({ email: `ca.member.${randomUUID().slice(0, 6)}@firm.in` });
    await addMember(org.tenant.id, existingCa.id, "auditor");
    await org.asOwner.tenant.inviteMember({ email: "ca-a@firm.in", role: "auditor" });
    await org.asOwner.tenant.inviteMember({ email: "ca-b@firm.in", role: "ca_filing" });
    await expect(org.asOwner.tenant.inviteMember({ email: "ca-c@firm.in", role: "auditor" }))
      .rejects.toMatchObject({ code: "CONFLICT", message: CA_CAP_MESSAGE });
    // The cap is only for CAs.
    await expect(org.asOwner.tenant.inviteMember({ email: "staff@biz.in", role: "seller" })).resolves.toBeDefined();
  });

  it("CA members and CA invites do not count towards the free plan's team limit", async () => {
    const org = await makeOrg("starter"); // free: 3 members incl. pending invites; owner + admin = 2
    const ca = await createUser({ email: `ca.free.${randomUUID().slice(0, 6)}@firm.in` });
    await addMember(org.tenant.id, ca.id, "ca_filing");
    await org.asOwner.tenant.inviteMember({ email: "ca-x@firm.in", role: "auditor" });
    await org.asOwner.tenant.inviteMember({ email: "ca-y@firm.in", role: "auditor" });
    // A normal member still fits (2 of 3), then the limit bites.
    await expect(org.asOwner.tenant.inviteMember({ email: "staff-1@biz.in", role: "seller" })).resolves.toBeDefined();
    await expect(org.asOwner.tenant.inviteMember({ email: "staff-2@biz.in", role: "seller" }))
      .rejects.toMatchObject({ message: expect.stringContaining("team members") });
  });

  it("changing a role to or from a CA role is owner-only and capped", async () => {
    const org = await makeOrg("business");
    const staff = await createUser({ email: `staff.${randomUUID().slice(0, 6)}@biz.in` });
    await addMember(org.tenant.id, staff.id, "seller");
    await expect(org.asAdmin.tenant.updateMemberRole({ userId: staff.id, role: "auditor" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await org.asOwner.tenant.updateMemberRole({ userId: staff.id, role: "auditor" });
    await expect(org.asAdmin.tenant.updateMemberRole({ userId: staff.id, role: "seller" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await org.asOwner.tenant.updateMemberRole({ userId: staff.id, role: "ca_filing" }); // CA -> CA keeps the head-count
    await org.asOwner.tenant.updateMemberRole({ userId: staff.id, role: "seller" });

    for (const n of [1, 2, 3]) {
      const u = await createUser({ email: `capca${n}.${randomUUID().slice(0, 6)}@firm.in` });
      await addMember(org.tenant.id, u.id, "auditor");
    }
    await expect(org.asOwner.tenant.updateMemberRole({ userId: staff.id, role: "auditor" }))
      .rejects.toMatchObject({ code: "CONFLICT", message: CA_CAP_MESSAGE });
  });
});

describe("business.ensureWalkInParty and the CA roles", () => {
  it("is refused for auditor and ca_filing even with business access, allowed for staff", async () => {
    const org = await makeOrg("business");
    const tdb = getTenantTestDb();
    const biz = await createBusiness(tdb, org.owner.id, { name: "Walk-in Shop" });
    await tdb.insert(businessMembers).values({ businessId: biz.id, userId: org.owner.id, role: "admin" });
    for (const role of ["auditor", "ca_filing"] as const) {
      const u = await createUser({ email: `${role}.${randomUUID().slice(0, 6)}@firm.in` });
      await addMember(org.tenant.id, u.id, role);
      await tdb.insert(businessMembers).values({ businessId: biz.id, userId: u.id, role: "member" });
      const asCa = caller((await createSession(u.id, org.tenant.id)).id, u, org.tenant.id);
      const err = await asCa.business.ensureWalkInParty({ id: biz.id }).catch((e) => e);
      expect(err.code).toBe("FORBIDDEN");
      if (role === "auditor") expect(err.message).toBe(CA_READ_ONLY_MESSAGE);
    }
    await expect(org.asOwner.business.ensureWalkInParty({ id: biz.id })).resolves.toBeDefined();
  });
});
