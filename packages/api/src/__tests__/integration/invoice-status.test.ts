/**
 * An invoice's status follows what settles it: payments plus its active
 * credit notes and returns. Cancelling, reinstating, deleting or editing a
 * note or return — or recording and removing payments — works the status
 * out again (adjusted / paid / partial / overdue / sent). Draft and cancelled
 * invoices are left alone.
 *
 * Regression: a cancelled or deleted return used to leave its invoice stuck
 * on "adjusted".
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { invoices } from "@fintranzact/db";
import { createTestWorld, createParty, type TestWorld } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { settledInvoiceStatus } from "../../lib/invoice-status.js";

let world: TestWorld;

beforeAll(async () => {
  world = await createTestWorld();
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

function caller() {
  return createTestCaller({
    userId: world.ramesh.id,
    email: world.ramesh.email,
    name: world.ramesh.name ?? null,
    tenantId: world.tenant1.id,
    businessId: world.business1.id,
  });
}

const lineOf = (amount: string) => ({
  itemName: "Service",
  quantity: "1",
  unitPrice: amount,
  taxPercent: "0",
  discountPercent: "0",
});

async function storedStatus(id: string) {
  const [row] = await getTenantTestDb().select({ status: invoices.status }).from(invoices).where(eq(invoices.id, id));
  return row?.status;
}

/** A sent ₹1,000 sale invoice (optionally already past its due date). */
async function sentInvoice(opts: { dueDate?: string; type?: "sale" | "purchase"; partyId?: string } = {}) {
  const c = caller();
  const inv = await c.invoice.create({
    partyId: opts.partyId ?? world.party1.id,
    type: opts.type ?? "sale",
    dueDate: opts.dueDate,
    lineItems: [lineOf("1000.00")],
  });
  await c.invoice.updateStatus({ id: inv.id, status: "sent" });
  return inv;
}

async function creditNote(invoiceId: string, amount: string) {
  return caller().creditNote.create({ partyId: world.party1.id, type: "sale", referenceDocumentId: invoiceId, lineItems: [lineOf(amount)] });
}

describe("settledInvoiceStatus", () => {
  const base = { status: "sent" as const, totalAmount: "1000.00", amountPaid: "0", adjusted: "0", dueDate: null };
  it("works the status out from payments and notes", () => {
    expect(settledInvoiceStatus(base)).toBe("sent");
    expect(settledInvoiceStatus({ ...base, adjusted: "1000.00" })).toBe("adjusted");
    expect(settledInvoiceStatus({ ...base, amountPaid: "400", adjusted: "600" })).toBe("paid");
    expect(settledInvoiceStatus({ ...base, amountPaid: "1000" })).toBe("paid");
    // A note covering only part of it leaves the status as it was.
    expect(settledInvoiceStatus({ ...base, adjusted: "250" })).toBe("sent");
    expect(settledInvoiceStatus({ ...base, adjusted: "250", dueDate: new Date("2020-01-01") })).toBe("overdue");
    expect(settledInvoiceStatus({ ...base, dueDate: new Date("2020-01-01") })).toBe("overdue");
    expect(settledInvoiceStatus({ ...base, amountPaid: "10", dueDate: new Date("2020-01-01") })).toBe("partial");
    expect(settledInvoiceStatus({ ...base, status: "unfulfilled" })).toBe("unfulfilled");
  });
});

describe("cancelling and reinstating a note", () => {
  it("takes a credit-noted invoice off adjusted when the note is cancelled, and back when reinstated", async () => {
    const inv = await sentInvoice();
    const cn = await creditNote(inv.id, "1000.00");
    expect(await storedStatus(inv.id)).toBe("adjusted");

    await caller().creditNote.updateStatus({ id: cn.id, status: "cancelled" });
    expect(await storedStatus(inv.id)).toBe("sent");
    expect((await caller().invoice.getById({ id: inv.id }))!.status).toBe("sent");

    await caller().creditNote.updateStatus({ id: cn.id, status: "sent" });
    expect(await storedStatus(inv.id)).toBe("adjusted");
  });

  it("goes back to overdue when the invoice is past due", async () => {
    const inv = await sentInvoice({ dueDate: new Date(Date.now() - 10 * 86_400_000).toISOString() });
    const cn = await creditNote(inv.id, "1000.00");
    expect(await storedStatus(inv.id)).toBe("adjusted");

    await caller().creditNote.updateStatus({ id: cn.id, status: "cancelled" });
    expect(await storedStatus(inv.id)).toBe("overdue");
  });

  it("does the same for a purchase return and its purchase invoice", async () => {
    const supplier = await createParty(getTenantTestDb(), world.business1.id, { type: "supplier", name: "Status Supplier" });
    const bill = await sentInvoice({ type: "purchase", partyId: supplier.id });
    const pr = await caller().purchaseReturn.create({ partyId: supplier.id, type: "purchase", referenceDocumentId: bill.id, lineItems: [lineOf("1000.00")] });
    expect(await storedStatus(bill.id)).toBe("adjusted");

    await caller().purchaseReturn.updateStatus({ id: pr.id, status: "cancelled" });
    expect(await storedStatus(bill.id)).toBe("sent");
  });
});

describe("deleting a note", () => {
  it("takes the invoice off adjusted when its sales return is deleted", async () => {
    const inv = await sentInvoice();
    const sr = await caller().salesReturn.create({ partyId: world.party1.id, type: "sale", referenceDocumentId: inv.id, lineItems: [lineOf("1000.00")] });
    expect(await storedStatus(inv.id)).toBe("adjusted");

    await caller().salesReturn.delete({ id: sr.id });
    expect(await storedStatus(inv.id)).toBe("sent");
  });

  it("works through invoice.delete too", async () => {
    const inv = await sentInvoice();
    const cn = await creditNote(inv.id, "1000.00");
    await caller().invoice.delete({ id: cn.id });
    expect(await storedStatus(inv.id)).toBe("sent");
  });
});

describe("payments together with notes", () => {
  it("is partial, then paid, then partial again, then sent", async () => {
    const c = caller();
    const inv = await sentInvoice();

    const payment = await c.payment.create({ partyId: world.party1.id, invoiceId: inv.id, amount: "400.00", mode: "cash" });
    expect(await storedStatus(inv.id)).toBe("partial");

    const cn = await creditNote(inv.id, "600.00");
    expect(await storedStatus(inv.id)).toBe("paid");

    await c.creditNote.updateStatus({ id: cn.id, status: "cancelled" });
    expect(await storedStatus(inv.id)).toBe("partial");

    await c.payment.delete({ id: payment.id });
    expect(await storedStatus(inv.id)).toBe("sent");
  });

  it("leaves an invoice with only a partial note as sent", async () => {
    const inv = await sentInvoice();
    await creditNote(inv.id, "250.00");
    expect(await storedStatus(inv.id)).toBe("sent");
  });

  it("still moves a draft invoice on when a payment is recorded", async () => {
    const c = caller();
    const inv = await c.invoice.create({ partyId: world.party1.id, type: "sale", lineItems: [lineOf("1000.00")] });
    expect(await storedStatus(inv.id)).toBe("draft");
    await c.payment.create({ partyId: world.party1.id, invoiceId: inv.id, amount: "1000.00", mode: "cash" });
    expect(await storedStatus(inv.id)).toBe("paid");
  });
});

describe("editing a note", () => {
  it("works the invoice out again when the note's total changes", async () => {
    const inv = await sentInvoice();
    const cn = await creditNote(inv.id, "1000.00");
    expect(await storedStatus(inv.id)).toBe("adjusted");

    await caller().invoice.update({ id: cn.id, lineItems: [lineOf("300.00")] });
    expect(await storedStatus(inv.id)).toBe("sent");

    await caller().invoice.update({ id: cn.id, lineItems: [lineOf("1000.00")] });
    expect(await storedStatus(inv.id)).toBe("adjusted");
  });
});

describe("draft and cancelled invoices", () => {
  it("leaves them alone", async () => {
    const c = caller();
    const draft = await c.invoice.create({ partyId: world.party1.id, type: "sale", lineItems: [lineOf("1000.00")] });
    const cnOnDraft = await creditNote(draft.id, "1000.00");
    await c.creditNote.updateStatus({ id: cnOnDraft.id, status: "cancelled" });
    expect(await storedStatus(draft.id)).toBe("draft");

    const cancelled = await sentInvoice();
    const cn = await creditNote(cancelled.id, "500.00");
    await c.invoice.updateStatus({ id: cancelled.id, status: "cancelled" });
    await c.creditNote.updateStatus({ id: cn.id, status: "cancelled" });
    expect(await storedStatus(cancelled.id)).toBe("cancelled");
  });
});
