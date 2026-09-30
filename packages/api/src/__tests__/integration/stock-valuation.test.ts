/**
 * Closing stock valuation and how it reaches the reports: stock summary,
 * P&L (change in inventories / cost of goods sold) and balance sheet.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTenantTestDb, truncateAllTables } from "../helpers/test-db.js";
import { createTestWorld, type TestWorld } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { valueStock, unitKey } from "../../lib/stock-valuation.js";
import { seedChartOfAccounts } from "../../lib/coa-seed.js";

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

function line(itemId: string, quantity: string, unitPrice: string, taxPercent = "0") {
  return { itemId, itemName: "Line", quantity, unitPrice, taxPercent, discountPercent: "0" };
}

function invoice(type: "sale" | "purchase", date: string, lines: ReturnType<typeof line>[]) {
  return caller().invoice.create({ partyId: world.party1.id, type, invoiceDate: date, lineItems: lines } as never);
}

async function unitValue(itemId: string, asOf = new Date(), method?: "weighted_average" | "fifo") {
  const v = await valueStock(getTenantTestDb(), world.business1.id, asOf, method);
  return v.units.get(unitKey(itemId, null))!;
}

let itemId: string;

beforeAll(async () => {
  world = await createTestWorld();
  await seedChartOfAccounts(getTenantTestDb(), world.business1.id);
  // 10 opening at purchase price 80, then 10 bought at 100 (+18% GST, which
  // is input credit, not cost), then 5 sold.
  const item = await caller().item.create({
    name: "Valued item", unit: "pcs", stockQuantity: "10", salePrice: "150", purchasePrice: "80",
  } as never);
  itemId = item.id;
  await invoice("purchase", daysAgo(10), [line(itemId, "10", "100", "18")]);
  await invoice("sale", daysAgo(5), [line(itemId, "5", "150")]);
});

afterAll(async () => {
  await truncateAllTables();
});

describe("valueStock", () => {
  it("weighted average: purchases and opening stock averaged, GST excluded", async () => {
    const v = await unitValue(itemId, new Date(), "weighted_average");
    expect(v.quantity).toBe(15);
    expect(v.rate).toBe(90); // (10×100 + 10×80) / 20
    expect(v.value).toBe(1350);
  });

  it("FIFO: what's left is the latest purchase first, then opening stock", async () => {
    const v = await unitValue(itemId, new Date(), "fifo");
    expect(v.value).toBe(1400); // 10×100 + 5×80
  });

  it("values the quantity held at a past date", async () => {
    // A week ago: only the purchase had happened (the opening stock was
    // entered today), so 10 on hand at the purchase rate.
    const weekAgo = await unitValue(itemId, new Date(daysAgo(7)), "weighted_average");
    expect(weekAgo.quantity).toBe(10);
    expect(weekAgo.value).toBe(1000);
  });

  it("uses the business's chosen method", async () => {
    await caller().stock.updateSettings({ valuationMethod: "fifo" });
    try {
      expect((await caller().stock.settings()).valuationMethod).toBe("fifo");
      expect((await unitValue(itemId)).value).toBe(1400);
    } finally {
      await caller().stock.updateSettings({ valuationMethod: "weighted_average" });
    }
  });
});

describe("reports", () => {
  it("stock summary values stock by the valuation method", async () => {
    const res = await caller().reports.stockSummary({ showZeroStock: false } as never);
    const row = res.simpleItems.find((r) => r.itemId === itemId)!;
    expect(Number(row.stockValue)).toBe(1350);
    expect(res.summary.valuationMethod).toBe("weighted_average");
  });

  it("P&L adds the change in inventories, so profit reflects stock left", async () => {
    const from = daysAgo(30);
    const to = new Date().toISOString();
    const pl = await caller().reports.profitAndLoss({ fromDate: from, toDate: to });
    const opening = await valueStock(getTenantTestDb(), world.business1.id, new Date(new Date(from).getTime() - 1));
    const closing = await valueStock(getTenantTestDb(), world.business1.id, new Date(to));

    expect(pl.openingStock).toBe(opening.total);
    expect(pl.closingStock).toBe(closing.total);
    const change = pl.expenses.find((e) => e.accountCode === "5050")!;
    expect(Number(change.amount)).toBeCloseTo(Number(opening.total) - Number(closing.total), 2);
  });

  it("dashboard P&L: cost of goods sold = opening + purchases − closing, on taxable values", async () => {
    const from = daysAgo(30);
    const to = new Date().toISOString();
    const pl = await caller().dashboard.profitAndLoss({ fromDate: from, toDate: to });
    expect(Number(pl.purchases)).toBe(1000); // taxable value, GST excluded
    expect(Number(pl.revenue)).toBe(750);
    expect(Number(pl.cogs)).toBeCloseTo(Number(pl.openingStock) + 1000 - Number(pl.closingStock), 2);
    expect(Number(pl.grossProfit)).toBeCloseTo(750 - Number(pl.cogs), 2);
  });

  it("balance sheet shows closing stock as Inventory and stays balanced", async () => {
    const asOf = new Date().toISOString();
    const bs = await caller().reports.balanceSheet({ asOfDate: asOf });
    const inventory = bs.assets.find((a) => a.accountCode === "1200")!;
    expect(inventory.balance).toBe(bs.closingStock);
    expect(Number(bs.closingStock)).toBeGreaterThan(0);
    expect(Number(bs.totalAssets)).toBeCloseTo(Number(bs.totalLiabilities) + Number(bs.totalEquity), 2);
  });
});
