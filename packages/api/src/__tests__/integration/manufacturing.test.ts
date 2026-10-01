/**
 * Bills of material and the manufacturing journal: BOM loops are refused,
 * manufacturing moves stock between warehouses, the "block" policy refuses
 * shortages, cancelling reverses, and finished goods are costed from their
 * components (and valued at that cost).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { items, stockBalances } from "@fintranzact/db";
import { getTenantTestDb, truncateAllTables } from "../helpers/test-db.js";
import { createTestWorld, type TestWorld } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { ensureDefaultWarehouse } from "../../lib/inventory-service.js";
import { valueStock, unitKey } from "../../lib/stock-valuation.js";

let world: TestWorld;
let mainId: string;
let factoryId: string;
let flour: string;
let sugar: string;
let cake: string;
let frosting: string;
let cakeBomId: string;

function caller() {
  return createTestCaller({
    userId: world.ramesh.id,
    email: world.ramesh.email,
    name: world.ramesh.name ?? null,
    tenantId: world.tenant1.id,
    businessId: world.business1.id,
  });
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

async function total(itemId: string) {
  const [row] = await getTenantTestDb().select({ qty: items.stockQuantity }).from(items).where(eq(items.id, itemId));
  return Number(row!.qty);
}

async function at(warehouseId: string, itemId: string) {
  const [row] = await getTenantTestDb()
    .select({ qty: sql<string>`COALESCE(SUM(${stockBalances.quantity}::numeric), 0)::text` })
    .from(stockBalances)
    .where(and(eq(stockBalances.warehouseId, warehouseId), eq(stockBalances.itemId, itemId)));
  return Number(row!.qty);
}

async function valued(itemId: string) {
  const v = await valueStock(getTenantTestDb(), world.business1.id, new Date(), "weighted_average");
  return v.units.get(unitKey(itemId, null))!;
}

beforeAll(async () => {
  world = await createTestWorld();
  const settings = await ensureDefaultWarehouse(getTenantTestDb(), world.business1.id);
  mainId = settings.salesWarehouseId as string;
  const c = caller();
  const [main] = await c.warehouse.warehouseList();
  factoryId = (await c.warehouse.warehouseCreate({
    premiseId: main!.premiseId, name: "Factory", code: "FACT", warehouseType: "godown",
  })).id;

  const make = (name: string, stockQuantity: string, purchasePrice: string) =>
    c.item.create({ name, unit: "kg", stockQuantity, purchasePrice, salePrice: "500" } as never);
  flour = (await make("Flour", "0", "40")).id;
  sugar = (await make("Sugar", "50", "20")).id; // opening stock, rate 20
  cake = (await make("Cake", "0", "0")).id;
  frosting = (await make("Frosting", "0", "0")).id;
  // 100 kg flour bought at 50 (the item master's 40 is only for opening stock).
  await c.invoice.create({
    partyId: world.party1.id, type: "purchase", invoiceDate: daysAgo(3),
    lineItems: [{ itemId: flour, itemName: "Flour", quantity: "100", unitPrice: "50", taxPercent: "0", discountPercent: "0" }],
  } as never);
});

afterAll(async () => {
  await truncateAllTables();
});

describe("bill of materials", () => {
  it("creates a BOM, the item's first being its default", async () => {
    const res = await caller().manufacturing.bomCreate({
      itemId: cake,
      name: "Sponge cake",
      outputQuantity: "2",
      components: [
        { itemId: flour, quantity: "1" },
        { itemId: sugar, quantity: "0.5", wastagePercent: "10" },
      ],
    } as never);
    cakeBomId = res.id;
    const bom = await caller().manufacturing.bom({ id: cakeBomId });
    expect(bom.isDefault).toBe(true);
    expect(bom.components.map((c) => c.name)).toEqual(["Flour", "Sugar"]);
    expect(bom.components[1]!.wastagePercent).toBe("10.00");
    const list = await caller().manufacturing.boms({ page: 1, limit: 20 } as never);
    expect(list.data.find((b) => b.id === cakeBomId)?.componentCount).toBe(2);
  });

  it("refuses an item among its own components", async () => {
    await expect(caller().manufacturing.bomCreate({
      itemId: cake, name: "Loop", components: [{ itemId: cake, quantity: "1" }],
    } as never)).rejects.toThrow(/component of itself/);
  });

  it("refuses a loop through another BOM", async () => {
    // Cake is made from flour, so flour can't be made from cake.
    await expect(caller().manufacturing.bomCreate({
      itemId: flour, name: "Flour from cake", components: [{ itemId: cake, quantity: "1" }],
    } as never)).rejects.toThrow(/already used to make/);
  });

  it("refuses a loop several levels deep, and on update", async () => {
    // Frosting ← sugar; a cake BOM that uses frosting; then sugar ← cake loops.
    await caller().manufacturing.bomCreate({
      itemId: frosting, name: "Frosting", components: [{ itemId: sugar, quantity: "1" }],
    } as never);
    const iced = await caller().manufacturing.bomCreate({
      itemId: cake, name: "Iced cake", components: [{ itemId: frosting, quantity: "1" }, { itemId: flour, quantity: "1" }],
    } as never);
    expect((await caller().manufacturing.bom({ id: iced.id })).isDefault).toBe(false);
    await expect(caller().manufacturing.bomCreate({
      itemId: sugar, name: "Sugar from cake", components: [{ itemId: cake, quantity: "1" }],
    } as never)).rejects.toThrow(/already used to make/);

    // Changing the frosting BOM to use cake loops too (cake → frosting → cake).
    const frostingBom = (await caller().manufacturing.boms({ itemId: frosting, page: 1, limit: 5 } as never)).data[0]!;
    await expect(caller().manufacturing.bomUpdate({
      id: frostingBom.id, itemId: frosting, name: "Frosting", components: [{ itemId: cake, quantity: "1" }],
    } as never)).rejects.toThrow(/already used to make/);
    await caller().manufacturing.bomDelete({ id: iced.id });
  });

  it("scales the plan to the quantity, with stock and cost", async () => {
    const plan = await caller().manufacturing.plan({ itemId: cake, quantity: "4", sourceWarehouseId: mainId } as never);
    expect(plan.bom?.id).toBe(cakeBomId);
    const [f, s] = plan.components;
    expect(f!.standardQuantity).toBe("2.000");
    expect(s!.standardQuantity).toBe("1.100"); // 0.5 × 2 + 10%
    expect(Number(f!.available)).toBe(100);
    expect(f!.rate).toBe("50.00");
    expect(plan.componentsCost).toBe("122.00"); // 2×50 + 1.1×20
  });
});

describe("manufacture", () => {
  let journalId: string;

  it("consumes components at the source and produces into the destination", async () => {
    const res = await caller().manufacturing.manufacture({
      bomId: cakeBomId,
      quantity: "4",
      sourceWarehouseId: mainId,
      destinationWarehouseId: factoryId,
      additionalCosts: [{ label: "Labour", amount: "78" }],
    } as never);
    journalId = res.id;
    expect(res.journalNumber).toBe("MJ-1");
    expect(res.componentsCost).toBe("122.00");
    expect(res.totalCost).toBe("200.00");
    expect(res.unitCost).toBe("50.0000");

    expect(await at(mainId, flour)).toBe(98);
    expect(await at(mainId, sugar)).toBeCloseTo(48.9, 3);
    expect(await at(factoryId, cake)).toBe(4);
    expect(await total(flour)).toBe(98);
    expect(await total(cake)).toBe(4);
  });

  it("values the finished goods at their production cost", async () => {
    const v = await valued(cake);
    expect(v.rate).toBe(50);
    expect(v.value).toBe(200);
    // FIFO too: what's on hand is the production run.
    const fifo = await valueStock(getTenantTestDb(), world.business1.id, new Date(), "fifo");
    expect(fifo.units.get(unitKey(cake, null))!.value).toBe(200);
    // Before the run, there was nothing to value.
    const before = await valueStock(getTenantTestDb(), world.business1.id, new Date(daysAgo(1)), "weighted_average");
    expect(before.units.get(unitKey(cake, null))!.value).toBe(0);
    // Components keep their own rate.
    expect((await valued(flour)).rate).toBe(50);
  });

  it("records the journal with its lines", async () => {
    const j = await caller().manufacturing.journal({ id: journalId });
    expect(j.status).toBe("posted");
    expect(j.components).toHaveLength(2);
    expect(j.components.find((c) => c.itemId === sugar)!.quantity).toBe("1.100");
    expect(j.additionalCosts).toEqual([{ label: "Labour", amount: "78.00" }]);
    const list = await caller().manufacturing.journals({ page: 1, limit: 10 } as never);
    expect(list.data[0]!.journalNumber).toBe("MJ-1");
  });

  it("uses edited component quantities", async () => {
    const res = await caller().manufacturing.manufacture({
      bomId: cakeBomId,
      quantity: "2",
      sourceWarehouseId: mainId,
      destinationWarehouseId: factoryId,
      components: [{ itemId: flour, quantity: "1.5" }, { itemId: sugar, quantity: "0" }],
    } as never);
    expect(await at(mainId, flour)).toBe(96.5);
    expect(await at(mainId, sugar)).toBeCloseTo(48.9, 3);
    expect(res.totalCost).toBe("75.00");
    const j = await caller().manufacturing.journal({ id: res.id });
    expect(j.components).toHaveLength(1);
    expect(j.components[0]!.standardQuantity).toBe("1.000");
    // Weighted average over both runs: (200 + 75) / 6.
    expect((await valued(cake)).rate).toBeCloseTo(45.83, 2);
    await caller().manufacturing.cancel({ id: res.id });
  });

  it("refuses a shortage under the block policy, changing nothing", async () => {
    await caller().stock.updateSettings({ negativeStockPolicy: "block" });
    try {
      await expect(caller().manufacturing.manufacture({
        bomId: cakeBomId, quantity: "400", sourceWarehouseId: mainId, destinationWarehouseId: factoryId,
      } as never)).rejects.toThrow(/Not enough stock — Flour: 98 kg available, 200 needed/);
      // Components at the factory: none there.
      await expect(caller().manufacturing.manufacture({
        bomId: cakeBomId, quantity: "2", sourceWarehouseId: factoryId, destinationWarehouseId: factoryId,
      } as never)).rejects.toThrow(/Not enough stock/);
      expect(await at(mainId, flour)).toBe(98);
      expect(await total(cake)).toBe(4);
    } finally {
      await caller().stock.updateSettings({ negativeStockPolicy: "warn" });
    }
  });

  it("labels the movements in the stock ledger", async () => {
    const range = { fromDate: daysAgo(10), toDate: new Date(Date.now() + 60_000).toISOString() };
    const cakeLedger = await caller().inventoryReports.stockLedger({ itemId: cake, ...range });
    expect(cakeLedger.lines.map((l) => l.particulars)).toEqual([
      "Manufactured — journal MJ-1",
      "Manufactured — journal MJ-2",
      "Manufacturing MJ-2 cancelled",
    ]);
    const flourLedger = await caller().inventoryReports.stockLedger({ itemId: flour, ...range });
    expect(flourLedger.lines.some((l) => l.particulars === "Used in manufacturing — journal MJ-1" && l.outward === 2)).toBe(true);
  });

  it("cancel puts everything back and stops counting the cost", async () => {
    await caller().manufacturing.cancel({ id: journalId });
    expect(await at(mainId, flour)).toBe(100);
    expect(await at(mainId, sugar)).toBe(50);
    expect(await at(factoryId, cake)).toBe(0);
    expect(await total(cake)).toBe(0);
    expect((await caller().manufacturing.journal({ id: journalId })).status).toBe("cancelled");
    expect((await valued(cake)).rate).toBe(0);
    await expect(caller().manufacturing.cancel({ id: journalId })).rejects.toThrow(/already cancelled/);
  });

  it("under block, refuses to cancel once the goods made have gone", async () => {
    const res = await caller().manufacturing.manufacture({
      bomId: cakeBomId, quantity: "2", sourceWarehouseId: mainId, destinationWarehouseId: mainId,
    } as never);
    await caller().invoice.create({
      partyId: world.party1.id, type: "sale", invoiceDate: new Date().toISOString(),
      lineItems: [{ itemId: cake, itemName: "Cake", quantity: "2", unitPrice: "500", taxPercent: "0", discountPercent: "0" }],
    } as never);
    await caller().stock.updateSettings({ negativeStockPolicy: "block" });
    try {
      await expect(caller().manufacturing.cancel({ id: res.id })).rejects.toThrow(/already moved on/);
    } finally {
      await caller().stock.updateSettings({ negativeStockPolicy: "warn" });
    }
  });
});
