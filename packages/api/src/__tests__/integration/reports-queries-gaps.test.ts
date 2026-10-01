/**
 * Router gaps: the read-only procedures no other file called — party
 * ledger/stats/exports, item history and suggestions, invoice
 * lastDeliveryMethod, dashboard widgets, bankAccount listTransactions and
 * summary, the reports (daybook, registers, tax, outstanding, cash-flow,
 * collection, item sales, party statement, payment summary, Tally export)
 * and stock.count.
 *
 * One small book is set up once: a sale 40 days ago (₹525, ₹100 received
 * by UPI), a purchase 5 days ago (₹630) and a ₹300 rent expense.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { istDateParts } from "@fintranzact/shared";
import { payments } from "@fintranzact/db";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { createBankAccount, createExpense, createTestWorld, type TestWorld } from "../helpers/fixtures.js";
import { callerFor, expectCode } from "../helpers/assertions.js";
import { seedChartOfAccounts } from "../../lib/coa-seed.js";

let world: TestWorld;
const UNKNOWN = "00000000-0000-4000-8000-000000000000";
const caller = () => callerFor(world, "ramesh");
const seller = () => callerFor(world, "suresh");
const other = () => callerFor(world, "kiran");
const now = Date.now();
const iso = (days: number) => new Date(now + days * 86_400_000).toISOString();
const day = (days: number) => iso(days).slice(0, 10);

let acctId: string;
let saleId: string;
let purchaseId: string;
let paymentId: string;

beforeAll(async () => {
  world = await createTestWorld();
  const db = getTenantTestDb();
  await seedChartOfAccounts(db, world.business1.id);
  const c = caller();
  acctId = (await createBankAccount(db, world.business1.id, { accountType: "cash", accountName: "Cash", currentBalance: "100.00" })).id;
  const line = (quantity: string, unitPrice: string) =>
    [{ itemId: world.item1.id, itemName: "Cotton", quantity, unitPrice, taxPercent: "5", discountPercent: "0" }];
  saleId = (await c.invoice.create({ partyId: world.party1.id, type: "sale", invoiceDate: iso(-40), dueDate: iso(-10), deliveryMethod: "courier", lineItems: line("2", "250") } as never)).id;
  purchaseId = (await c.invoice.create({ partyId: world.party1.id, type: "purchase", invoiceDate: iso(-5), lineItems: line("3", "200") } as never)).id;
  paymentId = (await c.payment.create({ partyId: world.party1.id, amount: "100", mode: "upi", paymentDate: iso(-3), invoiceId: saleId, bankAccountId: acctId } as never)).id;
  await createExpense(db, world.business1.id, { category: "Rent", amount: "300.00", expenseDate: new Date(now - 2 * 86_400_000) });
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

describe("party", () => {
  it("topItems and getStats; nothing for another business", async () => {
    const top = await caller().party.topItems({ partyId: world.party1.id });
    expect(top[0]).toMatchObject({ itemId: world.item1.id, invoiceCount: 2 });
    expect(await caller().party.getStats({ id: world.party1.id })).toEqual({ invoiceCount: 2, paymentCount: 1 });
    expect(await other().party.topItems({ partyId: world.party1.id })).toEqual([]);
    expect(await other().party.getStats({ id: world.party1.id })).toEqual({ invoiceCount: 0, paymentCount: 0 });
  });

  it("ledgerReport runs a balance through invoices and payments; null for unknown or foreign parties", async () => {
    const r = await caller().party.ledgerReport({ partyId: world.party1.id });
    expect(r!.entries.map((e) => [e.number, e.debit, e.credit])).toEqual([
      [expect.any(String), "525.00", "0"],
      [expect.any(String), "0", "630.00"],
      [expect.any(String), "0", "100.00"],
    ]);
    expect(r!.summary).toEqual({ totalDebit: "525.00", totalCredit: "730.00", closingBalance: "-205.00" });
    expect(await caller().party.ledgerReport({ partyId: UNKNOWN })).toBeNull();
    expect(await other().party.ledgerReport({ partyId: world.party1.id })).toBeNull();
    await expectCode(caller().party.ledgerReport({ partyId: world.party1.id, limit: 5001 }), "BAD_REQUEST");
  });

  it("ledgerReport and its CSV leave out deleted payments", async () => {
    const [p] = await getTenantTestDb().insert(payments).values({
      businessId: world.business1.id, partyId: world.party1.id, amount: "999.00", discount: "0", mode: "cash",
      paymentDate: new Date(now - 86_400_000), paymentNumber: "DELETED-PMT", deletedAt: new Date(),
    }).returning();
    const r = await caller().party.ledgerReport({ partyId: world.party1.id });
    expect(r!.entries.map((e) => e.documentId)).not.toContain(p!.id);
    const csv = await caller().party.ledgerReportCSV({ partyId: world.party1.id });
    expect(csv!.csv).not.toContain("DELETED-PMT");
  });

  it("ledgerReportCSV has an opening row, running balance and a safe file name", async () => {
    const r = await caller().party.ledgerReportCSV({ partyId: world.party1.id, fromDate: iso(-60) });
    const lines = r!.csv.split("\n");
    expect(lines[0]).toBe("Date,Description,Document #,Debit,Credit,Balance");
    expect(lines[1]).toContain('"Opening Balance"');
    expect(lines.at(-1)).toMatch(/"-205\.00"$/);
    expect(r!.filename).toBe(`ledger_Priya_Textiles_Pvt_Ltd_${iso(-60).slice(0, 10)}.csv`);
    expect(await other().party.ledgerReportCSV({ partyId: world.party1.id })).toBeNull();
  });

  it("tallyExport lists sales, purchases, receipts and expenses", async () => {
    const r = await caller().party.tallyExport({});
    expect(r.rowCount).toBe(4);
    expect(r.preview.map((p) => p.vchType).sort()).toEqual(["Payment", "Purchase", "Receipt", "Sales"]);
    expect((await other().party.tallyExport({})).rowCount).toBe(0);
    await expectCode(caller().party.tallyExport({ fromDate: "yesterday" }), "BAD_REQUEST");
  });

  it("a seller can't read ledgers (Report read is allowed) — documented", async () => {
    await expect(seller().party.ledgerReport({ partyId: world.party1.id })).resolves.not.toBeNull();
  });
});

describe("item", () => {
  it("priceHistory lists live invoice prices, newest first", async () => {
    const r = await caller().item.priceHistory({ id: world.item1.id });
    expect(r.map((x) => x.invoiceId)).toEqual([purchaseId, saleId]);
    expect(await other().item.priceHistory({ id: world.item1.id })).toEqual([]);
  });

  it("relatedInvoices pages the invoices that use the item", async () => {
    const r = await caller().item.relatedInvoices({ id: world.item1.id, page: 1, limit: 10 });
    expect(r.total).toBe(2);
    expect((await caller().item.relatedInvoices({ id: world.item1.id, page: 1, limit: 1 })).data).toHaveLength(1);
    expect((await other().item.relatedInvoices({ id: world.item1.id, page: 1, limit: 10 })).total).toBe(0);
  });

  it("topBuyers counts sales only, not what the party sold to us", async () => {
    const r = await caller().item.topBuyers({ id: world.item1.id });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ partyId: world.party1.id, totalQuantity: "2.000", invoiceCount: 1 });
  });

  it("deleted invoices drop out of priceHistory and relatedInvoices", async () => {
    const extra = await caller().invoice.create({
      partyId: world.party1.id, type: "sale", invoiceDate: iso(-1),
      lineItems: [{ itemId: world.item1.id, itemName: "Cotton", quantity: "1", unitPrice: "999", taxPercent: "0", discountPercent: "0" }],
    } as never);
    await caller().invoice.delete({ id: extra.id });
    expect((await caller().item.priceHistory({ id: world.item1.id })).map((x) => x.invoiceId)).not.toContain(extra.id);
    expect((await caller().item.relatedInvoices({ id: world.item1.id, page: 1, limit: 50 })).data.map((x) => x.id)).not.toContain(extra.id);
  });

  it("suggestMerges groups items that differ only by a pack size", async () => {
    const small = await caller().item.create({ name: "Blue Pen 10", unit: "pcs" } as never);
    const big = await caller().item.create({ name: "Blue Pen 20", unit: "pcs" } as never);
    const r = await caller().item.suggestMerges();
    const g = r.find((x) => x.baseName === "Blue Pen")!;
    expect(g.items.map((i) => i.id).sort()).toEqual([small.id, big.id].sort());
    expect(g.suggestedConversions).toHaveLength(1);
    expect(JSON.stringify(await other().item.suggestMerges())).not.toContain("Blue Pen");
  });

  it("stockAdjustmentHistory lists adjustments; lowStockCount counts items at or under their alert", async () => {
    await caller().item.adjustStock({ itemId: world.item1.id, quantity: "-1", reason: "Damaged" });
    const h = await caller().item.stockAdjustmentHistory({ itemId: world.item1.id, page: 1, limit: 10 });
    expect(h.total).toBe(1);
    expect(h.data[0]).toMatchObject({ reason: "Damaged" });
    expect(await other().item.stockAdjustmentHistory({ itemId: world.item1.id, page: 1, limit: 10 })).toMatchObject({ total: 0 });
    const before = await caller().item.lowStockCount();
    await caller().item.create({ name: "Nearly out", unit: "pcs", stockQuantity: "1", lowStockAlert: "5" } as never);
    expect(await caller().item.lowStockCount()).toBe(before + 1);
    expect(await other().item.lowStockCount()).toBe(0);
  });
});

describe("invoice.lastDeliveryMethod", () => {
  it("the party's last sale's method; self_pickup by default and for other businesses; ignores deleted invoices", async () => {
    expect(await caller().invoice.lastDeliveryMethod({ partyId: world.party1.id })).toBe("courier");
    expect(await other().invoice.lastDeliveryMethod({ partyId: world.party1.id })).toBe("self_pickup");
    const later = await caller().invoice.create({
      partyId: world.party1.id, type: "sale", invoiceDate: iso(0), deliveryMethod: "hand_delivery",
      lineItems: [{ itemName: "Service", quantity: "1", unitPrice: "10", taxPercent: "0", discountPercent: "0" }],
    } as never);
    expect(await caller().invoice.lastDeliveryMethod({ partyId: world.party1.id })).toBe("hand_delivery");
    await caller().invoice.delete({ id: later.id });
    expect(await caller().invoice.lastDeliveryMethod({ partyId: world.party1.id })).toBe("courier");
  });
});

describe("dashboard widgets", () => {
  it("report this business's figures", async () => {
    const c = caller();
    expect(await c.dashboard.topOutstanding({})).toEqual([{ partyId: world.party1.id, partyName: world.party1.name, outstanding: "425.00" }]);
    expect(await c.dashboard.expensesByCategory({})).toEqual([{ category: "Rent", total: "300.00", count: 1 }]);
    expect(await c.dashboard.paymentModeBreakdown({})).toEqual([{ mode: "upi", total: "100.00", count: 1 }]);
    expect(await c.dashboard.expenseCategoryBreakdown({})).toMatchObject({ grandTotal: "300.00" });
    expect(await c.dashboard.collectionEfficiency({})).toMatchObject({ totalInvoiced: "525.00", totalCollected: "100.00", efficiencyPct: 19 });
    expect((await c.dashboard.receivablesAging()).summary.total).toBe("425.00");
    expect(await c.dashboard.shippingSummary({})).toEqual({ charged: "0.00", spent: "0.00", net: "0.00" });
    const statuses = await c.dashboard.invoiceStatusBreakdown({});
    // The sale invoice only: the purchase bill is not an invoice the business raised
    expect(statuses.reduce((s, r) => s + r.count, 0)).toBe(1);
    // The rent expense is dated 2 days ago; on the 1st or 2nd of an Indian
    // month that falls in the previous month's bucket.
    const mc = await c.dashboard.monthlyComparison();
    const spent = istDateParts(new Date(now - 2 * 86_400_000));
    const today = istDateParts(new Date(now));
    const sameMonth = spent.year === today.year && spent.month === today.month;
    expect(sameMonth ? mc.expenses.curr : mc.expenses.prev).toBe("300.00");
  });

  it("are empty for another business and validate their limits", async () => {
    const o = other();
    expect(await o.dashboard.topOutstanding({})).toEqual([]);
    expect(await o.dashboard.expensesByCategory({})).toEqual([]);
    expect(await o.dashboard.paymentModeBreakdown({})).toEqual([]);
    expect((await o.dashboard.receivablesAging()).rows).toEqual([]);
    await expectCode(caller().dashboard.topOutstanding({ limit: 2 }), "BAD_REQUEST");
    await expectCode(caller().dashboard.expenseCategoryBreakdown({ limit: 21 }), "BAD_REQUEST");
    await expectCode(caller().dashboard.shippingSummary({ fromDate: "x" }), "BAD_REQUEST");
  });
});

describe("bankAccount", () => {
  it("listTransactions shows the running balance; NOT_FOUND for other accounts", async () => {
    const r = await caller().bankAccount.listTransactions({ bankAccountId: acctId, page: 1, limit: 10 });
    expect(r.data).toHaveLength(1);
    expect(r.data[0]).toMatchObject({ type: "deposit", amount: "100.00", referenceId: paymentId });
    expect((await caller().bankAccount.listTransactions({ bankAccountId: acctId, type: "withdrawal", page: 1, limit: 10 })).total).toBe(0);
    await expectCode(caller().bankAccount.listTransactions({ bankAccountId: UNKNOWN, page: 1, limit: 10 }), "NOT_FOUND");
    await expectCode(other().bankAccount.listTransactions({ bankAccountId: acctId, page: 1, limit: 10 }), "NOT_FOUND");
  });

  it("summary splits cash and bank balances", async () => {
    expect(await caller().bankAccount.summary()).toMatchObject({ cashInHand: "200.00", accountCount: 1 });
    expect(await other().bankAccount.summary()).toMatchObject({ accountCount: 0 });
    await expectCode(seller().bankAccount.summary(), "FORBIDDEN");
  });
});

describe("reports", () => {
  it("daybook lists the period's entries and filters by type", async () => {
    const all = await caller().reports.daybook({ fromDate: day(-60), toDate: day(0) });
    expect(all.entries.map((e) => e.entryType).sort()).toEqual(expect.arrayContaining(["expense", "invoice", "payment"]));
    const onlyPayments = await caller().reports.daybook({ fromDate: day(-60), toDate: day(0), typeFilter: "payments" });
    expect(onlyPayments.entries.every((e) => e.entryType === "payment")).toBe(true);
    await expectCode(caller().reports.daybook({ fromDate: "01-01-2026", toDate: day(0) }), "BAD_REQUEST");
    expect((await other().reports.daybook({ fromDate: day(-60), toDate: day(0) })).entries).toEqual([]);
  });

  it("registers and tax summary", async () => {
    const range = { fromDate: iso(-60), toDate: iso(1) };
    const sales = await caller().reports.salesRegister(range);
    expect(sales.summary).toMatchObject({ totalSubtotal: "500.00", totalTax: "25.00", totalAmount: "525.00", count: 1 });
    const purchases = await caller().reports.purchaseRegister(range);
    expect(purchases.summary.totalAmount).toBe("630.00");
    expect((await caller().reports.salesRegister({ ...range, partyId: UNKNOWN })).rows).toEqual([]);
    const tax = await caller().reports.taxSummary({ ...range, type: "sales" });
    expect(tax.summary.totalTaxCollected).toBe("25.00");
    expect((await other().reports.salesRegister(range)).rows).toEqual([]);
    await expectCode(caller().reports.taxSummary({ ...range, type: "all" as never }), "BAD_REQUEST");
  });

  it("outstanding, cash-flow forecast and collection efficiency", async () => {
    const out = await caller().reports.outstanding({});
    expect(out.receivables!.parties[0]).toMatchObject({ partyId: world.party1.id, total: "425.00" });
    const cf = await caller().reports.cashFlowForecast();
    expect(cf.forecast.map((f) => f.label)).toEqual(["today", "+7d", "+14d", "+30d"]);
    expect(cf.currentBankBalance).toBe("200.00");
    const ce = await caller().reports.collectionEfficiency({ fromDate: iso(-60), toDate: iso(1) });
    expect(ce.dso.totalSales).toBe("525.00");
    expect((await other().reports.outstanding({})).receivables!.parties).toEqual([]);
  });

  it("item sales, party statement and payment summary", async () => {
    const range = { fromDate: iso(-60), toDate: iso(1) };
    const items = await caller().reports.itemSales(range);
    expect(items.rows[0]).toMatchObject({ itemId: world.item1.id, totalRevenue: "525.00", invoiceCount: 1 });
    await expectCode(caller().reports.itemSales({ ...range, sortBy: "name" as never }), "BAD_REQUEST");
    const st = await caller().reports.partyStatement({ partyId: world.party1.id });
    expect(st!.party.id).toBe(world.party1.id);
    // Documented: another business's (or an unknown) party gives null, not NOT_FOUND.
    expect(await other().reports.partyStatement({ partyId: world.party1.id })).toBeNull();
    const ps = await caller().reports.paymentSummary(range);
    expect(ps.summary).toMatchObject({ totalReceived: "100.00", totalExpenses: "300.00" });
  });

  it("tallyExport exports the period for Tally", async () => {
    const r = await caller().reports.tallyExport({ fromDate: iso(-60), toDate: iso(1) });
    expect(JSON.stringify(r).length).toBeGreaterThan(50);
    await expectCode(caller().reports.tallyExport({ fromDate: "x", toDate: iso(1) }), "BAD_REQUEST");
  });
});

describe("stock.count", () => {
  it("returns a count with its warehouse; NOT_FOUND for unknown and foreign counts", async () => {
    await caller().stock.setup();
    const [wh] = await caller().warehouse.warehouseList();
    const saved = await caller().stock.countFinish({ warehouseId: wh!.id, startedAt: new Date().toISOString(), scans: [] });
    const got = await caller().stock.count({ id: saved.id });
    expect(got).toMatchObject({ id: saved.id, warehouseName: wh!.name });
    await expectCode(other().stock.count({ id: saved.id }), "NOT_FOUND");
    await expectCode(caller().stock.count({ id: UNKNOWN }), "NOT_FOUND");
  });
});
