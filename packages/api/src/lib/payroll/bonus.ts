/**
 * Bonus runs (Payment of Bonus Act), one per business and financial year.
 *
 * Status machine, mirroring the payroll run:
 *   draft -> calculated -> pending_approval -> approved -> posted -> paid
 * Maker-checker: whoever last calculated the run cannot approve it (unless the business has one user). Approval needs
 * Payroll "manage"; posting and paying need PayrollPosting. The arithmetic is in @fintranzact/shared (payroll-phase4.ts);
 * the wages come from the FROZEN lines of approved payroll runs (Basic + DA earned each month), so the bonus always agrees
 * with the payslips. The bonus settings (ceilings, percentages) are the `bonus` part of the statutory rates of the year and
 * ship empty: a run refuses to calculate until they are set.
 *
 * Posting: Dr 5202 Salary - Bonus & Incentives / Cr 2440 Bonus Payable, dated the last day of the financial year (or today
 * when the year has not ended). Paying: Dr 2440 / Cr bank or cash. Set-on and set-off are NOT computed.
 */

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  bonusRunLines,
  bonusRuns,
  businessMembers,
  businesses,
  employees,
  fnfSettlementLines,
  fnfSettlements,
  payrollRunLines,
  payrollRuns,
  type TenantDatabase,
} from "@fintranzact/db";
import {
  MAKER_CHECKER_MESSAGE,
  approverAllowed,
  bonusRulesGaps,
  buildBankPaymentCsv,
  buildBonusStatementCsv,
  canTransitionBonusRun,
  computeEmployeeBonus,
  fyLabel,
  istDateParts,
  isBonusRunEditable,
  monthsOfFy,
  paiseToRupees,
  rupeesToPaise,
  validateBonusPercent,
  type BonusMonthInput,
  type BonusRunStatus,
} from "@fintranzact/shared";
import { assertPeriodOpen } from "../period-lock.js";
import { badRequest, notFound } from "./access.js";
import { decryptSensitive } from "../field-encryption.js";
import { bookDate, cashOrBankAccountId, ensurePayrollAccounts, moveBank, writeJournalEntry } from "./books.js";
import { loadStatutoryRates } from "./statutory.js";
import type { Actor } from "./run.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;
type RunRow = typeof bonusRuns.$inferSelect;
type Reader = Pick<TenantDatabase, "select">;

const FINAL = ["approved", "posted", "paid"];

function todayIst(): string {
  const p = istDateParts(new Date());
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function currentFinancialYear(today = todayIst()): number {
  const [y, m] = today.split("-").map(Number) as [number, number];
  return m >= 4 ? y : y - 1;
}

export async function getBonusRun(db: Reader, businessId: string, id: string): Promise<RunRow> {
  const [run] = await db.select().from(bonusRuns).where(and(eq(bonusRuns.id, id), eq(bonusRuns.businessId, businessId))).limit(1);
  if (!run) throw notFound("Bonus run");
  return run;
}

async function lockBonusRun(tx: Tx, businessId: string, id: string): Promise<RunRow> {
  const [run] = await tx.select().from(bonusRuns).where(and(eq(bonusRuns.id, id), eq(bonusRuns.businessId, businessId))).for("update").limit(1);
  if (!run) throw notFound("Bonus run");
  return run as RunRow;
}

function requireStatus(run: RunRow, allowed: BonusRunStatus[], what: string) {
  if (!allowed.includes(run.status as BonusRunStatus)) throw badRequest(`${what} is not possible while the bonus run is "${run.status.replace(/_/g, " ")}".`);
}

// ── Wages of the year, from approved payroll ─────────────────────────────────

export interface BonusYearEmployee {
  employeeId: string;
  code: string;
  name: string;
  months: BonusMonthInput[];
}

/** Basic + DA lines of a payroll line: [earned, full-month]. */
export function basicDaOfLine(components: ReadonlyArray<{ type: string; category: string; source: string; amount: string; full: string }>): { earnedPaise: number; fullPaise: number } {
  let earned = 0;
  let full = 0;
  for (const c of components) {
    if (c.type === "earning" && c.source === "structure" && (c.category === "basic" || c.category === "da")) {
      earned += rupeesToPaise(c.amount);
      full += rupeesToPaise(c.full);
    }
  }
  return { earnedPaise: earned, fullPaise: full };
}

export async function loadBonusYear(db: Reader, businessId: string, fy: number): Promise<{ employees: BonusYearEmployee[]; approvedMonths: string[]; missingMonths: string[] }> {
  const months = monthsOfFy(fy);
  const runs = await db.select().from(payrollRuns).where(and(eq(payrollRuns.businessId, businessId), inArray(payrollRuns.month, months), inArray(payrollRuns.status, FINAL)));
  const lines = runs.length ? await db.select().from(payrollRunLines).where(inArray(payrollRunLines.runId, runs.map((r) => r.id))) : [];
  const monthOfRun = new Map(runs.map((r) => [r.id, r.month]));
  const by = new Map<string, BonusYearEmployee>();
  for (const l of lines) {
    const { earnedPaise, fullPaise } = basicDaOfLine(l.components);
    const e = by.get(l.employeeId) ?? { employeeId: l.employeeId, code: l.employeeCode, name: l.employeeName, months: [] };
    e.months.push({ month: monthOfRun.get(l.runId)!, daysInMonth: l.daysInMonth, paidDays: Number(l.paidDays), earnedWagePaise: earnedPaise, fullWagePaise: fullPaise });
    by.set(l.employeeId, e);
  }
  const approved = runs.map((r) => r.month).sort();
  return {
    employees: [...by.values()].sort((a, b) => a.code.localeCompare(b.code)),
    approvedMonths: approved,
    missingMonths: months.filter((m) => !approved.includes(m)),
  };
}

/** Employees whose bonus for the year is being (or was) settled in an approved full and final settlement: employeeId -> settlement number. */
async function bonusInFnf(tx: Reader, businessId: string, fy: number): Promise<Map<string, string>> {
  const rows = await tx
    .select({ employeeId: fnfSettlements.employeeId, number: fnfSettlements.number })
    .from(fnfSettlements)
    .innerJoin(fnfSettlementLines, and(eq(fnfSettlementLines.settlementId, fnfSettlements.id), eq(fnfSettlementLines.kind, "bonus")))
    .where(and(eq(fnfSettlements.businessId, businessId), inArray(fnfSettlements.status, FINAL), sql`(${fnfSettlements.inputs}->>'bonusFinancialYear')::int = ${fy}`));
  return new Map(rows.map((r) => [r.employeeId, r.number]));
}

// ── Create, update, calculate ────────────────────────────────────────────────

export async function createBonusRun(db: TenantDatabase, input: { businessId: string; financialYear: number; percent: number; note?: string | null; actor: Actor }): Promise<RunRow> {
  if (input.financialYear > currentFinancialYear()) throw badRequest(`The financial year ${fyLabel(input.financialYear)} has not started yet.`);
  const loaded = await loadStatutoryRates(db, input.businessId, input.financialYear);
  const err = validateBonusPercent(input.percent, loaded.rates.bonus);
  if (err) throw badRequest(err);
  const [existing] = await db.select({ id: bonusRuns.id }).from(bonusRuns).where(and(eq(bonusRuns.businessId, input.businessId), eq(bonusRuns.financialYear, input.financialYear))).limit(1);
  if (existing) throw new TRPCError({ code: "CONFLICT", message: `There is already a bonus run for ${fyLabel(input.financialYear)}.` });
  try {
    const [run] = await db
      .insert(bonusRuns)
      .values({ businessId: input.businessId, financialYear: input.financialYear, number: `BN-${fyLabel(input.financialYear)}`, percent: String(input.percent), note: input.note || null, createdByUserId: input.actor.id, createdByName: input.actor.name })
      .returning();
    return run!;
  } catch (e) {
    if ((e as { code?: string; cause?: { code?: string } }).code === "23505" || (e as { cause?: { code?: string } }).cause?.code === "23505") {
      throw new TRPCError({ code: "CONFLICT", message: `There is already a bonus run for ${fyLabel(input.financialYear)}.` });
    }
    throw e;
  }
}

/** Change the percentage or note. A calculated run goes back to "calculated" (it must be calculated again). */
export async function updateBonusRun(db: TenantDatabase, input: { businessId: string; id: string; percent?: number; note?: string | null }): Promise<RunRow> {
  return db.transaction(async (tx) => {
    const run = await lockBonusRun(tx, input.businessId, input.id);
    if (!isBonusRunEditable(run.status as BonusRunStatus)) throw badRequest("An approved bonus run cannot be changed.");
    const set: Partial<typeof bonusRuns.$inferInsert> = { updatedAt: new Date() };
    if (input.percent != null) {
      const loaded = await loadStatutoryRates(tx, input.businessId, run.financialYear);
      const err = validateBonusPercent(input.percent, loaded.rates.bonus);
      if (err) throw badRequest(err);
      set.percent = String(input.percent);
    }
    if (input.note !== undefined) set.note = input.note || null;
    if (run.status === "pending_approval") Object.assign(set, { status: "calculated", submittedAt: null, submittedByUserId: null });
    const [updated] = await tx.update(bonusRuns).set(set).where(eq(bonusRuns.id, run.id)).returning();
    return updated!;
  });
}

/** Mark an employee not eligible by hand (or eligible again with an empty reason). The run must be calculated again. */
export async function setBonusExclusion(db: TenantDatabase, input: { businessId: string; runId: string; employeeId: string; reason: string }): Promise<RunRow> {
  return db.transaction(async (tx) => {
    const run = await lockBonusRun(tx, input.businessId, input.runId);
    if (!isBonusRunEditable(run.status as BonusRunStatus)) throw badRequest("An approved bonus run cannot be changed.");
    const [emp] = await tx.select({ id: employees.id }).from(employees).where(and(eq(employees.id, input.employeeId), eq(employees.businessId, input.businessId))).limit(1);
    if (!emp) throw notFound("Employee");
    const exclusions = { ...run.exclusions };
    if (input.reason.trim()) exclusions[input.employeeId] = input.reason.trim();
    else delete exclusions[input.employeeId];
    const set: Partial<typeof bonusRuns.$inferInsert> = { exclusions, updatedAt: new Date() };
    if (run.status === "pending_approval") Object.assign(set, { status: "calculated", submittedAt: null, submittedByUserId: null });
    const [updated] = await tx.update(bonusRuns).set(set).where(eq(bonusRuns.id, run.id)).returning();
    return updated!;
  });
}

export async function calculateBonusRun(db: TenantDatabase, input: { businessId: string; runId: string; actor: Actor }): Promise<{ run: RunRow; warnings: RunRow["warnings"] }> {
  return db.transaction(async (tx) => {
    const run = await lockBonusRun(tx, input.businessId, input.runId);
    requireStatus(run, ["draft", "calculated", "pending_approval"], "Calculating");
    const loaded = await loadStatutoryRates(tx, input.businessId, run.financialYear);
    const rules = loaded.rates.bonus;
    const gaps = bonusRulesGaps(rules);
    if (gaps.length) throw badRequest(gaps.join(" "));
    const percent = Number(run.percent);
    const pctError = validateBonusPercent(percent, rules);
    if (pctError) throw badRequest(pctError);

    const year = await loadBonusYear(tx, input.businessId, run.financialYear);
    if (year.employees.length === 0) throw badRequest(`There is no approved payroll in ${fyLabel(run.financialYear)}. Approve the payroll runs of the year first.`);
    const inFnf = await bonusInFnf(tx, input.businessId, run.financialYear);
    const warnings: RunRow["warnings"] = [];
    if (year.missingMonths.length) {
      warnings.push({ code: "months_without_payroll", message: `Payroll is not approved for ${year.missingMonths.join(", ")}. The bonus is calculated on the months that are.` });
    }
    if (loaded.source === "default") {
      warnings.push({ code: "rates_default", message: `Statutory rates for FY ${fyLabel(run.financialYear)} have not been saved: the shipped defaults were used. Review the Bonus settings and verify them with your CA.` });
    }

    const rows: Array<typeof bonusRunLines.$inferInsert> = [];
    for (const e of year.employees) {
      const manual = run.exclusions?.[e.employeeId] ?? (inFnf.has(e.employeeId) ? `Bonus settled in full and final settlement ${inFnf.get(e.employeeId)}` : null);
      const r = computeEmployeeBonus({ months: e.months, manualReason: manual }, rules, percent);
      rows.push({
        runId: run.id,
        businessId: input.businessId,
        employeeId: e.employeeId,
        employeeCode: e.code,
        employeeName: e.name,
        eligible: r.eligible,
        reason: r.reason,
        reasonText: r.reasonText,
        monthsPaid: r.monthsPaid,
        daysPaid: r.daysPaid.toFixed(1),
        eligibilityWage: paiseToRupees(r.eligibilityWagePaise),
        wages: paiseToRupees(r.wagesPaise),
        calculationWages: paiseToRupees(r.calculationWagesPaise),
        percent: String(percent),
        bonus: paiseToRupees(r.bonusPaise),
      });
    }
    await tx.delete(bonusRunLines).where(eq(bonusRunLines.runId, run.id));
    await tx.insert(bonusRunLines).values(rows);
    const total = rows.reduce((s, r) => s + rupeesToPaise(r.bonus), 0);
    const [updated] = await tx
      .update(bonusRuns)
      .set({
        status: "calculated",
        employeeCount: rows.length,
        eligibleCount: rows.filter((r) => r.eligible).length,
        totalBonus: paiseToRupees(total),
        rules: { ...rules, ratesSource: loaded.source, verifiedNote: loaded.verifiedNote, verifiedOn: loaded.verifiedOn },
        warnings,
        calculatedAt: new Date(),
        calculatedByUserId: input.actor.id,
        calculatedByName: input.actor.name,
        submittedAt: null,
        submittedByUserId: null,
        updatedAt: new Date(),
      })
      .where(eq(bonusRuns.id, run.id))
      .returning();
    return { run: updated!, warnings };
  });
}

export async function submitBonusRun(db: TenantDatabase, input: { businessId: string; id: string; actor: Actor }): Promise<RunRow> {
  return db.transaction(async (tx) => {
    const run = await lockBonusRun(tx, input.businessId, input.id);
    requireStatus(run, ["calculated"], "Submitting for approval");
    if (run.employeeCount === 0) throw badRequest("The bonus run has no employee lines. Calculate it first.");
    const [updated] = await tx.update(bonusRuns).set({ status: "pending_approval", submittedAt: new Date(), submittedByUserId: input.actor.id, updatedAt: new Date() }).where(eq(bonusRuns.id, run.id)).returning();
    return updated!;
  });
}

export async function approveBonusRun(db: TenantDatabase, input: { businessId: string; id: string; actor: Actor }): Promise<RunRow> {
  return db.transaction(async (tx) => {
    const run = await lockBonusRun(tx, input.businessId, input.id);
    requireStatus(run, ["pending_approval"], "Approving");
    const [members] = await tx.select({ n: sql<number>`count(*)::int` }).from(businessMembers).where(eq(businessMembers.businessId, input.businessId));
    if (!approverAllowed({ approverUserId: input.actor.id, calculatedByUserId: run.calculatedByUserId, businessMemberCount: members?.n ?? 1 })) {
      throw new TRPCError({ code: "FORBIDDEN", message: MAKER_CHECKER_MESSAGE.replace(/payroll/g, "bonus run") });
    }
    const lines: Array<typeof bonusRunLines.$inferSelect> = await tx.select().from(bonusRunLines).where(eq(bonusRunLines.runId, run.id));
    if (lines.length === 0) throw badRequest("The bonus run has no employee lines.");
    // The lines must still match the run: its percentage, the hand exclusions and the full and final settlements.
    const inFnf = await bonusInFnf(tx, input.businessId, run.financialYear);
    const stale = lines.some(
      (l) =>
        Number(l.percent) !== Number(run.percent) ||
        (l.eligible && (run.exclusions?.[l.employeeId] || inFnf.has(l.employeeId))) ||
        (!l.eligible && l.reason === "manual" && !run.exclusions?.[l.employeeId] && !inFnf.has(l.employeeId)),
    );
    if (stale) throw badRequest("The bonus run changed after it was calculated. Calculate it again before approving.");
    const sum = lines.reduce((s, l) => s + rupeesToPaise(l.bonus), 0);
    if (paiseToRupees(sum) !== run.totalBonus) throw badRequest("The run's total no longer matches its lines. Calculate it again before approving.");
    const [updated] = await tx.update(bonusRuns).set({ status: "approved", approvedAt: new Date(), approvedByUserId: input.actor.id, approvedByName: input.actor.name, updatedAt: new Date() }).where(eq(bonusRuns.id, run.id)).returning();
    return updated!;
  });
}

/** Back to draft before approval: the calculated lines are discarded. */
export async function reopenBonusRun(db: TenantDatabase, input: { businessId: string; id: string }): Promise<RunRow> {
  return db.transaction(async (tx) => {
    const run = await lockBonusRun(tx, input.businessId, input.id);
    if (!isBonusRunEditable(run.status as BonusRunStatus) || !canTransitionBonusRun(run.status as BonusRunStatus, "draft")) {
      throw badRequest(run.status === "draft" ? "The bonus run is already a draft." : "An approved bonus run cannot be reopened.");
    }
    await tx.delete(bonusRunLines).where(eq(bonusRunLines.runId, run.id));
    const [updated] = await tx
      .update(bonusRuns)
      .set({ status: "draft", employeeCount: 0, eligibleCount: 0, totalBonus: "0", rules: null, warnings: [], calculatedAt: null, calculatedByUserId: null, calculatedByName: null, submittedAt: null, submittedByUserId: null, updatedAt: new Date() })
      .where(eq(bonusRuns.id, run.id))
      .returning();
    return updated!;
  });
}

export async function deleteBonusRun(db: TenantDatabase, input: { businessId: string; id: string }): Promise<{ deleted: true }> {
  return db.transaction(async (tx) => {
    const run = await lockBonusRun(tx, input.businessId, input.id);
    requireStatus(run, ["draft"], "Deleting");
    await tx.delete(bonusRuns).where(eq(bonusRuns.id, run.id));
    return { deleted: true as const };
  });
}

// ── Posting and paying ───────────────────────────────────────────────────────

/** The date the accrual is booked: the last day of the financial year, or today when the year has not ended. */
export function bonusEntryDate(fy: number, today = todayIst()): string {
  const end = `${fy + 1}-03-31`;
  return end <= today ? end : today;
}

export async function postBonusRun(db: TenantDatabase, input: { businessId: string; id: string; actor: Actor }): Promise<{ run: RunRow; journalEntryId: string; created: boolean }> {
  const first = await getBonusRun(db, input.businessId, input.id);
  if (first.accrualJournalEntryId) return { run: first, journalEntryId: first.accrualJournalEntryId, created: false };
  requireStatus(first, ["approved"], "Posting to the books");
  const entryDate = bonusEntryDate(first.financialYear);
  await assertPeriodOpen(db, input.businessId, [entryDate]);
  return db.transaction(async (tx) => {
    const run = await lockBonusRun(tx, input.businessId, input.id);
    if (run.accrualJournalEntryId) return { run, journalEntryId: run.accrualJournalEntryId, created: false };
    requireStatus(run, ["approved"], "Posting to the books");
    const total = rupeesToPaise(run.totalBonus);
    if (total <= 0) throw badRequest("There is nothing to post: no employee is eligible for a bonus.");
    const acc = await ensurePayrollAccounts(tx, input.businessId, ["bonus_incentives", "bonus_payable"]);
    const label = fyLabel(run.financialYear);
    const entry = await writeJournalEntry(tx, {
      businessId: input.businessId,
      entryDate: bookDate(entryDate),
      narration: `Bonus for FY ${label}`,
      userId: input.actor.id,
      userName: input.actor.name,
      lines: [
        { accountId: acc.bonus_incentives!, debitPaise: total, creditPaise: 0, narration: `Bonus ${label}` },
        { accountId: acc.bonus_payable!, debitPaise: 0, creditPaise: total, narration: `Bonus payable ${label}` },
      ],
    });
    const [updated] = await tx.update(bonusRuns).set({ status: "posted", postedAt: new Date(), postedByUserId: input.actor.id, accrualJournalEntryId: entry.id, updatedAt: new Date() }).where(eq(bonusRuns.id, run.id)).returning();
    return { run: updated!, journalEntryId: entry.id, created: true };
  });
}

export async function markBonusPaid(
  db: TenantDatabase,
  input: { businessId: string; id: string; bankAccountId: string; paidOn: string; reference?: string | null; actor: Actor },
): Promise<{ run: RunRow; journalEntryId: string | null; created: boolean }> {
  const first = await getBonusRun(db, input.businessId, input.id);
  if (first.status === "paid") return { run: first, journalEntryId: first.paymentJournalEntryId, created: false };
  requireStatus(first, ["posted"], "Marking as paid");
  await assertPeriodOpen(db, input.businessId, [input.paidOn]);
  return db.transaction(async (tx) => {
    const run = await lockBonusRun(tx, input.businessId, input.id);
    if (run.status === "paid") return { run, journalEntryId: run.paymentJournalEntryId, created: false };
    requireStatus(run, ["posted"], "Marking as paid");
    const total = rupeesToPaise(run.totalBonus);
    const acc = await ensurePayrollAccounts(tx, input.businessId, ["bonus_payable"]);
    const label = fyLabel(run.financialYear);
    const bank = await moveBank(tx, { businessId: input.businessId, bankAccountId: input.bankAccountId, direction: "out", paise: total, date: bookDate(input.paidOn), description: `Bonus for FY ${label}`, referenceType: "bonus_run", referenceId: run.id });
    const payFrom = await cashOrBankAccountId(tx, input.businessId, bank.accountType);
    const entry = await writeJournalEntry(tx, {
      businessId: input.businessId,
      entryDate: bookDate(input.paidOn),
      narration: `Bonus paid for FY ${label}`,
      userId: input.actor.id,
      userName: input.actor.name,
      lines: [
        { accountId: acc.bonus_payable!, debitPaise: total, creditPaise: 0, narration: `Bonus paid ${label}` },
        { accountId: payFrom, debitPaise: 0, creditPaise: total, narration: `Bonus paid ${label} from ${bank.accountName}` },
      ],
    });
    const [updated] = await tx
      .update(bonusRuns)
      .set({ status: "paid", paidAt: new Date(), paidOn: input.paidOn, paidByUserId: input.actor.id, paidFromBankAccountId: bank.id, paidReference: input.reference ?? null, paymentJournalEntryId: entry.id, updatedAt: new Date() })
      .where(eq(bonusRuns.id, run.id))
      .returning();
    return { run: updated!, journalEntryId: entry.id, created: true };
  });
}

// ── Reading and exporting ────────────────────────────────────────────────────

export async function listBonusRuns(db: TenantDatabase, businessId: string): Promise<RunRow[]> {
  return db.select().from(bonusRuns).where(eq(bonusRuns.businessId, businessId)).orderBy(desc(bonusRuns.financialYear));
}

export async function bonusRunDetail(db: TenantDatabase, businessId: string, id: string) {
  const run = await getBonusRun(db, businessId, id);
  const [lines, members] = await Promise.all([
    db.select().from(bonusRunLines).where(eq(bonusRunLines.runId, run.id)).orderBy(asc(bonusRunLines.employeeCode)),
    db.select({ n: sql<number>`count(*)::int` }).from(businessMembers).where(eq(businessMembers.businessId, businessId)),
  ]);
  return { run, lines, memberCount: members[0]?.n ?? 1 };
}

export async function bonusStatement(db: TenantDatabase, businessId: string, id: string) {
  const { run, lines } = await bonusRunDetail(db, businessId, id);
  if (run.status === "draft" || lines.length === 0) throw badRequest("Calculate the bonus run first.");
  const label = fyLabel(run.financialYear);
  const csv = buildBonusStatementCsv(
    label,
    lines.map((l) => ({
      employeeCode: l.employeeCode,
      name: l.employeeName,
      monthsPaid: l.monthsPaid,
      daysPaid: Number(l.daysPaid),
      wagesPaise: rupeesToPaise(l.wages),
      calculationWagesPaise: rupeesToPaise(l.calculationWages),
      eligible: l.eligible,
      reasonText: l.reasonText,
      percent: Number(l.percent),
      bonusPaise: rupeesToPaise(l.bonus),
    })),
  );
  const [biz] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  return { run, lines, label, csv, filename: `bonus-statement-${label}`, business: biz! };
}

export async function bonusBankFile(db: TenantDatabase, businessId: string, id: string) {
  const { run, lines } = await bonusRunDetail(db, businessId, id);
  if (!FINAL.includes(run.status)) throw badRequest("The bank file is available once the bonus run is approved.");
  const payable = lines.filter((l) => l.eligible && rupeesToPaise(l.bonus) > 0);
  const emps = payable.length ? await db.select().from(employees).where(and(eq(employees.businessId, businessId), inArray(employees.id, payable.map((l) => l.employeeId)))) : [];
  const empById = new Map(emps.map((e) => [e.id, e]));
  const label = fyLabel(run.financialYear);
  const built = buildBankPaymentCsv(
    payable.map((l) => {
      const e = empById.get(l.employeeId);
      return { employeeCode: l.employeeCode, beneficiaryName: e?.bankAccountName || l.employeeName, accountNumber: decryptSensitive(e?.bankAccountNumber) ?? "", ifsc: e?.bankIfsc ?? "", amountPaise: rupeesToPaise(l.bonus), narration: `Bonus ${label}` };
    }),
  );
  return { filename: `bonus-${label}.csv`, contentType: "text/csv" as const, csv: built.csv, count: built.count, total: paiseToRupees(built.totalPaise), skipped: built.skipped };
}
