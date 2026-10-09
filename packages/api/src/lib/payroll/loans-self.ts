/**
 * The employee's own view of their loans and advances (read only). Everything here takes the EMPLOYEE ID FROM THE SESSION (the
 * caller resolves it from the signed-in membership) and filters every query on both the business and that employee, so a guessed
 * loan id of someone else, or of another business, finds nothing (NOT_FOUND, the same as an id that does not exist).
 *
 * What an employee may see: a loan that has been approved, paid out or closed (never a request waiting for approval, a rejected or
 * a cancelled one), its amounts, the repayment schedule that is in force and the money events of the statement. What they never
 * see: who approved it or why, internal notes (a skip reason, a reschedule note), user ids, bank accounts or journal entries.
 */

import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { employeeLoanEvents, employeeLoanInstallments, employeeLoans, type TenantDatabase } from "@fintranzact/db";
import { SELF_LOAN_EVENT_KINDS, SELF_LOAN_VISIBLE_STATUSES, paiseToRupees, rupeesToPaise } from "@fintranzact/shared";
import { notFound } from "./access.js";

type Reader = Pick<TenantDatabase, "select">;
type LoanRow = typeof employeeLoans.$inferSelect;

export interface SelfLoan {
  id: string;
  number: string;
  kind: string;
  status: string;
  principal: string;
  /** Yearly interest, %. */
  interestRate: string;
  emi: string;
  installmentCount: number;
  issueDate: string;
  /** The date the money was paid to the employee; null until then. */
  disbursedOn: string | null;
  purpose: string | null;
  /** Principal still to be recovered (0 until the loan is paid out, and once it is closed). */
  outstanding: string;
  recoveredPrincipal: string;
  recoveredInterest: string;
  /** The month of the next instalment ("YYYY-MM": it is taken from that month's salary), or null. */
  nextInstalmentMonth: string | null;
  nextInstalmentAmount: string | null;
  /** Instalments still to come (open, not yet recovered). */
  remainingInstalments: number;
}

const OWN_LOAN_STATUSES = [...SELF_LOAN_VISIBLE_STATUSES];

function ownLoanWhere(businessId: string, employeeId: string) {
  return and(eq(employeeLoans.businessId, businessId), eq(employeeLoans.employeeId, employeeId), inArray(employeeLoans.status, OWN_LOAN_STATUSES));
}

async function viewsOf(db: Reader, loans: LoanRow[]): Promise<SelfLoan[]> {
  if (loans.length === 0) return [];
  const ids = loans.map((l) => l.id);
  const sums = await db
    .select({
      loanId: employeeLoanEvents.loanId,
      principal: sql<string>`COALESCE(SUM(CASE WHEN ${employeeLoanEvents.kind} = 'fnf_reversed' THEN -${employeeLoanEvents.principal} ELSE ${employeeLoanEvents.principal} END) FILTER (WHERE ${employeeLoanEvents.kind} IN ('emi_recovered', 'prepaid', 'foreclosed', 'fnf_recovered', 'fnf_reversed')), 0)::text`,
      interest: sql<string>`COALESCE(SUM(${employeeLoanEvents.interest}) FILTER (WHERE ${employeeLoanEvents.kind} IN ('emi_recovered', 'prepaid', 'foreclosed')), 0)::text`,
    })
    .from(employeeLoanEvents)
    .where(inArray(employeeLoanEvents.loanId, ids))
    .groupBy(employeeLoanEvents.loanId);
  const open = await db
    .select({ loanId: employeeLoanInstallments.loanId, dueMonth: employeeLoanInstallments.dueMonth, principal: employeeLoanInstallments.principal, interest: employeeLoanInstallments.interest, paidPrincipal: employeeLoanInstallments.paidPrincipal, paidInterest: employeeLoanInstallments.paidInterest })
    .from(employeeLoanInstallments)
    .where(and(inArray(employeeLoanInstallments.loanId, ids), eq(employeeLoanInstallments.status, "open")))
    .orderBy(asc(employeeLoanInstallments.dueMonth), asc(employeeLoanInstallments.seq));
  const sumBy = new Map(sums.map((s) => [s.loanId, s]));
  const openBy = new Map<string, typeof open>();
  for (const o of open) openBy.set(o.loanId, [...(openBy.get(o.loanId) ?? []), o]);
  return loans.map((l) => {
    const s = sumBy.get(l.id);
    const recovered = rupeesToPaise(s?.principal ?? "0");
    const paidOut = l.status === "active" || l.status === "closed";
    const mine = openBy.get(l.id) ?? [];
    const next = mine[0];
    const due = (o: (typeof open)[number]) => rupeesToPaise(o.principal) + rupeesToPaise(o.interest) - rupeesToPaise(o.paidPrincipal) - rupeesToPaise(o.paidInterest);
    return {
      id: l.id,
      number: l.number,
      kind: l.kind,
      status: l.status,
      principal: l.principal,
      interestRate: l.interestRate,
      emi: l.emi,
      installmentCount: l.installmentCount,
      issueDate: l.issueDate,
      disbursedOn: l.disbursedOn,
      purpose: l.purpose,
      outstanding: paidOut && l.status !== "closed" ? paiseToRupees(Math.max(0, rupeesToPaise(l.principal) - recovered)) : "0.00",
      recoveredPrincipal: paiseToRupees(recovered),
      recoveredInterest: s?.interest ?? "0.00",
      nextInstalmentMonth: paidOut && next ? next.dueMonth : null,
      nextInstalmentAmount: paidOut && next ? paiseToRupees(Math.max(0, due(next))) : null,
      remainingInstalments: paidOut ? mine.length : 0,
    };
  });
}

/** The signed-in employee's own loans (approved, paid out or closed), newest first. */
export async function listOwnLoans(db: Reader, businessId: string, employeeId: string): Promise<SelfLoan[]> {
  const rows = await db.select().from(employeeLoans).where(ownLoanWhere(businessId, employeeId)).orderBy(sql`${employeeLoans.createdAt} DESC`);
  return viewsOf(db, rows);
}

const EVENT_DESCRIPTIONS: Record<(typeof SELF_LOAN_EVENT_KINDS)[number], string> = {
  disbursed: "Paid to you",
  emi_recovered: "Instalment recovered from your salary",
  prepaid: "Part-payment received",
  foreclosed: "Loan repaid in full",
  fnf_recovered: "Recovered in your full and final settlement",
  fnf_reversed: "Recovery in the settlement was reversed",
  skipped: "An instalment was skipped",
  rescheduled: "Repayment schedule changed",
  closed: "Loan closed",
};

export interface SelfLoanStatement {
  loan: SelfLoan;
  /** The repayment schedule in force (replaced instalments are not shown). */
  schedule: Array<{ seq: number; dueMonth: string; principal: string; interest: string; recovered: string; status: string }>;
  /** Money events, oldest first: what was paid to you, recovered, repaid or changed. */
  events: Array<{ id: string; date: string; kind: string; description: string; principal: string; interest: string; balanceAfter: string }>;
}

/** One of the employee's own loans with its schedule and statement; NOT_FOUND for any loan that is not theirs or not visible. */
export async function ownLoanStatement(db: Reader, businessId: string, employeeId: string, loanId: string): Promise<SelfLoanStatement> {
  const [loan] = await db.select().from(employeeLoans).where(and(ownLoanWhere(businessId, employeeId), eq(employeeLoans.id, loanId))).limit(1);
  if (!loan) throw notFound("Loan");
  const [view] = await viewsOf(db, [loan]);
  const [installments, events] = await Promise.all([
    db
      .select()
      .from(employeeLoanInstallments)
      .where(and(eq(employeeLoanInstallments.loanId, loan.id), eq(employeeLoanInstallments.businessId, businessId), ne(employeeLoanInstallments.status, "superseded")))
      .orderBy(asc(employeeLoanInstallments.dueMonth), asc(employeeLoanInstallments.seq)),
    db
      .select()
      .from(employeeLoanEvents)
      .where(and(eq(employeeLoanEvents.loanId, loan.id), eq(employeeLoanEvents.businessId, businessId), eq(employeeLoanEvents.employeeId, employeeId), inArray(employeeLoanEvents.kind, [...SELF_LOAN_EVENT_KINDS])))
      .orderBy(asc(employeeLoanEvents.createdAt)),
  ]);
  return {
    loan: view!,
    schedule: installments.map((i) => ({
      seq: i.seq,
      dueMonth: i.dueMonth,
      principal: i.principal,
      interest: i.interest,
      recovered: paiseToRupees(rupeesToPaise(i.paidPrincipal) + rupeesToPaise(i.paidInterest)),
      status: i.status,
    })),
    events: events.map((e) => ({
      id: e.id,
      date: e.eventDate,
      kind: e.kind,
      description: EVENT_DESCRIPTIONS[e.kind as (typeof SELF_LOAN_EVENT_KINDS)[number]] ?? e.kind.replace(/_/g, " "),
      principal: e.principal,
      interest: e.interest,
      balanceAfter: e.balanceAfter,
    })),
  };
}
