/**
 * Router gaps: batch.* and inventoryReports.batchStock — validation,
 * unknown and foreign ids, permissions and scoping. batches.test.ts covers
 * the stock behaviour.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createTestWorld, type TestWorld } from "../helpers/fixtures.js";
import { callerFor, expectCode, waitForAudit } from "../helpers/assertions.js";
import { ensureDefaultWarehouse } from "../../lib/inventory-service.js";
import { businessDay } from "../../lib/batches.js";

let world: TestWorld;
const UNKNOWN = "00000000-0000-4000-8000-000000000000";
const caller = () => callerFor(world, "ramesh");
const seller = () => callerFor(world, "suresh");
const other = () => callerFor(world, "kiran");
let itemId: string;

function day(n: number) {
  const d = new Date(`${businessDay()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

beforeAll(async () => {
  world = await createTestWorld();
  await ensureDefaultWarehouse(getTenantTestDb(), world.business1.id);
  itemId = (await caller().item.create({
    name: "Batch gap syrup", unit: "pcs", salePrice: "100", purchasePrice: "60", trackBatches: true, trackExpiry: true,
  } as never)).id;
  await caller().invoice.create({
    partyId: world.party1.id, type: "purchase", invoiceDate: new Date().toISOString(),
    lineItems: [
      { itemId, itemName: "Syrup", quantity: "5", unitPrice: "60", taxPercent: "0", discountPercent: "0", batchNumber: "SOON", expiryDate: day(10) },
      { itemId, itemName: "Syrup", quantity: "3", unitPrice: "60", taxPercent: "0", discountPercent: "0", batchNumber: "LATER", expiryDate: day(400) },
    ],
  } as never);
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

describe("batch.create / update / delete", () => {
  it("create validates input and needs an expiry on an expiry-tracked item", async () => {
    await expectCode(caller().batch.create({ itemId, batchNumber: " " }), "BAD_REQUEST");
    await expectCode(caller().batch.create({ itemId, batchNumber: "X", expiryDate: "31/12/2030" }), "BAD_REQUEST");
    await expectCode(caller().batch.create({ itemId, batchNumber: "X", expiryDate: day(30), mrp: "abc" }), "BAD_REQUEST");
    await expectCode(caller().batch.create({ itemId, batchNumber: "NO-EXPIRY" }), "BAD_REQUEST");
  });

  it("create refuses unknown and foreign items and a variant of another item", async () => {
    await expectCode(caller().batch.create({ itemId: UNKNOWN, batchNumber: "X", expiryDate: day(30) }), "NOT_FOUND");
    await expectCode(caller().batch.create({ itemId: world.item2.id, batchNumber: "X", expiryDate: day(30) }), "NOT_FOUND");
    await expectCode(caller().batch.create({ itemId, variantId: UNKNOWN, batchNumber: "X", expiryDate: day(30) }), "NOT_FOUND");
  });

  it("update renames with a duplicate check and audits; NOT_FOUND for unknown and foreign batches", async () => {
    const b = await caller().batch.create({ itemId, batchNumber: "HAND-1", expiryDate: day(60) });
    await expectCode(caller().batch.update({ id: b.id, batchNumber: "SOON" }), "CONFLICT");
    const u = await caller().batch.update({ id: b.id, batchNumber: "HAND-2", mrp: "120" });
    expect(u).toMatchObject({ batchNumber: "HAND-2", mrp: "120.00" });
    expect(await waitForAudit(world.business1.id, "batch.update", b.id)).toHaveLength(1);
    await expectCode(caller().batch.update({ id: UNKNOWN, mrp: "1" }), "NOT_FOUND");
    await expectCode(other().batch.update({ id: b.id, mrp: "1" }), "NOT_FOUND");
    await expectCode(caller().batch.update({ id: b.id, expiryDate: "tomorrow" }), "BAD_REQUEST");
  });

  it("delete: NOT_FOUND for unknown and foreign batches; sellers refused", async () => {
    const b = await caller().batch.create({ itemId, batchNumber: "DEL-1", expiryDate: day(60) });
    await expectCode(other().batch.delete({ id: b.id }), "NOT_FOUND");
    await expectCode(seller().batch.delete({ id: b.id }), "FORBIDDEN");
    await expect(caller().batch.delete({ id: b.id })).resolves.toEqual({ success: true });
    await expectCode(caller().batch.delete({ id: b.id }), "NOT_FOUND");
  });

  it("sellers can list batches but not create or change them", async () => {
    await expect(seller().batch.list({ itemId })).resolves.toHaveProperty("data");
    await expectCode(seller().batch.create({ itemId, batchNumber: "S", expiryDate: day(30) }), "FORBIDDEN");
  });
});

describe("batch.list", () => {
  it("lists stock per batch, earliest expiry first; nothing for another business", async () => {
    const r = await caller().batch.list({ itemId });
    expect(r.data.map((b) => [b.batchNumber, b.quantity])).toEqual([["SOON", "5.000"], ["LATER", "3.000"]]);
    expect(r.data[0]!.daysToExpiry).toBe(10);
    expect((await other().batch.list({ itemId })).data).toEqual([]);
    // Judged as of a later date, SOON has expired.
    const later = await caller().batch.list({ itemId, asOf: day(20) });
    expect(later.data[0]).toMatchObject({ batchNumber: "SOON", expired: true });
    await expectCode(caller().batch.list({ itemId, asOf: "soon" }), "BAD_REQUEST");
  });
});

describe("inventoryReports.batchStock", () => {
  it("filters by status, days and search; scoped to the business; validates input", async () => {
    const all = await caller().inventoryReports.batchStock();
    const numbers = JSON.stringify(all);
    expect(numbers).toContain("SOON");
    expect(numbers).toContain("LATER");
    const expiring = JSON.stringify(await caller().inventoryReports.batchStock({ status: "expiring", days: 30 }));
    expect(expiring).toContain("SOON");
    expect(expiring).not.toContain("LATER");
    expect(JSON.stringify(await caller().inventoryReports.batchStock({ status: "expired" }))).not.toContain("SOON");
    expect(JSON.stringify(await caller().inventoryReports.batchStock({ search: "later" }))).not.toContain("SOON");
    expect(JSON.stringify(await other().inventoryReports.batchStock())).not.toContain("SOON");
    await expectCode(caller().inventoryReports.batchStock({ days: 0 }), "BAD_REQUEST");
    await expectCode(caller().inventoryReports.batchStock({ status: "fresh" as never }), "BAD_REQUEST");
  });
});
