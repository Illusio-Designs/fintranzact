/**
 * Income-tax TDS, end to end through the tRPC procedures.
 *
 * TDS on purchases is deducted on the purchase BILL, when it is credited: the
 * bill's TDS is settled against it by a system payment (source 'tds', no bank
 * account), so the bill shows total, TDS adjusted, and what is left to pay.
 * Payments against the bill then move plain cash. Two cases still carry TDS on
 * the payment itself: an advance to a supplier (not against a bill) and a
 * customer withholding TDS from what they pay us (TDS receivable).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { bankAccounts, bankTransactions, invoices, itcLedgerEntries, payments, paymentAllocations, taxChallans, taxDeductions, tdsSectionSettings } from "@fintranzact/db";
import { createCallerFactory } from "../../trpc.js";
import { appRouter } from "../../router.js";
import { previewPartyTds } from "../../lib/tds-service.js";
import { runAudit } from "../../lib/data-audit/runner.js";
import { createUser, createTenant, addMember } from "../helpers/fixtures.js";
import { getTenantTestDb, getTestClient, truncateAllTables, closeTestDb } from "../helpers/test-db.js";

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

let c: Caller;
let businessId: string;
let customer: { id: string };
let service: { id: string };
let bank: { id: string };

const db = () => getTenantTestDb();
const line = (price: string, qty = "1") => ({
  itemId: service.id, itemName: "Consulting", quantity: qty, unitPrice: price, taxPercent: "18", discountPercent: "0",
});
const bill = (partyId: string, price: string, extra: Record<string, unknown> = {}) =>
  c.invoice.create({ partyId, type: "purchase", lineItems: [line(price)], ...extra } as InvoiceInput);
const supplierWith = (name: string, extra: Record<string, unknown>) =>
  c.party.create({ type: "supplier", name, openingBalance: "0", ...extra } as Parameters<Caller["party"]["create"]>[0]);

beforeAll(async () => {
  const owner = await createUser({ email: `tds.${Date.now()}@example.in`, name: "TDS Owner" });
  const tenant = await createTenant({ name: "TDS Traders" });
  await addMember(tenant.id, owner.id, "owner");
  const u = { id: owner.id, email: owner.email, name: owner.name ?? null };
  const biz = await callerFor(u, tenant.id, null).business.create({
    name: "TDS Traders", phone: "9876543210", address: "1 Fort", city: "Mumbai", state: "Maharashtra", stateCode: "27",
    gstRegistrationType: "regular", gstin: "27AABCU9603R1ZM", pan: "AABCU9603R",
  } as Parameters<Caller["business"]["create"]>[0]);
  businessId = biz.id;
  c = callerFor(u, tenant.id, biz.id);
  customer = await c.party.create({ type: "customer", name: "Big Buyer", gstin: "27AAPFU0939F1ZV", openingBalance: "0" });
  service = await c.item.create({ name: "Consulting", hsn: "998719", unit: "pcs", itemMode: "simple", taxPercent: "18", stockQuantity: "0", itemType: "service", taxInclusive: false });
  bank = await c.bankAccount.create({ accountName: "HDFC", accountType: "current", openingBalance: "1000000", isDefault: false });
}, 60_000);

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

const balanceOf = async (id: string) =>
  (await db().select({ b: bankAccounts.currentBalance }).from(bankAccounts).where(eq(bankAccounts.id, id)))[0]!.b;
const invoiceRow = async (id: string) => (await db().select().from(invoices).where(eq(invoices.id, id)))[0]!;
const deductionsOfBill = (id: string) => db().select().from(taxDeductions).where(eq(taxDeductions.invoiceId, id));
const tdsPaymentsOfBill = (id: string) =>
  db().select().from(payments).where(and(eq(payments.invoiceId, id), eq(payments.source, "tds")));
const bankTxnOf = async (paymentId: string) =>
  (await db().select().from(bankTransactions).where(and(eq(bankTransactions.referenceType, "payment"), eq(bankTransactions.referenceId, paymentId))))[0];
const trial = async () => c.reports.trialBalance({ asOfDate: new Date(Date.now() + 86_400_000).toISOString() });
const acct = (tb: Awaited<ReturnType<typeof trial>>, code: string) => tb.accounts.find((a: { accountCode: string }) => a.accountCode === code);

describe("TDS deducted on a purchase bill", () => {
  let ca: { id: string }; // PAN via GSTIN, 194J professional fees (10%, limit 50,000 a year)
  let b1: { id: string };

  beforeAll(async () => {
    ca = await supplierWith("CA Associates", { gstin: "27AABCS1234D1Z5", tdsSection: "194J_PROF" });
  });

  it("deducts nothing while purchases stay under the yearly limit", async () => {
    const small = await bill(ca.id, "30000");
    expect((await invoiceRow(small.id)).tdsAmount).toBe("0.00");
    expect(await tdsPaymentsOfBill(small.id)).toHaveLength(0);
    expect((await invoiceRow(small.id)).tdsSection).toBe("194J_PROF"); // still counts towards the year
  });

  it("catches up earlier purchases when the yearly limit is crossed, and settles TDS against the bill", async () => {
    // 30,000 already bought; this 30,000 takes the year to 60,000 > 50,000: TDS on all 60,000 at 10%.
    b1 = await bill(ca.id, "30000");
    const row = await invoiceRow(b1.id);
    expect(row.totalAmount).toBe("35400.00");
    expect(row.tdsAmount).toBe("6000.00");
    expect(row.amountPaid).toBe("6000.00"); // the TDS adjustment
    expect(row.status).toBe("partial");

    const [sys] = await tdsPaymentsOfBill(b1.id);
    expect(sys).toMatchObject({ amount: "6000.00", mode: "other", bankAccountId: null, partyId: ca.id, tdsAmount: "0.00" });
    expect(sys!.paymentNumber).toBe(`TDS-${row.invoiceNumber}`);
    const allocs = await db().select().from(paymentAllocations).where(eq(paymentAllocations.paymentId, sys!.id));
    expect(allocs).toHaveLength(1);
    expect(allocs[0]).toMatchObject({ invoiceId: b1.id, amount: "6000.00" });

    const [d] = await deductionsOfBill(b1.id);
    expect(d).toMatchObject({
      kind: "tds", direction: "payable", partyId: ca.id, sectionCode: "194J_PROF",
      baseAmount: "60000.00", rate: "10.000", amount: "6000.00", hasPan: true, challanId: null, paymentId: sys!.id,
    });
  });

  it("posts Dr Payable / Cr TDS Payable with no bank movement, and the ledger still balances", async () => {
    const tb = await trial();
    expect(acct(tb, "2200")).toMatchObject({ credit: "6000.00" });
    expect(tb.totalDebit).toBe(tb.totalCredit);
  });

  it("lets the rest of the bill be paid in plain cash, which settles it", async () => {
    const before = parseFloat(await balanceOf(bank.id));
    const pay = await c.payment.create({ partyId: ca.id, invoiceId: b1.id, amount: "29400", mode: "bank", bankAccountId: bank.id });
    expect(await bankTxnOf(pay.id)).toMatchObject({ type: "withdrawal", amount: "29400.00" });
    expect(parseFloat(await balanceOf(bank.id))).toBeCloseTo(before - 29400, 2);
    const row = await invoiceRow(b1.id);
    expect(row.amountPaid).toBe("35400.00");
    expect(row.status).toBe("paid");
  });

  it("refuses TDS on a payment against a purchase bill: it is deducted on the bill", async () => {
    const other = await bill(ca.id, "1000");
    await expect(c.payment.create({
      partyId: ca.id, invoiceId: other.id, amount: "500", mode: "cash", tdsAmount: "50", tdsSection: "194J_PROF",
    })).rejects.toThrow(/deducted on the bill/);
  });

  it("keeps the bill's TDS adjustment out of untracked payments and protects it from direct edits", async () => {
    const [sys] = await tdsPaymentsOfBill(b1.id);
    const untracked = await c.payment.untrackedPayments({ page: 1, limit: 100 } as Parameters<Caller["payment"]["untrackedPayments"]>[0]);
    expect(untracked.data.map((p: { id: string }) => p.id)).not.toContain(sys!.id);
    await expect(c.payment.update({ id: sys!.id, amount: "10" })).rejects.toThrow(/TDS deducted on a purchase bill/);
    await expect(c.payment.delete({ id: sys!.id })).rejects.toThrow(/TDS deducted on a purchase bill/);
  });
});

describe("a bill's TDS follows the bill", () => {
  let sup: { id: string };

  beforeAll(async () => {
    sup = await supplierWith("Rent Co", { gstin: "27AABCR7777Q1Z1", tdsSection: "194H" }); // 2%, limit 20,000
  });

  it("is re-worked when the bill is edited", async () => {
    const b = await bill(sup.id, "100000"); // taxable 100,000 → 2% = 2,000
    expect((await invoiceRow(b.id)).tdsAmount).toBe("2000.00");

    await c.invoice.update({ id: b.id, lineItems: [line("150000")] });
    const row = await invoiceRow(b.id);
    expect(row).toMatchObject({ totalAmount: "177000.00", tdsAmount: "3000.00", amountPaid: "3000.00" });
    expect(await tdsPaymentsOfBill(b.id)).toHaveLength(1);
    expect((await deductionsOfBill(b.id))[0]).toMatchObject({ amount: "3000.00", baseAmount: "150000.00" });
  });

  it("goes when the bill is cancelled and returns when it is reinstated", async () => {
    const b = await bill(sup.id, "100000");
    await c.invoice.updateStatus({ id: b.id, status: "cancelled" });
    let row = await invoiceRow(b.id);
    expect(row).toMatchObject({ tdsAmount: "0.00", amountPaid: "0.00" });
    expect(await tdsPaymentsOfBill(b.id)).toHaveLength(0);
    expect(await deductionsOfBill(b.id)).toHaveLength(0);

    await c.invoice.updateStatus({ id: b.id, status: "sent" });
    row = await invoiceRow(b.id);
    expect(row).toMatchObject({ tdsAmount: "2000.00", amountPaid: "2000.00" });
    expect(await deductionsOfBill(b.id)).toHaveLength(1);
  });

  it("goes when the bill is deleted", async () => {
    const b = await bill(sup.id, "100000");
    await c.invoice.delete({ id: b.id });
    expect(await tdsPaymentsOfBill(b.id)).toHaveLength(0);
    expect(await deductionsOfBill(b.id)).toHaveLength(0);
  });

  it("can be turned off for a bill, or entered by hand", async () => {
    const none = await bill(sup.id, "100000", { tdsMode: "none" });
    expect(await invoiceRow(none.id)).toMatchObject({ tdsMode: "none", tdsAmount: "0.00", amountPaid: "0.00" });

    const manual = await bill(sup.id, "100000", { tdsMode: "manual", tdsSection: "194C", tdsAmount: "1234" });
    expect(await invoiceRow(manual.id)).toMatchObject({ tdsMode: "manual", tdsSection: "194C", tdsAmount: "1234.00", amountPaid: "1234.00" });
    expect((await deductionsOfBill(manual.id))[0]).toMatchObject({ sectionCode: "194C", amount: "1234.00" });

    // Cancelling keeps the amount entered, so reinstating restores it.
    await c.invoice.updateStatus({ id: manual.id, status: "cancelled" });
    expect(await invoiceRow(manual.id)).toMatchObject({ tdsAmount: "1234.00", amountPaid: "0.00" });
    await c.invoice.updateStatus({ id: manual.id, status: "sent" });
    expect(await invoiceRow(manual.id)).toMatchObject({ tdsAmount: "1234.00", amountPaid: "1234.00" });

    // Switching a bill from none to auto picks up the supplier's section.
    await c.invoice.update({ id: none.id, tdsMode: "auto" });
    expect(await invoiceRow(none.id)).toMatchObject({ tdsAmount: "2000.00" });
  });

  it("needs a section and a sensible amount when entered by hand", async () => {
    await expect(bill(sup.id, "1000", { tdsMode: "manual", tdsAmount: "10" })).rejects.toThrow(/section/i);
    await expect(bill(sup.id, "1000", { tdsMode: "manual", tdsSection: "194C", tdsAmount: "5000" })).rejects.toThrow(/less than the bill total/);
  });

  it("is locked once deposited against a challan", async () => {
    const b = await bill(sup.id, "100000");
    const [d] = await deductionsOfBill(b.id);
    const [challan] = await db().insert(taxChallans).values({
      businessId, kind: "tds", financialYear: d!.financialYear, quarter: d!.quarter, challanNumber: "00041", bsrCode: "0510308",
      depositedOn: new Date(), amount: "2000.00",
    }).returning();
    await db().update(taxDeductions).set({ challanId: challan!.id }).where(eq(taxDeductions.id, d!.id));

    await expect(c.invoice.update({ id: b.id, lineItems: [line("200000")] })).rejects.toThrow(/already deposited/);
    await expect(c.invoice.updateStatus({ id: b.id, status: "cancelled" })).rejects.toThrow(/already deposited/);
    await expect(c.invoice.delete({ id: b.id })).rejects.toThrow(/already deposited/);

    // Taking it off the challan frees the bill again.
    await db().update(taxDeductions).set({ challanId: null }).where(eq(taxDeductions.id, d!.id));
    await db().delete(taxChallans).where(eq(taxChallans.id, challan!.id));
    await c.invoice.updateStatus({ id: b.id, status: "cancelled" });
  });
});

describe("rates for a supplier without a PAN", () => {
  it("applies the higher s.206AA rate and the 194C single-bill limit", async () => {
    const contractor = await supplierWith("Cash Contractor", { tdsSection: "194C" });
    const under = await bill(contractor.id, "25000");
    expect((await invoiceRow(under.id)).tdsAmount).toBe("0.00");

    const over = await bill(contractor.id, "40000"); // over the 30,000 single limit; cumulative 65,000 under the yearly limit
    const row = await invoiceRow(over.id);
    expect(row.tdsAmount).toBe("8000.00"); // 20% of 40,000
    expect((await deductionsOfBill(over.id))[0]).toMatchObject({ hasPan: false, rate: "20.000", baseAmount: "40000.00" });
  });

  it("applies the individual 194C rate to a proprietor with a PAN", async () => {
    const prop = await supplierWith("Sole Contractor", { pan: "ABCPD1234E", constitution: "proprietorship", tdsSection: "194C" });
    const b = await bill(prop.id, "40000");
    expect((await invoiceRow(b.id)).tdsAmount).toBe("400.00"); // 1%
  });
});

describe("194Q purchases above 50 lakh", () => {
  it("taxes only the part of the year's purchases above the limit", async () => {
    const mill = await supplierWith("Big Mill", { gstin: "27AABCM5555L1Z3", tdsSection: "194Q" });
    const first = await bill(mill.id, "4000000");
    expect((await invoiceRow(first.id)).tdsAmount).toBe("0.00");
    const second = await bill(mill.id, "2000000"); // cumulative 60 lakh: 10 lakh over, at 0.1%
    expect((await invoiceRow(second.id)).tdsAmount).toBe("1000.00");
    expect((await deductionsOfBill(second.id))[0]).toMatchObject({ baseAmount: "1000000.00", rate: "0.100" });
    const third = await bill(mill.id, "500000"); // all of it is above the limit now
    expect((await invoiceRow(third.id)).tdsAmount).toBe("500.00");
  });
});

describe("TDS on an advance to a supplier (a payment not against a bill)", () => {
  it("is withheld on the payment: the net goes through the bank and TDS payable is recorded", async () => {
    const adv = await supplierWith("Advance Co", { gstin: "27AABCA9999K1Z8" });
    const before = parseFloat(await balanceOf(bank.id));
    const pay = await c.payment.create({
      partyId: adv.id, amount: "100000", mode: "bank", bankAccountId: bank.id, tdsAmount: "10000", tdsSection: "194J_PROF",
    });
    expect(await bankTxnOf(pay.id)).toMatchObject({ type: "withdrawal", amount: "90000.00" });
    expect(parseFloat(await balanceOf(bank.id))).toBeCloseTo(before - 90000, 2);
    const rows = await db().select().from(taxDeductions).where(eq(taxDeductions.paymentId, pay.id));
    expect(rows[0]).toMatchObject({ direction: "payable", sectionCode: "194J_PROF", amount: "10000.00" });

    // Re-working and deleting it behave as for any payment.
    await c.payment.update({ id: pay.id, tdsAmount: "5000", tdsSection: "194J_PROF" });
    expect(await bankTxnOf(pay.id)).toMatchObject({ amount: "95000.00" });
    await c.payment.delete({ id: pay.id });
    expect(await db().select().from(taxDeductions).where(eq(taxDeductions.paymentId, pay.id))).toHaveLength(0);
    expect(parseFloat(await balanceOf(bank.id))).toBeCloseTo(before, 2);
  });
});

describe("TDS a customer withholds from what they pay us", () => {
  it("settles the invoice in full, deposits the net, and records TDS receivable", async () => {
    const inv = await c.invoice.create({ partyId: customer.id, type: "sale", lineItems: [line("10000")] } as InvoiceInput);
    const before = parseFloat(await balanceOf(bank.id));
    const pay = await c.payment.create({
      partyId: customer.id, invoiceId: inv.id, amount: "11800", mode: "bank", bankAccountId: bank.id,
      tdsAmount: "100", tdsSection: "194C", tdsBase: "10000",
    });
    expect((await invoiceRow(inv.id)).status).toBe("paid");
    expect(await bankTxnOf(pay.id)).toMatchObject({ type: "deposit", amount: "11700.00" });
    expect(parseFloat(await balanceOf(bank.id))).toBeCloseTo(before + 11700, 2);
    const rows = await db().select().from(taxDeductions).where(eq(taxDeductions.paymentId, pay.id));
    expect(rows[0]).toMatchObject({ kind: "tds", direction: "receivable", sectionCode: "194C", amount: "100.00", rate: "1.000" });

    const tb = await trial();
    expect(acct(tb, "1250")).toMatchObject({ debit: "100.00" });
    expect(tb.totalDebit).toBe(tb.totalCredit);
  });

  it("needs a section for the tax withheld", async () => {
    await expect(c.payment.create({ partyId: customer.id, amount: "500", mode: "cash", tdsAmount: "5" })).rejects.toThrow(/section/i);
    await expect(c.payment.create({ partyId: customer.id, amount: "500", mode: "cash", tdsAmount: "500", tdsSection: "194C" })).rejects.toThrow(/less than the payment/);
  });

  it("keeps a payment with no TDS exactly as before: the whole amount through the bank", async () => {
    const before = parseFloat(await balanceOf(bank.id));
    const pay = await c.payment.create({ partyId: customer.id, amount: "250", mode: "bank", bankAccountId: bank.id });
    expect(await bankTxnOf(pay.id)).toMatchObject({ type: "deposit", amount: "250.00" });
    expect(parseFloat(await balanceOf(bank.id))).toBeCloseTo(before + 250, 2);
  });
});

describe("previewPartyTds and per-business overrides", () => {
  it("counts the year's purchase bills and what TDS was already deducted on", async () => {
    const s = await supplierWith("Preview Co", { gstin: "27AABCP1212M1Z6", tdsSection: "194J_PROF" });
    await bill(s.id, "20000");
    await bill(s.id, "20000");
    const p = await previewPartyTds(db(), businessId, { partyId: s.id, amount: "20000" });
    expect(p).toMatchObject({ ytdPaid: "40000.00", sectionCode: "194J_PROF", hasPan: true });
    // Crossing 50,000: all 60,000 is taxed, at 10%.
    expect(p.result).toMatchObject({ applicable: true, reason: "aggregate_threshold_crossed", base: "60000.00", tds: "6000.00" });
    expect((await previewPartyTds(db(), businessId, { partyId: customer.id, amount: "1" }))).toMatchObject({ section: null, result: null });
  });

  it("honours a business override of the yearly limit", async () => {
    const s = await supplierWith("Override Co", { gstin: "27AABCO3434N1Z4", tdsSection: "194J_PROF" });
    const fy = (await previewPartyTds(db(), businessId, { partyId: s.id, amount: "1" })).financialYear;
    await db().insert(tdsSectionSettings).values({ businessId, financialYear: fy, sectionCode: "194J_PROF", aggregateThreshold: "1000000" });
    try {
      const b = await bill(s.id, "60000");
      expect((await invoiceRow(b.id)).tdsAmount).toBe("0.00"); // under the raised limit
    } finally {
      await db().delete(tdsSectionSettings).where(eq(tdsSectionSettings.businessId, businessId));
    }
  });
});

describe("a recurring purchase bill", () => {
  it("carries TDS like any other purchase bill", async () => {
    const sup = await supplierWith("Retainer Co", { gstin: "27AABCR2323P1Z9", tdsSection: "194J_PROF" });
    const template = await c.recurringInvoice.create({
      partyId: sup.id, name: "Monthly retainer", type: "purchase", frequency: "monthly", startDate: new Date().toISOString(),
      lineItems: [{ itemId: service.id, itemName: "Retainer", quantity: "1", unitPrice: "60000", taxPercent: "18", discountPercent: "0" }],
    } as Parameters<Caller["recurringInvoice"]["create"]>[0]);
    const run = await c.recurringInvoice.runNow({ id: template.id });
    const invoiceId = (run as { invoiceId: string }).invoiceId;
    // 60,000 is over the 194J yearly limit of 50,000: 10% = 6,000.
    expect(await invoiceRow(invoiceId)).toMatchObject({ tdsAmount: "6000.00", amountPaid: "6000.00", tdsSection: "194J_PROF" });
    expect(await deductionsOfBill(invoiceId)).toHaveLength(1);
    expect(await tdsPaymentsOfBill(invoiceId)).toHaveLength(1);
    // ...and earns input tax credit: 18% of 60,000, split CGST + SGST for an in-state supplier.
    const [itc] = await db().select().from(itcLedgerEntries).where(eq(itcLedgerEntries.invoiceId, invoiceId));
    expect(itc).toMatchObject({ status: "available", cgst: "5400.00", sgst: "5400.00", igst: "0.00" });
  });
});

describe("data audit", () => {
  it("finds nothing wrong after all of the above", async () => {
    const report = await runAudit(getTestClient(), { businessIds: [businessId], samples: 10 });
    expect(report.failures.map((f) => `${f.rule.id}: ${f.error}`)).toEqual([]);
    const errors = report.results.filter((r) => r.rule.severity === "error");
    expect(errors.map((r) => `${r.rule.id}: ${r.samples.map((s) => s.detail).join(" | ")}`)).toEqual([]);
  });
});
