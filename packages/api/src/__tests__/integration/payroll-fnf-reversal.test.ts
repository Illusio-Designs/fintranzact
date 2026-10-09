/**
 * payroll-fnf-reversal.test.ts - reversal of a posted full and final settlement (and of its payment) against a real Postgres.
 *
 * Invariants:
 *   1. Only PayrollPosting roles (owner, admin, accountant) reverse, with a mandatory reason; HR and sellers are refused;
 *      another business gets NOT_FOUND; a settlement that is not posted cannot be reversed.
 *   2. The reversal negates the accrual entry exactly (account by account), puts the loan recoveries back through the
 *      append-only event log (closed loans become active, the schedule is rebuilt), gives the encashed leave back, frees the
 *      provision and the bonus, never reactivates the employee, keeps the statement PDF, and is audited.
 *   3. It is idempotent.
 *   4. A paid settlement is refused until its payment is reversed (money back into the account it left); that is idempotent too.
 *   5. After a reversal a new settlement for the same employee can be prepared and recovers the same loan again.
 *   6. The data audit finds nothing wrong.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { auditLog, bankAccounts, businessMembers, chartOfAccounts, employeeLoanEvents, employeeLoanInstallments, employeeLoans, employees, fnfSettlements, journalEntries, journalEntryLines, leaveLedger } from "@fintranzact/db";
import { defaultStatutoryRates } from "@fintranzact/shared";
import { createTenant, createUser, addMember, createBusiness, createBankAccount, grantAddon, type TestUser, type TestTenant, type TestBusiness } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { getTenantTestDb, getTestClient, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { runAudit } from "../../lib/data-audit/runner.js";
import { seedChartOfAccounts } from "../../lib/coa-seed.js";

const db = () => getTenantTestDb();
type Caller = ReturnType<typeof createTestCaller>;
const callerFor = (u: TestUser, t: TestTenant, b: TestBusiness): Caller =>
  createTestCaller({ userId: u.id, email: u.email, name: u.name ?? null, tenantId: t.id, businessId: b.id });
const paise = (s: string | number) => Math.round(Number(s) * 100);

let tenant: TestTenant;
let biz: TestBusiness;
let ownerC: Caller;
let hrC: Caller;
let accountantC: Caller;
let sellerC: Caller;
let ownerBC: Caller;
let bank: { id: string };
const ids: Record<string, string> = {};

async function person(t: TestTenant, b: TestBusiness, email: string, role: "admin" | "accountant" | "seller" | "hr", bizRole: "admin" | "member") {
  const u = await createUser({ email, name: email.split("@")[0] });
  await addMember(t.id, u.id, role);
  await db().insert(businessMembers).values({ businessId: b.id, userId: u.id, role: bizRole });
  return u;
}

/** Account code -> debit less credit of the given journal entries, paise (zero entries dropped). */
async function netOf(entryIds: string[]): Promise<Record<string, number>> {
  const rows = await db()
    .select({ code: chartOfAccounts.code, debit: journalEntryLines.debit, credit: journalEntryLines.credit })
    .from(journalEntryLines)
    .innerJoin(chartOfAccounts, eq(chartOfAccounts.id, journalEntryLines.accountId))
    .where(inArray(journalEntryLines.journalEntryId, entryIds));
  const out: Record<string, number> = {};
  for (const r of rows) out[r.code] = (out[r.code] ?? 0) + paise(r.debit) - paise(r.credit);
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== 0));
}

/** The whole book's debit less credit per account code (paise). */
async function bookBalances(): Promise<Record<string, number>> {
  const rows = await db()
    .select({ code: chartOfAccounts.code, debit: journalEntryLines.debit, credit: journalEntryLines.credit })
    .from(journalEntryLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalEntryLines.journalEntryId))
    .innerJoin(chartOfAccounts, eq(chartOfAccounts.id, journalEntryLines.accountId))
    .where(eq(journalEntries.businessId, biz.id));
  const out: Record<string, number> = {};
  for (const r of rows) out[r.code] = (out[r.code] ?? 0) + paise(r.debit) - paise(r.credit);
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== 0));
}

async function bankBalance(): Promise<number> {
  const [row] = await db().select().from(bankAccounts).where(eq(bankAccounts.id, bank.id));
  return paise(row!.currentBalance);
}

async function leaveBalanceOf(employeeId: string): Promise<number> {
  const rows = await db().select().from(leaveLedger).where(eq(leaveLedger.employeeId, employeeId));
  return rows.reduce((n, r) => n + Number(r.days), 0);
}

async function approvedRun(month: string): Promise<string> {
  const run = await hrC.payrollRun.create({ month });
  await hrC.payrollRun.lockAttendance({ id: run.id, fillUnmarked: "present" });
  await hrC.payrollRun.calculate({ id: run.id });
  await hrC.payrollRun.submit({ id: run.id });
  await ownerC.payrollRun.approve({ id: run.id });
  return run.id;
}

/** HR prepares, the owner approves, the accountant posts. */
async function settle(employeeId: string): Promise<string> {
  const s = await hrC.payrollFnf.create({ employeeId, encashmentBasis: "basic_da_26" });
  return s.id;
}
async function submitApprovePost(id: string): Promise<{ journalEntryId: string | null }> {
  await hrC.payrollFnf.submit({ id });
  await ownerC.payrollFnf.approve({ id });
  const p = await accountantC.payrollFnf.post({ id });
  return { journalEntryId: p.journalEntryId };
}

beforeAll(async () => {
  tenant = await createTenant({ name: "Reversal Co" });
  const owner = await createUser({ email: "owner@reversal.in", name: "Ramesh Kumar" });
  await addMember(tenant.id, owner.id, "owner");
  biz = await createBusiness(db(), owner.id, { name: "Reversal Co", legalName: "Reversal Co Pvt Ltd" });
  await db().insert(businessMembers).values({ businessId: biz.id, userId: owner.id, role: "admin" });
  const hr = await person(tenant, biz, "hr@reversal.in", "hr", "member");
  const accountant = await person(tenant, biz, "anita@reversal.in", "accountant", "member");
  const seller = await person(tenant, biz, "sunil@reversal.in", "seller", "member");
  await seedChartOfAccounts(db(), biz.id);
  bank = await createBankAccount(db(), biz.id, { accountName: "HDFC Current", accountType: "current", currentBalance: "1000000.00", openingBalance: "1000000.00" });
  ownerC = callerFor(owner, tenant, biz);
  hrC = callerFor(hr, tenant, biz);
  accountantC = callerFor(accountant, tenant, biz);
  sellerC = callerFor(seller, tenant, biz);

  const tenantB = await createTenant({ name: "Other Reversal Org" });
  const ownerB = await createUser({ email: "owner@otherreversal.in", name: "Kiran Mehta" });
  await addMember(tenantB.id, ownerB.id, "owner");
  const bizB = await createBusiness(db(), ownerB.id, { name: "Other Reversal Org" });
  await db().insert(businessMembers).values({ businessId: bizB.id, userId: ownerB.id, role: "admin" });
  await seedChartOfAccounts(db(), bizB.id);
  ownerBC = callerFor(ownerB, tenantB, bizB);
  await grantAddon(tenant.id, "payroll");
  await grantAddon(tenantB.id, "payroll");
}, 120_000);

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

describe("setup", () => {
  it("builds three employees, a loan for the first, a gratuity provision, the bonus figures and the April and May payroll", async () => {
    await ownerC.payrollSalary.componentSeedDefaults();
    await ownerC.payrollLeave.typeSeedDefaults();
    const comps = await ownerC.payrollSalary.componentList();
    const c = (code: string) => comps.find((x) => x.code === code)!.id;
    const t = await ownerC.payrollSalary.templateCreate({
      name: "Staff",
      sampleAnnualCtc: 240000,
      lines: [
        { componentId: c("BASIC"), calcType: "percent_of_ctc", value: 50 },
        { componentId: c("HRA"), calcType: "percent_of_basic", value: 40 },
        { componentId: c("SPECIAL"), calcType: "balance", value: 0 },
      ],
    });
    for (const [code, name, ctc] of [["R1", "Asha Verma", 480000], ["R2", "Bharat Joshi", 600000], ["R3", "Chitra Rao", 360000]] as const) {
      const e = await ownerC.payrollEmployee.create({ employeeCode: code, name, dateOfJoining: "2019-04-01", email: `${code.toLowerCase()}@example.in` });
      await ownerC.payrollSalary.assign({ employeeId: e.id, templateId: t.id, annualCtc: ctc, effectiveFrom: "2025-01-01" });
      ids[code] = e.id;
    }
    // A loan of 30,000 for R1, interest free, six instalments from June (nothing is due before the exit).
    const loan = await hrC.payrollLoan.create({ employeeId: ids.R1!, kind: "loan", amount: 30000, interestRate: 0, installments: 6, startMonth: "2026-06", issueDate: "2026-03-25", purpose: "Advance" });
    await ownerC.payrollLoan.approve({ id: loan.id });
    await accountantC.payrollLoan.disburse({ id: loan.id, bankAccountId: bank.id, paidOn: "2026-03-26" });
    ids.loan = loan.id;
    // The provision is booked while everyone is active; the settlements draw from it.
    await accountantC.payrollGratuity.postProvision({ asOf: "2026-03-31" });
    const rates = { ...defaultStatutoryRates(), bonus: { ...defaultStatutoryRates().bonus, eligibilityCeilingRupees: 21000, wageCeilingRupees: 7000, minimumWageRupees: 0 } };
    await ownerC.payrollStatutory.saveRates({ financialYear: 2026, rates, verifiedNote: "Checked with CA for the test" } as never);
    await ownerC.payrollLeave.accrue({ month: "2026-04" });
    await ownerC.payrollLeave.accrue({ month: "2026-05" });
    await hrC.payrollEmployee.exit({ id: ids.R1!, lastWorkingDay: "2026-05-20", reason: "resignation" });
    await hrC.payrollEmployee.exit({ id: ids.R2!, lastWorkingDay: "2026-05-25", reason: "resignation" });
    await approvedRun("2026-04");
    await approvedRun("2026-05");
    expect(Object.keys(ids)).toHaveLength(4);
  }, 180_000);

  it("posts the settlements of R1 (with bonus due and a manual recovery) and R2", async () => {
    ids.s1 = await settle(ids.R1!);
    await hrC.payrollFnf.update({ id: ids.s1, includeBonus: true, noticeShortfallDays: 2, deductions: [{ name: "Uniform not returned", amount: 300 }] });
    ids.s2 = await settle(ids.R2!);
    const d1 = await hrC.payrollFnf.get({ id: ids.s1 });
    const kinds = d1.lines.map((l) => l.kind);
    expect(kinds).toEqual(expect.arrayContaining(["leave_encashment", "gratuity", "bonus", "notice_recovery", "other_deduction", "loan_recovery"]));
    await submitApprovePost(ids.s1);
    await submitApprovePost(ids.s2);
    expect((await ownerC.payrollFnf.get({ id: ids.s1 })).settlement.status).toBe("posted");
    // The bonus of R1 sits in his settlement, so a bonus run leaves him out.
    const bonus = await hrC.payrollBonus.create({ financialYear: 2026, percent: 8.33 });
    ids.bonusRun = bonus.id;
    await hrC.payrollBonus.calculate({ id: bonus.id });
    const line = (await hrC.payrollBonus.get({ id: bonus.id })).lines.find((l) => l.employeeCode === "R1")!;
    expect(line).toMatchObject({ eligible: false, reason: "manual" });
  }, 120_000);
});

describe("who may reverse, and when", () => {
  it("needs a reason, a posting role and a posted settlement", async () => {
    await expect(accountantC.payrollFnf.reverse({ id: ids.s1!, reason: "" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(accountantC.payrollFnf.reverse({ id: ids.s1!, reason: "abc" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(hrC.payrollFnf.reverse({ id: ids.s1!, reason: "Posted against the wrong employee" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(sellerC.payrollFnf.reverse({ id: ids.s1!, reason: "Posted against the wrong employee" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(hrC.payrollFnf.reversePayment({ id: ids.s1!, reason: "Paid from the wrong account" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(sellerC.payrollFnf.reversePayment({ id: ids.s1!, reason: "Paid from the wrong account" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Another business cannot see it, let alone reverse it.
    await expect(ownerBC.payrollFnf.reverse({ id: ids.s1!, reason: "Posted against the wrong employee" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(ownerBC.payrollFnf.reversePayment({ id: ids.s1!, reason: "Paid from the wrong account" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Nothing changed.
    expect((await ownerC.payrollFnf.get({ id: ids.s1! })).settlement.status).toBe("posted");
    // A settlement that is not posted (a draft for R3, who has not even left) is not reversible; a posted, unpaid one has no payment to reverse.
    await hrC.payrollEmployee.exit({ id: ids.R3!, lastWorkingDay: "2026-05-30", reason: "resignation" });
    ids.s3 = await settle(ids.R3!);
    await expect(accountantC.payrollFnf.reverse({ id: ids.s3, reason: "Not needed any more" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(accountantC.payrollFnf.reversePayment({ id: ids.s1!, reason: "Paid from the wrong account" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("reversing a posted, unpaid settlement", () => {
  it("negates the entry, restores the loan, the leave, the provision and the bonus, keeps the employee exited, and is audited", async () => {
    const before = await ownerC.payrollFnf.get({ id: ids.s1! });
    const accrualId = before.settlement.accrualJournalEntryId!;
    const leaveBefore = await leaveBalanceOf(ids.R1!);
    expect((await hrC.payrollLoan.get({ id: ids.loan! })).loan.status).toBe("closed");
    const postedBook = await bookBalances();
    const accrualNet = await netOf([accrualId]);
    expect(accrualNet["2441"]).toBeGreaterThan(0); // the gratuity came out of the provision (a debit)
    expect(accrualNet["1260"]).toBe(-3_000_000);

    const r = await accountantC.payrollFnf.reverse({ id: ids.s1!, reason: "Settled against the wrong exit date" });
    expect(r.created).toBe(true);
    expect(r.settlement).toMatchObject({ status: "reversed", reversalReason: "Settled against the wrong exit date" });
    expect(r.journalEntryId).toBeTruthy();

    // The books: the mirror negates the accrual entry exactly, account by account, and the original is voided by it.
    expect(await netOf([accrualId, r.journalEntryId!])).toEqual({});
    const [orig] = await db().select().from(journalEntries).where(eq(journalEntries.id, accrualId));
    const [mirror] = await db().select().from(journalEntries).where(eq(journalEntries.id, r.journalEntryId!));
    expect(orig).toMatchObject({ isVoided: true, voidedByEntryId: mirror!.id });
    expect(mirror).toMatchObject({ reversesEntryId: accrualId, source: "system" });
    expect(mirror!.entryDate.toISOString()).toBe(orig!.entryDate.toISOString());
    // The whole book moves by exactly minus the accrual entry (the gratuity is back in the provision, the loan is receivable again).
    const after = await bookBalances();
    const expected = { ...postedBook };
    for (const [k, v] of Object.entries(accrualNet)) expected[k] = (expected[k] ?? 0) - v;
    for (const k of new Set([...Object.keys(after), ...Object.keys(expected)])) expect([k, after[k] ?? 0]).toEqual([k, expected[k] ?? 0]);

    // The loan: balance restored through an appended event (nothing deleted), active again, a new schedule for the balance.
    const loan = await hrC.payrollLoan.get({ id: ids.loan! });
    expect(loan.loan.status).toBe("active");
    expect(loan.outstanding).toBe("30000.00");
    expect(loan.events.map((e) => e.kind)).toEqual(["issued", "approved", "disbursed", "fnf_recovered", "closed", "fnf_reversed"]);
    const open = (await db().select().from(employeeLoanInstallments).where(and(eq(employeeLoanInstallments.loanId, ids.loan!), eq(employeeLoanInstallments.status, "open"))));
    expect(open.reduce((n, i) => n + paise(i.principal), 0)).toBe(3_000_000);
    expect(paise(loan.loan.emi)).toBe(500_000);

    // Leave: the encashed days are back on the balance (a compensating row; the encashment row is still there).
    expect(await leaveBalanceOf(ids.R1!)).toBeGreaterThan(leaveBefore);
    const enc = await db().select().from(leaveLedger).where(and(eq(leaveLedger.employeeId, ids.R1!), eq(leaveLedger.kind, "encashment")));
    expect(enc.length).toBeGreaterThan(0);

    // The employee is not reactivated; the settlement stays on record and the statement PDF is still available.
    const [emp] = await db().select().from(employees).where(eq(employees.id, ids.R1!));
    expect(emp).toMatchObject({ status: "exited", lastWorkingDay: "2026-05-20" });
    const pdf = await hrC.payrollFnf.statementPdf({ id: ids.s1! });
    expect(Buffer.from(pdf.base64, "base64").subarray(0, 4).toString()).toBe("%PDF");
    expect((await hrC.payrollFnf.list()).find((s) => s.id === ids.s1)).toMatchObject({ status: "reversed" });

    // The bonus: the reversed settlement no longer counts, so a fresh calculation takes the employee in again.
    await hrC.payrollBonus.calculate({ id: ids.bonusRun! });
    expect((await hrC.payrollBonus.get({ id: ids.bonusRun! })).lines.find((l) => l.employeeCode === "R1")).toMatchObject({ eligible: true });

    // Audit.
    const rows = await db().select().from(auditLog).where(and(eq(auditLog.businessId, biz.id), eq(auditLog.action, "payroll.fnf.reverse")));
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0]!.metadata)).toContain("Settled against the wrong exit date");
  });

  it("is idempotent: a second call returns the first result and changes nothing", async () => {
    const first = await ownerC.payrollFnf.get({ id: ids.s1! });
    const again = await accountantC.payrollFnf.reverse({ id: ids.s1!, reason: "A different reason the second time" });
    expect(again.created).toBe(false);
    expect(again.journalEntryId).toBe(first.settlement.reversalJournalEntryId);
    expect(again.settlement.reversalReason).toBe("Settled against the wrong exit date");
    const events = await db().select().from(employeeLoanEvents).where(and(eq(employeeLoanEvents.loanId, ids.loan!), eq(employeeLoanEvents.kind, "fnf_reversed")));
    expect(events).toHaveLength(1);
    const mirrors = await db().select().from(journalEntries).where(eq(journalEntries.reversesEntryId, first.settlement.accrualJournalEntryId!));
    expect(mirrors).toHaveLength(1);
  });

  it("a reversed settlement is final: it cannot be edited, calculated, submitted, posted or paid again", async () => {
    await expect(hrC.payrollFnf.calculate({ id: ids.s1! })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(hrC.payrollFnf.update({ id: ids.s1!, noticeShortfallDays: 1 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(hrC.payrollFnf.submit({ id: ids.s1! })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(ownerC.payrollFnf.approve({ id: ids.s1! })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(accountantC.payrollFnf.post({ id: ids.s1! })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(accountantC.payrollFnf.markPaid({ id: ids.s1!, bankAccountId: bank.id, paidOn: "2026-06-05" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(hrC.payrollFnf.delete({ id: ids.s1! })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // And the entries it posted cannot be voided by hand (that would skip the loans and leave).
    const s = (await ownerC.payrollFnf.get({ id: ids.s1! })).settlement;
    await expect(ownerC.journal.void({ id: s.reversalJournalEntryId! })).rejects.toThrow(/full and final/);
    await expect(ownerC.journal.void({ id: s.accrualJournalEntryId! })).rejects.toThrow(/full and final/);
  });

  it("a new settlement for the same employee can be prepared, and it recovers the same loan again", async () => {
    const s = await hrC.payrollFnf.create({ employeeId: ids.R1!, encashmentBasis: "basic_da_26" });
    expect(s.id).not.toBe(ids.s1);
    expect(s.number).not.toBe((await ownerC.payrollFnf.get({ id: ids.s1! })).settlement.number);
    const d = await hrC.payrollFnf.get({ id: s.id });
    expect(d.lines.find((l) => l.kind === "loan_recovery")).toMatchObject({ amount: "30000.00" });
    // Only one live settlement per employee.
    await expect(hrC.payrollFnf.create({ employeeId: ids.R1!, encashmentBasis: "basic_da_26" })).rejects.toMatchObject({ code: "CONFLICT" });
    await submitApprovePost(s.id);
    const loan = await hrC.payrollLoan.get({ id: ids.loan! });
    expect(loan.loan.status).toBe("closed");
    expect(loan.outstanding).toBe("0.00");
    expect(loan.events.map((e) => e.kind)).toEqual(["issued", "approved", "disbursed", "fnf_recovered", "closed", "fnf_reversed", "fnf_recovered", "closed"]);
    expect((await hrC.payrollFnf.list()).filter((x) => x.employeeId === ids.R1).map((x) => x.status).sort()).toEqual(["posted", "reversed"]);
    // And it can be reversed in turn (a second, separate reversal event).
    const again = await accountantC.payrollFnf.reverse({ id: s.id, reason: "Second thoughts on the leave encashment" });
    expect(again.created).toBe(true);
    expect((await hrC.payrollLoan.get({ id: ids.loan! })).outstanding).toBe("30000.00");
  }, 60_000);
});

describe("a paid settlement", () => {
  it("is refused until its payment is reversed (the money goes back into the account it left), then reverses", async () => {
    const start = await bankBalance();
    const net = paise((await ownerC.payrollFnf.get({ id: ids.s2! })).settlement.netPayable);
    const paid = await accountantC.payrollFnf.markPaid({ id: ids.s2!, bankAccountId: bank.id, paidOn: "2026-06-05", reference: "NEFT-R2" });
    expect(await bankBalance()).toBe(start - net);
    const err = await accountantC.payrollFnf.reverse({ id: ids.s2!, reason: "Wrong employee settled" }).then(() => null, (e) => e);
    expect(err).toMatchObject({ code: "BAD_REQUEST" });
    expect(String(err.message)).toMatch(/Reverse the payment first/);
    expect((await ownerC.payrollFnf.get({ id: ids.s2! })).settlement.status).toBe("paid");

    const rp = await accountantC.payrollFnf.reversePayment({ id: ids.s2!, reason: "Paid from the wrong account" });
    expect(rp.created).toBe(true);
    expect(rp.settlement).toMatchObject({ status: "posted", paidOn: null, paymentJournalEntryId: null, paymentReversalReason: "Paid from the wrong account" });
    expect(await bankBalance()).toBe(start);
    expect(await netOf([paid.journalEntryId!, rp.journalEntryId!])).toEqual({});
    const [payEntry] = await db().select().from(journalEntries).where(eq(journalEntries.id, paid.journalEntryId!));
    expect(payEntry).toMatchObject({ isVoided: true, voidedByEntryId: rp.journalEntryId });
    // Idempotent.
    const rp2 = await accountantC.payrollFnf.reversePayment({ id: ids.s2!, reason: "Again" });
    expect(rp2).toMatchObject({ created: false, journalEntryId: rp.journalEntryId });
    expect(await bankBalance()).toBe(start);
    // It can be paid again (from the right account) and the payment reversed again.
    await accountantC.payrollFnf.markPaid({ id: ids.s2!, bankAccountId: bank.id, paidOn: "2026-06-06", reference: "NEFT-R2B" });
    expect(await bankBalance()).toBe(start - net);
    await accountantC.payrollFnf.reversePayment({ id: ids.s2!, reason: "Paid twice by mistake" });
    expect(await bankBalance()).toBe(start);
    // Now the settlement itself reverses.
    const r = await accountantC.payrollFnf.reverse({ id: ids.s2!, reason: "Wrong employee settled" });
    expect(r.settlement.status).toBe("reversed");
    expect(await bankBalance()).toBe(start);
    const audit = await db().select().from(auditLog).where(and(eq(auditLog.businessId, biz.id), eq(auditLog.action, "payroll.fnf.reversePayment")));
    expect(audit.length).toBe(3); // two reversals and the idempotent repeat
  }, 60_000);
});

describe("registers", () => {
  it("the settlements register shows the reversed status and the deductions register shows each recovery and its put back", async () => {
    const fnf = await ownerC.payrollStatutory.register({ register: "fnf", financialYear: 2026 });
    expect(fnf.text).toContain("reversed");
    const ded = await ownerC.payrollStatutory.register({ register: "deductions", financialYear: 2026 });
    expect(ded.text).toContain("fnf recovered");
    expect(ded.text).toContain("fnf reversed");
    expect(ded.text).toMatch(/'-30000\.00/); // the put back is a negative recovery (with the spreadsheet guard)
    const pdf = await ownerC.payrollStatutory.register({ register: "deductions", financialYear: 2026, format: "pdf" });
    expect(pdf.contentType).toBe("application/pdf");
  });
});

describe("the data audit", () => {
  it("finds nothing wrong after all of it", async () => {
    const tables = new Set(["fnf_settlements", "fnf_settlement_lines", "employee_loans", "employee_loan_installments", "employee_loan_events", "bonus_runs", "bonus_run_lines", "gratuity_provisions"]);
    const report = await runAudit(getTestClient(), { businessIds: [biz.id] });
    expect(report.results.filter((r) => tables.has(r.rule.table)).map((r) => `${r.rule.id}: ${r.samples.map((x) => x.detail).join("; ")}`)).toEqual([]);
  });

  it("catches a reversal that does not negate the original", async () => {
    const [s] = await db().select().from(fnfSettlements).where(eq(fnfSettlements.id, ids.s2!));
    const lines = await db().select().from(journalEntryLines).where(eq(journalEntryLines.journalEntryId, s!.reversalJournalEntryId!));
    await db().update(journalEntryLines).set({ debit: "1.00", credit: "0" }).where(eq(journalEntryLines.id, lines[0]!.id));
    const report = await runAudit(getTestClient(), { businessIds: [biz.id] });
    expect(report.results.some((r) => r.rule.id.includes("reversed-negates-original") && r.samples.length > 0)).toBe(true);
    await db().update(journalEntryLines).set({ debit: lines[0]!.debit, credit: lines[0]!.credit }).where(eq(journalEntryLines.id, lines[0]!.id));
  });
});
