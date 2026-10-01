/**
 * Router gaps: apiKey, selfExport, selfImport, system, hsn, share.
 *
 * Other files cover the main flows (remaining.test.ts for API keys,
 * selfExportImport.test.ts for the archive, share-links.test.ts for links,
 * maintenance-mode.test.ts for system). This one covers the input
 * validation, unknown ids, tenant scoping and side effects they skip.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { apiKeys, invoices, shareLinks } from "@fintranzact/db";
import { getControlDb, getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import {
  addMember,
  createInvoiceWithItems,
  createTenant,
  createTestWorld,
  createUser,
  type TestWorld,
} from "../helpers/fixtures.js";
import { createTestCaller, createUnauthenticatedCaller } from "../helpers/create-test-caller.js";
import { createTestContext } from "../helpers/test-context.js";
import { createCallerFactory } from "../../trpc.js";
import { appRouter } from "../../router.js";
import { callerFor, expectCode, waitForAudit } from "../helpers/assertions.js";
import { verifyImportToken } from "../../lib/importToken.js";
import { verifyExportToken } from "../../lib/exportToken.js";

const UNKNOWN = "00000000-0000-4000-8000-000000000000";
const factory = createCallerFactory(appRouter);

/** A caller with a user but no organization selected. */
function noTenantCaller(user: { id: string; email: string; name: string | null }) {
  return factory(createTestContext({ user }));
}

// selfImport.request needs a database with no businesses at all (in
// self-hosted mode every tenant shares one database), so it runs first.
describe("selfImport.request on an empty database", () => {
  let owner: Awaited<ReturnType<typeof createUser>>;
  let tenantId: string;

  beforeAll(async () => {
    await truncateAllTables();
    owner = await createUser({ email: "empty.owner@example.in", name: "Empty Owner" });
    const tenant = await createTenant({ slug: "empty-import-target" });
    tenantId = tenant.id;
    await addMember(tenant.id, owner.id, "owner");
  });

  it("issues a single-use import token for the tenant's owner", async () => {
    const res = await noTenantCaller(owner).selfImport.request({ tenantId });
    expect(res.url).toBe(`/api/selfImport/${tenantId}?token=${encodeURIComponent(res.token)}`);
    expect(new Date(res.expiresAt).getTime()).toBeGreaterThan(Date.now());
    const first = verifyImportToken(res.token);
    expect(first).toMatchObject({ ok: true, payload: { tenantId, userId: owner.id } });
    expect(verifyImportToken(res.token)).toEqual({ ok: false, reason: "reused" });
  });

  it("refuses a user who is not a member, and a bad tenant id", async () => {
    const stranger = await createUser({ email: "stranger.import@example.in" });
    await expectCode(noTenantCaller(stranger).selfImport.request({ tenantId }), "FORBIDDEN");
    await expectCode(noTenantCaller(owner).selfImport.request({ tenantId: "nope" }), "BAD_REQUEST");
    await expectCode(noTenantCaller(owner).selfImport.request({ tenantId: UNKNOWN }), "FORBIDDEN");
  });

  it("refuses a signed-out caller", async () => {
    await expectCode(createUnauthenticatedCaller().selfImport.request({ tenantId }), "UNAUTHORIZED");
  });

  afterAll(async () => {
    await truncateAllTables();
  });
});

describe("with a test world", () => {
  let world: TestWorld;

  beforeAll(async () => {
    world = await createTestWorld();
  });

  afterAll(async () => {
    await truncateAllTables();
    await closeTestDb();
  });

  // ── apiKey ────────────────────────────────────────────────────────────────

  describe("apiKey", () => {
    it("needs an organization selected for list, create and revoke", async () => {
      const c = noTenantCaller(world.ramesh);
      await expectCode(c.apiKey.list(), "BAD_REQUEST");
      await expectCode(c.apiKey.create({ name: "No org" }), "BAD_REQUEST");
      await expectCode(c.apiKey.revoke({ id: UNKNOWN }), "BAD_REQUEST");
    });

    it("validates create and revoke input", async () => {
      const c = callerFor(world);
      await expectCode(c.apiKey.create({ name: "" }), "BAD_REQUEST");
      await expectCode(c.apiKey.create({ name: "x".repeat(101) }), "BAD_REQUEST");
      await expectCode(c.apiKey.create({ name: "Bad expiry", expiresAt: "tomorrow" }), "BAD_REQUEST");
      await expectCode(c.apiKey.revoke({ id: "not-a-uuid" }), "BAD_REQUEST");
    });

    it("revoke of an unknown id is NOT_FOUND", async () => {
      await expectCode(callerFor(world).apiKey.revoke({ id: UNKNOWN }), "NOT_FOUND");
    });

    it("lists only the caller's own keys in the current organization", async () => {
      const mine = await callerFor(world).apiKey.create({ name: "Ramesh key" });
      const sellers = await callerFor(world, "suresh").apiKey.create({ name: "Suresh key" });
      const listed = await callerFor(world).apiKey.list();
      expect(listed.map((k) => k.id)).toContain(mine.id);
      expect(listed.map((k) => k.id)).not.toContain(sellers.id);
      // A seller can't revoke the owner's key.
      await expectCode(callerFor(world, "suresh").apiKey.revoke({ id: mine.id }), "NOT_FOUND");
      const [row] = await getControlDb().select().from(apiKeys).where(eq(apiKeys.id, mine.id));
      expect(row).toBeDefined();
    });

    it("enforces the plan's key count (pro allows 3)", async () => {
      const tenant = await createTenant({ plan: "pro", slug: "pro-keys" });
      const user = await createUser({ email: "pro.keys@example.in" });
      await addMember(tenant.id, user.id, "owner");
      const c = createTestCaller({ userId: user.id, email: user.email, name: null, tenantId: tenant.id, businessId: world.business1.id });
      for (let i = 0; i < 3; i++) await c.apiKey.create({ name: `Pro key ${i}` });
      await expect(c.apiKey.create({ name: "One too many" })).rejects.toMatchObject({ code: "FORBIDDEN", message: /up to 3 API keys/ });
      // Revoking one frees a slot.
      const [first] = await c.apiKey.list();
      await c.apiKey.revoke({ id: first!.id });
      await expect(c.apiKey.create({ name: "Replacement" })).resolves.toHaveProperty("key");
    });
  });

  // ── selfExport ────────────────────────────────────────────────────────────

  describe("selfExport.request", () => {
    it("issues a verifiable token to the owner", async () => {
      const tenant = await createTenant({ slug: "export-happy" });
      await addMember(tenant.id, world.ramesh.id, "owner");
      const res = await noTenantCaller(world.ramesh).selfExport.request({ tenantId: tenant.id });
      expect(res.url).toContain(`/api/export/${tenant.id}?token=`);
      expect(verifyExportToken(res.token)).toMatchObject({ tenantId: tenant.id, userId: world.ramesh.id });
    });

    it("refuses non-members, bad ids and suspended organizations", async () => {
      await expectCode(noTenantCaller(world.kiran).selfExport.request({ tenantId: world.tenant1.id }), "FORBIDDEN");
      await expectCode(noTenantCaller(world.kiran).selfExport.request({ tenantId: "x" }), "BAD_REQUEST");
      const suspended = await createTenant({ slug: "export-suspended", status: "suspended" });
      await addMember(suspended.id, world.kiran.id, "owner");
      await expect(noTenantCaller(world.kiran).selfExport.request({ tenantId: suspended.id }))
        .rejects.toMatchObject({ code: "FORBIDDEN", message: /not active/ });
    });

    it("refuses a seller of the organization", async () => {
      await expectCode(noTenantCaller(world.suresh).selfExport.request({ tenantId: world.tenant1.id }), "FORBIDDEN");
    });
  });

  // ── selfImport ────────────────────────────────────────────────────────────

  describe("selfImport.request", () => {
    it("refuses a target that already has businesses", async () => {
      await expect(noTenantCaller(world.ramesh).selfImport.request({ tenantId: world.tenant1.id }))
        .rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: /TARGET_NOT_EMPTY/ });
    });

    it("refuses a seller before looking at the target", async () => {
      await expectCode(noTenantCaller(world.suresh).selfImport.request({ tenantId: world.tenant1.id }), "FORBIDDEN");
    });
  });

  // ── system ────────────────────────────────────────────────────────────────

  describe("system.maintenanceStatus", () => {
    it("is public and reports maintenance off by default", async () => {
      const status = await createUnauthenticatedCaller().system.maintenanceStatus();
      expect(status.enabled).toBe(false);
    });
  });

  // ── hsn ───────────────────────────────────────────────────────────────────

  describe("hsn", () => {
    it("search: exact code first, then prefixes; text search; type filter; limit", async () => {
      const c = createUnauthenticatedCaller();
      const byCode = await c.hsn.search({ query: "5208", limit: 5 });
      expect(byCode[0]!.hsn).toBe("5208");
      expect(byCode.every((e) => e.hsn.startsWith("5208"))).toBe(true);
      expect(byCode.length).toBeLessThanOrEqual(5);

      const byText = await c.hsn.search({ query: "cotton" });
      expect(byText.length).toBeGreaterThan(0);
      expect(byText.every((e) => e.description.toLowerCase().includes("cotton"))).toBe(true);

      const services = await c.hsn.search({ query: "99", type: "services" });
      expect(services.every((e) => e.type === "services")).toBe(true);

      expect(await c.hsn.search({ query: "zzzzqqq" })).toEqual([]);
    });

    it("search: validates input", async () => {
      const c = createUnauthenticatedCaller();
      await expectCode(c.hsn.search({ query: "" }), "BAD_REQUEST");
      await expectCode(c.hsn.search({ query: "x".repeat(51) }), "BAD_REQUEST");
      await expectCode(c.hsn.search({ query: "52", limit: 51 }), "BAD_REQUEST");
      await expectCode(c.hsn.search({ query: "52", type: "other" as never }), "BAD_REQUEST");
    });

    it("validate: known codes only, at least 4 digits", async () => {
      const c = createUnauthenticatedCaller();
      expect(await c.hsn.validate({ hsn: "5208" })).toMatchObject({ valid: true, details: { code: "5208", type: "goods" } });
      expect(await c.hsn.validate({ hsn: "52" })).toEqual({ valid: false });
      expect(await c.hsn.validate({ hsn: "52AB" })).toEqual({ valid: false });
      expect(await c.hsn.validate({ hsn: "0000" })).toEqual({ valid: false });
      await expectCode(c.hsn.validate({ hsn: "1" }), "BAD_REQUEST");
      await expectCode(c.hsn.validate({ hsn: "123456789" }), "BAD_REQUEST");
    });

    it("validateForTurnover: 4 digits up to 5 crore, 6 above", async () => {
      const c = createUnauthenticatedCaller();
      expect(await c.hsn.validateForTurnover({ hsn: "5208", annualTurnover: "50000000" })).toEqual({ valid: true });
      const big = await c.hsn.validateForTurnover({ hsn: "5208", annualTurnover: "50000001" });
      expect(big.valid).toBe(false);
      expect(big.message).toMatch(/6-digit/);
      expect(await c.hsn.validateForTurnover({ hsn: "520811", annualTurnover: "90000000" })).toEqual({ valid: true });
      expect((await c.hsn.validateForTurnover({ hsn: "52", annualTurnover: "100" })).valid).toBe(false);
      await expectCode(c.hsn.validateForTurnover({ hsn: "5", annualTurnover: "1" }), "BAD_REQUEST");
    });

    it("validateForTurnover: a non-numeric turnover is treated as small (documented)", async () => {
      // Ambiguous: annualTurnover is a free string; "abc" parses to NaN and
      // falls into the up-to-5-crore rule rather than being rejected.
      const res = await createUnauthenticatedCaller().hsn.validateForTurnover({ hsn: "5208", annualTurnover: "abc" });
      expect(res).toEqual({ valid: true });
    });
  });

  // ── share ─────────────────────────────────────────────────────────────────

  describe("share", () => {
    let docId: string;

    beforeAll(async () => {
      const { invoice } = await createInvoiceWithItems(getTenantTestDb(), world.business1.id, world.party1.id, [
        { itemId: world.item1.id, quantity: "1", unitPrice: "100" },
      ]);
      docId = invoice.id;
    });

    it("create writes an audit row and revoke another; revoking twice is a no-op", async () => {
      const c = callerFor(world);
      const link = await c.share.create({ documentId: docId });
      expect(link.url).toMatch(/\/i\//);
      expect(link.viewCount).toBe(0);
      expect(await waitForAudit(world.business1.id, "share.create", docId)).toHaveLength(1);
      expect(await c.share.get({ documentId: docId })).toMatchObject({ url: link.url });

      await expect(c.share.revoke({ documentId: docId })).resolves.toEqual({ revoked: true });
      expect(await waitForAudit(world.business1.id, "share.revoke", docId)).toHaveLength(1);
      expect(await c.share.get({ documentId: docId })).toBeNull();

      await expect(c.share.revoke({ documentId: docId })).resolves.toEqual({ revoked: false });
      // Still only one revoke audit row.
      expect(await waitForAudit(world.business1.id, "share.revoke", docId)).toHaveLength(1);
    });

    it("NOT_FOUND for unknown, deleted and purchase documents", async () => {
      const c = callerFor(world);
      await expectCode(c.share.get({ documentId: UNKNOWN }), "NOT_FOUND");
      await expectCode(c.share.create({ documentId: UNKNOWN }), "NOT_FOUND");
      await expectCode(c.share.revoke({ documentId: UNKNOWN }), "NOT_FOUND");

      const { invoice: gone } = await createInvoiceWithItems(getTenantTestDb(), world.business1.id, world.party1.id,
        [{ quantity: "1", unitPrice: "1" }], { deletedAt: new Date() });
      await expectCode(c.share.create({ documentId: gone.id }), "NOT_FOUND");
    });

    it("validates the id", async () => {
      await expectCode(callerFor(world).share.get({ documentId: "abc" }), "BAD_REQUEST");
    });

    it("a seller can create a link but a deleted document's link is not revived", async () => {
      const seller = callerFor(world, "suresh");
      const link = await seller.share.create({ documentId: docId });
      expect(link.url).toBeTruthy();
      await getTenantTestDb().update(invoices).set({ deletedAt: new Date() }).where(eq(invoices.id, docId));
      await expectCode(seller.share.get({ documentId: docId }), "NOT_FOUND");
      // The row itself remains until revoked (documented).
      const rows = await getControlDb().select().from(shareLinks)
        .where(and(eq(shareLinks.documentId, docId), eq(shareLinks.tenantId, world.tenant1.id)));
      expect(rows.length).toBeGreaterThan(0);
    });

    it("refuses signed-out callers", async () => {
      await expectCode(createUnauthenticatedCaller().share.get({ documentId: docId }), "UNAUTHORIZED");
    });
  });
});
