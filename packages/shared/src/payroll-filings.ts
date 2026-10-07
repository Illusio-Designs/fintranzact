/**
 * Payroll statutory files and registers (Phase 2), as pure builders: they
 * return text. NOTHING here files anything with a government system: these are
 * files the owner or the CA checks and uploads.
 *
 * Layouts are the best documented ones we know and MUST be checked against the
 * portal's current template before upload (docs/PAYROLL-CA-VERIFICATION.md):
 *   - PF ECR (EPFO, "ECR 2.0" text): `#~#` separated, one member per line.
 *   - ESIC monthly contribution (bulk upload) columns, as CSV.
 *   - PT and LWF working sheets, TDS Form 24Q working data, Form 16 working
 *     copy and the registers are plain CSVs / data for review, not portal formats.
 * Cells are quoted and neutralised against spreadsheet formula injection.
 */

import { csvCell } from "./payroll.js";
import { computeAnnualTax, fyLabel, tdsQuarterOfMonth, type RegimeConfig, type StatutoryRates, type TaxDeclaration, type TaxResult } from "./payroll-statutory.js";
import { paiseToRupees, rupeesToPaise, roundDiv } from "./payroll-calc.js";

function rupeeInt(paise: number): number {
  return roundDiv(Math.max(0, paise), 100);
}

/** Paise as a rupee cell: an integer when whole, else two decimals. */
function rupeeCell(paise: number): string {
  const s = paiseToRupees(paise);
  return s.endsWith(".00") ? s.slice(0, -3) : s;
}

function csv(header: readonly string[], rows: ReadonlyArray<ReadonlyArray<string | number>>): string {
  return `${[header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

/** "2026-10-07" -> "07/10/2026". */
export function ddmmyyyy(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

// ── PF: ECR ──────────────────────────────────────────────────────────────────

export interface EcrRow {
  uan: string | null;
  name: string;
  employeeCode: string;
  grossWagesPaise: number;
  epfWagesPaise: number;
  epsWagesPaise: number;
  edliWagesPaise: number;
  /** The employee's share of EPF: PF plus VPF. */
  epfEmployeePaise: number;
  /** EPS contribution (zero when the employee has no EPS). */
  epsPaise: number;
  /** The employer's EPF share (12% less EPS), the "EPF-EPS difference" column. */
  epfDiffPaise: number;
  /** Non-contributory (loss of pay) days. */
  lopDays: number;
}

export const ECR_COLUMNS = [
  "UAN", "Member Name", "Gross Wages", "EPF Wages", "EPS Wages", "EDLI Wages",
  "EPF Contribution Remitted (EE share)", "EPS Contribution Remitted", "EPF EPS Diff Remitted (ER share)", "NCP Days", "Refund of Advances",
] as const;

export const ECR_CHECK_NOTE =
  "Check this file against the EPFO portal's current ECR template and run the portal's validation before uploading. Fintranzact does not file anything.";

/** A member name safe for the ECR: upper case, no separator characters or line breaks. */
export function ecrName(name: string): string {
  return name.replace(/#~#|[#~\r\n]/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
}

/**
 * The PF ECR text file (ECR 2.0 layout, `#~#` separated). Only members with a
 * UAN and a contribution appear; a member without EPS has an EPS wage and an
 * EPS contribution of zero and the whole employer 12% in the EPF difference
 * column. Amounts are whole rupees. Members left out are listed in `skipped`.
 */
export function buildEcr(rows: readonly EcrRow[]): { text: string; csv: string; count: number; skipped: Array<{ employeeCode: string; reason: string }>; totals: { epfEe: number; eps: number; epfEr: number } } {
  const skipped: Array<{ employeeCode: string; reason: string }> = [];
  const lines: string[] = [];
  const csvRows: Array<Array<string | number>> = [];
  const totals = { epfEe: 0, eps: 0, epfEr: 0 };
  for (const r of rows) {
    if (r.epfEmployeePaise + r.epsPaise + r.epfDiffPaise <= 0) continue;
    if (!r.uan) {
      skipped.push({ employeeCode: r.employeeCode, reason: "No UAN" });
      continue;
    }
    const cells = [
      r.uan,
      ecrName(r.name),
      rupeeInt(r.grossWagesPaise),
      rupeeInt(r.epfWagesPaise),
      rupeeInt(r.epsWagesPaise),
      rupeeInt(r.edliWagesPaise),
      rupeeInt(r.epfEmployeePaise),
      rupeeInt(r.epsPaise),
      rupeeInt(r.epfDiffPaise),
      Math.ceil(r.lopDays),
      0,
    ];
    lines.push(cells.join("#~#"));
    csvRows.push(cells);
    totals.epfEe += rupeeInt(r.epfEmployeePaise);
    totals.eps += rupeeInt(r.epsPaise);
    totals.epfEr += rupeeInt(r.epfDiffPaise);
  }
  return { text: lines.length ? `${lines.join("\n")}\n` : "", csv: csv(ECR_COLUMNS, csvRows), count: lines.length, skipped, totals };
}

// ── ESI: monthly contribution file ───────────────────────────────────────────

export interface EsicRow {
  ipNumber: string | null;
  name: string;
  employeeCode: string;
  paidDays: number;
  wagesPaise: number;
  lastWorkingDay: string | null;
}

export const ESIC_COLUMNS = [
  "IP Number",
  "IP Name",
  "No of Days for which wages paid/payable during the month",
  "Total Monthly Wages",
  "Reason Code for Zero workings days(numeric only; provide 0 for all other reasons)",
  "Last Working Day",
] as const;

export const ESIC_CHECK_NOTE =
  "These are the columns of ESIC's monthly contribution bulk-upload template as we know them. Check them against the ESIC portal's current template before uploading. Fintranzact does not file anything.";

/** The ESIC monthly contribution CSV: covered employees with an IP number. */
export function buildEsicCsv(rows: readonly EsicRow[]): { csv: string; count: number; skipped: Array<{ employeeCode: string; reason: string }> } {
  const skipped: Array<{ employeeCode: string; reason: string }> = [];
  const out: Array<Array<string | number>> = [];
  for (const r of rows) {
    if (!r.ipNumber) {
      skipped.push({ employeeCode: r.employeeCode, reason: "No ESIC insurance (IP) number" });
      continue;
    }
    out.push([r.ipNumber, r.name, Math.round(r.paidDays + 1e-9), rupeeCell(r.wagesPaise), 0, ddmmyyyy(r.lastWorkingDay)]);
  }
  return { csv: csv(ESIC_COLUMNS, out), count: out.length, skipped };
}

// ── PT and LWF working sheets ────────────────────────────────────────────────

export interface StateAmountRow {
  state: string;
  employeeCode: string;
  name: string;
  grossPaise: number;
  employeePaise: number;
  employerPaise: number;
}

/** One working sheet per state: employees, the amounts, and a total row. */
export function buildStateSheets(kind: "pt" | "lwf", month: string, rows: readonly StateAmountRow[]): Array<{ state: string; csv: string; count: number; totalEmployeePaise: number; totalEmployerPaise: number }> {
  const byState = new Map<string, StateAmountRow[]>();
  for (const r of rows) {
    if (r.employeePaise + r.employerPaise <= 0) continue;
    byState.set(r.state, [...(byState.get(r.state) ?? []), r]);
  }
  const header = kind === "pt"
    ? ["State", "Month", "Employee Code", "Employee Name", "Gross Salary", "Professional Tax"]
    : ["State", "Month", "Employee Code", "Employee Name", "Gross Salary", "Employee Contribution", "Employer Contribution"];
  return [...byState.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([state, rs]) => {
    const totalEmployeePaise = rs.reduce((s, r) => s + r.employeePaise, 0);
    const totalEmployerPaise = rs.reduce((s, r) => s + r.employerPaise, 0);
    const body = rs.map((r) =>
      kind === "pt"
        ? [state, month, r.employeeCode, r.name, paiseToRupees(r.grossPaise), paiseToRupees(r.employeePaise)]
        : [state, month, r.employeeCode, r.name, paiseToRupees(r.grossPaise), paiseToRupees(r.employeePaise), paiseToRupees(r.employerPaise)],
    );
    const total = kind === "pt"
      ? [state, month, "", "Total", paiseToRupees(rs.reduce((s, r) => s + r.grossPaise, 0)), paiseToRupees(totalEmployeePaise)]
      : [state, month, "", "Total", paiseToRupees(rs.reduce((s, r) => s + r.grossPaise, 0)), paiseToRupees(totalEmployeePaise), paiseToRupees(totalEmployerPaise)];
    return { state, csv: csv(header, [...body, total]), count: rs.length, totalEmployeePaise, totalEmployerPaise };
  });
}

// ── TDS: Form 24Q working data and Form 16 ───────────────────────────────────

export interface TdsDeductee {
  employeeCode: string;
  name: string;
  pan: string | null;
  /** Per payroll month of the quarter, from approved runs. */
  months: Array<{ month: string; grossPaise: number; tdsPaise: number; deductedOn: string }>;
}

export interface TdsChallan {
  month: string;
  amountPaise: number;
  challanNumber: string | null;
  challanDate: string | null;
  paidOn: string;
}

export const FORM24Q_NOTE =
  "Working data for Form 24Q, to be checked by your CA and prepared in the Income Tax Department's return preparation utility. It is not an FVU file and is not filed by Fintranzact.";

/** Form 24Q working data for a quarter: deductee-wise rows (Annexure I style) and the challans. */
export function build24q(input: { fyStartYear: number; quarter: 1 | 2 | 3 | 4; tan: string | null; deductees: readonly TdsDeductee[]; challans: readonly TdsChallan[] }): {
  deducteeCsv: string;
  challanCsv: string;
  totalTdsPaise: number;
  totalChallanPaise: number;
  rows: number;
} {
  const label = `Q${input.quarter} FY ${fyLabel(input.fyStartYear)}`;
  const rows: Array<Array<string | number>> = [];
  let total = 0;
  for (const d of input.deductees) {
    for (const m of d.months) {
      if (m.tdsPaise <= 0 && m.grossPaise <= 0) continue;
      total += m.tdsPaise;
      rows.push([label, input.tan ?? "", "192", d.employeeCode, d.name, d.pan ?? "PANNOTAVBL", m.month, paiseToRupees(m.grossPaise), paiseToRupees(m.tdsPaise), ddmmyyyy(m.deductedOn)]);
    }
  }
  const challanRows = input.challans.map((c) => [label, c.month, c.challanNumber ?? "", ddmmyyyy(c.challanDate), ddmmyyyy(c.paidOn), paiseToRupees(c.amountPaise)]);
  return {
    deducteeCsv: csv(["Quarter", "TAN", "Section", "Employee Code", "Employee Name", "PAN", "Salary Month", "Amount Paid/Credited", "TDS Deducted", "Date of Deduction"], rows),
    challanCsv: csv(["Quarter", "Salary Month", "Challan Number", "Challan Date", "Date Paid", "Amount Deposited"], challanRows),
    totalTdsPaise: total,
    totalChallanPaise: input.challans.reduce((s, c) => s + c.amountPaise, 0),
    rows: rows.length,
  };
}

export const FORM16_LABEL = "Working copy for CA review. Not a TRACES-generated Form 16 and not a validated certificate.";

export interface Form16Month {
  month: string;
  grossPaise: number;
  tdsPaise: number;
  professionalTaxPaise: number;
  pfEmployeePaise: number;
}

export interface Form16Data {
  fyStartYear: number;
  fyLabel: string;
  regime: "new" | "old";
  employee: { code: string; name: string; pan: string | null };
  /** Quarter-wise TDS (Part A style summary). */
  quarters: Array<{ quarter: 1 | 2 | 3 | 4; grossPaise: number; tdsPaise: number }>;
  grossSalaryPaise: number;
  previousEmployerIncomePaise: number;
  standardDeductionPaise: number;
  professionalTaxPaise: number;
  declaredDeductions: Array<{ label: string; paise: number }>;
  totalDeductionsPaise: number;
  taxableIncomePaise: number;
  tax: TaxResult;
  tdsDeductedPaise: number;
  previousEmployerTdsPaise: number;
  /** Tax payable less tax deducted: positive means short-deducted. */
  differencePaise: number;
  months: Form16Month[];
  label: string;
}

/**
 * The yearly summary behind a Form 16 working copy, from the months actually
 * paid: it recomputes the year's tax on the ACTUAL income with the same rules
 * as the monthly projection and compares it with the tax deducted.
 */
export function buildForm16Data(input: {
  fyStartYear: number;
  regime: "new" | "old";
  employee: { code: string; name: string; pan: string | null };
  months: readonly Form16Month[];
  declaration: TaxDeclaration;
  rates: StatutoryRates;
}): Form16Data {
  const { rates, declaration: d } = input;
  const regime: RegimeConfig = input.regime === "new" ? rates.tds.newRegime : rates.tds.oldRegime;
  const sum = (f: (m: Form16Month) => number) => input.months.reduce((s, m) => s + f(m), 0);
  const grossSalaryPaise = sum((m) => m.grossPaise);
  const prevIncome = rupeesToPaise(d.previousEmployerIncome);
  const standardDeductionPaise = rupeesToPaise(regime.standardDeductionRupees);
  const cap = (v: number, limit: number) => (limit > 0 ? Math.min(v, limit) : v);
  const declaredDeductions: Array<{ label: string; paise: number }> = [];
  let professionalTaxPaise = 0;
  if (input.regime === "old") {
    declaredDeductions.push(
      { label: "Section 80C", paise: rupeesToPaise(cap(d.sec80C, rates.tds.limits.sec80CRupees)) },
      { label: "Section 80D", paise: rupeesToPaise(cap(d.sec80D, rates.tds.limits.sec80DRupees)) },
      { label: "Home loan interest", paise: rupeesToPaise(cap(d.homeLoanInterest, rates.tds.limits.homeLoanInterestRupees)) },
      { label: "HRA exemption", paise: rupeesToPaise(d.hraExemption) },
      { label: "Other deductions", paise: rupeesToPaise(d.otherDeductions) },
    );
    professionalTaxPaise = sum((m) => m.professionalTaxPaise);
  }
  const totalDeductionsPaise = standardDeductionPaise + professionalTaxPaise + declaredDeductions.reduce((s, x) => s + x.paise, 0);
  const taxableIncomePaise = Math.max(0, grossSalaryPaise + prevIncome - totalDeductionsPaise);
  const tax = regime.slabs.length
    ? computeAnnualTax({ taxableIncomePaise, regime, cessPercent: rates.tds.cessPercent, roundingRupees: rates.tds.roundingRupees })
    : { slabTaxPaise: 0, rebatePaise: 0, taxAfterRebatePaise: 0, cessPaise: 0, totalPaise: 0 };
  const tdsDeductedPaise = sum((m) => m.tdsPaise);
  const previousEmployerTdsPaise = rupeesToPaise(d.previousEmployerTds);
  const quarters = ([1, 2, 3, 4] as const).map((q) => {
    const ms = input.months.filter((m) => tdsQuarterOfMonth(m.month) === q);
    return { quarter: q, grossPaise: ms.reduce((s, m) => s + m.grossPaise, 0), tdsPaise: ms.reduce((s, m) => s + m.tdsPaise, 0) };
  });
  return {
    fyStartYear: input.fyStartYear,
    fyLabel: fyLabel(input.fyStartYear),
    regime: input.regime,
    employee: input.employee,
    quarters,
    grossSalaryPaise,
    previousEmployerIncomePaise: prevIncome,
    standardDeductionPaise,
    professionalTaxPaise,
    declaredDeductions,
    totalDeductionsPaise,
    taxableIncomePaise,
    tax,
    tdsDeductedPaise,
    previousEmployerTdsPaise,
    differencePaise: tax.totalPaise - tdsDeductedPaise - previousEmployerTdsPaise,
    months: [...input.months].sort((a, b) => a.month.localeCompare(b.month)),
    label: FORM16_LABEL,
  };
}

/** The Form 16 working copy as a CSV (one block per employee row set). */
export function form16Csv(data: Form16Data): string {
  const r = (label: string, paise: number): Array<string | number> => [label, paiseToRupees(paise)];
  const rows: Array<Array<string | number>> = [
    ["Working copy", data.label],
    ["Financial year", data.fyLabel],
    ["Employee code", data.employee.code],
    ["Employee name", data.employee.name],
    ["PAN", data.employee.pan ?? ""],
    ["Tax regime", data.regime === "new" ? "New regime" : "Old regime"],
    r("Gross salary (this employer)", data.grossSalaryPaise),
    r("Income from previous employer", data.previousEmployerIncomePaise),
    r("Standard deduction", data.standardDeductionPaise),
    r("Professional tax", data.professionalTaxPaise),
    ...data.declaredDeductions.map((x) => r(x.label, x.paise)),
    r("Taxable income", data.taxableIncomePaise),
    r("Tax on income (slabs)", data.tax.slabTaxPaise),
    r("Rebate / relief", data.tax.rebatePaise),
    r("Cess", data.tax.cessPaise),
    r("Total tax payable", data.tax.totalPaise),
    r("Tax deducted by this employer", data.tdsDeductedPaise),
    r("Tax deducted by previous employer", data.previousEmployerTdsPaise),
    r("Difference (payable less deducted)", data.differencePaise),
    ...data.quarters.map((q) => [`Quarter ${q.quarter}: gross / TDS`, `${paiseToRupees(q.grossPaise)} / ${paiseToRupees(q.tdsPaise)}`] as Array<string | number>),
    ["Month", "Gross / TDS / PT"],
    ...data.months.map((m) => [m.month, `${paiseToRupees(m.grossPaise)} / ${paiseToRupees(m.tdsPaise)} / ${paiseToRupees(m.professionalTaxPaise)}`] as Array<string | number>),
  ];
  return `${rows.map((x) => x.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

// ── Registers ────────────────────────────────────────────────────────────────

export interface WageRegisterRow {
  employeeCode: string;
  name: string;
  paidDays: string;
  lopDays: string;
  overtimeHours: string;
  components: Array<{ name: string; type: string; amountPaise: number }>;
  grossPaise: number;
  deductionsPaise: number;
  netPaise: number;
}

/** Wages register for a month: one row per employee with a column per earning and per deduction. */
export function buildWageRegister(month: string, rows: readonly WageRegisterRow[]): string {
  const earn = [...new Set(rows.flatMap((r) => r.components.filter((c) => c.type === "earning").map((c) => c.name)))];
  const ded = [...new Set(rows.flatMap((r) => r.components.filter((c) => c.type === "deduction").map((c) => c.name)))];
  const header = ["Month", "Employee Code", "Employee Name", "Paid Days", "LOP Days", "Overtime Hours", ...earn, "Gross Earnings", ...ded, "Total Deductions", "Net Pay"];
  const body = rows.map((r) => {
    const amt = (type: string, name: string) => paiseToRupees(r.components.filter((c) => c.type === type && c.name === name).reduce((s, c) => s + c.amountPaise, 0));
    return [month, r.employeeCode, r.name, r.paidDays, r.lopDays, r.overtimeHours, ...earn.map((n) => amt("earning", n)), paiseToRupees(r.grossPaise), ...ded.map((n) => amt("deduction", n)), paiseToRupees(r.deductionsPaise), paiseToRupees(r.netPaise)];
  });
  return csv(header, body);
}

export const ATTENDANCE_CODES: Record<string, string> = { present: "P", absent: "A", half_day: "HD", week_off: "WO", holiday: "H", leave: "L" };

/** Attendance register for a month: one row per employee, one column per day. */
export function buildAttendanceRegister(month: string, days: readonly string[], rows: ReadonlyArray<{ employeeCode: string; name: string; byDate: Record<string, string>; paidDays: string; lopDays: string }>): string {
  const header = ["Month", "Employee Code", "Employee Name", ...days.map((d) => String(Number(d.slice(8)))), "Paid Days", "LOP Days"];
  return csv(
    header,
    rows.map((r) => [month, r.employeeCode, r.name, ...days.map((d) => ATTENDANCE_CODES[r.byDate[d] ?? ""] ?? ""), r.paidDays, r.lopDays]),
  );
}

/** Leave register for a leave year: balances per employee and leave type. */
export function buildLeaveRegister(leaveYearLabel: string, rows: ReadonlyArray<{ employeeCode: string; name: string; leaveType: string; opening: number; accrued: number; taken: number; encashed: number; balance: number }>): string {
  return csv(
    ["Leave Year", "Employee Code", "Employee Name", "Leave Type", "Opening / Carried Forward", "Accrued", "Taken", "Encashed", "Balance"],
    rows.map((r) => [leaveYearLabel, r.employeeCode, r.name, r.leaveType, r.opening, r.accrued, r.taken, r.encashed, r.balance]),
  );
}

// ── Bonus and gratuity registers (computed from existing data) ───────────────

/**
 * Whole months of service and the leftover days between two dates
 * ("YYYY-MM-DD"). The end date is counted as served (inclusive).
 */
export function serviceBetween(from: string, toInclusive: string): { months: number; days: number } {
  const [fy, fm, fd] = from.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = toInclusive.split("-").map(Number) as [number, number, number];
  // The end date counts as served: measure up to the day after it.
  const end = new Date(Date.UTC(ty, tm - 1, td + 1));
  const ey = end.getUTCFullYear();
  const em = end.getUTCMonth() + 1;
  let months = (ey - fy) * 12 + (em - fm);
  let days = end.getUTCDate() - fd;
  if (days < 0) {
    months -= 1;
    days += new Date(Date.UTC(ey, em - 1, 0)).getUTCDate();
  }
  if (months < 0) return { months: 0, days: 0 };
  return { months, days: Math.max(0, days) };
}

export interface GratuityResult {
  completedYears: number;
  /** Years the formula uses: completed years, plus one when the rest is more than six months. */
  yearsForFormula: number;
  eligible: boolean;
  amountPaise: number;
  capped: boolean;
}

/**
 * Gratuity as a computed figure (a register, not a payment): last drawn
 * (Basic + DA) x days per year / divisor x years, where a part year of more than
 * six months counts as a full year, capped at the configured limit. Payable
 * only after the configured minimum years of service (completed years are
 * tested, not the rounded-up figure).
 */
export function computeGratuity(input: { joinedOn: string; asOf: string; lastDrawnWagesPaise: number; rules: StatutoryRates["gratuity"] }): GratuityResult {
  const { months, days } = serviceBetween(input.joinedOn, input.asOf);
  const completedYears = Math.floor(months / 12);
  const rem = months % 12;
  const yearsForFormula = completedYears + (rem > 6 || (rem === 6 && days > 0) ? 1 : 0);
  const eligible = completedYears >= input.rules.minYears;
  if (!eligible || input.lastDrawnWagesPaise <= 0) return { completedYears, yearsForFormula, eligible, amountPaise: 0, capped: false };
  const daysBp = Math.round(input.rules.daysPerYear * 100);
  const raw = roundDiv(input.lastDrawnWagesPaise * daysBp * yearsForFormula, Math.round(input.rules.workingDaysDivisor * 100));
  const cap = rupeesToPaise(input.rules.capRupees);
  const capped = cap > 0 && raw > cap;
  return { completedYears, yearsForFormula, eligible, amountPaise: capped ? cap : raw, capped };
}

export function buildGratuityRegister(asOf: string, rows: ReadonlyArray<{ employeeCode: string; name: string; joinedOn: string; lastDrawnWagesPaise: number; result: GratuityResult }>): string {
  return csv(
    ["As On", "Employee Code", "Employee Name", "Date of Joining", "Completed Years", "Years Used", "Last Drawn Basic + DA", "Eligible", "Gratuity (computed)", "Capped"],
    rows.map((r) => [ddmmyyyy(asOf), r.employeeCode, r.name, ddmmyyyy(r.joinedOn), r.result.completedYears, r.result.yearsForFormula, paiseToRupees(r.lastDrawnWagesPaise), r.result.eligible ? "Yes" : "No", paiseToRupees(r.result.amountPaise), r.result.capped ? "Yes" : "No"]),
  );
}

/** Bonus basis for one employee for the year: each month's wages capped at the ceiling (when configured), summed. */
export function computeBonusBasis(monthlyWagesPaise: readonly number[], rules: StatutoryRates["bonus"]): { wagesPaise: number; cappedWagesPaise: number; bonusPaise: number | null } {
  const ceiling = rupeesToPaise(rules.wageCeilingRupees);
  const wagesPaise = monthlyWagesPaise.reduce((s, w) => s + w, 0);
  const cappedWagesPaise = ceiling > 0 ? monthlyWagesPaise.reduce((s, w) => s + Math.min(w, ceiling), 0) : wagesPaise;
  const configured = rules.percent > 0;
  const bonusPaise = configured ? roundDiv(cappedWagesPaise * Math.round(rules.percent * 100), 10_000) : null;
  return { wagesPaise, cappedWagesPaise, bonusPaise };
}

export function buildBonusRegister(fyStartYear: number, rows: ReadonlyArray<{ employeeCode: string; name: string; monthsWorked: number; basis: ReturnType<typeof computeBonusBasis> }>): string {
  return csv(
    ["Financial Year", "Employee Code", "Employee Name", "Months Paid", "Basic + DA Earned", "Wages Used (after ceiling)", "Bonus (computed, at configured %)"],
    rows.map((r) => [
      fyLabel(fyStartYear),
      r.employeeCode,
      r.name,
      r.monthsWorked,
      paiseToRupees(r.basis.wagesPaise),
      paiseToRupees(r.basis.cappedWagesPaise),
      r.basis.bonusPaise === null ? "Bonus percentage not configured" : paiseToRupees(r.basis.bonusPaise),
    ]),
  );
}

