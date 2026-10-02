/**
 * tenant-ca-partner.test.ts — Integration tests for the CA / partner-programme link.
 *
 *   - invite with creditPartner for an approved accountant partner: accepting
 *     sets tenants.partnerId and records access.partner_attributed; without the
 *     box nothing is set (no auto-commission)
 *   - an unapproved / non-accountant partner (or a stranger) is refused
 *   - an organisation that already has a partner is not overwritten
 *   - the "Registered CA partner" badge on pending invitations and members
 *   - partner.portal managedClients: CA roles only
 *   - existing referral stats still count tenants by tenants.partnerId
 *
 * Needs Postgres (like every integration test here). Not run where it was written.
 */
import { describe, it, expect, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { tenants, partners, securityEvents } from "@fintranzact/db";
import { randomUUID } from "crypto";
import { createUser, createTenant, addMember, createSession } from "../helpers/fixtures.js";
import { getControlDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createCallerFactory } from "../../trpc.js";
import { appRouter } from "../../router.js";
import { CREDIT_PARTNER_REFUSAL } from "../../lib/partner-ca.js";

const factory = createCallerFactory(appRouter);

function caller(sessionId: string, user: { id: string; email: string; name: string | null }, tenantId: string | null) {
  const headers = new Headers({ "content-type": "application/json", cookie: `session_id=${sessionId}`, "x-requested-with": "fintranzact" });
  return factory({
    user, tenantId, businessId: null,
    req: new Request("http://localhost:3000/api/trpc/test", { method: "POST", headers }),
    resHeaders: new Headers(), ipAddress: null,
  });
}

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

async function makeOrg() {
  const owner = await createUser({ email: `owner.${randomUUID().slice(0, 8)}@biz.in`, name: "Rohit Sharma" });
  const tenant = await createTenant({ name: "Sharma Traders", plan: "business" });
  await addMember(tenant.id, owner.id, "owner");
  const s = await createSession(owner.id, tenant.id);
  return { tenant, owner, asOwner: caller(s.id, owner, tenant.id) };
}

async function makePartner(over: Partial<typeof partners.$inferInsert> = {}) {
  const email = over.email ?? `ca.${randomUUID().slice(0, 8)}@firm.in`;
  const [p] = await getControlDb().insert(partners).values({
    contactName: "Anita Shah", companyName: "Shah & Co", email, phone: "+91 98765 43210", city: "Pune",
    partnerType: "accountant", status: "approved", referralCode: `FTZ-${randomUUID().slice(0, 6).toUpperCase()}`, ...over,
  }).returning();
  const user = await createUser({ email, name: "Anita Shah" });
  const s = await createSession(user.id);
  return { partner: p!, user, asCa: caller(s.id, user, null), sessionId: s.id };
}

const partnerOf = async (tenantId: string) =>
  (await getControlDb().select({ partnerId: tenants.partnerId }).from(tenants).where(eq(tenants.id, tenantId)))[0]!.partnerId;
const attributedEvents = (tenantId: string) =>
  getControlDb().select().from(securityEvents).where(and(eq(securityEvents.tenantId, tenantId), eq(securityEvents.type, "access.partner_attributed")));

describe("opt-in attribution", () => {
  it("credits the partner on accept when the owner ticked the box, and records one event", async () => {
    const org = await makeOrg();
    const ca = await makePartner();
    const res = await org.asOwner.tenant.inviteMember({ email: ca.user.email, role: "auditor", creditPartner: true });
    await ca.asCa.tenant.acceptInvitation({ token: res.token });
    expect(await partnerOf(org.tenant.id)).toBe(ca.partner.id);
    const events = await attributedEvents(org.tenant.id);
    expect(events).toHaveLength(1);
    expect(events[0]!.metadata).toMatchObject({ role: "auditor", partnerName: "Shah & Co" });
    // accepting again is a no-op: still one event
    await ca.asCa.tenant.acceptInvitation({ token: res.token });
    expect(await attributedEvents(org.tenant.id)).toHaveLength(1);
  });

  it("works through acceptById too", async () => {
    const org = await makeOrg();
    const ca = await makePartner();
    await org.asOwner.tenant.inviteMember({ email: ca.user.email, role: "ca_filing", creditPartner: true });
    const [inv] = await ca.asCa.tenant.myInvitations();
    await ca.asCa.tenant.acceptById({ invitationId: inv!.id });
    expect(await partnerOf(org.tenant.id)).toBe(ca.partner.id);
  });

  it("does nothing without the box (no automatic commission)", async () => {
    const org = await makeOrg();
    const ca = await makePartner();
    const res = await org.asOwner.tenant.inviteMember({ email: ca.user.email, role: "auditor" });
    await ca.asCa.tenant.acceptInvitation({ token: res.token });
    expect(await partnerOf(org.tenant.id)).toBeNull();
    expect(await attributedEvents(org.tenant.id)).toHaveLength(0);
  });

  it("refuses the box for an unapproved partner, a non-accountant partner and a stranger", async () => {
    const org = await makeOrg();
    const pending = await makePartner({ status: "pending" });
    const reseller = await makePartner({ partnerType: "reseller" });
    for (const email of [pending.user.email, reseller.user.email, "nobody@firm.in"]) {
      await expect(org.asOwner.tenant.inviteMember({ email, role: "auditor", creditPartner: true }))
        .rejects.toMatchObject({ message: CREDIT_PARTNER_REFUSAL });
    }
  });

  it("ignores the box for a non-CA role", async () => {
    const org = await makeOrg();
    const res = await org.asOwner.tenant.inviteMember({ email: "staff@biz.in", role: "seller", creditPartner: true });
    expect(res.role).toBe("seller");
  });

  it("never overwrites an organisation's existing partner", async () => {
    const org = await makeOrg();
    const first = await makePartner();
    await getControlDb().update(tenants).set({ partnerId: first.partner.id }).where(eq(tenants.id, org.tenant.id));
    const ca = await makePartner();
    const res = await org.asOwner.tenant.inviteMember({ email: ca.user.email, role: "auditor", creditPartner: true });
    await ca.asCa.tenant.acceptInvitation({ token: res.token });
    expect(await partnerOf(org.tenant.id)).toBe(first.partner.id);
    expect(await attributedEvents(org.tenant.id)).toHaveLength(0);
  });

  it("existing referral stats are unchanged: a credited organisation counts like a referred one", async () => {
    const org = await makeOrg();
    const ca = await makePartner();
    const res = await org.asOwner.tenant.inviteMember({ email: ca.user.email, role: "auditor", creditPartner: true });
    await ca.asCa.tenant.acceptInvitation({ token: res.token });
    const portal = await ca.asCa.partner.portal();
    expect(portal.kind).toBe("partner");
    if (portal.kind === "partner") {
      expect(portal.stats.referred).toBe(1);
      expect(portal.referred.map((r) => r.name)).toEqual(["Sharma Traders"]);
    }
  });
});

describe("badge", () => {
  it("shows Registered CA partner on the pending invitation and on the member row, to the owner", async () => {
    const org = await makeOrg();
    const ca = await makePartner();
    const plain = await createUser({ email: "plain.ca@firm.in", name: "Plain CA" });
    await org.asOwner.tenant.inviteMember({ email: ca.user.email, role: "auditor" });
    await org.asOwner.tenant.inviteMember({ email: plain.email, role: "auditor" });
    const pending = await org.asOwner.tenant.pendingInvitations();
    expect(pending.find((p) => p.email === ca.user.email)!.caPartner).toEqual({ id: ca.partner.id, companyName: "Shah & Co" });
    expect(pending.find((p) => p.email === plain.email)!.caPartner).toBeNull();

    const [inv] = await ca.asCa.tenant.myInvitations();
    await ca.asCa.tenant.acceptById({ invitationId: inv!.id });
    const members = await org.asOwner.tenant.members();
    expect(members.find((m) => m.userId === ca.user.id)!.caPartner).toEqual({ id: ca.partner.id, companyName: "Shah & Co" });
    expect(members.find((m) => m.userId === org.owner.id)!.caPartner).toBeNull();
  });
});

describe("clients you manage", () => {
  it("lists organisations where the partner holds a CA role, and nothing else", async () => {
    const ca = await makePartner();
    const client = await createTenant({ name: "Client One", plan: "free" });
    const own = await createTenant({ name: "Own Firm", plan: "free" });
    const staffOrg = await createTenant({ name: "Bookkeeping Org", plan: "free" });
    await addMember(client.id, ca.user.id, "ca_filing");
    await addMember(own.id, ca.user.id, "owner");
    await addMember(staffOrg.id, ca.user.id, "accountant");
    const portal = await ca.asCa.partner.portal();
    expect(portal.kind).toBe("partner");
    if (portal.kind === "partner") {
      expect(portal.managedClients!.map((c) => c.name)).toEqual(["Client One"]);
      expect(portal.managedClients![0]).toMatchObject({ role: "ca_filing", roleLabel: "Accountant (filing)", lastOpenedAt: null });
    }
  });

  it("is null for a partner who is not an accountant", async () => {
    const reseller = await makePartner({ partnerType: "reseller" });
    const portal = await reseller.asCa.partner.portal();
    if (portal.kind === "partner") expect(portal.managedClients).toBeNull();
    else throw new Error("expected partner portal");
  });
});
