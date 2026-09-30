/**
 * Warehouse stock: balances by warehouse, transfers, adjustments and physical
 * stock verification — and that the item total, the warehouse balances and
 * the logs stay consistent through all of them.
 *
 * Items created by the fixtures carry 100 units of "unplaced" stock (set on
 * the item, no warehouse balance), like opening stock and imports do in real
 * data. Reads show it in the default warehouse; the first write moves it there.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { items, stockBalances } from "@fintranzact/db";
import { getTenantTestDb, truncateAllTables } from "../helpers/test-db.js";
import { createTestWorld, type TestWorld } from "../helpers/fixtures.js";
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

async function itemTotal() {
  const [row] = await getTenantTestDb()
    .select({ qty: items.stockQuantity })
    .from(items)
    .where(eq(items.id, world.item1.id));
  return Number(row!.qty);
}

async function balanceAt(warehouseId: string) {
  const [row] = await getTenantTestDb()
    .select({ qty: sql<string>`COALESCE(SUM(${stockBalances.quantity}::numeric), 0)::text` })
    .from(stockBalances)
    .where(and(eq(stockBalances.warehouseId, warehouseId), eq(stockBalances.itemId, world.item1.id)));
  return Number(row!.qty);
}

async function placedTotal() {
  const [row] = await getTenantTestDb()
    .select({ qty: sql<string>`COALESCE(SUM(${stockBalances.quantity}::numeric), 0)::text` })
    .from(stockBalances)
    .where(eq(stockBalances.itemId, world.item1.id));
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

describe("stock.warehouses / stock.balances", () => {
  it("shows unplaced stock in the default warehouse without writing anything", async () => {
    const whs = await ownerCaller().stock.warehouses();
    const main = whs.find((w) => w.id === mainId)!;
    expect(main.isDefault).toBe(true);
    expect(Number(main.quantity)).toBe(100);
    expect(Number(whs.find((w) => w.id === puneId)!.quantity)).toBe(0);

    const { data } = await ownerCaller().stock.balances({ page: 1, limit: 50 });
    const row = data.find((r) => r.itemId === world.item1.id)!;
    expect(Number(row.byWarehouse[mainId])).toBe(100);
    expect(await placedTotal()).toBe(0); // read path did not write
  });
});

describe("stock.transfer", () => {
  it("moves stock between warehouses without changing the item total", async () => {
    await ownerCaller().stock.transfer({
      sourceWarehouseId: mainId,
      destinationWarehouseId: puneId,
      lines: [{ itemId: world.item1.id, quantity: "30" }],
    });
    expect(await itemTotal()).toBe(100);
    expect(await balanceAt(mainId)).toBe(70);
    expect(await balanceAt(puneId)).toBe(30);
    expect(await placedTotal()).toBe(100);
  });

  it("lists the transfer in the journal with both warehouses", async () => {
    const { data, total } = await ownerCaller().stock.transfers({ page: 1, limit: 20 });
    expect(total).toBe(1);
    expect(data[0]!.sourceName).toBe("Main warehouse");
    expect(data[0]!.destinationName).toBe("Pune godown");
    expect(Number(data[0]!.totalQuantity)).toBe(30);
    expect(data[0]!.lines[0]!.name).toBe(world.item1.name);
  });

  it("refuses to move more than the source warehouse holds", async () => {
    await expect(
      ownerCaller().stock.transfer({
        sourceWarehouseId: puneId,
        destinationWarehouseId: mainId,
        lines: [{ itemId: world.item1.id, quantity: "31" }],
      }),
    ).rejects.toThrow(/Not enough stock/);
    expect(await balanceAt(puneId)).toBe(30);
  });

  it("refuses the same warehouse on both sides", async () => {
    await expect(
      ownerCaller().stock.transfer({
        sourceWarehouseId: mainId,
        destinationWarehouseId: mainId,
        lines: [{ itemId: world.item1.id, quantity: "1" }],
      }),
    ).rejects.toThrow(/different warehouses/);
  });

  it("is not available to a seller", async () => {
    await expect(
      sellerCaller().stock.transfer({
        sourceWarehouseId: mainId,
        destinationWarehouseId: puneId,
        lines: [{ itemId: world.item1.id, quantity: "1" }],
      }),
    ).rejects.toThrow();
  });
});

describe("stock.adjust", () => {
  it("changes the chosen warehouse and the item total, and logs it", async () => {
    await ownerCaller().stock.adjust({
      warehouseId: puneId,
      reason: "Damaged in transit",
      lines: [{ itemId: world.item1.id, quantity: "-5" }],
    });
    expect(await itemTotal()).toBe(95);
    expect(await balanceAt(puneId)).toBe(25);

    const { data } = await ownerCaller().stock.adjustments({ kind: "all", page: 1, limit: 20 });
    expect(data[0]!.warehouseName).toBe("Pune godown");
    expect(data[0]!.reason).toBe("Damaged in transit");
    expect(Number(data[0]!.quantity)).toBe(-5);
    expect(data[0]!.physical).toBe(false);
  });

  it("won't take a warehouse below zero", async () => {
    await expect(
      ownerCaller().stock.adjust({
        warehouseId: puneId,
        reason: "Write-off",
        lines: [{ itemId: world.item1.id, quantity: "-26" }],
      }),
    ).rejects.toThrow(/Only 25/);
  });
});

describe("stock.verify — physical stock", () => {
  it("adjusts only the difference between counted and book stock", async () => {
    const result = await ownerCaller().stock.verify({
      warehouseId: mainId,
      note: "Quarter-end count",
      counts: [{ itemId: world.item1.id, counted: "68" }],
    });
    expect(result).toEqual({ checked: 1, adjusted: 1 });
    expect(await balanceAt(mainId)).toBe(68);
    expect(await itemTotal()).toBe(93);

    const { data } = await ownerCaller().stock.adjustments({ kind: "physical", page: 1, limit: 20 });
    expect(data).toHaveLength(1);
    expect(Number(data[0]!.quantity)).toBe(-2);
    expect(data[0]!.reason).toBe("Physical stock verification: Quarter-end count");
  });

  it("makes no adjustment when the count matches", async () => {
    const result = await ownerCaller().stock.verify({
      warehouseId: mainId,
      counts: [{ itemId: world.item1.id, counted: "68" }],
    });
    expect(result).toEqual({ checked: 1, adjusted: 0 });
  });
});

describe("item.adjustStock — the item page's adjust button", () => {
  it("now also moves the default adjustment warehouse, keeping balances in step", async () => {
    await ownerCaller().item.adjustStock({ itemId: world.item1.id, quantity: "7", reason: "Found in store room" });
    expect(await itemTotal()).toBe(100);
    expect(await balanceAt(mainId)).toBe(75);
    expect(await placedTotal()).toBe(await itemTotal());
  });
});
