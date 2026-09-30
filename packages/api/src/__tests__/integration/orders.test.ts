/**
 * Purchase orders, sales orders, goods receipt notes and pending tracking.
 *
 *   - Orders never move stock; a GRN brings goods in ahead of the bill.
 *   - GRN → purchase invoice doesn't bring the goods in a second time, and a
 *     billed GRN can't be cancelled out from under its invoice.
 *   - Converting an order takes only what is still pending, and part
 *     deliveries leave the rest pending.
 *   - Short-closing takes an order off the pending lists.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq, isNull, sql } from "drizzle-orm";
import { invoices, invoiceItems, items, stockBalances } from "@fintranzact/db";
import { getTenantTestDb, truncateAllTables } from "../helpers/test-db.js";
import { createTestWorld, createParty, type TestWorld } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";

let world: TestWorld;
let supplierId: string;

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

async function newItem(stock: string) {
  return caller().item.create({
    name: `Item ${Math.random().toString(36).slice(2, 8)}`,
    unit: "pcs",
    stockQuantity: stock,
    salePrice: "100",
    purchasePrice: "80",
  } as never);
}

/** Item total, checked against the sum of its warehouse balances. */
async function stockOf(itemId: string) {
  const db = getTenantTestDb();
  const [total] = await db.select({ qty: items.stockQuantity }).from(items).where(eq(items.id, itemId));
  const [placed] = await db
    .select({ qty: sql<string>`COALESCE(SUM(${stockBalances.quantity}::numeric), 0)::text` })
    .from(stockBalances)
    .where(and(eq(stockBalances.itemId, itemId), isNull(stockBalances.variantId)));
  expect(Number(placed!.qty)).toBe(Number(total!.qty));
  return Number(total!.qty);
}

function line(itemId: string, quantity: string, unitPrice = "100.00") {
  return { itemId, itemName: "Line", quantity, unitPrice, taxPercent: "0", discountPercent: "0" };
}

function purchaseOrder(itemId: string, quantity: string, extra: Record<string, unknown> = {}) {
  return caller().purchaseOrder.create({
    partyId: supplierId,
    type: "purchase",
    invoiceDate: now(),
    lineItems: [line(itemId, quantity, "80.00")],
    ...extra,
  } as never);
}

function salesOrder(lineItems: ReturnType<typeof line>[], extra: Record<string, unknown> = {}) {
  return caller().salesOrder.create({
    partyId: world.party1.id,
    type: "sale",
    invoiceDate: now(),
    lineItems,
    ...extra,
  } as never);
}

async function linesOf(documentId: string) {
  return getTenantTestDb()
    .select({ itemId: invoiceItems.itemId, quantity: invoiceItems.quantity })
    .from(invoiceItems)
    .where(eq(invoiceItems.invoiceId, documentId))
    .orderBy(invoiceItems.sortOrder);
}

beforeAll(async () => {
  world = await createTestWorld();
  const supplier = await createParty(getTenantTestDb(), world.business1.id, { type: "supplier", name: "Sharma Wholesale" });
  supplierId = supplier.id;
});

afterAll(async () => {
  await truncateAllTables();
});

describe("creating orders", () => {
  it("purchase and sales orders move no stock and get their own numbers", async () => {
    const item = await newItem("50");
    const po = await purchaseOrder(item.id, "10");
    const so = await salesOrder([line(item.id, "5")]);

    expect(po.invoiceNumber).toMatch(/^PO-\d{5}$/);
    expect(so.invoiceNumber).toMatch(/^SO-\d{5}$/);
    expect(po.type).toBe("purchase");
    expect(so.type).toBe("sale");
    expect(po.stockMode).toBe("none");
    expect(await stockOf(item.id)).toBe(50);

    // Not a sale or purchase: nothing owed either way.
    const party = await caller().party.getById({ id: supplierId });
    expect(Number(party!.balance)).toBe(0);
  });

  it("a purchase order is always a purchase, a sales order always a sale", async () => {
    const item = await newItem("0");
    const po = await caller().purchaseOrder.create({
      partyId: supplierId, type: "sale", invoiceDate: now(), lineItems: [line(item.id, "1")],
    } as never);
    expect(po.type).toBe("purchase");
  });

  it("lists orders with their fulfilment status", async () => {
    const item = await newItem("0");
    const po = await purchaseOrder(item.id, "4");
    const list = await caller().purchaseOrder.list({ page: 1, limit: 50 } as never);
    const row = list.data.find((r: { id: string }) => r.id === po.id);
    expect(row?.fulfilmentStatus).toBe("open");
  });
});

describe("goods receipt notes", () => {
  it("a GRN brings stock in, and cancelling or deleting it takes it back out once", async () => {
    const item = await newItem("10");
    const grn = await caller().goodsReceiptNote.create({
      partyId: supplierId, type: "purchase", invoiceDate: now(), lineItems: [line(item.id, "15", "80.00")],
    } as never);
    expect(grn.invoiceNumber).toMatch(/^GRN-\d{5}$/);
    expect(await stockOf(item.id)).toBe(25);

    await caller().goodsReceiptNote.updateStatus({ id: grn.id, status: "cancelled" });
    expect(await stockOf(item.id)).toBe(10);
    await caller().goodsReceiptNote.updateStatus({ id: grn.id, status: "sent" });
    expect(await stockOf(item.id)).toBe(25);

    await caller().goodsReceiptNote.delete({ id: grn.id });
    expect(await stockOf(item.id)).toBe(10);
    await caller().goodsReceiptNote.delete({ id: grn.id });
    expect(await stockOf(item.id)).toBe(10);
  });

  it("PO → GRN → purchase invoice brings the goods in exactly once", async () => {
    const item = await newItem("0");
    const po = await purchaseOrder(item.id, "20");
    expect(await stockOf(item.id)).toBe(0);

    const grn = await caller().document.convert({ sourceDocumentId: po.id, targetDocumentType: "goods_receipt_note" });
    expect(grn.documentType).toBe("goods_receipt_note");
    expect(await stockOf(item.id)).toBe(20);

    const bill = await caller().document.convert({ sourceDocumentId: grn.id, targetDocumentType: "invoice" });
    expect(await stockOf(item.id)).toBe(20);

    const [billRow] = await getTenantTestDb()
      .select({ type: invoices.type, stockMode: invoices.stockMode, referenceDocumentId: invoices.referenceDocumentId })
      .from(invoices)
      .where(eq(invoices.id, bill.id));
    expect(billRow).toEqual({ type: "purchase", stockMode: "none", referenceDocumentId: grn.id });

    // The GRN is billed, so the order and the GRN are both fulfilled.
    expect((await caller().orders.fulfilment({ id: po.id })).status).toBe("fulfilled");
    expect((await caller().orders.fulfilment({ id: grn.id })).status).toBe("fulfilled");

    // The bill stands on the GRN's stock movement: the GRN can't go first.
    await expect(caller().goodsReceiptNote.updateStatus({ id: grn.id, status: "cancelled" })).rejects.toThrow(/billed from this document/);
    await expect(caller().goodsReceiptNote.delete({ id: grn.id })).rejects.toThrow(/billed from this document/);

    // Deleting the bill first frees the GRN, and the goods go back out once.
    await caller().invoice.delete({ id: bill.id });
    expect((await caller().orders.fulfilment({ id: grn.id })).status).toBe("open");
    await caller().goodsReceiptNote.delete({ id: grn.id });
    expect(await stockOf(item.id)).toBe(0);
    expect((await caller().orders.fulfilment({ id: po.id })).status).toBe("open");
  });

  it("a purchase order billed directly brings the goods in on the invoice", async () => {
    const item = await newItem("0");
    const po = await purchaseOrder(item.id, "6");
    await caller().document.convert({ sourceDocumentId: po.id, targetDocumentType: "invoice" });
    expect(await stockOf(item.id)).toBe(6);
  });

  it("orders convert only into what fulfils them", async () => {
    const item = await newItem("0");
    const po = await purchaseOrder(item.id, "2");
    await expect(caller().document.convert({ sourceDocumentId: po.id, targetDocumentType: "delivery_challan" })).rejects.toThrow(/can't be converted/);
  });
});

describe("partial fulfilment", () => {
  it("converting part of a sales order leaves the rest pending, and the next conversion takes only that", async () => {
    const a = await newItem("100");
    const b = await newItem("100");
    const so = await salesOrder([line(a.id, "10"), line(b.id, "4")], { dueDate: new Date(Date.now() - 86_400_000).toISOString() });
    const soLines = (await caller().orders.fulfilment({ id: so.id })).lines;

    // Deliver 6 of A and none of B on a challan.
    const dc = await caller().document.convert({
      sourceDocumentId: so.id,
      targetDocumentType: "delivery_challan",
      lines: [{ sourceLineId: soLines[0]!.lineId, quantity: "6" }],
    });
    expect(await linesOf(dc.id)).toEqual([{ itemId: a.id, quantity: "6.000" }]);
    expect(await stockOf(a.id)).toBe(94);

    let f = await caller().orders.fulfilment({ id: so.id });
    expect(f.status).toBe("partial");
    expect(f.lines.map((l) => [l.ordered, l.fulfilled, l.pending])).toEqual([[10, 6, 4], [4, 0, 4]]);
    expect(f.linkedDocuments.map((d) => d.id)).toEqual([dc.id]);

    // Asking for more than is pending is refused.
    await expect(caller().document.convert({
      sourceDocumentId: so.id,
      targetDocumentType: "invoice",
      lines: [{ sourceLineId: soLines[0]!.lineId, quantity: "5" }],
    })).rejects.toThrow(/Only 4 of/);

    // Pending report: both lines still open, and the order is overdue.
    const pending = await caller().orders.pending({ documentType: "sales_order" });
    const mine = pending.data.filter((r) => r.documentId === so.id);
    expect(mine.map((r) => [r.itemId, r.pending])).toEqual([[a.id, 4], [b.id, 4]]);
    expect(mine.every((r) => r.overdue)).toBe(true);
    expect(mine[0]!.pendingValue).toBe("400.00");
    const byItem = await caller().orders.pending({ documentType: "sales_order", itemId: b.id });
    expect(byItem.data.filter((r) => r.documentId === so.id).map((r) => r.itemId)).toEqual([b.id]);

    // With no quantities given, the invoice takes exactly what is pending.
    const inv = await caller().document.convert({ sourceDocumentId: so.id, targetDocumentType: "invoice" });
    expect(await linesOf(inv.id)).toEqual([{ itemId: a.id, quantity: "4.000" }, { itemId: b.id, quantity: "4.000" }]);
    expect(await stockOf(a.id)).toBe(90);
    expect(await stockOf(b.id)).toBe(96);

    f = await caller().orders.fulfilment({ id: so.id });
    expect(f.status).toBe("fulfilled");
    expect((await caller().orders.pending({ documentType: "sales_order" })).data.some((r) => r.documentId === so.id)).toBe(false);
    await expect(caller().document.convert({ sourceDocumentId: so.id, targetDocumentType: "invoice" })).rejects.toThrow(/Nothing is pending/);

    // Cancelling the invoice puts its quantities back on the order.
    await caller().invoice.updateStatus({ id: inv.id, status: "cancelled" });
    f = await caller().orders.fulfilment({ id: so.id });
    expect(f.status).toBe("partial");
    expect(f.lines.map((l) => l.pending)).toEqual([4, 4]);
  });

  it("the challan stays pending until it is billed", async () => {
    const item = await newItem("30");
    const so = await salesOrder([line(item.id, "8")]);
    const dc = await caller().document.convert({ sourceDocumentId: so.id, targetDocumentType: "delivery_challan" });

    let pendingDc = await caller().orders.pending({ documentType: "delivery_challan" });
    expect(pendingDc.data.find((r) => r.documentId === dc.id)?.pending).toBe(8);

    await caller().document.convert({ sourceDocumentId: dc.id, targetDocumentType: "invoice" });
    expect(await stockOf(item.id)).toBe(22);
    pendingDc = await caller().orders.pending({ documentType: "delivery_challan" });
    expect(pendingDc.data.some((r) => r.documentId === dc.id)).toBe(false);
  });

  it("the fulfilment filter narrows the order list", async () => {
    const item = await newItem("20");
    const done = await salesOrder([line(item.id, "1")]);
    await caller().document.convert({ sourceDocumentId: done.id, targetDocumentType: "invoice" });
    const open = await salesOrder([line(item.id, "1")]);

    const fulfilled = await caller().salesOrder.list({ fulfilment: "fulfilled", page: 1, limit: 50 } as never);
    expect(fulfilled.data.map((r: { id: string }) => r.id)).toContain(done.id);
    expect(fulfilled.data.map((r: { id: string }) => r.id)).not.toContain(open.id);
    expect(fulfilled.data.every((r: { fulfilmentStatus: string }) => r.fulfilmentStatus === "fulfilled")).toBe(true);
  });
});

describe("short-close", () => {
  it("a closed order leaves the pending lists and can't be converted until reopened", async () => {
    const item = await newItem("0");
    const po = await purchaseOrder(item.id, "10");
    const poLine = (await caller().orders.fulfilment({ id: po.id })).lines[0]!;
    await caller().document.convert({
      sourceDocumentId: po.id,
      targetDocumentType: "goods_receipt_note",
      lines: [{ sourceLineId: poLine.lineId, quantity: "7" }],
    });

    let pending = await caller().orders.pending({ documentType: "purchase_order", partyId: supplierId });
    expect(pending.data.find((r) => r.documentId === po.id)?.pending).toBe(3);

    await caller().orders.close({ id: po.id });
    expect((await caller().orders.fulfilment({ id: po.id })).status).toBe("closed");
    pending = await caller().orders.pending({ documentType: "purchase_order", partyId: supplierId });
    expect(pending.data.some((r) => r.documentId === po.id)).toBe(false);
    await expect(caller().document.convert({ sourceDocumentId: po.id, targetDocumentType: "goods_receipt_note" })).rejects.toThrow(/closed/);

    await caller().orders.reopen({ id: po.id });
    expect((await caller().orders.fulfilment({ id: po.id })).status).toBe("partial");
    const rest = await caller().document.convert({ sourceDocumentId: po.id, targetDocumentType: "goods_receipt_note" });
    expect(await linesOf(rest.id)).toEqual([{ itemId: item.id, quantity: "3.000" }]);
    expect(await stockOf(item.id)).toBe(10);
  });

  it("pending GRNs list goods received but not billed", async () => {
    const item = await newItem("0");
    const grn = await caller().goodsReceiptNote.create({
      partyId: supplierId, type: "purchase", invoiceDate: now(), lineItems: [line(item.id, "5", "80.00")],
    } as never);
    const pending = await caller().orders.pending({ documentType: "goods_receipt_note" });
    const row = pending.data.find((r) => r.documentId === grn.id);
    expect(row).toMatchObject({ pending: 5, partyName: "Sharma Wholesale", pendingValue: "400.00" });
  });
});
