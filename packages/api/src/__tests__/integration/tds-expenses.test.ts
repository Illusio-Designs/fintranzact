/**
 * TDS on expense entries (rent, professional fees…), end to end through the
 * tRPC procedures. The expense amount is gross; the bank moves amount - TDS;
 * one payable tax_deductions row is kept per expense and follows edits and
 * deletes; the ledger posts the TDS to TDS Payable (2200) and balances.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { bankAccounts, bankTransactions, expenses, taxChallans, taxDeductions } from "@fintranzact/db";
import { createCallerFactory } from "../../trpc.js";
import { appRouter } from "../../router.js";
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

let c: Caller;
let businessId: string;
let bank: { id: string };

const db = () => getTenantTestDb();
const supplierWith = (name: string, extra: Record<string, unknown>) =>
  c.party.create({ type: "supplier", name, openingBalance: "0", ...extra } as Parameters<Caller["party"]["create"]>[0]);

beforeAll(async () => {
  const owner = await createUser({ email: `expense-tds.${Date.now()}@example.in`, name: "TDS Owner" });
  const tenant = await createTenant({ name: "TDS Traders" });
  await addMember(tenant.id, owner.id, "owner");
  const u = { id: owner.id, email: owner.email, name: owner.name ?? null };
  const biz = await callerFor(u, tenant.id, null).business.create({
    name: "TDS Traders", phone: "9876543210", address: "1 Fort", city: "Mumbai", state: "Maharashtra", stateCode: "27",
    gstRegistrationType: "regular", gstin: "27AABCU9603R1ZM", pan: "AABCU9603R",
  } as Parameters<Caller["business"]["create"]>[0]);
  businessId = biz.id;
  c = callerFor(u, tenant.id, biz.id);
  bank = await c.bankAccount.create({ accountName: "HDFC", accountType: "current", openingBalance: "1000000", isDefault: false });
}, 60_000);

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

const balanceOf = async (id: string) =>
  (await db().select({ b: bankAccounts.currentBalance }).from(bankAccounts).where(eq(bankAccounts.id, id)))[0]!.b;
const expenseRow = async (id: string) => (await db().select().from(expenses).where(eq(expenses.id, id)))[0]!;
const deductionsOf = (id: string) => db().select().from(taxDeductions).where(eq(taxDeductions.expenseId, id));
const bankTxnsOf = (id: string) =>
  db().select().from(bankTransactions).where(and(eq(bankTransactions.referenceType, "expense"), eq(bankTransactions.referenceId, id)));
const trial = async () => c.reports.trialBalance({ asOfDate: new Date(Date.now() + 86_400_000).toISOString() });
const acct = (tb: Awaited<ReturnType<typeof trial>>, code: string) => tb.accounts.find((a: { accountCode: string }) => a.accountCode === code);
const spend = (extra: Record<string, unknown>) =>
  c.expense.create({ category: "Professional Fees", amount: "30000", mode: "bank", bankAccountId: bank.id, ...extra } as Parameters<Caller["expense"]["create"]>[0]);

describe("TDS on expenses", () => {
  let landlord: { id: string }; // no default section; used with manual TDS
  let ca: { id: string };       // 194J_PROF: 10%, limit 50,000 a year, PAN via GSTIN
  let noPan: { id: string };

  beforeAll(async () => {
    ca = await supplierWith("CA Associates", { gstin: "27AABCS1234D1Z5", tdsSection: "194J_PROF" });
    noPan = await supplierWith("Cash Consultant", { tdsSection: "194J_PROF" });
    landlord = await supplierWith("Landlord", { gstin: "27AABCL1234D1Z5" });
  });

  it("deducts nothing while payments stay under the yearly limit, but still counts them", async () => {
    const e = await spend({ partyId: ca.id, tdsMode: "auto", amount: "30000" });
    expect(await expenseRow(e.id)).toMatchObject({ tdsMode: "auto", tdsAmount: "0.00", tdsSection: "194J_PROF", partyId: ca.id });
    expect(await deductionsOf(e.id)).toHaveLength(0);
  });

  it("catches up earlier payments when the limit is crossed; the bank moves the net", async () => {
    const before = parseFloat(await balanceOf(bank.id));
    const e = await spend({ partyId: ca.id, tdsMode: "auto", amount: "30000" });
    // 60,000 this year > 50,000: 10% of 60,000 = 6,000.
    expect(await expenseRow(e.id)).toMatchObject({ amount: "30000.00", tdsAmount: "6000.00" });
    const [d] = await deductionsOf(e.id);
    expect(d).toMatchObject({
      kind: "tds", direction: "payable", partyId: ca.id, sectionCode: "194J_PROF",
      baseAmount: "60000.00", rate: "10.000", amount: "6000.00", hasPan: true, challanId: null, paymentId: null, invoiceId: null,
    });
    const txns = await bankTxnsOf(e.id);
    expect(txns).toHaveLength(1);
    expect(txns[0]).toMatchObject({ type: "withdrawal", amount: "24000.00" });
    expect(parseFloat(await balanceOf(bank.id))).toBeCloseTo(before - 24000, 2);
  });

  it("posts Dr expense (gross) / Cr bank (net) + Cr TDS Payable, and the ledger balances", async () => {
    const tb = await trial();
    expect(acct(tb, "2200")).toMatchObject({ credit: "6000.00" });
    expect(tb.totalDebit).toBe(tb.totalCredit);
  });

  it("uses the higher s.206AA rate when the payee has no PAN", async () => {
    const e = await spend({ partyId: noPan.id, tdsMode: "auto", amount: "100000" });
    const [d] = await deductionsOf(e.id);
    expect(d).toMatchObject({ hasPan: false, rate: "20.000", amount: "20000.00" });
    expect((await expenseRow(e.id)).tdsAmount).toBe("20000.00");
  });

  it("takes a manual section and amount", async () => {
    const e = await spend({ partyId: landlord.id, tdsMode: "manual", tdsSection: "194I_LB", tdsAmount: "1500", amount: "15000" });
    expect(await expenseRow(e.id)).toMatchObject({ tdsMode: "manual", tdsSection: "194I_LB", tdsAmount: "1500.00" });
    const [d] = await deductionsOf(e.id);
    expect(d).toMatchObject({ sectionCode: "194I_LB", amount: "1500.00", baseAmount: "15000.00", rate: "10.000" });
    expect((await bankTxnsOf(e.id))[0]).toMatchObject({ amount: "13500.00" });
  });

  it("refuses TDS without a payee, a manual amount at or above the expense, or a manual amount without a section", async () => {
    await expect(spend({ tdsMode: "auto" })).rejects.toThrow(/who was paid/i);
    await expect(spend({ partyId: ca.id, tdsMode: "manual", tdsSection: "194J_PROF", tdsAmount: "30000" })).rejects.toThrow(/less than/i);
    await expect(spend({ partyId: ca.id, tdsMode: "manual", tdsAmount: "100" })).rejects.toThrow(/section/i);
  });

  it("replaces the deduction and the withdrawal when the expense is edited", async () => {
    const e = await spend({ partyId: landlord.id, tdsMode: "manual", tdsSection: "194I_LB", tdsAmount: "1000", amount: "10000" });
    const before = parseFloat(await balanceOf(bank.id));
    await c.expense.update({ id: e.id, data: { amount: "20000", tdsAmount: "2000" } });
    expect(await expenseRow(e.id)).toMatchObject({ amount: "20000.00", tdsAmount: "2000.00" });
    const ds = await deductionsOf(e.id);
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({ amount: "2000.00", baseAmount: "20000.00" });
    const txns = await bankTxnsOf(e.id);
    expect(txns).toHaveLength(1);
    expect(txns[0]).toMatchObject({ amount: "18000.00" });
    // Net moved from 9,000 to 18,000.
    expect(parseFloat(await balanceOf(bank.id))).toBeCloseTo(before - 9000, 2);

    // Switching TDS off removes the row and pays in full.
    await c.expense.update({ id: e.id, data: { tdsMode: "none" } });
    expect(await expenseRow(e.id)).toMatchObject({ tdsMode: "none", tdsAmount: "0.00", tdsSection: null });
    expect(await deductionsOf(e.id)).toHaveLength(0);
    expect((await bankTxnsOf(e.id))[0]).toMatchObject({ amount: "20000.00" });
  });

  it("will not change or delete TDS that is already deposited against a challan", async () => {
    const e = await spend({ partyId: landlord.id, tdsMode: "manual", tdsSection: "194I_LB", tdsAmount: "500", amount: "5000" });
    const [d] = await deductionsOf(e.id);
    const [ch] = await db().insert(taxChallans).values({
      businessId, kind: "tds", financialYear: d!.financialYear, quarter: d!.quarter, challanNumber: "00001", bsrCode: "0510308",
      depositedOn: new Date(), amount: "500",
    }).returning();
    await db().update(taxDeductions).set({ challanId: ch!.id }).where(eq(taxDeductions.id, d!.id));

    await expect(c.expense.update({ id: e.id, data: { tdsAmount: "600" } })).rejects.toThrow(/already deposited/i);
    await expect(c.expense.delete({ id: e.id })).rejects.toThrow(/already deposited/i);
    expect((await expenseRow(e.id)).tdsAmount).toBe("500.00");
  });

  it("removes the deduction when the expense is deleted", async () => {
    const e = await spend({ partyId: landlord.id, tdsMode: "manual", tdsSection: "194I_LB", tdsAmount: "700", amount: "7000" });
    expect(await deductionsOf(e.id)).toHaveLength(1);
    await c.expense.delete({ id: e.id });
    expect(await deductionsOf(e.id)).toHaveLength(0);
    expect(await bankTxnsOf(e.id)).toHaveLength(0);
  });

  it("lists expense TDS in the TDS register of its year", async () => {
    const e = await spend({ partyId: landlord.id, tdsMode: "manual", tdsSection: "194I_LB", tdsAmount: "300", amount: "3000" });
    const [d] = await deductionsOf(e.id);
    const reg = await c.tds.deductions({ kind: "tds", financialYear: d!.financialYear });
    expect(reg.data.some((r: { id: string }) => r.id === d!.id)).toBe(true);
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
