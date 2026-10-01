/**
 * Regression tests for the writer bugs the Layer 4 data audit found
 * (src/lib/data-audit). Each one names the audit rule that caught it.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { auditLog, bankAccounts, bankTransactions, invoices, itcLedgerEntries, items, parties, stockMovements } from "@fintranzact/db";
import { createCallerFactory } from "../../trpc.js";
import { appRouter } from "../../router.js";
import { createUser, createTenant, addMember } from "../helpers/fixtures.js";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";

const callerFactory = createCallerFactory(appRouter);

function callerFor(user: { id: string; email: string; name: string | null }, tenantId: string, businessId: string | null) {
  return callerFactory({
    user,
    tenantId,
    businessId,
    req: new Request("http://localhost:3000/api/trpc/test", {
      method: "POST",
      headers: new Headers({ "content-type": "application/json", ...(businessId ? { "x-business-id": businessId } : {}) }),
    }),
    resHeaders: new Headers(),
    ipAddress: null,
  });
}

type Caller = ReturnType<typeof callerFor>;
type InvoiceInput = Parameters<Caller["invoice"]["create"]>[0];
type DocInput = Parameters<Caller["creditNote"]["create"]>[0];

let c: Caller;
let businessId: string;
let customer: { id: string };
let supplier: { id: string };
let interSupplier: { id: string };
let product: { id: string };
let service: { id: string };
let bank: { id: string };

const db = () => getTenantTestDb();

beforeAll(async () => {
  const owner = await createUser({ email: `audit.regress.${Date.now()}@example.in`, name: "Regress Owner" });
  const tenant = await createTenant({ name: "Regress Traders" });
  await addMember(tenant.id, owner.id, "owner");
  const u = { id: owner.id, email: owner.email, name: owner.name ?? null };
  const biz = await callerFor(u, tenant.id, null).business.create({
    name: "Regress Traders", phone: "9876543210", address: "1 Fort", city: "Mumbai", state: "Maharashtra", stateCode: "27",
    gstRegistrationType: "regular", gstin: "27AABCU9603R1ZM", pan: "AABCU9603R",
  } as Parameters<Caller["business"]["create"]>[0]);
  businessId = biz.id;
  c = callerFor(u, tenant.id, biz.id);
  customer = await c.party.create({ type: "customer", name: "Local Buyer", gstin: "27AAPFU0939F1ZV", openingBalance: "0" });
  supplier = await c.party.create({ type: "supplier", name: "Local Mill", gstin: "27AABCS1234D1Z5", openingBalance: "0" });
  interSupplier = await c.party.create({ type: "supplier", name: "Gujarat Metals", gstin: "24AAACT2727Q1ZW", openingBalance: "0" });
  product = await c.item.create({ name: "Bottle", hsn: "7323", unit: "pcs", itemMode: "simple", taxPercent: "18", stockQuantity: "100", itemType: "product", taxInclusive: false });
  service = await c.item.create({ name: "Fitting", hsn: "998719", unit: "pcs", itemMode: "simple", taxPercent: "18", stockQuantity: "0", itemType: "service", taxInclusive: false });
  bank = await c.bankAccount.create({ accountName: "SBI", accountType: "current", openingBalance: "1000", isDefault: false });
}, 60_000);

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

async function balanceOf(id: string) {
  const [a] = await db().select({ currentBalance: bankAccounts.currentBalance }).from(bankAccounts).where(eq(bankAccounts.id, id));
  return a!.currentBalance;
}

describe("bank_accounts.balance-reconciles — editing the opening balance", () => {
  it("moves the current balance by the change in opening balance", async () => {
    await c.bankAccount.addTransaction({ bankAccountId: bank.id, type: "deposit", amount: "200" });
    expect(await balanceOf(bank.id)).toBe("1200.00");
    await c.bankAccount.update({ id: bank.id, data: { accountName: "SBI", openingBalance: "1500" } });
    expect(await balanceOf(bank.id)).toBe("1700.00");
    await c.bankAccount.update({ id: bank.id, data: { accountName: "SBI Current" } });
    expect(await balanceOf(bank.id)).toBe("1700.00");
  });
});

describe("payments.bank-posting — payment on account to a supplier", () => {
  it("is money out of the account, like a payment against a purchase bill", async () => {
    const before = parseFloat(await balanceOf(bank.id));
    const pay = await c.payment.create({ partyId: supplier.id, amount: "300", mode: "bank", bankAccountId: bank.id });
    const [txn] = await db().select().from(bankTransactions)
      .where(and(eq(bankTransactions.referenceType, "payment"), eq(bankTransactions.referenceId, pay.id)));
    expect(txn!.type).toBe("withdrawal");
    expect(parseFloat(await balanceOf(bank.id))).toBeCloseTo(before - 300, 2);
  });
});

describe("payments.bank-posting — deleted untracked payments", () => {
  it("are not listed as untracked and are not posted when all untracked payments are assigned", async () => {
    const inv = await c.invoice.create({
      partyId: customer.id, type: "sale",
      lineItems: [{ itemId: product.id, itemName: "Bottle", quantity: "1", unitPrice: "100", taxPercent: "18", discountPercent: "0" }],
    } as InvoiceInput);
    const pay = await c.payment.create({ partyId: customer.id, invoiceId: inv.id, amount: "50", mode: "cash" });
    await c.payment.delete({ id: pay.id });

    const untracked = await c.payment.untrackedPayments({ page: 1, limit: 50 } as Parameters<Caller["payment"]["untrackedPayments"]>[0]);
    expect(untracked.data.map((p: { id: string }) => p.id)).not.toContain(pay.id);

    await c.payment.assignAccount({ allMatching: true, bankAccountId: bank.id });
    const txns = await db().select().from(bankTransactions)
      .where(and(eq(bankTransactions.referenceType, "payment"), eq(bankTransactions.referenceId, pay.id)));
    expect(txns).toHaveLength(0);
  });
});

describe("stock_movements.product-only — services on stock-moving documents", () => {
  it("post no stock movement and leave the service's stock at zero, through create, cancel and reinstate", async () => {
    const inv = await c.invoice.create({
      partyId: customer.id, type: "sale",
      lineItems: [
        { itemId: product.id, itemName: "Bottle", quantity: "2", unitPrice: "100", taxPercent: "18", discountPercent: "0" },
        { itemId: service.id, itemName: "Fitting", quantity: "1", unitPrice: "500", taxPercent: "18", discountPercent: "0" },
      ],
    } as InvoiceInput);
    await c.invoice.updateStatus({ id: inv.id, status: "cancelled" });
    await c.invoice.updateStatus({ id: inv.id, status: "sent" });

    const moves = await db().select().from(stockMovements).where(eq(stockMovements.referenceId, inv.id));
    expect(moves.some((m) => m.itemId === service.id)).toBe(false);
    expect(moves.filter((m) => m.itemId === product.id).reduce((s, m) => s + parseFloat(m.quantity), 0)).toBe(-2);
    const [svc] = await db().select({ stock: items.stockQuantity }).from(items).where(eq(items.id, service.id));
    expect(svc!.stock).toBe("0.000");
  });
});

// Fixed upstream by lib/invoice-status.ts (recomputeReferencedInvoice); kept as a regression test.
describe("invoices.adjusted-status-backed — cancelling or deleting a credit note", () => {
  it("takes the invoice out of 'adjusted' once the notes no longer cover it, and back in on reinstating", async () => {
    const inv = await c.invoice.create({
      partyId: customer.id, type: "sale",
      lineItems: [{ itemId: product.id, itemName: "Bottle", quantity: "1", unitPrice: "100", taxPercent: "18", discountPercent: "0" }],
    } as InvoiceInput);
    await c.invoice.updateStatus({ id: inv.id, status: "sent" });
    const lines = [{ itemId: product.id, itemName: "Bottle", quantity: "1", unitPrice: "100", taxPercent: "18", discountPercent: "0" }];
    const status = async () => (await db().select({ s: invoices.status }).from(invoices).where(eq(invoices.id, inv.id)))[0]!.s;

    const cn = await c.creditNote.create({ partyId: customer.id, type: "sale", referenceDocumentId: inv.id, lineItems: lines } as DocInput);
    expect(await status()).toBe("adjusted");
    await c.creditNote.updateStatus({ id: cn.id, status: "cancelled" });
    expect(await status()).toBe("sent");
    await c.creditNote.updateStatus({ id: cn.id, status: "sent" });
    expect(await status()).toBe("adjusted");

    const sr = await c.salesReturn.create({ partyId: customer.id, type: "sale", referenceDocumentId: inv.id, lineItems: lines } as DocInput)
      .catch(() => null); // already fully adjusted — refused, which is fine
    expect(sr).toBeNull();
    await c.creditNote.delete({ id: cn.id });
    expect(await status()).toBe("sent");
  });
});

describe("itc_ledger_entries.matches-invoice-tax — editing a purchase invoice", () => {
  it("re-computes the ITC claim from the edited lines and party", async () => {
    const bill = await c.invoice.create({
      partyId: interSupplier.id, type: "purchase",
      lineItems: [{ itemId: product.id, itemName: "Bottle", quantity: "10", unitPrice: "100", taxPercent: "18", discountPercent: "0" }],
    } as InvoiceInput);
    const itc = async () => (await db().select().from(itcLedgerEntries).where(eq(itcLedgerEntries.invoiceId, bill.id)));
    expect((await itc())[0]!.igst).toBe("180.00");

    await c.invoice.update({ id: bill.id, lineItems: [{ itemId: product.id, itemName: "Bottle", quantity: "12", unitPrice: "100", taxPercent: "18", discountPercent: "0" }] });
    let rows = await itc();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.igst).toBe("216.00");

    // Same-state supplier: the claim becomes CGST + SGST.
    await c.invoice.update({ id: bill.id, partyId: supplier.id });
    rows = await itc();
    expect([rows[0]!.cgst, rows[0]!.sgst, rows[0]!.igst]).toEqual(["108.00", "108.00", "0.00"]);
  });
});

describe("invoice_items.unit-conversion — switching an item's base unit", () => {
  it("keeps past lines and alternate units in base units per unit, so re-posting a past invoice moves the same stock", async () => {
    const sugar = await c.item.create({
      name: "Sugar", unit: "kg", itemMode: "alt_units", salePrice: "45", taxPercent: "5", stockQuantity: "10", itemType: "product", taxInclusive: false,
      unitVariants: [{ unit: "bag", conversionFactor: 25, salePrice: "1100" }],
    });
    const inv = await c.invoice.create({
      partyId: customer.id, type: "sale",
      lineItems: [{ itemId: sugar.id, itemName: "Sugar", quantity: "2", unitPrice: "45", taxPercent: "5", discountPercent: "0" }],
    } as InvoiceInput);

    // 1 kg = 1000 g
    const switched = await c.item.switchBaseUnit({ id: sugar.id, newUnit: "g", conversionFactor: 1000 });
    expect(switched.stockQuantity).toBe("8000.000");
    const units = Object.fromEntries((switched.unitVariants as Array<{ unit: string; conversionFactor: number }>).map((u) => [u.unit, u.conversionFactor]));
    expect(units).toEqual({ kg: 1000, bag: 25000 });

    const detail = await c.invoice.getById({ id: inv.id });
    expect(detail!.lineItems[0]!.selectedUnit).toBe("kg");
    expect(parseFloat(detail!.lineItems[0]!.conversionFactor!)).toBe(1000);

    // Cancel and reinstate re-post the invoice from its lines.
    await c.invoice.updateStatus({ id: inv.id, status: "cancelled" });
    await c.invoice.updateStatus({ id: inv.id, status: "sent" });
    const [row] = await db().select({ stock: items.stockQuantity }).from(items).where(eq(items.id, sugar.id));
    expect(row!.stock).toBe("8000.000");
  });
});

describe("payment_allocations.same-party-and-business / shipments.links-consistent — changing an invoice's party", () => {
  it("is refused while payments are allocated to it, and takes its shipments along once allowed", async () => {
    const inv = await c.invoice.create({
      partyId: customer.id, type: "sale", charges: [{ label: "Shipping", amount: "80" }],
      lineItems: [{ itemId: product.id, itemName: "Bottle", quantity: "1", unitPrice: "100", taxPercent: "18", discountPercent: "0" }],
    } as InvoiceInput);
    const pay = await c.payment.create({ partyId: customer.id, invoiceId: inv.id, amount: "50", mode: "cash" });
    const other = await c.party.create({ type: "customer", name: "Right Buyer", state: "Maharashtra", stateCode: "27", openingBalance: "0" });

    await expect(c.invoice.update({ id: inv.id, partyId: other.id })).rejects.toThrow(/changing the party/);

    await c.payment.delete({ id: pay.id });
    await c.invoice.update({ id: inv.id, partyId: other.id });
    const shipmentsOf = await c.shipment.list({ invoiceId: inv.id, page: 1, limit: 10 } as Parameters<Caller["shipment"]["list"]>[0]);
    expect(shipmentsOf.data.length).toBe(1);
    expect(shipmentsOf.data.every((s: { partyId: string | null }) => s.partyId === other.id)).toBe(true);
  });
});

describe("parties.gstin-needs-state-code / shipments.links-consistent — merging parties", () => {
  it("carries the state code with a copied GSTIN and moves shipments to the surviving party", async () => {
    const plain = await c.party.create({ type: "customer", name: "Plain Contact", openingBalance: "0" });
    const registered = await c.party.create({ type: "customer", name: "Registered Contact", gstin: "27AAFCR1234M1Z9", openingBalance: "0" });
    const inv = await c.invoice.create({
      partyId: registered.id, type: "sale", charges: [{ label: "Delivery", amount: "60" }],
      lineItems: [{ itemId: product.id, itemName: "Bottle", quantity: "1", unitPrice: "100", taxPercent: "18", discountPercent: "0" }],
    } as InvoiceInput);

    await c.party.merge({ sourceId: registered.id, targetId: plain.id });

    const [merged] = await db().select().from(parties).where(eq(parties.id, plain.id));
    expect(merged!.gstin).toBe("27AAFCR1234M1Z9");
    expect(merged!.stateCode).toBe("27");
    const shipmentsOf = await c.shipment.list({ invoiceId: inv.id, page: 1, limit: 10 } as Parameters<Caller["shipment"]["list"]>[0]);
    expect(shipmentsOf.data.map((s: { partyId: string | null }) => s.partyId)).toEqual([plain.id]);
  });
});

describe("bank_accounts.balance-reconciles — a single 'transfer' bank transaction", () => {
  it("is money out, the same in the balance and in the statement's running balance", async () => {
    const acct = await c.bankAccount.create({ accountName: "Axis", accountType: "current", openingBalance: "500", isDefault: false });
    await c.bankAccount.addTransaction({ bankAccountId: acct.id, type: "deposit", amount: "200" });
    await c.bankAccount.addTransaction({ bankAccountId: acct.id, type: "transfer", amount: "50" });
    expect(await balanceOf(acct.id)).toBe("650.00");
    const stmt = await c.bankAccount.listTransactions({ bankAccountId: acct.id, page: 1, limit: 10 } as Parameters<Caller["bankAccount"]["listTransactions"]>[0]);
    const newest = stmt.data[0] as { type: string; balanceAfter: string };
    expect(newest.type).toBe("transfer");
    expect(parseFloat(newest.balanceAfter)).toBe(650);
  });
});

describe("<table>.audit-trail — stock, warehouse, journal, ITC and batch writers log to the audit trail", () => {
  it("writes an audit entry for each entity they create", async () => {
    const actions = async (entityId: string) =>
      (await db().select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.entityId, entityId))).map((r) => r.action);

    const premise = await c.warehouse.premiseCreate({ name: "Store 2", code: "S2" });
    const wh = await c.warehouse.warehouseCreate({ premiseId: premise.id, name: "Store 2", code: "S2-1", warehouseType: "storage" });
    expect(await actions(premise.id)).toContain("warehouse.premiseCreate");
    expect(await actions(wh.id)).toContain("warehouse.warehouseCreate");

    const settings = await c.stock.settings();
    const main = (settings as { salesWarehouseId: string }).salesWarehouseId;
    const t = await c.stock.transfer({ sourceWarehouseId: main, destinationWarehouseId: wh.id, lines: [{ itemId: product.id, quantity: "1" }] });
    expect(await actions(t.referenceId)).toEqual(["stock.transfer"]);
    await c.stock.adjust({ warehouseId: main, reason: "Count correction", lines: [{ itemId: product.id, quantity: "-1" }] });
    const [adjEntry] = await db().select().from(auditLog).where(and(eq(auditLog.businessId, businessId), eq(auditLog.action, "stock.adjust")));
    expect(adjEntry?.entityId).toBeTruthy();

    const accounts = await c.account.list();
    const je = await c.journal.create({ entryDate: new Date().toISOString(), lines: [{ accountId: accounts[0]!.id, debit: "10", credit: "0" }, { accountId: accounts[1]!.id, debit: "0", credit: "10" }] });
    expect(await actions(je.id)).toContain("journal.create");
    const voided = await c.journal.void({ id: je.id });
    expect(await actions(je.id)).toContain("journal.void");
    expect(await actions(voided.reversingEntry.id)).toContain("journal.create");

    const batch = await c.batch.create({ itemId: product.id, batchNumber: "AUD-1" } as Parameters<Caller["batch"]["create"]>[0]);
    expect(await actions(batch.id)).toContain("batch.create");
  });
});

describe("the Walk-in Customer carries the business's state (place of supply)", () => {
  it("is created in the business's state so over-the-counter sales are intra-state", async () => {
    const [walkIn] = await db().select().from(parties)
      .where(and(eq(parties.businessId, businessId), eq(parties.name, "Walk-in Customer")));
    expect(walkIn!.state).toBe("Maharashtra");
    expect(walkIn!.stateCode).toBe("27");
  });
});
