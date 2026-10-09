/**
 * payroll-self-loans.test.ts - the employee's read-only view of their OWN loans and advances (payrollSelf.loans and
 * payrollSelf.loanStatement) against a real Postgres.
 *
 * Invariants:
 *   1. Own only: the employee is found from the signed-in login, never from input; another employee's loan id, a loan of another
 *      business or organisation, and a loan that is not visible to employees (waiting for approval, rejected, cancelled) all
 *      answer NOT_FOUND, indistinguishable from an id that does not exist.
 *   2. Only approved, paid out (active) and closed loans are visible; the amounts, balance, EMI, the next instalment and the
 *      instalments left are right; the statement shows the schedule in force and the money events, nothing internal.
 *   3. An employee without loans gets an empty list.
 *   4. Owners, HR and accountants are refused (this is for employee logins only); the add-on and the read-only rules are those
 *      of the other payrollSelf queries.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { businessMembers, employeeLoans, employeeLogins, employees } from "@fintranzact/db";
import { createTenant, createUser, addMember, createBusiness, createBankAccount, grantAddon, type TestUser, type TestTenant, type TestBusiness } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { getControlDb, getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { seedChartOfAccounts } from "../../lib/coa-seed.js";
import { entitlementDataOf } from "../../lib/entitlement-error.js";
import { invalidateEntitlements } from "../../lib/entitlements.js";

const db = () => getTenantTestDb();
type Caller = ReturnType<typeof createTestCaller>;
const callerFor = (u: TestUser, t: TestTenant, b: TestBusiness): Caller =>
  createTestCaller({ userId: u.id, email: u.email, name: u.name ?? null, tenantId: t.id, businessId: b.id });
const reasonOf = (e: unknown) => entitlementDataOf(e)?.reason;

let tenant: TestTenant;
let biz: TestBusiness;
let biz2: TestBusiness;
let ownerC: Caller;
let ownerB2C: Caller;
let hrC: Caller;
let accountantC: Caller;
let e1C: Caller;
let e2C: Caller;
let e3C: Caller;
let otherOrgOwnerC: Caller;
let bank: { id: string };
const ids: Record<string, string> = {};

async function team(email: string, role: "hr" | "accountant", bizRole: "admin" | "member" = "member") {
  const u = await createUser({ email, name: email.split("@")[0] });
  await addMember(tenant.id, u.id, role);
  await db().insert(businessMembers).values({ businessId: biz.id, userId: u.id, role: bizRole });
  return u;
}

/** An employee with a login in `biz` (the link rows are made directly: this suite is about what the employee sees). */
async function employeeWithLogin(code: string, name: string) {
  const [emp] = await db().insert(employees).values({ businessId: biz.id, employeeCode: code, name, dateOfJoining: "2024-04-01" }).returning();
  const u = await createUser({ email: `${code.toLowerCase()}@selfloans.in`, name });
  await addMember(tenant.id, u.id, "employee");
  await db().insert(businessMembers).values({ businessId: biz.id, userId: u.id, role: "member" });
  await db().insert(employeeLogins).values({ businessId: biz.id, employeeId: emp!.id, userId: u.id });
  ids[code] = emp!.id;
  return callerFor(u, tenant, biz);
}

const loanInput = (employeeId: string, over: Record<string, unknown> = {}) => ({ employeeId, kind: "loan" as const, amount: 12000, interestRate: 0, installments: 6, startMonth: "2026-11", issueDate: "2026-10-01", purpose: "Medical", ...over });

beforeAll(async () => {
  tenant = await createTenant({ name: "Self Loans Co" });
  await grantAddon(tenant.id, "payroll");
  const owner = await createUser({ email: "owner@selfloans.in", name: "Ramesh Kumar" });
  await addMember(tenant.id, owner.id, "owner");
  biz = await createBusiness(db(), owner.id, { name: "Self Loans Co" });
  await db().insert(businessMembers).values({ businessId: biz.id, userId: owner.id, role: "admin" });
  biz2 = await createBusiness(db(), owner.id, { name: "Self Loans Branch" });
  await db().insert(businessMembers).values({ businessId: biz2.id, userId: owner.id, role: "admin" });
  await seedChartOfAccounts(db(), biz.id);
  bank = await createBankAccount(db(), biz.id, { accountName: "HDFC Current", accountType: "current", currentBalance: "1000000.00", openingBalance: "1000000.00" });
  ownerC = callerFor(owner, tenant, biz);
  ownerB2C = callerFor(owner, tenant, biz2);
  const hr = await team("hr@selfloans.in", "hr");
  const accountant = await team("anita@selfloans.in", "accountant");
  hrC = callerFor(hr, tenant, biz);
  accountantC = callerFor(accountant, tenant, biz);
  e1C = await employeeWithLogin("E1", "Asha Verma");
  e2C = await employeeWithLogin("E2", "Bharat Joshi");
  e3C = await employeeWithLogin("E3", "Chitra Rao");

  // Another organisation with an employee and a loan.
  const tenantC = await createTenant({ name: "Other Self Org" });
  await grantAddon(tenantC.id, "payroll");
  const ownerC2 = await createUser({ email: "owner@otherselforg.in", name: "Kiran Mehta" });
  await addMember(tenantC.id, ownerC2.id, "owner");
  const bizC = await createBusiness(db(), ownerC2.id, { name: "Other Self Org" });
  await db().insert(businessMembers).values({ businessId: bizC.id, userId: ownerC2.id, role: "admin" });
  otherOrgOwnerC = callerFor(ownerC2, tenantC, bizC);
}, 120_000);

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

describe("setup: loans in every state for E1, one for E2, one in another business and one in another organisation", () => {
  it("builds them through the HR workflow", async () => {
    // E1: active (paid out), approved but not paid out, closed (foreclosed), and three that employees must never see.
    const active = await hrC.payrollLoan.create(loanInput(ids.E1!, { amount: 12000, installments: 6 }));
    await ownerC.payrollLoan.approve({ id: active.id });
    await accountantC.payrollLoan.disburse({ id: active.id, bankAccountId: bank.id, paidOn: "2026-10-02" });
    ids.active = active.id;
    const approved = await hrC.payrollLoan.create(loanInput(ids.E1!, { amount: 3000, installments: 3, kind: "advance", purpose: "Festival" }));
    await ownerC.payrollLoan.approve({ id: approved.id });
    ids.approved = approved.id;
    const closed = await hrC.payrollLoan.create(loanInput(ids.E1!, { amount: 2000, installments: 2, kind: "advance", purpose: "Old advance" }));
    await ownerC.payrollLoan.approve({ id: closed.id });
    await accountantC.payrollLoan.disburse({ id: closed.id, bankAccountId: bank.id, paidOn: "2026-10-03" });
    await accountantC.payrollLoan.foreclose({ id: closed.id, bankAccountId: bank.id, receivedOn: "2026-10-04" });
    ids.closed = closed.id;
    ids.pending = (await hrC.payrollLoan.create(loanInput(ids.E1!, { amount: 1000, installments: 2 }))).id;
    const rejected = await hrC.payrollLoan.create(loanInput(ids.E1!, { amount: 1100, installments: 2 }));
    await ownerC.payrollLoan.reject({ id: rejected.id, note: "Internal reason: not eligible" });
    ids.rejected = rejected.id;
    const cancelled = await hrC.payrollLoan.create(loanInput(ids.E1!, { amount: 1200, installments: 2 }));
    await hrC.payrollLoan.cancel({ id: cancelled.id });
    ids.cancelled = cancelled.id;
    // E2's own loan.
    const l2 = await hrC.payrollLoan.create(loanInput(ids.E2!, { amount: 6000, installments: 3, purpose: "Bike" }));
    await ownerC.payrollLoan.approve({ id: l2.id });
    await accountantC.payrollLoan.disburse({ id: l2.id, bankAccountId: bank.id, paidOn: "2026-10-02" });
    ids.l2 = l2.id;
    // Another business of the same organisation, and another organisation.
    const [x] = await db().insert(employees).values({ businessId: biz2.id, employeeCode: "X1", name: "Branch Employee", dateOfJoining: "2024-04-01" }).returning();
    const lb = await ownerB2C.payrollLoan.create({ ...loanInput(x!.id), amount: 5000 });
    await ownerB2C.payrollLoan.approve({ id: lb.id });
    ids.otherBusiness = lb.id;
    const y = await otherOrgOwnerC.payrollEmployee.create({ employeeCode: "Y1", name: "Other Org Employee", dateOfJoining: "2024-04-01" });
    const ly = await otherOrgOwnerC.payrollLoan.create({ ...loanInput(y.id), amount: 4000 });
    ids.otherOrg = ly.id;
    expect(Object.keys(ids).length).toBeGreaterThan(10);
  }, 120_000);
});

describe("payrollSelf.loans", () => {
  it("lists only my approved, paid out and closed loans, with the figures that matter", async () => {
    const list = await e1C.payrollSelf.loans();
    expect(list.map((l) => l.number).sort()).toEqual(["LN-0001", "LN-0002", "LN-0003"]);
    expect(list.map((l) => l.status).sort()).toEqual(["active", "approved", "closed"]);
    const active = list.find((l) => l.id === ids.active)!;
    expect(active).toMatchObject({ kind: "loan", status: "active", principal: "12000.00", emi: "2000.00", installmentCount: 6, disbursedOn: "2026-10-02", purpose: "Medical", outstanding: "12000.00", recoveredPrincipal: "0.00", nextInstalmentMonth: "2026-11", nextInstalmentAmount: "2000.00", remainingInstalments: 6 });
    // Approved but not paid out: no balance, no instalments yet.
    expect(list.find((l) => l.id === ids.approved)).toMatchObject({ status: "approved", kind: "advance", outstanding: "0.00", nextInstalmentMonth: null, nextInstalmentAmount: null, remainingInstalments: 0 });
    // Closed: nothing left.
    expect(list.find((l) => l.id === ids.closed)).toMatchObject({ status: "closed", outstanding: "0.00", recoveredPrincipal: "2000.00", remainingInstalments: 0, nextInstalmentMonth: null });
    // Nothing internal leaks: no approver, notes, bank, journal or user ids.
    for (const l of list) {
      expect(Object.keys(l).sort()).toEqual(
        ["emi", "id", "installmentCount", "interestRate", "issueDate", "kind", "disbursedOn", "nextInstalmentAmount", "nextInstalmentMonth", "number", "outstanding", "principal", "purpose", "recoveredInterest", "recoveredPrincipal", "remainingInstalments", "status"].sort(),
      );
    }
  });

  it("follows the loan: a part-payment lowers the balance and the instalments left", async () => {
    await accountantC.payrollLoan.prepay({ id: ids.active!, bankAccountId: bank.id, receivedOn: "2026-10-10", amount: 4000 });
    const l = (await e1C.payrollSelf.loans()).find((x) => x.id === ids.active)!;
    expect(l).toMatchObject({ outstanding: "8000.00", recoveredPrincipal: "4000.00", emi: "2000.00", remainingInstalments: 4, nextInstalmentMonth: "2026-11", nextInstalmentAmount: "2000.00" });
  });

  it("each employee sees only their own; one without loans gets an empty list", async () => {
    expect((await e2C.payrollSelf.loans()).map((l) => l.id)).toEqual([ids.l2]);
    expect(await e3C.payrollSelf.loans()).toEqual([]);
  });

  it("takes no employee id: an extra id from the client is ignored", async () => {
    const out = await e3C.payrollSelf.loans({ employeeId: ids.E1 } as never);
    expect(out).toEqual([]);
    const out2 = await e1C.payrollSelf.loans({ employeeId: ids.E2 } as never);
    expect(out2.map((l) => l.id)).not.toContain(ids.l2);
  });
});

describe("payrollSelf.loanStatement", () => {
  it("shows my loan's schedule in force and its money events, nothing internal", async () => {
    const s = await e1C.payrollSelf.loanStatement({ id: ids.active! });
    expect(s.loan).toMatchObject({ id: ids.active, number: "LN-0001", outstanding: "8000.00" });
    // The schedule in force: the replaced instalments are not shown; four open ones remain.
    expect(s.schedule.filter((x) => x.status === "open")).toHaveLength(4);
    expect(s.schedule.every((x) => x.status !== "superseded")).toBe(true);
    expect(s.schedule[0]).toMatchObject({ dueMonth: "2026-11", principal: "2000.00", interest: "0.00", recovered: "0.00", status: "open" });
    // Events: paid out and the part-payment; never "issued" or "approved" (they carry no money and name approvers).
    expect(s.events.map((e) => e.kind)).toEqual(["disbursed", "prepaid"]);
    expect(s.events.map((e) => e.description)).toEqual(["Paid to you", "Part-payment received"]);
    expect(s.events[1]).toMatchObject({ principal: "4000.00", balanceAfter: "8000.00", date: "2026-10-10" });
    const flat = JSON.stringify(s);
    for (const secret of ["decisionNote", "approvedBy", "requestedBy", "createdBy", "journal", "bankAccount", "settlement", "Internal reason"]) expect(flat).not.toContain(secret);
    for (const e of s.events) expect(Object.keys(e).sort()).toEqual(["balanceAfter", "date", "description", "id", "interest", "kind", "principal"].sort());
  });

  it("an approved loan not yet paid out and a closed loan can be opened too", async () => {
    expect((await e1C.payrollSelf.loanStatement({ id: ids.approved! })).events).toEqual([]);
    const closed = await e1C.payrollSelf.loanStatement({ id: ids.closed! });
    expect(closed.events.map((e) => e.kind)).toEqual(["disbursed", "foreclosed", "closed"]);
  });

  it("another employee's loan, another business's, another organisation's, an unseen state and a made-up id are all NOT_FOUND, the same way", async () => {
    const messages = new Set<string>();
    for (const id of [ids.l2!, ids.otherBusiness!, ids.otherOrg!, ids.pending!, ids.rejected!, ids.cancelled!, "00000000-0000-4000-8000-000000000000"]) {
      const err = await e1C.payrollSelf.loanStatement({ id }).then(() => null, (e) => e);
      expect(err, id).toMatchObject({ code: "NOT_FOUND" });
      messages.add(String(err.message));
    }
    expect([...messages]).toEqual(["Loan not found"]);
    // And E2 cannot open E1's, nor E3 (no loans at all) anything.
    await expect(e2C.payrollSelf.loanStatement({ id: ids.active! })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(e3C.payrollSelf.loanStatement({ id: ids.active! })).rejects.toMatchObject({ code: "NOT_FOUND" });
    // A malformed id is refused by the input check.
    await expect(e1C.payrollSelf.loanStatement({ id: "not-a-uuid" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("an extra employee id in the input is ignored: it is still my own loan", async () => {
    const s = await e1C.payrollSelf.loanStatement({ id: ids.active!, employeeId: ids.E2 } as never);
    expect(s.loan.id).toBe(ids.active);
    await expect(e1C.payrollSelf.loanStatement({ id: ids.l2!, employeeId: ids.E2 } as never)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("once an employee has left their login is closed, so they can no longer open any loan", async () => {
    await hrC.payrollEmployee.exit({ id: ids.E2!, lastWorkingDay: "2026-10-05", reason: "resignation" });
    const err = await e2C.payrollSelf.loans().then(() => null, (e) => e);
    expect(err).toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("who may call it, and the add-on and read-only rules", () => {
  it("owners, HR and accountants are refused: it is for employee logins only", async () => {
    for (const c of [ownerC, hrC, accountantC]) {
      await expect(c.payrollSelf.loans()).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(c.payrollSelf.loanStatement({ id: ids.active! })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("an employee of an organisation whose add-on has ended is refused with the add-on error", async () => {
    const t = await createTenant({ name: "Lapsed Loans Co" });
    await grantAddon(t.id, "payroll");
    const o = await createUser({ email: "owner@lapsedloans.in", name: "Lapsed Owner" });
    await addMember(t.id, o.id, "owner");
    const b = await createBusiness(db(), o.id, { name: "Lapsed Loans Co" });
    await db().insert(businessMembers).values({ businessId: b.id, userId: o.id, role: "admin" });
    const [emp] = await db().insert(employees).values({ businessId: b.id, employeeCode: "L1", name: "Lapsed Emp", dateOfJoining: "2026-04-01" }).returning();
    const u = await createUser({ email: "lapsed.loans@example.in", name: "Lapsed Emp" });
    await addMember(t.id, u.id, "employee");
    await db().insert(businessMembers).values({ businessId: b.id, userId: u.id, role: "member" });
    await db().insert(employeeLogins).values({ businessId: b.id, employeeId: emp!.id, userId: u.id });
    const uc = callerFor(u, t, b);
    expect(await uc.payrollSelf.loans()).toEqual([]);
    await getControlDb().execute((await import("drizzle-orm")).sql`UPDATE billing_subscriptions SET status = 'cancelled' WHERE tenant_id = ${t.id} AND kind = 'addon'`);
    invalidateEntitlements(t.id);
    for (const call of [() => uc.payrollSelf.loans(), () => uc.payrollSelf.loanStatement({ id: "00000000-0000-4000-8000-000000000000" })]) {
      const err = await call().then(() => null, (x) => x);
      expect(err).toMatchObject({ code: "FORBIDDEN" });
      expect(reasonOf(err)).toBe("addon_required");
    }
  });

  it("a read-only organisation (trial over) still lets an employee read their loans", async () => {
    const t = await createTenant({ name: "Over Loans Co", trialStartedAt: new Date(Date.now() - 20 * 86_400_000), trialEndsAt: new Date(Date.now() - 86_400_000), trialSource: "signup" });
    const o = await createUser({ email: "owner@overloans.in", name: "Over Owner" });
    await addMember(t.id, o.id, "owner");
    const b = await createBusiness(db(), o.id, { name: "Over Loans Co" });
    await db().insert(businessMembers).values({ businessId: b.id, userId: o.id, role: "admin" });
    const [emp] = await db().insert(employees).values({ businessId: b.id, employeeCode: "O1", name: "Over Emp", dateOfJoining: "2026-04-01" }).returning();
    const u = await createUser({ email: "over.loans@example.in", name: "Over Emp" });
    await addMember(t.id, u.id, "employee");
    await db().insert(businessMembers).values({ businessId: b.id, userId: u.id, role: "member" });
    await db().insert(employeeLogins).values({ businessId: b.id, employeeId: emp!.id, userId: u.id });
    // A loan that was approved before the trial ended (inserted directly: HR cannot write while the organisation is read-only).
    const [loan] = await db().insert(employeeLoans).values({ businessId: b.id, employeeId: emp!.id, number: "LN-0001", kind: "loan", status: "approved", principal: "5000.00", interestRate: "0", installmentCount: 5, emi: "1000.00", startMonth: "2026-11", issueDate: "2026-10-01" }).returning();
    const uc = callerFor(u, t, b);
    const list = await uc.payrollSelf.loans();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ number: "LN-0001", status: "approved", principal: "5000.00" });
    expect((await uc.payrollSelf.loanStatement({ id: loan!.id })).loan.number).toBe("LN-0001");
    invalidateEntitlements(t.id);
    // Writes stay refused for the HR side of that organisation (no loan can be created or approved).
    await expect(callerFor(o, t, b).payrollLoan.approve({ id: loan!.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
