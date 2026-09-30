/**
 * document-permissions.test.ts — CASL role enforcement for non-invoice documents.
 *
 * Quotations, credit/debit notes, delivery challans, proformas, sales/purchase
 * returns, purchase/sales orders, GRNs, order fulfilment (orders.*) and
 * document conversions all live in the invoices table and must be
 * guarded by the same "Invoice" permissions as invoices themselves:
 *   - accountant (legacy "viewer"): read-only → every mutation is FORBIDDEN
 *   - seller: create/read/update but not delete
 *   - owner/admin: full access
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { invoices } from "@fintranzact/db";
import {
  createTestWorld,
  createUser,
  addMember,
  type TestWorld,
  type TestUser,
} from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { truncateAllTables, closeTestDb, getTenantTestDb } from "../helpers/test-db.js";

let world: TestWorld;
let accountant: TestUser;
let sellerManager: TestUser;

const documentRouters = [
  "quotation",
  "creditNote",
  "debitNote",
  "deliveryChallan",
  "proforma",
  "salesReturn",
  "purchaseReturn",
  "purchaseOrder",
  "salesOrder",
  "goodsReceiptNote",
] as const;

const purchaseSide = new Set<string>(["purchaseReturn", "purchaseOrder", "goodsReceiptNote"]);

function callerFor(user: TestUser) {
  return createTestCaller({
    userId: user.id,
    email: user.email,
    name: user.name ?? null,
    tenantId: world.tenant1.id,
    businessId: world.business1.id,
  });
}

function docInput(type: "sale" | "purchase" = "sale") {
  return {
    partyId: world.party1.id,
    type,
    invoiceDate: new Date().toISOString(),
    lineItems: [
      {
        itemName: "Permission test line",
        quantity: "1",
        unitPrice: "100.00",
        taxPercent: "5.00",
      },
    ],
  };
}

beforeAll(async () => {
  world = await createTestWorld();
  accountant = await createUser({ email: "anita.accounts@acmetrading.in", name: "Anita Accounts" });
  await addMember(world.tenant1.id, accountant.id, "accountant");
  sellerManager = await createUser({ email: "mahesh.manager@acmetrading.in", name: "Mahesh Manager" });
  await addMember(world.tenant1.id, sellerManager.id, "seller_manager");
  // business_members is backfilled from tenant membership on first access,
  // so the accountant becomes a regular ("member") business member.
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

describe("document router role enforcement", () => {
  for (const name of documentRouters) {
    describe(name, () => {
      it("accountant can read but cannot create, update status or delete", async () => {
        const owner = callerFor(world.ramesh);
        const type = purchaseSide.has(name) ? "purchase" : "sale";
        const doc = await owner[name].create(docInput(type));

        const caller = callerFor(accountant);
        await expect(caller[name].list({})).resolves.toBeDefined();
        await expect(caller[name].getById({ id: doc.id })).resolves.toMatchObject({ id: doc.id });

        await expect(caller[name].create(docInput(type))).rejects.toMatchObject({ code: "FORBIDDEN" });
        await expect(
          caller[name].updateStatus({ id: doc.id, status: "cancelled" }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        await expect(caller[name].delete({ id: doc.id })).rejects.toMatchObject({ code: "FORBIDDEN" });

        // Nothing was changed by the rejected calls
        const after = await owner[name].getById({ id: doc.id });
        expect(after?.status).toBe(doc.status);
        expect(after?.deletedAt).toBeNull();
      });
    });
  }

  it("seller can create and update a quotation but cannot delete it", async () => {
    const seller = callerFor(world.suresh);
    const doc = await seller.quotation.create(docInput());
    expect(doc.documentType).toBe("quotation");

    const updated = await seller.quotation.updateStatus({ id: doc.id, status: "sent" });
    expect(updated.status).toBe("sent");

    await expect(seller.quotation.delete({ id: doc.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("owner can delete a credit note", async () => {
    const owner = callerFor(world.ramesh);
    const doc = await owner.creditNote.create(docInput());
    await expect(owner.creditNote.delete({ id: doc.id })).resolves.toMatchObject({ success: true });
  });
});

describe("document.convert role enforcement", () => {
  it("accountant cannot convert a quotation to an invoice or to another document", async () => {
    const owner = callerFor(world.ramesh);
    const quotation = await owner.quotation.create(docInput());

    const caller = callerFor(accountant);
    await expect(
      caller.document.convert({ sourceDocumentId: quotation.id, targetDocumentType: "invoice" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller.document.convert({ sourceDocumentId: quotation.id, targetDocumentType: "proforma" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const challan = await owner.deliveryChallan.create(docInput());
    await expect(
      caller.document.convert({ sourceDocumentId: challan.id, targetDocumentType: "invoice" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("seller can convert a quotation to an invoice", async () => {
    const seller = callerFor(world.suresh);
    const quotation = await seller.quotation.create(docInput());
    const result = await seller.document.convert({
      sourceDocumentId: quotation.id,
      targetDocumentType: "invoice",
    });
    expect(result.documentType).toBe("invoice");
    expect(result.id).toBeTruthy();
  });
});

/** An order with a stocked item on it, so pending quantities are tracked. */
async function orderWithItem(kind: "salesOrder" | "purchaseOrder") {
  const owner = callerFor(world.ramesh);
  const item = await owner.item.create({
    name: `Perm item ${Math.random().toString(36).slice(2, 8)}`,
    unit: "pcs",
    stockQuantity: "20",
    salePrice: "100",
    purchasePrice: "80",
  } as never);
  const order = await owner[kind].create({
    ...docInput(kind === "purchaseOrder" ? "purchase" : "sale"),
    lineItems: [{ itemId: item.id, itemName: item.name, quantity: "4", unitPrice: "100.00", taxPercent: "0" }],
  });
  return { order, item };
}

describe("orders router role enforcement", () => {
  it("accountant can see pending lines and fulfilment but cannot close or reopen", async () => {
    const owner = callerFor(world.ramesh);
    const { order } = await orderWithItem("salesOrder");

    const caller = callerFor(accountant);
    await expect(caller.orders.pending({ documentType: "sales_order" })).resolves.toBeDefined();
    await expect(caller.orders.fulfilment({ id: order.id })).resolves.toMatchObject({ id: order.id });

    await expect(caller.orders.close({ id: order.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await owner.orders.close({ id: order.id });
    await expect(caller.orders.reopen({ id: order.id })).rejects.toMatchObject({ code: "FORBIDDEN" });

    const after = await owner.orders.fulfilment({ id: order.id });
    expect(after.closedAt).not.toBeNull();
  });

  it("seller can short-close and reopen an order", async () => {
    const { order } = await orderWithItem("purchaseOrder");
    const seller = callerFor(world.suresh);
    await expect(seller.orders.close({ id: order.id })).resolves.toMatchObject({ success: true });
    expect((await seller.orders.fulfilment({ id: order.id })).closedAt).not.toBeNull();
    await expect(seller.orders.reopen({ id: order.id })).resolves.toMatchObject({ success: true });
    expect((await seller.orders.fulfilment({ id: order.id })).closedAt).toBeNull();
  });
});

describe("order conversions role enforcement", () => {
  it("accountant cannot convert orders or GRNs into what fulfils them", async () => {
    const owner = callerFor(world.ramesh);
    const caller = callerFor(accountant);
    const { order: so } = await orderWithItem("salesOrder");
    const { order: po } = await orderWithItem("purchaseOrder");
    const grn = await owner.document.convert({ sourceDocumentId: po.id, targetDocumentType: "goods_receipt_note" });

    for (const [source, target] of [
      [so.id, "delivery_challan"],
      [so.id, "invoice"],
      [po.id, "goods_receipt_note"],
      [po.id, "invoice"],
      [grn.id, "invoice"],
    ] as const) {
      await expect(
        caller.document.convert({ sourceDocumentId: source, targetDocumentType: target }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }

    // The rejected conversions left everything pending.
    const pending = await owner.orders.fulfilment({ id: so.id });
    expect(pending.linkedDocuments).toHaveLength(0);
    expect(Number(pending.lines[0]!.pending)).toBe(4);
  });

  it("seller can convert a sales order to a challan and a purchase order to a GRN and invoice", async () => {
    const seller = callerFor(world.suresh);
    const { order: so } = await orderWithItem("salesOrder");
    const challan = await seller.document.convert({ sourceDocumentId: so.id, targetDocumentType: "delivery_challan" });
    expect(challan.documentType).toBe("delivery_challan");

    const { order: po } = await orderWithItem("purchaseOrder");
    const grn = await seller.document.convert({
      sourceDocumentId: po.id,
      targetDocumentType: "goods_receipt_note",
      lines: [{ sourceLineId: (await seller.orders.fulfilment({ id: po.id })).lines[0]!.lineId, quantity: "1" }],
    });
    expect(grn.documentType).toBe("goods_receipt_note");
    const bill = await seller.document.convert({ sourceDocumentId: po.id, targetDocumentType: "invoice" });
    expect(bill.documentType).toBe("invoice");
  });
});

describe("seller_manager document delete limits", () => {
  it("can delete an order within 2 hours of creation but not an older one", async () => {
    const manager = callerFor(sellerManager);
    const fresh = await manager.purchaseOrder.create(docInput("purchase"));
    await expect(manager.purchaseOrder.delete({ id: fresh.id })).resolves.toMatchObject({ success: true });

    const old = await manager.salesOrder.create(docInput());
    await getTenantTestDb()
      .update(invoices)
      .set({ createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000) })
      .where(eq(invoices.id, old.id));
    await expect(manager.salesOrder.delete({ id: old.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await manager.salesOrder.getById({ id: old.id }))?.deletedAt).toBeNull();

    // An admin/owner is not time-limited.
    await expect(callerFor(world.ramesh).salesOrder.delete({ id: old.id })).resolves.toMatchObject({ success: true });
  });

  it("cannot delete a paid credit note", async () => {
    const manager = callerFor(sellerManager);
    const note = await manager.creditNote.create(docInput());
    await manager.creditNote.updateStatus({ id: note.id, status: "paid" });
    await expect(manager.creditNote.delete({ id: note.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
