/**
 * payroll-registers-pdf.test.ts - every Payroll register as a PDF through payrollStatutory.register (`format: "pdf"`), against
 * a real Postgres.
 *
 * Invariants:
 *   1. `format` defaults to csv, and a CSV response is exactly what it was (no PDF keys).
 *   2. The PDF is a real, parsing PDF with the register's header row, the business, the period, page numbers and the
 *      "Working copy for CA / legal review" label; its rows are the CSV's rows.
 *   3. Permissions are the register procedure's own: Payroll update (owner, admin, accountant, HR), the add-on, nobody else.
 *   4. A large business (300 employees) paginates into many pages without trouble.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { businessMembers, employees } from "@fintranzact/db";
import { FILING_REGISTERS, PHASE4_REGISTERS } from "@fintranzact/shared";
import { createTenant, createUser, addMember, createBusiness, grantAddon, type TestUser, type TestTenant, type TestBusiness } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { seedChartOfAccounts } from "../../lib/coa-seed.js";
import { entitlementDataOf } from "../../lib/entitlement-error.js";
import { parseCsvTable } from "../../lib/payroll/phase4-pdf.js";
import { readPdf } from "../helpers/pdf-text.js";

const db = () => getTenantTestDb();
type Caller = ReturnType<typeof createTestCaller>;
const callerFor = (u: TestUser, t: TestTenant, b: TestBusiness): Caller =>
  createTestCaller({ userId: u.id, email: u.email, name: u.name ?? null, tenantId: t.id, businessId: b.id });

let tenant: TestTenant;
let biz: TestBusiness;
let ownerC: Caller;
let hrC: Caller;
let accountantC: Caller;
let sellerC: Caller;
let noAddonC: Caller;

async function person(t: TestTenant, b: TestBusiness, email: string, role: "accountant" | "seller" | "hr", bizRole: "admin" | "member") {
  const u = await createUser({ email, name: email.split("@")[0] });
  await addMember(t.id, u.id, role);
  await db().insert(businessMembers).values({ businessId: b.id, userId: u.id, role: bizRole });
  return u;
}

const LABEL = "Working copy for CA / legal review. Formats vary by state.";
const ALL = [...FILING_REGISTERS, ...PHASE4_REGISTERS] as const;
const MONTH = "2026-05";

beforeAll(async () => {
  tenant = await createTenant({ name: "Register PDF Co" });
  const owner = await createUser({ email: "owner@regpdf.in", name: "Ramesh Kumar" });
  await addMember(tenant.id, owner.id, "owner");
  biz = await createBusiness(db(), owner.id, { name: "Register PDF Co", legalName: "Register PDF Co Pvt Ltd" });
  await db().insert(businessMembers).values({ businessId: biz.id, userId: owner.id, role: "admin" });
  const hr = await person(tenant, biz, "hr@regpdf.in", "hr", "member");
  const accountant = await person(tenant, biz, "anita@regpdf.in", "accountant", "member");
  const seller = await person(tenant, biz, "sunil@regpdf.in", "seller", "member");
  await seedChartOfAccounts(db(), biz.id);
  ownerC = callerFor(owner, tenant, biz);
  hrC = callerFor(hr, tenant, biz);
  accountantC = callerFor(accountant, tenant, biz);
  sellerC = callerFor(seller, tenant, biz);

  const tenantB = await createTenant({ name: "No Addon Org" });
  const ownerB = await createUser({ email: "owner@noaddonreg.in", name: "Kiran Mehta" });
  await addMember(tenantB.id, ownerB.id, "owner");
  const bizB = await createBusiness(db(), ownerB.id, { name: "No Addon Org" });
  await db().insert(businessMembers).values({ businessId: bizB.id, userId: ownerB.id, role: "admin" });
  noAddonC = callerFor(ownerB, tenantB, bizB);
  await grantAddon(tenant.id, "payroll");
}, 120_000);

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

describe("setup", () => {
  it("builds three employees and an approved May payroll", async () => {
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
    for (const [code, name, ctc] of [["P1", "Asha Verma", 480000], ["P2", "Bharat Joshi", 600000], ["P3", "Chitra Rao", 360000]] as const) {
      const e = await ownerC.payrollEmployee.create({ employeeCode: code, name, dateOfJoining: "2019-04-01", email: `${code.toLowerCase()}@example.in` });
      await ownerC.payrollSalary.assign({ employeeId: e.id, templateId: t.id, annualCtc: ctc, effectiveFrom: "2025-01-01" });
    }
    await ownerC.payrollLeave.accrue({ month: MONTH });
    const run = await hrC.payrollRun.create({ month: MONTH });
    await hrC.payrollRun.lockAttendance({ id: run.id, fillUnmarked: "present" });
    await hrC.payrollRun.calculate({ id: run.id });
    await hrC.payrollRun.submit({ id: run.id });
    await ownerC.payrollRun.approve({ id: run.id });
  }, 120_000);
});

describe("every register as a PDF", () => {
  const input = (register: (typeof ALL)[number], format?: "csv" | "pdf") => ({ register, month: MONTH, financialYear: 2026, leaveYear: 2026, asOf: "2026-10-07", ...(format ? { format } : {}) });

  it("the CSV is the default and is unchanged: no PDF keys, same file name, same text", async () => {
    for (const register of ALL) {
      const implicit = await accountantC.payrollStatutory.register(input(register));
      const explicit = await accountantC.payrollStatutory.register(input(register, "csv"));
      expect(implicit.contentType, register).toBe("text/csv");
      expect(implicit, register).not.toHaveProperty("base64");
      expect(implicit.filename, register).toMatch(/\.csv$/);
      expect(explicit.text, register).toBe(implicit.text);
      expect(implicit.text.endsWith("\r\n") || implicit.count === 0).toBe(true);
    }
  });

  it("each register as a PDF parses and carries the header row, the business, the period, the page number and the label; the rows are the CSV's", async () => {
    for (const register of ALL) {
      const csv = await accountantC.payrollStatutory.register(input(register, "csv"));
      const r = await accountantC.payrollStatutory.register(input(register, "pdf"));
      expect(r.contentType, register).toBe("application/pdf");
      expect(r.filename, register).toBe(csv.filename.replace(/\.csv$/, ".pdf"));
      expect(r.count, register).toBe(csv.count);
      expect((r as { note?: string }).note, register).toBeTruthy();
      const buf = Buffer.from((r as unknown as { base64: string }).base64, "base64");
      expect(buf.subarray(0, 4).toString(), register).toBe("%PDF");
      const pdf = await readPdf(buf);
      expect(pdf.size[0], register).toBeGreaterThan(pdf.size[1]);
      expect((r as unknown as { pages: number }).pages, register).toBe(pdf.pages);
      const [header = [], ...rows] = parseCsvTable(csv.text);
      const text = pdf.text.join(" ");
      expect(text, register).toContain("Register PDF Co Pvt Ltd");
      expect(text, register).toContain(LABEL);
      expect(text, register).toContain("Page 1 of");
      // Every column header (its first word) is printed; the first and last rows are printed.
      for (const h of header) expect(text, `${register}: ${h}`).toContain(h.split(" ")[0]);
      if (rows.length) {
        expect(text, register).toContain(rows[0]![1]!);
        expect(text, register).toContain(rows[rows.length - 1]![1]!);
      }
    }
    // The period of each is in the title line.
    expect((await readPdf(Buffer.from((await accountantC.payrollStatutory.register(input("wages", "pdf")) as unknown as { base64: string }).base64, "base64"))).text[0]).toContain("May 2026");
    expect((await readPdf(Buffer.from((await accountantC.payrollStatutory.register(input("fnf", "pdf")) as unknown as { base64: string }).base64, "base64"))).text[0]).toContain("FY 2026-27");
  }, 120_000);

  it("permissions are the register procedure's own", async () => {
    // HR, accountant and owner may; a seller may not; an organisation without the add-on may not.
    for (const c of [ownerC, hrC, accountantC]) {
      const r = await c.payrollStatutory.register(input("employment", "pdf"));
      expect(r.contentType).toBe("application/pdf");
    }
    await expect(sellerC.payrollStatutory.register(input("employment", "pdf"))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(sellerC.payrollStatutory.register(input("employment", "csv"))).rejects.toMatchObject({ code: "FORBIDDEN" });
    const err = await noAddonC.payrollStatutory.register(input("employment", "pdf")).then(() => null, (e) => e);
    expect(err).toMatchObject({ code: "FORBIDDEN" });
    expect(entitlementDataOf(err)?.reason).toBe("addon_required");
    // A bad format is refused by the input check.
    await expect(accountantC.payrollStatutory.register({ ...input("employment"), format: "xlsx" } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // A month without an approved run still says so for the PDF.
    await expect(accountantC.payrollStatutory.register({ register: "wages", month: "2026-03", format: "pdf" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("a large business", () => {
  it("300 employees: the employment register paginates into many pages, quickly, and every employee is in it", async () => {
    await db().insert(employees).values(
      Array.from({ length: 300 }, (_, i) => ({ businessId: biz.id, employeeCode: `L${String(i + 1).padStart(4, "0")}`, name: `Large Fixture Employee ${i + 1}`, dateOfJoining: "2022-04-01" })),
    );
    const started = Date.now();
    const r = await accountantC.payrollStatutory.register({ register: "employment", format: "pdf" });
    expect(Date.now() - started).toBeLessThan(20_000);
    expect(r.count).toBe(303);
    const buf = Buffer.from((r as unknown as { base64: string }).base64, "base64");
    expect(buf.length).toBeLessThan(5 * 1024 * 1024);
    const pdf = await readPdf(buf);
    expect(pdf.pages).toBeGreaterThan(5);
    const text = pdf.text.join(" ");
    expect(text).toContain("L0001");
    expect(text).toContain("L0300");
    expect(text).toContain("Large Fixture Employee 150");
    for (const [i, t] of pdf.text.entries()) {
      expect(t).toContain(`Page ${i + 1} of ${pdf.pages}`);
      expect(t).toContain("Employee Code");
      expect(t).toContain(LABEL);
    }
    // The CSV of the same register still has every row, in full.
    const csv = await accountantC.payrollStatutory.register({ register: "employment" });
    expect(parseCsvTable(csv.text)).toHaveLength(304);
  }, 120_000);
});
