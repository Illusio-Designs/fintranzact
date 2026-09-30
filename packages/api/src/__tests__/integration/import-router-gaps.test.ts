/**
 * Router gaps: import.* — parties, items, invoices, payments,
 * reconcileDirectPayments and transfers. None of these had an integration
 * test calling the procedure.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { bankAccounts, bankTransactions, invoices, items, parties, paymentAllocations, payments, stockGroups } from "@fintranzact/db";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createTestWorld, type TestWorld } from "../helpers/fixtures.js";
import { callerFor, expectCode } from "../helpers/assertions.js";

let world: TestWorld;
const caller = () => callerFor(world, "ramesh");
const seller = () => callerFor(world, "suresh");
const other = () => callerFor(world, "kiran");
const b1 = () => world.business1.id;

async function itemByName(name: string) {
  const [row] = await getTenantTestDb().select().from(items).where(and(eq(items.businessId, b1()), eq(items.name, name)));
  return row;
}
async function invoiceByNumber(n: string) {
  const [row] = await getTenantTestDb().select().from(invoices).where(and(eq(invoices.businessId, b1()), eq(invoices.invoiceNumber, n)));
  return row;
}

beforeAll(async () => {
  world = await createTestWorld();
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

describe("import.importParties", () => {
  it("creates parties, skipping names that exist (any case) or repeat in the file", async () => {
    const res = await caller().import.importParties({
      parties: [
        { name: "Imported Traders", type: "supplier", gstin: "27AABCI1234R1ZM", openingBalance: "1,250.50" },
        { name: "imported traders" },
        { name: world.party1.name.toUpperCase() },
        { name: "  Second Import  ", city: "Pune" },
      ],
    });
    expect(res).toEqual({ created: 2, skipped: 2, total: 4 });
    const [row] = await getTenantTestDb().select().from(parties).where(and(eq(parties.businessId, b1()), eq(parties.name, "Imported Traders")));
    expect(row).toMatchObject({ type: "supplier", pan: "AABCI1234R", openingBalance: "1250.50", source: "mybillbook" });
    const [trimmed] = await getTenantTestDb().select().from(parties).where(and(eq(parties.businessId, b1()), eq(parties.name, "Second Import")));
    expect(trimmed!.city).toBe("Pune");
  });

  it("validates rows and the batch size; refuses an unknown source", async () => {
    await expectCode(caller().import.importParties({ parties: [{ name: "" }] }), "BAD_REQUEST");
    await expectCode(caller().import.importParties({ parties: Array.from({ length: 5001 }, (_, i) => ({ name: `P${i}` })) }), "BAD_REQUEST");
    await expectCode(caller().import.importParties({ source: "tally-9", parties: [{ name: "X" }] }), "BAD_REQUEST");
  });

  it("is refused to a seller and never touches another business", async () => {
    await expectCode(seller().import.importParties({ parties: [{ name: "Seller import" }] }), "FORBIDDEN");
    const res = await other().import.importParties({ parties: [{ name: "Imported Traders" }] });
    expect(res.created).toBe(1);
  });
});

describe("import.importItems", () => {
  it("creates items at zero stock, maps units, files categories under stock groups, skips duplicates", async () => {
    const res = await caller().import.importItems({
      items: [
        { name: "Imported Rice", unit: "Kgs", salePrice: "60", category: "Grains", stockQuantity: "999" },
        { name: "Imported Rice" },
        { name: "Imported Service", itemType: "service", unit: "hrs" },
      ],
    });
    expect(res).toMatchObject({ created: 2, skipped: 1, total: 3 });
    const rice = await itemByName("Imported Rice");
    expect(rice).toMatchObject({ stockQuantity: "0.000", source: "mybillbook", category: "Grains" });
    expect(rice!.unit).toBe("kg");
    const [group] = await getTenantTestDb().select().from(stockGroups).where(and(eq(stockGroups.businessId, b1()), eq(stockGroups.name, "Grains")));
    expect(rice!.stockGroupId).toBe(group!.id);
  });

  it("re-creates an item whose only match is soft-deleted", async () => {
    await caller().import.importItems({ items: [{ name: "Short-lived" }] });
    const first = await itemByName("Short-lived");
    await getTenantTestDb().update(items).set({ deletedAt: new Date() }).where(eq(items.id, first!.id));
    await expect(caller().import.importItems({ items: [{ name: "Short-lived" }] })).resolves.toMatchObject({ created: 1 });
  });

  it("validates input; seller refused", async () => {
    await expectCode(caller().import.importItems({ items: [{ name: "" }] }), "BAD_REQUEST");
    await expectCode(caller().import.importItems({ items: [{ name: "Bad type", itemType: "digital" as never }] }), "BAD_REQUEST");
    await expectCode(seller().import.importItems({ items: [{ name: "S" }] }), "FORBIDDEN");
  });
});

describe("import.importInvoices", () => {
  it("creates invoices with lines matched to items, posts stock, skips existing numbers and unknown parties", async () => {
    await caller().import.importItems({ items: [{ name: "Imported Widget", unit: "pcs" }] });
    const res = await caller().import.importInvoices({
      invoices: [
        {
          invoiceNumber: "IMP-P-1", invoiceDate: "01/04/2026", partyName: "Imported Traders", type: "purchase", totalAmount: "1000",
          lineItems: [{ itemName: "Imported Widget", description: "Widget", quantity: "10", unitPrice: "100" }],
        },
        {
          invoiceNumber: "IMP-S-1", invoiceDate: "05/04/2026", partyName: world.party1.name, type: "sale", totalAmount: "400",
          lineItems: [{ itemName: "imported widget", description: "Widget", quantity: "4", unitPrice: "100" }],
          charges: [{ label: "Shipping", amount: "50" }],
        },
        { invoiceNumber: "IMP-S-1", invoiceDate: "05/04/2026", partyName: world.party1.name, totalAmount: "1" },
        { invoiceNumber: "IMP-X-1", invoiceDate: "05/04/2026", partyName: "Nobody Ltd", totalAmount: "1" },
      ],
    });
    expect(res).toMatchObject({ created: 2, skipped: 2, total: 4 });
    expect(res.errors).toEqual(['Party "Nobody Ltd" not found for invoice IMP-X-1']);
    expect((await itemByName("Imported Widget"))!.stockQuantity).toBe("6.000");
    expect(await invoiceByNumber("IMP-S-1")).toMatchObject({ status: "sent", source: "mybillbook", additionalCharges: "50.00" });
  });

  it("an invoice without lines gets one line for its total; a zero total imports as paid", async () => {
    await caller().import.importInvoices({
      invoices: [
        { invoiceNumber: "IMP-NOLINES", invoiceDate: "2026-04-10", partyName: world.party1.name, totalAmount: "250" },
        { invoiceNumber: "IMP-ZERO", invoiceDate: "2026-04-10", partyName: world.party1.name, totalAmount: "0" },
      ],
    });
    const inv = await caller().invoice.getById({ id: (await invoiceByNumber("IMP-NOLINES"))!.id });
    expect(inv!.lineItems).toHaveLength(1);
    expect(inv!.lineItems[0]).toMatchObject({ itemName: "Imported: IMP-NOLINES", totalAmount: "250.00" });
    expect((await invoiceByNumber("IMP-ZERO"))!.status).toBe("paid");
  });

  it("imports a cancelled invoice as cancelled, holding no stock", async () => {
    const before = (await itemByName("Imported Widget"))!.stockQuantity;
    await caller().import.importInvoices({
      invoices: [{
        invoiceNumber: "IMP-CANCELLED", invoiceDate: "2026-04-12", partyName: world.party1.name, type: "sale", status: "cancelled", totalAmount: "200",
        lineItems: [{ itemName: "Imported Widget", description: "W", quantity: "2", unitPrice: "100" }],
      }],
    });
    expect((await invoiceByNumber("IMP-CANCELLED"))!.status).toBe("cancelled");
    expect((await itemByName("Imported Widget"))!.stockQuantity).toBe(before);
  });

  it("autoCreatePayments records the paid amount as a payment", async () => {
    await caller().import.importInvoices({
      autoCreatePayments: true,
      defaultPaymentMode: "upi",
      invoices: [{ invoiceNumber: "IMP-PAIDPART", invoiceDate: "2026-04-15", partyName: world.party1.name, totalAmount: "500", amountPaid: "200" }],
    });
    const inv = await invoiceByNumber("IMP-PAIDPART");
    const [p] = await getTenantTestDb().select().from(payments).where(eq(payments.invoiceId, inv!.id));
    expect(p).toMatchObject({ amount: "200.00", mode: "upi", paymentNumber: "IMP-IMP-PAIDPART" });
  });

  it("validates input; seller refused", async () => {
    await expectCode(caller().import.importInvoices({ invoices: [{ invoiceNumber: "", invoiceDate: "2026-01-01", partyName: "X", totalAmount: "1" }] }), "BAD_REQUEST");
    await expectCode(caller().import.importInvoices({ invoices: [{ invoiceNumber: "A", invoiceDate: "2026-01-01", partyName: "X", totalAmount: "1", status: "void" as never }] }), "BAD_REQUEST");
    await expectCode(seller().import.importInvoices({ invoices: [] }), "FORBIDDEN");
  });
});

describe("import.importPayments / reconcileDirectPayments", () => {
  it("allocates a payment to the party's oldest unpaid invoices first, or to the invoices named", async () => {
    await caller().import.importInvoices({
      invoices: [
        { invoiceNumber: "PAY-OLD", invoiceDate: "2026-03-01", partyName: "Imported Traders", totalAmount: "300" },
        { invoiceNumber: "PAY-NEW", invoiceDate: "2026-03-20", partyName: "Imported Traders", totalAmount: "300" },
        { invoiceNumber: "PAY-NAMED", invoiceDate: "2026-03-25", partyName: "Imported Traders", totalAmount: "100" },
      ],
    });
    const res = await caller().import.importPayments({
      payments: [
        { paymentDate: "2026-03-28", partyName: "Imported Traders", amount: "400" },
        { paymentDate: "2026-03-29", partyName: "Imported Traders", amount: "100", invoiceNumbers: ["PAY-NAMED"], paymentNumber: "EXT-9" },
        { paymentDate: "2026-03-29", partyName: "Unknown Party", amount: "1" },
      ],
    });
    expect(res).toMatchObject({ created: 2, skipped: 1 });
    const old = await invoiceByNumber("PAY-OLD");
    const nw = await invoiceByNumber("PAY-NEW");
    const named = await invoiceByNumber("PAY-NAMED");
    expect(old).toMatchObject({ amountPaid: "300.00", status: "paid" });
    expect(nw).toMatchObject({ amountPaid: "100.00", status: "partial" });
    expect(named).toMatchObject({ amountPaid: "100.00", status: "paid" });
    const allocs = await getTenantTestDb().select().from(paymentAllocations).where(eq(paymentAllocations.invoiceId, named!.id));
    expect(allocs).toHaveLength(1);
  });

  it("marks invoices paid in the source as paid when payments fell short", async () => {
    await caller().import.importInvoices({
      invoices: [{ invoiceNumber: "PAY-SRC-PAID", invoiceDate: "2026-03-02", partyName: world.party1.name, totalAmount: "80" }],
    });
    await caller().import.importPayments({ payments: [], paidInvoiceNumbers: ["PAY-SRC-PAID"] });
    expect((await invoiceByNumber("PAY-SRC-PAID"))!.status).toBe("paid");
  });

  it("reconcileDirectPayments creates payments for paid amounts with no payment behind them, once", async () => {
    const [inv] = await getTenantTestDb().insert(invoices).values({
      businessId: b1(), partyId: world.party1.id, type: "sale", status: "paid", documentType: "invoice",
      invoiceNumber: "DIRECT-1", invoiceDate: new Date("2026-02-01"), subtotal: "90", taxAmount: "0", totalAmount: "90",
      amountPaid: "90", source: "mybillbook",
    }).returning();
    const first = await caller().import.reconcileDirectPayments({});
    expect(first.created).toBeGreaterThanOrEqual(1);
    const [p] = await getTenantTestDb().select().from(payments).where(eq(payments.invoiceId, inv!.id));
    expect(p).toMatchObject({ amount: "90.00", mode: "cash" });
    const again = await caller().import.reconcileDirectPayments({});
    expect(again.created).toBe(0);
    await expectCode(seller().import.reconcileDirectPayments({}), "FORBIDDEN");
  });

  it("validates payments; seller refused", async () => {
    await expectCode(caller().import.importPayments({ payments: [{ paymentDate: "2026-01-01", partyName: "", amount: "1" }] }), "BAD_REQUEST");
    await expectCode(caller().import.importPayments({ payments: [{ paymentDate: "2026-01-01", partyName: "X", amount: "1", mode: "card" as never }] }), "BAD_REQUEST");
    await expectCode(seller().import.importPayments({ payments: [] }), "FORBIDDEN");
  });
});

describe("import.importTransfers", () => {
  it("creates the cash and bank accounts it needs and moves money between them", async () => {
    const res = await other().import.importTransfers({
      transfers: [
        { date: "2026-04-01", amount: "500", fromMode: "cash", toMode: "bank" },
        { date: "2026-04-02", amount: "100", fromMode: "bank", toMode: "upi", notes: "Top up" },
        { date: "2026-04-03", amount: "5", fromMode: "cash", toMode: "cash" },
      ],
    });
    expect(res).toMatchObject({ created: 2, total: 3 });
    expect(res.errors).toEqual(["Cannot transfer: cash → cash"]);
    const accts = await getTenantTestDb().select().from(bankAccounts).where(eq(bankAccounts.businessId, world.business2.id));
    const bal = Object.fromEntries(accts.map((a) => [a.accountType, a.currentBalance]));
    expect(bal).toMatchObject({ cash: "-500.00", savings: "400.00", upi: "100.00" });
    const txns = await getTenantTestDb().select().from(bankTransactions).where(eq(bankTransactions.businessId, world.business2.id));
    expect(txns.filter((t) => t.referenceType === "transfer")).toHaveLength(4);
  });

  it("validates input; seller refused", async () => {
    await expectCode(caller().import.importTransfers({ transfers: [{ date: "2026-01-01", amount: "1", fromMode: "cash" } as never] }), "BAD_REQUEST");
    await expectCode(seller().import.importTransfers({ transfers: [] }), "FORBIDDEN");
  });
});
