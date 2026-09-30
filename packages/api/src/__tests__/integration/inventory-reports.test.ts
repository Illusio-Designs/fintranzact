/**
 * Inventory reports: stock ledger, movement summary, godown summary, ageing,
 * reorder status and dead stock.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { truncateAllTables } from "../helpers/test-db.js";
import { createTestWorld, type TestWorld } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";

let world: TestWorld;

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
const now = () => new Date().toISOString();

function line(itemId: string, quantity: string, unitPrice = "100") {
  return { itemId, itemName: "Line", quantity, unitPrice, taxPercent: "0", discountPercent: "0" };
}

function invoice(type: "sale" | "purchase", date: string, itemId: string, quantity: string) {
  return caller().invoice.create({ partyId: world.party1.id, type, invoiceDate: date, lineItems: [line(itemId, quantity)] } as never);
}

let moving: string; // bought and sold recently
let idle: string; // bought long ago, never sold
let low: string; // below its reorder level

beforeAll(async () => {
  world = await createTestWorld();
  const make = (name: string, extra: Record<string, string> = {}) =>
    caller().item.create({ name, unit: "pcs", stockQuantity: "0", purchasePrice: "100", salePrice: "150", ...extra } as never);

  moving = (await make("Moving item")).id;
  await invoice("purchase", daysAgo(20), moving, "30");
  await invoice("sale", daysAgo(10), moving, "12");
  await invoice("sale", daysAgo(2), moving, "3");

  idle = (await make("Idle item")).id;
  await invoice("purchase", daysAgo(200), idle, "8");

  low = (await make("Low item", { lowStockAlert: "10" })).id;
  await invoice("purchase", daysAgo(40), low, "12");
  await invoice("sale", daysAgo(5), low, "9");
});

afterAll(async () => {
  await truncateAllTables();
});

describe("inventoryReports.stockLedger", () => {
  it("lists movements with opening and running balance", async () => {
    const res = await caller().inventoryReports.stockLedger({ itemId: moving, fromDate: daysAgo(15), toDate: now() });
    expect(res.opening).toBe(30);
    expect(res.lines.map((l) => l.outward)).toEqual([12, 3]);
    expect(res.lines.map((l) => l.balance)).toEqual([18, 15]);
    expect(res.closing).toBe(15);
    expect(res.lines[0]!.particulars).toMatch(/^Sale /);
    expect(res.lines[0]!.party).toBeTruthy();
  });
});

describe("inventoryReports.movementSummary", () => {
  it("gives opening, inward, outward and closing per item", async () => {
    const res = await caller().inventoryReports.movementSummary({ fromDate: daysAgo(25), toDate: now() });
    const row = res.data.find((r) => r.itemId === moving)!;
    expect(row).toMatchObject({ opening: 0, inward: 30, outward: 15, closing: 15 });
    expect(row.closingValue).toBe(1500);
  });
});

describe("inventoryReports.godownSummary", () => {
  it("totals stock value per warehouse", async () => {
    const res = await caller().inventoryReports.godownSummary();
    const total = res.data.reduce((s, w) => s + w.value, 0);
    expect(total).toBeCloseTo(res.totalValue, 2);
    expect(res.data.some((w) => w.itemCount >= 3)).toBe(true);
  });
});

describe("inventoryReports.ageing", () => {
  it("puts stock in buckets by how long it has been held", async () => {
    const res = await caller().inventoryReports.ageing();
    const idleRow = res.data.find((r) => r.itemId === idle)!;
    expect(idleRow.buckets[4]!.quantity).toBe(8); // over 180 days
    const movingRow = res.data.find((r) => r.itemId === moving)!;
    expect(movingRow.buckets[0]!.quantity).toBe(15); // bought 20 days ago
  });
});

describe("inventoryReports.reorderStatus", () => {
  it("lists items at or below their reorder level with a suggested order", async () => {
    const res = await caller().inventoryReports.reorderStatus({ coverDays: 30 });
    const row = res.data.find((r) => r.itemId === low)!;
    expect(row.onHand).toBe(3);
    expect(row.shortfall).toBe(7);
    // 7 short + 30 days × (9 sold / 30 days)
    expect(row.suggestedOrder).toBe(16);
    expect(res.data.find((r) => r.itemId === moving)).toBeUndefined();
  });
});

describe("inventoryReports.deadStock", () => {
  it("lists stock not sold in the window", async () => {
    const res = await caller().inventoryReports.deadStock({ days: 90 });
    const ids = res.data.map((r) => r.itemId);
    expect(ids).toContain(idle);
    expect(ids).not.toContain(moving);
    expect(res.data.find((r) => r.itemId === idle)!.lastSold).toBeNull();
  });
});
