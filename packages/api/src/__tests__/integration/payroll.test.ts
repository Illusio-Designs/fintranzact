/**
 * payroll.test.ts — Payroll Phase 1 against a real Postgres.
 *
 * Invariants:
 *   1. The add-on gates everything: an organisation without it is refused with
 *      the friendly add-on error; a granted add-on (a platform admin's grant) or
 *      a trial unlocks it; the trial caps employees at 10.
 *   2. Salary and identity data is visible only to the roles that may see it;
 *      identity and bank numbers are masked everywhere but the owner/admin
 *      detail view and never reach the audit trail.
 *   3. The whole flow works: employee -> salary -> attendance -> run -> approve
 *      -> post -> paid, with exact paise amounts and balanced journal entries.
 *   4. An approved run is frozen (lines, payslips, attendance); posting and
 *      paying are idempotent; locked periods are respected.
 *   5. Maker-checker: the person who calculated cannot approve (unless alone).
 *   6. One business's payroll never reaches another's.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  auditLog, bankAccounts, bankTransactions, businessMembers, chartOfAccounts, journalEntries, journalEntryLines, payrollRunLines, payrollRuns, payslips, periodLocks,
} from "@fintranzact/db";
import { createTenant, createUser, addMember, createBusiness, createBankAccount, grantAddon, type TestUser, type TestTenant, type TestBusiness } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { getTenantTestDb, getTestClient, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { runAudit, formatReport } from "../../lib/data-audit/runner.js";
import { seedChartOfAccounts } from "../../lib/coa-seed.js";
import { entitlementDataOf } from "../../lib/entitlement-error.js";
import { invalidateEntitlements } from "../../lib/entitlements.js";

const db = () => getTenantTestDb();

type Caller = ReturnType<typeof createTestCaller>;
const callerFor = (u: TestUser, t: TestTenant, b: TestBusiness): Caller =>
  createTestCaller({ userId: u.id, email: u.email, name: u.name ?? null, tenantId: t.id, businessId: b.id });

const PAN = "ABCDE1234F";
const AADHAAR = "234567890123";
const ACCOUNT = "50100123456789";

let tenant: TestTenant;
let biz: TestBusiness;
let owner: TestUser;
let admin2: TestUser;
let accountantUser: TestUser;
let seller: TestUser;
let ownerC: Caller;
let admin2C: Caller;
let accountantC: Caller;
let sellerC: Caller;

// Another organisation (no add-on until a test grants it) and a solo business.
let tenantB: TestTenant;
let bizB: TestBusiness;
let ownerB: TestUser;
let ownerBC: Caller;

let bank: { id: string };
const ids: Record<string, string> = {};

async function member(t: TestTenant, b: TestBusiness, email: string, role: "admin" | "accountant" | "seller", bizRole: "admin" | "member") {
  const u = await createUser({ email, name: email.split("@")[0] });
  await addMember(t.id, u.id, role);
  await db().insert(businessMembers).values({ businessId: b.id, userId: u.id, role: bizRole });
  return u;
}

beforeAll(async () => {
  tenant = await createTenant({ name: "Payroll Co" });
  owner = await createUser({ email: "owner@payrollco.in", name: "Ramesh Kumar" });
  await addMember(tenant.id, owner.id, "owner");
  biz = await createBusiness(db(), owner.id, { name: "Payroll Co", legalName: "Payroll Co Pvt Ltd" });
  await db().insert(businessMembers).values({ businessId: biz.id, userId: owner.id, role: "admin" });
  admin2 = await member(tenant, biz, "admin2@payrollco.in", "admin", "admin");
  accountantUser = await member(tenant, biz, "anita@payrollco.in", "accountant", "member");
  seller = await member(tenant, biz, "sunil@payrollco.in", "seller", "member");
  await seedChartOfAccounts(db(), biz.id);
  bank = await createBankAccount(db(), biz.id, { accountName: "HDFC Current", accountType: "current", currentBalance: "1000000.00", openingBalance: "1000000.00" });
  ownerC = callerFor(owner, tenant, biz);
  admin2C = callerFor(admin2, tenant, biz);
  accountantC = callerFor(accountantUser, tenant, biz);
  sellerC = callerFor(seller, tenant, biz);

  tenantB = await createTenant({ name: "Other Org" });
  ownerB = await createUser({ email: "owner@otherorg.in", name: "Kiran Mehta" });
  await addMember(tenantB.id, ownerB.id, "owner");
  bizB = await createBusiness(db(), ownerB.id, { name: "Other Org" });
  await db().insert(businessMembers).values({ businessId: bizB.id, userId: ownerB.id, role: "admin" });
  await seedChartOfAccounts(db(), bizB.id);
  ownerBC = callerFor(ownerB, tenantB, bizB);
}, 120_000);

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

const reasonOf = (e: unknown) => entitlementDataOf(e)?.reason;

describe("the Payroll add-on gate", () => {
  it("refuses every payroll call without the add-on, with the friendly add-on error", async () => {
    for (const call of [
      () => ownerBC.payrollEmployee.list({ status: "active", page: 1, limit: 10 }),
      () => ownerBC.payrollRun.list(),
      () => ownerBC.payrollEmployee.departmentCreate({ name: "Sales" }),
      () => ownerBC.payrollRun.create({ month: "2026-08" }),
    ]) {
      const err = await call().then(() => null, (e) => e);
      expect(err).toMatchObject({ code: "FORBIDDEN" });
      expect(reasonOf(err)).toBe("addon_required");
      expect(entitlementDataOf(err)).toMatchObject({ addon: "payroll", upgradePath: "/settings?tab=billing" });
    }
  });

  it("a cancelled add-on grants nothing", async () => {
    await grantAddon(tenantB.id, "payroll", "cancelled");
    const err = await ownerBC.payrollRun.list().then(() => null, (e) => e);
    expect(reasonOf(err)).toBe("addon_required");
  });

  it("an add-on granted by a platform admin (an active add-on subscription) unlocks it", async () => {
    await grantAddon(tenant.id, "payroll");
    expect(await ownerC.payrollEmployee.list({ status: "active", page: 1, limit: 10 })).toMatchObject({ total: 0 });
    await grantAddon(tenantB.id, "payroll");
    expect(await ownerBC.payrollRun.list()).toEqual([]);
  });

  it("a role without the Payroll permission is refused whatever the add-on says", async () => {
    await expect(sellerC.payrollEmployee.list({ status: "active", page: 1, limit: 10 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(sellerC.payrollRun.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(sellerC.payrollSalary.overview()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("setup: components, a template, departments", () => {
  it("seeds the standard components and leave types", async () => {
    expect((await ownerC.payrollSalary.componentSeedDefaults()).added).toBeGreaterThanOrEqual(8);
    expect((await ownerC.payrollSalary.componentSeedDefaults()).added).toBe(0); // idempotent
    expect((await ownerC.payrollLeave.typeSeedDefaults()).added).toBe(4);
    const comps = await ownerC.payrollSalary.componentList();
    for (const c of comps) ids[`c_${c.code}`] = c.id;
    expect(comps.every((c) => c.statutoryKind === null)).toBe(true);
  });

  it("refuses a statutory kind in Phase 1 and a category under the wrong type", async () => {
    await expect(
      ownerC.payrollSalary.componentCreate({ code: "PF", name: "PF", type: "deduction", category: "other_deduction", statutoryKind: "pf_employee" } as never),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(ownerC.payrollSalary.componentCreate({ code: "X", name: "X", type: "deduction", category: "bonus" } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("builds a template and shows CTC to monthly, with the 50% wage rule as a warning", async () => {
    const lines = [
      { componentId: ids.c_BASIC!, calcType: "percent_of_ctc" as const, value: 50 },
      { componentId: ids.c_HRA!, calcType: "percent_of_basic" as const, value: 40 },
      { componentId: ids.c_SPECIAL!, calcType: "balance" as const, value: 0 },
    ];
    const preview = await ownerC.payrollSalary.preview({ annualCtc: 600000, lines });
    expect(preview).toMatchObject({ monthlyCtc: "50000.00", gross: "50000.00", wages: "25000.00", wagePercent: 50, unallocated: "0.00" });
    expect(preview.warnings).toEqual([]);
    const low = await ownerC.payrollSalary.preview({ annualCtc: 600000, lines: [{ ...lines[0]!, value: 30 }, lines[1]!, lines[2]!] });
    expect(low.warnings.map((w) => w.code)).toContain("wages_below_50_percent");
    expect(low.lines.find((l) => l.code === "BASIC")?.monthly).toBe("15000.00");

    const t = await ownerC.payrollSalary.templateCreate({ name: "Staff 50k", sampleAnnualCtc: 600000, lines });
    ids.template = t.id;
    await expect(ownerC.payrollSalary.templateCreate({ name: "Staff 50k", lines })).rejects.toMatchObject({ code: "CONFLICT" });
    // A structure that cannot work is refused when saved.
    await expect(ownerC.payrollSalary.templateCreate({ name: "Broken", sampleAnnualCtc: 12000, lines: [{ componentId: ids.c_BASIC!, calcType: "fixed", value: 50000 }, { componentId: ids.c_SPECIAL!, calcType: "balance", value: 0 }] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await ownerC.payrollSalary.templateList())[0]).toMatchObject({ name: "Staff 50k", lines: expect.any(Array) });
  });

  it("departments and designations", async () => {
    const d = await ownerC.payrollEmployee.departmentCreate({ name: "Operations" });
    ids.dept = d.id;
    await expect(ownerC.payrollEmployee.departmentCreate({ name: "Operations" })).rejects.toMatchObject({ code: "CONFLICT" });
    ids.desig = (await ownerC.payrollEmployee.designationCreate({ name: "Executive" })).id;
    expect((await ownerC.payrollEmployee.departmentList())[0]).toMatchObject({ name: "Operations", employeeCount: 0 });
  });
});

describe("employees: master data, masking and the audit trail", () => {
  const base = { employeeCode: "E001", name: "Asha Verma", dateOfJoining: "2026-04-01", email: "asha@example.in", phone: "98765 43210", pan: PAN, aadhaar: AADHAAR, uan: "100200300400", esicNumber: "1234567890", bankAccountNumber: ACCOUNT, bankIfsc: "hdfc0001234", bankAccountName: "ASHA VERMA", workState: "27", branch: "Mumbai" };

  it("creates an employee with all fields and validates formats", async () => {
    const e = await ownerC.payrollEmployee.create({ ...base, departmentId: ids.dept, designationId: ids.desig });
    ids.e1 = e.id;
    expect(e).toMatchObject({ employeeCode: "E001", pan: PAN, aadhaar: AADHAAR, bankIfsc: "HDFC0001234", phone: "9876543210", sensitiveIncluded: true });
    await expect(ownerC.payrollEmployee.create({ ...base, employeeCode: "E001" })).rejects.toMatchObject({ code: "CONFLICT" });
    for (const bad of [{ pan: "ABCDE12345" }, { aadhaar: "123" }, { bankIfsc: "HDFC1001234" }, { phone: "12345" }, { uan: "12" }]) {
      await expect(ownerC.payrollEmployee.create({ ...base, employeeCode: "EX", ...bad })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
  });

  it("lists show masked numbers only", async () => {
    const list = await ownerC.payrollEmployee.list({ status: "active", page: 1, limit: 10 });
    const row = list.data[0]!;
    expect(row).toMatchObject({ employeeCode: "E001", department: "Operations", designation: "Executive", panMasked: "XXXXXX234F", bankAccountMasked: "XXXXXXXXXX6789", hasBankDetails: true });
    const text = JSON.stringify(list);
    expect(text).not.toContain(PAN);
    expect(text).not.toContain(AADHAAR);
    expect(text).not.toContain(ACCOUNT);
    expect(text).not.toContain("100200300400");
  });

  it("the detail view shows full numbers to an owner and admin, masked to an accountant", async () => {
    const full = await ownerC.payrollEmployee.get({ id: ids.e1! });
    expect(full).toMatchObject({ pan: PAN, aadhaar: AADHAAR, uan: "100200300400", bankAccountNumber: ACCOUNT, sensitiveIncluded: true });
    expect(await admin2C.payrollEmployee.get({ id: ids.e1! })).toMatchObject({ pan: PAN, sensitiveIncluded: true });
    const masked = await accountantC.payrollEmployee.get({ id: ids.e1! });
    expect(masked).toMatchObject({ pan: null, aadhaar: null, bankAccountNumber: null, panMasked: "XXXXXX234F", aadhaarMasked: "XXXXXXXX0123", bankAccountMasked: "XXXXXXXXXX6789", sensitiveIncluded: false });
    const text = JSON.stringify(masked);
    for (const secret of [PAN, AADHAAR, ACCOUNT, "100200300400", "1234567890"]) expect(text).not.toContain(secret);
  });

  it("identity and bank numbers never reach the audit trail", async () => {
    await ownerC.payrollEmployee.update({ id: ids.e1!, pan: "ZZZZZ9999Z", bankAccountNumber: "998877665544", name: "Asha Verma" });
    await ownerC.payrollEmployee.update({ id: ids.e1!, pan: PAN, bankAccountNumber: ACCOUNT });
    const rows = await db().select().from(auditLog).where(eq(auditLog.businessId, biz.id));
    const payrollRows = rows.filter((r) => r.action.startsWith("payroll."));
    expect(payrollRows.length).toBeGreaterThan(5);
    const blob = JSON.stringify(payrollRows);
    for (const secret of [PAN, "ZZZZZ9999Z", AADHAAR, ACCOUNT, "998877665544", "100200300400", "9876543210", "asha@example.in"]) expect(blob).not.toContain(secret);
    const upd = payrollRows.find((r) => r.action === "payroll.employee.update");
    expect(upd?.metadata).toContain("pan");
    expect(upd?.metadata).toContain("employeeCode");
  });

  it("an accountant can add and edit employees but a seller cannot see them", async () => {
    const e = await accountantC.payrollEmployee.create({ employeeCode: "E002", name: "Ravi Nair", dateOfJoining: "2026-08-16", email: "ravi@example.in", bankAccountNumber: "123456789012", bankIfsc: "ICIC0000123", managerId: ids.e1 });
    ids.e2 = e.id;
    expect(e).toMatchObject({ pan: null, sensitiveIncluded: false });
    await accountantC.payrollEmployee.update({ id: ids.e2!, branch: "Pune" });
    const e3 = await ownerC.payrollEmployee.create({ employeeCode: "E003", name: "Meena Shah", dateOfJoining: "2026-01-01", email: "meena@example.in" });
    ids.e3 = e3.id;
    await expect(sellerC.payrollEmployee.get({ id: ids.e1! })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(sellerC.payrollEmployee.create({ employeeCode: "E9", name: "Nope", dateOfJoining: "2026-01-01" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(ownerC.payrollEmployee.update({ id: ids.e1!, managerId: ids.e1 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("assigns salaries (effective-dated, stored as a snapshot)", async () => {
    const a1 = await ownerC.payrollSalary.assign({ employeeId: ids.e1!, templateId: ids.template!, annualCtc: 600000, effectiveFrom: "2026-04-01" });
    expect(a1.breakdown).toMatchObject({ monthlyCtc: "50000.00", gross: "50000.00" });
    await ownerC.payrollSalary.assign({ employeeId: ids.e2!, templateId: ids.template!, annualCtc: 360000, effectiveFrom: "2026-08-16" });
    await ownerC.payrollSalary.assign({ employeeId: ids.e3!, templateId: ids.template!, annualCtc: 480000, effectiveFrom: "2026-01-01" });
    // A raise from September: later effective date, the August run still uses the old one.
    await ownerC.payrollSalary.assign({ employeeId: ids.e1!, templateId: ids.template!, annualCtc: 720000, effectiveFrom: "2026-09-01" });
    const hist = await ownerC.payrollSalary.assignments({ employeeId: ids.e1! });
    expect(hist.map((h) => h.annualCtc)).toEqual(["720000.00", "600000.00"]);
    // Changing the template afterwards does not change what was assigned.
    await ownerC.payrollSalary.templateUpdate({ id: ids.template!, name: "Staff 50k", sampleAnnualCtc: 600000, lines: [{ componentId: ids.c_BASIC!, calcType: "percent_of_ctc", value: 60 }, { componentId: ids.c_SPECIAL!, calcType: "balance", value: 0 }] });
    expect((await ownerC.payrollSalary.assignments({ employeeId: ids.e1! }))[1]!.breakdown.find((l) => l.code === "BASIC")?.monthly).toBe("25000.00");
    await expect(sellerC.payrollSalary.assign({ employeeId: ids.e1!, templateId: ids.template!, annualCtc: 1, effectiveFrom: "2026-04-01" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const overview = await ownerC.payrollSalary.overview();
    expect(overview.map((o) => o.employeeCode)).toEqual(["E001", "E002", "E003"]);
  });

  it("exit sets the last working day and keeps the employee on file", async () => {
    await expect(ownerC.payrollEmployee.exit({ id: ids.e3!, lastWorkingDay: "2025-12-31", reason: "resignation" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const gone = await ownerC.payrollEmployee.exit({ id: ids.e3!, lastWorkingDay: "2026-08-20", reason: "resignation", fnfNote: "Notice period recovery waived." });
    expect(gone).toMatchObject({ status: "exited", lastWorkingDay: "2026-08-20", exitReason: "resignation" });
    expect((await ownerC.payrollEmployee.list({ status: "exited", page: 1, limit: 10 })).total).toBe(1);
  });
});

describe("attendance, holidays and leave", () => {
  it("marks and bulk marks days, with half days and overtime", async () => {
    // All of August present for the three (Ravi from his joining date; Meena up to her last day).
    const dates = Array.from({ length: 31 }, (_, i) => `2026-08-${String(i + 1).padStart(2, "0")}`);
    const res = await ownerC.payrollAttendance.bulkMark({ employeeIds: [ids.e1!, ids.e2!, ids.e3!], dates, status: "present" });
    expect(res.marked).toBe(31 + 16 + 20);
    // Asha: two absences and a half day.
    await ownerC.payrollAttendance.mark({ employeeId: ids.e1!, date: "2026-08-10", status: "absent" });
    await ownerC.payrollAttendance.mark({ employeeId: ids.e1!, date: "2026-08-11", status: "absent" });
    await ownerC.payrollAttendance.mark({ employeeId: ids.e1!, date: "2026-08-12", status: "half_day", checkIn: "09:30", checkOut: "13:30" });
    // Overtime on a worked day; refused on an absence.
    await ownerC.payrollAttendance.mark({ employeeId: ids.e1!, date: "2026-08-13", status: "present", overtimeHours: 4 });
    await expect(ownerC.payrollAttendance.mark({ employeeId: ids.e1!, date: "2026-08-14", status: "absent", overtimeHours: 2 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Before joining / after the last working day / a leave with no type.
    await expect(ownerC.payrollAttendance.mark({ employeeId: ids.e2!, date: "2026-08-10", status: "present" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(ownerC.payrollAttendance.mark({ employeeId: ids.e3!, date: "2026-08-25", status: "present" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(ownerC.payrollAttendance.mark({ employeeId: ids.e1!, date: "2026-08-15", status: "leave" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Bulk mark keeps what is marked unless asked.
    const again = await ownerC.payrollAttendance.bulkMark({ employeeIds: [ids.e1!], dates: ["2026-08-10"], status: "present" });
    expect(again).toMatchObject({ marked: 0, skipped: 1 });
  });

  it("the month view gives paid days and loss-of-pay days with holidays and weekly offs", async () => {
    await ownerC.payrollAttendance.holidayCreate({ date: "2026-08-15", name: "Independence Day", scope: "national" });
    await ownerC.payrollAttendance.holidayCreate({ date: "2026-08-27", name: "Ganesh Chaturthi", scope: "state", stateCode: "27" });
    await ownerC.payrollAttendance.holidayCreate({ date: "2026-08-28", name: "Karnataka only", scope: "state", stateCode: "29" });
    const view = await ownerC.payrollAttendance.month({ month: "2026-08" });
    const asha = view.employees.find((e) => e.employeeCode === "E001")!;
    expect(asha.summary).toMatchObject({ daysInMonth: 31, employedDays: 31, lopDays: 2.5, paidDays: 28.5, overtimeHours: 4, unmarkedDates: [] });
    expect(asha.holidayDates).toEqual(["2026-08-15", "2026-08-27"]); // her state's holiday, not Karnataka's
    expect(view.employees.find((e) => e.employeeCode === "E002")!.summary).toMatchObject({ employedDays: 16, paidDays: 16, lopDays: 0 });
    expect(view.employees.find((e) => e.employeeCode === "E003")!.summary).toMatchObject({ employedDays: 20, paidDays: 20 });
    expect(view.locked).toBe(false);
  });

  it("leave: accrual, application, balance first then loss of pay, cancel", async () => {
    await ownerC.payrollLeave.accrue({ month: "2026-07" });
    const again = await ownerC.payrollLeave.accrue({ month: "2026-07" });
    expect(again.created).toBe(0); // idempotent
    const bal = await ownerC.payrollLeave.balances({ leaveYear: 2026 });
    const types = Object.fromEntries(bal.types.map((t) => [t.code, t.id]));
    ids.CL = types.CL!;
    const asha = bal.employees.find((e) => e.employeeCode === "E001")!;
    expect(asha.balances[types.CL!]).toBe(12);
    expect(asha.balances[types.EL!]).toBe(1.5);
    expect(asha.balances[types.LOP!]).toBe(0);

    // 3 working days of EL with 1.5 in balance: 1.5 paid, 1.5 loss of pay.
    const app = await ownerC.payrollLeave.request({ employeeId: ids.e1!, leaveTypeId: types.EL!, fromDate: "2026-07-06", toDate: "2026-07-08", reason: "Family function" });
    expect(app).toMatchObject({ status: "pending", days: "3.00" });
    await expect(ownerC.payrollLeave.request({ employeeId: ids.e1!, leaveTypeId: types.CL!, fromDate: "2026-07-08", toDate: "2026-07-09" })).rejects.toMatchObject({ code: "CONFLICT" });
    const done = await ownerC.payrollLeave.decide({ id: app.id, decision: "approve" });
    expect(done).toMatchObject({ status: "approved", paidDays: "1.50", lopDays: "1.50" });
    const after = await ownerC.payrollLeave.balances({ leaveYear: 2026 });
    expect(after.employees.find((e) => e.employeeCode === "E001")!.balances[types.EL!]).toBe(0);
    const julyView = await ownerC.payrollAttendance.month({ month: "2026-07" });
    const julyAsha = julyView.employees.find((e) => e.employeeCode === "E001")!;
    expect(julyAsha.days["2026-07-06"]).toMatchObject({ status: "leave", source: "leave" });
    // Day by day: the balance pays for the first day and a half; the half-day left is LOP.
    expect(julyAsha.summary.lopDays).toBeGreaterThan(0);

    // A casual-leave day within balance is fully paid; cancelling it gives the balance back and clears the day.
    const cl = await ownerC.payrollLeave.request({ employeeId: ids.e1!, leaveTypeId: types.CL!, fromDate: "2026-07-14", toDate: "2026-07-14" });
    await ownerC.payrollLeave.decide({ id: cl.id, decision: "approve" });
    expect((await ownerC.payrollLeave.balances({ leaveYear: 2026 })).employees.find((e) => e.employeeCode === "E001")!.balances[types.CL!]).toBe(11);
    await ownerC.payrollLeave.cancel({ id: cl.id });
    expect((await ownerC.payrollLeave.balances({ leaveYear: 2026 })).employees.find((e) => e.employeeCode === "E001")!.balances[types.CL!]).toBe(12);
    expect((await ownerC.payrollAttendance.month({ month: "2026-07" })).employees.find((e) => e.employeeCode === "E001")!.days["2026-07-14"]).toBeUndefined();
    // Dates that are all weekly offs need no leave.
    await expect(ownerC.payrollLeave.request({ employeeId: ids.e1!, leaveTypeId: types.CL!, fromDate: "2026-07-05", toDate: "2026-07-05" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("carry-forward keeps up to the maximum and lapses the rest, once", async () => {
    await ownerC.payrollLeave.typeUpdate({ id: ids.CL!, carryForward: true, carryForwardMax: 5 });
    const closed = await ownerC.payrollLeave.closeYear({ leaveYear: 2026 });
    expect(closed.carried).toBeGreaterThan(0);
    expect(closed.lapsed).toBeGreaterThan(0);
    expect(await ownerC.payrollLeave.closeYear({ leaveYear: 2026 })).toEqual({ carried: 0, lapsed: 0 });
    const next = await ownerC.payrollLeave.balances({ leaveYear: 2027 });
    expect(next.employees.find((e) => e.employeeCode === "E001")!.balances[ids.CL!]).toBe(5);
  });

  it("encashment needs an encashable type and enough balance, and waits for the next run", async () => {
    const bal = await ownerC.payrollLeave.balances({ leaveYear: 2026 });
    expect(bal.leaveYear).toBe(2026);
    await expect(ownerC.payrollLeave.encash({ employeeId: ids.e1!, leaveTypeId: ids.CL!, days: 1, amount: 500 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("the payroll run, August 2026", () => {
  it("creates a run, refuses a duplicate and a future month", async () => {
    const run = await accountantC.payrollRun.create({ month: "2026-08" });
    ids.run = run.id;
    expect(run).toMatchObject({ status: "draft", month: "2026-08", daysInMonth: 31 });
    await expect(accountantC.payrollRun.create({ month: "2026-08" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(accountantC.payrollRun.create({ month: "2099-01" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("calculating before the attendance is locked is refused", async () => {
    await expect(accountantC.payrollRun.calculate({ id: ids.run! })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("locks attendance; missing working days need a decision", async () => {
    // Meena's August is marked up to 20 Aug; Ravi from the 16th; Asha all month: nothing is missing.
    const res = await accountantC.payrollRun.lockAttendance({ id: ids.run! });
    expect(res.run.status).toBe("attendance_locked");
    expect(res.filled).toBe(0);
    // Attendance of a locked month cannot change.
    await expect(ownerC.payrollAttendance.mark({ employeeId: ids.e1!, date: "2026-08-20", status: "absent" })).rejects.toThrow(/locked/);
    await expect(ownerC.payrollAttendance.holidayCreate({ date: "2026-08-05", name: "Late holiday", scope: "national" })).rejects.toThrow(/locked/);
  });

  it("calculates exact amounts: proration by paid days, half-days, mid-month joining and exit, overtime", async () => {
    const calc = await accountantC.payrollRun.calculate({ id: ids.run! });
    expect(calc.run.status).toBe("calculated");
    const detail = await accountantC.payrollRun.get({ id: ids.run! });
    const by = Object.fromEntries(detail.lines.map((l) => [l.employeeCode, l]));
    const amount = (code: string, comp: string) => by[code]!.components.find((c) => c.code === comp)!.amount;

    // Asha: 28.5 paid of 31. 25000 x 57/62, 10000 x 57/62, 15000 x 57/62 each rounded to the paisa.
    expect(by.E001).toMatchObject({ paidDays: "28.5", lopDays: "2.5", employedDays: 31, daysInMonth: 31, overtimeHours: "4.00" });
    expect(amount("E001", "BASIC")).toBe("22983.87");
    expect(amount("E001", "HRA")).toBe("9193.55");
    expect(amount("E001", "SPECIAL")).toBe("13790.32");
    // Overtime: wages 25000 / 31 days / 8 hours = 100.80645.. an hour, x 2, x 4 hours = 806.45
    expect(amount("E001", "OT")).toBe("806.45");
    expect(by.E001!.grossEarnings).toBe("46774.19");
    expect(by.E001!.netPay).toBe("46774.19");

    // Ravi joined on the 16th: 16 employed days, all paid.
    expect(by.E002).toMatchObject({ employedDays: 16, paidDays: "16.0", lopDays: "0.0" });
    expect(amount("E002", "BASIC")).toBe("7741.94");
    expect(by.E002!.grossEarnings).toBe("15483.87");

    // Meena left on the 20th: 20 of 31 days, flagged as the final settlement. Her structure was 60/40 basic: 20000 x 20/31.
    expect(by.E003).toMatchObject({ employedDays: 20, paidDays: "20.0", isFinalSettlement: true });
    expect(by.E003!.grossEarnings).toBe("25806.46"); // 12903.23 + 5161.29 + 7741.94: the sum of the rounded parts

    // Totals are the plain sums of the lines.
    const sum = (k: "grossEarnings" | "netPay") => detail.lines.reduce((s, l) => s + Math.round(Number(l[k]) * 100), 0);
    expect(Math.round(Number(detail.run.grossTotal) * 100)).toBe(sum("grossEarnings"));
    expect(Math.round(Number(detail.run.netTotal) * 100)).toBe(sum("netPay"));
    expect(detail.run.employeeCount).toBe(3);
    // The 50% wage rule is a warning, never a block.
    expect(Array.isArray(detail.run.warnings)).toBe(true);
  });

  it("adjustments (a manual deduction) change net pay after recalculation and survive it", async () => {
    await accountantC.payrollRun.addAdjustment({ runId: ids.run!, employeeId: ids.e1!, name: "Advance recovery", type: "deduction", amount: 1000 });
    await accountantC.payrollRun.addAdjustment({ runId: ids.run!, employeeId: ids.e2!, name: "Joining incentive", type: "earning", amount: 500.5 });
    await accountantC.payrollRun.calculate({ id: ids.run! });
    await accountantC.payrollRun.calculate({ id: ids.run! });
    const d = await accountantC.payrollRun.get({ id: ids.run! });
    const asha = d.lines.find((l) => l.employeeCode === "E001")!;
    expect(asha).toMatchObject({ totalDeductions: "1000.00", grossEarnings: "46774.19", netPay: "45774.19" });
    expect(d.lines.find((l) => l.employeeCode === "E002")).toMatchObject({ grossEarnings: "15984.37", netPay: "15984.37" });
    expect(d.adjustments).toHaveLength(2);
    // An adjustment that makes net pay negative blocks submission, with the employee named.
    const big = await accountantC.payrollRun.addAdjustment({ runId: ids.run!, employeeId: ids.e1!, name: "Recovery", type: "deduction", amount: 90000 });
    await accountantC.payrollRun.calculate({ id: ids.run! });
    await expect(accountantC.payrollRun.submit({ id: ids.run! })).rejects.toThrow(/Asha Verma/);
    await accountantC.payrollRun.removeAdjustment({ runId: ids.run!, adjustmentId: big.id });
    await accountantC.payrollRun.calculate({ id: ids.run! });
  });

  it("maker-checker: the accountant who calculated cannot approve; owners approve; one calculating cannot approve their own", async () => {
    await accountantC.payrollRun.submit({ id: ids.run! });
    const view = await accountantC.payrollRun.get({ id: ids.run! });
    expect(view.run.status).toBe("pending_approval");
    expect(view.approval.canApprove).toBe(false);
    await expect(accountantC.payrollRun.approve({ id: ids.run! })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(sellerC.payrollRun.approve({ id: ids.run! })).rejects.toMatchObject({ code: "FORBIDDEN" });

    // The owner recalculates (becoming the maker): now the owner may not approve, another admin may.
    await ownerC.payrollRun.calculate({ id: ids.run! });
    await ownerC.payrollRun.submit({ id: ids.run! });
    const own = await ownerC.payrollRun.approve({ id: ids.run! }).then(() => null, (e) => e);
    expect(own).toMatchObject({ code: "FORBIDDEN" });
    expect(String(own.message)).toMatch(/cannot approve/);
    expect((await ownerC.payrollRun.get({ id: ids.run! })).approval.canApprove).toBe(false);
    expect((await admin2C.payrollRun.get({ id: ids.run! })).approval.canApprove).toBe(true);
  });

  it("can be reopened before approval and run again", async () => {
    const reopened = await ownerC.payrollRun.reopen({ id: ids.run! });
    expect(reopened).toMatchObject({ status: "draft", employeeCount: 0, netTotal: "0.00" });
    expect((await ownerC.payrollRun.get({ id: ids.run! })).lines).toHaveLength(0);
    await ownerC.payrollAttendance.mark({ employeeId: ids.e1!, date: "2026-08-20", status: "present" }); // editable again
    await accountantC.payrollRun.lockAttendance({ id: ids.run! });
    await accountantC.payrollRun.calculate({ id: ids.run! });
    const lines = await db().select().from(payrollRunLines).where(eq(payrollRunLines.runId, ids.run!));
    expect(lines).toHaveLength(3);
    await accountantC.payrollRun.submit({ id: ids.run! });
  });

  it("shows a draft payslip before approval", async () => {
    const p = await accountantC.payrollRun.payslipPdf({ runId: ids.run!, employeeId: ids.e1! });
    expect(p.draft).toBe(true);
    expect(Buffer.from(p.base64, "base64").subarray(0, 5).toString()).toBe("%PDF-");
    await expect(accountantC.payrollRun.payslipEmail({ runId: ids.run!, employeeId: ids.e1! })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(accountantC.payrollRun.bankFile({ id: ids.run! })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("an owner approves: payslips are created and everything is frozen", async () => {
    const approved = await admin2C.payrollRun.approve({ id: ids.run! });
    expect(approved).toMatchObject({ status: "approved", approvedByUserId: admin2.id });
    const slips = await db().select().from(payslips).where(eq(payslips.runId, ids.run!));
    expect(slips).toHaveLength(3);
    const snap = slips.find((s) => s.number === "PS-2026-08-E001")!.snapshot as Record<string, unknown>;
    const text = JSON.stringify(snap);
    expect(text).toContain("XXXXXX234F"); // masked PAN on the payslip
    for (const secret of [PAN, AADHAAR, ACCOUNT, "100200300400"]) expect(text).not.toContain(secret);
    expect(snap).toMatchObject({ monthLabel: "August 2026", netPay: expect.any(String), netPayWords: expect.stringContaining("Only") });
    // Meena's final month is linked to her record.
    expect((await ownerC.payrollEmployee.get({ id: ids.e3! })).fnfPayrollRunId).toBe(ids.run);

    // Frozen: no recalculating, reopening, adjusting, re-approving, attendance changes or deleting.
    await expect(ownerC.payrollRun.calculate({ id: ids.run! })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(ownerC.payrollRun.reopen({ id: ids.run! })).rejects.toThrow(/approved/);
    await expect(ownerC.payrollRun.addAdjustment({ runId: ids.run!, employeeId: ids.e1!, name: "x", type: "deduction", amount: 1 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(ownerC.payrollRun.approve({ id: ids.run! })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(ownerC.payrollRun.delete({ id: ids.run! })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(ownerC.payrollAttendance.mark({ employeeId: ids.e1!, date: "2026-08-21", status: "absent" })).rejects.toThrow(/locked/);
    await expect(ownerC.payrollRun.lockAttendance({ id: ids.run! })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Editing the employee afterwards never changes the payslip.
    await ownerC.payrollEmployee.update({ id: ids.e1!, name: "Asha V. Changed", designationId: null });
    const slipAfter = await db().select().from(payslips).where(and(eq(payslips.runId, ids.run!), eq(payslips.employeeId, ids.e1!)));
    expect((slipAfter[0]!.snapshot as { employee: { name: string } }).employee.name).toBe("Asha Verma");
    await ownerC.payrollEmployee.update({ id: ids.e1!, name: "Asha Verma" });
  });

  it("payslip PDF, the email and the bank file", async () => {
    const p = await ownerC.payrollRun.payslipPdf({ runId: ids.run!, employeeId: ids.e1! });
    expect(p).toMatchObject({ draft: false, filename: "PS-2026-08-E001.pdf", contentType: "application/pdf" });
    expect(Buffer.from(p.base64, "base64").subarray(0, 5).toString()).toBe("%PDF-");

    const mail = await accountantC.payrollRun.payslipEmail({ runId: ids.run!, employeeId: ids.e1! });
    expect(mail.sentTo).toMatch(/\*/); // masked address
    expect((await accountantC.payrollRun.get({ id: ids.run! })).lines.find((l) => l.employeeCode === "E001")!.payslipEmailedAt).not.toBeNull();

    const file = await accountantC.payrollRun.bankFile({ id: ids.run! });
    const rows = file.csv.trim().split("\r\n");
    expect(rows[0]).toBe("Sr No,Employee Code,Beneficiary Name,Account Number,IFSC,Amount (INR),Payment Mode,Narration");
    expect(rows[1]).toBe(`1,E001,ASHA VERMA,${ACCOUNT},HDFC0001234,45774.19,NEFT,Salary August 2026`);
    expect(rows[2]).toContain("E002,Ravi Nair,123456789012,ICIC0000123,15984.37,NEFT");
    expect(file.count).toBe(2);
    expect(file.skipped).toEqual(["E003"]); // no bank details on file
    await expect(sellerC.payrollRun.bankFile({ id: ids.run! })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("posts to the books: one balanced journal entry; posting twice changes nothing", async () => {
    const before = await db().select().from(journalEntries).where(eq(journalEntries.businessId, biz.id));
    const first = await accountantC.payrollRun.post({ id: ids.run! });
    expect(first.created).toBe(true);
    const second = await accountantC.payrollRun.post({ id: ids.run! });
    expect(second).toMatchObject({ created: false, journalEntryId: first.journalEntryId });
    const after = await db().select().from(journalEntries).where(eq(journalEntries.businessId, biz.id));
    expect(after.length).toBe(before.length + 1);

    const lines = await db()
      .select({ code: chartOfAccounts.code, name: chartOfAccounts.name, type: chartOfAccounts.accountType, debit: journalEntryLines.debit, credit: journalEntryLines.credit })
      .from(journalEntryLines)
      .innerJoin(chartOfAccounts, eq(chartOfAccounts.id, journalEntryLines.accountId))
      .where(eq(journalEntryLines.journalEntryId, first.journalEntryId));
    const paise = (s: string) => Math.round(Number(s) * 100);
    const debit = lines.reduce((s, l) => s + paise(l.debit), 0);
    const credit = lines.reduce((s, l) => s + paise(l.credit), 0);
    expect(debit).toBe(credit);
    const run = (await ownerC.payrollRun.get({ id: ids.run! })).run;
    expect(debit).toBe(paise(run.grossTotal) + paise(run.employerTotal));
    const byCode = Object.fromEntries(lines.map((l) => [l.code, l]));
    expect(paise(byCode["2400"]!.credit)).toBe(paise(run.netTotal)); // salaries payable = net pay
    expect(paise(byCode["2410"]!.credit)).toBe(paise(run.deductionsTotal)); // deductions held
    expect(byCode["2400"]).toMatchObject({ name: "Salaries Payable", type: "liability" });
    expect(byCode["5200"]!.type).toBe("expense"); // wages
    expect(byCode["5201"]!.type).toBe("expense"); // allowances
    expect(byCode["5203"]!.type).toBe("expense"); // overtime
    expect(run).toMatchObject({ status: "posted", accrualJournalEntryId: first.journalEntryId });
    const [entry] = await db().select().from(journalEntries).where(eq(journalEntries.id, first.journalEntryId));
    expect(entry).toMatchObject({ source: "system", narration: "Payroll for August 2026" });
    // The posted entry cannot be voided by hand (the run owns it).
    await expect(ownerC.journal.void({ id: first.journalEntryId })).rejects.toThrow(/payroll/i);
  });

  it("marks paid: salaries payable against the chosen bank account, once", async () => {
    await expect(sellerC.payrollRun.markPaid({ runId: ids.run!, bankAccountId: bank.id, paidOn: "2026-09-01" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const before = (await db().select().from(bankAccounts).where(eq(bankAccounts.id, bank.id)))[0]!;
    const paid = await accountantC.payrollRun.markPaid({ runId: ids.run!, bankAccountId: bank.id, paidOn: "2026-09-01", reference: "BATCH-1" });
    expect(paid.created).toBe(true);
    const again = await accountantC.payrollRun.markPaid({ runId: ids.run!, bankAccountId: bank.id, paidOn: "2026-09-01" });
    expect(again).toMatchObject({ created: false, journalEntryId: paid.journalEntryId });

    const net = Math.round(Number((await ownerC.payrollRun.get({ id: ids.run! })).run.netTotal) * 100);
    const lines = await db()
      .select({ code: chartOfAccounts.code, debit: journalEntryLines.debit, credit: journalEntryLines.credit })
      .from(journalEntryLines)
      .innerJoin(chartOfAccounts, eq(chartOfAccounts.id, journalEntryLines.accountId))
      .where(eq(journalEntryLines.journalEntryId, paid.journalEntryId!));
    expect(lines).toHaveLength(2);
    expect(lines.find((l) => l.code === "2400")).toMatchObject({ debit: (net / 100).toFixed(2), credit: "0.00" });
    expect(lines.find((l) => l.code === "1010")).toMatchObject({ credit: (net / 100).toFixed(2), debit: "0.00" });

    const after = (await db().select().from(bankAccounts).where(eq(bankAccounts.id, bank.id)))[0]!;
    expect(Math.round((Number(before.currentBalance) - Number(after.currentBalance)) * 100)).toBe(net);
    const txns = await db().select().from(bankTransactions).where(and(eq(bankTransactions.referenceType, "payroll_run"), eq(bankTransactions.referenceId, ids.run!)));
    expect(txns).toHaveLength(1);
    expect(txns[0]).toMatchObject({ type: "withdrawal" });
    expect((await ownerC.payrollRun.get({ id: ids.run! })).run).toMatchObject({ status: "paid", paidFromBankAccountId: bank.id, paidReference: "BATCH-1" });
    // The salaries-payable account nets to zero for the run (accrual and payment).
    const all = await db()
      .select({ debit: journalEntryLines.debit, credit: journalEntryLines.credit })
      .from(journalEntryLines)
      .innerJoin(chartOfAccounts, eq(chartOfAccounts.id, journalEntryLines.accountId))
      .where(and(eq(chartOfAccounts.businessId, biz.id), eq(chartOfAccounts.code, "2400")));
    expect(all.reduce((s, l) => s + Math.round(Number(l.credit) * 100) - Math.round(Number(l.debit) * 100), 0)).toBe(0);
  });
});

describe("period locks and posting", () => {
  it("a locked period refuses posting and paying; unlocking lets it through; reposting is idempotent", async () => {
    await accountantC.payrollRun.create({ month: "2026-07" });
    const july = (await ownerC.payrollRun.list()).find((r) => r.month === "2026-07")!;
    // Asha's July includes the leave from the leave tests, so fill the rest as present.
    await accountantC.payrollRun.lockAttendance({ id: july.id, fillUnmarked: "present" });
    await accountantC.payrollRun.calculate({ id: july.id });
    await accountantC.payrollRun.submit({ id: july.id });
    await admin2C.payrollRun.approve({ id: july.id });

    await db().insert(periodLocks).values({ businessId: biz.id, kind: "books", lockedThrough: "2026-07-31", lockedByName: "Test" });
    await expect(accountantC.payrollRun.post({ id: july.id })).rejects.toThrow(/period is locked/i);
    expect((await ownerC.payrollRun.get({ id: july.id })).run).toMatchObject({ status: "approved", accrualJournalEntryId: null });
    await db().delete(periodLocks).where(eq(periodLocks.businessId, biz.id));
    const posted = await accountantC.payrollRun.post({ id: july.id });
    expect(posted.created).toBe(true);

    // Paying on a locked date is refused too.
    await db().insert(periodLocks).values({ businessId: biz.id, kind: "books", lockedThrough: "2026-09-10", lockedByName: "Test" });
    await expect(accountantC.payrollRun.markPaid({ runId: july.id, bankAccountId: bank.id, paidOn: "2026-09-05" })).rejects.toThrow(/period is locked/i);
    await db().delete(periodLocks).where(eq(periodLocks.businessId, biz.id));
    await accountantC.payrollRun.markPaid({ runId: july.id, bankAccountId: bank.id, paidOn: "2026-09-05" });
  });

  it("a run cannot be posted before it is approved, or paid before it is posted", async () => {
    await accountantC.payrollRun.create({ month: "2026-06" });
    const june = (await ownerC.payrollRun.list()).find((r) => r.month === "2026-06")!;
    await expect(accountantC.payrollRun.post({ id: june.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(accountantC.payrollRun.markPaid({ runId: june.id, bankAccountId: bank.id, paidOn: "2026-09-05" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // A draft run can be deleted.
    expect(await accountantC.payrollRun.delete({ id: june.id })).toEqual({ id: june.id });
  });

  it("every journal entry payroll wrote balances", async () => {
    const rows = await db()
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(and(eq(journalEntries.businessId, biz.id), eq(journalEntries.source, "system")));
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const r of rows) {
      const lines = await db().select().from(journalEntryLines).where(eq(journalEntryLines.journalEntryId, r.id));
      const d = lines.reduce((s, l) => s + Math.round(Number(l.debit) * 100), 0);
      const c = lines.reduce((s, l) => s + Math.round(Number(l.credit) * 100), 0);
      expect(d).toBe(c);
    }
    const runs = await db().select().from(payrollRuns).where(eq(payrollRuns.businessId, biz.id));
    expect(runs.filter((r) => r.status === "paid")).toHaveLength(2);
  });
});

describe("the data audit", () => {
  it("finds nothing wrong in the payroll this suite built", async () => {
    const report = await runAudit(getTestClient(), { businessIds: [biz.id] });
    const payrollTables = new Set(["employees", "salary_components", "employee_salary_assignments", "attendance_records", "leave_ledger", "leave_applications", "payroll_runs", "payroll_run_lines", "payslips"]);
    const mine = report.results.filter((r) => payrollTables.has(r.rule.table));
    expect(mine.map((r) => `${r.rule.id}: ${r.samples.map((x) => x.detail).join("; ")}`)).toEqual([]);
    expect(report.failures.filter((f) => payrollTables.has(f.rule.table)).map((f) => `${f.rule.id}: ${f.error}`)).toEqual([]);
    void formatReport;
  });

  it("catches a run whose totals no longer match its lines", async () => {
    const run = (await db().select().from(payrollRuns).where(and(eq(payrollRuns.businessId, biz.id), eq(payrollRuns.month, "2026-08"))))[0]!;
    await db().update(payrollRuns).set({ netTotal: "1.00" }).where(eq(payrollRuns.id, run.id));
    const report = await runAudit(getTestClient(), { businessIds: [biz.id] });
    expect(report.results.map((r) => r.rule.id)).toContain("payroll_runs.totals-match-lines");
    await db().update(payrollRuns).set({ netTotal: run.netTotal }).where(eq(payrollRuns.id, run.id));
  });
});

describe("a single-user business may approve its own payroll", () => {
  it("the owner is the maker and the checker when there is nobody else", async () => {
    const c = ownerBC;
    await c.payrollSalary.componentSeedDefaults();
    const comps = await c.payrollSalary.componentList();
    const basic = comps.find((x) => x.code === "BASIC")!;
    const t = await c.payrollSalary.templateCreate({ name: "Solo", sampleAnnualCtc: 240000, lines: [{ componentId: basic.id, calcType: "balance", value: 0 }] });
    const e = await c.payrollEmployee.create({ employeeCode: "S1", name: "Solo Worker", dateOfJoining: "2026-07-01" });
    await c.payrollSalary.assign({ employeeId: e.id, templateId: t.id, annualCtc: 240000, effectiveFrom: "2026-07-01" });
    const run = await c.payrollRun.create({ month: "2026-07" });
    await c.payrollRun.lockAttendance({ id: run.id, fillUnmarked: "present" });
    await c.payrollRun.calculate({ id: run.id });
    await c.payrollRun.submit({ id: run.id });
    const approved = await c.payrollRun.approve({ id: run.id });
    expect(approved.status).toBe("approved");
    expect(approved.netTotal).toBe("20000.00");
  });
});

describe("isolation between businesses", () => {
  it("another organisation cannot read or change this business's payroll", async () => {
    await expect(ownerBC.payrollEmployee.get({ id: ids.e1! })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(ownerBC.payrollEmployee.update({ id: ids.e1!, name: "Hacked" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(ownerBC.payrollRun.get({ id: ids.run! })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(ownerBC.payrollRun.approve({ id: ids.run! })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(ownerBC.payrollRun.payslipPdf({ runId: ids.run!, employeeId: ids.e1! })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(ownerBC.payrollRun.bankFile({ id: ids.run! })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(ownerBC.payrollAttendance.mark({ employeeId: ids.e1!, date: "2026-08-02", status: "absent" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(ownerBC.payrollSalary.assign({ employeeId: ids.e1!, templateId: ids.template!, annualCtc: 1, effectiveFrom: "2026-01-01" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    // References to another business's records are refused as well.
    await expect(ownerBC.payrollEmployee.create({ employeeCode: "X1", name: "Cross Ref", dateOfJoining: "2026-01-01", departmentId: ids.dept })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(ownerBC.payrollSalary.preview({ annualCtc: 1000, lines: [{ componentId: ids.c_BASIC!, calcType: "balance", value: 0 }] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await ownerBC.payrollEmployee.list({ status: "all", page: 1, limit: 50 })).data.map((e) => e.employeeCode)).toEqual(["S1"]);
    expect((await ownerBC.payrollRun.list()).map((r) => r.id)).not.toContain(ids.run);
  });

  it("another business's bank account cannot be used to pay salaries", async () => {
    const other = await createBankAccount(db(), bizB.id, { accountName: "Other bank", accountType: "current" });
    const run = await accountantC.payrollRun.create({ month: "2026-05" });
    await accountantC.payrollRun.lockAttendance({ id: run.id, fillUnmarked: "present" });
    await accountantC.payrollRun.calculate({ id: run.id });
    await accountantC.payrollRun.submit({ id: run.id });
    await admin2C.payrollRun.approve({ id: run.id });
    await accountantC.payrollRun.post({ id: run.id });
    await expect(accountantC.payrollRun.markPaid({ runId: run.id, bankAccountId: other.id, paidOn: "2026-09-05" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await ownerC.payrollRun.get({ id: run.id })).run.status).toBe("posted");
  });
});

describe("the Full Access Trial", () => {
  it("includes payroll with a cap of 10 active employees; leaving frees a place", async () => {
    const t = await createTenant({ name: "Trial Co", trialStartedAt: new Date(), trialEndsAt: new Date(Date.now() + 10 * 86_400_000), trialSource: "signup" });
    const o = await createUser({ email: "owner@trialco.in", name: "Trial Owner" });
    await addMember(t.id, o.id, "owner");
    const b = await createBusiness(db(), o.id, { name: "Trial Co" });
    await db().insert(businessMembers).values({ businessId: b.id, userId: o.id, role: "admin" });
    const c = callerFor(o, t, b);
    expect(await c.payrollEmployee.capacity()).toEqual({ active: 0, cap: 10 });
    const made: string[] = [];
    for (let i = 1; i <= 10; i++) {
      made.push((await c.payrollEmployee.create({ employeeCode: `T${i}`, name: `Trial Person ${i}`, dateOfJoining: "2026-01-01" })).id);
    }
    const err = await c.payrollEmployee.create({ employeeCode: "T11", name: "Eleventh", dateOfJoining: "2026-01-01" }).then(() => null, (e) => e);
    expect(err).toMatchObject({ code: "FORBIDDEN" });
    expect(String(err.message)).toMatch(/up to 10 payroll employees/);
    expect(reasonOf(err)).toBe("plan_limit");
    expect(await c.payrollEmployee.capacity()).toEqual({ active: 10, cap: 10 });

    await c.payrollEmployee.exit({ id: made[0]!, lastWorkingDay: "2026-03-31", reason: "resignation" });
    expect((await c.payrollEmployee.create({ employeeCode: "T11", name: "Eleventh", dateOfJoining: "2026-01-01" })).employeeCode).toBe("T11");
    // Bringing the one who left back would exceed the cap again.
    await expect(c.payrollEmployee.reactivate({ id: made[0]! })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("the cap is the one set in the trial settings, counted across the organisation's businesses", async () => {
    const t = await createTenant({ name: "Two Biz Trial", trialStartedAt: new Date(), trialEndsAt: new Date(Date.now() + 10 * 86_400_000), trialSource: "signup" });
    const o = await createUser({ email: "owner@twobiz.in", name: "Two Biz Owner" });
    await addMember(t.id, o.id, "owner");
    const b1 = await createBusiness(db(), o.id, { name: "Biz One" });
    const b2 = await createBusiness(db(), o.id, { name: "Biz Two" });
    for (const b of [b1, b2]) await db().insert(businessMembers).values({ businessId: b.id, userId: o.id, role: "admin" });
    for (let i = 1; i <= 6; i++) await callerFor(o, t, b1).payrollEmployee.create({ employeeCode: `A${i}`, name: `Person A${i}`, dateOfJoining: "2026-01-01" });
    for (let i = 1; i <= 4; i++) await callerFor(o, t, b2).payrollEmployee.create({ employeeCode: `B${i}`, name: `Person B${i}`, dateOfJoining: "2026-01-01" });
    await expect(callerFor(o, t, b2).payrollEmployee.create({ employeeCode: "B5", name: "Person B5", dateOfJoining: "2026-01-01" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("read-only organisations", () => {
  it("keep reading payroll data but cannot write (the existing read-only gate)", async () => {
    // A trial that ended and no plan: read-only, add-ons off.
    const t = await createTenant({ name: "Ended Trial Co", trialStartedAt: new Date(Date.now() - 20 * 86_400_000), trialEndsAt: new Date(Date.now() - 86_400_000), trialSource: "signup" });
    const o = await createUser({ email: "owner@endedtrial.in", name: "Old Owner" });
    await addMember(t.id, o.id, "owner");
    const b = await createBusiness(db(), o.id, { name: "Ended Trial Co" });
    await db().insert(businessMembers).values({ businessId: b.id, userId: o.id, role: "admin" });
    const c = callerFor(o, t, b);
    expect(await c.payrollEmployee.list({ status: "active", page: 1, limit: 10 })).toMatchObject({ total: 0 });
    const err = await c.payrollEmployee.create({ employeeCode: "R1", name: "Read Only", dateOfJoining: "2026-01-01" }).then(() => null, (e) => e);
    expect(err).toMatchObject({ code: "FORBIDDEN" });
    expect(reasonOf(err)).toBe("read_only_trial_expired");
    invalidateEntitlements(t.id);
  });
});
