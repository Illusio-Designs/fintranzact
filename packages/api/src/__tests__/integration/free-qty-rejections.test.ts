/**
 * Free quantities ("10 + 1") on document lines, and rejections on goods
 * receipt.
 *
 *   - Free goods move stock with the billed quantity; totals and tax come from
 *     the billed quantity only.
 *   - Conversions carry free quantities, part conversions track them apart
 *     from the billed quantity, and returns can send them back.
 *   - A GRN takes in only what was accepted; what was rejected stays pending
 *     on the purchase order and can go back on a purchase return or debit
 *     note that moves no stock.
 *   - Registers, item sales, the stock ledger and stock valuation see free goods.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq, isNull, sql } from "drizzle-orm";
import { invoices, invoiceItems, items, stockBalances, stockMovements } from "@fintranzact/db";
import { getTenantTestDb, truncateAllTables } from "../helpers/test-db.js";
import { createTestWorld, createParty, type TestWorld } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { valueStock, unitKey } from "../../lib/stock-valuation.js";
import { withQuantityNotes, type InvoicePDFData } from "../../lib/invoice-pdf.js";

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
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

async function newItem(stock: string, purchasePrice = "80") {
  return caller().item.create({
    name: `Item ${Math.random().toString(36).slice(2, 8)}`,
    unit: "pcs",
    stockQuantity: stock,
    salePrice: "100",
    purchasePrice,
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

type Extra = { freeQuantity?: string; rejectedQuantity?: string; rejectionReason?: string; taxPercent?: string; conversionFactor?: string; selectedUnit?: string };

function line(itemId: string, quantity: string, unitPrice = "100.00", extra: Extra = {}) {
  return { itemId, itemName: "Line", quantity, unitPrice, taxPercent: "0", discountPercent: "0", ...extra };
}

function sale(lineItems: ReturnType<typeof line>[], extra: Record<string, unknown> = {}) {
  return caller().invoice.create({ partyId: world.party1.id, type: "sale", invoiceDate: now(), lineItems, ...extra } as never);
}

function purchase(lineItems: ReturnType<typeof line>[], extra: Record<string, unknown> = {}) {
  return caller().invoice.create({ partyId: supplierId, type: "purchase", invoiceDate: now(), lineItems, ...extra } as never);
}

function purchaseOrder(lineItems: ReturnType<typeof line>[]) {
  return caller().purchaseOrder.create({ partyId: supplierId, type: "purchase", invoiceDate: now(), lineItems } as never);
}

async function linesOf(documentId: string) {
  return getTenantTestDb()
    .select({
      itemId: invoiceItems.itemId,
      quantity: invoiceItems.quantity,
      freeQuantity: invoiceItems.freeQuantity,
      rejectedQuantity: invoiceItems.rejectedQuantity,
      rejectionReason: invoiceItems.rejectionReason,
      totalAmount: invoiceItems.totalAmount,
    })
    .from(invoiceItems)
    .where(eq(invoiceItems.invoiceId, documentId))
    .orderBy(invoiceItems.sortOrder);
}

async function docRow(id: string) {
  const [row] = await getTenantTestDb().select().from(invoices).where(eq(invoices.id, id));
  return row!;
}

beforeAll(async () => {
  world = await createTestWorld();
  const supplier = await createParty(getTenantTestDb(), world.business1.id, { type: "supplier", name: "Free Goods Traders" });
  supplierId = supplier.id;
});

afterAll(async () => {
  await truncateAllTables();
});

describe("free quantity: totals and tax", () => {
  it("prices and taxes only the billed quantity", async () => {
    const item = await newItem("50");
    const inv = await sale([line(item.id, "10", "100.00", { freeQuantity: "1", taxPercent: "18" })]);

    expect(inv.subtotal).toBe("1000.00");
    expect(inv.taxAmount).toBe("180.00");
    expect(inv.totalAmount).toBe("1180.00");
    const [li] = await linesOf(inv.id);
    expect(li).toMatchObject({ quantity: "10.000", freeQuantity: "1.000", totalAmount: "1180.00" });
  });

  it("a line can be entirely free, but not empty", async () => {
    const item = await newItem("20");
    const paid = await newItem("20");
    const inv = await sale([line(paid.id, "2"), line(item.id, "0", "100.00", { freeQuantity: "3" })]);
    expect(inv.totalAmount).toBe("200.00");
    expect(await stockOf(item.id)).toBe(17);

    await expect(sale([line(item.id, "0")])).rejects.toThrow(/Quantity must be greater than 0/);
  });

  it("credit and debit notes can't carry free goods; only a GRN can reject", async () => {
    const item = await newItem("5");
    await expect(caller().creditNote.create({
      partyId: world.party1.id, type: "sale", invoiceDate: now(),
      lineItems: [line(item.id, "1", "100.00", { freeQuantity: "1" })],
    } as never)).rejects.toThrow(/can't have free quantities/);
    await expect(sale([line(item.id, "1", "100.00", { rejectedQuantity: "1", rejectionReason: "Damaged" })]))
      .rejects.toThrow(/Only a goods receipt note can record rejected goods/);
  });
});

describe("free quantity: stock", () => {
  it("sales and purchases move billed + free, and edits and cancelling follow", async () => {
    const item = await newItem("100");
    const inv = await sale([line(item.id, "10", "100.00", { freeQuantity: "1" })]);
    expect(await stockOf(item.id)).toBe(89);

    await caller().invoice.update({ id: inv.id, lineItems: [line(item.id, "10", "100.00", { freeQuantity: "2" })] } as never);
    expect(await stockOf(item.id)).toBe(88);
    expect((await docRow(inv.id)).totalAmount).toBe("1000.00");

    await caller().invoice.updateStatus({ id: inv.id, status: "cancelled" } as never);
    expect(await stockOf(item.id)).toBe(100);

    await purchase([line(item.id, "12", "80.00", { freeQuantity: "2" })]);
    expect(await stockOf(item.id)).toBe(114);
  });

  it("free goods in an alternate unit move in base units", async () => {
    const item = await newItem("100");
    // 2 boxes of 10 + 1 box free.
    await sale([line(item.id, "2", "900.00", { freeQuantity: "1", selectedUnit: "box", conversionFactor: "10" })]);
    expect(await stockOf(item.id)).toBe(70);
  });

  it("a sales return can send the free goods back", async () => {
    const item = await newItem("50");
    const inv = await sale([line(item.id, "10", "100.00", { freeQuantity: "1" })]);
    expect(await stockOf(item.id)).toBe(39);

    const ret = await caller().document.convert({ sourceDocumentId: inv.id, targetDocumentType: "sales_return" });
    expect(await stockOf(item.id)).toBe(50);
    const [li] = await linesOf(ret.id);
    expect(li).toMatchObject({ quantity: "10.000", freeQuantity: "1.000" });
    expect((await docRow(ret.id)).totalAmount).toBe("1000.00");
  });

  it("a purchase return of free goods alone takes them out at no value", async () => {
    const item = await newItem("0");
    await purchase([line(item.id, "10", "80.00", { freeQuantity: "2" })]);
    const ret = await caller().purchaseReturn.create({
      partyId: supplierId, type: "purchase", invoiceDate: now(),
      lineItems: [line(item.id, "0", "80.00", { freeQuantity: "2" })],
    } as never);
    expect(ret.totalAmount).toBe("0.00");
    expect(await stockOf(item.id)).toBe(10);
  });
});

describe("free quantity: conversions", () => {
  it("quotation → invoice carries the free quantity", async () => {
    const item = await newItem("30");
    const q = await caller().quotation.create({
      partyId: world.party1.id, type: "sale", invoiceDate: now(),
      lineItems: [line(item.id, "10", "100.00", { freeQuantity: "1" })],
    } as never);
    const inv = await caller().document.convert({ sourceDocumentId: q.id, targetDocumentType: "invoice" });
    const [li] = await linesOf(inv.id);
    expect(li).toMatchObject({ quantity: "10.000", freeQuantity: "1.000" });
    expect(await stockOf(item.id)).toBe(19);
  });

  it("a sales order's free goods are tracked apart through part deliveries", async () => {
    const item = await newItem("100");
    const so = await caller().salesOrder.create({
      partyId: world.party1.id, type: "sale", invoiceDate: now(),
      lineItems: [line(item.id, "10", "100.00", { freeQuantity: "1" })],
    } as never);
    const [soLine] = (await caller().orders.fulfilment({ id: so.id })).lines;
    expect(soLine).toMatchObject({ ordered: 10, freeOrdered: 1, pending: 10, freePending: 1 });

    // Part of the billed quantity: no free goods unless asked for.
    const dc1 = await caller().document.convert({
      sourceDocumentId: so.id, targetDocumentType: "delivery_challan",
      lines: [{ sourceLineId: soLine!.lineId, quantity: "4" }],
    });
    expect((await linesOf(dc1.id))[0]).toMatchObject({ quantity: "4.000", freeQuantity: "0.000" });
    expect(await stockOf(item.id)).toBe(96);

    let f = await caller().orders.fulfilment({ id: so.id });
    expect(f.status).toBe("partial");
    expect(f.lines[0]).toMatchObject({ fulfilled: 4, pending: 6, freeFulfilled: 0, freePending: 1 });

    // More free goods than are pending is refused.
    await expect(caller().document.convert({
      sourceDocumentId: so.id, targetDocumentType: "delivery_challan",
      lines: [{ sourceLineId: soLine!.lineId, quantity: "1", freeQuantity: "2" }],
    })).rejects.toThrow(/pending free/);

    // The rest: all of the pending billed quantity takes the free goods along.
    const dc2 = await caller().document.convert({ sourceDocumentId: so.id, targetDocumentType: "delivery_challan" });
    expect((await linesOf(dc2.id))[0]).toMatchObject({ quantity: "6.000", freeQuantity: "1.000" });
    expect(await stockOf(item.id)).toBe(89);
    f = await caller().orders.fulfilment({ id: so.id });
    expect(f.status).toBe("fulfilled");

    // Billing the challan carries the free goods without moving stock again.
    const bill = await caller().document.convert({ sourceDocumentId: dc2.id, targetDocumentType: "invoice" });
    expect((await linesOf(bill.id))[0]).toMatchObject({ quantity: "6.000", freeQuantity: "1.000" });
    expect((await docRow(bill.id)).totalAmount).toBe("600.00");
    expect(await stockOf(item.id)).toBe(89);
    expect((await caller().orders.fulfilment({ id: dc2.id })).status).toBe("fulfilled");
  });

  it("free goods still owed keep an order on the pending report", async () => {
    const item = await newItem("100");
    const so = await caller().salesOrder.create({
      partyId: world.party1.id, type: "sale", invoiceDate: now(),
      lineItems: [line(item.id, "5", "100.00", { freeQuantity: "1" })],
    } as never);
    const [soLine] = (await caller().orders.fulfilment({ id: so.id })).lines;
    await caller().document.convert({
      sourceDocumentId: so.id, targetDocumentType: "invoice",
      lines: [{ sourceLineId: soLine!.lineId, quantity: "5", freeQuantity: "0" }],
    });
    const pending = await caller().orders.pending({ documentType: "sales_order" });
    const row = pending.data.find((r) => r.documentId === so.id);
    expect(row).toMatchObject({ pending: 0, freePending: 1, pendingValue: "0.00" });
    expect((await caller().orders.fulfilment({ id: so.id })).status).toBe("partial");
  });
});

describe("rejections on goods receipt", () => {
  it("only accepted goods come in; rejected ones stay pending on the order", async () => {
    const item = await newItem("0");
    const po = await purchaseOrder([line(item.id, "20", "80.00", { freeQuantity: "2" })]);
    const [poLine] = (await caller().orders.fulfilment({ id: po.id })).lines;

    const grn = await caller().document.convert({
      sourceDocumentId: po.id, targetDocumentType: "goods_receipt_note",
      lines: [{ sourceLineId: poLine!.lineId, quantity: "15", freeQuantity: "2", rejectedQuantity: "5", rejectionReason: "Damaged" }],
    });
    expect((await linesOf(grn.id))[0]).toMatchObject({
      quantity: "15.000", freeQuantity: "2.000", rejectedQuantity: "5.000", rejectionReason: "Damaged",
    });
    expect(await stockOf(item.id)).toBe(17);
    expect((await docRow(grn.id)).totalAmount).toBe("1200.00");

    const f = await caller().orders.fulfilment({ id: po.id });
    expect(f.status).toBe("partial");
    expect(f.lines[0]).toMatchObject({ fulfilled: 15, pending: 5, freePending: 0, rejected: 5 });

    // Billing the GRN bills what was accepted, free goods alongside, and moves nothing.
    const bill = await caller().document.convert({ sourceDocumentId: grn.id, targetDocumentType: "invoice" });
    expect((await linesOf(bill.id))[0]).toMatchObject({ quantity: "15.000", freeQuantity: "2.000", rejectedQuantity: "0.000" });
    expect((await docRow(bill.id)).totalAmount).toBe("1200.00");
    expect(await stockOf(item.id)).toBe(17);

    // The replacement arrives: the order is done.
    await caller().document.convert({ sourceDocumentId: po.id, targetDocumentType: "goods_receipt_note" });
    expect(await stockOf(item.id)).toBe(22);
    const done = await caller().orders.fulfilment({ id: po.id });
    expect(done.status).toBe("fulfilled");
    expect(done.lines[0]).toMatchObject({ pending: 0, rejected: 0 });
  });

  it("rejected goods can be short-closed instead of replaced", async () => {
    const item = await newItem("0");
    const po = await purchaseOrder([line(item.id, "10", "80.00")]);
    const [poLine] = (await caller().orders.fulfilment({ id: po.id })).lines;
    await caller().document.convert({
      sourceDocumentId: po.id, targetDocumentType: "goods_receipt_note",
      lines: [{ sourceLineId: poLine!.lineId, quantity: "0", rejectedQuantity: "10", rejectionReason: "Wrong item" }],
    });
    expect(await stockOf(item.id)).toBe(0);
    expect((await caller().orders.fulfilment({ id: po.id })).status).toBe("open");

    const pending = await caller().orders.pending({ documentType: "purchase_order" });
    expect(pending.data.find((r) => r.documentId === po.id)).toMatchObject({ pending: 10, rejected: 10 });

    await caller().orders.close({ id: po.id });
    expect((await caller().orders.fulfilment({ id: po.id })).status).toBe("closed");
  });

  it("refuses rejections that don't fit", async () => {
    const item = await newItem("0");
    const po = await purchaseOrder([line(item.id, "10", "80.00")]);
    const [poLine] = (await caller().orders.fulfilment({ id: po.id })).lines;
    await expect(caller().document.convert({
      sourceDocumentId: po.id, targetDocumentType: "goods_receipt_note",
      lines: [{ sourceLineId: poLine!.lineId, quantity: "8", rejectedQuantity: "3", rejectionReason: "Damaged" }],
    })).rejects.toThrow(/more than the 10 pending/);
    await expect(caller().document.convert({
      sourceDocumentId: po.id, targetDocumentType: "goods_receipt_note",
      lines: [{ sourceLineId: poLine!.lineId, quantity: "8", rejectedQuantity: "2" }],
    })).rejects.toThrow(/Give a reason/);
    await expect(caller().document.convert({
      sourceDocumentId: po.id, targetDocumentType: "invoice",
      lines: [{ sourceLineId: poLine!.lineId, quantity: "8", rejectedQuantity: "2", rejectionReason: "Damaged" }],
    })).rejects.toThrow(/when receiving a purchase order on a GRN/);
    expect(await stockOf(item.id)).toBe(0);
  });

  it("a GRN made directly takes in only what was accepted", async () => {
    const item = await newItem("5");
    await caller().goodsReceiptNote.create({
      partyId: supplierId, type: "purchase", invoiceDate: now(),
      lineItems: [line(item.id, "7", "80.00", { freeQuantity: "1", rejectedQuantity: "3", rejectionReason: "Short expiry" })],
    } as never);
    expect(await stockOf(item.id)).toBe(13);
  });

  it("rejected goods go back on a purchase return that moves no stock", async () => {
    const item = await newItem("0");
    const po = await purchaseOrder([line(item.id, "10", "80.00")]);
    const [poLine] = (await caller().orders.fulfilment({ id: po.id })).lines;
    const grn = await caller().document.convert({
      sourceDocumentId: po.id, targetDocumentType: "goods_receipt_note",
      lines: [{ sourceLineId: poLine!.lineId, quantity: "2", rejectedQuantity: "8", rejectionReason: "Damaged" }],
    });
    expect(await stockOf(item.id)).toBe(2);

    let rejections = (await caller().orders.fulfilment({ id: grn.id })).rejections;
    expect(rejections).toEqual([expect.objectContaining({ rejected: 8, returned: 0, open: 8, reason: "Damaged" })]);

    // The return is worth more than the GRN (only 2 were accepted): no bill total holds it back.
    const ret = await caller().document.convert({
      sourceDocumentId: grn.id, targetDocumentType: "purchase_return", fromRejected: true,
      lines: [{ sourceLineId: rejections[0]!.lineId, quantity: "5" }],
    });
    const retRow = await docRow(ret.id);
    expect(retRow).toMatchObject({ documentType: "purchase_return", stockMode: "none", referenceDocumentId: grn.id, totalAmount: "400.00" });
    expect(await stockOf(item.id)).toBe(2);
    expect((await docRow(grn.id)).status).not.toBe("adjusted");

    rejections = (await caller().orders.fulfilment({ id: grn.id })).rejections;
    expect(rejections[0]).toMatchObject({ returned: 5, open: 3 });
    await expect(caller().document.convert({
      sourceDocumentId: grn.id, targetDocumentType: "purchase_return", fromRejected: true,
      lines: [{ sourceLineId: rejections[0]!.lineId, quantity: "4" }],
    })).rejects.toThrow(/Only 3 of/);

    // The rest on a debit note.
    const dn = await caller().document.convert({ sourceDocumentId: grn.id, targetDocumentType: "debit_note", fromRejected: true });
    expect((await linesOf(dn.id))[0]).toMatchObject({ quantity: "3.000", freeQuantity: "0.000" });
    expect((await caller().orders.fulfilment({ id: grn.id })).rejections[0]).toMatchObject({ open: 0 });
    await expect(caller().document.convert({ sourceDocumentId: grn.id, targetDocumentType: "debit_note", fromRejected: true }))
      .rejects.toThrow(/No rejected goods are left/);

    // Cancelling the return puts the goods back as not returned, still without a stock move.
    await caller().purchaseReturn.updateStatus({ id: ret.id, status: "cancelled" });
    expect((await caller().orders.fulfilment({ id: grn.id })).rejections[0]).toMatchObject({ returned: 3, open: 5 });
    expect(await stockOf(item.id)).toBe(2);

    // Rejected-goods returns don't count as receiving the order.
    expect((await caller().orders.fulfilment({ id: po.id })).lines[0]).toMatchObject({ fulfilled: 2, pending: 8 });
    expect((await caller().orders.fulfilment({ id: grn.id })).linkedDocuments.map((d) => d.documentType).sort())
      .toEqual(["debit_note", "purchase_return"]);
  });

  it("only a GRN's rejected goods can go back this way", async () => {
    const item = await newItem("10");
    const inv = await purchase([line(item.id, "1", "80.00")]);
    await expect(caller().document.convert({ sourceDocumentId: inv.id, targetDocumentType: "purchase_return", fromRejected: true }))
      .rejects.toThrow(/Rejected goods go back from a goods receipt note/);
  });
});

describe("reports", () => {
  it("registers and item sales show free goods", async () => {
    const item = await newItem("100");
    const from = daysAgo(1);
    const inv = await sale([line(item.id, "10", "100.00", { freeQuantity: "1" })]);
    const bill = await purchase([line(item.id, "20", "80.00", { freeQuantity: "4" })]);
    // Item sales count issued invoices, not drafts.
    await caller().invoice.updateStatus({ id: inv.id, status: "sent" } as never);
    const to = new Date(Date.now() + 60_000).toISOString();

    const sales = await caller().reports.salesRegister({ fromDate: from, toDate: to });
    expect(sales.rows.find((r) => r.id === inv.id)).toMatchObject({ freeQuantity: 1, subtotal: "1000.00" });
    expect(sales.summary.totalFreeQuantity).toBeGreaterThanOrEqual(1);

    const purchases = await caller().reports.purchaseRegister({ fromDate: from, toDate: to });
    expect(purchases.rows.find((r) => r.id === bill.id)).toMatchObject({ freeQuantity: 4 });

    const itemSales = await caller().reports.itemSales({ fromDate: from, toDate: to } as never);
    const row = itemSales.rows.find((r) => r.itemId === item.id);
    expect(Number(row!.soldQty)).toBe(10);
    expect(Number(row!.freeQty)).toBe(1);
    // The free piece cost something too: 11 × 80.
    expect(Number(row!.estimatedCost)).toBe(880);
  });

  it("the stock ledger shows how much of each movement was free", async () => {
    const item = await newItem("0");
    await purchase([line(item.id, "10", "80.00", { freeQuantity: "2" })]);
    await sale([line(item.id, "5", "100.00", { freeQuantity: "1" })]);
    const ledger = await caller().inventoryReports.stockLedger({ itemId: item.id, fromDate: daysAgo(1), toDate: new Date(Date.now() + 60_000).toISOString() });
    expect(ledger.lines.map((l) => [l.inward, l.outward, l.free])).toEqual([[12, 0, 2], [0, 6, 1]]);
    expect(ledger.closing).toBe(6);
  });

  it("free goods lower the valuation rate", async () => {
    const item = await newItem("0", "100");
    await purchase([line(item.id, "10", "100.00", { freeQuantity: "10" })]);
    const v = await valueStock(getTenantTestDb(), world.business1.id, new Date(Date.now() + 60_000), "weighted_average");
    const u = v.units.get(unitKey(item.id, null));
    expect(u).toMatchObject({ quantity: 20, rate: 50, value: 1000 });

    // Every movement of the bill posts billed + free.
    const [moved] = await getTenantTestDb()
      .select({ qty: sql<string>`SUM(${stockMovements.quantity}::numeric)::text` })
      .from(stockMovements)
      .where(eq(stockMovements.itemId, item.id));
    expect(Number(moved!.qty)).toBe(20);
  });
});

describe("PDF", () => {
  it("prints free and rejected quantities under the line", () => {
    const base = { itemName: "Soap", quantity: "10", unit: "pcs", unitPrice: "10", taxPercent: "0", taxAmount: "0", discountPercent: "0", totalAmount: "100" };
    const data = withQuantityNotes({
      lineItems: [
        { ...base, freeQuantity: "1.000" },
        { ...base, description: "Batch A", rejectedQuantity: "2", rejectionReason: "Damaged" },
        { ...base, freeQuantity: "0.000" },
      ],
    } as unknown as InvoicePDFData);
    expect(data.lineItems.map((li) => li.description ?? null)).toEqual([
      "+ 1 pcs free",
      "Batch A · Rejected 2 pcs (Damaged)",
      null,
    ]);
  });
});
