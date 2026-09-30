/**
 * BDD workflow tests for document conversion chains.
 *
 * These tests verify the REAL workflows users follow when converting
 * documents between types — not isolated CRUD operations.
 *
 * KEY WORKFLOWS:
 *   1. Quotation → Invoice (stock decremented on conversion, not on quotation)
 *   2. Proforma → Invoice (same as quotation — proforma has no stock effect)
 *   3. Delivery Challan → Invoice (skipStockAdjustment — challan already decremented)
 *   4. Invoice → Credit Note (stock incremented — items returned)
 *   5. Invoice → Sales Return (stock incremented)
 *
 * The conversion flow:
 *   document.convert({ sourceDocumentId, targetDocumentType })
 *   → copies all line items from source
 *   → creates new document via target router's .create()
 *   → links via referenceDocumentId
 *   → applies correct stock effect for target type
 *
 * Workflow reference: docs/workflows/WORKFLOW-SPECS.md §7 (Document Conversion)
 * Test case IDs: DOC-01 through DOC-06
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { invoices, items as itemsTable } from "@fintranzact/db";
import {
  createTestWorld,
  createItem,
  type TestWorld,
} from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";

// ── Shared fixture ─────────────────────────────────────────────────────────────

let world: TestWorld;

beforeAll(async () => {
  world = await createTestWorld();
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function callerForRamesh() {
  return createTestCaller({
    userId: world.ramesh.id,
    email: world.ramesh.email,
    name: world.ramesh.name ?? null,
    tenantId: world.tenant1.id,
    businessId: world.business1.id,
  });
}

function isoNow(): string {
  return new Date().toISOString();
}

async function getStockQty(itemId: string): Promise<string> {
  const db = getTenantTestDb();
  const [row] = await db
    .select({ stockQuantity: itemsTable.stockQuantity })
    .from(itemsTable)
    .where(eq(itemsTable.id, itemId))
    .limit(1);
  return row?.stockQuantity ?? "0.000";
}

// =============================================================================
// DOC-01: Quotation → Invoice
// =============================================================================

describe("DOC-01: Quotation → Invoice conversion", () => {
  it("converts a quotation into an invoice — stock decremented only on conversion, referenceDocumentId set", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    // Create an item with known stock
    const item = await createItem(db, world.business1.id, {
      name: "QTN→INV Test Item",
      stockQuantity: "100.000",
      salePrice: "500.00",
      taxPercent: "18.00",
    });

    // Step 1: Create quotation (stockEffect=none — stock should NOT change)
    const quotation = await caller.quotation.create({
      partyId: world.party1.id,
      type: "sale",
      invoiceDate: isoNow(),
      lineItems: [
        {
          itemId: item.id,
          itemName: "Widget A",
          quantity: "10",
          unitPrice: "500.00",
          taxPercent: "18.00",
          discountPercent: "0",
          conversionFactor: null,
          variantId: null,
        },
      ],
    });

    // Stock must be unchanged after quotation
    expect(await getStockQty(item.id)).toBe("100.000");

    // Step 2: Convert quotation → invoice
    const converted = await caller.document.convert({
      sourceDocumentId: quotation.id,
      targetDocumentType: "invoice",
    });

    expect(converted.documentType).toBe("invoice");
    expect(converted.invoiceNumber).toMatch(/^INV-\d{5}$/);

    // The new invoice must reference the source quotation
    const [newInvoice] = await db.select({
      referenceDocumentId: invoices.referenceDocumentId,
      totalAmount: invoices.totalAmount,
      type: invoices.type,
    }).from(invoices).where(eq(invoices.id, converted.id));

    expect(newInvoice!.referenceDocumentId).toBe(quotation.id);
    expect(newInvoice!.type).toBe("sale");

    // Stock should NOW be decremented (invoice creation triggers stock adjustment)
    expect(await getStockQty(item.id)).toBe("90.000");
  });
});

// =============================================================================
// DOC-02: Proforma → Invoice
// =============================================================================

describe("DOC-02: Proforma → Invoice conversion", () => {
  it("proforma has no stock effect, conversion to invoice decrements stock", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    const item = await createItem(db, world.business1.id, {
      name: "PI→INV Test Item",
      stockQuantity: "50.000",
      salePrice: "200.00",
      taxPercent: "12.00",
    });

    // Create proforma (stockEffect=none)
    const proforma = await caller.proforma.create({
      partyId: world.party1.id,
      type: "sale",
      invoiceDate: isoNow(),
      lineItems: [
        {
          itemId: item.id,
          itemName: "Proforma item",
          quantity: "5",
          unitPrice: "200.00",
          taxPercent: "12.00",
          discountPercent: "0",
          conversionFactor: null,
          variantId: null,
        },
      ],
    });

    expect(await getStockQty(item.id)).toBe("50.000");

    // Convert → invoice
    const converted = await caller.document.convert({
      sourceDocumentId: proforma.id,
      targetDocumentType: "invoice",
    });

    expect(converted.documentType).toBe("invoice");
    expect(await getStockQty(item.id)).toBe("45.000");
  });
});

// =============================================================================
// DOC-03: Delivery Challan → Invoice (skipStockAdjustment)
// =============================================================================

describe("DOC-03: Delivery Challan → Invoice — skipStockAdjustment prevents double deduction", () => {
  it("challan decrements stock on create; conversion to invoice does NOT decrement again", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    const item = await createItem(db, world.business1.id, {
      name: "DC→INV Test Item",
      stockQuantity: "200.000",
      salePrice: "300.00",
      taxPercent: "5.00",
    });

    // Step 1: Create delivery challan (stockEffect=decrement)
    const challan = await caller.deliveryChallan.create({
      partyId: world.party1.id,
      type: "sale",
      invoiceDate: isoNow(),
      lineItems: [
        {
          itemId: item.id,
          itemName: "Challan item",
          quantity: "20",
          unitPrice: "300.00",
          taxPercent: "5.00",
          discountPercent: "0",
          conversionFactor: null,
          variantId: null,
        },
      ],
    });

    // Stock decremented by challan: 200 - 20 = 180
    expect(await getStockQty(item.id)).toBe("180.000");

    // Step 2: Convert challan → invoice (must skipStockAdjustment)
    const converted = await caller.document.convert({
      sourceDocumentId: challan.id,
      targetDocumentType: "invoice",
    });

    expect(converted.documentType).toBe("invoice");

    // Stock must still be 180 — NOT 160 (no double deduction)
    expect(await getStockQty(item.id)).toBe("180.000");

    // Verify the invoice has referenceDocumentId linking back to challan
    const [inv] = await db.select({ referenceDocumentId: invoices.referenceDocumentId })
      .from(invoices).where(eq(invoices.id, converted.id));
    expect(inv!.referenceDocumentId).toBe(challan.id);
  });
});

// =============================================================================
// DOC-04: Invoice → Credit Note (financial only — no stock change)
// =============================================================================

describe("DOC-04: Invoice → Credit Note — no stock change on conversion", () => {
  it("creates a credit note from an invoice without changing stock (financial adjustment only)", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    const item = await createItem(db, world.business1.id, {
      name: "INV→CN Test Item",
      stockQuantity: "100.000",
      salePrice: "400.00",
      taxPercent: "18.00",
    });

    // Create sale invoice (stock decremented: 100 - 5 = 95)
    const invoice = await caller.invoice.create({
      partyId: world.party1.id,
      type: "sale",
      invoiceDate: isoNow(),
      lineItems: [
        {
          itemId: item.id,
          itemName: "Sold item",
          quantity: "5",
          unitPrice: "400.00",
          taxPercent: "18.00",
          discountPercent: "0",
          conversionFactor: null,
          variantId: null,
        },
      ],
    });

    expect(await getStockQty(item.id)).toBe("95.000");

    // Convert invoice → credit note (stockEffect=none — financial adjustment only)
    const converted = await caller.document.convert({
      sourceDocumentId: invoice.id,
      targetDocumentType: "credit_note",
    });

    expect(converted.documentType).toBe("credit_note");

    // Stock remains at 95 — credit notes don't affect inventory
    expect(await getStockQty(item.id)).toBe("95.000");
  });
});

// =============================================================================
// DOC-05: Invoice → Sales Return (stock incremented)
// =============================================================================

describe("DOC-05: Invoice → Sales Return — stock incremented on conversion", () => {
  it("creates a sales return from an invoice and increments stock", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    const item = await createItem(db, world.business1.id, {
      name: "INV→SR Test Item",
      stockQuantity: "80.000",
      salePrice: "250.00",
      taxPercent: "5.00",
    });

    // Sale invoice: 80 - 10 = 70
    const invoice = await caller.invoice.create({
      partyId: world.party1.id,
      type: "sale",
      invoiceDate: isoNow(),
      lineItems: [
        {
          itemId: item.id,
          itemName: "Sold goods",
          quantity: "10",
          unitPrice: "250.00",
          taxPercent: "5.00",
          discountPercent: "0",
          conversionFactor: null,
          variantId: null,
        },
      ],
    });

    expect(await getStockQty(item.id)).toBe("70.000");

    // Convert → sales return (stockEffect=increment)
    const converted = await caller.document.convert({
      sourceDocumentId: invoice.id,
      targetDocumentType: "sales_return",
    });

    expect(converted.documentType).toBe("sales_return");
    // 70 + 10 returned = 80
    expect(await getStockQty(item.id)).toBe("80.000");
  });
});

// =============================================================================
// DOC-06: Source document not found
// =============================================================================

describe("DOC-06: Convert from non-existent source", () => {
  it("rejects conversion when source document does not exist", async () => {
    const caller = callerForRamesh();

    await expect(
      caller.document.convert({
        sourceDocumentId: "00000000-0000-0000-0000-000000000099",
        targetDocumentType: "invoice",
      })
    ).rejects.toMatchObject({
      message: "Source document not found",
    });
  });
});

// =============================================================================
// Full chain: Quotation → Delivery Challan → Invoice (multi-step conversion)
// =============================================================================

describe("Full chain: Quotation → Invoice → Credit Note (end-to-end document lifecycle)", () => {
  it("stock follows the complete lifecycle: unchanged → decremented → unchanged (CN is financial)", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    const item = await createItem(db, world.business1.id, {
      name: "Full Chain Item",
      stockQuantity: "50.000",
      salePrice: "1000.00",
      taxPercent: "18.00",
    });

    // 1. Quotation (stock unchanged)
    const quotation = await caller.quotation.create({
      partyId: world.party1.id,
      type: "sale",
      invoiceDate: isoNow(),
      lineItems: [{
        itemId: item.id,
        itemName: "Full chain test",
        quantity: "5",
        unitPrice: "1000.00",
        taxPercent: "18.00",
        discountPercent: "0",
        conversionFactor: null,
        variantId: null,
      }],
    });
    expect(await getStockQty(item.id)).toBe("50.000");

    // 2. Convert quotation → invoice (stock decremented: 50 - 5 = 45)
    const invoice = await caller.document.convert({
      sourceDocumentId: quotation.id,
      targetDocumentType: "invoice",
    });
    expect(await getStockQty(item.id)).toBe("45.000");

    // 3. Convert invoice → credit note (stock unchanged — CN is financial only)
    const creditNote = await caller.document.convert({
      sourceDocumentId: invoice.id,
      targetDocumentType: "credit_note",
    });
    expect(await getStockQty(item.id)).toBe("45.000");

    // Verify the chain of references
    const [inv] = await db.select({ refId: invoices.referenceDocumentId })
      .from(invoices).where(eq(invoices.id, invoice.id));
    expect(inv!.refId).toBe(quotation.id);

    const [cn] = await db.select({ refId: invoices.referenceDocumentId })
      .from(invoices).where(eq(invoices.id, creditNote.id));
    expect(cn!.refId).toBe(invoice.id);
  });
});

// =============================================================================
// Over-credit / over-return server-side guard
// =============================================================================

describe("Server-side guard: CN/SR total must not exceed invoice total", () => {
  let guardItem: Awaited<ReturnType<typeof createItem>>;
  let baseInvoice: { id: string; invoiceNumber: string };

  beforeAll(async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    guardItem = await createItem(db, world.business1.id, {
      name: "Guard Test Widget",
      stockQuantity: "500.000",
      salePrice: "100.00",
      taxPercent: "0",
    });

    // Create a sale invoice for ₹1,000 (10 × ₹100)
    baseInvoice = await caller.invoice.create({
      partyId: world.party1.id,
      type: "sale",
      invoiceDate: isoNow(),
      lineItems: [{
        itemId: guardItem.id,
        itemName: "Guard Test Widget",
        quantity: "10",
        unitPrice: "100.00",
        taxPercent: "0",
        discountPercent: "0",
        conversionFactor: null,
        variantId: null,
      }],
    });
  });

  it("allows a credit note up to the invoice total", async () => {
    const caller = callerForRamesh();
    // CN for ₹500 (5 × ₹100) — should succeed, 50% of ₹1,000
    const cn = await caller.creditNote.create({
      partyId: world.party1.id,
      type: "sale",
      invoiceDate: isoNow(),
      referenceDocumentId: baseInvoice.id,
      lineItems: [{
        itemId: guardItem.id,
        itemName: "Guard Test Widget",
        quantity: "5",
        unitPrice: "100.00",
        taxPercent: "0",
        discountPercent: "0",
      }],
    });
    expect(cn.documentType).toBe("credit_note");
    expect(cn.totalAmount).toBe("500.00");
  });

  it("allows a sales return for the remaining amount", async () => {
    const caller = callerForRamesh();
    // SR for ₹300 (3 × ₹100) — should succeed (₹500 CN + ₹300 SR = ₹800 < ₹1,000)
    const sr = await caller.salesReturn.create({
      partyId: world.party1.id,
      type: "sale",
      invoiceDate: isoNow(),
      referenceDocumentId: baseInvoice.id,
      lineItems: [{
        itemId: guardItem.id,
        itemName: "Guard Test Widget",
        quantity: "3",
        unitPrice: "100.00",
        taxPercent: "0",
        discountPercent: "0",
      }],
    });
    expect(sr.documentType).toBe("sales_return");
    expect(sr.totalAmount).toBe("300.00");
  });

  it("allows another CN exactly up to the remaining limit", async () => {
    const caller = callerForRamesh();
    // Another CN for ₹200 (2 × ₹100) — should succeed (₹500 + ₹300 + ₹200 = ₹1,000)
    const cn2 = await caller.creditNote.create({
      partyId: world.party1.id,
      type: "sale",
      invoiceDate: isoNow(),
      referenceDocumentId: baseInvoice.id,
      lineItems: [{
        itemId: guardItem.id,
        itemName: "Guard Test Widget",
        quantity: "2",
        unitPrice: "100.00",
        taxPercent: "0",
        discountPercent: "0",
      }],
    });
    expect(cn2.totalAmount).toBe("200.00");
  });

  it("rejects a credit note that exceeds the remaining amount", async () => {
    const caller = callerForRamesh();
    // CN for ₹100 — should FAIL (₹500 + ₹300 + ₹200 = ₹1,000 already, nothing remaining)
    await expect(
      caller.creditNote.create({
        partyId: world.party1.id,
        type: "sale",
        invoiceDate: isoNow(),
        referenceDocumentId: baseInvoice.id,
        lineItems: [{
          itemId: guardItem.id,
          itemName: "Guard Test Widget",
          quantity: "1",
          unitPrice: "100.00",
          taxPercent: "0",
          discountPercent: "0",
        }],
      })
    ).rejects.toThrow(/exceeds remaining/i);
  });

  it("rejects a sales return that exceeds the remaining amount", async () => {
    const caller = callerForRamesh();
    // SR for ₹100 — should FAIL (fully adjusted)
    await expect(
      caller.salesReturn.create({
        partyId: world.party1.id,
        type: "sale",
        invoiceDate: isoNow(),
        referenceDocumentId: baseInvoice.id,
        lineItems: [{
          itemId: guardItem.id,
          itemName: "Guard Test Widget",
          quantity: "1",
          unitPrice: "100.00",
          taxPercent: "0",
          discountPercent: "0",
        }],
      })
    ).rejects.toThrow(/exceeds remaining/i);
  });

  it("allows CN without referenceDocumentId (standalone, no limit enforced)", async () => {
    const caller = callerForRamesh();
    // Standalone CN for any amount — no ref, no guard
    const cn = await caller.creditNote.create({
      partyId: world.party1.id,
      type: "sale",
      invoiceDate: isoNow(),
      lineItems: [{
        itemId: guardItem.id,
        itemName: "Guard Test Widget",
        quantity: "999",
        unitPrice: "100.00",
        taxPercent: "0",
        discountPercent: "0",
      }],
    });
    expect(cn.documentType).toBe("credit_note");
  });

  it("conversion via document.convert also respects the limit", async () => {
    const caller = callerForRamesh();
    // baseInvoice is fully adjusted (₹1,000). Converting it to CN should fail.
    await expect(
      caller.document.convert({
        sourceDocumentId: baseInvoice.id,
        targetDocumentType: "credit_note",
      })
    ).rejects.toThrow(/exceeds remaining/i);
  });
});

// =============================================================================
// Document-level discount and round-off
// =============================================================================

describe("Document-level discount and round-off", () => {
  const lineOf = (quantity: string, unitPrice = "100.00", taxPercent = "0") => ({
    itemName: "Discounted line",
    quantity,
    unitPrice,
    taxPercent,
    discountPercent: "0",
    conversionFactor: null,
    variantId: null,
  });

  async function saved(id: string) {
    const [row] = await getTenantTestDb()
      .select({
        subtotal: invoices.subtotal,
        taxAmount: invoices.taxAmount,
        discountAmount: invoices.discountAmount,
        roundOff: invoices.roundOff,
        additionalCharges: invoices.additionalCharges,
        totalAmount: invoices.totalAmount,
      })
      .from(invoices)
      .where(eq(invoices.id, id));
    return row!;
  }

  it("keeps a quotation's discount and round-off, and totals them like an invoice", async () => {
    const caller = callerForRamesh();
    const quotation = await caller.quotation.create({
      partyId: world.party1.id,
      type: "sale",
      invoiceDate: isoNow(),
      invoiceDiscount: "50.00",
      invoiceDiscountType: "amount",
      roundOff: "-0.40",
      lineItems: [lineOf("10", "100.00", "18")],
    });
    // 1000 + 180 tax - 50 - 0.40
    expect(await saved(quotation.id)).toMatchObject({
      subtotal: "1000.00",
      taxAmount: "180.00",
      discountAmount: "50.00",
      roundOff: "-0.40",
      totalAmount: "1129.60",
    });
  });

  it("applies a percent discount on documents made by the factory", async () => {
    const caller = callerForRamesh();
    const order = await caller.salesOrder.create({
      partyId: world.party1.id,
      type: "sale",
      invoiceDate: isoNow(),
      invoiceDiscount: "10",
      invoiceDiscountType: "percent",
      lineItems: [lineOf("5")],
    });
    expect(await saved(order.id)).toMatchObject({ discountAmount: "50.00", totalAmount: "450.00" });
  });

  it("carries discount, round-off and charges through quotation → invoice", async () => {
    const caller = callerForRamesh();
    const quotation = await caller.quotation.create({
      partyId: world.party1.id,
      type: "sale",
      invoiceDate: isoNow(),
      invoiceDiscount: "25.00",
      charges: [{ label: "Freight", amount: "40.00" }],
      roundOff: "0.30",
      lineItems: [lineOf("3")],
    });
    const source = await saved(quotation.id);
    expect(source).toMatchObject({ discountAmount: "25.00", additionalCharges: "40.00", totalAmount: "315.30" });

    const converted = await caller.document.convert({ sourceDocumentId: quotation.id, targetDocumentType: "invoice" });
    expect(await saved(converted.id)).toEqual(source);
  });

  it("carries the discount through sales order → challan → invoice", async () => {
    const caller = callerForRamesh();
    const order = await caller.salesOrder.create({
      partyId: world.party1.id,
      type: "sale",
      invoiceDate: isoNow(),
      invoiceDiscount: "20.00",
      roundOff: "0.50",
      lineItems: [lineOf("4")],
    });
    const challan = await caller.document.convert({ sourceDocumentId: order.id, targetDocumentType: "delivery_challan" });
    expect(await saved(challan.id)).toMatchObject({ discountAmount: "20.00", roundOff: "0.50", totalAmount: "380.50" });

    const bill = await caller.document.convert({ sourceDocumentId: challan.id, targetDocumentType: "invoice" });
    expect(await saved(bill.id)).toMatchObject({ discountAmount: "20.00", roundOff: "0.50", totalAmount: "380.50" });
  });

  it("gives part of an order the matching share of its discount, and no round-off", async () => {
    const caller = callerForRamesh();
    const order = await caller.purchaseOrder.create({
      partyId: world.party1.id,
      type: "purchase",
      invoiceDate: isoNow(),
      invoiceDiscount: "100.00",
      roundOff: "0.25",
      lineItems: [lineOf("10")],
    });
    const full = await caller.purchaseOrder.getById({ id: order.id });
    const grn = await caller.document.convert({
      sourceDocumentId: order.id,
      targetDocumentType: "goods_receipt_note",
      lines: [{ sourceLineId: full!.lineItems[0]!.id, quantity: "4" }],
    });
    // 4 of 10 → 40% of the ₹100 discount.
    expect(await saved(grn.id)).toMatchObject({ subtotal: "400.00", discountAmount: "40.00", roundOff: "0.00", totalAmount: "360.00" });
  });

  it("recomputes the total when only the discount or round-off is edited", async () => {
    const caller = callerForRamesh();
    const proforma = await caller.proforma.create({
      partyId: world.party1.id,
      type: "sale",
      invoiceDate: isoNow(),
      lineItems: [lineOf("2")],
    });
    expect((await saved(proforma.id)).totalAmount).toBe("200.00");

    await caller.invoice.update({ id: proforma.id, invoiceDiscount: "15.00", roundOff: "-0.25" });
    expect(await saved(proforma.id)).toMatchObject({ discountAmount: "15.00", roundOff: "-0.25", totalAmount: "184.75" });

    // Editing the lines keeps the saved discount and round-off.
    await caller.invoice.update({ id: proforma.id, lineItems: [lineOf("3")] });
    expect(await saved(proforma.id)).toMatchObject({ discountAmount: "15.00", roundOff: "-0.25", totalAmount: "284.75" });

    await caller.invoice.update({ id: proforma.id, invoiceDiscount: "10", invoiceDiscountType: "percent" });
    expect(await saved(proforma.id)).toMatchObject({ discountAmount: "30.00", totalAmount: "269.75" });
  });
});
