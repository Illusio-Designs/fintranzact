/**
 * Statutory files and registers built from approved payroll runs. Everything
 * is generated from the FROZEN lines of approved runs (their statutory working
 * and their components), never from today's settings, so a file always matches
 * the payslips. Nothing is filed with any government system.
 *
 * The files contain identity numbers in full (UAN, ESIC number, PAN). They are
 * returned over tRPC to a caller with Payroll "update" and their contents are
 * never logged.
 */

import { and, asc, eq, inArray } from "drizzle-orm";
import { decryptSensitive } from "../field-encryption.js";
import {
  businesses,
  employeeTaxDeclarations,
  employees,
  leaveLedger,
  leaveTypes,
  payrollRunLines,
  payrollRuns,
  payrollStatutoryPayments,
  type TenantDatabase,
} from "@fintranzact/db";
import {
  EMPTY_DECLARATION,
  build24q,
  buildAttendanceRegister,
  buildBonusRegister,
  buildEcr,
  buildEsicCsv,
  buildForm16Data,
  buildGratuityRegister,
  buildLeaveRegister,
  buildStateSheets,
  buildWageRegister,
  computeBonusBasis,
  computeGratuity,
  datesOfMonth,
  form16Csv,
  formatPayrollMonth,
  fyLabel,
  leaveYearOf,
  monthEnd,
  monthsOfFy,
  monthsOfQuarter,
  rupeesToPaise,
  taxDeclarationSchema,
  paiseToRupees,
  WAGE_CATEGORIES,
  type Form16Data,
  type StatutoryDetails,
  type StatutoryRates,
} from "@fintranzact/shared";
import { badRequest, notFound } from "./access.js";
import { attendanceSummaries } from "./run.js";
import { loadMonthAttendance, loadPayrollSettings } from "./data.js";
import { loadStatutoryRates } from "./statutory.js";

type Reader = Pick<TenantDatabase, "select">;
type RunRow = typeof payrollRuns.$inferSelect;
type LineRow = typeof payrollRunLines.$inferSelect;
type EmployeeRow = typeof employees.$inferSelect;

const FINAL = ["approved", "posted", "paid"];

export interface FileResult {
  filename: string;
  contentType: "text/plain" | "text/csv";
  text: string;
  count: number;
  /** Employees left out of the file, with the reason (no UAN, no ESIC number...). */
  skipped: Array<{ employeeCode: string; reason: string }>;
  /** Check this against the portal's current template before uploading. */
  note: string;
}

async function loadFinalRun(db: Reader, businessId: string, runId: string): Promise<{ run: RunRow; lines: LineRow[]; emps: Map<string, EmployeeRow> }> {
  const [run] = await db.select().from(payrollRuns).where(and(eq(payrollRuns.id, runId), eq(payrollRuns.businessId, businessId))).limit(1);
  if (!run) throw notFound("Payroll run");
  if (!FINAL.includes(run.status)) throw badRequest("Statutory files are available once the payroll run is approved.");
  const lines = await db.select().from(payrollRunLines).where(eq(payrollRunLines.runId, run.id)).orderBy(asc(payrollRunLines.employeeCode));
  const emps = new Map<string, EmployeeRow>();
  if (lines.length) {
    for (const e of await db.select().from(employees).where(and(eq(employees.businessId, businessId), inArray(employees.id, lines.map((l) => l.employeeId))))) emps.set(e.id, e);
  }
  return { run, lines, emps };
}

function flagsOf(run: RunRow): { pfRegistered: boolean; esiRegistered: boolean; ptStates: string[]; lwfState: string | null; tdsEnabled: boolean } {
  const f = (run.statutory?.flags ?? {}) as Record<string, unknown>;
  return {
    pfRegistered: !!f.pfRegistered,
    esiRegistered: !!f.esiRegistered,
    ptStates: Array.isArray(f.ptStates) ? (f.ptStates as string[]) : [],
    lwfState: (f.lwfState as string | null) ?? null,
    tdsEnabled: !!f.tdsEnabled,
  };
}

const details = (l: LineRow) => (l.statutory ?? null) as StatutoryDetails | null;
const amountOf = (l: LineRow, ...kinds: string[]) => l.components.filter((c) => c.statutoryKind && kinds.includes(c.statutoryKind)).reduce((s, c) => s + rupeesToPaise(c.amount), 0);

// ── PF ECR ───────────────────────────────────────────────────────────────────

export async function buildEcrFile(db: Reader, businessId: string, runId: string): Promise<FileResult & { totals: { epfEe: number; eps: number; epfEr: number }; csv: string }> {
  const { run, lines, emps } = await loadFinalRun(db, businessId, runId);
  if (!flagsOf(run).pfRegistered) throw badRequest("This payroll run was calculated for a business with no PF registration, so there is no PF file.");
  const rows = lines.flatMap((l) => {
    const pf = details(l)?.pf;
    if (!pf?.member) return [];
    const e = emps.get(l.employeeId);
    return [
      {
        uan: e?.uan ?? null,
        name: l.employeeName,
        employeeCode: l.employeeCode,
        grossWagesPaise: rupeesToPaise(l.grossEarnings),
        epfWagesPaise: pf.epfWagesPaise,
        epsWagesPaise: pf.epsWagesPaise,
        edliWagesPaise: pf.edliWagesPaise,
        epfEmployeePaise: amountOf(l, "pf_employee", "vpf"),
        epsPaise: amountOf(l, "eps_employer"),
        epfDiffPaise: amountOf(l, "pf_employer"),
        lopDays: Number(l.lopDays),
      },
    ];
  });
  const ecr = buildEcr(rows);
  return {
    filename: `ECR-${run.month}.txt`,
    contentType: "text/plain",
    text: ecr.text,
    csv: ecr.csv,
    count: ecr.count,
    skipped: ecr.skipped,
    totals: ecr.totals,
    note: "ECR text in the EPFO ECR 2.0 layout (#~# separated). Check it against the EPFO portal's current template and run the portal's validation before uploading. Fintranzact does not file anything.",
  };
}

// ── ESIC ─────────────────────────────────────────────────────────────────────

export async function buildEsicFile(db: Reader, businessId: string, runId: string): Promise<FileResult> {
  const { run, lines, emps } = await loadFinalRun(db, businessId, runId);
  if (!flagsOf(run).esiRegistered) throw badRequest("This payroll run was calculated for a business with no ESI registration, so there is no ESIC file.");
  const rows = lines.flatMap((l) => {
    const esi = details(l)?.esi;
    if (!esi?.covered) return [];
    const e = emps.get(l.employeeId);
    const exits = !!l.isFinalSettlement && !!e?.lastWorkingDay;
    return [
      { ipNumber: e?.esicNumber ?? null, name: l.employeeName, employeeCode: l.employeeCode, paidDays: Number(l.paidDays), wagesPaise: esi.wagesPaise, lastWorkingDay: exits ? e!.lastWorkingDay : null },
    ];
  });
  const f = buildEsicCsv(rows);
  return {
    filename: `ESIC-${run.month}.csv`,
    contentType: "text/csv",
    text: f.csv,
    count: f.count,
    skipped: f.skipped,
    note: "Columns of ESIC's monthly contribution bulk-upload template as we know them. Check them against the ESIC portal's current template before uploading. Fintranzact does not file anything.",
  };
}

// ── PT and LWF sheets ────────────────────────────────────────────────────────

export async function buildStateSheetFiles(db: Reader, businessId: string, runId: string, kind: "pt" | "lwf") {
  const { run, lines } = await loadFinalRun(db, businessId, runId);
  const flags = flagsOf(run);
  if (kind === "pt" && flags.ptStates.length === 0) throw badRequest("This payroll run was calculated with no professional tax state, so there is no PT sheet.");
  if (kind === "lwf" && !flags.lwfState) throw badRequest("This payroll run was calculated with no labour welfare fund state, so there is no LWF sheet.");
  const rows = lines.flatMap((l) => {
    const d = details(l);
    const state = kind === "pt" ? d?.pt?.state : d?.lwf?.state;
    if (!state) return [];
    return [
      {
        state,
        employeeCode: l.employeeCode,
        name: l.employeeName,
        grossPaise: rupeesToPaise(l.grossEarnings),
        employeePaise: kind === "pt" ? amountOf(l, "professional_tax") : amountOf(l, "lwf_employee"),
        employerPaise: kind === "lwf" ? amountOf(l, "lwf_employer") : 0,
      },
    ];
  });
  const sheets = buildStateSheets(kind, run.month, rows);
  return {
    month: run.month,
    kind,
    sheets: sheets.map((s) => ({
      state: s.state,
      filename: `${kind.toUpperCase()}-${s.state}-${run.month}.csv`,
      contentType: "text/csv" as const,
      text: s.csv,
      count: s.count,
      employeeTotal: paiseToRupees(s.totalEmployeePaise),
      employerTotal: paiseToRupees(s.totalEmployerPaise),
    })),
    note: "A working sheet for the state's return, to be checked by your CA. It is not a government template and nothing is filed by Fintranzact.",
  };
}

// ── TDS: Form 24Q working data ───────────────────────────────────────────────

async function finalRunsOfMonths(db: Reader, businessId: string, months: string[]) {
  return db.select().from(payrollRuns).where(and(eq(payrollRuns.businessId, businessId), inArray(payrollRuns.month, months), inArray(payrollRuns.status, FINAL))).orderBy(asc(payrollRuns.month));
}

export async function buildForm24qFile(db: Reader, businessId: string, fyStartYear: number, quarter: 1 | 2 | 3 | 4, tan: string | null) {
  const runs = await finalRunsOfMonths(db, businessId, monthsOfQuarter(fyStartYear, quarter));
  const lines = runs.length ? await db.select().from(payrollRunLines).where(inArray(payrollRunLines.runId, runs.map((r) => r.id))) : [];
  const empIds = [...new Set(lines.map((l) => l.employeeId))];
  const emps = empIds.length ? await db.select().from(employees).where(and(eq(employees.businessId, businessId), inArray(employees.id, empIds))) : [];
  const byEmp = new Map(emps.map((e) => [e.id, e]));
  const deductees = empIds.map((id) => {
    const e = byEmp.get(id)!;
    return {
      employeeCode: e.employeeCode,
      name: e.name,
      pan: decryptSensitive(e.pan),
      months: runs.flatMap((r) => {
        const l = lines.find((x) => x.runId === r.id && x.employeeId === id);
        return l ? [{ month: r.month, grossPaise: rupeesToPaise(l.grossEarnings), tdsPaise: amountOf(l, "income_tax_tds"), deductedOn: monthEnd(r.month) }] : [];
      }),
    };
  });
  const pays = runs.length
    ? await db.select().from(payrollStatutoryPayments).where(and(eq(payrollStatutoryPayments.businessId, businessId), eq(payrollStatutoryPayments.kind, "tds"), inArray(payrollStatutoryPayments.runId, runs.map((r) => r.id))))
    : [];
  const monthOfRun = new Map(runs.map((r) => [r.id, r.month]));
  const challans = pays.map((p) => ({ month: monthOfRun.get(p.runId) ?? "", amountPaise: rupeesToPaise(p.amount), challanNumber: p.challanNumber, challanDate: p.challanDate, paidOn: p.paidOn }));
  const q = build24q({ fyStartYear, quarter, tan, deductees, challans });
  return {
    fyStartYear,
    quarter,
    deducteeFilename: `24Q-${fyLabel(fyStartYear)}-Q${quarter}-deductees.csv`,
    challanFilename: `24Q-${fyLabel(fyStartYear)}-Q${quarter}-challans.csv`,
    deducteeCsv: q.deducteeCsv,
    challanCsv: q.challanCsv,
    totalTds: paiseToRupees(q.totalTdsPaise),
    totalChallan: paiseToRupees(q.totalChallanPaise),
    rows: q.rows,
    note: "Working data for Form 24Q, to be checked by your CA and prepared in the Income Tax Department's return preparation utility. It is not an FVU file and is not filed by Fintranzact.",
  };
}

// ── Form 16 working copy ─────────────────────────────────────────────────────

export async function buildForm16(db: Reader, businessId: string, fyStartYear: number, employeeId: string): Promise<{ data: Form16Data; csv: string; businessName: string; tan: string | null; rates: StatutoryRates }> {
  const [emp] = await db.select().from(employees).where(and(eq(employees.id, employeeId), eq(employees.businessId, businessId))).limit(1);
  if (!emp) throw notFound("Employee");
  const runs = await finalRunsOfMonths(db, businessId, monthsOfFy(fyStartYear));
  const lines = runs.length ? await db.select().from(payrollRunLines).where(and(eq(payrollRunLines.employeeId, employeeId), inArray(payrollRunLines.runId, runs.map((r) => r.id)))) : [];
  if (lines.length === 0) throw badRequest("There is no approved payroll for this employee in that financial year.");
  const monthOfRun = new Map(runs.map((r) => [r.id, r.month]));
  const months = lines.map((l) => ({
    month: monthOfRun.get(l.runId)!,
    grossPaise: rupeesToPaise(l.grossEarnings),
    tdsPaise: amountOf(l, "income_tax_tds"),
    professionalTaxPaise: amountOf(l, "professional_tax"),
    pfEmployeePaise: amountOf(l, "pf_employee", "vpf"),
  }));
  const [decl] = await db
    .select()
    .from(employeeTaxDeclarations)
    .where(and(eq(employeeTaxDeclarations.employeeId, employeeId), eq(employeeTaxDeclarations.financialYear, fyStartYear)))
    .limit(1);
  const parsed = decl ? taxDeclarationSchema.safeParse(decl.amounts) : null;
  const loaded = await loadStatutoryRates(db, businessId, fyStartYear);
  const data = buildForm16Data({
    fyStartYear,
    regime: emp.taxRegime === "old" ? "old" : "new",
    employee: { code: emp.employeeCode, name: emp.name, pan: decryptSensitive(emp.pan) },
    months,
    declaration: parsed?.success ? parsed.data : EMPTY_DECLARATION,
    rates: loaded.rates,
  });
  const [biz] = await db.select({ name: businesses.name, legalName: businesses.legalName, tan: businesses.tan }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
  return { data, csv: form16Csv(data), businessName: biz?.legalName || biz?.name || "", tan: biz?.tan ?? null, rates: loaded.rates };
}

// ── Registers ────────────────────────────────────────────────────────────────

export async function buildWageRegisterFile(db: Reader, businessId: string, month: string) {
  const [run] = await db.select().from(payrollRuns).where(and(eq(payrollRuns.businessId, businessId), eq(payrollRuns.month, month), inArray(payrollRuns.status, FINAL))).limit(1);
  if (!run) throw badRequest(`There is no approved payroll run for ${formatPayrollMonth(month)}.`);
  const lines = await db.select().from(payrollRunLines).where(eq(payrollRunLines.runId, run.id)).orderBy(asc(payrollRunLines.employeeCode));
  const text = buildWageRegister(
    month,
    lines.map((l) => ({
      employeeCode: l.employeeCode,
      name: l.employeeName,
      paidDays: l.paidDays,
      lopDays: l.lopDays,
      overtimeHours: l.overtimeHours,
      components: l.components.map((c) => ({ name: c.name, type: c.type, amountPaise: rupeesToPaise(c.amount) })),
      grossPaise: rupeesToPaise(l.grossEarnings),
      deductionsPaise: rupeesToPaise(l.totalDeductions),
      netPaise: rupeesToPaise(l.netPay),
    })),
  );
  return { filename: `wages-register-${month}.csv`, contentType: "text/csv" as const, text, count: lines.length };
}

export async function buildAttendanceRegisterFile(db: TenantDatabase, businessId: string, month: string) {
  const summaries = await attendanceSummaries(db, businessId, month);
  const records = await loadMonthAttendance(db, businessId, month);
  const byEmp = new Map<string, Record<string, string>>();
  for (const r of records) {
    const m = byEmp.get(r.employeeId) ?? {};
    m[r.date] = r.status;
    byEmp.set(r.employeeId, m);
  }
  const days = datesOfMonth(month);
  const rows = summaries.map((s) => {
    const marked = byEmp.get(s.employee.id) ?? {};
    const byDate: Record<string, string> = {};
    for (const d of days) {
      if (d < s.employee.dateOfJoining || (s.employee.lastWorkingDay && d > s.employee.lastWorkingDay)) continue;
      if (marked[d]) byDate[d] = marked[d]!;
      else if (s.holidayDates.includes(d)) byDate[d] = "holiday";
      else if (s.weeklyOffDays.includes(new Date(`${d}T00:00:00Z`).getUTCDay())) byDate[d] = "week_off";
    }
    return { employeeCode: s.employee.employeeCode, name: s.employee.name, byDate, paidDays: s.summary.paidDays.toFixed(1), lopDays: s.summary.lopDays.toFixed(1) };
  });
  return { filename: `attendance-register-${month}.csv`, contentType: "text/csv" as const, text: buildAttendanceRegister(month, days, rows), count: rows.length };
}

export async function buildLeaveRegisterFile(db: TenantDatabase, businessId: string, leaveYear?: number) {
  const settings = await loadPayrollSettings(db, businessId);
  const year = leaveYear ?? leaveYearOf(new Date().toISOString().slice(0, 10), settings.leaveYearStartMonth);
  const rows = await db
    .select({
      employeeId: leaveLedger.employeeId,
      leaveTypeId: leaveLedger.leaveTypeId,
      kind: leaveLedger.kind,
      days: leaveLedger.days,
    })
    .from(leaveLedger)
    .where(and(eq(leaveLedger.businessId, businessId), eq(leaveLedger.leaveYear, year)));
  const [emps, types] = await Promise.all([
    db.select({ id: employees.id, code: employees.employeeCode, name: employees.name }).from(employees).where(eq(employees.businessId, businessId)).orderBy(asc(employees.employeeCode)),
    db.select({ id: leaveTypes.id, code: leaveTypes.code }).from(leaveTypes).where(eq(leaveTypes.businessId, businessId)),
  ]);
  const typeCode = new Map(types.map((t) => [t.id, t.code]));
  const acc = new Map<string, { opening: number; accrued: number; taken: number; encashed: number; lapsed: number; balance: number }>();
  for (const r of rows) {
    const key = `${r.employeeId}|${r.leaveTypeId}`;
    const a = acc.get(key) ?? { opening: 0, accrued: 0, taken: 0, encashed: 0, lapsed: 0, balance: 0 };
    const d = Number(r.days);
    a.balance += d;
    if (r.kind === "carry_forward") a.opening += d;
    else if (r.kind === "accrual") a.accrued += d;
    else if (r.kind === "taken" || r.kind === "cancelled") a.taken -= d;
    else if (r.kind === "encashment") a.encashed -= d;
    else a.lapsed -= d;
    acc.set(key, a);
  }
  const out = emps.flatMap((e) =>
    types.flatMap((t) => {
      const a = acc.get(`${e.id}|${t.id}`);
      return a ? [{ employeeCode: e.code, name: e.name, leaveType: typeCode.get(t.id) ?? "", ...a }] : [];
    }),
  );
  return { filename: `leave-register-${year}.csv`, contentType: "text/csv" as const, text: buildLeaveRegister(`${year}`, out), count: out.length };
}

export async function buildBonusRegisterFile(db: Reader, businessId: string, fyStartYear: number) {
  const loaded = await loadStatutoryRates(db, businessId, fyStartYear);
  const runs = await finalRunsOfMonths(db, businessId, monthsOfFy(fyStartYear));
  const lines = runs.length ? await db.select().from(payrollRunLines).where(inArray(payrollRunLines.runId, runs.map((r) => r.id))) : [];
  const byEmp = new Map<string, LineRow[]>();
  for (const l of lines) byEmp.set(l.employeeId, [...(byEmp.get(l.employeeId) ?? []), l]);
  const rows = [...byEmp.values()].map((ls) => ({
    employeeCode: ls[0]!.employeeCode,
    name: ls[0]!.employeeName,
    monthsWorked: ls.length,
    basis: computeBonusBasis(
      ls.map((l) => l.components.filter((c) => c.type === "earning" && c.source !== "adjustment" && (c.isWage || (WAGE_CATEGORIES as readonly string[]).includes(c.category))).reduce((s, c) => s + rupeesToPaise(c.amount), 0)),
      loaded.rates.bonus,
    ),
  }));
  rows.sort((a, b) => a.employeeCode.localeCompare(b.employeeCode));
  return { filename: `bonus-register-${fyLabel(fyStartYear)}.csv`, contentType: "text/csv" as const, text: buildBonusRegister(fyStartYear, rows), count: rows.length };
}

export async function buildGratuityRegisterFile(db: Reader, businessId: string, asOf: string, fyStartYear: number) {
  const loaded = await loadStatutoryRates(db, businessId, fyStartYear);
  const emps = await db.select().from(employees).where(and(eq(employees.businessId, businessId), eq(employees.status, "active"))).orderBy(asc(employees.employeeCode));
  const runs = await db.select().from(payrollRuns).where(and(eq(payrollRuns.businessId, businessId), inArray(payrollRuns.status, FINAL))).orderBy(asc(payrollRuns.month));
  const lastRun = new Map<string, string>();
  const latestLines = runs.length ? await db.select().from(payrollRunLines).where(inArray(payrollRunLines.runId, runs.map((r) => r.id))) : [];
  const monthOfRun = new Map(runs.map((r) => [r.id, r.month]));
  const lastWages = new Map<string, number>();
  for (const l of latestLines) {
    const m = monthOfRun.get(l.runId)!;
    if ((lastRun.get(l.employeeId) ?? "") > m) continue;
    lastRun.set(l.employeeId, m);
    lastWages.set(
      l.employeeId,
      l.components.filter((c) => c.type === "earning" && c.source === "structure" && (c.category === "basic" || c.category === "da")).reduce((s, c) => s + rupeesToPaise(c.full), 0),
    );
  }
  const rows = emps.map((e) => {
    const wages = lastWages.get(e.id) ?? 0;
    return { employeeCode: e.employeeCode, name: e.name, joinedOn: e.dateOfJoining, lastDrawnWagesPaise: wages, result: computeGratuity({ joinedOn: e.dateOfJoining, asOf, lastDrawnWagesPaise: wages, rules: loaded.rates.gratuity }) };
  });
  return { filename: `gratuity-register-${asOf}.csv`, contentType: "text/csv" as const, text: buildGratuityRegister(asOf, rows), count: rows.length };
}
