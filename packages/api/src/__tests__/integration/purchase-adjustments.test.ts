/**
 * What goes back to a supplier — a purchase return, the supplier's credit
 * note, our debit note — takes off what we owe and the ITC we claimed, the
 * same way everywhere the app shows it (found by the J5 purchase journey):
 *
 *   - the ITC ledger gets an entry with the negative of its tax, so the ITC
 *     dashboard and GSTR-3B table 4 net it off as the GST page's GSTR-3B
 *     does; cancelling or deleting the document removes the entry;
 *   - a purchase-side debit note (made from goods rejected on a GRN, "claims
 *     the value back") reduces the supplier's balance and ITC, as the derived
 *     journal always posted it, instead of adding to them;
 *   - in the party ledger a payment made to a supplier is a debit, and a
 *     deleted payment is not there at all.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { itcLedgerEntries } from "@fintranzact/db";
import { getTenantTestDb, truncateAllTables } from "../helpers/test-db.js";
import { createTestWorld, createParty, type TestWorld } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { istReturnPeriod } from "@fintranzact/shared";
import { splitItc } from "../../lib/itc-reversal.js";

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
const period = istReturnPeriod(new Date());
const [year, month] = period.split("-").map(Number) as [number, number];

/** 10 capsules at ₹80 + 12% on a purchase invoice, sent. */
async function bill() {
  const item = await caller().item.create({
    name: `Capsules ${Math.random().toString(36).slice(2, 8)}`,
    unit: "box",
    stockQuantity: "0",
    salePrice: "120",
    purchasePrice: "80",
  } as never);
  const inv = await caller().invoice.create({
    partyId: supplierId,
    type: "purchase",
    invoiceDate: now(),
    lineItems: [{ itemId: item.id, itemName: "Capsules", quantity: "10", unitPrice: "80.00", taxPercent: "12", discountPercent: "0" }],
  } as never);
  await caller().invoice.updateStatus({ id: inv.id, status: "sent" });
  return { item, inv };
}

function lineOf(itemId: string, quantity: string) {
  return { itemId, itemName: "Capsules", quantity, unitPrice: "80.00", taxPercent: "12", discountPercent: "0" };
}

async function itcOf(documentId: string) {
  return getTenantTestDb()
    .select({ status: itcLedgerEntries.status, cgst: itcLedgerEntries.cgst, sgst: itcLedgerEntries.sgst, igst: itcLedgerEntries.igst })
    .from(itcLedgerEntries)
    .where(and(eq(itcLedgerEntries.businessId, world.business1.id), eq(itcLedgerEntries.invoiceId, documentId)));
}

async function supplierBalance() {
  return parseFloat((await caller().party.getById({ id: supplierId }))!.balance as unknown as string);
}

beforeAll(async () => {
  world = await createTestWorld();
  // Maharashtra, like business1: CGST + SGST.
  const supplier = await createParty(getTenantTestDb(), world.business1.id, { type: "supplier", name: "Bhiwandi Pharma" });
  supplierId = supplier.id;
});

afterAll(async () => {
  await truncateAllTables();
});

describe("splitItc", () => {
  it("halves tax within the state (CGST the lower half paisa), else all IGST", () => {
    expect(splitItc("57.60", true)).toEqual({ cgst: 28.8, sgst: 28.8, igst: 0 });
    expect(splitItc("0.05", true)).toEqual({ cgst: 0.03, sgst: 0.02, igst: 0 });
    expect(splitItc("48.00", false)).toEqual({ cgst: 0, sgst: 0, igst: 48 });
  });
});

describe("returns, notes and ITC", () => {
  it("a purchase return takes its ITC back while it stands", async () => {
    const { item, inv } = await bill();
    expect(await itcOf(inv.id)).toEqual([{ status: "available", cgst: "48.00", sgst: "48.00", igst: "0.00" }]);

    const ret = await caller().purchaseReturn.create({
      partyId: supplierId,
      type: "purchase",
      invoiceDate: now(),
      referenceDocumentId: inv.id,
      lineItems: [lineOf(item.id, "2")],
    } as never);
    // 2 × 80 × 12% = 19.20 back
    expect(await itcOf(ret.id)).toEqual([{ status: "available", cgst: "-9.60", sgst: "-9.60", igst: "0.00" }]);

    const t4 = await caller().itc.gstr3bTable4({ year, month });
    const r3b = await caller().gst.gstr3b({ year, month });
    expect(parseFloat(t4.itcAvailable.allOther.centralTax)).toBeCloseTo(r3b.itc.cgst, 2);
    expect(parseFloat(t4.itcAvailable.allOther.stateTax)).toBeCloseTo(r3b.itc.sgst, 2);

    await caller().purchaseReturn.updateStatus({ id: ret.id, status: "cancelled" });
    expect(await itcOf(ret.id)).toEqual([]);
    await caller().purchaseReturn.updateStatus({ id: ret.id, status: "sent" });
    expect(await itcOf(ret.id)).toHaveLength(1);
    await caller().purchaseReturn.delete({ id: ret.id });
    expect(await itcOf(ret.id)).toEqual([]);
  });

  it("our debit note to a supplier reduces what we owe and the ITC, everywhere", async () => {
    const before = await supplierBalance();
    const r3bBefore = await caller().gst.gstr3b({ year, month });
    const { item, inv } = await bill(); // 896.00
    expect(await supplierBalance()).toBeCloseTo(before + 896, 2);

    const dn = await caller().debitNote.create({
      partyId: supplierId,
      type: "purchase",
      invoiceDate: now(),
      lineItems: [lineOf(item.id, "1")], // 89.60, tax 9.60
    } as never);
    expect(await supplierBalance()).toBeCloseTo(before + 896 - 89.6, 2);
    expect(await itcOf(dn.id)).toEqual([{ status: "available", cgst: "-4.80", sgst: "-4.80", igst: "0.00" }]);

    // GSTR-3B: +96 for the bill, −9.60 for the note.
    const r3b = await caller().gst.gstr3b({ year, month });
    expect(r3b.itc.total - r3bBefore.itc.total).toBeCloseTo(86.4, 2);

    // The party's ledger: the debit note is a debit, like a return.
    const ledger = await caller().party.ledger({ partyId: supplierId, page: 1, limit: 100 });
    const entry = ledger.data.find((e) => e.documentNumber === dn.invoiceNumber)!;
    expect(parseFloat(entry.debit)).toBeCloseTo(89.6, 2);
    expect(parseFloat(entry.credit)).toBe(0);
    const report = await caller().party.ledgerReport({ partyId: supplierId });
    const line = report!.entries.find((e) => e.number === dn.invoiceNumber)!;
    expect(parseFloat(line.debit)).toBeCloseTo(89.6, 2);

    // And the dashboard's payable.
    const listed = await caller().party.list({ filter: "supplier", page: 1, limit: 50 });
    const row = listed.data.find((p) => p.id === supplierId)!;
    expect(parseFloat(String(row.balance))).toBeCloseTo(await supplierBalance(), 2);
    expect(inv.totalAmount).toBe("896.00");
  });

  it("a payment made to a supplier is a debit in the ledger; a deleted one is gone", async () => {
    const { inv } = await bill();
    const pay = await caller().payment.create({ partyId: supplierId, invoiceId: inv.id, amount: "896.00", mode: "bank" });
    let ledger = await caller().party.ledger({ partyId: supplierId, page: 1, limit: 100 });
    const entry = ledger.data.find((e) => e.documentId === pay.id)!;
    expect(parseFloat(entry.debit)).toBeCloseTo(896, 2);
    expect(parseFloat(entry.credit)).toBe(0);
    // Billed 896 (credit), paid 896 (debit): this bill nets to nothing.
    const billEntry = ledger.data.find((e) => e.documentId === inv.id)!;
    expect(parseFloat(billEntry.credit)).toBeCloseTo(896, 2);

    await caller().payment.delete({ id: pay.id });
    ledger = await caller().party.ledger({ partyId: supplierId, page: 1, limit: 100 });
    expect(ledger.data.find((e) => e.documentId === pay.id)).toBeUndefined();
    const report = await caller().party.ledgerReport({ partyId: supplierId });
    expect(report!.entries.find((e) => e.documentId === pay.id)).toBeUndefined();
  });
});
