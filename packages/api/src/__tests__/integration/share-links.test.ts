/**
 * Public share links: one live link per document, copied again rather than
 * re-minted, revoked links stop resolving, and a business cannot share a
 * document that is not its own.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { controlDb, shareLinks, tenants } from "@fintranzact/db";
import { getTenantTestDb, truncateAllTables } from "../helpers/test-db.js";
import { createInvoiceWithItems, createTestWorld, type TestWorld } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { hashShareToken, resolveShareToken } from "../../lib/share-links.js";

let world: TestWorld;
let invoiceId: string;
let otherInvoiceId: string;
let purchaseId: string;

function callerFor(user: TestWorld["ramesh"], tenantId: string, businessId: string) {
  return createTestCaller({ userId: user.id, email: user.email, name: user.name ?? null, tenantId, businessId });
}
const owner = () => callerFor(world.ramesh, world.tenant1.id, world.business1.id);
const seller = () => callerFor(world.suresh, world.tenant1.id, world.business1.id);
const otherOwner = () => callerFor(world.kiran, world.tenant2.id, world.business2.id);

const tokenOf = (url: string) => url.split("/i/")[1]!;

beforeAll(async () => {
  world = await createTestWorld();
  const db = getTenantTestDb();
  const line = [{ itemId: world.item1.id, itemName: "Cotton", quantity: "2", unitPrice: "250", taxPercent: "5" }];
  invoiceId = (await createInvoiceWithItems(db, world.business1.id, world.party1.id, line)).invoice.id;
  otherInvoiceId = (
    await createInvoiceWithItems(db, world.business2.id, world.party2.id, [
      { itemId: world.item2.id, itemName: "Incense", quantity: "1", unitPrice: "120" },
    ])
  ).invoice.id;
  purchaseId = (await createInvoiceWithItems(db, world.business1.id, world.party1.id, line, { type: "purchase" })).invoice.id;
});

afterAll(async () => {
  await truncateAllTables();
});

describe("share links", () => {
  it("has no link until one is made", async () => {
    expect(await owner().share.get({ documentId: invoiceId })).toBeNull();
  });

  it("makes one link and hands the same one back after that", async () => {
    const first = await owner().share.create({ documentId: invoiceId });
    expect(first.url).toMatch(/\/i\/[A-Za-z0-9_-]{43}$/);
    expect(first.viewCount).toBe(0);

    const again = await seller().share.create({ documentId: invoiceId });
    expect(again.url).toBe(first.url);
    expect((await owner().share.get({ documentId: invoiceId }))?.url).toBe(first.url);
  });

  it("keeps only a hash of the token for lookup", async () => {
    const link = await owner().share.get({ documentId: invoiceId });
    const token = tokenOf(link!.url);
    const [row] = await controlDb.select().from(shareLinks).where(eq(shareLinks.documentId, invoiceId));
    expect(row!.tokenHash).toBe(hashShareToken(token));
    expect(row!.tokenHash).not.toContain(token);
  });

  it("resolves a live token to its document", async () => {
    const link = await owner().share.get({ documentId: invoiceId });
    const resolved = await resolveShareToken(tokenOf(link!.url));
    expect(resolved).toMatchObject({
      tenantId: world.tenant1.id,
      businessId: world.business1.id,
      documentId: invoiceId,
    });
  });

  it("rejects malformed and unknown tokens", async () => {
    expect(await resolveShareToken("short")).toBeNull();
    expect(await resolveShareToken("../../etc/passwd")).toBeNull();
    expect(await resolveShareToken("A".repeat(43))).toBeNull();
  });

  it("stops resolving while the tenant is suspended", async () => {
    const link = await owner().share.get({ documentId: invoiceId });
    const token = tokenOf(link!.url);
    await controlDb.update(tenants).set({ status: "suspended" }).where(eq(tenants.id, world.tenant1.id));
    try {
      expect(await resolveShareToken(token)).toBeNull();
    } finally {
      await controlDb.update(tenants).set({ status: "active" }).where(eq(tenants.id, world.tenant1.id));
    }
    expect(await resolveShareToken(token)).not.toBeNull();
  });

  it("will not share or show another business's document", async () => {
    await expect(owner().share.create({ documentId: otherInvoiceId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(owner().share.get({ documentId: otherInvoiceId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(otherOwner().share.revoke({ documentId: invoiceId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("only shares sales-side documents", async () => {
    await expect(owner().share.create({ documentId: purchaseId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("turning a link off kills it, and sharing again makes a new one", async () => {
    const before = await owner().share.get({ documentId: invoiceId });
    const oldToken = tokenOf(before!.url);

    expect(await owner().share.revoke({ documentId: invoiceId })).toEqual({ revoked: true });
    expect(await resolveShareToken(oldToken)).toBeNull();
    expect(await owner().share.get({ documentId: invoiceId })).toBeNull();
    expect(await owner().share.revoke({ documentId: invoiceId })).toEqual({ revoked: false });

    const fresh = await owner().share.create({ documentId: invoiceId });
    expect(fresh.url).not.toBe(before!.url);
    expect(await resolveShareToken(tokenOf(fresh.url))).not.toBeNull();
  });
});
