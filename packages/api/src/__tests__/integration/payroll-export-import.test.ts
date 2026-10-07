/**
 * payroll-export-import.test.ts — payroll data survives the self-export /
 * self-import round trip (employees with their identity and bank numbers, the
 * manager link, salary assignments, attendance, leave, an approved and paid run
 * with its payslips and journal links), and a file WITHOUT the sensitive columns
 * still imports (they are optional in the row schemas). Phase 2: the statutory
 * registrations, rates, declarations and payments round-trip too, and an export
 * from before Phase 2 (no statutory columns) still imports with the defaults.
 */

import { describe, it, expect, afterAll } from "vitest";
import { Hono } from "hono";
import { createHash } from "node:crypto";
import zlib from "node:zlib";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import tarStream from "tar-stream";
import { eq } from "drizzle-orm";
import {
  bankAccounts, businessMembers, employees, employeeTaxDeclarations, payrollRunLines, payrollRuns, payrollSettings, payrollStatutoryPayments, payrollStatutorySettings, payslips,
} from "@fintranzact/db";
import { createTenant, createUser, addMember, createBusiness, createBankAccount, grantAddon } from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import { seedChartOfAccounts } from "../../lib/coa-seed.js";
import { registerExportRoute } from "../../http/exportStream.js";
import { registerImportRoute } from "../../http/importStream.js";

const db = () => getTenantTestDb();
const app = new Hono();
registerExportRoute(app);
registerImportRoute(app);

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

async function unpack(buf: Buffer): Promise<Map<string, Buffer>> {
  const out = new Map<string, Buffer>();
  const tarBuf = await promisify(zlib.gunzip)(buf);
  await new Promise<void>((resolve, reject) => {
    const extract = tarStream.extract();
    extract.on("entry", (header, stream, next) => {
      const chunks: Buffer[] = [];
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("end", () => {
        out.set(header.name, Buffer.concat(chunks));
        next();
      });
      stream.on("error", reject);
    });
    extract.on("finish", resolve);
    extract.on("error", reject);
    Readable.from([tarBuf]).pipe(extract);
  });
  return out;
}

describe("payroll in a self-export", () => {
  it("round-trips a business with payroll data and imports a file that lacks the sensitive columns", async () => {
    // ── A business with payroll data, built through the API ──
    const tenant = await createTenant({ name: "Export Payroll Co" });
    const owner = await createUser({ email: "owner@exportpayroll.in", name: "Export Owner" });
    await addMember(tenant.id, owner.id, "owner");
    const admin = await createUser({ email: "admin@exportpayroll.in", name: "Second Admin" });
    await addMember(tenant.id, admin.id, "admin");
    const biz = await createBusiness(db(), owner.id, { name: "Export Payroll Co" });
    await db().insert(businessMembers).values([{ businessId: biz.id, userId: owner.id, role: "admin" }, { businessId: biz.id, userId: admin.id, role: "admin" }]);
    await seedChartOfAccounts(db(), biz.id);
    const bank = await createBankAccount(db(), biz.id, { accountType: "current" });
    await grantAddon(tenant.id, "payroll");
    const c = createTestCaller({ userId: owner.id, email: owner.email, name: owner.name, tenantId: tenant.id, businessId: biz.id });
    const c2 = createTestCaller({ userId: admin.id, email: admin.email, name: admin.name, tenantId: tenant.id, businessId: biz.id });

    await c.payrollSalary.componentSeedDefaults();
    await c.payrollLeave.typeSeedDefaults();
    const comps = await c.payrollSalary.componentList();
    const basic = comps.find((x) => x.code === "BASIC")!;
    const special = comps.find((x) => x.code === "SPECIAL")!;
    const tpl = await c.payrollSalary.templateCreate({ name: "Staff", sampleAnnualCtc: 360000, lines: [{ componentId: basic.id, calcType: "percent_of_ctc", value: 60 }, { componentId: special.id, calcType: "balance", value: 0 }] });
    const boss = await c.payrollEmployee.create({ employeeCode: "B1", name: "Boss Person", dateOfJoining: "2026-01-01", pan: "ABCDE1234F", aadhaar: "234567890123", bankAccountNumber: "50100123456789", bankIfsc: "HDFC0001234" });
    const worker = await c.payrollEmployee.create({ employeeCode: "W1", name: "Worker Person", dateOfJoining: "2026-01-01", managerId: boss.id, bankAccountNumber: "123456789012", bankIfsc: "ICIC0000123" });
    for (const e of [boss, worker]) await c.payrollSalary.assign({ employeeId: e.id, templateId: tpl.id, annualCtc: 360000, effectiveFrom: "2026-01-01" });
    // Phase 2: registrations, an employee's PF settings, a declaration and the year's rates.
    await c.payrollStatutory.updateBusinessSettings({ pfRegistered: true, pfEstablishmentCode: "MHBAN0012345000", esiRegistered: false, ptStates: ["27"], tdsEnabled: false });
    await c.payrollStatutory.employeeUpdate({ employeeId: worker.id, vpfPercent: 5, epsEligible: false });
    await c.payrollStatutory.saveDeclaration({ employeeId: worker.id, financialYear: 2026, amounts: { sec80C: 50000, sec80D: 0, hraExemption: 0, homeLoanInterest: 0, otherDeductions: 0, previousEmployerIncome: 0, previousEmployerTds: 0 } });
    const rates = (await c.payrollStatutory.settings({ financialYear: 2026 })).rates;
    await c.payrollStatutory.saveRates({ financialYear: 2026, rates, verifiedNote: "Checked with the CA" });
    await c.payrollLeave.accrue({ month: "2026-07" });
    const run = await c.payrollRun.create({ month: "2026-07" });
    await c.payrollRun.lockAttendance({ id: run.id, fillUnmarked: "present" });
    await c.payrollRun.calculate({ id: run.id });
    await c.payrollRun.submit({ id: run.id });
    await c2.payrollRun.approve({ id: run.id });
    await c.payrollRun.post({ id: run.id });
    const pfDue = (await c.payrollStatutory.dues({ financialYear: 2026 })).rows.find((r) => r.kind === "pf")!;
    await c.payrollStatutory.recordPayment({ runId: run.id, kind: "pf", amount: Number(pfDue.accrued), paidOn: "2026-08-10", bankAccountId: bank.id, challanNumber: "TRRN-77" });
    await c.payrollRun.markPaid({ runId: run.id, bankAccountId: bank.id, paidOn: "2026-08-01" });
    const before = await c.payrollRun.get({ id: run.id });

    // ── Export ──
    const { token } = await c.selfExport.request({ tenantId: tenant.id });
    const exportRes = await app.request(`http://localhost:3000/api/export/${tenant.id}?token=${encodeURIComponent(token)}`, { method: "GET" });
    expect(exportRes.status).toBe(200);
    const files = await unpack(Buffer.from(await exportRes.arrayBuffer()));
    const manifest = JSON.parse(files.get("manifest.json")!.toString("utf8")) as { rowCounts: Record<string, number> };
    expect(manifest.rowCounts).toMatchObject({ employees: 2, payroll_runs: 1, payroll_run_lines: 2, payslips: 2, salary_templates: 1, salary_template_lines: 2, employee_salary_assignments: 2, payroll_statutory_settings: 1, employee_tax_declarations: 1, payroll_statutory_payments: 1 });
    expect(manifest.rowCounts.leave_ledger).toBeGreaterThan(0);
    expect(manifest.rowCounts.attendance_records).toBeGreaterThan(0);

    // A copy of the file with every sensitive column removed (an older or hand-trimmed export).
    const strip = (name: string, keys: string[]) => {
      const rows = files.get(name)!.toString("utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
      for (const r of rows) for (const k of keys) delete r[k];
      return Buffer.from(rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
    };
    const trimmed = new Map(files);
    trimmed.set("employees.ndjson", strip("employees.ndjson", ["pan", "aadhaar", "uan", "esicNumber", "bankAccountNumber", "bankIfsc"]));
    trimmed.set("payroll_run_lines.ndjson", strip("payroll_run_lines.ndjson", ["bankAccountNumber", "bankIfsc", "bankAccountName", "statutory"]));
    // ...and the Phase 2 columns an export from before the statutory release does not have.
    trimmed.set("employees.ndjson", strip("employees.ndjson", ["pan", "aadhaar", "uan", "esicNumber", "bankAccountNumber", "bankIfsc", "pfApplicable", "pfExcluded", "epsEligible", "pfOnActualWages", "vpfPercent", "internationalWorker", "pfJoinDate", "esiApplicable"]));
    trimmed.set("payroll_settings.ndjson", strip("payroll_settings.ndjson", ["pfRegistered", "pfEstablishmentCode", "esiRegistered", "esiCode", "ptStates", "lwfState", "tdsEnabled"]));
    trimmed.set("payroll_runs.ndjson", strip("payroll_runs.ndjson", ["statutory"]));
    // The manifest carries each file's checksum: refresh it for the two files that changed.
    const trimmedManifest = JSON.parse(files.get("manifest.json")!.toString("utf8")) as { files: Record<string, { sha256: string; rows: number; bytes: number }> };
    for (const name of ["employees.ndjson", "payroll_run_lines.ndjson", "payroll_settings.ndjson", "payroll_runs.ndjson"]) {
      const content = trimmed.get(name)!;
      trimmedManifest.files[name] = { ...trimmedManifest.files[name]!, sha256: createHash("sha256").update(content).digest("hex"), bytes: content.length };
    }
    trimmed.set("manifest.json", Buffer.from(JSON.stringify(trimmedManifest)));

    async function pack(entries: Map<string, Buffer>): Promise<Buffer> {
      const pk = tarStream.pack();
      const chunks: Buffer[] = [];
      const done = new Promise<Buffer>((resolve, reject) => {
        pk.on("data", (d: Buffer) => chunks.push(d));
        pk.on("end", () => resolve(Buffer.concat(chunks)));
        pk.on("error", reject);
      });
      for (const [name, content] of entries) {
        await new Promise<void>((res, rej) => pk.entry({ name, size: content.length }, content, (err) => (err ? rej(err) : res())));
      }
      pk.finalize();
      return promisify(zlib.gzip)(await done);
    }

    async function importInto(archive: Buffer) {
      await truncateAllTables();
      const tgtOwner = await createUser({ email: `target.${Date.now()}@exportpayroll.in`, name: "Target Owner" });
      const tgtTenant = await createTenant({ name: "Target Co" });
      await addMember(tgtTenant.id, tgtOwner.id, "owner");
      const caller = createTestCaller({ userId: tgtOwner.id, email: tgtOwner.email, name: tgtOwner.name, tenantId: tgtTenant.id, businessId: "" });
      const { token: importToken } = await caller.selfImport.request({ tenantId: tgtTenant.id });
      const ab = archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength);
      const res = await app.request(`http://localhost:3000/api/selfImport/${tgtTenant.id}?token=${encodeURIComponent(importToken)}`, {
        method: "POST",
        headers: { "content-type": "application/gzip" },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        body: ab as any,
      });
      return { res, body: (await res.json()) as { ok: boolean; rowsInserted: Record<string, number> } };
    }

    // ── Import the trimmed file first: succeeds, without the sensitive columns ──
    const first = await importInto(await pack(trimmed));
    expect(first.res.status).toBe(200);
    expect(first.body.rowsInserted).toMatchObject({ employees: 2, payroll_runs: 1, payroll_run_lines: 2, payslips: 2 });
    const noSecrets = await db().select().from(employees);
    expect(noSecrets.every((e) => e.pan === null && e.bankAccountNumber === null)).toBe(true);
    // An export from before Phase 2 imports with the defaults: nothing registered, PF applicable.
    expect(noSecrets.every((e) => e.pfApplicable && !e.pfExcluded && e.epsEligible && e.vpfPercent === "0.00")).toBe(true);
    const [oldSettings] = await db().select().from(payrollSettings);
    expect(oldSettings).toMatchObject({ pfRegistered: false, esiRegistered: false, ptStates: [], tdsEnabled: false });
    expect((await db().select().from(payrollRuns))[0]!.statutory).toBeNull();

    // ── Then the full file: everything comes back, including the manager link and the sensitive numbers ──
    const full = await importInto(await pack(files));
    expect(full.res.status).toBe(200);
    expect(full.body.rowsInserted).toMatchObject({ employees: 2, payroll_runs: 1, payroll_run_lines: 2, payslips: 2, employee_salary_assignments: 2 });
    const emps = await db().select().from(employees);
    const importedBoss = emps.find((e) => e.employeeCode === "B1")!;
    const importedWorker = emps.find((e) => e.employeeCode === "W1")!;
    expect(importedBoss).toMatchObject({ pan: "ABCDE1234F", aadhaar: "234567890123", bankAccountNumber: "50100123456789" });
    expect(importedWorker.managerId).toBe(importedBoss.id);
    const [importedRun] = await db().select().from(payrollRuns);
    expect(importedRun).toMatchObject({ month: "2026-07", status: "paid", netTotal: before.run.netTotal, grossTotal: before.run.grossTotal });
    expect(importedRun!.accrualJournalEntryId).toBeTruthy();
    expect(importedRun!.paymentJournalEntryId).toBeTruthy();
    expect(await db().select().from(payslips).where(eq(payslips.runId, importedRun!.id))).toHaveLength(2);
    expect((await db().select().from(bankAccounts)).length).toBe(1);

    // Phase 2 data came back: registrations, the employee's PF settings, the frozen statutory working, rates, declaration and payment.
    expect(importedWorker).toMatchObject({ vpfPercent: "5.00", epsEligible: false, pfApplicable: true });
    const [settings] = await db().select().from(payrollSettings);
    expect(settings).toMatchObject({ pfRegistered: true, pfEstablishmentCode: "MHBAN0012345000", esiRegistered: false, ptStates: ["27"], tdsEnabled: false });
    expect(importedRun!.statutory).toMatchObject({ financialYear: 2026, flags: { pfRegistered: true, ptStates: ["27"] } });
    const lines = await db().select().from(payrollRunLines).where(eq(payrollRunLines.runId, importedRun!.id));
    expect(lines.every((l) => (l.statutory as { pf: { member: boolean } }).pf.member)).toBe(true);
    expect(lines.flatMap((l) => l.components).some((cmp) => cmp.statutoryKind === "pf_employee")).toBe(true);
    expect(await db().select().from(payrollStatutorySettings)).toMatchObject([{ financialYear: 2026, verifiedNote: "Checked with the CA" }]);
    expect(await db().select().from(employeeTaxDeclarations)).toMatchObject([{ financialYear: 2026, amounts: { sec80C: 50000 } }]);
    expect(await db().select().from(payrollStatutoryPayments)).toMatchObject([{ kind: "pf", challanNumber: "TRRN-77", runId: importedRun!.id }]);
  }, 120_000);
});
