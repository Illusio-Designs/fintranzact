/**
 * Every path that changes stock keeps three things in step: the item total,
 * the per-warehouse balances and the movement ledger.
 *
 * Items here are created through item.create, so all their stock is placed in
 * a warehouse from the start: after any operation the item total must equal
 * the sum of its warehouse balances.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq, isNull, sql } from "drizzle-orm";
import { invoices, invoiceItems, items, itemVariants, parties, stockAdjustments, stockBalances, stockMovements } from "@fintranzact/db";
import { getTenantTestDb, truncateAllTables } from "../helpers/test-db.js";
import { createTestWorld, createItem, type TestWorld } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { runInvoicesImport } from "../../routers/import/engine/invoices.js";

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

const now = () => new Date().toISOString();

async function newItem(stock: string, name = `Item ${Math.random().toString(36).slice(2, 8)}`) {
  return caller().item.create({ name, unit: "pcs", stockQuantity: stock, salePrice: "100", purchasePrice: "80" } as never);
}

/** Item (or variant) total and the sum of its warehouse balances. */
async function stock(itemId: string, variantId: string | null = null) {
  const db = getTenantTestDb();
  const [total] = variantId
    ? await db.select({ qty: itemVariants.stockQuantity }).from(itemVariants).where(eq(itemVariants.id, variantId))
    : await db.select({ qty: items.stockQuantity }).from(items).where(eq(items.id, itemId));
  const [placed] = await db
    .select({ qty: sql<string>`COALESCE(SUM(${stockBalances.quantity}::numeric), 0)::text` })
    .from(stockBalances)
    .where(and(
      eq(stockBalances.itemId, itemId),
      variantId ? eq(stockBalances.variantId, variantId) : isNull(stockBalances.variantId),
    ));
  return { total: Number(total!.qty), placed: Number(placed!.qty) };
}

async function expectStock(itemId: string, qty: number, variantId: string | null = null) {
  expect(await stock(itemId, variantId)).toEqual({ total: qty, placed: qty });
}

function line(itemId: string, quantity: string) {
  return { itemId, itemName: "Line", quantity, unitPrice: "100.00", taxPercent: "0", discountPercent: "0" };
}

function sale(itemId: string, quantity: string) {
  return caller().invoice.create({
    partyId: world.party1.id,
    type: "sale",
    invoiceDate: now(),
    lineItems: [line(itemId, quantity)],
  } as never);
}

beforeAll(async () => {
  world = await createTestWorld();
});

afterAll(async () => {
  await truncateAllTables();
});

describe("opening stock", () => {
  it("item.create places opening stock in the default warehouse", async () => {
    const item = await newItem("50");
    expect(Number(item.stockQuantity)).toBe(50);
    await expectStock(item.id, 50);
    const movements = await getTenantTestDb().select().from(stockMovements).where(eq(stockMovements.itemId, item.id));
    expect(movements).toHaveLength(1);
    expect(movements[0]!.movementType).toBe("OPENING");
  });

  it("variant opening stock is placed per variant", async () => {
    const item = await caller().item.create({
      name: "Tee",
      unit: "pcs",
      itemMode: "variants",
      variantAttributes: ["Size"],
      variants: [
        { attributeValues: { Size: "S" }, stockQuantity: "10" },
        { attributeValues: { Size: "M" }, stockQuantity: "4" },
      ],
    } as never);
    const [s, m] = [...item.variants].sort((a, b) => Number(b.stockQuantity) - Number(a.stockQuantity));
    await expectStock(item.id, 10, s!.id);
    await expectStock(item.id, 4, m!.id);

    // Editing a variant's stock on the form posts an adjustment.
    await caller().item.updateVariant({ variantId: m!.id, data: { stockQuantity: "7" } });
    await expectStock(item.id, 7, m!.id);
  });
});

describe("invoices", () => {
  it("cancelling returns the stock and reinstating takes it again", async () => {
    const item = await newItem("50");
    const inv = await sale(item.id, "10");
    await expectStock(item.id, 40);

    await caller().invoice.updateStatus({ id: inv.id, status: "cancelled" });
    await expectStock(item.id, 50);

    // Cancelling again changes nothing.
    await caller().invoice.updateStatus({ id: inv.id, status: "cancelled" });
    await expectStock(item.id, 50);

    await caller().invoice.updateStatus({ id: inv.id, status: "sent" });
    await expectStock(item.id, 40);
  });

  it("draft → sent does not move stock twice", async () => {
    const item = await newItem("20");
    const inv = await sale(item.id, "5");
    await caller().invoice.updateStatus({ id: inv.id, status: "sent" });
    await expectStock(item.id, 15);
  });

  it("editing posts only the difference, and deleting returns the rest", async () => {
    const item = await newItem("50");
    const inv = await sale(item.id, "10");
    await caller().invoice.update({ id: inv.id, lineItems: [line(item.id, "4")] } as never);
    await expectStock(item.id, 46);

    await caller().invoice.delete({ id: inv.id });
    await expectStock(item.id, 50);
  });

  it("deleting a cancelled invoice does not return the stock twice", async () => {
    const item = await newItem("30");
    const inv = await sale(item.id, "10");
    await caller().invoice.updateStatus({ id: inv.id, status: "cancelled" });
    await caller().invoice.delete({ id: inv.id });
    await expectStock(item.id, 30);
  });

  it("undoes a pre-movements (legacy) invoice from its lines", async () => {
    const db = getTenantTestDb();
    // Legacy data: stock applied to the item total only, no movements.
    const item = await createItem(db, world.business1.id, { name: "Legacy item", stockQuantity: "90.000" });
    const [inv] = await db.insert(invoices).values({
      businessId: world.business1.id,
      partyId: world.party1.id,
      type: "sale",
      documentType: "invoice",
      invoiceNumber: "LEGACY-1",
      totalAmount: "1000",
      stockMode: "legacy",
    }).returning();
    await db.insert(invoiceItems).values({
      invoiceId: inv!.id,
      itemId: item.id,
      itemName: "Legacy item",
      quantity: "10",
      unitPrice: "100",
      totalAmount: "1000",
    });

    await caller().invoice.delete({ id: inv!.id });
    const { total } = await stock(item.id);
    expect(total).toBe(100);
  });
});

describe("delivery challans and returns", () => {
  it("a challan moves stock per warehouse; cancelling and deleting return it once", async () => {
    const item = await newItem("50");
    const challan = await caller().deliveryChallan.create({
      partyId: world.party1.id,
      type: "sale",
      invoiceDate: now(),
      lineItems: [line(item.id, "5")],
    } as never);
    await expectStock(item.id, 45);

    await caller().deliveryChallan.updateStatus({ id: challan.id, status: "cancelled" });
    await expectStock(item.id, 50);

    await caller().deliveryChallan.delete({ id: challan.id });
    await expectStock(item.id, 50);
  });

  it("billing a challan does not move stock again, even when the invoice is deleted", async () => {
    const item = await newItem("50");
    const challan = await caller().deliveryChallan.create({
      partyId: world.party1.id,
      type: "sale",
      invoiceDate: now(),
      lineItems: [line(item.id, "5")],
    } as never);
    const converted = await caller().document.convert({ sourceDocumentId: challan.id, targetDocumentType: "invoice" });
    await expectStock(item.id, 45);

    await caller().invoice.delete({ id: converted.id });
    await expectStock(item.id, 45);
  });

  it("sales and purchase returns move stock in and out per warehouse", async () => {
    const item = await newItem("50");
    await caller().salesReturn.create({
      partyId: world.party1.id,
      type: "sale",
      invoiceDate: now(),
      lineItems: [line(item.id, "3")],
    } as never);
    await expectStock(item.id, 53);

    await caller().purchaseReturn.create({
      partyId: world.party1.id,
      type: "purchase",
      invoiceDate: now(),
      lineItems: [line(item.id, "8")],
    } as never);
    await expectStock(item.id, 45);
  });

  it("credit notes stay financial only", async () => {
    const item = await newItem("50");
    await caller().creditNote.create({
      partyId: world.party1.id,
      type: "sale",
      invoiceDate: now(),
      lineItems: [line(item.id, "3")],
    } as never);
    await expectStock(item.id, 50);
  });
});

describe("item master edits", () => {
  it("editing stock on the item posts an adjustment", async () => {
    const item = await newItem("50");
    await caller().item.update({ id: item.id, data: { stockQuantity: "70" } });
    await expectStock(item.id, 70);

    const [adj] = await getTenantTestDb().select().from(stockAdjustments).where(eq(stockAdjustments.itemId, item.id));
    expect(Number(adj!.quantity)).toBe(20);
    expect(adj!.reason).toBe("Stock edited on item");

    // Saving the form without touching stock changes nothing.
    await caller().item.update({ id: item.id, data: { stockQuantity: "70", name: "Renamed" } });
    await expectStock(item.id, 70);
  });

  it("switching the base unit rescales warehouse stock", async () => {
    const item = await newItem("5");
    await caller().item.switchBaseUnit({ id: item.id, newUnit: "box", conversionFactor: 12 });
    await expectStock(item.id, 60);
  });

  it("merging moves warehouse stock and history to the target", async () => {
    const target = await newItem("50");
    const source = await newItem("20");
    const inv = await sale(source.id, "5");
    await caller().item.merge({ sourceId: source.id, targetId: target.id });
    await expectStock(target.id, 65);
    expect((await stock(source.id)).placed).toBe(0);

    // The re-linked invoice still nets against the target's movements.
    await caller().invoice.delete({ id: inv.id });
    await expectStock(target.id, 70);
  });
});

describe("invoice import", () => {
  it("posts imported invoices per warehouse, and they reverse like any other", async () => {
    const item = await newItem("50", "Imported widget");
    const [party] = await getTenantTestDb().select({ name: parties.name }).from(parties).where(eq(parties.id, world.party1.id));
    const invoiceBase = {
      invoiceDate: new Date(),
      partyName: party!.name,
      status: "sent" as const,
      subtotal: "100.00",
      taxAmount: "0.00",
      discountAmount: "0.00",
      totalAmount: "100.00",
      amountPaid: "0.00",
    };
    const lineOf = (quantity: string, conversionFactor?: string) => ({
      itemName: "Imported widget", quantity, conversionFactor, unitPrice: "10.00", taxPercent: "0", discountPercent: "0",
    });
    const result = await runInvoicesImport(
      getTenantTestDb() as never,
      world.business1.id,
      { id: world.ramesh.id, name: world.ramesh.name ?? null },
      "test",
      [
        { ...invoiceBase, invoiceNumber: "IMP-1", type: "sale", lineItems: [lineOf("3"), lineOf("2", "2")] },
        { ...invoiceBase, invoiceNumber: "IMP-2", type: "purchase", lineItems: [lineOf("10")] },
      ],
      { autoCreatePayments: false, defaultPaymentMode: "cash" },
    );
    expect(result.created).toBe(2);
    await expectStock(item.id, 53); // 50 - 3 - 2×2 + 10

    const [imp1] = await getTenantTestDb().select({ id: invoices.id }).from(invoices).where(eq(invoices.invoiceNumber, "IMP-1"));
    await caller().invoice.delete({ id: imp1!.id });
    await expectStock(item.id, 60);
  });
});
