/**
 * Payroll statutory data: the registrations (business flags), the rates per
 * financial year, each employee's history inside the year (what ESI, PT and TDS
 * need) and the glue that adds the statutory components to a calculated pay
 * line. The arithmetic is in @fintranzact/shared (payroll-statutory.ts).
 *
 * Nothing here runs for a business with no registration turned on: a run for a
 * business without PF, ESI, PT, LWF or TDS is exactly the Phase 1 run.
 */

import { and, desc, eq, inArray, lte } from "drizzle-orm";
import {
  employeeTaxDeclarations,
  payrollRunLines,
  payrollRuns,
  payrollSettings,
  payrollStatutorySettings,
  type TenantDatabase,
  type employees,
} from "@fintranzact/db";
import {
  EMPTY_DECLARATION,
  applyStatutoryToLine,
  computeStatutoryLine,
  defaultStatutoryRates,
  esiContributionPeriod,
  fyStartYearOfMonth,
  looksLikeManualStatutory,
  monthsOfFy,
  rupeesToPaise,
  statutoryRatesSchema,
  taxDeclarationSchema,
  type PayrollLineResult,
  type PayrollWarning,
  type StatutoryContext,
  type StatutoryDetails,
  type StatutoryHistory,
  type StatutoryRates,
  type TaxDeclaration,
} from "@fintranzact/shared";

type Reader = Pick<TenantDatabase, "select">;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;
type EmployeeRow = typeof employees.$inferSelect;

// ── Registrations ────────────────────────────────────────────────────────────

export interface StatutoryFlags {
  pfRegistered: boolean;
  pfEstablishmentCode: string | null;
  esiRegistered: boolean;
  esiCode: string | null;
  ptStates: string[];
  lwfState: string | null;
  tdsEnabled: boolean;
}

export const NO_STATUTORY: StatutoryFlags = {
  pfRegistered: false,
  pfEstablishmentCode: null,
  esiRegistered: false,
  esiCode: null,
  ptStates: [],
  lwfState: null,
  tdsEnabled: false,
};

export async function loadStatutoryFlags(db: Reader, businessId: string): Promise<StatutoryFlags> {
  const [row] = await db.select().from(payrollSettings).where(eq(payrollSettings.businessId, businessId)).limit(1);
  if (!row) return { ...NO_STATUTORY };
  return {
    pfRegistered: row.pfRegistered,
    pfEstablishmentCode: row.pfEstablishmentCode,
    esiRegistered: row.esiRegistered,
    esiCode: row.esiCode,
    ptStates: row.ptStates,
    lwfState: row.lwfState,
    tdsEnabled: row.tdsEnabled,
  };
}

export function anyStatutory(f: StatutoryFlags): boolean {
  return f.pfRegistered || f.esiRegistered || f.ptStates.length > 0 || !!f.lwfState || f.tdsEnabled;
}

// ── Rates ────────────────────────────────────────────────────────────────────

export interface LoadedRates {
  rates: StatutoryRates;
  /** "saved" when a row of the business holds them, "default" when the shipped defaults are used. */
  source: "saved" | "default";
  /** The financial year of the row in use (the latest at or before the one asked for), when saved. */
  rowFinancialYear: number | null;
  rowId: string | null;
  verifiedNote: string | null;
  verifiedOn: string | null;
  updatedAt: Date | null;
}

/** Fill sections a stored document predates with the defaults, so an older saved document still validates. */
function withDefaults(stored: Record<string, unknown>): Record<string, unknown> {
  const d = defaultStatutoryRates() as unknown as Record<string, Record<string, unknown>>;
  const out: Record<string, unknown> = { ...d, ...stored };
  for (const k of ["pf", "esi", "tds", "dueDates", "gratuity", "bonus"]) {
    const s = stored[k];
    if (s && typeof s === "object") out[k] = { ...d[k], ...(s as Record<string, unknown>) };
  }
  return out;
}

export async function loadStatutoryRates(db: Reader, businessId: string, fyStartYear: number): Promise<LoadedRates> {
  const [row] = await db
    .select()
    .from(payrollStatutorySettings)
    .where(and(eq(payrollStatutorySettings.businessId, businessId), lte(payrollStatutorySettings.financialYear, fyStartYear)))
    .orderBy(desc(payrollStatutorySettings.financialYear))
    .limit(1);
  if (row) {
    const parsed = statutoryRatesSchema.safeParse(withDefaults(row.rates));
    if (parsed.success) {
      return {
        rates: parsed.data,
        source: "saved",
        rowFinancialYear: row.financialYear,
        rowId: row.id,
        verifiedNote: row.verifiedNote,
        verifiedOn: row.verifiedOn,
        updatedAt: row.updatedAt,
      };
    }
  }
  return { rates: defaultStatutoryRates(), source: "default", rowFinancialYear: null, rowId: null, verifiedNote: null, verifiedOn: null, updatedAt: null };
}

// ── History inside the year ──────────────────────────────────────────────────

const FINAL = ["approved", "posted", "paid"];

function monthsBetweenInclusive(joiningMonth: string, endMonth: string | null, within: readonly string[]): string[] {
  return within.filter((m) => m >= joiningMonth && (!endMonth || m <= endMonth));
}

/**
 * Per employee: what the earlier months of this financial year (approved
 * payrolls only) hold: gross to date, tax deducted, professional tax deducted,
 * whether ESI was contributed earlier in this contribution period, and how many
 * earlier months the employee was employed but has no approved payroll line.
 */
export async function loadStatutoryHistory(db: Reader, businessId: string, month: string, emps: readonly EmployeeRow[]): Promise<Map<string, StatutoryHistory>> {
  const out = new Map<string, StatutoryHistory>();
  const blank = (): StatutoryHistory => ({ esiCoveredEarlierInPeriod: false, ptPaidThisFyPaise: 0, grossToDatePaise: 0, tdsToDatePaise: 0, missingMonths: 0 });
  for (const e of emps) out.set(e.id, blank());
  const earlier = monthsOfFy(fyStartYearOfMonth(month)).filter((m) => m < month);
  if (earlier.length === 0 || emps.length === 0) return out;

  const rows = await db
    .select({ employeeId: payrollRunLines.employeeId, month: payrollRuns.month, gross: payrollRunLines.grossEarnings, components: payrollRunLines.components })
    .from(payrollRunLines)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payrollRunLines.runId))
    .where(
      and(
        eq(payrollRunLines.businessId, businessId),
        inArray(payrollRuns.month, earlier),
        inArray(payrollRuns.status, FINAL),
        inArray(payrollRunLines.employeeId, emps.map((e) => e.id)),
      ),
    );
  const period = new Set(esiContributionPeriod(month).months);
  const seen = new Map<string, Set<string>>();
  for (const r of rows) {
    const h = out.get(r.employeeId)!;
    h.grossToDatePaise += rupeesToPaise(r.gross);
    for (const c of r.components) {
      if (c.statutoryKind === "income_tax_tds") h.tdsToDatePaise += rupeesToPaise(c.amount);
      else if (c.statutoryKind === "professional_tax") h.ptPaidThisFyPaise += rupeesToPaise(c.amount);
      else if (c.statutoryKind === "esi_employee" && rupeesToPaise(c.amount) > 0 && period.has(r.month)) h.esiCoveredEarlierInPeriod = true;
    }
    const s = seen.get(r.employeeId) ?? new Set<string>();
    s.add(r.month);
    seen.set(r.employeeId, s);
  }
  for (const e of emps) {
    const expected = monthsBetweenInclusive(e.dateOfJoining.slice(0, 7), e.lastWorkingDay ? e.lastWorkingDay.slice(0, 7) : null, earlier);
    out.get(e.id)!.missingMonths = expected.filter((m) => !seen.get(e.id)?.has(m)).length;
  }
  return out;
}

export async function loadDeclarations(db: Reader, businessId: string, fyStartYear: number): Promise<Map<string, TaxDeclaration>> {
  const rows = await db
    .select()
    .from(employeeTaxDeclarations)
    .where(and(eq(employeeTaxDeclarations.businessId, businessId), eq(employeeTaxDeclarations.financialYear, fyStartYear)));
  const out = new Map<string, TaxDeclaration>();
  for (const r of rows) {
    const p = taxDeclarationSchema.safeParse(r.amounts);
    out.set(r.employeeId, p.success ? p.data : EMPTY_DECLARATION);
  }
  return out;
}

// ── Applying it to a run ─────────────────────────────────────────────────────

/** Warnings about the settings, not an employee: shown once on the run instead of per employee. */
const CONFIG_WARNING_CODES = new Set<PayrollWarning["code"]>(["pt_slabs_missing", "lwf_not_configured", "tax_slabs_missing"]);

export interface StatutoryRunContext {
  month: string;
  financialYear: number;
  flags: StatutoryFlags;
  loaded: LoadedRates;
  history: Map<string, StatutoryHistory>;
  declarations: Map<string, TaxDeclaration>;
  ctx: StatutoryContext;
}

/** The statutory context of a run, or null when the business has no registration turned on. */
export async function loadStatutoryRunContext(tx: Tx, businessId: string, month: string, emps: readonly EmployeeRow[]): Promise<StatutoryRunContext | null> {
  const flags = await loadStatutoryFlags(tx, businessId);
  if (!anyStatutory(flags)) return null;
  const financialYear = fyStartYearOfMonth(month);
  const [loaded, history, declarations] = await Promise.all([
    loadStatutoryRates(tx, businessId, financialYear),
    loadStatutoryHistory(tx, businessId, month, emps),
    loadDeclarations(tx, businessId, financialYear),
  ]);
  return {
    month,
    financialYear,
    flags,
    loaded,
    history,
    declarations,
    ctx: {
      month,
      rates: loaded.rates,
      business: { pfRegistered: flags.pfRegistered, esiRegistered: flags.esiRegistered, ptStates: flags.ptStates, lwfState: flags.lwfState, tdsEnabled: flags.tdsEnabled },
    },
  };
}

/** What the run row stores: the settings the run was calculated with (frozen with the run). */
export function runSnapshot(s: StatutoryRunContext): Record<string, unknown> {
  return {
    financialYear: s.financialYear,
    ratesSource: s.loaded.source,
    ratesRowFinancialYear: s.loaded.rowFinancialYear,
    flags: {
      pfRegistered: s.flags.pfRegistered,
      esiRegistered: s.flags.esiRegistered,
      ptStates: s.flags.ptStates,
      lwfState: s.flags.lwfState,
      tdsEnabled: s.flags.tdsEnabled,
    },
    rates: s.loaded.rates,
  };
}

export interface EmployeeStatutoryResult {
  line: PayrollLineResult;
  details: StatutoryDetails;
  /** Warnings about this employee (the settings warnings are returned separately, once per run). */
  warnings: PayrollWarning[];
  configWarnings: PayrollWarning[];
}

/** Add one employee's statutory components to their calculated pay line. */
export function applyStatutoryForEmployee(
  s: StatutoryRunContext,
  emp: EmployeeRow,
  line: PayrollLineResult,
  fullMonthEarnings: ReadonlyArray<{ type: string; category: string; isWage: boolean; monthlyPaise: number }>,
): EmployeeStatutoryResult {
  const result = computeStatutoryLine({
    ctx: s.ctx,
    employee: {
      pfApplicable: emp.pfApplicable,
      pfExcluded: emp.pfExcluded,
      epsEligible: emp.epsEligible,
      pfOnActualWages: emp.pfOnActualWages,
      internationalWorker: emp.internationalWorker,
      vpfPercent: Number(emp.vpfPercent),
      esiApplicable: emp.esiApplicable,
      dateOfBirth: emp.dateOfBirth,
      gender: emp.gender,
      workState: emp.workState,
      lastWorkingDay: emp.lastWorkingDay,
      hasPan: !!emp.pan,
      hasUan: !!emp.uan,
      hasEsicNumber: !!emp.esicNumber,
      taxRegime: emp.taxRegime === "old" ? "old" : "new",
      declaration: s.declarations.get(emp.id) ?? EMPTY_DECLARATION,
    },
    line,
    fullMonthEarnings,
    history: s.history.get(emp.id)!,
  });
  const warnings: PayrollWarning[] = result.warnings.filter((w) => !CONFIG_WARNING_CODES.has(w.code));
  const configWarnings = result.warnings.filter((w) => CONFIG_WARNING_CODES.has(w.code));
  if (result.components.length > 0) {
    const manual = line.components.find((c) => c.type === "deduction" && c.source !== "statutory" && looksLikeManualStatutory(c));
    if (manual) {
      warnings.push({
        code: "double_deduction",
        message: `"${manual.name}" looks like a statutory deduction entered by hand, and statutory deductions are now calculated automatically. Remove it if it duplicates one.`,
      });
    }
  }
  return { line: applyStatutoryToLine(line, result.components), details: result.details, warnings, configWarnings };
}

/** The `statutory` JSON a payroll line stores (paise integers, frozen with the line). */
export function lineStatutoryJson(details: StatutoryDetails): Record<string, unknown> {
  return details as unknown as Record<string, unknown>;
}

/** The warnings about settings, one per kind, for the whole run. */
export function dedupeConfigWarnings(list: readonly PayrollWarning[]): PayrollWarning[] {
  const seen = new Set<string>();
  const out: PayrollWarning[] = [];
  for (const w of list) {
    if (seen.has(w.message)) continue;
    seen.add(w.message);
    out.push(w);
  }
  return out;
}
