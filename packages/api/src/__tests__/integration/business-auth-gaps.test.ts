/**
 * Router gaps: business (members, updateMemberRole, removeMember,
 * canCreate, logo/signature upload and delete, auditTrail, exportData) and
 * auth (updateName, requestEmailChange, confirmEmailChange, logoutAll).
 *
 * In self-hosted mode every organization shares one database, so the
 * business procedures that take a business id must refuse one that belongs
 * to another organization.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { businesses, businessMembers, sessions, users } from "@fintranzact/db";
import { getControlDb, getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createParty, createSession, createTestWorld, createUser, type TestWorld } from "../helpers/fixtures.js";
import { createTestContext } from "../helpers/test-context.js";
import { createUnauthenticatedCaller } from "../helpers/create-test-caller.js";
import { createCallerFactory } from "../../trpc.js";
import { appRouter } from "../../router.js";
import { emailService } from "../../lib/email.js";
import { callerFor, expectCode, waitForAudit } from "../helpers/assertions.js";

let world: TestWorld;
const UNKNOWN = "00000000-0000-4000-8000-000000000000";
const caller = () => callerFor(world, "ramesh");
const seller = () => callerFor(world, "suresh");
const other = () => callerFor(world, "kiran");
const factory = createCallerFactory(appRouter);
const userCaller = (u: { id: string; email: string; name: string | null }) => factory(createTestContext({ user: u }));

const PNG = `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]).toString("base64")}`;
const JPEG_AS_PNG = `data:image/png;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]).toString("base64")}`;
const TEXT_AS_PNG = `data:image/png;base64,${Buffer.from("definitely not an image").toString("base64")}`;

beforeAll(async () => {
  world = await createTestWorld();
  // Make sure business memberships exist (backfilled on first access).
  await caller().business.list();
  await seller().business.list();
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

describe("business members", () => {
  it("members lists the business's team with names", async () => {
    const rows = await caller().business.members({ businessId: world.business1.id });
    expect(rows.map((r) => r.email).sort()).toEqual([world.ramesh.email, world.suresh.email].sort());
    await expectCode(seller().business.members({ businessId: world.business1.id }), "FORBIDDEN");
  });

  it("updateMemberRole changes a role; NOT_FOUND for a non-member; sellers refused", async () => {
    const res = await caller().business.updateMemberRole({ businessId: world.business1.id, userId: world.suresh.id, role: "admin" });
    expect(res.role).toBe("admin");
    await caller().business.updateMemberRole({ businessId: world.business1.id, userId: world.suresh.id, role: "member" });
    await expectCode(caller().business.updateMemberRole({ businessId: world.business1.id, userId: UNKNOWN, role: "admin" }), "NOT_FOUND");
    await expectCode(caller().business.updateMemberRole({ businessId: world.business1.id, userId: world.suresh.id, role: "owner" as never }), "BAD_REQUEST");
    await expectCode(seller().business.updateMemberRole({ businessId: world.business1.id, userId: world.suresh.id, role: "admin" }), "FORBIDDEN");
  });

  it("removeMember removes a member but never the last admin", async () => {
    const extra = await createUser({ email: "extra.member@acmetrading.in" });
    const { addMember } = await import("../helpers/fixtures.js");
    await addMember(world.tenant1.id, extra.id, "member");
    await caller().business.addMember({ businessId: world.business1.id, userId: extra.id });
    await expect(caller().business.removeMember({ businessId: world.business1.id, userId: extra.id })).resolves.toEqual({ success: true });
    await expectCode(caller().business.removeMember({ businessId: world.business1.id, userId: extra.id }), "NOT_FOUND");
    const admins = await getTenantTestDb().select().from(businessMembers)
      .where(and(eq(businessMembers.businessId, world.business1.id), eq(businessMembers.role, "admin")));
    expect(admins).toHaveLength(1);
    await expect(caller().business.removeMember({ businessId: world.business1.id, userId: admins[0]!.userId }))
      .rejects.toMatchObject({ code: "BAD_REQUEST", message: /last business admin/ });
  });

  it("another organization's admin can't see or change this business's team", async () => {
    await expectCode(other().business.members({ businessId: world.business1.id }), "FORBIDDEN");
    await expectCode(other().business.updateMemberRole({ businessId: world.business1.id, userId: world.suresh.id, role: "admin" }), "FORBIDDEN");
    await expectCode(other().business.removeMember({ businessId: world.business1.id, userId: world.suresh.id }), "FORBIDDEN");
    const [row] = await getTenantTestDb().select().from(businessMembers)
      .where(and(eq(businessMembers.businessId, world.business1.id), eq(businessMembers.userId, world.suresh.id)));
    expect(row!.role).toBe("member");
  });
});

describe("business.canCreate", () => {
  it("is true on an unlimited plan", async () => {
    await expect(caller().business.canCreate()).resolves.toBe(true);
  });
});

describe("business logo and signature", () => {
  it("uploads a logo and a signature, audits, then deletes them", async () => {
    const id = world.business1.id;
    const logo = await caller().business.uploadLogo({ id, data: { dataUrl: PNG, width: 10, height: 10 } });
    expect(logo.logoUpdatedAt).toBeInstanceOf(Date);
    const sig = await caller().business.uploadSignature({ id, data: { dataUrl: PNG, width: 20, height: 8 } });
    expect(sig.signatureUpdatedAt).toBeInstanceOf(Date);
    const [row] = await getTenantTestDb().select().from(businesses).where(eq(businesses.id, id));
    expect(row).toMatchObject({ logoMimeType: "image/png", logoWidth: 10, signatureMimeType: "image/png", signatureHeight: 8 });
    expect(await waitForAudit(id, "business.uploadLogo", id)).toHaveLength(1);

    await expect(caller().business.deleteLogo({ id })).resolves.toEqual({ ok: true });
    await expect(caller().business.deleteSignature({ id })).resolves.toEqual({ ok: true });
    const [after] = await getTenantTestDb().select().from(businesses).where(eq(businesses.id, id));
    expect(after).toMatchObject({ logoData: null, logoMimeType: null, signatureData: null, signatureMimeType: null });
    expect(await waitForAudit(id, "business.deleteSignature", id)).toHaveLength(1);
  });

  it("checks the bytes, not the declared type", async () => {
    const id = world.business1.id;
    // JPEG bytes declared as PNG are refused, as is text.
    await expectCode(caller().business.uploadLogo({ id, data: { dataUrl: JPEG_AS_PNG, width: 1, height: 1 } }), "BAD_REQUEST");
    await expectCode(caller().business.uploadSignature({ id, data: { dataUrl: TEXT_AS_PNG, width: 1, height: 1 } }), "BAD_REQUEST");
    await expectCode(caller().business.uploadLogo({ id, data: { dataUrl: "data:image/svg+xml;base64,AAAA", width: 1, height: 1 } }), "BAD_REQUEST");
    await expectCode(caller().business.uploadLogo({ id, data: { dataUrl: PNG, width: 0, height: 1 } }), "BAD_REQUEST");
  });

  it("FORBIDDEN for unknown businesses; sellers refused", async () => {
    await expectCode(caller().business.uploadLogo({ id: UNKNOWN, data: { dataUrl: PNG, width: 1, height: 1 } }), "FORBIDDEN");
    await expectCode(caller().business.deleteLogo({ id: UNKNOWN }), "FORBIDDEN");
    await expectCode(caller().business.deleteSignature({ id: UNKNOWN }), "FORBIDDEN");
    await expectCode(seller().business.uploadLogo({ id: world.business1.id, data: { dataUrl: PNG, width: 1, height: 1 } }), "FORBIDDEN");
    await expectCode(seller().business.deleteSignature({ id: world.business1.id }), "FORBIDDEN");
  });

  it("another organization's admin can't change this business's images or settings", async () => {
    const id = world.business1.id;
    await caller().business.uploadLogo({ id, data: { dataUrl: PNG, width: 3, height: 3 } });
    await expectCode(other().business.deleteLogo({ id }), "FORBIDDEN");
    await expectCode(other().business.uploadSignature({ id, data: { dataUrl: PNG, width: 1, height: 1 } }), "FORBIDDEN");
    await expectCode(other().business.deleteSignature({ id }), "FORBIDDEN");
    await expectCode(other().business.uploadLogo({ id, data: { dataUrl: PNG, width: 1, height: 1 } }), "FORBIDDEN");
    await expectCode(other().business.update({ id, data: { name: "Hijacked" } }), "FORBIDDEN");
    await expectCode(other().business.setPosEnabled({ id, enabled: true }), "FORBIDDEN");
    const [row] = await getTenantTestDb().select().from(businesses).where(eq(businesses.id, id));
    expect(row).toMatchObject({ logoWidth: 3, name: world.business1.name, posEnabled: false });
  });
});

describe("business.auditTrail / exportData", () => {
  it("auditTrail pages this business's log with user names and date filters", async () => {
    const res = await caller().business.auditTrail({ page: 1, limit: 100 });
    expect(res.total).toBeGreaterThan(0);
    expect(res.data.every((e) => e.businessId === world.business1.id)).toBe(true);
    expect(res.data.find((e) => e.userId === world.ramesh.id)!.userName).toBe(world.ramesh.name);
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect((await caller().business.auditTrail({ fromDate: future, page: 1, limit: 10 })).total).toBe(0);
    await expectCode(caller().business.auditTrail({ page: 1, limit: 101 }), "BAD_REQUEST");
    expect((await other().business.auditTrail({ page: 1, limit: 100 })).data.every((e) => e.businessId === world.business2.id)).toBe(true);
  });

  it("exportData returns CSVs of this business's records, quoting commas", async () => {
    await createParty(getTenantTestDb(), world.business1.id, { name: "Comma, Quote \"Co\"", type: "customer" });
    const res = await caller().business.exportData();
    expect(res.parties.split("\n")[0]).toBe("name,type,phone,email,gstin,billingAddress,city,state,pincode,openingBalance,category");
    expect(res.parties).toContain('"Comma, Quote ""Co"""');
    expect(res.parties).not.toContain(world.party2.name);
    expect(res.items).toContain(world.item1.name);
    await expectCode(seller().business.exportData(), "FORBIDDEN");
  });
});

describe("auth", () => {
  it("updateName changes the name and validates it", async () => {
    const u = await createUser({ email: "rename.me@example.in", name: "Old Name" });
    await expect(userCaller(u).auth.updateName({ name: "New Name" })).resolves.toEqual({ success: true });
    const [row] = await getControlDb().select().from(users).where(eq(users.id, u.id));
    expect(row!.name).toBe("New Name");
    await expectCode(userCaller(u).auth.updateName({ name: "X" }), "BAD_REQUEST");
    await expectCode(createUnauthenticatedCaller().auth.updateName({ name: "Nobody" }), "UNAUTHORIZED");
  });

  it("requestEmailChange emails a link that confirmEmailChange uses once", async () => {
    const u = await createUser({ email: "move.me@example.in" });
    const send = vi.spyOn(emailService, "sendEmailChangeLink").mockResolvedValue(undefined as never);
    try {
      await expect(userCaller(u).auth.requestEmailChange({ newEmail: "Moved.Here@Example.in" })).resolves.toEqual({ success: true });
      const [to, url] = send.mock.calls[0] as [string, string];
      expect(to).toBe("moved.here@example.in");
      const token = new URL(url).searchParams.get("token")!;
      await expect(createUnauthenticatedCaller().auth.confirmEmailChange({ token })).resolves.toEqual({ success: true, newEmail: "moved.here@example.in" });
      const [row] = await getControlDb().select().from(users).where(eq(users.id, u.id));
      expect(row).toMatchObject({ email: "moved.here@example.in", emailVerified: true });
      await expectCode(createUnauthenticatedCaller().auth.confirmEmailChange({ token }), "BAD_REQUEST");
    } finally {
      send.mockRestore();
    }
  });

  it("requestEmailChange refuses an address in use and bad input; confirm refuses unknown tokens", async () => {
    const u = await createUser({ email: "stay.put@example.in" });
    await expectCode(userCaller(u).auth.requestEmailChange({ newEmail: world.ramesh.email.toUpperCase() }), "CONFLICT");
    await expectCode(userCaller(u).auth.requestEmailChange({ newEmail: "nope" }), "BAD_REQUEST");
    await expectCode(createUnauthenticatedCaller().auth.confirmEmailChange({ token: "made-up" }), "BAD_REQUEST");
  });

  it("confirmEmailChange reports a clash if the address was taken after the request", async () => {
    const u = await createUser({ email: "slow.mover@example.in" });
    const send = vi.spyOn(emailService, "sendEmailChangeLink").mockResolvedValue(undefined as never);
    try {
      await userCaller(u).auth.requestEmailChange({ newEmail: "contested@example.in" });
      const token = new URL((send.mock.calls[0] as [string, string])[1]).searchParams.get("token")!;
      await createUser({ email: "contested@example.in" });
      await expectCode(createUnauthenticatedCaller().auth.confirmEmailChange({ token }), "CONFLICT");
      const [row] = await getControlDb().select().from(users).where(eq(users.id, u.id));
      expect(row!.email).toBe("slow.mover@example.in");
    } finally {
      send.mockRestore();
    }
  });

  it("logoutAll removes every session of the user and no one else's", async () => {
    const u = await createUser({ email: "many.devices@example.in" });
    await createSession(u.id);
    await createSession(u.id);
    const bystander = await createSession(world.kiran.id);
    await expect(userCaller(u).auth.logoutAll()).resolves.toEqual({ success: true });
    expect(await getControlDb().select().from(sessions).where(eq(sessions.userId, u.id))).toHaveLength(0);
    expect(await getControlDb().select().from(sessions).where(eq(sessions.id, bystander.id))).toHaveLength(1);
    await expectCode(createUnauthenticatedCaller().auth.logoutAll(), "UNAUTHORIZED");
  });
});
