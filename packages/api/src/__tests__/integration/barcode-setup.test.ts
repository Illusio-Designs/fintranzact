/**
 * Barcode setup (type + barcodes-per-item, locked once chosen), extra item
 * codes with pack quantities, purchases received into a chosen warehouse, and
 * physical stock counted by scanning with a report at the end.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { items, stockBalances } from "@fintranzact/db";
import { getTenantTestDb, truncateAllTables } from "../helpers/test-db.js";
import { createItem, createTestWorld, type TestWorld } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { ensureDefaultWarehouse } from "../../lib/inventory-service.js";

let world: TestWorld;
let mainId: string;
let puneId: string;

function ownerCaller() {
  return createTestCaller({
    userId: world.ramesh.id,
    email: world.ramesh.email,
    name: world.ramesh.name ?? null,
    tenantId: world.tenant1.id,
    businessId: world.business1.id,
  });
}

function sellerCaller() {
  return createTestCaller({
    userId: world.suresh.id,
    email: world.suresh.email,
    name: world.suresh.name ?? null,
    tenantId: world.tenant1.id,
    businessId: world.business1.id,
  });
}

async function balanceAt(warehouseId: string, itemId: string) {
  const [row] = await getTenantTestDb()
    .select({ qty: sql<string>`COALESCE(SUM(${stockBalances.quantity}::numeric), 0)::text` })
    .from(stockBalances)
    .where(and(eq(stockBalances.warehouseId, warehouseId), eq(stockBalances.itemId, itemId)));
  return Number(row!.qty);
}

beforeAll(async () => {
  world = await createTestWorld();
  const settings = await ensureDefaultWarehouse(getTenantTestDb(), world.business1.id);
  mainId = settings.salesWarehouseId as string;
  const caller = ownerCaller();
  const [main] = await caller.warehouse.warehouseList();
  const pune = await caller.warehouse.warehouseCreate({
    premiseId: main!.premiseId,
    name: "Pune godown",
    code: "PUNE",
    warehouseType: "godown",
  });
  puneId = pune.id;
});

afterAll(async () => {
  await truncateAllTables();
});

describe("barcode setup", () => {
  it("starts unlocked with EAN-13, one code per item, and its fixed label", async () => {
    const setup = await ownerCaller().barcode.setup();
    expect(setup).toMatchObject({ enabled: true, type: "ean13", mode: "single", lockedAt: null });
    expect(setup.label).toEqual({ width: 50, height: 25, across: 1 });
  });

  it("only admins can change it", async () => {
    await expect(sellerCaller().barcode.update({ type: "qr" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("locks type and mode for good", async () => {
    const caller = ownerCaller();
    const locked = await caller.barcode.lock({ type: "code128", mode: "multi" });
    expect(locked).toMatchObject({ type: "code128", mode: "multi" });
    expect(locked.lockedAt).not.toBeNull();
    expect(locked.label).toEqual({ width: 75, height: 25, across: 1 });

    await expect(caller.barcode.update({ type: "ean13" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.barcode.lock({ type: "ean13", mode: "single" })).rejects.toMatchObject({ code: "CONFLICT" });

    // On/off still changes after locking.
    await caller.barcode.update({ enabled: false });
    expect((await caller.barcode.setup()).enabled).toBe(false);
    await caller.barcode.update({ enabled: true });
  });
});

describe("extra codes (many per item)", () => {
  it("adds a box code that scans as 12 pieces", async () => {
    const caller = ownerCaller();
    await caller.item.update({ id: world.item1.id, data: { barcode: "8901234567890" } });
    await caller.barcode.addItemCode({ itemId: world.item1.id, code: "2000000000046", packQty: "12", label: "Box of 12" });

    const box = await caller.item.lookupByCode({ code: "2000000000046" });
    expect(box).toMatchObject({ packQty: 12, item: { id: world.item1.id } });
    const unit = await caller.item.lookupByCode({ code: "8901234567890" });
    expect(unit).toMatchObject({ packQty: 1, item: { id: world.item1.id } });
  });

  it("refuses a code another item already uses", async () => {
    const caller = ownerCaller();
    const other = await createItem(getTenantTestDb(), world.business1.id, { name: "Hose clamp", barcode: "HC-12" });
    await expect(
      caller.barcode.addItemCode({ itemId: world.item1.id, code: "HC-12" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      caller.item.update({ id: other.id, data: { barcode: "2000000000046" } }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("purchase into a chosen warehouse", () => {
  it("receives stock at the picked warehouse and creates a Code 128 code from the SKU", async () => {
    const caller = ownerCaller();
    const pipe = await createItem(getTenantTestDb(), world.business1.id, {
      name: "Steel pipe",
      sku: "SP-25",
      stockQuantity: "0.000",
    });
    const before = await balanceAt(puneId, pipe.id);
    const invoice = await caller.invoice.create({
      partyId: world.party1.id,
      type: "purchase",
      invoiceDate: new Date().toISOString(),
      warehouseId: puneId,
      lineItems: [{ itemId: pipe.id, itemName: "Steel pipe", quantity: "20", unitPrice: "100", taxPercent: "0", discountPercent: "0" }],
    });
    expect(invoice.warehouseId).toBe(puneId);
    expect(await balanceAt(puneId, pipe.id)).toBe(before + 20);
    expect(await balanceAt(mainId, pipe.id)).toBe(0);

    const [row] = await getTenantTestDb().select({ barcode: items.barcode }).from(items).where(eq(items.id, pipe.id));
    expect(row!.barcode).toBe("SP-25");
  });

  it("rejects a warehouse from another business", async () => {
    await expect(
      ownerCaller().invoice.create({
        partyId: world.party1.id,
        type: "purchase",
        warehouseId: "00000000-0000-4000-8000-000000000000",
        lineItems: [{ itemId: world.item1.id, itemName: "x", quantity: "1", unitPrice: "1", taxPercent: "0", discountPercent: "0" }],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("physical stock by scanning", () => {
  it("reports matched, short, missing and unknown codes, then posts the differences", async () => {
    const caller = ownerCaller();
    const db = getTenantTestDb();
    const gauge = await createItem(db, world.business1.id, { name: "Pressure gauge", barcode: "PG-1", stockQuantity: "6.000" });
    await createItem(db, world.business1.id, { name: "Teflon tape", stockQuantity: "4.000" }); // no barcode

    const sheet = await caller.stock.countSheet({ warehouseId: mainId });
    expect(sheet.units.find((u) => u.itemId === world.item1.id)?.codes).toEqual(
      expect.arrayContaining([{ code: "2000000000046", packQty: 12 }]),
    );
    expect(sheet.noBarcode.map((u) => u.name)).toContain("Teflon tape");

    // item1 has 100 in books: 8 boxes of 12 + 1 piece = 97 → short by 3.
    // Pressure gauge is never scanned → missing.
    const scans = [
      { code: "2000000000046", count: 8 },
      { code: "8901234567890", count: 1 },
      { code: "8907777000001", count: 2 },
    ];
    const report = await caller.stock.countPreview({ warehouseId: mainId, scans });
    const cotton = report.lines.find((l) => l.itemId === world.item1.id)!;
    expect(cotton).toMatchObject({ books: "100.000", scanned: "97.000" });
    expect(report.lines.find((l) => l.itemId === gauge.id)).toMatchObject({ books: "6.000", scanned: "0.000" });
    expect(report.unknownCodes).toEqual([{ code: "8907777000001", count: 2 }]);
    expect(report.notCounted.map((u) => u.name)).toContain("Teflon tape");

    const saved = await caller.stock.countFinish({ warehouseId: mainId, startedAt: new Date().toISOString(), scans });
    expect(saved.adjusted).toBe(0);
    expect(await balanceAt(mainId, gauge.id)).toBe(0); // nothing posted, nothing placed

    const posted = await caller.stock.countPost({ id: saved.id });
    expect(posted.adjusted).toBeGreaterThanOrEqual(2);
    expect(await balanceAt(mainId, world.item1.id)).toBe(97);
    expect(await balanceAt(mainId, gauge.id)).toBe(0);
    const [g] = await db.select({ qty: items.stockQuantity }).from(items).where(eq(items.id, gauge.id));
    expect(Number(g!.qty)).toBe(0);

    await expect(caller.stock.countPost({ id: saved.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const list = await caller.stock.counts({ page: 1, limit: 10 });
    expect(list.data[0]).toMatchObject({ status: "posted", unknownCount: 1 });
  });

  it("is unavailable while barcodes are off", async () => {
    const caller = ownerCaller();
    await caller.barcode.update({ enabled: false });
    await expect(caller.stock.countSheet({ warehouseId: mainId })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await caller.barcode.update({ enabled: true });
  });
});
