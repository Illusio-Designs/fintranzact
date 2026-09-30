/**
 * document-permissions.test.ts — CASL role enforcement for non-invoice documents.
 *
 * Quotations, credit/debit notes, delivery challans, proformas, sales/purchase
 * returns and document conversions all live in the invoices table and must be
 * guarded by the same "Invoice" permissions as invoices themselves:
 *   - accountant (legacy "viewer"): read-only → every mutation is FORBIDDEN
 *   - seller: create/read/update but not delete
 *   - owner/admin: full access
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createTestWorld,
  createUser,
  addMember,
  type TestWorld,
  type TestUser,
} from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { truncateAllTables, closeTestDb } from "../helpers/test-db.js";

let world: TestWorld;
let accountant: TestUser;

const documentRouters = [
  "quotation",
  "creditNote",
  "debitNote",
  "deliveryChallan",
  "proforma",
  "salesReturn",
  "purchaseReturn",
] as const;

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
        const type = name === "purchaseReturn" ? "purchase" : "sale";
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
