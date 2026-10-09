/**
 * Loans and advances to employees (Payroll Phase 4).
 *
 * Lifecycle: issued (pending approval) -> approved (maker-checker) -> disbursed (posted to the books: Dr 1260 Loans and
 * Advances to Employees / Cr bank or cash) -> instalments recovered through payroll runs (each run's approval records the
 * recovery) -> closed. A prepayment or foreclosure received in cash/bank posts Dr bank / Cr 1260 (and Cr 4110 for interest).
 *
 * The balance of a loan is its principal less the principal recovered, summed from employee_loan_events (the event log is
 * also the statement). Instalments are a schedule: replaced, never edited, when the loan is prepaid, skipped or rescheduled.
 * Interest is on the reducing balance, monthly; a skipped month adds no interest (documented simplification). The balance
 * recovered in a full and final settlement is the PRINCIPAL outstanding only.
 */

import { and, asc, desc, eq, inArray, lte, ne, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  employeeLoanEvents,
  employeeLoanInstallments,
  employeeLoans,
  employees,
  fnfSettlements,
  businessMembers,
  type TenantDatabase,
} from "@fintranzact/db";
import {
  addMonths,
  approverAllowed,
  buildLoanStatementCsv,
  buildRepaymentSchedule,
  istDateParts,
  paiseToRupees,
  planLoanRecovery,
  rupeesToPaise,
  sequenceNumber,
  type LoanCreateInput,
  type LoanDue,
  type LoanStatus,
} from "@fintranzact/shared";
import { assertPeriodOpen } from "../period-lock.js";
import { badRequest, notFound } from "./access.js";
import { bookDate, cashOrBankAccountId, ensurePayrollAccounts, moveBank, writeJournalEntry } from "./books.js";
import type { Actor } from "./run.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;
type LoanRow = typeof employeeLoans.$inferSelect;
type InstallmentRow = typeof employeeLoanInstallments.$inferSelect;

const LOAN_STATUS_TEXT: Record<LoanStatus, string> = {
  pending_approval: "pending approval",
  approved: "approved",
  active: "active",
  closed: "closed",
  rejected: "rejected",
  cancelled: "cancelled",
};

export const LOAN_MAKER_CHECKER_MESSAGE =
  "The person who requested this loan cannot approve it. Ask another owner or admin to approve it (a business with a single user can approve its own loans).";

/** Event kinds that reduce the principal outstanding. */
export const PRINCIPAL_RECOVERY_KINDS = ["emi_recovered", "prepaid", "foreclosed", "fnf_recovered"] as const;
/** `fnf_reversed` puts back what a reversed settlement had recovered: it counts against the recoveries. */
export const PRINCIPAL_PUT_BACK_KIND = "fnf_reversed";

function todayIst(): string {
  const p = istDateParts(new Date());
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function currentMonthIst(): string {
  return todayIst().slice(0, 7);
}

async function lockLoan(tx: Tx, businessId: string, loanId: string): Promise<LoanRow> {
  const [loan] = await tx
    .select()
    .from(employeeLoans)
    .where(and(eq(employeeLoans.id, loanId), eq(employeeLoans.businessId, businessId)))
    .for("update")
    .limit(1);
  if (!loan) throw notFound("Loan");
  return loan as LoanRow;
}

/** Principal still outstanding, paise. */
export async function outstandingPaise(tx: Tx, loan: Pick<LoanRow, "id" | "principal">): Promise<number> {
  const [row] = await tx
    .select({ p: sql<string>`COALESCE(SUM(CASE WHEN ${employeeLoanEvents.kind} = 'fnf_reversed' THEN -${employeeLoanEvents.principal} ELSE ${employeeLoanEvents.principal} END), 0)::text` })
    .from(employeeLoanEvents)
    .where(and(eq(employeeLoanEvents.loanId, loan.id), inArray(employeeLoanEvents.kind, [...PRINCIPAL_RECOVERY_KINDS, PRINCIPAL_PUT_BACK_KIND])));
  return rupeesToPaise(loan.principal) - rupeesToPaise(row?.p ?? "0");
}

async function addEvent(
  tx: Tx,
  loan: Pick<LoanRow, "id" | "businessId" | "employeeId">,
  e: {
    kind: string;
    date: string;
    principalPaise?: number;
    interestPaise?: number;
    balancePaise: number;
    runId?: string | null;
    settlementId?: string | null;
    journalEntryId?: string | null;
    bankAccountId?: string | null;
    note?: string | null;
    actor?: Actor | null;
  },
) {
  await tx.insert(employeeLoanEvents).values({
    loanId: loan.id,
    businessId: loan.businessId,
    employeeId: loan.employeeId,
    kind: e.kind,
    eventDate: e.date,
    principal: paiseToRupees(e.principalPaise ?? 0),
    interest: paiseToRupees(e.interestPaise ?? 0),
    balanceAfter: paiseToRupees(e.balancePaise),
    runId: e.runId ?? null,
    settlementId: e.settlementId ?? null,
    journalEntryId: e.journalEntryId ?? null,
    bankAccountId: e.bankAccountId ?? null,
    note: e.note ?? null,
    createdByUserId: e.actor?.id ?? null,
    createdByName: e.actor?.name ?? null,
    // The statement is ordered by this: clock_timestamp() moves on inside a transaction, now() does not.
    createdAt: sql`clock_timestamp()`,
  });
}

/** The next number in a business-wide series (LN-0001...). Serialised per business with an advisory lock. */
export async function nextSeriesNumber(tx: Tx, businessId: string, series: "loan" | "fnf"): Promise<string> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`payroll4:${series}:${businessId}`}))`);
  const [row] =
    series === "loan"
      ? await tx.select({ n: sql<number>`COALESCE(MAX(CAST(SUBSTRING(${employeeLoans.number} FROM '[0-9]+$') AS INTEGER)), 0)` }).from(employeeLoans).where(eq(employeeLoans.businessId, businessId))
      : await tx.select({ n: sql<number>`COALESCE(MAX(CAST(SUBSTRING(${fnfSettlements.number} FROM '[0-9]+$') AS INTEGER)), 0)` }).from(fnfSettlements).where(eq(fnfSettlements.businessId, businessId));
  return sequenceNumber(series === "loan" ? "LN" : "FF", (row?.n ?? 0) + 1);
}

// ── Issue, approve, reject, cancel ───────────────────────────────────────────

function scheduleFor(input: { amountPaise: number; interestRate: number; startMonth: string; installments?: number; emiPaise?: number }) {
  try {
    return buildRepaymentSchedule({
      principalPaise: input.amountPaise,
      annualRatePct: input.interestRate,
      firstMonth: input.startMonth,
      count: input.installments,
      emiPaise: input.emiPaise,
    });
  } catch (e) {
    throw badRequest((e as Error).message);
  }
}

/** The schedule a loan would have (for the preview and for issuing it). */
export function previewSchedule(input: { amount: number; interestRate: number; startMonth: string; installments?: number; emi?: number }) {
  const rows = scheduleFor({
    amountPaise: rupeesToPaise(input.amount),
    interestRate: input.interestRate,
    startMonth: input.startMonth,
    installments: input.installments,
    emiPaise: input.emi != null ? rupeesToPaise(input.emi) : undefined,
  });
  return {
    rows: rows.map((r) => ({ seq: r.seq, month: r.month, opening: paiseToRupees(r.openingPaise), principal: paiseToRupees(r.principalPaise), interest: paiseToRupees(r.interestPaise), emi: paiseToRupees(r.emiPaise), closing: paiseToRupees(r.closingPaise) })),
    emi: paiseToRupees(rows[0]?.emiPaise ?? 0),
    count: rows.length,
    totalInterest: paiseToRupees(rows.reduce((s, r) => s + r.interestPaise, 0)),
    totalPayable: paiseToRupees(rows.reduce((s, r) => s + r.emiPaise, 0)),
  };
}

export async function createLoan(db: TenantDatabase, input: { businessId: string; data: LoanCreateInput; actor: Actor }): Promise<LoanRow> {
  const d = input.data;
  const [emp] = await db.select().from(employees).where(and(eq(employees.id, d.employeeId), eq(employees.businessId, input.businessId))).limit(1);
  if (!emp) throw notFound("Employee");
  if (emp.status !== "active") throw badRequest("A loan or advance can only be issued to an active employee.");
  if (d.startMonth < d.issueDate.slice(0, 7)) throw badRequest("The first instalment month cannot be before the month the loan is issued.");
  const amountPaise = rupeesToPaise(d.amount);
  const rows = scheduleFor({ amountPaise, interestRate: d.interestRate, startMonth: d.startMonth, installments: d.installments, emiPaise: d.emi != null ? rupeesToPaise(d.emi) : undefined });
  return db.transaction(async (tx) => {
    const number = await nextSeriesNumber(tx, input.businessId, "loan");
    const [loan] = await tx
      .insert(employeeLoans)
      .values({
        businessId: input.businessId,
        employeeId: emp.id,
        number,
        kind: d.kind,
        status: "pending_approval",
        principal: paiseToRupees(amountPaise),
        interestRate: String(d.interestRate),
        installmentCount: rows.length,
        emi: paiseToRupees(rows[0]!.emiPaise),
        startMonth: d.startMonth,
        issueDate: d.issueDate,
        purpose: d.purpose || null,
        requestedByUserId: input.actor.id,
        requestedByName: input.actor.name,
      })
      .returning();
    await tx.insert(employeeLoanInstallments).values(
      rows.map((r) => ({ loanId: loan!.id, businessId: input.businessId, seq: r.seq, dueMonth: r.month, principal: paiseToRupees(r.principalPaise), interest: paiseToRupees(r.interestPaise) })),
    );
    await addEvent(tx, loan!, { kind: "issued", date: d.issueDate, balancePaise: 0, note: d.purpose || null, actor: input.actor });
    return loan!;
  });
}

export async function approveLoan(db: TenantDatabase, input: { businessId: string; id: string; actor: Actor; note?: string | null }): Promise<LoanRow> {
  return db.transaction(async (tx) => {
    const loan = await lockLoan(tx, input.businessId, input.id);
    if (loan.status !== "pending_approval") throw badRequest(`This loan is "${LOAN_STATUS_TEXT[loan.status as LoanStatus] ?? loan.status}", so it cannot be approved.`);
    const [members] = await tx.select({ n: sql<number>`count(*)::int` }).from(businessMembers).where(eq(businessMembers.businessId, input.businessId));
    if (!approverAllowed({ approverUserId: input.actor.id, calculatedByUserId: loan.requestedByUserId, businessMemberCount: members?.n ?? 1 })) {
      throw new TRPCError({ code: "FORBIDDEN", message: LOAN_MAKER_CHECKER_MESSAGE });
    }
    const [updated] = await tx
      .update(employeeLoans)
      .set({ status: "approved", approvedAt: new Date(), approvedByUserId: input.actor.id, approvedByName: input.actor.name, decisionNote: input.note ?? null, updatedAt: new Date() })
      .where(eq(employeeLoans.id, loan.id))
      .returning();
    await addEvent(tx, loan, { kind: "approved", date: todayIst(), balancePaise: 0, note: input.note ?? null, actor: input.actor });
    return updated!;
  });
}

export async function rejectLoan(db: TenantDatabase, input: { businessId: string; id: string; actor: Actor; note: string }): Promise<LoanRow> {
  return db.transaction(async (tx) => {
    const loan = await lockLoan(tx, input.businessId, input.id);
    if (loan.status !== "pending_approval") throw badRequest("Only a loan that is waiting for approval can be rejected.");
    const [updated] = await tx.update(employeeLoans).set({ status: "rejected", decisionNote: input.note, updatedAt: new Date() }).where(eq(employeeLoans.id, loan.id)).returning();
    await supersedeOpen(tx, loan.id);
    await addEvent(tx, loan, { kind: "rejected", date: todayIst(), balancePaise: 0, note: input.note, actor: input.actor });
    return updated!;
  });
}

/** Withdraw a loan that has not been disbursed. */
export async function cancelLoan(db: TenantDatabase, input: { businessId: string; id: string; actor: Actor }): Promise<LoanRow> {
  return db.transaction(async (tx) => {
    const loan = await lockLoan(tx, input.businessId, input.id);
    if (loan.status !== "pending_approval" && loan.status !== "approved") throw badRequest("Only a loan that has not been disbursed can be cancelled.");
    const [updated] = await tx.update(employeeLoans).set({ status: "cancelled", updatedAt: new Date() }).where(eq(employeeLoans.id, loan.id)).returning();
    await supersedeOpen(tx, loan.id);
    await addEvent(tx, loan, { kind: "cancelled", date: todayIst(), balancePaise: 0, actor: input.actor });
    return updated!;
  });
}

async function supersedeOpen(tx: Tx, loanId: string) {
  await tx.update(employeeLoanInstallments).set({ status: "superseded" }).where(and(eq(employeeLoanInstallments.loanId, loanId), eq(employeeLoanInstallments.status, "open")));
}

// ── Disbursement ─────────────────────────────────────────────────────────────

export async function disburseLoan(
  db: TenantDatabase,
  input: { businessId: string; id: string; bankAccountId: string; paidOn: string; reference?: string | null; actor: Actor },
): Promise<{ loan: LoanRow; journalEntryId: string }> {
  await assertPeriodOpen(db, input.businessId, [input.paidOn]);
  return db.transaction(async (tx) => {
    const loan = await lockLoan(tx, input.businessId, input.id);
    if (loan.status === "active" && loan.disbursementJournalEntryId) return { loan, journalEntryId: loan.disbursementJournalEntryId };
    if (loan.status !== "approved") throw badRequest(loan.status === "pending_approval" ? "Approve the loan before disbursing it." : `This loan is ${LOAN_STATUS_TEXT[loan.status as LoanStatus] ?? loan.status}, so it cannot be disbursed.`);
    const paise = rupeesToPaise(loan.principal);
    const [emp] = await tx.select({ name: employees.name, code: employees.employeeCode }).from(employees).where(eq(employees.id, loan.employeeId)).limit(1);
    const acc = await ensurePayrollAccounts(tx, input.businessId, ["loans_receivable"]);
    const bank = await moveBank(tx, { businessId: input.businessId, bankAccountId: input.bankAccountId, direction: "out", paise, date: bookDate(input.paidOn), description: `${loan.kind === "advance" ? "Advance" : "Loan"} ${loan.number} to ${emp?.name ?? "employee"}`, referenceType: "employee_loan", referenceId: loan.id });
    const payFrom = await cashOrBankAccountId(tx, input.businessId, bank.accountType);
    const entry = await writeJournalEntry(tx, {
      businessId: input.businessId,
      entryDate: bookDate(input.paidOn),
      narration: `${loan.kind === "advance" ? "Advance" : "Loan"} ${loan.number} to ${emp?.name ?? "employee"} (${emp?.code ?? ""})`,
      userId: input.actor.id,
      userName: input.actor.name,
      lines: [
        { accountId: acc.loans_receivable!, debitPaise: paise, creditPaise: 0, narration: `${loan.number} ${emp?.name ?? ""}` },
        { accountId: payFrom, debitPaise: 0, creditPaise: paise, narration: `${loan.number} paid from ${bank.accountName}` },
      ],
    });
    const [updated] = await tx
      .update(employeeLoans)
      .set({ status: "active", disbursedAt: new Date(), disbursedOn: input.paidOn, disbursedByUserId: input.actor.id, disbursedFromBankAccountId: bank.id, disbursementReference: input.reference ?? null, disbursementJournalEntryId: entry.id, updatedAt: new Date() })
      .where(eq(employeeLoans.id, loan.id))
      .returning();
    await addEvent(tx, loan, { kind: "disbursed", date: input.paidOn, balancePaise: paise, journalEntryId: entry.id, bankAccountId: bank.id, note: input.reference ?? null, actor: input.actor });
    return { loan: updated!, journalEntryId: entry.id };
  });
}

// ── Prepayment, foreclosure ──────────────────────────────────────────────────

/**
 * The employee pays back part of the balance (`foreclose: false`, same EMI, shorter loan) or all of it (`foreclose: true`),
 * in cash or to a bank account. Interest paid with it (optional) goes to 4110. Posts Dr bank or cash / Cr 1260 (/ Cr 4110).
 */
export async function receiveLoanPayment(
  db: TenantDatabase,
  input: { businessId: string; id: string; bankAccountId: string; receivedOn: string; amountPaise?: number; interestPaise: number; foreclose: boolean; reference?: string | null; actor: Actor },
): Promise<{ loan: LoanRow; journalEntryId: string; principalPaise: number; balancePaise: number }> {
  await assertPeriodOpen(db, input.businessId, [input.receivedOn]);
  return db.transaction(async (tx) => {
    const loan = await lockLoan(tx, input.businessId, input.id);
    if (loan.status !== "active") throw badRequest("Only an active loan can receive a payment.");
    const outstanding = await outstandingPaise(tx, loan);
    if (outstanding <= 0) throw badRequest("There is nothing outstanding on this loan.");
    const principalPaise = input.foreclose ? outstanding : input.amountPaise ?? 0;
    if (!(principalPaise > 0)) throw badRequest("Enter the amount received.");
    if (principalPaise > outstanding) throw badRequest(`Only ₹${paiseToRupees(outstanding)} is outstanding on this loan.`);
    const full = principalPaise === outstanding;
    const total = principalPaise + input.interestPaise;
    const acc = await ensurePayrollAccounts(tx, input.businessId, input.interestPaise > 0 ? ["loans_receivable", "loan_interest_income"] : ["loans_receivable"]);
    const bank = await moveBank(tx, { businessId: input.businessId, bankAccountId: input.bankAccountId, direction: "in", paise: total, date: bookDate(input.receivedOn), description: `${full ? "Foreclosure" : "Prepayment"} of ${loan.number}`, referenceType: "employee_loan", referenceId: loan.id });
    const receiveTo = await cashOrBankAccountId(tx, input.businessId, bank.accountType);
    const entry = await writeJournalEntry(tx, {
      businessId: input.businessId,
      entryDate: bookDate(input.receivedOn),
      narration: `${full ? "Foreclosure" : "Part-payment"} received on ${loan.number}`,
      userId: input.actor.id,
      userName: input.actor.name,
      lines: [
        { accountId: receiveTo, debitPaise: total, creditPaise: 0, narration: `${loan.number} received into ${bank.accountName}` },
        { accountId: acc.loans_receivable!, debitPaise: 0, creditPaise: principalPaise, narration: `${loan.number} principal` },
        ...(input.interestPaise > 0 ? [{ accountId: acc.loan_interest_income!, debitPaise: 0, creditPaise: input.interestPaise, narration: `${loan.number} interest` }] : []),
      ],
    });
    const balance = outstanding - principalPaise;
    await addEvent(tx, loan, { kind: full ? "foreclosed" : "prepaid", date: input.receivedOn, principalPaise, interestPaise: input.interestPaise, balancePaise: balance, journalEntryId: entry.id, bankAccountId: bank.id, note: input.reference ?? null, actor: input.actor });
    let updated = loan;
    if (full) {
      await supersedeOpen(tx, loan.id);
      [updated] = await tx.update(employeeLoans).set({ status: "closed", closedAt: new Date(), updatedAt: new Date() }).where(eq(employeeLoans.id, loan.id)).returning();
      await addEvent(tx, loan, { kind: "closed", date: input.receivedOn, balancePaise: 0, actor: input.actor });
    } else {
      await rebuildSchedule(tx, loan, { emiPaise: rupeesToPaise(loan.emi), balancePaise: balance });
    }
    return { loan: updated!, journalEntryId: entry.id, principalPaise, balancePaise: balance };
  });
}

/**
 * Replace the open instalments with a new schedule for the balance. `firstMonth` defaults to the month of the earliest open
 * instalment (or the next month). Interest unpaid on replaced instalments is not carried (the new schedule charges interest
 * on the new balance only).
 */
async function rebuildSchedule(
  tx: Tx,
  loan: LoanRow,
  opts: { emiPaise?: number; count?: number; balancePaise: number; firstMonth?: string },
): Promise<InstallmentRow[]> {
  const open: InstallmentRow[] = await tx
    .select()
    .from(employeeLoanInstallments)
    .where(and(eq(employeeLoanInstallments.loanId, loan.id), eq(employeeLoanInstallments.status, "open")))
    .orderBy(asc(employeeLoanInstallments.seq));
  const firstMonth = opts.firstMonth ?? open[0]?.dueMonth ?? addMonths(currentMonthIst(), 1);
  await supersedeOpen(tx, loan.id);
  if (opts.balancePaise <= 0) return [];
  const [mx] = await tx.select({ n: sql<number>`COALESCE(MAX(${employeeLoanInstallments.seq}), 0)` }).from(employeeLoanInstallments).where(eq(employeeLoanInstallments.loanId, loan.id));
  const rows = scheduleFor({ amountPaise: opts.balancePaise, interestRate: Number(loan.interestRate), startMonth: firstMonth, installments: opts.count, emiPaise: opts.count ? undefined : opts.emiPaise });
  const inserted: InstallmentRow[] = await tx
    .insert(employeeLoanInstallments)
    .values(rows.map((r) => ({ loanId: loan.id, businessId: loan.businessId, seq: (mx?.n ?? 0) + r.seq, dueMonth: r.month, principal: paiseToRupees(r.principalPaise), interest: paiseToRupees(r.interestPaise) })))
    .returning();
  await tx.update(employeeLoans).set({ emi: paiseToRupees(rows[0]!.emiPaise), updatedAt: new Date() }).where(eq(employeeLoans.id, loan.id));
  return inserted;
}

// ── Skip and reschedule ──────────────────────────────────────────────────────

/** Skip the next open instalment (it is not recovered; everything after it moves one month later). No interest is charged for the skipped month. */
export async function skipInstalment(db: TenantDatabase, input: { businessId: string; id: string; reason: string; actor: Actor }): Promise<LoanRow> {
  return db.transaction(async (tx) => {
    const loan = await lockLoan(tx, input.businessId, input.id);
    if (loan.status !== "active") throw badRequest("Only an active loan has instalments to skip.");
    const [next]: InstallmentRow[] = await tx
      .select()
      .from(employeeLoanInstallments)
      .where(and(eq(employeeLoanInstallments.loanId, loan.id), eq(employeeLoanInstallments.status, "open")))
      .orderBy(asc(employeeLoanInstallments.seq))
      .limit(1);
    if (!next) throw badRequest("There is no open instalment to skip.");
    const outstanding = await outstandingPaise(tx, loan);
    await tx.update(employeeLoanInstallments).set({ status: "skipped", note: input.reason }).where(eq(employeeLoanInstallments.id, next.id));
    await rebuildSchedule(tx, loan, { emiPaise: rupeesToPaise(loan.emi), balancePaise: outstanding, firstMonth: addMonths(next.dueMonth, 1) });
    await addEvent(tx, loan, { kind: "skipped", date: todayIst(), balancePaise: outstanding, note: `Instalment ${next.seq} (${next.dueMonth}) skipped: ${input.reason}`, actor: input.actor });
    return loan;
  });
}

/** Re-plan what is left: a new number of instalments or a new EMI, starting from a month. */
export async function rescheduleLoan(
  db: TenantDatabase,
  input: { businessId: string; id: string; reason: string; installments?: number; emiPaise?: number; firstMonth: string; actor: Actor },
): Promise<LoanRow> {
  return db.transaction(async (tx) => {
    const loan = await lockLoan(tx, input.businessId, input.id);
    if (loan.status !== "active") throw badRequest("Only an active loan can be rescheduled.");
    const outstanding = await outstandingPaise(tx, loan);
    if (outstanding <= 0) throw badRequest("There is nothing outstanding on this loan.");
    await rebuildSchedule(tx, loan, { count: input.installments, emiPaise: input.emiPaise, balancePaise: outstanding, firstMonth: input.firstMonth });
    await addEvent(tx, loan, { kind: "rescheduled", date: todayIst(), balancePaise: outstanding, note: input.reason, actor: input.actor });
    const [updated] = await tx.select().from(employeeLoans).where(eq(employeeLoans.id, loan.id)).limit(1);
    return updated!;
  });
}

// ── Reading ──────────────────────────────────────────────────────────────────

export interface LoanView {
  loan: LoanRow;
  employeeName: string;
  employeeCode: string;
  outstanding: string;
  recoveredPrincipal: string;
  recoveredInterest: string;
  nextDueMonth: string | null;
}

export async function listLoans(db: TenantDatabase, businessId: string, filter: { employeeId?: string; status?: string } = {}): Promise<LoanView[]> {
  const where = [eq(employeeLoans.businessId, businessId)];
  if (filter.employeeId) where.push(eq(employeeLoans.employeeId, filter.employeeId));
  if (filter.status) where.push(eq(employeeLoans.status, filter.status));
  const rows = await db
    .select({ loan: employeeLoans, name: employees.name, code: employees.employeeCode })
    .from(employeeLoans)
    .innerJoin(employees, eq(employees.id, employeeLoans.employeeId))
    .where(and(...where))
    .orderBy(desc(employeeLoans.createdAt));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.loan.id);
  const sums = await db
    .select({
      loanId: employeeLoanEvents.loanId,
      principal: sql<string>`COALESCE(SUM(CASE WHEN ${employeeLoanEvents.kind} = 'fnf_reversed' THEN -${employeeLoanEvents.principal} ELSE ${employeeLoanEvents.principal} END) FILTER (WHERE ${employeeLoanEvents.kind} IN ('emi_recovered', 'prepaid', 'foreclosed', 'fnf_recovered', 'fnf_reversed')), 0)::text`,
      interest: sql<string>`COALESCE(SUM(${employeeLoanEvents.interest}) FILTER (WHERE ${employeeLoanEvents.kind} IN ('emi_recovered', 'prepaid', 'foreclosed')), 0)::text`,
    })
    .from(employeeLoanEvents)
    .where(inArray(employeeLoanEvents.loanId, ids))
    .groupBy(employeeLoanEvents.loanId);
  const next = await db
    .select({ loanId: employeeLoanInstallments.loanId, m: sql<string>`MIN(${employeeLoanInstallments.dueMonth})` })
    .from(employeeLoanInstallments)
    .where(and(inArray(employeeLoanInstallments.loanId, ids), eq(employeeLoanInstallments.status, "open")))
    .groupBy(employeeLoanInstallments.loanId);
  const sumBy = new Map(sums.map((s) => [s.loanId, s]));
  const nextBy = new Map(next.map((n) => [n.loanId, n.m]));
  return rows.map((r) => {
    const s = sumBy.get(r.loan.id);
    const recovered = rupeesToPaise(s?.principal ?? "0");
    const disbursed = r.loan.status === "active" || r.loan.status === "closed";
    return {
      loan: r.loan,
      employeeName: r.name,
      employeeCode: r.code,
      outstanding: disbursed ? paiseToRupees(rupeesToPaise(r.loan.principal) - recovered) : "0.00",
      recoveredPrincipal: paiseToRupees(recovered),
      recoveredInterest: s?.interest ?? "0.00",
      nextDueMonth: nextBy.get(r.loan.id) ?? null,
    };
  });
}

export async function loanDetail(db: TenantDatabase, businessId: string, id: string) {
  const [view] = (await listLoans(db, businessId)).filter((v) => v.loan.id === id);
  if (!view) throw notFound("Loan");
  const [installments, events] = await Promise.all([
    db.select().from(employeeLoanInstallments).where(eq(employeeLoanInstallments.loanId, id)).orderBy(asc(employeeLoanInstallments.seq)),
    db.select().from(employeeLoanEvents).where(eq(employeeLoanEvents.loanId, id)).orderBy(asc(employeeLoanEvents.createdAt)),
  ]);
  return { ...view, installments, events };
}

export async function loanStatementCsv(db: TenantDatabase, businessId: string, id: string): Promise<{ filename: string; csv: string; number: string }> {
  const d = await loanDetail(db, businessId, id);
  const csv = buildLoanStatementCsv(
    d.events.map((e) => ({ date: e.eventDate, kind: e.kind.replace(/_/g, " "), principalPaise: rupeesToPaise(e.principal), interestPaise: rupeesToPaise(e.interest), balancePaise: rupeesToPaise(e.balanceAfter), note: e.note ?? "" })),
  );
  return { filename: `loan-statement-${d.loan.number}.csv`, csv, number: d.loan.number };
}

// ── Payroll run integration ──────────────────────────────────────────────────

/**
 * The loan instalments due for the employees of a run: every open instalment due in the run's month or earlier (earlier ones
 * are arrears). Employees with a full and final settlement in progress are left out (the balance is recovered there); they
 * are returned in `blockedByFnf` so the run can say so.
 */
export async function loadLoanDues(tx: Tx, businessId: string, month: string, employeeIds: string[]): Promise<{ dues: Map<string, LoanDue[]>; blockedByFnf: Map<string, string[]> }> {
  const dues = new Map<string, LoanDue[]>();
  const blockedByFnf = new Map<string, string[]>();
  if (employeeIds.length === 0) return { dues, blockedByFnf };
  const rows: Array<{ loan: LoanRow; inst: InstallmentRow }> = await tx
    .select({ loan: employeeLoans, inst: employeeLoanInstallments })
    .from(employeeLoanInstallments)
    .innerJoin(employeeLoans, eq(employeeLoans.id, employeeLoanInstallments.loanId))
    .where(
      and(
        eq(employeeLoans.businessId, businessId),
        eq(employeeLoans.status, "active"),
        inArray(employeeLoans.employeeId, employeeIds),
        eq(employeeLoanInstallments.status, "open"),
        lte(employeeLoanInstallments.dueMonth, month),
      ),
    )
    .orderBy(asc(employeeLoans.number), asc(employeeLoanInstallments.seq));
  // A reversed settlement recovers nothing any more, so it does not keep the employee's loans out of a run.
  const withFnf: Array<{ employeeId: string }> = await tx.select({ employeeId: fnfSettlements.employeeId }).from(fnfSettlements).where(and(eq(fnfSettlements.businessId, businessId), inArray(fnfSettlements.employeeId, employeeIds), ne(fnfSettlements.status, "reversed")));
  const fnfSet = new Set(withFnf.map((f) => f.employeeId));
  type MutableDue = { loanId: string; loanNumber: string; installments: LoanDue["installments"][number][] };
  const byLoan = new Map<string, MutableDue>();
  for (const r of rows) {
    const principalDue = rupeesToPaise(r.inst.principal) - rupeesToPaise(r.inst.paidPrincipal);
    const interestDue = rupeesToPaise(r.inst.interest) - rupeesToPaise(r.inst.paidInterest);
    if (principalDue + interestDue <= 0) continue;
    if (fnfSet.has(r.loan.employeeId)) {
      blockedByFnf.set(r.loan.employeeId, [...(blockedByFnf.get(r.loan.employeeId) ?? []), r.loan.number]);
      continue;
    }
    let due = byLoan.get(r.loan.id);
    if (!due) {
      due = { loanId: r.loan.id, loanNumber: r.loan.number, installments: [] };
      byLoan.set(r.loan.id, due);
      dues.set(r.loan.employeeId, [...(dues.get(r.loan.employeeId) ?? []), due]);
    }
    due.installments.push({ installmentId: r.inst.id, seq: r.inst.seq, dueMonth: r.inst.dueMonth, principalDuePaise: principalDue, interestDuePaise: interestDue });
  }
  return { dues, blockedByFnf };
}

interface LineLike {
  employeeId: string;
  employeeName: string;
  netPay: string;
  components: ReadonlyArray<{ source: string; amount: string; loanId?: string; loanPart?: string }>;
}

/**
 * Approval of a run records the loan recoveries its lines carry. The plan is worked out again from today's balances and must
 * equal what the line froze; if a loan changed in between (prepaid, skipped, rescheduled, settled in full and final) the run
 * must be calculated again. Returns nothing; throws to refuse the approval.
 */
export async function applyRunLoanRecoveries(
  tx: Tx,
  input: { businessId: string; runId: string; month: string; lines: readonly LineLike[]; maxSharePercent: number; actor: Actor },
): Promise<void> {
  const withLoans = input.lines.filter((l) => l.components.some((c) => c.source === "loan"));
  if (withLoans.length === 0) return;
  const loanIds = [...new Set(withLoans.flatMap((l) => l.components.filter((c) => c.source === "loan" && c.loanId).map((c) => c.loanId!)))].sort();
  const locked: LoanRow[] = await tx.select().from(employeeLoans).where(and(eq(employeeLoans.businessId, input.businessId), inArray(employeeLoans.id, loanIds))).orderBy(asc(employeeLoans.id)).for("update");
  const loanById = new Map(locked.map((l) => [l.id, l]));
  const { dues } = await loadLoanDues(tx, input.businessId, input.month, [...new Set(locked.map((l) => l.employeeId))]);

  const date = `${input.month}-01`;
  for (const line of withLoans) {
    const lineLoans = line.components.filter((c) => c.source === "loan" && c.loanId);
    const employeeId = line.employeeId;
    if (lineLoans.some((c) => !loanById.has(c.loanId!))) throw badRequest(`${line.employeeName}: a loan on this payslip no longer exists. Calculate the run again.`);
    const frozen = new Map<string, { principal: number; interest: number }>();
    for (const c of lineLoans) {
      const f = frozen.get(c.loanId!) ?? { principal: 0, interest: 0 };
      if (c.loanPart === "interest") f.interest += rupeesToPaise(c.amount);
      else f.principal += rupeesToPaise(c.amount);
      frozen.set(c.loanId!, f);
    }
    const netBefore = rupeesToPaise(line.netPay) + [...frozen.values()].reduce((s, f) => s + f.principal + f.interest, 0);
    const plan = planLoanRecovery({ netPaise: netBefore, maxSharePercent: input.maxSharePercent, loans: dues.get(employeeId) ?? [] });
    const planned = new Map(plan.lines.filter((l) => l.totalPaise > 0).map((l) => [l.loanId, l]));
    const same = planned.size === frozen.size && [...frozen].every(([id, f]) => planned.get(id)?.principalPaise === f.principal && planned.get(id)?.interestPaise === f.interest);
    if (!same) throw badRequest(`${line.employeeName}: loan balances changed after this run was calculated. Calculate the run again before approving.`);

    for (const pl of plan.lines) {
      if (pl.totalPaise <= 0) continue;
      const loan = loanById.get(pl.loanId)!;
      for (const a of pl.allocations) {
        const [inst] = await tx.select().from(employeeLoanInstallments).where(eq(employeeLoanInstallments.id, a.installmentId)).limit(1);
        const paidP = rupeesToPaise(inst.paidPrincipal) + a.principalPaise;
        const paidI = rupeesToPaise(inst.paidInterest) + a.interestPaise;
        const done = paidP >= rupeesToPaise(inst.principal) && paidI >= rupeesToPaise(inst.interest);
        await tx.update(employeeLoanInstallments).set({ paidPrincipal: paiseToRupees(paidP), paidInterest: paiseToRupees(paidI), status: done ? "paid" : "open" }).where(eq(employeeLoanInstallments.id, inst.id));
      }
      const before = await outstandingPaise(tx, loan);
      const after = before - pl.principalPaise;
      await addEvent(tx, loan, { kind: "emi_recovered", date, principalPaise: pl.principalPaise, interestPaise: pl.interestPaise, balancePaise: after, runId: input.runId, note: `Payroll ${input.month}`, actor: input.actor });
      if (after <= 0) {
        await tx.update(employeeLoans).set({ status: "closed", closedAt: new Date(), updatedAt: new Date() }).where(eq(employeeLoans.id, loan.id));
        await addEvent(tx, loan, { kind: "closed", date, balancePaise: 0, actor: input.actor });
      }
    }
  }
}

// ── Full and final integration ───────────────────────────────────────────────

/** The active loans of an employee with their outstanding principal (what a settlement recovers). */
export async function activeLoansOf(tx: Tx, businessId: string, employeeId: string): Promise<Array<{ loan: LoanRow; outstandingPaise: number }>> {
  const loans: LoanRow[] = await tx
    .select()
    .from(employeeLoans)
    .where(and(eq(employeeLoans.businessId, businessId), eq(employeeLoans.employeeId, employeeId), eq(employeeLoans.status, "active")))
    .orderBy(asc(employeeLoans.number));
  const out: Array<{ loan: LoanRow; outstandingPaise: number }> = [];
  for (const loan of loans) {
    const o = await outstandingPaise(tx, loan);
    if (o > 0) out.push({ loan, outstandingPaise: o });
  }
  return out;
}

/**
 * Approval of a settlement recovers the loan balances it lists: each loan's principal recovered goes on the event log, the
 * open instalments are replaced, and a loan with nothing left is closed. A loan that could not be recovered in full keeps an
 * instalment for the rest (no automatic recovery, the employee has left).
 */
export async function recoverLoansInFnf(
  tx: Tx,
  input: { businessId: string; settlementId: string; date: string; recoveries: ReadonlyArray<{ loanId: string; amountPaise: number }>; actor: Actor },
): Promise<void> {
  for (const r of [...input.recoveries].sort((a, b) => a.loanId.localeCompare(b.loanId))) {
    const loan = await lockLoan(tx, input.businessId, r.loanId);
    if (loan.status !== "active") throw badRequest(`${loan.number} is no longer active, so it cannot be recovered in the settlement. Calculate the settlement again.`);
    const outstanding = await outstandingPaise(tx, loan);
    if (r.amountPaise > outstanding) throw badRequest(`${loan.number} has only ₹${paiseToRupees(outstanding)} outstanding now. Calculate the settlement again.`);
    const after = outstanding - r.amountPaise;
    await addEvent(tx, loan, { kind: "fnf_recovered", date: input.date, principalPaise: r.amountPaise, balancePaise: after, settlementId: input.settlementId, note: "Full and final settlement", actor: input.actor });
    await supersedeOpen(tx, loan.id);
    if (after <= 0) {
      await tx.update(employeeLoans).set({ status: "closed", closedAt: new Date(), updatedAt: new Date() }).where(eq(employeeLoans.id, loan.id));
      await addEvent(tx, loan, { kind: "closed", date: input.date, balancePaise: 0, actor: input.actor });
    } else {
      const [mx] = await tx.select({ n: sql<number>`COALESCE(MAX(${employeeLoanInstallments.seq}), 0)` }).from(employeeLoanInstallments).where(eq(employeeLoanInstallments.loanId, loan.id));
      await tx.insert(employeeLoanInstallments).values({ loanId: loan.id, businessId: input.businessId, seq: (mx?.n ?? 0) + 1, dueMonth: input.date.slice(0, 7), principal: paiseToRupees(after), interest: "0", note: "Balance after full and final settlement" });
    }
  }
}

/**
 * Reversal of a settlement puts back what it recovered. For each loan the settlement recovered (`fnf_recovered`): an
 * `fnf_reversed` event restores the principal (the log is append-only, nothing is deleted; a unique index makes this
 * idempotent), a loan the settlement closed is made active again, and the remaining schedule is replaced (never edited) by a
 * new one for the restored balance at the loan's own EMI, from the next month. Refuses when the restored balance would exceed
 * the principal lent (something else moved the loan since). Returns the loans touched with the amount put back, paise.
 */
export async function reverseLoanRecoveriesOfFnf(
  tx: Tx,
  input: { businessId: string; settlementId: string; date: string; actor: Actor },
): Promise<Array<{ loanId: string; loanNumber: string; amountPaise: number }>> {
  const events: Array<typeof employeeLoanEvents.$inferSelect> = await tx
    .select()
    .from(employeeLoanEvents)
    .where(and(eq(employeeLoanEvents.businessId, input.businessId), eq(employeeLoanEvents.settlementId, input.settlementId), eq(employeeLoanEvents.kind, "fnf_recovered")))
    .orderBy(asc(employeeLoanEvents.loanId));
  const out: Array<{ loanId: string; loanNumber: string; amountPaise: number }> = [];
  for (const ev of events) {
    const loan = await lockLoan(tx, input.businessId, ev.loanId);
    const [done] = await tx
      .select({ id: employeeLoanEvents.id })
      .from(employeeLoanEvents)
      .where(and(eq(employeeLoanEvents.loanId, loan.id), eq(employeeLoanEvents.settlementId, input.settlementId), eq(employeeLoanEvents.kind, "fnf_reversed")))
      .limit(1);
    if (done) continue;
    const amount = rupeesToPaise(ev.principal);
    const before = await outstandingPaise(tx, loan);
    const after = before + amount;
    if (after > rupeesToPaise(loan.principal)) {
      throw badRequest(`${loan.number}: putting back ₹${paiseToRupees(amount)} would make the balance more than the principal lent. The loan changed after the settlement; correct it with a journal entry instead.`);
    }
    await addEvent(tx, loan, { kind: "fnf_reversed", date: input.date, principalPaise: amount, balancePaise: after, settlementId: input.settlementId, note: "Full and final settlement reversed", actor: input.actor });
    if (loan.status === "closed" && after > 0) {
      await tx.update(employeeLoans).set({ status: "active", closedAt: null, updatedAt: new Date() }).where(eq(employeeLoans.id, loan.id));
    }
    if (after > 0) {
      await rebuildSchedule(tx, { ...loan, status: "active" } as LoanRow, { emiPaise: rupeesToPaise(loan.emi), balancePaise: after, firstMonth: addMonths(currentMonthIst(), 1) });
    }
    out.push({ loanId: loan.id, loanNumber: loan.number, amountPaise: amount });
  }
  return out;
}
