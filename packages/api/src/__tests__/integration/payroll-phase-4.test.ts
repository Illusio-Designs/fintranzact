/**
 * payroll-phase-4.test.ts — Payroll Phase 4 (bonus, gratuity, loans and advances, full and final settlement, relieving
 * letters and the extra registers) against a real Postgres.
 *
 * Invariants:
 *   1. Everything is gated by the Payroll add-on and the Payroll permission; HR prepares, owners and admins approve
 *      (maker-checker) and owners, admins and accountants post and pay (PayrollPosting).
 *   2. The bonus run refuses to calculate until the ceilings are set (they ship empty), is exact, respects the manual
 *      "not eligible" flag and posts a balanced, idempotent entry.
 *   3. Gratuity is exact (15/26, rounding of the part year, the minimum service) and the provision is posted once.
 *   4. A loan is issued, approved, disbursed and recovered through payroll runs (payslip line, balanced posting split into
 *      loans receivable and interest income), with a cap on the share of net pay, skip, prepayment and foreclosure.
 *   5. The full and final settlement never pays the last month's salary (the exit month's run does), recovers the loan
 *      balance, encashes leave once, draws the gratuity from the provision, and cannot be approved by its preparer.
 *   6. The relieving letter and the registers are produced and audited; the data audit finds nothing wrong.
 *   7. Another business sees none of it.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { auditLog, bankAccounts, businessMembers, chartOfAccounts, employeeLoanEvents, employeeLoans, fnfSettlements, journalEntries, journalEntryLines, leaveLedger, payslips } from "@fintranzact/db";
import { defaultStatutoryRates } from "@fintranzact/shared";
import { createTenant, createUser, addMember, createBusiness, createBankAccount, grantAddon, type TestUser, type TestTenant, type TestBusiness } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { getTenantTestDb, getTestClient, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { runAudit } from "../../lib/data-audit/runner.js";
import { seedChartOfAccounts } from "../../lib/coa-seed.js";
import { entitlementDataOf } from "../../lib/entitlement-error.js";
import { invalidateEntitlements } from "../../lib/entitlements.js";

const db = () => getTenantTestDb();
type Caller = ReturnType<typeof createTestCaller>;
const callerFor = (u: TestUser, t: TestTenant, b: TestBusiness): Caller =>
  createTestCaller({ userId: u.id, email: u.email, name: u.name ?? null, tenantId: t.id, businessId: b.id });
const paise = (s: string | number) => Math.round(Number(s) * 100);

let tenant: TestTenant;
let biz: TestBusiness;
let owner: TestUser;
let ownerC: Caller;
let admin2C: Caller;
let hrC: Caller;
let accountantC: Caller;
let sellerC: Caller;
let tenantB: TestTenant;
let bizB: TestBusiness;
let ownerBC: Caller;
let bank: { id: string };
const ids: Record<string, string> = {};

async function person(t: TestTenant, b: TestBusiness, email: string, role: "admin" | "accountant" | "seller" | "hr", bizRole: "admin" | "member") {
  const u = await createUser({ email, name: email.split("@")[0] });
  await addMember(t.id, u.id, role);
  await db().insert(businessMembers).values({ businessId: b.id, userId: u.id, role: bizRole });
  return u;
}

/** Account code -> debit and credit totals of one journal entry. */
async function entryOf(id: string): Promise<Record<string, { debit: number; credit: number }>> {
  const rows = await db()
    .select({ code: chartOfAccounts.code, debit: journalEntryLines.debit, credit: journalEntryLines.credit })
    .from(journalEntryLines)
    .innerJoin(chartOfAccounts, eq(chartOfAccounts.id, journalEntryLines.accountId))
    .where(eq(journalEntryLines.journalEntryId, id));
  const out: Record<string, { debit: number; credit: number }> = {};
  for (const r of rows) {
    const o = out[r.code] ?? { debit: 0, credit: 0 };
    o.debit += paise(r.debit);
    o.credit += paise(r.credit);
    out[r.code] = o;
  }
  return out;
}
const balanced = (e: Record<string, { debit: number; credit: number }>) =>
  Object.values(e).reduce((s, v) => s + v.debit, 0) === Object.values(e).reduce((s, v) => s + v.credit, 0);

async function bankBalance(): Promise<number> {
  const [row] = await db().select().from(bankAccounts).where(eq(bankAccounts.id, bank.id));
  return paise(row!.currentBalance);
}

/** A run that HR calculates and submits (the owner approves it when asked to). */
async function prepareRun(month: string): Promise<string> {
  const run = await hrC.payrollRun.create({ month });
  await hrC.payrollRun.lockAttendance({ id: run.id, fillUnmarked: "present" });
  await hrC.payrollRun.calculate({ id: run.id });
  await hrC.payrollRun.submit({ id: run.id });
  return run.id;
}
async function approvedRun(month: string): Promise<string> {
  const id = await prepareRun(month);
  await ownerC.payrollRun.approve({ id });
  return id;
}

const lineOf = async (runId: string, code: string) => (await ownerC.payrollRun.get({ id: runId })).lines.find((l) => l.employeeCode === code)!;

beforeAll(async () => {
  tenant = await createTenant({ name: "Phase Four Co" });
  owner = await createUser({ email: "owner@phase4.in", name: "Ramesh Kumar" });
  await addMember(tenant.id, owner.id, "owner");
  biz = await createBusiness(db(), owner.id, { name: "Phase Four Co", legalName: "Phase Four Co Pvt Ltd" });
  await db().insert(businessMembers).values({ businessId: biz.id, userId: owner.id, role: "admin" });
  const admin2 = await person(tenant, biz, "admin2@phase4.in", "admin", "admin");
  const hr = await person(tenant, biz, "hr@phase4.in", "hr", "member");
  const accountant = await person(tenant, biz, "anita@phase4.in", "accountant", "member");
  const seller = await person(tenant, biz, "sunil@phase4.in", "seller", "member");
  await seedChartOfAccounts(db(), biz.id);
  bank = await createBankAccount(db(), biz.id, { accountName: "HDFC Current", accountType: "current", currentBalance: "1000000.00", openingBalance: "1000000.00" });
  ownerC = callerFor(owner, tenant, biz);
  admin2C = callerFor(admin2, tenant, biz);
  hrC = callerFor(hr, tenant, biz);
  accountantC = callerFor(accountant, tenant, biz);
  sellerC = callerFor(seller, tenant, biz);

  tenantB = await createTenant({ name: "Other Phase Org" });
  const ownerB = await createUser({ email: "owner@otherphase.in", name: "Kiran Mehta" });
  await addMember(tenantB.id, ownerB.id, "owner");
  bizB = await createBusiness(db(), ownerB.id, { name: "Other Phase Org" });
  await db().insert(businessMembers).values({ businessId: bizB.id, userId: ownerB.id, role: "admin" });
  await seedChartOfAccounts(db(), bizB.id);
  ownerBC = callerFor(ownerB, tenantB, bizB);
}, 120_000);

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

const reasonOf = (e: unknown) => entitlementDataOf(e)?.reason;

describe("gating", () => {
  it("every Phase 4 procedure needs the Payroll add-on", async () => {
    for (const call of [
      () => ownerBC.payrollBonus.list(),
      () => ownerBC.payrollBonus.create({ financialYear: 2025, percent: 8.33 }),
      () => ownerBC.payrollGratuity.estimate({}),
      () => ownerBC.payrollFnf.list(),
      () => ownerBC.payrollLoan.list({}),
      () => ownerBC.payrollLetter.template({ kind: "relieving" }),
    ]) {
      const err = await call().then(() => null, (e) => e);
      expect(err).toMatchObject({ code: "FORBIDDEN" });
      expect(reasonOf(err)).toBe("addon_required");
    }
    await grantAddon(tenant.id, "payroll");
    await grantAddon(tenantB.id, "payroll");
  });

  it("a role without the Payroll permission is refused", async () => {
    await expect(sellerC.payrollBonus.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(sellerC.payrollLoan.list({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(sellerC.payrollFnf.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(sellerC.payrollGratuity.estimate({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(sellerC.payrollLetter.template({ kind: "relieving" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("a read-only organisation reads but cannot write", async () => {
    const t = await createTenant({ name: "Ended Trial Phase", trialStartedAt: new Date(Date.now() - 20 * 86_400_000), trialEndsAt: new Date(Date.now() - 86_400_000), trialSource: "signup" });
    const o = await createUser({ email: "owner@endedphase.in", name: "Old Owner" });
    await addMember(t.id, o.id, "owner");
    const b = await createBusiness(db(), o.id, { name: "Ended Trial Phase" });
    await db().insert(businessMembers).values({ businessId: b.id, userId: o.id, role: "admin" });
    const c = callerFor(o, t, b);
    expect(await c.payrollLoan.list({})).toEqual([]);
    expect(await c.payrollFnf.list()).toEqual([]);
    const err = await c.payrollBonus.create({ financialYear: 2025, percent: 8.33 }).then(() => null, (e) => e);
    expect(err).toMatchObject({ code: "FORBIDDEN" });
    expect(reasonOf(err)).toBe("read_only_trial_expired");
    invalidateEntitlements(t.id);
  });
});

describe("setup", () => {
  it("builds salary structures and four employees", async () => {
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
    const mk = async (code: string, name: string, joined: string, ctc: number) => {
      const e = await ownerC.payrollEmployee.create({ employeeCode: code, name, dateOfJoining: joined, email: `${code.toLowerCase()}@example.in`, bankAccountNumber: "123456789012", bankIfsc: "ICIC0000123", bankAccountName: name.toUpperCase() });
      await ownerC.payrollSalary.assign({ employeeId: e.id, templateId: t.id, annualCtc: ctc, effectiveFrom: "2025-01-01" });
      ids[code] = e.id;
    };
    await mk("E101", "Asha Verma", "2024-04-01", 240000); // basic 10,000
    await mk("E102", "Bharat Joshi", "2019-04-01", 600000); // basic 25,000
    await mk("E103", "Chitra Rao", "2020-01-01", 600000); // basic 25,000
    await mk("E104", "Deepak Menon", "2019-06-01", 480000); // basic 20,000
    expect(Object.keys(ids)).toHaveLength(4);
  });

  it("approves the payroll of January to March 2026 (the wages the bonus is worked out from)", async () => {
    for (const m of ["2026-01", "2026-02", "2026-03"]) ids[`run${m}`] = await approvedRun(m);
    const l = await lineOf(ids["run2026-03"]!, "E101");
    expect(l.netPay).toBe("20000.00");
  }, 120_000);
});

describe("bonus", () => {
  it("ships the ceilings empty: the run cannot be calculated until they are set", async () => {
    const rules = await hrC.payrollBonus.rules({ financialYear: 2025 });
    expect(rules.rules).toMatchObject({ minPercent: 8.33, maxPercent: 20, minWorkingDays: 30, eligibilityCeilingRupees: 0, wageCeilingRupees: 0 });
    expect(rules.gaps).toHaveLength(2);
    const run = await hrC.payrollBonus.create({ financialYear: 2025, percent: 8.33 });
    ids.bonus = run.id;
    expect(run).toMatchObject({ number: "BN-2025-26", status: "draft" });
    await expect(hrC.payrollBonus.calculate({ id: run.id })).rejects.toThrow(/eligibility wage ceiling is not configured/);
    await expect(hrC.payrollBonus.create({ financialYear: 2025, percent: 8.33 })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(hrC.payrollBonus.create({ financialYear: 2024, percent: 8.2 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(hrC.payrollBonus.create({ financialYear: 2024, percent: 21 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("the owner sets the figures for the year (HR cannot)", async () => {
    const rates = { ...defaultStatutoryRates(), bonus: { ...defaultStatutoryRates().bonus, eligibilityCeilingRupees: 21000, wageCeilingRupees: 7000, minimumWageRupees: 0 } };
    await expect(hrC.payrollStatutory.saveRates({ financialYear: 2025, rates })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await ownerC.payrollStatutory.saveRates({ financialYear: 2025, rates, verifiedNote: "Checked with CA for the test" } as never);
    expect((await hrC.payrollBonus.rules({ financialYear: 2025 })).gaps).toEqual([]);
  });

  it("calculates exactly: wages capped at the ceiling, the percentage once, ineligible staff at zero", async () => {
    const { run, warnings } = await hrC.payrollBonus.calculate({ id: ids.bonus! });
    expect(run).toMatchObject({ status: "calculated", employeeCount: 4, eligibleCount: 2, totalBonus: "3498.60" });
    expect(warnings.map((w) => w.code)).toContain("months_without_payroll");
    const d = await hrC.payrollBonus.get({ id: ids.bonus! });
    const by = Object.fromEntries(d.lines.map((l) => [l.employeeCode, l]));
    expect(by.E101).toMatchObject({ eligible: true, bonus: "1749.30", wages: "30000.00", calculationWages: "21000.00", monthsPaid: 3 });
    expect(by.E104).toMatchObject({ eligible: true, bonus: "1749.30" });
    expect(by.E102).toMatchObject({ eligible: false, reason: "wage_above_ceiling", bonus: "0.00" });
    expect(by.E103).toMatchObject({ eligible: false, bonus: "0.00" });
  });

  it("a hand exclusion needs a recalculation and is respected", async () => {
    await hrC.payrollBonus.setExclusion({ runId: ids.bonus!, employeeId: ids.E104!, reason: "Dismissed for misconduct" });
    await hrC.payrollBonus.submit({ id: ids.bonus! });
    // The lines still show the old figure, so the run cannot be approved before it is calculated again.
    await expect(ownerC.payrollBonus.approve({ id: ids.bonus! })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await hrC.payrollBonus.calculate({ id: ids.bonus! });
    const d = await hrC.payrollBonus.get({ id: ids.bonus! });
    expect(d.run.totalBonus).toBe("1749.30");
    expect(d.lines.find((l) => l.employeeCode === "E104")).toMatchObject({ eligible: false, reason: "manual", bonus: "0.00" });
    expect(d.lines.find((l) => l.employeeCode === "E104")!.reasonText).toContain("misconduct");
    await expect(hrC.payrollBonus.update({ id: ids.bonus!, percent: 25 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("maker-checker: HR prepares, the preparer cannot approve, HR cannot approve or post, another admin can", async () => {
    await hrC.payrollBonus.submit({ id: ids.bonus! });
    await expect(hrC.payrollBonus.approve({ id: ids.bonus! })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Calculated by the owner now, so the owner cannot approve it but the other admin can.
    await ownerC.payrollBonus.reopen({ id: ids.bonus! });
    await ownerC.payrollBonus.calculate({ id: ids.bonus! });
    await ownerC.payrollBonus.submit({ id: ids.bonus! });
    const err = await ownerC.payrollBonus.approve({ id: ids.bonus! }).then(() => null, (e) => e);
    expect(err).toMatchObject({ code: "FORBIDDEN" });
    expect(String(err.message)).toContain("bonus run");
    expect((await ownerC.payrollBonus.get({ id: ids.bonus! })).approval.canApprove).toBe(false);
    // The reopen discarded the manual exclusion's lines but not the exclusion itself.
    expect((await ownerC.payrollBonus.get({ id: ids.bonus! })).run.totalBonus).toBe("1749.30");
    const approved = await admin2C.payrollBonus.approve({ id: ids.bonus! });
    expect(approved).toMatchObject({ status: "approved", approvedByName: expect.any(String) });
    await expect(hrC.payrollBonus.post({ id: ids.bonus! })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(hrC.payrollBonus.markPaid({ runId: ids.bonus!, bankAccountId: bank.id, paidOn: "2026-04-10" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(hrC.payrollBonus.calculate({ id: ids.bonus! })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("posts one balanced, idempotent entry (Dr bonus expense / Cr bonus payable) and pays it", async () => {
    const before = await db().select().from(journalEntries).where(eq(journalEntries.businessId, biz.id));
    const p = await accountantC.payrollBonus.post({ id: ids.bonus! });
    expect(p.created).toBe(true);
    const again = await accountantC.payrollBonus.post({ id: ids.bonus! });
    expect(again).toMatchObject({ created: false, journalEntryId: p.journalEntryId });
    expect((await db().select().from(journalEntries).where(eq(journalEntries.businessId, biz.id))).length).toBe(before.length + 1);
    const e = await entryOf(p.journalEntryId);
    expect(e["5202"]).toEqual({ debit: 174930, credit: 0 });
    expect(e["2440"]).toEqual({ debit: 0, credit: 174930 });
    expect(balanced(e)).toBe(true);
    const [row] = await db().select().from(journalEntries).where(eq(journalEntries.id, p.journalEntryId));
    expect(row!.entryDate.toISOString().slice(0, 10)).toBe("2026-03-31"); // the last day of FY 2025-26

    const bal = await bankBalance();
    const paid = await accountantC.payrollBonus.markPaid({ runId: ids.bonus!, bankAccountId: bank.id, paidOn: "2026-04-10", reference: "NEFT-1" });
    expect(paid.created).toBe(true);
    expect(await bankBalance()).toBe(bal - 174930);
    expect(balanced(await entryOf(paid.journalEntryId!))).toBe(true);
    expect((await accountantC.payrollBonus.markPaid({ runId: ids.bonus!, bankAccountId: bank.id, paidOn: "2026-04-10" })).created).toBe(false);
    expect(await bankBalance()).toBe(bal - 174930);
  });

  it("produces the statement as CSV and PDF and a bank file", async () => {
    const csv = await hrC.payrollBonus.statementCsv({ id: ids.bonus! });
    expect(csv.csv).toContain("Asha Verma");
    expect(csv.csv).toContain("1749.30");
    expect(csv.csv).toContain("Dismissed for misconduct");
    const pdf = await hrC.payrollBonus.statementPdf({ id: ids.bonus! });
    expect(Buffer.from(pdf.base64, "base64").subarray(0, 4).toString()).toBe("%PDF");
    const file = await hrC.payrollBonus.bankFile({ id: ids.bonus! });
    expect(file).toMatchObject({ count: 1, total: "1749.30" });
  });
});

describe("gratuity", () => {
  it("estimates the liability exactly: 15/26 x last drawn Basic + DA x years, minimum five years", async () => {
    const est = await hrC.payrollGratuity.estimate({ asOf: "2026-03-31" });
    const by = Object.fromEntries(est.rows.map((r) => [r.employeeCode, r]));
    expect(by.E102).toMatchObject({ completedYears: 7, yearsUsed: 7, eligible: true, amount: "100961.54", lastDrawnWages: "25000.00" });
    expect(by.E103).toMatchObject({ completedYears: 6, yearsUsed: 6, eligible: true, amount: "86538.46" });
    expect(by.E104).toMatchObject({ completedYears: 6, yearsUsed: 7, eligible: true, amount: "80769.23" }); // 6 years 10 months: the part year counts
    expect(by.E101).toMatchObject({ completedYears: 2, eligible: false, amount: "0.00" });
    expect(est.liability).toBe("268269.23");
    expect(est.provisionInBooks).toBe("0.00");
  });

  it("books the provision once, by HR never, and not again when nothing changed", async () => {
    await expect(hrC.payrollGratuity.postProvision({ asOf: "2026-03-31" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const p = await accountantC.payrollGratuity.postProvision({ asOf: "2026-03-31" });
    expect(p.amountPaise).toBe(26826923);
    const e = await entryOf(p.journalEntryId);
    expect(e["5205"]).toEqual({ debit: 26826923, credit: 0 });
    expect(e["2441"]).toEqual({ debit: 0, credit: 26826923 });
    await expect(accountantC.payrollGratuity.postProvision({ asOf: "2026-03-31" })).rejects.toThrow(/already equals/);
    expect((await hrC.payrollGratuity.estimate({ asOf: "2026-03-31" })).provisionInBooks).toBe("268269.23");
    expect(await hrC.payrollGratuity.provisionHistory()).toHaveLength(1);
  });
});

describe("loans and advances", () => {
  const loanInput = (employeeId: string, over: Record<string, unknown> = {}) => ({ employeeId, kind: "loan" as const, amount: 100000, interestRate: 12, installments: 12, startMonth: "2026-04", issueDate: "2026-03-25", purpose: "Medical", ...over });

  it("previews the schedule: textbook EMI, interest each month, the last instalment closes the balance", async () => {
    const p = await hrC.payrollLoan.schedulePreview({ amount: 100000, interestRate: 12, installments: 12, startMonth: "2026-04" });
    expect(p).toMatchObject({ emi: "8884.88", count: 12 });
    expect(p.rows[0]).toMatchObject({ month: "2026-04", interest: "1000.00", principal: "7884.88" });
    expect(p.rows[11]).toMatchObject({ month: "2027-03", closing: "0.00" });
    await expect(hrC.payrollLoan.schedulePreview({ amount: 100000, interestRate: 12, emi: 500, startMonth: "2026-04" })).rejects.toThrow(/too small/);
    await expect(hrC.payrollLoan.schedulePreview({ amount: 1000, startMonth: "2026-04" } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("HR issues, the requester cannot approve their own, an owner approves, an accountant disburses", async () => {
    const loan = await hrC.payrollLoan.create(loanInput(ids.E103!));
    ids.loanC = loan.id;
    expect(loan).toMatchObject({ number: "LN-0001", status: "pending_approval", emi: "8884.88", installmentCount: 12 });
    await expect(hrC.payrollLoan.approve({ id: loan.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // A manager who requests cannot approve it either.
    const own = await admin2C.payrollLoan.create(loanInput(ids.E102!, { amount: 5000, interestRate: 0, installments: 2, startMonth: "2026-05", purpose: "Advance" }));
    ids.loanB = own.id;
    const err = await admin2C.payrollLoan.approve({ id: own.id }).then(() => null, (e) => e);
    expect(err).toMatchObject({ code: "FORBIDDEN" });
    expect(String(err.message)).toContain("requested this loan");
    await ownerC.payrollLoan.approve({ id: own.id });
    await ownerC.payrollLoan.approve({ id: loan.id });
    await expect(ownerC.payrollLoan.approve({ id: loan.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(hrC.payrollLoan.disburse({ id: loan.id, bankAccountId: bank.id, paidOn: "2026-03-26" })).rejects.toMatchObject({ code: "FORBIDDEN" });

    const bal = await bankBalance();
    const d = await accountantC.payrollLoan.disburse({ id: loan.id, bankAccountId: bank.id, paidOn: "2026-03-26", reference: "NEFT-L1" });
    expect(d.loan.status).toBe("active");
    const e = await entryOf(d.journalEntryId);
    expect(e["1260"]).toEqual({ debit: 10_000_000, credit: 0 });
    expect(e["1010"]).toEqual({ debit: 0, credit: 10_000_000 });
    expect(await bankBalance()).toBe(bal - 10_000_000);
    expect((await accountantC.payrollLoan.disburse({ id: loan.id, bankAccountId: bank.id, paidOn: "2026-03-26" })).journalEntryId).toBe(d.journalEntryId);
    expect(await bankBalance()).toBe(bal - 10_000_000);
    expect((await hrC.payrollLoan.get({ id: loan.id })).outstanding).toBe("100000.00");
  });

  it("an advance for the other employee, a loan for the one who will leave, a rejected and a cancelled request", async () => {
    await accountantC.payrollLoan.disburse({ id: ids.loanB!, bankAccountId: bank.id, paidOn: "2026-03-27" });
    const dl = await hrC.payrollLoan.create(loanInput(ids.E104!, { amount: 30000, interestRate: 0, installments: 6, purpose: "Festival advance" }));
    ids.loanD = dl.id;
    await ownerC.payrollLoan.approve({ id: dl.id });
    await accountantC.payrollLoan.disburse({ id: dl.id, bankAccountId: bank.id, paidOn: "2026-03-28" });
    const rej = await hrC.payrollLoan.create(loanInput(ids.E101!, { amount: 2000, interestRate: 0, installments: 2 }));
    await expect(ownerC.payrollLoan.reject({ id: rej.id, note: "x" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await ownerC.payrollLoan.reject({ id: rej.id, note: "Not eligible yet" })).status).toBe("rejected");
    const can = await hrC.payrollLoan.create(loanInput(ids.E101!, { amount: 2000, interestRate: 0, installments: 2 }));
    expect((await hrC.payrollLoan.cancel({ id: can.id })).status).toBe("cancelled");
    await expect(accountantC.payrollLoan.disburse({ id: can.id, bankAccountId: bank.id, paidOn: "2026-03-28" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await hrC.payrollLoan.list({ status: "active" })).map((l) => l.loan.number).sort()).toEqual(["LN-0001", "LN-0002", "LN-0003"]);
  });

  it("the April run deducts the instalments (source loan, on the payslip), approval records them, posting splits principal and interest", async () => {
    await ownerC.payrollLeave.accrue({ month: "2026-04" });
    await ownerC.payrollLeave.accrue({ month: "2026-05" });
    ids["run2026-04"] = await approvedRun("2026-04");
    const l = await lineOf(ids["run2026-04"]!, "E103");
    const loanParts = l.components.filter((c) => c.source === "loan");
    expect(loanParts.map((c) => [c.name, c.amount, c.loanPart])).toEqual([
      ["Loan recovery LN-0001", "7884.88", "principal"],
      ["Loan interest LN-0001", "1000.00", "interest"],
    ]);
    expect(l.netPay).toBe("41115.12"); // 50,000 less the instalment of 8,884.88
    // The advance of the other employee starts in May; the festival advance of the future leaver is recovered in April.
    expect((await lineOf(ids["run2026-04"]!, "E104")).components.find((c) => c.source === "loan")).toMatchObject({ amount: "5000.00" });
    expect((await lineOf(ids["run2026-04"]!, "E102")).components.some((c) => c.source === "loan")).toBe(false);

    const slip = (await db().select().from(payslips).where(and(eq(payslips.runId, ids["run2026-04"]!), eq(payslips.employeeId, ids.E103!))))[0]!;
    expect(JSON.stringify(slip.snapshot)).toContain("Loan recovery LN-0001");

    const detail = await hrC.payrollLoan.get({ id: ids.loanC! });
    expect(detail.outstanding).toBe("92115.12");
    expect(detail.installments.find((i) => i.seq === 1)).toMatchObject({ status: "paid", paidPrincipal: "7884.88", paidInterest: "1000.00" });
    expect(detail.events.map((e) => e.kind)).toEqual(["issued", "approved", "disbursed", "emi_recovered"]);

    const run = await accountantC.payrollRun.post({ id: ids["run2026-04"]! });
    const e = await entryOf(run.journalEntryId);
    expect(e["1260"]!.credit).toBe(788488 + 500000);
    expect(e["4110"]).toEqual({ debit: 0, credit: 100000 });
    expect(e["2410"]).toBeUndefined();
    expect(balanced(e)).toBe(true);
    expect((await accountantC.payrollRun.post({ id: ids["run2026-04"]! })).created).toBe(false);
  }, 60_000);

  it("a prepayment shortens the loan at the same EMI; foreclosure closes it; a skipped instalment moves the rest", async () => {
    const bal = await bankBalance();
    await expect(hrC.payrollLoan.prepay({ id: ids.loanB!, bankAccountId: bank.id, receivedOn: "2026-04-20", amount: 1000, interest: 0 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const part = await accountantC.payrollLoan.prepay({ id: ids.loanC!, bankAccountId: bank.id, receivedOn: "2026-04-20", amount: 20000, interest: 150, reference: "CHQ-9" });
    expect(part).toMatchObject({ principalPaise: 2_000_000, balancePaise: 7_211_512 });
    expect(await bankBalance()).toBe(bal + 2_015_000);
    const e = await entryOf(part.journalEntryId);
    expect(e["1260"]).toEqual({ debit: 0, credit: 2_000_000 });
    expect(e["4110"]).toEqual({ debit: 0, credit: 15000 });
    expect(balanced(e)).toBe(true);
    const detail = await hrC.payrollLoan.get({ id: ids.loanC! });
    const open = detail.installments.filter((i) => i.status === "open");
    expect(open.length).toBeLessThan(11);
    expect(open[0]!.dueMonth).toBe("2026-05");
    expect(detail.installments.filter((i) => i.status === "superseded").length).toBeGreaterThan(0);
    await expect(accountantC.payrollLoan.prepay({ id: ids.loanC!, bankAccountId: bank.id, receivedOn: "2026-04-21", amount: 9_999_999, interest: 0 })).rejects.toThrow(/outstanding/);

    // Skip the next instalment of the advance (two instalments of 2,500 from May): it moves to June and July.
    await expect(hrC.payrollLoan.skip({ id: ids.loanB!, reason: "x" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await hrC.payrollLoan.skip({ id: ids.loanB!, reason: "Employee on unpaid leave in May" });
    const b = await hrC.payrollLoan.get({ id: ids.loanB! });
    expect(b.installments.find((i) => i.status === "skipped")).toMatchObject({ dueMonth: "2026-05", note: "Employee on unpaid leave in May" });
    expect(b.installments.filter((i) => i.status === "open").map((i) => i.dueMonth)).toEqual(["2026-06", "2026-07"]);
    expect(b.events.at(-1)).toMatchObject({ kind: "skipped" });
    // Reschedule it to one instalment from August, then foreclose.
    await hrC.payrollLoan.reschedule({ id: ids.loanB!, reason: "Agreed with employee", installments: 1, firstMonth: "2026-08" });
    expect((await hrC.payrollLoan.get({ id: ids.loanB! })).installments.filter((i) => i.status === "open").map((i) => [i.dueMonth, i.principal])).toEqual([["2026-08", "5000.00"]]);
    const fc = await accountantC.payrollLoan.foreclose({ id: ids.loanB!, bankAccountId: bank.id, receivedOn: "2026-04-25", interest: 0 });
    expect(fc.loan.status).toBe("closed");
    expect(fc.principalPaise).toBe(500_000);
    expect((await hrC.payrollLoan.get({ id: ids.loanB! })).outstanding).toBe("0.00");
    await expect(accountantC.payrollLoan.foreclose({ id: ids.loanB!, bankAccountId: bank.id, receivedOn: "2026-04-26", interest: 0 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("the statement lists every event with the balance after it", async () => {
    const s = await hrC.payrollLoan.statementCsv({ id: ids.loanC! });
    expect(s.csv).toContain("emi recovered");
    expect(s.csv).toContain("prepaid");
    expect(s.filename).toBe("loan-statement-LN-0001.csv");
  });
});

describe("full and final settlement", () => {
  it("only an employee who has left, on or after the last working day", async () => {
    await expect(hrC.payrollFnf.create({ employeeId: ids.E104!, encashmentBasis: "basic_da_26" })).rejects.toThrow(/Record the employee's exit/);
    await hrC.payrollEmployee.exit({ id: ids.E104!, lastWorkingDay: "2026-05-20", reason: "resignation" });
    await expect(hrC.payrollFnf.create({ employeeId: ids.E103!, encashmentBasis: "basic_da_26" })).rejects.toThrow(/Record the employee's exit/);
  });

  it("prepares it: leave encashment, gratuity from the provision, notice recovery, manual TDS and the loan balance, with the TDS warning", async () => {
    const s = await hrC.payrollFnf.create({ employeeId: ids.E104!, encashmentBasis: "basic_da_26", note: "Resigned" });
    ids.fnf = s.id;
    expect(s).toMatchObject({ number: "FF-0001", status: "draft", salaryMonth: "2026-05" });
    await expect(hrC.payrollFnf.create({ employeeId: ids.E104!, encashmentBasis: "basic_da_26" })).rejects.toMatchObject({ code: "CONFLICT" });
    await hrC.payrollFnf.update({ id: s.id, noticeShortfallDays: 5, tdsAmount: 1000, earnings: [{ name: "Arrears of April", amount: 500, kind: "arrears" }], deductions: [{ name: "Uniform not returned", amount: 300 }] });
    const d = await hrC.payrollFnf.get({ id: s.id });
    const by = Object.fromEntries(d.lines.map((l) => [l.kind, l]));
    expect(by.leave_encashment).toMatchObject({ amount: "2307.69", side: "earning" }); // 3 days x 20,000 / 26
    expect(by.gratuity).toMatchObject({ amount: "80769.23" });
    expect(by.arrears).toMatchObject({ amount: "500.00" });
    expect(by.notice_recovery).toMatchObject({ amount: "6666.67" }); // 5 days x 40,000 / 30
    expect(by.tds).toMatchObject({ amount: "1000.00" });
    expect(by.other_deduction).toMatchObject({ amount: "300.00" });
    expect(by.loan_recovery).toMatchObject({ amount: "25000.00" }); // 30,000 less the April instalment
    const gross = 230769 + 8076923 + 50000;
    expect(d.settlement.grossTotal).toBe((gross / 100).toFixed(2));
    expect(paise(d.settlement.netPayable)).toBe(gross - 666667 - 100000 - 30000 - 2500000);
    expect(d.settlement.warnings.map((w) => w.code)).toContain("tds_not_computed");
    expect(d.tdsWarning).toMatch(/NOT calculated/);
  });

  it("the last month's salary is not in the settlement and the settlement waits for the run that pays it", async () => {
    await expect(hrC.payrollFnf.submit({ id: ids.fnf! })).rejects.toThrow(/payroll run/);
    // The May run: the future leaver is in it (his salary is paid there), his loan instalment is left to the settlement,
    // and C's instalment is limited to 10% of net pay (the cap is data).
    await expect(hrC.payrollLoan.updateSettings({ maxDeductionPercent: 10 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await ownerC.payrollLoan.updateSettings({ maxDeductionPercent: 10 });
    expect((await hrC.payrollLoan.settings()).maxDeductionPercent).toBe(10);
    ids["run2026-05"] = await prepareRun("2026-05");
    const run = await ownerC.payrollRun.get({ id: ids["run2026-05"]! });
    const d = run.lines.find((l) => l.employeeCode === "E104")!;
    expect(d.isFinalSettlement).toBe(true);
    expect(d.components.some((c) => c.source === "loan")).toBe(false);
    expect(d.warnings.map((w) => w.code)).toContain("loan_in_fnf");
    expect(Number(d.netPay)).toBeGreaterThan(0);
    const c = run.lines.find((l) => l.employeeCode === "E103")!;
    const recovered = c.components.filter((x) => x.source === "loan").reduce((s, x) => s + paise(x.amount), 0);
    expect(recovered).toBe(Math.floor((50000_00 * 10) / 100)); // 10% of net pay
    expect(c.warnings.map((w) => w.code)).toContain("loan_arrears");
    await ownerC.payrollLoan.updateSettings({ maxDeductionPercent: 50 });

    // The balance moved after the run was calculated: approval refuses it, the run is calculated again, then approved.
    await expect(ownerC.payrollRun.approve({ id: ids["run2026-05"]! })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await hrC.payrollRun.calculate({ id: ids["run2026-05"]! });
    await hrC.payrollRun.submit({ id: ids["run2026-05"]! });
    await ownerC.payrollRun.approve({ id: ids["run2026-05"]! });
    const arrears = (await hrC.payrollLoan.get({ id: ids.loanC! })).installments.filter((i) => i.status === "open");
    expect(arrears.length).toBeGreaterThan(0);
    const mayLine = await lineOf(ids["run2026-05"]!, "E104");
    ids.maySalary = mayLine.netPay;
  }, 60_000);

  it("is calculated again, submitted, cannot be approved by its preparer, and shows the salary as paid through the run", async () => {
    await hrC.payrollFnf.update({ id: ids.fnf!, includeBonus: true });
    const d = await hrC.payrollFnf.get({ id: ids.fnf! });
    expect(d.salary).toMatchObject({ state: "in_run", month: "2026-05", netPay: ids.maySalary });
    const bonus = d.lines.find((l) => l.kind === "bonus")!;
    expect(bonus.label).toContain("2026-27");
    // April in full (cap 7,000) and May for 20 of 31 days (cap 7,000 x 40/62 = 4,516.13): 11,516.13 x 8.33%
    expect(bonus.amount).toBe("959.29");
    const sub = await hrC.payrollFnf.submit({ id: ids.fnf! });
    expect(sub.status).toBe("pending_approval");
    await expect(hrC.payrollFnf.approve({ id: ids.fnf! })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await ownerC.payrollFnf.get({ id: ids.fnf! })).approval.canApprove).toBe(true);
  });

  it("approval records the effects once: the loan is recovered and closed, the encashed leave leaves the balance", async () => {
    // The preparer changes nothing but the owner is also not the preparer, so the owner approves.
    const approved = await ownerC.payrollFnf.approve({ id: ids.fnf! });
    expect(approved.status).toBe("approved");
    const loan = await hrC.payrollLoan.get({ id: ids.loanD! });
    expect(loan).toMatchObject({ outstanding: "0.00" });
    expect(loan.loan.status).toBe("closed");
    expect(loan.events.map((e) => e.kind)).toEqual(["issued", "approved", "disbursed", "emi_recovered", "fnf_recovered", "closed"]);
    const ledger = await db().select().from(leaveLedger).where(and(eq(leaveLedger.employeeId, ids.E104!), eq(leaveLedger.kind, "encashment")));
    expect(ledger.map((l) => l.days)).toEqual(["-3.00"]);
    await expect(ownerC.payrollFnf.approve({ id: ids.fnf! })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(hrC.payrollEmployee.reactivate({ id: ids.E104! })).rejects.toThrow(/full and final/);
    await expect(hrC.payrollFnf.calculate({ id: ids.fnf! })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(hrC.payrollFnf.delete({ id: ids.fnf! })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("posts a balanced, idempotent entry that draws the gratuity from the provision, and pays net once", async () => {
    await expect(hrC.payrollFnf.post({ id: ids.fnf! })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const s = (await ownerC.payrollFnf.get({ id: ids.fnf! })).settlement;
    const p = await accountantC.payrollFnf.post({ id: ids.fnf! });
    expect(p.created).toBe(true);
    expect((await accountantC.payrollFnf.post({ id: ids.fnf! })).created).toBe(false);
    const e = await entryOf(p.journalEntryId!);
    expect(balanced(e)).toBe(true);
    expect(e["2441"]).toEqual({ debit: 8076923, credit: 0 }); // the whole gratuity comes out of the provision
    expect(e["5205"]).toBeUndefined();
    expect(e["2442"]!.credit).toBe(paise(s.netPayable));
    expect(e["1260"]!.credit).toBe(2_500_000);
    expect(e["2410"]!.credit).toBe(666667 + 30000);
    expect(e["2434"]!.credit).toBe(100000);
    expect(Object.values(e).reduce((n, v) => n + v.debit, 0)).toBe(paise(s.grossTotal));
    expect((await hrC.payrollGratuity.estimate({ asOf: "2026-03-31" })).provisionInBooks).toBe("187500.00");

    const bal = await bankBalance();
    const paid = await accountantC.payrollFnf.markPaid({ id: ids.fnf!, bankAccountId: bank.id, paidOn: "2026-06-05", reference: "NEFT-FF1" });
    expect(paid.created).toBe(true);
    expect(await bankBalance()).toBe(bal - paise(s.netPayable));
    expect((await accountantC.payrollFnf.markPaid({ id: ids.fnf!, bankAccountId: bank.id, paidOn: "2026-06-05" })).created).toBe(false);
    expect(await bankBalance()).toBe(bal - paise(s.netPayable));
    expect(balanced(await entryOf(paid.journalEntryId!))).toBe(true);
  });

  it("never pays the final month twice: the settlement's payable holds no salary and the run pays it once", async () => {
    const s = (await ownerC.payrollFnf.get({ id: ids.fnf! })).settlement;
    const lines = (await ownerC.payrollFnf.get({ id: ids.fnf! })).lines;
    expect(lines.some((l) => /salary|wage/i.test(l.label))).toBe(false);
    const sumEarn = lines.filter((l) => l.side === "earning").reduce((n, l) => n + paise(l.amount), 0);
    expect(sumEarn).toBe(paise(s.grossTotal));
    // The run still pays the May salary of the person who left.
    const run = await ownerC.payrollRun.get({ id: ids["run2026-05"]! });
    expect(paise(run.lines.find((l) => l.employeeCode === "E104")!.netPay)).toBe(paise(ids.maySalary!));
    expect((await db().select().from(fnfSettlements).where(eq(fnfSettlements.employeeId, ids.E104!))).length).toBe(1);
  });

  it("the statement is a PDF", async () => {
    const pdf = await hrC.payrollFnf.statementPdf({ id: ids.fnf! });
    expect(pdf.filename).toBe("full-and-final-FF-0001.pdf");
    expect(Buffer.from(pdf.base64, "base64").subarray(0, 4).toString()).toBe("%PDF");
  });
});

describe("bonus and the settlement do not pay the same bonus twice", () => {
  it("a bonus run for the year of the exit leaves out the employee whose bonus was settled in full and final", async () => {
    await ownerC.payrollBonus.create({ financialYear: 2026, percent: 8.33 }).then((r) => (ids.bonus26 = r.id));
    const { run } = await hrC.payrollBonus.calculate({ id: ids.bonus26! });
    const d = await hrC.payrollBonus.get({ id: ids.bonus26! });
    expect(run.employeeCount).toBeGreaterThanOrEqual(3);
    expect(d.lines.find((l) => l.employeeCode === "E104")).toMatchObject({ eligible: false, reason: "manual", bonus: "0.00" });
    expect(d.lines.find((l) => l.employeeCode === "E104")!.reasonText).toContain("FF-0001");
    expect(d.lines.find((l) => l.employeeCode === "E101")).toMatchObject({ eligible: true });
    await hrC.payrollBonus.reopen({ id: ids.bonus26! });
    await hrC.payrollBonus.delete({ id: ids.bonus26! });
  });
});

describe("relieving letter", () => {
  it("is available after exit, uses the template with placeholders, and is audited", async () => {
    const t = await hrC.payrollLetter.template({ kind: "relieving" });
    expect(t).toMatchObject({ isDefault: true, title: "Relieving Letter" });
    expect(t.placeholders).toContain("employee_name");
    await expect(hrC.payrollLetter.saveTemplate({ kind: "relieving", title: "Relieving Letter", body: "Dear {{employee_name}}, your {{salary}} is settled." })).rejects.toThrow(/Unknown placeholder/);
    const saved = await hrC.payrollLetter.saveTemplate({ kind: "relieving", title: "Relieving Letter", body: "This certifies that {{employee_name}} ({{employee_code}}) worked with {{company_name}} until {{last_working_day}}.", signatoryName: "R. Kumar", signatoryTitle: "Director", place: "Mumbai" });
    expect(saved).toMatchObject({ isDefault: false, signatoryName: "R. Kumar" });
    const letter = await hrC.payrollLetter.relievingPdf({ employeeId: ids.E104!, kind: "relieving" });
    expect(Buffer.from(letter.base64, "base64").subarray(0, 4).toString()).toBe("%PDF");
    expect(letter.filename).toBe("relieving-letter-E104.pdf");
    await expect(hrC.payrollLetter.relievingPdf({ employeeId: ids.E101!, kind: "relieving" })).rejects.toThrow(/exit is recorded/);
    const log = await db().select().from(auditLog).where(and(eq(auditLog.businessId, biz.id), eq(auditLog.action, "payroll.letter.generate")));
    expect(log).toHaveLength(1);
    expect(log[0]!.entityId).toBe(ids.E104);
    await expect(sellerC.payrollLetter.relievingPdf({ employeeId: ids.E104!, kind: "relieving" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("registers", () => {
  it("produce working-copy registers from existing data", async () => {
    const emp = await ownerC.payrollStatutory.register({ register: "employment" });
    expect(emp.count).toBe(4);
    expect(emp.text).toContain("Deepak Menon");
    expect(emp.text).toContain("exited");
    const given = await ownerC.payrollStatutory.register({ register: "deductions", financialYear: 2025 });
    expect(given.text).toContain("Advance / loan given");
    expect(given.count).toBe(3);
    const ded = await ownerC.payrollStatutory.register({ register: "deductions", financialYear: 2026 });
    expect(ded.text).toContain("Advance / loan recovered");
    expect(ded.text).toContain("LN-0003");
    expect(ded.count).toBeGreaterThanOrEqual(6);
    const ot = await ownerC.payrollStatutory.register({ register: "overtime", financialYear: 2026 });
    expect(ot.count).toBe(0);
    expect(ot.text).toContain("Overtime Hours");
    const fnf = await ownerC.payrollStatutory.register({ register: "fnf", financialYear: 2026 });
    expect(fnf.count).toBe(1);
    expect(fnf.text).toContain("FF-0001");
    expect((emp as unknown as { note: string }).note).toMatch(/not a statutory form/);
    await expect(sellerC.payrollStatutory.register({ register: "employment" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("isolation and the data audit", () => {
  it("another business sees none of it", async () => {
    await expect(ownerBC.payrollLoan.get({ id: ids.loanC! })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(ownerBC.payrollFnf.get({ id: ids.fnf! })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(ownerBC.payrollBonus.get({ id: ids.bonus! })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(ownerBC.payrollLoan.approve({ id: ids.loanC! })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(ownerBC.payrollLoan.create(loanFor(ids.E101!))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(ownerBC.payrollLetter.relievingPdf({ employeeId: ids.E104!, kind: "relieving" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await ownerBC.payrollLoan.list({})).toEqual([]);
    expect(await ownerBC.payrollFnf.list()).toEqual([]);
    expect((await ownerBC.payrollGratuity.estimate({})).rows).toEqual([]);
  });

  it("finds nothing wrong in the payroll this suite built, and catches a loan that was recovered too much", async () => {
    const tables = new Set(["bonus_runs", "bonus_run_lines", "gratuity_provisions", "fnf_settlements", "fnf_settlement_lines", "employee_loans", "employee_loan_installments", "employee_loan_events", "payroll_letter_templates", "payroll_runs", "payroll_run_lines"]);
    const report = await runAudit(getTestClient(), { businessIds: [biz.id] });
    expect(report.results.filter((r) => tables.has(r.rule.table)).map((r) => `${r.rule.id}: ${r.samples.map((x) => x.detail).join("; ")}`)).toEqual([]);
    expect(report.failures.filter((f) => tables.has(f.rule.table)).map((f) => `${f.rule.id}: ${f.error}`)).toEqual([]);

    const [loan] = await db().select().from(employeeLoans).where(eq(employeeLoans.id, ids.loanC!));
    const [ev] = await db().select().from(employeeLoanEvents).where(and(eq(employeeLoanEvents.loanId, loan!.id), eq(employeeLoanEvents.kind, "emi_recovered")));
    await db().update(employeeLoanEvents).set({ principal: "999999.00" }).where(eq(employeeLoanEvents.id, ev!.id));
    const bad = await runAudit(getTestClient(), { businessIds: [biz.id] });
    expect(bad.results.map((r) => r.rule.id)).toContain("employee_loans.balance-within-principal");
    await db().update(employeeLoanEvents).set({ principal: ev!.principal }).where(eq(employeeLoanEvents.id, ev!.id));
  });
});

function loanFor(employeeId: string) {
  return { employeeId, kind: "loan" as const, amount: 1000, interestRate: 0, installments: 2, startMonth: "2026-06", issueDate: "2026-05-01" };
}
