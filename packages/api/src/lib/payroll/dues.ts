/**
 * Statutory dues: what each approved payroll run owes to the authorities (PF,
 * ESI, professional tax, LWF, TDS on salary), what has been paid, and the
 * recording of a payment with its challan details.
 *
 * Accrued amounts are the sum of the employee and employer statutory components
 * of the run's lines, by authority (`statutoryPayableGroup`). Paying a due is
 * Dr <payable account> / Cr cash or bank, plus a withdrawal on the bank account.
 * Nothing is filed or paid with any government system: this only records it.
 */

import { and, desc, eq, inArray } from "drizzle-orm";
import {
  bankAccounts,
  bankTransactions,
  payrollRunLines,
  payrollRuns,
  payrollStatutoryPayments,
  type TenantDatabase,
} from "@fintranzact/db";
import {
  STATUTORY_PAYABLE_GROUPS,
  STATUTORY_PAYABLE_LABELS,
  formatPayrollMonth,
  monthsOfFy,
  paiseToRupees,
  rupeesToPaise,
  statutoryDueDate,
  statutoryPayableGroup,
  defaultStatutoryRates,
  type StatutoryPayableGroup,
  type StatutoryRates,
} from "@fintranzact/shared";
import { assertPeriodOpen } from "../period-lock.js";
import { STATUTORY_PAYABLE_KEYS, bookDate, cashOrBankAccountId, ensurePayrollAccounts, writeJournalEntry } from "./books.js";
import { badRequest, notFound } from "./access.js";
import type { Actor } from "./run.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

const FINAL = ["approved", "posted", "paid"];

export interface DueRow {
  runId: string;
  month: string;
  monthLabel: string;
  runStatus: string;
  kind: StatutoryPayableGroup;
  label: string;
  accrued: string;
  paid: string;
  outstanding: string;
  dueDate: string | null;
  /** Payments can be recorded once the run is posted (the liability is in the books). */
  canPay: boolean;
  payments: Array<{ id: string; amount: string; paidOn: string; challanNumber: string | null; challanDate: string | null; reference: string | null }>;
}

/** The statutory amounts a run's lines add up to, by authority (paise). */
export function accruedByGroup(lines: ReadonlyArray<{ components: ReadonlyArray<{ type: string; statutoryKind: string | null; amount: string }> }>): Record<StatutoryPayableGroup, number> {
  const out: Record<StatutoryPayableGroup, number> = { pf: 0, esi: 0, pt: 0, lwf: 0, tds: 0 };
  for (const l of lines) {
    for (const c of l.components) {
      const g = c.type === "earning" ? null : statutoryPayableGroup(c.statutoryKind);
      if (g) out[g] += rupeesToPaise(c.amount);
    }
  }
  return out;
}

function ratesOfRun(run: { statutory: Record<string, unknown> | null }): StatutoryRates["dueDates"] {
  const rates = run.statutory?.rates as Partial<StatutoryRates> | undefined;
  return { ...defaultStatutoryRates().dueDates, ...(rates?.dueDates ?? {}) };
}

/** Dues of every approved run of a financial year, with payments. Only authorities with an accrued amount are listed. */
export async function listDues(db: Pick<TenantDatabase, "select">, businessId: string, fyStartYear: number): Promise<DueRow[]> {
  const runs = await db
    .select()
    .from(payrollRuns)
    .where(and(eq(payrollRuns.businessId, businessId), inArray(payrollRuns.month, monthsOfFy(fyStartYear)), inArray(payrollRuns.status, FINAL)))
    .orderBy(desc(payrollRuns.month));
  if (runs.length === 0) return [];
  const [lines, payments] = await Promise.all([
    db.select({ runId: payrollRunLines.runId, components: payrollRunLines.components }).from(payrollRunLines).where(inArray(payrollRunLines.runId, runs.map((r) => r.id))),
    db.select().from(payrollStatutoryPayments).where(inArray(payrollStatutoryPayments.runId, runs.map((r) => r.id))).orderBy(desc(payrollStatutoryPayments.paidOn)),
  ]);
  const out: DueRow[] = [];
  for (const run of runs) {
    const accrued = accruedByGroup(lines.filter((l) => l.runId === run.id));
    const due = ratesOfRun(run);
    for (const g of STATUTORY_PAYABLE_GROUPS) {
      if (accrued[g] <= 0) continue;
      const pays = payments.filter((p) => p.runId === run.id && p.kind === g);
      const paid = pays.reduce((s, p) => s + rupeesToPaise(p.amount), 0);
      out.push({
        runId: run.id,
        month: run.month,
        monthLabel: formatPayrollMonth(run.month),
        runStatus: run.status,
        kind: g,
        label: STATUTORY_PAYABLE_LABELS[g],
        accrued: paiseToRupees(accrued[g]),
        paid: paiseToRupees(paid),
        outstanding: paiseToRupees(Math.max(0, accrued[g] - paid)),
        dueDate: statutoryDueDate(g, run.month, due),
        canPay: run.status === "posted" || run.status === "paid",
        payments: pays.map((p) => ({ id: p.id, amount: p.amount, paidOn: p.paidOn, challanNumber: p.challanNumber, challanDate: p.challanDate, reference: p.reference })),
      });
    }
  }
  return out;
}

export interface RecordPaymentInput {
  businessId: string;
  runId: string;
  kind: StatutoryPayableGroup;
  amountPaise: number;
  paidOn: string;
  bankAccountId: string;
  challanNumber: string | null;
  challanDate: string | null;
  reference: string | null;
  actor: Actor;
}

/**
 * Record a payment of a statutory due: Dr the payable account, Cr cash or bank,
 * a withdrawal on the bank account and a payment row with the challan details.
 * The run is locked while the outstanding amount is re-checked, so two payments
 * at once cannot pay more than is owed. Respects period locks.
 */
export async function recordStatutoryPayment(db: TenantDatabase, input: RecordPaymentInput) {
  const [first] = await db.select().from(payrollRuns).where(and(eq(payrollRuns.id, input.runId), eq(payrollRuns.businessId, input.businessId))).limit(1);
  if (!first) throw notFound("Payroll run");
  if (first.status !== "posted" && first.status !== "paid") throw badRequest("Statutory dues can be paid once the payroll run is posted to the books.");
  await assertPeriodOpen(db, input.businessId, [input.paidOn]);

  return db.transaction(async (tx: Tx) => {
    const [run] = await tx.select().from(payrollRuns).where(and(eq(payrollRuns.id, input.runId), eq(payrollRuns.businessId, input.businessId))).for("update").limit(1);
    if (!run) throw notFound("Payroll run");
    if (run.status !== "posted" && run.status !== "paid") throw badRequest("Statutory dues can be paid once the payroll run is posted to the books.");

    const lines = await tx.select({ components: payrollRunLines.components }).from(payrollRunLines).where(eq(payrollRunLines.runId, run.id));
    const accrued = accruedByGroup(lines)[input.kind];
    if (accrued <= 0) throw badRequest(`This payroll run has no ${STATUTORY_PAYABLE_LABELS[input.kind]} to pay.`);
    const prior = await tx.select({ amount: payrollStatutoryPayments.amount }).from(payrollStatutoryPayments).where(and(eq(payrollStatutoryPayments.runId, run.id), eq(payrollStatutoryPayments.kind, input.kind)));
    const outstanding = accrued - prior.reduce((s: number, p: { amount: string }) => s + rupeesToPaise(p.amount), 0);
    if (input.amountPaise > outstanding) {
      throw badRequest(`Only ${paiseToRupees(Math.max(0, outstanding))} is outstanding for ${STATUTORY_PAYABLE_LABELS[input.kind]} for ${formatPayrollMonth(run.month)}.`);
    }

    const [account] = await tx
      .select()
      .from(bankAccounts)
      .where(and(eq(bankAccounts.id, input.bankAccountId), eq(bankAccounts.businessId, input.businessId)))
      .for("update")
      .limit(1);
    if (!account) throw notFound("Bank or cash account");

    const acc = await ensurePayrollAccounts(tx, input.businessId, [STATUTORY_PAYABLE_KEYS[input.kind]]);
    const payFrom = await cashOrBankAccountId(tx, input.businessId, account.accountType);
    const label = `${STATUTORY_PAYABLE_LABELS[input.kind]} for ${formatPayrollMonth(run.month)}`;
    const ref = input.challanNumber ? ` (challan ${input.challanNumber})` : "";
    const entry = await writeJournalEntry(tx, {
      businessId: input.businessId,
      entryDate: bookDate(input.paidOn),
      narration: `${label} paid${ref}`,
      userId: input.actor.id,
      userName: input.actor.name,
      lines: [
        { accountId: acc[STATUTORY_PAYABLE_KEYS[input.kind]]!, debitPaise: input.amountPaise, creditPaise: 0, narration: `${label} paid` },
        { accountId: payFrom, debitPaise: 0, creditPaise: input.amountPaise, narration: `${label} paid from ${account.accountName}` },
      ],
    });
    await tx.insert(bankTransactions).values({
      businessId: input.businessId,
      bankAccountId: account.id,
      type: "withdrawal",
      amount: paiseToRupees(input.amountPaise),
      description: label,
      referenceType: "payroll_statutory_payment",
      referenceId: run.id,
      transactionDate: bookDate(input.paidOn),
    });
    await tx
      .update(bankAccounts)
      .set({ currentBalance: paiseToRupees(rupeesToPaise(account.currentBalance) - input.amountPaise), updatedAt: new Date() })
      .where(eq(bankAccounts.id, account.id));
    const [payment] = await tx
      .insert(payrollStatutoryPayments)
      .values({
        businessId: input.businessId,
        runId: run.id,
        kind: input.kind,
        amount: paiseToRupees(input.amountPaise),
        paidOn: input.paidOn,
        challanNumber: input.challanNumber,
        challanDate: input.challanDate,
        reference: input.reference,
        bankAccountId: account.id,
        journalEntryId: entry.id,
        createdByUserId: input.actor.id,
      })
      .returning();
    return { payment: payment!, journalEntryId: entry.id, outstanding: paiseToRupees(outstanding - input.amountPaise), kind: input.kind, runId: run.id };
  });
}
