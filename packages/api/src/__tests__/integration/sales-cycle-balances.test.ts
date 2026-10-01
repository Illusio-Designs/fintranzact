/**
 * sales-cycle-balances.test.ts — What a customer owes through a sales cycle,
 * and what a payment may settle. Regression tests for bugs the J4 end-to-end
 * journey (e2e/journeys/j4) found:
 *
 *   - a customer's balance (parties list, party panel, the "outstanding"
 *     filter) and the dashboard's receivable added up quotations, proforma
 *     invoices and delivery challans as if they were bills, so a quotation →
 *     challan → invoice cycle showed three times what was owed;
 *   - a payment could be allocated more than its own amount, marking an
 *     invoice paid that was only part paid.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestWorld, createItem, createParty, type TestWorld } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";

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

const line = (itemId: string) => ({
  itemId,
  itemName: "Steel Bracket",
  quantity: "10",
  unitPrice: "1000.00",
  taxPercent: "18.00",
  discountPercent: "0",
});

describe("customer balance through quotation → challan → invoice", () => {
  it("counts the invoice alone, not the quotation, proforma or challan it came through", async () => {
    const api = caller();
    const db = getTenantTestDb();
    const party = await createParty(db, world.business1.id, { name: "Balance Cycle Customer", gstin: null });
    const item = await createItem(db, world.business1.id, { name: "Balance Cycle Bracket", stockQuantity: "50.000" });
    const base = { partyId: party.id, type: "sale" as const, invoiceDate: new Date().toISOString(), lineItems: [line(item.id)] };

    const before = await api.dashboard.summary({});

    await api.quotation.create(base);
    await api.proforma.create(base);
    const challan = await api.deliveryChallan.create(base);
    const invoice = await api.document.convert({ sourceDocumentId: challan.id, targetDocumentType: "invoice" });

    const detail = await api.party.getById({ id: party.id });
    expect(detail!.balance).toBe("11800.00");
    const list = await api.party.list({ search: "Balance Cycle Customer", page: 1, limit: 10 });
    expect(Number(list.data[0]!.balance)).toBe(11800);
    const outstanding = await api.party.list({ filter: "outstanding", search: "Balance Cycle Customer", page: 1, limit: 10 });
    expect(outstanding.data.map((p: { id: string }) => p.id)).toEqual([party.id]);

    const after = await api.dashboard.summary({});
    expect(Number(after.receivable) - Number(before.receivable)).toBe(11800);

    // Paid in full: nothing owed, and the party is no longer outstanding.
    await api.payment.create({
      partyId: party.id,
      amount: "11800.00",
      mode: "cash",
      allocations: [{ invoiceId: invoice.id, amount: "11800.00" }],
    });
    expect((await api.party.getById({ id: party.id }))!.balance).toBe("0.00");
    const none = await api.party.list({ filter: "outstanding", search: "Balance Cycle Customer", page: 1, limit: 10 });
    expect(none.data).toEqual([]);
  });

  it("takes a credit note off the outstanding filter's total", async () => {
    const api = caller();
    const db = getTenantTestDb();
    const party = await createParty(db, world.business1.id, { name: "Credited Customer", gstin: null });
    const item = await createItem(db, world.business1.id, { name: "Credited Bracket", stockQuantity: "50.000" });
    const invoice = await api.invoice.create({
      partyId: party.id,
      type: "sale",
      invoiceDate: new Date().toISOString(),
      lineItems: [line(item.id)],
    });
    await api.creditNote.create({
      partyId: party.id,
      type: "sale",
      invoiceDate: new Date().toISOString(),
      referenceDocumentId: invoice.id,
      lineItems: [line(item.id)],
    });
    // Fully credited: nothing is outstanding.
    expect((await api.party.getById({ id: party.id }))!.balance).toBe("0.00");
    const outstanding = await api.party.list({ filter: "outstanding", search: "Credited Customer", page: 1, limit: 10 });
    expect(outstanding.data).toEqual([]);
  });
});

describe("payment allocations", () => {
  it("can't allocate more than the payment's amount", async () => {
    const api = caller();
    const db = getTenantTestDb();
    const party = await createParty(db, world.business1.id, { name: "Allocation Customer", gstin: null });
    const item = await createItem(db, world.business1.id, { name: "Allocation Bracket", stockQuantity: "50.000" });
    const invoice = await api.invoice.create({
      partyId: party.id,
      type: "sale",
      invoiceDate: new Date().toISOString(),
      lineItems: [line(item.id)],
    });

    await expect(
      api.payment.create({
        partyId: party.id,
        amount: "5000.00",
        mode: "cash",
        allocations: [{ invoiceId: invoice.id, amount: "11800.00" }],
      }),
    ).rejects.toThrow(/add up to more than the payment/);
    const unpaid = await api.invoice.getById({ id: invoice.id });
    expect(unpaid!.amountPaid).toBe("0.00");

    const payment = await api.payment.create({
      partyId: party.id,
      amount: "5000.00",
      mode: "cash",
      allocations: [{ invoiceId: invoice.id, amount: "5000.00" }],
    });
    expect((await api.invoice.getById({ id: invoice.id }))!.status).toBe("partial");

    // Editing it can't over-allocate either.
    await expect(
      api.payment.update({
        id: payment.id,
        amount: "5000.00",
        allocations: [{ invoiceId: invoice.id, amount: "11800.00" }],
      }),
    ).rejects.toThrow(/add up to more than the payment/);
    const still = await api.invoice.getById({ id: invoice.id });
    expect(still).toMatchObject({ amountPaid: "5000.00", status: "partial" });
  });
});
