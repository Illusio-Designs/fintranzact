/**
 * Batch / lot numbers and expiry: stock per batch follows every document and
 * stock operation through the movement ledger, sales take stock first expiry
 * first out, expired batches only go out when the user says so, and no batch
 * is ever taken below zero.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq, isNull, sql } from "drizzle-orm";
import { invoiceItems, inventorySettings, items, stockMovements } from "@fintranzact/db";
import { getTenantTestDb, truncateAllTables } from "../helpers/test-db.js";
import { createTestWorld, type TestWorld } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { businessDay } from "../../lib/batches.js";
import { ensureDefaultWarehouse } from "../../lib/inventory-service.js";
import { withBatchNotes, type InvoicePDFData } from "../../lib/invoice-pdf.js";

let world: TestWorld;
let mainId: string;
let puneId: string;

function caller() {
  return createTestCaller({
    userId: world.ramesh.id,
    email: world.ramesh.email,
    name: world.ramesh.name ?? null,
    tenantId: world.tenant1.id,
    businessId: world.business1.id,
  });
}

/** A date `n` days from today, YYYY-MM-DD. */
function day(n: number) {
  const d = new Date(`${businessDay()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const now = () => new Date().toISOString();

async function trackedItem(name: string, opts: { expiry?: boolean } = {}) {
  return caller().item.create({
    name,
    unit: "pcs",
    salePrice: "100",
    purchasePrice: "60",
    trackBatches: true,
    trackExpiry: opts.expiry ?? true,
  } as never);
}

type Line = Record<string, unknown>;
function line(itemId: string, quantity: string, extra: Line = {}) {
  return { itemId, itemName: "Line", quantity, unitPrice: "100.00", taxPercent: "0", discountPercent: "0", ...extra };
}

function purchase(lines: Line[], warehouseId?: string) {
  return caller().invoice.create({
    partyId: world.party1.id,
    type: "purchase",
    invoiceDate: now(),
    warehouseId,
    lineItems: lines,
  } as never);
}

function sale(lines: Line[], warehouseId?: string) {
  return caller().invoice.create({
    partyId: world.party1.id,
    type: "sale",
    invoiceDate: now(),
    warehouseId,
    lineItems: lines,
  } as never);
}

/** Stock per batch number (null = unbatched) in one warehouse, from the ledger. */
async function batchStock(itemId: string, warehouseId = mainId) {
  const rows = (await getTenantTestDb().execute(sql`
    SELECT b.batch_number, SUM(m.quantity::numeric)::text AS qty
    FROM stock_movements m LEFT JOIN item_batches b ON b.id = m.batch_id
    WHERE m.item_id = ${itemId} AND m.warehouse_id = ${warehouseId}
    GROUP BY b.batch_number
  `)) as unknown as Array<{ batch_number: string | null; qty: string }>;
  const out: Record<string, number> = {};
  for (const r of rows) {
    const q = Number(r.qty);
    if (q !== 0) out[r.batch_number ?? "(none)"] = q;
  }
  return out;
}

/** Item total must equal the whole ledger (every batch + unbatched, every warehouse). */
async function expectTotalsAgree(itemId: string) {
  const db = getTenantTestDb();
  const [item] = await db.select({ qty: items.stockQuantity }).from(items).where(eq(items.id, itemId));
  const [ledger] = await db
    .select({ qty: sql<string>`COALESCE(SUM(${stockMovements.quantity}::numeric), 0)::text` })
    .from(stockMovements)
    .where(eq(stockMovements.itemId, itemId));
  expect(Number(item!.qty)).toBe(Number(ledger!.qty));
}

async function lineBatches(invoiceId: string) {
  const rows = (await getTenantTestDb().execute(sql`
    SELECT li.quantity::text AS quantity, b.batch_number
    FROM invoice_items li LEFT JOIN item_batches b ON b.id = li.batch_id
    WHERE li.invoice_id = ${invoiceId}
    ORDER BY li.sort_order
  `)) as unknown as Array<{ quantity: string; batch_number: string | null }>;
  return rows.map((r) => [r.batch_number, Number(r.quantity)]);
}

beforeAll(async () => {
  world = await createTestWorld();
  const settings = await ensureDefaultWarehouse(getTenantTestDb(), world.business1.id);
  mainId = settings.salesWarehouseId as string;
  const [main] = await caller().warehouse.warehouseList();
  const pune = await caller().warehouse.warehouseCreate({
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

describe("items that don't track batches", () => {
  it("move stock exactly as before, with no batch on lines or movements", async () => {
    const item = await caller().item.create({ name: "Plain soap", unit: "pcs", stockQuantity: "20", salePrice: "10" } as never);
    expect(item.trackBatches).toBe(false);
    const inv = await sale([line(item.id, "5", { batchNumber: "IGNORED" })]);
    expect(await lineBatches(inv.id)).toEqual([[null, 5]]);
    const movements = await getTenantTestDb().select().from(stockMovements).where(eq(stockMovements.itemId, item.id));
    expect(movements.every((m) => m.batchId === null)).toBe(true);
    expect(await batchStock(item.id)).toEqual({ "(none)": 15 });
  });
});

describe("batch stock through documents", () => {
  let itemId: string;
  let sale1: string;

  it("an inward line must name its batch, and a new batch needs an expiry when tracked", async () => {
    const item = await trackedItem("Paracetamol 500");
    itemId = item.id;
    await expect(purchase([line(itemId, "10")])).rejects.toThrow(/Enter a batch number/);
    await expect(purchase([line(itemId, "10", { batchNumber: "A1" })])).rejects.toThrow(/expiry date/);
  });

  it("purchases create batches with their dates", async () => {
    await purchase([line(itemId, "10", { batchNumber: "A1", expiryDate: day(60), mfgDate: day(-300), batchMrp: "120" })]);
    await purchase([line(itemId, "5", { batchNumber: "B2", expiryDate: day(20) })]);
    // A batch that is already past its expiry can still be received.
    await purchase([line(itemId, "4", { batchNumber: "C3", expiryDate: day(-5) })]);
    // Buying more of an existing batch adds to it.
    await purchase([line(itemId, "2", { batchNumber: "A1", expiryDate: day(60) })]);
    expect(await batchStock(itemId)).toEqual({ A1: 12, B2: 5, C3: 4 });
    await expectTotalsAgree(itemId);
  });

  it("refuses an expiry that contradicts the batch's", async () => {
    await expect(purchase([line(itemId, "1", { batchNumber: "A1", expiryDate: day(90) })])).rejects.toThrow(/already exists with expiry/);
  });

  it("batch.list shows batches earliest expiry first with their stock and expiry state", async () => {
    const { data, unbatched } = await caller().batch.list({ itemId });
    expect(data.map((b) => b.batchNumber)).toEqual(["C3", "B2", "A1"]);
    expect(data.map((b) => Number(b.quantity))).toEqual([4, 5, 12]);
    expect(data[0]!.expired).toBe(true);
    expect(data[1]!.daysToExpiry).toBe(20);
    expect(data[2]!.mrp).toBe("120.00");
    expect(Number(unbatched)).toBe(0);
  });

  it("a sale with no batch picked takes stock first expiry first out, skipping expired", async () => {
    const inv = await sale([line(itemId, "7")]);
    sale1 = inv.id;
    // Split into one line per batch at the same price.
    expect(await lineBatches(inv.id)).toEqual([["B2", 5], ["A1", 2]]);
    expect(Number(inv.totalAmount)).toBe(700);
    expect(await batchStock(itemId)).toEqual({ A1: 10, C3: 4 });
    await expectTotalsAgree(itemId);
  });

  it("an expired batch only goes out when the user allows it", async () => {
    const { data } = await caller().batch.list({ itemId });
    const c3 = data.find((b) => b.batchNumber === "C3")!;
    await expect(sale([line(itemId, "1", { batchId: c3.id })])).rejects.toThrow(/expired on/);
    await sale([line(itemId, "1", { batchId: c3.id, allowExpired: true })]);
    expect(await batchStock(itemId)).toEqual({ A1: 10, C3: 3 });
  });

  it("never over-issues a picked batch, whatever the negative stock policy", async () => {
    const { data } = await caller().batch.list({ itemId });
    const a1 = data.find((b) => b.batchNumber === "A1")!;
    await expect(sale([line(itemId, "11", { batchId: a1.id })])).rejects.toThrow(/Not enough stock in batch/);
    // Two lines on the same batch count together.
    await expect(sale([line(itemId, "6", { batchId: a1.id }), line(itemId, "5", { batchId: a1.id })])).rejects.toThrow(/Not enough stock in batch/);
    expect(await batchStock(itemId)).toEqual({ A1: 10, C3: 3 });
  });

  it("cancel gives the batches back and reinstate takes the same batches again", async () => {
    await caller().invoice.updateStatus({ id: sale1, status: "cancelled" });
    expect(await batchStock(itemId)).toEqual({ A1: 12, B2: 5, C3: 3 });
    await caller().invoice.updateStatus({ id: sale1, status: "sent" });
    expect(await batchStock(itemId)).toEqual({ A1: 10, C3: 3 });
    await expectTotalsAgree(itemId);
  });

  it("reinstating is refused when its batch has since been sold", async () => {
    await caller().invoice.updateStatus({ id: sale1, status: "cancelled" });
    const { data } = await caller().batch.list({ itemId });
    const b2 = data.find((b) => b.batchNumber === "B2")!;
    const other = await sale([line(itemId, "4", { batchId: b2.id })]);
    await expect(caller().invoice.updateStatus({ id: sale1, status: "sent" })).rejects.toThrow(/batch B2/);
    // Put things back as they were.
    await caller().invoice.delete({ id: other.id });
    await caller().invoice.updateStatus({ id: sale1, status: "sent" });
    expect(await batchStock(itemId)).toEqual({ A1: 10, C3: 3 });
  });

  it("editing a sale counts its own batch stock as available", async () => {
    const { data } = await caller().batch.list({ itemId, includeEmpty: true });
    const a1 = data.find((b) => b.batchNumber === "A1")!;
    const b2 = data.find((b) => b.batchNumber === "B2")!;
    // Holds B2 ×5 and A1 ×2; move it all to A1 ×12 (10 free + its own 2).
    await caller().invoice.update({ id: sale1, lineItems: [line(itemId, "12", { batchId: a1.id })] } as never);
    expect(await batchStock(itemId)).toEqual({ B2: 5, C3: 3 });
    // And back to B2 ×5.
    await caller().invoice.update({ id: sale1, lineItems: [line(itemId, "5", { batchId: b2.id })] } as never);
    expect(await batchStock(itemId)).toEqual({ A1: 12, C3: 3 });
    await expectTotalsAgree(itemId);
  });

  it("deleting a sale returns its batch stock", async () => {
    await caller().invoice.delete({ id: sale1 });
    expect(await batchStock(itemId)).toEqual({ A1: 12, B2: 5, C3: 3 });
    await expectTotalsAgree(itemId);
  });

  it("sales returns bring stock back into the batch; purchase returns take it out", async () => {
    const { data } = await caller().batch.list({ itemId });
    const a1 = data.find((b) => b.batchNumber === "A1")!;
    const b2 = data.find((b) => b.batchNumber === "B2")!;
    const sr = await caller().salesReturn.create({
      partyId: world.party1.id,
      type: "sale",
      invoiceDate: now(),
      lineItems: [line(itemId, "1", { batchId: b2.id })],
    } as never);
    expect(await batchStock(itemId)).toEqual({ A1: 12, B2: 6, C3: 3 });

    const pr = await caller().purchaseReturn.create({
      partyId: world.party1.id,
      type: "purchase",
      invoiceDate: now(),
      lineItems: [line(itemId, "2", { batchId: a1.id })],
    } as never);
    expect(await batchStock(itemId)).toEqual({ A1: 10, B2: 6, C3: 3 });
    await expect(caller().purchaseReturn.create({
      partyId: world.party1.id,
      type: "purchase",
      invoiceDate: now(),
      lineItems: [line(itemId, "50", { batchId: a1.id })],
    } as never)).rejects.toThrow(/Not enough stock in batch/);

    await caller().salesReturn.updateStatus({ id: sr.id, status: "cancelled" });
    await caller().purchaseReturn.delete({ id: pr.id });
    expect(await batchStock(itemId)).toEqual({ A1: 12, B2: 5, C3: 3 });
    await expectTotalsAgree(itemId);
  });

  it("challans and GRNs carry batches too", async () => {
    const grn = await caller().goodsReceiptNote.create({
      partyId: world.party1.id,
      type: "purchase",
      invoiceDate: now(),
      lineItems: [line(itemId, "3", { batchNumber: "D4", expiryDate: day(200) })],
    } as never);
    const challan = await caller().deliveryChallan.create({
      partyId: world.party1.id,
      type: "sale",
      invoiceDate: now(),
      lineItems: [line(itemId, "6")],
    } as never);
    expect(await lineBatches(challan.id)).toEqual([["B2", 5], ["A1", 1]]);
    expect(await batchStock(itemId)).toEqual({ A1: 11, C3: 3, D4: 3 });

    const got = await caller().deliveryChallan.getById({ id: challan.id });
    expect(got!.lineItems.map((l) => l.batch?.batchNumber)).toEqual(["B2", "A1"]);

    await caller().deliveryChallan.delete({ id: challan.id });
    await caller().goodsReceiptNote.delete({ id: grn.id });
    expect(await batchStock(itemId)).toEqual({ A1: 12, B2: 5, C3: 3 });
  });

  it("invoice.getById returns each line's batch and expiry", async () => {
    const inv = await sale([line(itemId, "1")]);
    const got = await caller().invoice.getById({ id: inv.id });
    expect(got!.lineItems[0]!.batch).toMatchObject({ batchNumber: "B2", expiryDate: day(20) });
    await caller().invoice.delete({ id: inv.id });
  });
});

describe("transfers and adjustments", () => {
  let itemId: string;

  it("a transfer moves a batch between warehouses, keeping its number and expiry", async () => {
    const item = await trackedItem("Amoxicillin");
    itemId = item.id;
    await purchase([line(itemId, "10", { batchNumber: "T1", expiryDate: day(100) })]);
    await purchase([line(itemId, "4", { batchNumber: "T0", expiryDate: day(-1) })]);
    const { data } = await caller().batch.list({ itemId });
    const t1 = data.find((b) => b.batchNumber === "T1")!;

    await caller().stock.transfer({
      sourceWarehouseId: mainId,
      destinationWarehouseId: puneId,
      lines: [{ itemId, quantity: "3", batchId: t1.id }],
    });
    expect(await batchStock(itemId, mainId)).toEqual({ T0: 4, T1: 7 });
    expect(await batchStock(itemId, puneId)).toEqual({ T1: 3 });
    await expect(caller().stock.transfer({
      sourceWarehouseId: puneId,
      destinationWarehouseId: mainId,
      lines: [{ itemId, quantity: "4", batchId: t1.id }],
    })).rejects.toThrow(/Not enough stock/);

    const pune = await caller().batch.list({ itemId, warehouseId: puneId });
    expect(pune.data.map((b) => [b.batchNumber, Number(b.quantity)])).toEqual([["T1", 3]]);

    const { data: journal } = await caller().stock.transfers({ page: 1, limit: 10 });
    const entry = journal.find((j) => j.lines.some((l) => l.batchNumber === "T1"))!;
    expect(entry.lines[0]!.expiryDate).toBe(day(100));
  });

  it("a sale from the other warehouse takes that warehouse's batches", async () => {
    const inv = await sale([line(itemId, "2")], puneId);
    expect(await lineBatches(inv.id)).toEqual([["T1", 2]]);
    expect(await batchStock(itemId, puneId)).toEqual({ T1: 1 });
    // Only 1 left there — a sale of 2 more can't come from batches.
    await getTenantTestDb().update(inventorySettings).set({ negativeStockPolicy: "block" })
      .where(eq(inventorySettings.businessId, world.business1.id));
    await expect(sale([line(itemId, "2")], puneId)).rejects.toThrow(/unexpired batches|Not enough stock/);
    await getTenantTestDb().update(inventorySettings).set({ negativeStockPolicy: "warn" })
      .where(eq(inventorySettings.businessId, world.business1.id));
  });

  it("an adjustment in names its batch; an adjustment out takes the earliest expiry, expired first", async () => {
    await expect(caller().stock.adjust({
      warehouseId: mainId,
      reason: "Found",
      lines: [{ itemId, quantity: "2" }],
    })).rejects.toThrow(/Enter a batch number/);

    await caller().stock.adjust({
      warehouseId: mainId,
      reason: "Found",
      lines: [{ itemId, quantity: "2", newBatch: { batchNumber: "T9", expiryDate: day(300) } }],
    });
    expect(await batchStock(itemId, mainId)).toEqual({ T0: 4, T1: 7, T9: 2 });

    // Writing off 5 takes the expired T0 first, then T1.
    await caller().stock.adjust({ warehouseId: mainId, reason: "Write-off", lines: [{ itemId, quantity: "-5" }] });
    expect(await batchStock(itemId, mainId)).toEqual({ T1: 6, T9: 2 });

    const { data } = await caller().stock.adjustments({ page: 1, limit: 10 });
    const writeOff = data.filter((a) => a.reason === "Write-off");
    expect(writeOff.map((a) => [a.batchNumber, Number(a.quantity)]).sort()).toEqual([["T0", -4], ["T1", -1]]);
    await expectTotalsAgree(itemId);
  });

  it("opening stock of a new item goes into its opening batch", async () => {
    const item = await caller().item.create({
      name: "Cough syrup",
      unit: "btl",
      stockQuantity: "8",
      trackBatches: true,
      trackExpiry: true,
      openingBatch: { batchNumber: "OP1", expiryDate: day(45) },
    } as never);
    expect(await batchStock(item.id)).toEqual({ OP1: 8 });
  });
});

describe("batch reports", () => {
  it("batch-wise stock, expiring soon and expired", async () => {
    const all = await caller().inventoryReports.batchStock({ status: "all", days: 30 });
    const para = all.data.filter((r) => r.name === "Paracetamol 500");
    expect(para.map((r) => [r.batchNumber, r.quantity])).toEqual([["C3", 3], ["B2", 5], ["A1", 12]]);
    expect(para.find((r) => r.batchNumber === "A1")!.value).toBe(1200); // 12 × 100 (bought at 100)
    const byWh = all.data.filter((r) => r.name === "Amoxicillin");
    expect(byWh.map((r) => [r.batchNumber, r.warehouseName, r.quantity])).toEqual([
      ["T1", "Main warehouse", 6],
      ["T1", "Pune godown", 1],
      ["T9", "Main warehouse", 2],
    ]);

    const expiring = await caller().inventoryReports.batchStock({ status: "expiring", days: 30 });
    expect(expiring.data.map((r) => r.batchNumber)).toEqual(["B2"]);
    const expiring50 = await caller().inventoryReports.batchStock({ status: "expiring", days: 50 });
    expect(expiring50.data.map((r) => r.batchNumber).sort()).toEqual(["B2", "OP1"]);

    const expired = await caller().inventoryReports.batchStock({ status: "expired", days: 30 });
    expect(expired.data.map((r) => [r.batchNumber, r.quantity, r.expired])).toEqual([["C3", 3, true]]);
    expect(expired.data[0]!.daysToExpiry).toBe(-5);

    const one = await caller().inventoryReports.batchStock({ status: "all", days: 30, warehouseId: puneId });
    expect(one.data.map((r) => r.batchNumber)).toEqual(["T1"]);
  });
});

describe("converting documents keeps the batch", () => {
  it("a challan billed as an invoice keeps its batches without moving stock again", async () => {
    const item = await trackedItem("Ointment");
    await purchase([line(item.id, "5", { batchNumber: "O1", expiryDate: day(40) })]);
    const challan = await caller().deliveryChallan.create({
      partyId: world.party1.id,
      type: "sale",
      invoiceDate: now(),
      lineItems: [line(item.id, "3")],
    } as never);
    const inv = await caller().document.convert({ sourceDocumentId: challan.id, targetDocumentType: "invoice" });
    expect(await lineBatches(inv.id)).toEqual([["O1", 3]]);
    expect(await batchStock(item.id)).toEqual({ O1: 2 });
  });

  it("a purchase return made from a bill takes the goods out of their batch, even an expired one", async () => {
    const item = await trackedItem("Eye drops");
    const bill = await purchase([line(item.id, "6", { batchNumber: "E0", expiryDate: day(-2) })]);
    const pr = await caller().document.convert({ sourceDocumentId: bill.id, targetDocumentType: "purchase_return" });
    expect(await lineBatches(pr.id)).toEqual([["E0", 6]]);
    expect(await batchStock(item.id)).toEqual({});
    await expectTotalsAgree(item.id);
  });
});

describe("batches with free goods and GRN rejections", () => {
  it("a GRN brings only accepted + free goods into the batch; rejected goods never enter it", async () => {
    const item = await trackedItem("Cetirizine");
    const grn = await caller().goodsReceiptNote.create({
      partyId: world.party1.id,
      type: "purchase",
      invoiceDate: now(),
      lineItems: [line(item.id, "10", {
        freeQuantity: "2", rejectedQuantity: "3", rejectionReason: "Damaged",
        batchNumber: "CZ1", expiryDate: day(90),
      })],
    } as never);
    expect(await batchStock(item.id)).toEqual({ CZ1: 12 });

    // A GRN line rejected in full brings nothing in and needs no batch.
    await caller().goodsReceiptNote.create({
      partyId: world.party1.id,
      type: "purchase",
      invoiceDate: now(),
      lineItems: [line(item.id, "0", { rejectedQuantity: "4", rejectionReason: "Wrong item" })],
    } as never);
    expect(await batchStock(item.id)).toEqual({ CZ1: 12 });

    // Returning the rejected goods moves no stock and touches no batch.
    const pr = await caller().document.convert({ sourceDocumentId: grn.id, targetDocumentType: "purchase_return", fromRejected: true });
    expect(pr.documentType).toBe("purchase_return");
    expect(await batchStock(item.id)).toEqual({ CZ1: 12 });
    await expectTotalsAgree(item.id);
  });

  it("free goods on a sale come out of batches FEFO and a split keeps billed + free", async () => {
    const item = await trackedItem("Loratadine");
    await purchase([line(item.id, "4", { batchNumber: "L1", expiryDate: day(10) })]);
    await purchase([line(item.id, "20", { batchNumber: "L2", expiryDate: day(100) })]);
    // 5 billed + 1 free = 6 out: 4 from L1 (all billed), then 1 billed + 1 free from L2.
    const inv = await sale([line(item.id, "5", { freeQuantity: "1" })]);
    const rows = (await getTenantTestDb().execute(sql`
      SELECT b.batch_number, li.quantity::text AS q, li.free_quantity::text AS f
      FROM invoice_items li JOIN item_batches b ON b.id = li.batch_id
      WHERE li.invoice_id = ${inv.id} ORDER BY li.sort_order
    `)) as unknown as Array<{ batch_number: string; q: string; f: string }>;
    expect(rows.map((r) => [r.batch_number, Number(r.q), Number(r.f)])).toEqual([["L1", 4, 0], ["L2", 1, 1]]);
    // Only the billed 5 are priced.
    expect(Number(inv.totalAmount)).toBe(500);
    expect(await batchStock(item.id)).toEqual({ L2: 18 });

    // A picked batch counts free goods towards what it must hold.
    const { data } = await caller().batch.list({ itemId: item.id });
    await expect(sale([line(item.id, "18", { freeQuantity: "1", batchId: data[0]!.id })])).rejects.toThrow(/Not enough stock in batch/);

    await caller().invoice.updateStatus({ id: inv.id, status: "cancelled" });
    expect(await batchStock(item.id)).toEqual({ L1: 4, L2: 20 });
    await expectTotalsAgree(item.id);
  });

  it("receiving a purchase order records the batch for accepted and free goods", async () => {
    const item = await trackedItem("Ibuprofen");
    const po = await caller().purchaseOrder.create({
      partyId: world.party1.id,
      type: "purchase",
      invoiceDate: now(),
      lineItems: [line(item.id, "20", { freeQuantity: "2" })],
    } as never);
    const f = await caller().orders.fulfilment({ id: po.id });
    expect(f.batchItems[item.id]).toEqual({ trackExpiry: true });
    await expect(caller().document.convert({
      sourceDocumentId: po.id,
      targetDocumentType: "goods_receipt_note",
      lines: [{ sourceLineId: f.lines[0]!.lineId, quantity: "15", freeQuantity: "2", rejectedQuantity: "5", rejectionReason: "Damaged" }],
    })).rejects.toThrow(/Enter a batch number/);
    await caller().document.convert({
      sourceDocumentId: po.id,
      targetDocumentType: "goods_receipt_note",
      lines: [{
        sourceLineId: f.lines[0]!.lineId, quantity: "15", freeQuantity: "2", rejectedQuantity: "5", rejectionReason: "Damaged",
        batchNumber: "IB7", expiryDate: day(365),
      }],
    });
    expect(await batchStock(item.id)).toEqual({ IB7: 17 });
  });
});

describe("batch master", () => {
  it("creates, corrects and deletes an unused batch; refuses to delete a used one", async () => {
    const item = await trackedItem("Vitamin C", { expiry: false });
    const b = await caller().batch.create({ itemId: item.id, batchNumber: "V1", mfgDate: day(-10) });
    await expect(caller().batch.create({ itemId: item.id, batchNumber: "V1" })).rejects.toThrow(/already has batch/);
    await expect(caller().batch.update({ id: b.id, expiryDate: day(-20) })).rejects.toThrow(/before the manufacturing date/);
    const updated = await caller().batch.update({ id: b.id, batchNumber: "V1-A", expiryDate: day(365) });
    expect(updated.batchNumber).toBe("V1-A");

    // Without expiry tracking a new batch doesn't need a date.
    await purchase([line(item.id, "3", { batchNumber: "V2" })]);
    const { data } = await caller().batch.list({ itemId: item.id, includeEmpty: true });
    const v2 = data.find((x) => x.batchNumber === "V2")!;
    await expect(caller().batch.delete({ id: v2.id })).rejects.toThrow(/can't be deleted/);
    await caller().batch.delete({ id: b.id });
    const after = await caller().batch.list({ itemId: item.id, includeEmpty: true });
    expect(after.data.map((x) => x.batchNumber)).toEqual(["V2"]);
  });

  it("refuses a batch of another item", async () => {
    const a = await trackedItem("Item A");
    const b = await trackedItem("Item B");
    await purchase([line(a.id, "2", { batchNumber: "X1", expiryDate: day(10) })]);
    const { data } = await caller().batch.list({ itemId: a.id });
    await expect(sale([line(b.id, "1", { batchId: data[0]!.id })])).rejects.toThrow(/doesn't belong/);
  });

  it("switching tracking off leaves the batches but stops asking for them", async () => {
    const item = await trackedItem("Switchable");
    await caller().item.update({ id: item.id, data: { trackBatches: false } } as never);
    const [row] = await getTenantTestDb().select().from(items).where(eq(items.id, item.id));
    expect(row!.trackBatches).toBe(false);
    expect(row!.trackExpiry).toBe(false);
    const inv = await purchase([line(item.id, "2")]);
    const lines = await getTenantTestDb().select().from(invoiceItems)
      .where(and(eq(invoiceItems.invoiceId, inv.id), isNull(invoiceItems.batchId)));
    expect(lines).toHaveLength(1);
  });
});

describe("invoice PDF", () => {
  it("shows the batch and expiry under the line", () => {
    const data = {
      lineItems: [
        { itemName: "Paracetamol", description: "Strip of 10", batchNumber: "A1", expiryDate: "2027-03-31", quantity: "1", unitPrice: "1", taxPercent: "0", taxAmount: "0", discountPercent: "0", totalAmount: "1" },
        { itemName: "Soap", quantity: "1", unitPrice: "1", taxPercent: "0", taxAmount: "0", discountPercent: "0", totalAmount: "1" },
      ],
    } as unknown as InvoicePDFData;
    const out = withBatchNotes(data);
    expect(out.lineItems[0]!.description).toBe("Strip of 10 · Batch A1 · Exp 03/2027");
    expect(out.lineItems[1]!.description).toBeUndefined();
  });
});
