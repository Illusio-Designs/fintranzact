/**
 * Payroll and the books: the accounts payroll posts to (made lazily per
 * business, like nothing else needs them until a run is posted) and the
 * journal entry writer.
 *
 * Posting a run makes ONE balanced journal entry:
 *   Dr  Salary & Wages (5200)            basic, DA, retaining allowance
 *   Dr  Salary - Allowances (5201)       HRA, conveyance, special, other earnings
 *   Dr  Salary - Bonus & Incentives (5202)
 *   Dr  Salary - Overtime (5203)
 *   Dr  Employer Contributions (5204)    employer contributions you entered
 *       Cr  Salaries Payable (2400)            net pay
 *       Cr  Payroll Deductions Payable (2410)  what was held back from employees
 *       Cr  Employer Contributions Payable (2420)
 * Marking the run paid makes a second entry:
 *   Dr  Salaries Payable (2400)   Cr  Cash in Hand (1000) / Bank Accounts (1010)
 * Statutory amounts (employee and employer shares of PF/EPS, ESI, professional
 * tax, LWF, and TDS on salary) are credited to their own payable account
 * instead of 2410 / 2420, so each can be paid to its authority on its own:
 *       Cr  PF and EPS Payable (2430)  ESI Payable (2431)  Professional Tax
 *           Payable (2432)  Labour Welfare Fund Payable (2433)  TDS on Salary
 *           Payable (2434)
 * Paying a statutory due makes Dr <that payable> / Cr cash or bank.
 *
 * Phase 4 adds: 1260 Loans and Advances to Employees (asset), 4110 Interest on Staff Loans (income), 2440 Bonus Payable,
 * 2441 Gratuity Provision, 2442 Full and Final Settlements Payable (liabilities) and 5205 Salary - Gratuity (expense).
 * Loan instalments recovered in a run credit 1260 (principal) and 4110 (interest) instead of 2410.
 */

import { and, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { bankAccounts, bankTransactions, chartOfAccounts, journalEntries, journalEntryLines } from "@fintranzact/db";
import { paiseToRupees, rupeesToPaise, type ExpenseGroup, type StatutoryPayableGroup } from "@fintranzact/shared";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

export interface PayrollAccountDef {
  key: string;
  code: string;
  name: string;
  accountType: "expense" | "liability" | "asset" | "income";
}

export const PAYROLL_ACCOUNTS: Record<
  | ExpenseGroup
  | "salaries_payable"
  | "deductions_payable"
  | "employer_payable"
  | "pf_payable"
  | "esi_payable"
  | "pt_payable"
  | "lwf_payable"
  | "tds_payable"
  // Phase 4
  | "loans_receivable"
  | "loan_interest_income"
  | "bonus_payable"
  | "gratuity_provision"
  | "gratuity_expense"
  | "fnf_payable",
  PayrollAccountDef
> = {
  wages: { key: "wages", code: "5200", name: "Salary & Wages", accountType: "expense" },
  allowances: { key: "allowances", code: "5201", name: "Salary - Allowances", accountType: "expense" },
  bonus_incentives: { key: "bonus_incentives", code: "5202", name: "Salary - Bonus & Incentives", accountType: "expense" },
  overtime: { key: "overtime", code: "5203", name: "Salary - Overtime", accountType: "expense" },
  employer_contributions: { key: "employer_contributions", code: "5204", name: "Employer Contributions to Staff", accountType: "expense" },
  salaries_payable: { key: "salaries_payable", code: "2400", name: "Salaries Payable", accountType: "liability" },
  deductions_payable: { key: "deductions_payable", code: "2410", name: "Payroll Deductions Payable", accountType: "liability" },
  employer_payable: { key: "employer_payable", code: "2420", name: "Employer Contributions Payable", accountType: "liability" },
  pf_payable: { key: "pf_payable", code: "2430", name: "PF and EPS Payable", accountType: "liability" },
  esi_payable: { key: "esi_payable", code: "2431", name: "ESI Payable", accountType: "liability" },
  pt_payable: { key: "pt_payable", code: "2432", name: "Professional Tax Payable", accountType: "liability" },
  lwf_payable: { key: "lwf_payable", code: "2433", name: "Labour Welfare Fund Payable", accountType: "liability" },
  tds_payable: { key: "tds_payable", code: "2434", name: "TDS on Salary Payable", accountType: "liability" },
  // Phase 4 (docs/architecture/payroll-phase-4.md): the next free codes in each range, made lazily like 2430-2434.
  loans_receivable: { key: "loans_receivable", code: "1260", name: "Loans and Advances to Employees", accountType: "asset" },
  loan_interest_income: { key: "loan_interest_income", code: "4110", name: "Interest on Staff Loans", accountType: "income" },
  bonus_payable: { key: "bonus_payable", code: "2440", name: "Bonus Payable", accountType: "liability" },
  gratuity_provision: { key: "gratuity_provision", code: "2441", name: "Gratuity Provision", accountType: "liability" },
  fnf_payable: { key: "fnf_payable", code: "2442", name: "Full and Final Settlements Payable", accountType: "liability" },
  gratuity_expense: { key: "gratuity_expense", code: "5205", name: "Salary - Gratuity", accountType: "expense" },
};

/** The payable account of each statutory group. */
export const STATUTORY_PAYABLE_KEYS: Record<StatutoryPayableGroup, PayrollAccountKey> = {
  pf: "pf_payable",
  esi: "esi_payable",
  pt: "pt_payable",
  lwf: "lwf_payable",
  tds: "tds_payable",
};

export type PayrollAccountKey = keyof typeof PAYROLL_ACCOUNTS;

/**
 * The business's account ids for the payroll accounts, creating any that are
 * missing. An account with the right code and type is reused. When the code is
 * taken by an account of another type (a custom chart), the payroll account is
 * made under "P" + the code instead, so a payroll amount never lands in an
 * account of the wrong kind.
 */
export async function ensurePayrollAccounts(tx: Tx, businessId: string, keys: PayrollAccountKey[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const key of keys) {
    const def = PAYROLL_ACCOUNTS[key];
    for (const code of [def.code, `P${def.code}`]) {
      const [existing] = await tx
        .select({ id: chartOfAccounts.id, accountType: chartOfAccounts.accountType, isActive: chartOfAccounts.isActive })
        .from(chartOfAccounts)
        .where(and(eq(chartOfAccounts.businessId, businessId), eq(chartOfAccounts.code, code)))
        .limit(1);
      if (existing && existing.accountType === def.accountType) {
        out[key] = existing.id;
        break;
      }
      if (!existing) {
        const [created] = await tx
          .insert(chartOfAccounts)
          .values({ businessId, code, name: def.name, accountType: def.accountType, isSystem: true, isActive: true })
          .returning({ id: chartOfAccounts.id });
        out[key] = created.id;
        break;
      }
    }
    if (!out[key]) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Could not find or create the ${def.name} account.` });
  }
  return out;
}

/** The existing system accounts cash and bank payments post to (derive-ledger.ts uses the same). */
export async function cashOrBankAccountId(tx: Tx, businessId: string, bankAccountType: string): Promise<string> {
  const code = bankAccountType === "cash" ? "1000" : "1010";
  const [row] = await tx
    .select({ id: chartOfAccounts.id })
    .from(chartOfAccounts)
    .where(and(eq(chartOfAccounts.businessId, businessId), eq(chartOfAccounts.code, code)))
    .limit(1);
  if (!row) throw new TRPCError({ code: "BAD_REQUEST", message: `The chart of accounts has no account ${code}. Add it before paying salaries.` });
  return row.id;
}

export interface JournalLineInput {
  accountId: string;
  /** Paise. Exactly one of debit and credit is above zero. */
  debitPaise: number;
  creditPaise: number;
  narration?: string;
}

function rupees(paise: number): string {
  return `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, "0")}`;
}

/**
 * Writes a balanced "system" journal entry. Refuses an unbalanced one (the
 * double-entry invariant is checked here, in the one place payroll writes
 * entries from). Run it inside the caller's transaction.
 */
export async function writeJournalEntry(
  tx: Tx,
  input: { businessId: string; entryDate: Date; narration: string; userId: string; userName: string | null; lines: JournalLineInput[]; reversesEntryId?: string },
): Promise<{ id: string; entryNumber: string }> {
  const lines = input.lines.filter((l) => l.debitPaise > 0 || l.creditPaise > 0);
  const debit = lines.reduce((s, l) => s + l.debitPaise, 0);
  const credit = lines.reduce((s, l) => s + l.creditPaise, 0);
  if (lines.length < 2 || debit !== credit || debit <= 0) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The payroll journal entry does not balance, so nothing was posted." });
  }

  const [maxEntry] = await tx
    .select({ count: sql<number>`COALESCE(MAX(CAST(SUBSTRING(entry_number FROM '[0-9]+$') AS INTEGER)), 0)` })
    .from(journalEntries)
    .where(eq(journalEntries.businessId, input.businessId));
  const entryNumber = `JE-${String((maxEntry?.count ?? 0) + 1).padStart(5, "0")}`;

  const [entry] = await tx
    .insert(journalEntries)
    .values({
      businessId: input.businessId,
      entryNumber,
      entryDate: input.entryDate,
      narration: input.narration,
      source: "system",
      reversesEntryId: input.reversesEntryId ?? null,
      createdByUserId: input.userId,
      createdByName: input.userName,
    })
    .returning({ id: journalEntries.id, entryNumber: journalEntries.entryNumber });
  await tx.insert(journalEntryLines).values(
    lines.map((l) => ({
      journalEntryId: entry.id,
      accountId: l.accountId,
      debit: rupees(l.debitPaise),
      credit: rupees(l.creditPaise),
      narration: l.narration ?? null,
    })),
  );
  return entry;
}

/**
 * Negates a journal entry the way the manual "void" does (journal.void): a mirror entry on the same date with every line's debit
 * and credit swapped, `reverses_entry_id` pointing at the original, and the original marked voided and pointing at the mirror.
 * Reports include both, so the pair nets to zero. Refuses an entry that is already voided. Run it inside the caller's transaction
 * (and check the period lock first). Returns the mirror entry.
 */
export async function reverseJournalEntry(
  tx: Tx,
  input: { businessId: string; entryId: string; narration: string; userId: string; userName: string | null },
): Promise<{ id: string; entryNumber: string }> {
  const [orig] = await tx.select().from(journalEntries).where(and(eq(journalEntries.id, input.entryId), eq(journalEntries.businessId, input.businessId))).for("update").limit(1);
  if (!orig) throw new TRPCError({ code: "NOT_FOUND", message: "The journal entry to reverse was not found." });
  if (orig.isVoided) throw new TRPCError({ code: "BAD_REQUEST", message: `Journal entry ${orig.entryNumber} is already voided, so it cannot be reversed again.` });
  const lines: Array<{ accountId: string; debit: string; credit: string; narration: string | null }> = await tx.select({ accountId: journalEntryLines.accountId, debit: journalEntryLines.debit, credit: journalEntryLines.credit, narration: journalEntryLines.narration }).from(journalEntryLines).where(eq(journalEntryLines.journalEntryId, orig.id));
  const mirror = await writeJournalEntry(tx, {
    businessId: input.businessId,
    entryDate: orig.entryDate,
    narration: input.narration,
    userId: input.userId,
    userName: input.userName,
    reversesEntryId: orig.id,
    lines: lines.map((l) => ({ accountId: l.accountId, debitPaise: rupeesToPaise(l.credit), creditPaise: rupeesToPaise(l.debit), narration: l.narration ?? undefined })),
  });
  await tx.update(journalEntries).set({ isVoided: true, voidedByEntryId: mirror.id, updatedAt: new Date() }).where(eq(journalEntries.id, orig.id));
  return mirror;
}

/**
 * Money leaving or entering a bank or cash account (Phase 4 postings): a bank transaction row and the account balance, in the
 * caller's transaction. Returns the locked account row so the caller can name it in the narration.
 */
export async function moveBank(
  tx: Tx,
  input: { businessId: string; bankAccountId: string; direction: "out" | "in"; paise: number; date: Date; description: string; referenceType: string; referenceId: string },
): Promise<{ id: string; accountName: string; accountType: string }> {
  const [account] = await tx
    .select()
    .from(bankAccounts)
    .where(and(eq(bankAccounts.id, input.bankAccountId), eq(bankAccounts.businessId, input.businessId)))
    .for("update")
    .limit(1);
  if (!account) throw new TRPCError({ code: "NOT_FOUND", message: "Bank or cash account not found" });
  await tx.insert(bankTransactions).values({
    businessId: input.businessId,
    bankAccountId: account.id,
    type: input.direction === "out" ? "withdrawal" : "deposit",
    amount: paiseToRupees(input.paise),
    description: input.description,
    referenceType: input.referenceType,
    referenceId: input.referenceId,
    transactionDate: input.date,
  });
  const delta = input.direction === "out" ? -input.paise : input.paise;
  await tx
    .update(bankAccounts)
    .set({ currentBalance: paiseToRupees(rupeesToPaise(account.currentBalance) + delta), updatedAt: new Date() })
    .where(eq(bankAccounts.id, account.id));
  return { id: account.id, accountName: account.accountName, accountType: account.accountType };
}

/** The current credit balance (credits less debits) of a payroll account, paise. 0 when the account does not exist yet. */
export async function accountCreditBalancePaise(tx: Tx, businessId: string, key: PayrollAccountKey): Promise<number> {
  const def = PAYROLL_ACCOUNTS[key];
  const [row] = await tx
    .select({ id: chartOfAccounts.id })
    .from(chartOfAccounts)
    .where(and(eq(chartOfAccounts.businessId, businessId), eq(chartOfAccounts.code, def.code), eq(chartOfAccounts.accountType, def.accountType)))
    .limit(1);
  if (!row) return 0;
  const [sum] = await tx
    .select({ n: sql<string>`COALESCE(SUM(${journalEntryLines.credit} - ${journalEntryLines.debit}), 0)::text` })
    .from(journalEntryLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalEntryLines.journalEntryId))
    .where(and(eq(journalEntries.businessId, businessId), eq(journalEntryLines.accountId, row.id)));
  return rupeesToPaise(sum?.n ?? "0");
}

/** A business date ("YYYY-MM-DD") as the instant the books store: midday in India, so no time zone moves it to another day. */
export function bookDate(ymd: string): Date {
  return new Date(`${ymd}T12:00:00+05:30`);
}
