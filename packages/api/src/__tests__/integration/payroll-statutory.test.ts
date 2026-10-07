/**
 * payroll-statutory.test.ts — Payroll Phase 2 (PF, EPS, VPF, ESI, PT, LWF, TDS,
 * statutory dues, filings and registers) against a real Postgres.
 *
 * Invariants:
 *   1. A business with no registration gets exactly the Phase 1 run (nothing
 *      statutory); with PF off, PF/EPS appear nowhere (lines, payslips, files,
 *      dues, settings).
 *   2. The statutory lines are exact (paise), per employee flags apply (PF
 *      excluded, PF off, no EPS, VPF, ESI covered for the period), and rates are
 *      data: missing slabs yield 0 and a visible warning.
 *   3. The books balance with the statutory payables; posting stays idempotent;
 *      paying a due records challan details and never pays more than is owed.
 *   4. An approved run is frozen: the files and payslips come from its lines,
 *      whatever the settings say later.
 *   5. Roles, the add-on gate and business isolation are unchanged.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { bankAccounts, businessMembers, chartOfAccounts, journalEntries, journalEntryLines, payrollRunLines, payrollStatutoryPayments, payslips } from "@fintranzact/db";
import { createTenant, createUser, addMember, createBusiness, createBankAccount, grantAddon, type TestUser, type TestTenant, type TestBusiness } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { getTenantTestDb, getTestClient, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { runAudit } from "../../lib/data-audit/runner.js";
import { seedChartOfAccounts } from "../../lib/coa-seed.js";
import { entitlementDataOf } from "../../lib/entitlement-error.js";

const db = () => getTenantTestDb();
type Caller = ReturnType<typeof createTestCaller>;
const callerFor = (u: TestUser, t: TestTenant, b: TestBusiness): Caller =>
  createTestCaller({ userId: u.id, email: u.email, name: u.name ?? null, tenantId: t.id, businessId: b.id });

const paise = (s: string | number) => Math.round(Number(s) * 100);
const MONTH = "2026-04";
const NEXT = "2026-05";

let tenant: TestTenant;
let biz: TestBusiness;
let owner: TestUser;
let accountantUser: TestUser;
let seller: TestUser;
let ownerC: Caller;
let accountantC: Caller;
let sellerC: Caller;
let tenantB: TestTenant;
let bizB: TestBusiness;
let ownerBC: Caller;
let bank: { id: string };
const ids: Record<string, string> = {};

async function addPerson(t: TestTenant, b: TestBusiness, email: string, role: "accountant" | "seller") {
  const u = await createUser({ email, name: email.split("@")[0] });
  await addMember(t.id, u.id, role);
  await db().insert(businessMembers).values({ businessId: b.id, userId: u.id, role: "member" });
  return u;
}

const days = (month: string) => {
  const n = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
};

beforeAll(async () => {
  tenant = await createTenant({ name: "Statutory Co" });
  owner = await createUser({ email: "owner@statco.in", name: "Ramesh Kumar" });
  await addMember(tenant.id, owner.id, "owner");
  biz = await createBusiness(db(), owner.id, { name: "Statutory Co", legalName: "Statutory Co Pvt Ltd", tan: "MUMS12345A" });
  await db().insert(businessMembers).values({ businessId: biz.id, userId: owner.id, role: "admin" });
  accountantUser = await addPerson(tenant, biz, "anita@statco.in", "accountant");
  seller = await addPerson(tenant, biz, "sunil@statco.in", "seller");
  await seedChartOfAccounts(db(), biz.id);
  bank = await createBankAccount(db(), biz.id, { accountName: "HDFC Current", accountType: "current", currentBalance: "1000000.00", openingBalance: "1000000.00" });
  await grantAddon(tenant.id, "payroll");
  ownerC = callerFor(owner, tenant, biz);
  accountantC = callerFor(accountantUser, tenant, biz);
  sellerC = callerFor(seller, tenant, biz);

  tenantB = await createTenant({ name: "No PF Co" });
  const ownerB = await createUser({ email: "owner@nopf.in", name: "Kiran Mehta" });
  await addMember(tenantB.id, ownerB.id, "owner");
  bizB = await createBusiness(db(), ownerB.id, { name: "No PF Co" });
  await db().insert(businessMembers).values({ businessId: bizB.id, userId: ownerB.id, role: "admin" });
  await seedChartOfAccounts(db(), bizB.id);
  ownerBC = callerFor(ownerB, tenantB, bizB);
}, 120_000);

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

const reasonOf = (e: unknown) => entitlementDataOf(e)?.reason;

describe("the add-on gate is unchanged", () => {
  it("every statutory procedure needs the Payroll add-on", async () => {
    for (const call of [
      () => ownerBC.payrollStatutory.settings(),
      () => ownerBC.payrollStatutory.dues(),
      () => ownerBC.payrollStatutory.updateBusinessSettings({ pfRegistered: false, esiRegistered: false, ptStates: [], tdsEnabled: false }),
    ]) {
      const err = await call().then(() => null, (e) => e);
      expect(err).toMatchObject({ code: "FORBIDDEN" });
      expect(reasonOf(err)).toBe("addon_required");
    }
    await grantAddon(tenantB.id, "payroll");
  });

  it("a role without the Payroll permission is refused", async () => {
    await expect(sellerC.payrollStatutory.settings()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(sellerC.payrollStatutory.dues()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(sellerC.payrollStatutory.updateBusinessSettings({ pfRegistered: true, esiRegistered: false, ptStates: [], tdsEnabled: false })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("settings: registrations and rates are data", () => {
  it("starts with nothing registered and the shipped defaults, with the gaps named", async () => {
    const s = await ownerC.payrollStatutory.settings();
    expect(s.flags).toMatchObject({ pfRegistered: false, esiRegistered: false, ptStates: [], lwfState: null, tdsEnabled: false });
    expect(s).toMatchObject({ ratesSource: "default", verifyLabel: "Verify with your CA", canEdit: true, hasTan: true });
    expect(s.rates.pf).toMatchObject({ employeePercent: 12, epsPercent: 8.33, wageCeilingRupees: 15000 });
    expect(s.rates.esi).toMatchObject({ employeePercent: 0.75, employerPercent: 3.25, wageCeilingRupees: 21000 });
    expect(s.rates.tds.newRegime).toMatchObject({ standardDeductionRupees: 75000, slabs: [] });
    expect(Object.keys(s.rates.pt)).toEqual(["27"]);
    expect(s.gaps.join(" ")).toContain("New-regime income-tax slabs are not configured");
  });

  it("only an owner or admin changes the registrations and the rates; an accountant reads them", async () => {
    await expect(accountantC.payrollStatutory.updateBusinessSettings({ pfRegistered: true, esiRegistered: false, ptStates: [], tdsEnabled: false })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const s = await accountantC.payrollStatutory.settings();
    expect(s.canEdit).toBe(false);
    await expect(accountantC.payrollStatutory.saveRates({ financialYear: 2026, rates: s.rates })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("registers PF, ESI, a PT state and TDS", async () => {
    const r = await ownerC.payrollStatutory.updateBusinessSettings({
      pfRegistered: true, pfEstablishmentCode: "MHBAN0012345000", esiRegistered: true, esiCode: "31000123450001001", ptStates: ["27"], lwfState: "", tdsEnabled: true,
    });
    expect(r.flags).toMatchObject({ pfRegistered: true, pfEstablishmentCode: "MHBAN0012345000", esiRegistered: true, ptStates: ["27"], lwfState: null, tdsEnabled: true });
    // Switching PF off clears its code.
    const off = await ownerC.payrollStatutory.updateBusinessSettings({ pfRegistered: false, pfEstablishmentCode: "X", esiRegistered: true, esiCode: "1", ptStates: ["27"], tdsEnabled: true });
    expect(off.flags.pfEstablishmentCode).toBeNull();
    await ownerC.payrollStatutory.updateBusinessSettings({ pfRegistered: true, pfEstablishmentCode: "MHBAN0012345000", esiRegistered: true, esiCode: "31000123450001001", ptStates: ["27"], tdsEnabled: true });
    await expect(ownerC.payrollStatutory.updateBusinessSettings({ pfRegistered: true, esiRegistered: true, ptStates: ["99"], tdsEnabled: true })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("refuses bad rates: overlapping PT slabs and a percentage above 100", async () => {
    const s = await ownerC.payrollStatutory.settings();
    const overlap = { ...s.rates, pt: { "29": { annualMaxRupees: 2500, slabs: [{ fromRupees: 0, toRupees: 20000, monthlyRupees: 100, gender: "any" as const }, { fromRupees: 15000, toRupees: null, monthlyRupees: 200, gender: "any" as const }] } } };
    await expect(ownerC.payrollStatutory.saveRates({ financialYear: 2026, rates: overlap })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(ownerC.payrollStatutory.saveRates({ financialYear: 2026, rates: { ...s.rates, pf: { ...s.rates.pf, employeePercent: 120 } } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("setup: salaries and employees", () => {
  it("creates salary templates and the five employees", async () => {
    await ownerC.payrollSalary.componentSeedDefaults();
    const comps = await ownerC.payrollSalary.componentList();
    expect(comps.every((c) => c.statutoryKind === null)).toBe(true);
    for (const c of comps) ids[`c_${c.code}`] = c.id;
    const tpl = async (name: string, lines: Array<[string, number]>) =>
      (await ownerC.payrollSalary.templateCreate({ name, sampleAnnualCtc: lines.reduce((s, l) => s + l[1], 0) * 12, lines: lines.map(([code, value]) => ({ componentId: ids[`c_${code}`]!, calcType: "fixed" as const, value })) })).id;
    const tA = await tpl("A 30k", [["BASIC", 20000], ["HRA", 8000], ["SPECIAL", 2000]]);
    const tB = await tpl("B 15k", [["BASIC", 12000], ["SPECIAL", 3000]]);
    const tC = await tpl("C 120k", [["BASIC", 80000], ["HRA", 40000]]);
    const tD = await tpl("D 20k", [["BASIC", 20000]]);
    const tE = await tpl("E 25k", [["BASIC", 25000]]);
    ids.tE = tE;

    const mk = async (code: string, name: string, gender: "male" | "female", extra: Record<string, unknown>, template: string, ctc: number) => {
      const e = await ownerC.payrollEmployee.create({ employeeCode: code, name, dateOfJoining: "2026-01-01", dateOfBirth: "1990-05-05", gender, workState: "27", pan: "ABCDE1234F", ...extra } as never);
      ids[code] = e.id;
      await ownerC.payrollSalary.assign({ employeeId: e.id, templateId: template, annualCtc: ctc, effectiveFrom: "2026-01-01" });
    };
    await mk("E001", "Asha Verma", "male", { uan: "100200300401" }, tA, 360000);
    await mk("E002", "Ravi Nair", "male", { uan: "100200300402", esicNumber: "1234567890" }, tB, 180000);
    await mk("E003", "Meena Shah", "female", { uan: "100200300403" }, tC, 1440000);
    await mk("E004", "Divya Rao", "female", { uan: "100200300404", esicNumber: "2345678901" }, tD, 240000);
    await mk("E005", "Kiran Joshi", "male", {}, tD, 240000);
  });

  it("sets each employee's statutory fields (accountant may; seller may not)", async () => {
    await accountantC.payrollStatutory.employeeUpdate({ employeeId: ids.E002!, vpfPercent: 5 });
    await ownerC.payrollStatutory.employeeUpdate({ employeeId: ids.E003!, pfExcluded: true, esiApplicable: false });
    await ownerC.payrollStatutory.employeeUpdate({ employeeId: ids.E004!, epsEligible: false });
    await ownerC.payrollStatutory.employeeUpdate({ employeeId: ids.E005!, pfApplicable: false });
    await expect(sellerC.payrollStatutory.employeeUpdate({ employeeId: ids.E002!, vpfPercent: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(ownerC.payrollStatutory.employeeUpdate({ employeeId: ids.E002!, vpfPercent: 150 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const s = await ownerC.payrollStatutory.employeeSettings({ employeeId: ids.E002! });
    expect(s).toMatchObject({ vpfPercent: 5, pfApplicable: true, epsEligible: true, epsInEffect: true });
    expect(s.epsSuggestion.status).toBe("eligible");
    expect((await ownerC.payrollStatutory.employeeSettings({ employeeId: ids.E003! })).pfExcluded).toBe(true);
  });

  it("the EPS suggestion follows age 58 and the post-2014 wage rule", async () => {
    const old = await ownerC.payrollEmployee.create({ employeeCode: "E900", name: "Old Timer", dateOfJoining: "2010-01-01", dateOfBirth: "1960-01-01" } as never);
    expect((await ownerC.payrollStatutory.employeeSettings({ employeeId: old.id })).epsSuggestion).toMatchObject({ status: "not_eligible" });
    const hi = await ownerC.payrollEmployee.create({ employeeCode: "E901", name: "High Joiner", dateOfJoining: "2020-01-01", dateOfBirth: "1990-01-01" } as never);
    await ownerC.payrollSalary.assign({ employeeId: hi.id, templateId: ids.tE!, annualCtc: 600000, effectiveFrom: "2020-01-01" }).catch(() => null);
    // 25,000 of wages at joining is above the 15,000 ceiling.
    const sug = await ownerC.payrollStatutory.employeeSettings({ employeeId: hi.id });
    expect(sug.epsSuggestion.status).toBe("not_eligible");
    await ownerC.payrollEmployee.exit({ id: old.id, lastWorkingDay: "2026-01-31", reason: "retirement" });
    await ownerC.payrollEmployee.exit({ id: hi.id, lastWorkingDay: "2026-01-31", reason: "resignation" });
  });
});

describe("the April 2026 run, statutory lines", () => {
  const lineOf = async (code: string) => {
    const d = await accountantC.payrollRun.get({ id: ids.run! });
    return d.lines.find((l) => l.employeeCode === code)!;
  };
  const amount = (l: { components: Array<{ statutoryKind: string | null; amount: string }> }, kind: string) => l.components.find((c) => c.statutoryKind === kind)?.amount ?? null;

  it("marks attendance, locks, and calculates with the default rates: missing tax slabs are a visible warning and TDS is 0", async () => {
    for (const code of ["E001", "E002", "E003", "E004", "E005"]) await ownerC.payrollAttendance.bulkMark({ employeeIds: [ids[code]!], dates: days(MONTH), status: "present" });
    ids.run = (await accountantC.payrollRun.create({ month: MONTH })).id;
    await accountantC.payrollRun.lockAttendance({ id: ids.run! });
    const calc = await accountantC.payrollRun.calculate({ id: ids.run! });
    const codes = calc.warnings.map((w) => w.code);
    expect(codes).toContain("tax_slabs_missing");
    expect(codes).toContain("statutory_rates_default");
    expect(codes.filter((c) => c === "tax_slabs_missing")).toHaveLength(1); // once on the run, not per employee
    const meena = await lineOf("E003");
    expect(amount(meena, "income_tax_tds")).toBeNull();
    expect(amount(meena, "professional_tax")).toBe("200.00");
    expect((await accountantC.payrollRun.get({ id: ids.run! })).run.statutory).toMatchObject({ financialYear: 2026, ratesSource: "default", flags: { pfRegistered: true, esiRegistered: true, ptStates: ["27"], tdsEnabled: true } });
  });

  it("saves the rates for the year (with a last-verified note) and recalculates: exact statutory amounts per employee", async () => {
    const s = await ownerC.payrollStatutory.settings({ financialYear: 2026 });
    const slabs = [
      { fromRupees: 0, toRupees: 400000, ratePercent: 0 }, { fromRupees: 400000, toRupees: 800000, ratePercent: 5 }, { fromRupees: 800000, toRupees: 1200000, ratePercent: 10 },
      { fromRupees: 1200000, toRupees: 1600000, ratePercent: 15 }, { fromRupees: 1600000, toRupees: 2000000, ratePercent: 20 }, { fromRupees: 2000000, toRupees: 2400000, ratePercent: 25 }, { fromRupees: 2400000, toRupees: null, ratePercent: 30 },
    ];
    // Test figures typed in by "the CA": the product ships these empty.
    await ownerC.payrollStatutory.saveRates({
      financialYear: 2026,
      rates: { ...s.rates, tds: { ...s.rates.tds, newRegime: { ...s.rates.tds.newRegime, slabs, rebateThresholdRupees: 1200000, rebateMaxRupees: 60000, marginalRelief: true } } },
      verifiedNote: "Checked with CA Shah against the Finance Act", verifiedOn: "2026-04-01",
    });
    const saved = await ownerC.payrollStatutory.settings({ financialYear: 2026 });
    expect(saved).toMatchObject({ ratesSource: "saved", ratesSavedForFinancialYear: 2026, verifiedNote: "Checked with CA Shah against the Finance Act", verifiedOn: "2026-04-01" });
    expect(saved.gaps.join(" ")).not.toContain("New-regime");
    // A later year starts from the latest saved figures.
    expect((await ownerC.payrollStatutory.settings({ financialYear: 2027 })).rates.tds.newRegime.slabs).toHaveLength(7);

    const calc = await accountantC.payrollRun.calculate({ id: ids.run! });
    expect(calc.warnings.map((w) => w.code)).not.toContain("tax_slabs_missing");
    expect(calc.warnings.map((w) => w.code)).not.toContain("statutory_rates_default");

    // E001: PF on wages capped at 15,000: 12% = 1,800; employer 1,800 = EPS 1,250 + EPF 550. ESI off (30,000). PT 200.
    const e1 = await lineOf("E001");
    expect(e1).toMatchObject({ grossEarnings: "30000.00", totalDeductions: "2000.00", netPay: "28000.00", employerContributions: "1800.00" });
    expect(amount(e1, "pf_employee")).toBe("1800.00");
    expect(amount(e1, "eps_employer")).toBe("1250.00");
    expect(amount(e1, "pf_employer")).toBe("550.00");
    expect(amount(e1, "esi_employee")).toBeNull();
    // E002: wages 12,000 (not capped): 1,440 + VPF 5% = 600; EPS 8.33% = 999.60 -> 1,000, EPF 440; ESI 113 / 488 (rounded up); PT 200.
    const e2 = await lineOf("E002");
    expect(amount(e2, "pf_employee")).toBe("1440.00");
    expect(amount(e2, "vpf")).toBe("600.00");
    expect(amount(e2, "eps_employer")).toBe("1000.00");
    expect(amount(e2, "pf_employer")).toBe("440.00");
    expect(amount(e2, "esi_employee")).toBe("113.00");
    expect(amount(e2, "esi_employer")).toBe("488.00");
    expect(e2).toMatchObject({ totalDeductions: "2353.00", netPay: "12647.00", employerContributions: "1928.00" });
    // E003: excluded from PF and ESI; PT 200; TDS 7,345 (new regime, marginal relief just above the rebate limit).
    const e3 = await lineOf("E003");
    expect(e3.components.filter((c) => c.statutoryKind).map((c) => c.statutoryKind).sort()).toEqual(["income_tax_tds", "professional_tax"]);
    expect(amount(e3, "income_tax_tds")).toBe("7345.00");
    expect(e3).toMatchObject({ totalDeductions: "7545.00", netPay: "112455.00" });
    // E004: no EPS: the whole employer 12% goes to EPF; ESI covered (20,000); female, gross under 25,000: no PT.
    const e4 = await lineOf("E004");
    expect(amount(e4, "eps_employer")).toBeNull();
    expect(amount(e4, "pf_employer")).toBe("1800.00");
    expect(amount(e4, "esi_employee")).toBe("150.00");
    expect(amount(e4, "professional_tax")).toBeNull();
    // E005: PF not applicable: no PF at all; ESI and PT apply.
    const e5 = await lineOf("E005");
    expect(e5.components.some((c) => ["pf_employee", "vpf", "pf_employer", "eps_employer"].includes(c.statutoryKind ?? ""))).toBe(false);
    expect(amount(e5, "esi_employee")).toBe("150.00");
    expect(amount(e5, "professional_tax")).toBe("200.00");
    // Statutory working is stored with the line (what the filings read).
    const row = (await db().select().from(payrollRunLines).where(eq(payrollRunLines.id, e2.id)))[0]!;
    expect(row.statutory).toMatchObject({ pf: { member: true, epsWagesPaise: 1_200_000 }, esi: { covered: true } });
    const run = (await accountantC.payrollRun.get({ id: ids.run! })).run;
    expect(run).toMatchObject({ grossTotal: "205000.00", deductionsTotal: "14198.00", employerTotal: "6828.00", netTotal: "190802.00" });
  });

  it("a hand-entered PF deduction from Phase 1 raises a double-deduction warning", async () => {
    await accountantC.payrollRun.addAdjustment({ runId: ids.run!, employeeId: ids.E001!, name: "PF deduction", type: "deduction", amount: 100 });
    const calc = await accountantC.payrollRun.calculate({ id: ids.run! });
    expect(calc.warnings.some((w) => w.code === "double_deduction")).toBe(true);
    const adj = (await accountantC.payrollRun.get({ id: ids.run! })).adjustments[0]!;
    await accountantC.payrollRun.removeAdjustment({ runId: ids.run!, adjustmentId: adj.id });
    await accountantC.payrollRun.calculate({ id: ids.run! });
  });

  it("approves; payslips show the statutory lines, PF and the UAN only because PF is registered", async () => {
    await accountantC.payrollRun.submit({ id: ids.run! });
    await ownerC.payrollRun.approve({ id: ids.run! });
    const slips = await db().select().from(payslips).where(eq(payslips.runId, ids.run!));
    const snap = slips.find((s) => s.number === "PS-2026-04-E002")!.snapshot as { employee: { uanMasked: string | null; esicMasked: string | null }; deductions: Array<{ name: string; amount: string }>; employerContributions?: Array<{ name: string; amount: string }> };
    expect(snap.deductions.map((d) => d.name)).toEqual(expect.arrayContaining(["Provident fund (employee)", "Voluntary provident fund", "ESI (employee)", "Professional tax"]));
    expect(snap.employerContributions?.map((d) => d.name)).toEqual(expect.arrayContaining(["Provident fund (employer EPF share)", "ESI (employer)"]));
    expect(snap.employee.uanMasked).toBe("XXXXXXXX0402");
    expect(JSON.stringify(snap)).not.toContain("100200300402");
    const pdf = await ownerC.payrollRun.payslipPdf({ runId: ids.run!, employeeId: ids.E002! });
    expect(Buffer.from(pdf.base64, "base64").subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("an approved run is frozen: recalculating is refused and later rate changes do not touch it", async () => {
    await expect(accountantC.payrollRun.calculate({ id: ids.run! })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const before = await accountantC.payrollStatutory.ecrFile({ runId: ids.run! });
    const s = await ownerC.payrollStatutory.settings({ financialYear: 2026 });
    await ownerC.payrollStatutory.saveRates({ financialYear: 2026, rates: { ...s.rates, pf: { ...s.rates.pf, employeePercent: 10 } } });
    const after = await accountantC.payrollStatutory.ecrFile({ runId: ids.run! });
    expect(after.text).toBe(before.text);
    await ownerC.payrollStatutory.saveRates({ financialYear: 2026, rates: s.rates, verifiedNote: "Checked with CA Shah against the Finance Act", verifiedOn: "2026-04-01" });
    const line = await lineOf("E002");
    expect(amount(line, "pf_employee")).toBe("1440.00");
  });
});

describe("books: statutory payables and paying the dues", () => {
  it("posts one balanced entry with a payable account per authority; posting twice changes nothing", async () => {
    const first = await accountantC.payrollRun.post({ id: ids.run! });
    expect(first.created).toBe(true);
    const again = await accountantC.payrollRun.post({ id: ids.run! });
    expect(again).toMatchObject({ created: false, journalEntryId: first.journalEntryId });
    const lines = await db()
      .select({ code: chartOfAccounts.code, name: chartOfAccounts.name, type: chartOfAccounts.accountType, debit: journalEntryLines.debit, credit: journalEntryLines.credit })
      .from(journalEntryLines)
      .innerJoin(chartOfAccounts, eq(chartOfAccounts.id, journalEntryLines.accountId))
      .where(eq(journalEntryLines.journalEntryId, first.journalEntryId));
    const debit = lines.reduce((s, l) => s + paise(l.debit), 0);
    const credit = lines.reduce((s, l) => s + paise(l.credit), 0);
    expect(debit).toBe(credit);
    expect(debit).toBe(paise("211828"));
    const by = Object.fromEntries(lines.map((l) => [l.code, l]));
    expect(paise(by["2400"]!.credit)).toBe(paise("190802")); // net salaries
    expect(by["2430"]).toMatchObject({ name: "PF and EPS Payable", type: "liability", credit: "10680.00" });
    expect(by["2431"]).toMatchObject({ name: "ESI Payable", credit: "2201.00" });
    expect(by["2432"]).toMatchObject({ name: "Professional Tax Payable", credit: "800.00" });
    expect(by["2434"]).toMatchObject({ name: "TDS on Salary Payable", credit: "7345.00" });
    expect(by["2433"]).toBeUndefined(); // no LWF
    expect(by["2410"]).toBeUndefined(); // statutory amounts are not in the general deductions account
    expect(by["2420"]).toBeUndefined();
    const entries = await db().select().from(journalEntries).where(and(eq(journalEntries.businessId, biz.id), eq(journalEntries.source, "system")));
    expect(entries).toHaveLength(1);
  });

  it("lists the dues with accrued amounts and due dates, from the configured due days", async () => {
    const d = await accountantC.payrollStatutory.dues({ financialYear: 2026 });
    const row = (kind: string) => d.rows.find((r) => r.kind === kind)!;
    expect(row("pf")).toMatchObject({ accrued: "10680.00", paid: "0.00", outstanding: "10680.00", dueDate: "2026-05-15", canPay: true, month: MONTH });
    expect(row("esi")).toMatchObject({ accrued: "2201.00", dueDate: "2026-05-15" });
    expect(row("tds")).toMatchObject({ accrued: "7345.00", dueDate: "2026-05-07" });
    expect(row("pt")).toMatchObject({ accrued: "800.00", dueDate: null }); // state specific: not configured
    expect(d.rows.some((r) => r.kind === "lwf")).toBe(false);
  });

  it("records payments with challan details, never more than is owed, and the books and bank follow", async () => {
    const pay = (amount: number, over: Record<string, unknown> = {}) =>
      accountantC.payrollStatutory.recordPayment({ runId: ids.run!, kind: "pf", amount, paidOn: "2026-05-14", bankAccountId: bank.id, challanNumber: "TRRN-1001", challanDate: "2026-05-14", ...over });
    const before = Number((await db().select().from(bankAccounts).where(eq(bankAccounts.id, bank.id)))[0]!.currentBalance);
    const p1 = await pay(5000);
    expect(p1.outstanding).toBe("5680.00");
    await expect(pay(6000)).rejects.toThrow(/Only 5680.00 is outstanding/);
    await expect(sellerC.payrollStatutory.recordPayment({ runId: ids.run!, kind: "pf", amount: 1, paidOn: "2026-05-14", bankAccountId: bank.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(ownerBC.payrollStatutory.recordPayment({ runId: ids.run!, kind: "pf", amount: 1, paidOn: "2026-05-14", bankAccountId: bank.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const p2 = await pay(5680, { challanNumber: "TRRN-1002" });
    expect(p2.outstanding).toBe("0.00");
    await accountantC.payrollStatutory.recordPayment({ runId: ids.run!, kind: "tds", amount: 7345, paidOn: "2026-05-06", bankAccountId: bank.id, challanNumber: "00123", challanDate: "2026-05-06", reference: "BSR 6360000" });
    await expect(accountantC.payrollStatutory.recordPayment({ runId: ids.run!, kind: "lwf", amount: 1, paidOn: "2026-05-06", bankAccountId: bank.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const after = Number((await db().select().from(bankAccounts).where(eq(bankAccounts.id, bank.id)))[0]!.currentBalance);
    expect(Math.round((before - after) * 100)).toBe(paise("10680") + paise("7345"));
    const d = await accountantC.payrollStatutory.dues({ financialYear: 2026 });
    expect(d.rows.find((r) => r.kind === "pf")).toMatchObject({ paid: "10680.00", outstanding: "0.00" });
    expect(d.rows.find((r) => r.kind === "pf")!.payments.map((x) => x.challanNumber).sort()).toEqual(["TRRN-1001", "TRRN-1002"]);
    expect(d.rows.find((r) => r.kind === "esi")).toMatchObject({ paid: "0.00", outstanding: "2201.00" });
    // Dr PF payable / Cr bank for each payment.
    const je = await db()
      .select({ code: chartOfAccounts.code, debit: journalEntryLines.debit, credit: journalEntryLines.credit })
      .from(journalEntryLines)
      .innerJoin(chartOfAccounts, eq(chartOfAccounts.id, journalEntryLines.accountId))
      .where(and(eq(chartOfAccounts.businessId, biz.id), eq(chartOfAccounts.code, "2430")));
    expect(je.reduce((s, l) => s + paise(l.credit) - paise(l.debit), 0)).toBe(0);
  });
});

describe("files and registers from the approved run", () => {
  it("PF ECR: members only, EPS wages zero where there is no EPS, in the #~# layout", async () => {
    const ecr = await accountantC.payrollStatutory.ecrFile({ runId: ids.run! });
    const lines = ecr.text.trim().split("\n");
    expect(ecr.filename).toBe("ECR-2026-04.txt");
    expect(lines).toEqual([
      "100200300401#~#ASHA VERMA#~#30000#~#15000#~#15000#~#15000#~#1800#~#1250#~#550#~#0#~#0",
      "100200300402#~#RAVI NAIR#~#15000#~#12000#~#12000#~#12000#~#2040#~#1000#~#440#~#0#~#0",
      "100200300404#~#DIVYA RAO#~#20000#~#15000#~#0#~#15000#~#1800#~#0#~#1800#~#0#~#0",
    ]);
    expect(ecr.totals).toEqual({ epfEe: 5640, eps: 2250, epfEr: 2790 });
    expect(ecr.note).toMatch(/Check it against the EPFO portal/);
    await expect(sellerC.payrollStatutory.ecrFile({ runId: ids.run! })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("ESIC file: covered employees with an IP number; the one without is reported", async () => {
    const f = await accountantC.payrollStatutory.esicFile({ runId: ids.run! });
    const lines = f.text.trim().split("\r\n");
    expect(lines[1]).toBe("1234567890,Ravi Nair,30,15000,0,");
    expect(lines[2]).toBe("2345678901,Divya Rao,30,20000,0,");
    expect(f.skipped).toEqual([{ employeeCode: "E005", reason: "No ESIC insurance (IP) number" }]);
  });

  it("PT working sheet by state; no LWF sheet without an LWF state", async () => {
    const pt = await accountantC.payrollStatutory.ptSheets({ runId: ids.run! });
    expect(pt.sheets.map((s) => s.state)).toEqual(["27"]);
    expect(pt.sheets[0]).toMatchObject({ count: 4, employeeTotal: "800.00" });
    await expect(accountantC.payrollStatutory.lwfSheets({ runId: ids.run! })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("Form 24Q working data with the TDS challan, and a Form 16 working copy labelled for CA review", async () => {
    const q = await accountantC.payrollStatutory.form24q({ financialYear: 2026, quarter: 1 });
    expect(q.totalTds).toBe("7345.00");
    expect(q.totalChallan).toBe("7345.00");
    expect(q.deducteeCsv).toContain("E003,Meena Shah,ABCDE1234F,2026-04,120000.00,7345.00,30/04/2026");
    expect(q.challanCsv).toContain("00123");
    expect(q.note).toMatch(/not an FVU file/);
    const pdf = await accountantC.payrollStatutory.form16Pdf({ financialYear: 2026, employeeId: ids.E003! });
    expect(Buffer.from(pdf.base64, "base64").subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.label).toMatch(/Working copy for CA review/);
    const data = await accountantC.payrollStatutory.form16Data({ financialYear: 2026, employeeId: ids.E003! });
    expect(data.csv).toContain("Working copy for CA review");
    expect(data.summary.taxDeducted).toBe(7345);
    await expect(accountantC.payrollStatutory.form16Data({ financialYear: 2026, employeeId: "00000000-0000-4000-8000-000000000000" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("registers: wages, attendance, leave, bonus and gratuity", async () => {
    const wages = await accountantC.payrollStatutory.register({ register: "wages", month: MONTH });
    expect(wages.text).toContain("Provident fund (employee)");
    expect(wages.text.trim().split("\r\n")).toHaveLength(6);
    const att = await accountantC.payrollStatutory.register({ register: "attendance", month: MONTH });
    expect(att.text.trim().split("\r\n")[1]).toContain("P,P,P");
    expect((await accountantC.payrollStatutory.register({ register: "leave", leaveYear: 2026 })).filename).toBe("leave-register-2026.csv");
    const bonus = await accountantC.payrollStatutory.register({ register: "bonus", financialYear: 2026 });
    expect(bonus.text).toContain("Bonus percentage not configured");
    const grat = await accountantC.payrollStatutory.register({ register: "gratuity", asOf: "2026-10-07", financialYear: 2026 });
    expect(grat.text).toContain("Asha Verma");
    expect(grat.text).toContain("No"); // under five years: not eligible
    await expect(accountantC.payrollStatutory.register({ register: "wages", month: "2026-03" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("files need an approved run", async () => {
    await accountantC.payrollRun.create({ month: NEXT }).then((r) => (ids.may = r.id));
    await expect(accountantC.payrollStatutory.ecrFile({ runId: ids.may! })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("May: TDS is spread and ESI follows the contribution period", () => {
  it("TDS from the year's history, and ESI stays on for the period after a raise above 21,000", async () => {
    // Divya gets a raise to 25,000 from May: above the ESI ceiling, but she was covered in April.
    await ownerC.payrollSalary.assign({ employeeId: ids.E004!, templateId: ids.tE!, annualCtc: 300000, effectiveFrom: "2026-05-01" });
    for (const code of ["E001", "E002", "E003", "E004", "E005"]) await ownerC.payrollAttendance.bulkMark({ employeeIds: [ids[code]!], dates: days(NEXT), status: "present" });
    await accountantC.payrollRun.lockAttendance({ id: ids.may! });
    await accountantC.payrollRun.calculate({ id: ids.may! });
    const d = await accountantC.payrollRun.get({ id: ids.may! });
    const l = (code: string) => d.lines.find((x) => x.employeeCode === code)!;
    const amt = (code: string, kind: string) => l(code).components.find((c) => c.statutoryKind === kind)?.amount ?? null;
    // (88,140 - 7,345) / 11 months = 7,345 again.
    expect(amt("E003", "income_tax_tds")).toBe("7345.00");
    // Divya: 25,000 > 21,000 but covered earlier in April-September: 0.75% = 187.50 -> 188, 3.25% = 812.50 -> 813.
    expect(amt("E004", "esi_employee")).toBe("188.00");
    expect(amt("E004", "esi_employer")).toBe("813.00");
    // Female at exactly 25,000: no professional tax (the slab starts above it).
    expect(amt("E004", "professional_tax")).toBeNull();
    expect((l("E004").statutory as { esi: { reason: string } }).esi.reason).toBe("kept_for_period");
    expect(d.run.warnings.filter((w) => w.code === "tds_history_gap")).toHaveLength(0);
  });
});

describe("a business without PF: PF and EPS appear nowhere", () => {
  const ecrErr = () => ownerBC.payrollStatutory.ecrFile({ runId: ids.runB! }).then(() => null, (e) => e);

  it("with no registration at all the run is exactly the Phase 1 run", async () => {
    await ownerBC.payrollSalary.componentSeedDefaults();
    const comps = await ownerBC.payrollSalary.componentList();
    const basic = comps.find((c) => c.code === "BASIC")!;
    const t = await ownerBC.payrollSalary.templateCreate({ name: "B 20k", sampleAnnualCtc: 240000, lines: [{ componentId: basic.id, calcType: "fixed", value: 20000 }] });
    const e = await ownerBC.payrollEmployee.create({ employeeCode: "B001", name: "Nisha Patel", dateOfJoining: "2026-01-01", gender: "female", workState: "27", uan: "100200300499", esicNumber: "3456789012", pan: "ABCDE1234F" } as never);
    ids.eB = e.id;
    await ownerBC.payrollSalary.assign({ employeeId: e.id, templateId: t.id, annualCtc: 240000, effectiveFrom: "2026-01-01" });
    await ownerBC.payrollAttendance.bulkMark({ employeeIds: [e.id], dates: days(MONTH), status: "present" });
    ids.runB = (await ownerBC.payrollRun.create({ month: MONTH })).id;
    await ownerBC.payrollRun.lockAttendance({ id: ids.runB! });
    await ownerBC.payrollRun.calculate({ id: ids.runB! });
    const d = await ownerBC.payrollRun.get({ id: ids.runB! });
    expect(d.run.statutory).toBeNull();
    expect(d.lines[0]!.statutory).toBeNull();
    expect(d.lines[0]).toMatchObject({ grossEarnings: "20000.00", totalDeductions: "0.00", netPay: "20000.00" });
    expect(d.lines[0]!.components.some((c) => c.statutoryKind)).toBe(false);
  });

  it("registering ESI and a PT state (not PF) adds only those lines", async () => {
    await ownerBC.payrollStatutory.updateBusinessSettings({ pfRegistered: false, esiRegistered: true, esiCode: "31000999990001001", ptStates: ["27"], tdsEnabled: false });
    await ownerBC.payrollRun.calculate({ id: ids.runB! });
    const d = await ownerBC.payrollRun.get({ id: ids.runB! });
    const kinds = d.lines[0]!.components.filter((c) => c.statutoryKind).map((c) => c.statutoryKind).sort();
    expect(kinds).toEqual(["esi_employee", "esi_employer"]); // female, 20,000: no PT in Maharashtra
    expect(d.run.statutory).toMatchObject({ flags: { pfRegistered: false, esiRegistered: true } });
    expect(d.lines[0]!.statutory).toMatchObject({ esi: { covered: true } });
    expect((d.lines[0]!.statutory as Record<string, unknown>).pf).toBeNull();
    expect(JSON.stringify(d)).not.toMatch(/provident|EPS_ER|PF_EE/i);
  });

  it("the payslip, files and dues carry no PF or UAN; the PF file is refused", async () => {
    await ownerBC.payrollRun.submit({ id: ids.runB! });
    // A business with one member may approve its own run.
    await ownerBC.payrollRun.approve({ id: ids.runB! });
    const slips = await db().select().from(payslips).where(eq(payslips.runId, ids.runB!));
    const text = JSON.stringify(slips[0]!.snapshot);
    expect(text).not.toMatch(/provident|EPS|pension/i);
    expect((slips[0]!.snapshot as { employee: { uanMasked: unknown; esicMasked: unknown } }).employee).toMatchObject({ uanMasked: null, esicMasked: "XXXXXX9012" });
    expect(await ecrErr()).toMatchObject({ code: "BAD_REQUEST" });
    await ownerBC.payrollRun.post({ id: ids.runB! });
    const dues = await ownerBC.payrollStatutory.dues({ financialYear: 2026 });
    expect(dues.rows.map((r) => r.kind)).toEqual(["esi"]);
    const wages = await ownerBC.payrollStatutory.register({ register: "wages", month: MONTH });
    expect(wages.text).not.toMatch(/provident|pension/i);
    const lines = await db().select({ code: chartOfAccounts.code }).from(journalEntryLines).innerJoin(chartOfAccounts, eq(chartOfAccounts.id, journalEntryLines.accountId)).where(eq(chartOfAccounts.businessId, bizB.id));
    expect(lines.map((l) => l.code)).not.toContain("2430");
    const settings = await ownerBC.payrollStatutory.settings();
    expect(settings.flags).toMatchObject({ pfRegistered: false, pfEstablishmentCode: null });
  });
});

describe("isolation and the data audit", () => {
  it("one business's statutory data never reaches another", async () => {
    await expect(ownerBC.payrollStatutory.ecrFile({ runId: ids.run! })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(ownerBC.payrollStatutory.employeeSettings({ employeeId: ids.E001! })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(ownerBC.payrollStatutory.employeeUpdate({ employeeId: ids.E001!, vpfPercent: 3 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(ownerBC.payrollStatutory.saveDeclaration({ employeeId: ids.E001!, financialYear: 2026, amounts: { sec80C: 1 } as never })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await ownerBC.payrollStatutory.dues({ financialYear: 2026 })).rows.every((r) => r.runId !== ids.run)).toBe(true);
    expect((await ownerBC.payrollStatutory.settings()).rates.tds.newRegime.slabs).toEqual([]); // the other business's rates are not shared
  });

  it("declarations are saved per employee and year", async () => {
    await accountantC.payrollStatutory.saveDeclaration({ employeeId: ids.E003!, financialYear: 2026, amounts: { sec80C: 150000, sec80D: 25000, hraExemption: 0, homeLoanInterest: 0, otherDeductions: 0, previousEmployerIncome: 0, previousEmployerTds: 0 } });
    expect((await accountantC.payrollStatutory.employeeSettings({ employeeId: ids.E003!, financialYear: 2026 })).declaration).toMatchObject({ sec80C: 150000, sec80D: 25000 });
    await expect(accountantC.payrollStatutory.saveDeclaration({ employeeId: ids.E003!, financialYear: 2026, amounts: { sec80C: -5 } as never })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("the data audit finds nothing wrong in the statutory data this suite built", async () => {
    const report = await runAudit(getTestClient(), { businessIds: [biz.id, bizB.id] });
    const tables = new Set(["payroll_runs", "payroll_run_lines", "payslips", "payroll_statutory_payments", "payroll_statutory_settings", "employee_tax_declarations"]);
    const mine = report.results.filter((r) => tables.has(r.rule.table));
    expect(mine.map((r) => `${r.rule.id}: ${r.samples.map((x) => x.detail).join("; ")}`)).toEqual([]);
    expect(report.failures).toEqual([]); // every statutory rule's query ran

    // The rules do catch what they are for: a PF line smuggled into a run calculated without PF, and a payment above what was accrued.
    const [line] = await db().select().from(payrollRunLines).where(eq(payrollRunLines.runId, ids.runB!));
    const bad = [...line!.components, { componentId: null, code: "PF_EE", name: "Provident fund (employee)", type: "deduction", category: "other_deduction", isWage: false, statutoryKind: "pf_employee", source: "statutory", full: "0.00", amount: "0.00" }];
    await db().update(payrollRunLines).set({ components: bad }).where(eq(payrollRunLines.id, line!.id));
    await db().insert(payrollStatutoryPayments).values({ businessId: biz.id, runId: ids.run!, kind: "lwf", amount: "5.00", paidOn: "2026-05-20" });
    const dirty = await runAudit(getTestClient(), { businessIds: [biz.id, bizB.id] });
    const hits = dirty.results.map((r) => r.rule.id);
    expect(hits.some((id) => id.includes("no-pf-without-registration"))).toBe(true);
    expect(hits.some((id) => id.includes("payments-within-accrued"))).toBe(true);
    expect(hits.some((id) => id.includes("payment-has-balanced-journal"))).toBe(true);
    await db().update(payrollRunLines).set({ components: line!.components }).where(eq(payrollRunLines.id, line!.id));
    await db().delete(payrollStatutoryPayments).where(eq(payrollStatutoryPayments.kind, "lwf"));
  });
});
