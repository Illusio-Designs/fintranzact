/**
 * A document reported to the government (an e-invoice IRN or a live e-way
 * bill) is locked in the books: it can't be edited, deleted or cancelled
 * until that filing is cancelled. Payments and other status changes still
 * work, and once the filing is cancelled the document can be changed again.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { ewayBills, invoices } from "@fintranzact/db";
import { getTenantTestDb, truncateAllTables } from "../helpers/test-db.js";
import { createInvoiceWithItems, createTestWorld, type TestWorld } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";

let world: TestWorld;
const owner = () =>
  createTestCaller({
    userId: world.ramesh.id, email: world.ramesh.email, name: world.ramesh.name ?? null,
    tenantId: world.tenant1.id, businessId: world.business1.id,
  });

const line = () => [{ itemId: world.item1.id, itemName: "Cotton", quantity: "2", unitPrice: "250", taxPercent: "5" }];

async function newInvoice() {
  const db = getTenantTestDb();
  return (await createInvoiceWithItems(db, world.business1.id, world.party1.id, line(), { status: "sent" } as never)).invoice.id;
}

beforeAll(async () => {
  world = await createTestWorld();
});

afterAll(async () => {
  await truncateAllTables();
});

describe("invoice with an e-invoice (IRN)", () => {
  let id: string;
  beforeAll(async () => {
    id = await newInvoice();
    await getTenantTestDb().update(invoices)
      .set({ irn: "a".repeat(64), eInvoiceStatus: "generated" })
      .where(eq(invoices.id, id));
  });

  it("can't be edited", async () => {
    await expect(owner().invoice.update({ id, notes: "changed" })).rejects.toThrow(/Cancel the e-invoice first/);
  });

  it("can't be deleted", async () => {
    await expect(owner().invoice.delete({ id })).rejects.toThrow(/Cancel the e-invoice first/);
  });

  it("can't be cancelled in the books", async () => {
    await expect(owner().invoice.updateStatus({ id, status: "cancelled" })).rejects.toThrow(/Cancel the e-invoice first/);
  });

  it("still accepts other status changes", async () => {
    await expect(owner().invoice.updateStatus({ id, status: "overdue" })).resolves.toBeTruthy();
  });

  it("unlocks once the e-invoice is cancelled", async () => {
    await getTenantTestDb().update(invoices).set({ eInvoiceStatus: "cancelled" }).where(eq(invoices.id, id));
    await expect(owner().invoice.update({ id, notes: "now allowed" })).resolves.toBeTruthy();
  });
});

describe("invoice with an e-way bill", () => {
  let id: string;
  let billId: string;
  beforeAll(async () => {
    id = await newInvoice();
    const [bill] = await getTenantTestDb().insert(ewayBills)
      .values({ businessId: world.business1.id, invoiceId: id, ewbNumber: "331000000001", status: "active" })
      .returning();
    billId = bill!.id;
  });

  it("can't be edited, deleted or cancelled while the bill is live", async () => {
    await expect(owner().invoice.update({ id, notes: "changed" })).rejects.toThrow(/Cancel the e-way bill first/);
    await expect(owner().invoice.delete({ id })).rejects.toThrow(/331000000001/);
    await expect(owner().invoice.updateStatus({ id, status: "cancelled" })).rejects.toThrow(/e-way bill/);
  });

  it("unlocks once the e-way bill is cancelled", async () => {
    await getTenantTestDb().update(ewayBills).set({ status: "cancelled" }).where(eq(ewayBills.id, billId));
    await expect(owner().invoice.update({ id, notes: "now allowed" })).resolves.toBeTruthy();
  });

  it("an expired e-way bill doesn't lock the document", async () => {
    const other = await newInvoice();
    await getTenantTestDb().insert(ewayBills)
      .values({ businessId: world.business1.id, invoiceId: other, ewbNumber: "331000000002", status: "expired" });
    await expect(owner().invoice.update({ id: other, notes: "fine" })).resolves.toBeTruthy();
  });
});

describe("delivery challan with a live e-way bill", () => {
  it("can't be cancelled or deleted", async () => {
    const challan = await owner().deliveryChallan.create({
      partyId: world.party1.id,
      type: "sale",
      invoiceDate: new Date().toISOString(),
      lineItems: [{ itemName: "Cotton", quantity: "1", unitPrice: "100", taxPercent: "5", discountPercent: "0" }],
    } as never);
    await getTenantTestDb().insert(ewayBills)
      .values({ businessId: world.business1.id, invoiceId: challan.id, ewbNumber: "331000000003", status: "generated" });
    await expect(owner().deliveryChallan.updateStatus({ id: challan.id, status: "cancelled" } as never)).rejects.toThrow(/e-way bill/);
    await expect(owner().deliveryChallan.delete({ id: challan.id })).rejects.toThrow(/e-way bill/);
  });
});

describe("sellers", () => {
  it("can't edit invoices; owners can", async () => {
    const id = await newInvoice();
    const seller = createTestCaller({
      userId: world.suresh.id, email: world.suresh.email, name: world.suresh.name ?? null,
      tenantId: world.tenant1.id, businessId: world.business1.id,
    });
    await expect(seller.invoice.update({ id, notes: "seller edit" })).rejects.toThrow(/Sellers can't edit invoices/);
    await expect(owner().invoice.update({ id, notes: "owner edit" })).resolves.toBeTruthy();
  });
});
