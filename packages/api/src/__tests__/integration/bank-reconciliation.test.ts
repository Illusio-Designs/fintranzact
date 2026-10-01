/**
 * bank-reconciliation.test.ts — Integration tests for bank statement template
 * detection, template CRUD, and the full CSV import/reconciliation lifecycle.
 *
 * WHY THIS FILE EXISTS:
 * Bank statement templates automate the tedious column-mapping step for the 10
 * most common Indian banks. These tests verify:
 *
 *   Templates:  Built-in seed on first upload (10 banks).
 *               Auto-detection from HDFC / SBI CSV headers.
 *               Graceful fallback to heuristics when no template matches.
 *               Custom template create / fork / update / delete.
 *               Guard: seeded templates cannot be edited or deleted.
 *
 *   CSV import: Upload and parse; correct preview row count.
 *               confirmMapping creates statement lines with correct amounts.
 *               Auto-match on exact payment amount + date.
 *               Create expense from unmatched debit line.
 *               Categorization rules applied on import.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  bankAccounts,
  bankStatementImports,
  bankStatementLines,
  bankTransactions,
} from "@fintranzact/db";
import { money, ofxToRows, qifToRows, rowsToCsv, sheetToRows } from "@fintranzact/shared";
import {
  createTestWorld,
  createBankAccount,
  createPayment,
  type TestWorld,
  type TestBankAccount,
  type TestParty,
  createParty,
} from "../helpers/fixtures.js";
import { createTestCaller } from "../helpers/create-test-caller.js";
import {
  getTenantTestDb,
  truncateAllTables,
  closeTestDb,
} from "../helpers/test-db.js";

// ── Fixture ───────────────────────────────────────────────────────────────────

let world: TestWorld;
let account: TestBankAccount;
let party: TestParty;

function callerForRamesh() {
  return createTestCaller({
    userId: world.ramesh.id,
    email: world.ramesh.email,
    name: world.ramesh.name ?? null,
    tenantId: world.tenant1.id,
    businessId: world.business1.id,
  });
}

beforeAll(async () => {
  world = await createTestWorld();
  const db = getTenantTestDb();

  account = await createBankAccount(db, world.business1.id, {
    accountName: "HDFC Current Account",
    accountNumber: "12345678901234",
    ifsc: "HDFC0001234",
    bankName: "HDFC Bank",
    accountType: "current",
    openingBalance: "100000.00",
    currentBalance: "100000.00",
  });

  party = await createParty(db, world.business1.id, {
    name: "Test Party",
    type: "customer",
    openingBalance: "0.00",
  });
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

// ── Test CSV fixtures ─────────────────────────────────────────────────────────

// HDFC net-banking CSV format: Date, Narration, Chq./Ref.No., Value Dt, Withdrawal Amt., Deposit Amt., Closing Balance
const hdfcCSV = [
  "Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance",
  "01/04/26,UPI/PAY/John/9876,UPIREF123,01/04/26,5000.00,,95000.00",
  "02/04/26,NEFT/SALARY/Company,NEFT789,02/04/26,,50000.00,145000.00",
  "03/04/26,ATM/WDL/HDFC,ATM001,03/04/26,2000.00,,143000.00",
].join("\n");

// SBI net-banking CSV format: Txn Date, Value Date, Description, Ref No./Cheque No., Debit, Credit, Balance
const sbiCSV = [
  "Txn Date,Value Date,Description,Ref No./Cheque No.,Debit,Credit,Balance",
  "01/04/2026,01/04/2026,UPI Transfer,UPIREF999,1000.00,,99000.00",
  "02/04/2026,02/04/2026,NEFT Received,NEFTXYZ,,25000.00,124000.00",
].join("\n");

// Unknown bank CSV with unknown headers — no template should match
const unknownCSV = [
  "TransDate,Details,Amount,RunningBalance",
  "2026-04-01,Payment to vendor,5000,45000",
  "2026-04-02,Received from client,10000,55000",
].join("\n");

// Simple CSV for general import tests
const simpleCSV = [
  "Date,Description,Debit,Credit,Balance",
  "01/04/2026,Office Supplies Purchase,1500.00,,98500.00",
  "02/04/2026,Client Payment Received,,25000.00,123500.00",
].join("\n");

// CSV with SALARY narration for rule-based categorisation test
const salaryCSV = [
  "Date,Description,Debit,Credit,Balance",
  "01/04/2026,SALARY CREDIT MARCH 2026,,80000.00,180000.00",
].join("\n");

// ── Template seeding ──────────────────────────────────────────────────────────

describe("Bank Statement Templates", () => {
  it("seeds built-in templates (10 banks) on first uploadCSV call", async () => {
    const caller = callerForRamesh();

    // Upload triggers lazy seed
    await caller.bankRecon.uploadCSV({
      bankAccountId: account.id,
      fileName: "test.csv",
      csvContent: simpleCSV,
    });

    // Template list must now include all 10 built-in banks
    const templates = await caller.bankRecon.templateList();
    expect(templates.length).toBeGreaterThanOrEqual(10);

    const seeded = templates.filter((t) => t.isSeeded);
    expect(seeded.length).toBeGreaterThanOrEqual(10);

    // Verify slug variety — at least SBI and HDFC
    const slugs = seeded.map((t) => t.bankSlug);
    expect(slugs).toContain("hdfc");
    expect(slugs).toContain("sbi");
  });

  it("auto-detects HDFC template from HDFC-style CSV headers", async () => {
    const caller = callerForRamesh();

    const result = await caller.bankRecon.uploadCSV({
      bankAccountId: account.id,
      fileName: "hdfc-statement.csv",
      csvContent: hdfcCSV,
    });

    expect(result.detectedTemplate).not.toBeNull();
    expect(result.detectedTemplate!.bankSlug).toBe("hdfc");
    expect(result.detectedTemplate!.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it("auto-detects SBI template from SBI-style CSV headers", async () => {
    // Create an SBI bank account for better hint-based detection
    const db = getTenantTestDb();
    const sbiAccount = await createBankAccount(db, world.business1.id, {
      accountName: "SBI Savings",
      accountNumber: "99887766554411",
      ifsc: "SBIN0001234",
      bankName: "State Bank of India",
      accountType: "savings",
      openingBalance: "0.00",
      currentBalance: "0.00",
    });

    const caller = callerForRamesh();

    const result = await caller.bankRecon.uploadCSV({
      bankAccountId: sbiAccount.id,
      fileName: "sbi-statement.csv",
      csvContent: sbiCSV,
    });

    expect(result.detectedTemplate).not.toBeNull();
    expect(result.detectedTemplate!.bankSlug).toBe("sbi");
  });

  it("falls back to heuristic mapping when no template matches unknown headers", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    // Create a bank account with no recognizable IFSC or bank-name hints
    const neutralAccount = await createBankAccount(db, world.business1.id, {
      accountName: "Regional Co-op Bank",
      accountNumber: "00000000001",
      ifsc: "RCOP0001234",
      bankName: "Regional Cooperative Bank",
      accountType: "savings",
      openingBalance: "0.00",
      currentBalance: "0.00",
    });

    const result = await caller.bankRecon.uploadCSV({
      bankAccountId: neutralAccount.id,
      fileName: "unknown-bank.csv",
      csvContent: unknownCSV,
    });

    // No template detected, but detectedMapping from heuristics must still be present
    expect(result.detectedTemplate).toBeNull();
    expect(result.detectedMapping).toBeDefined();
  });

  it("creates a custom template and it appears in templateList", async () => {
    const caller = callerForRamesh();

    const tmpl = await caller.bankRecon.templateCreate({
      bankDisplayName: "Custom Regional Bank",
      columnMapping: {
        date: 0,
        narration: 1,
        debit: 2,
        credit: 3,
        balance: 4,
        dateFormat: "DD/MM/YYYY",
        skipRows: 1,
      },
      label: "Test custom template",
    });

    expect(tmpl.isSeeded).toBe(false);
    expect(tmpl.bankDisplayName).toBe("Custom Regional Bank");
    expect(tmpl.version).toBe(1);

    const list = await caller.bankRecon.templateList();
    const found = list.find((t) => t.id === tmpl.id);
    expect(found).toBeDefined();
  });

  it("forks a seeded template into an editable copy with forkedFromId set", async () => {
    const caller = callerForRamesh();

    const list = await caller.bankRecon.templateList();
    const seeded = list.find((t) => t.isSeeded);
    expect(seeded).toBeDefined();

    const forked = await caller.bankRecon.templateFork({
      templateId: seeded!.id,
      label: "My custom HDFC",
    });

    expect(forked.isSeeded).toBe(false);
    expect(forked.forkedFromId).toBe(seeded!.id);
    expect(forked.bankSlug).toBe(seeded!.bankSlug);
    expect(forked.version).toBeGreaterThan(seeded!.version);
    expect(forked.label).toBe("My custom HDFC");
  });

  it("rejects editing a seeded template", async () => {
    const caller = callerForRamesh();

    const list = await caller.bankRecon.templateList();
    const seeded = list.find((t) => t.isSeeded);
    expect(seeded).toBeDefined();

    await expect(
      caller.bankRecon.templateUpdate({
        id: seeded!.id,
        label: "Should fail",
      }),
    ).rejects.toThrow(/seeded|fork/i);
  });

  it("edits a custom template and persists the change", async () => {
    const caller = callerForRamesh();

    const created = await caller.bankRecon.templateCreate({
      bankDisplayName: "Editable Bank",
      columnMapping: {
        date: 0,
        narration: 1,
        debit: 2,
        credit: 3,
        dateFormat: "DD/MM/YYYY",
        skipRows: 1,
      },
    });

    const updated = await caller.bankRecon.templateUpdate({
      id: created.id,
      label: "Updated label",
      isActive: false,
    });

    expect(updated.label).toBe("Updated label");
    expect(updated.isActive).toBe(false);
  });

  it("rejects deleting a seeded template", async () => {
    const caller = callerForRamesh();

    const list = await caller.bankRecon.templateList();
    const seeded = list.find((t) => t.isSeeded);
    expect(seeded).toBeDefined();

    await expect(
      caller.bankRecon.templateDelete({ id: seeded!.id }),
    ).rejects.toThrow(/seeded/i);
  });

  it("deletes a custom template and it no longer appears in templateList", async () => {
    const caller = callerForRamesh();

    const created = await caller.bankRecon.templateCreate({
      bankDisplayName: "Delete Me Bank",
      columnMapping: {
        date: 0,
        narration: 1,
        debit: 2,
        credit: 3,
        dateFormat: "DD/MM/YYYY",
        skipRows: 1,
      },
    });

    await caller.bankRecon.templateDelete({ id: created.id });

    const list = await caller.bankRecon.templateList();
    const found = list.find((t) => t.id === created.id);
    expect(found).toBeUndefined();
  });
});

// ── CSV Import lifecycle ──────────────────────────────────────────────────────

describe("Bank Reconciliation — CSV Import", () => {
  it("uploads a CSV and returns correct preview row count and headers", async () => {
    const caller = callerForRamesh();

    const result = await caller.bankRecon.uploadCSV({
      bankAccountId: account.id,
      fileName: "simple.csv",
      csvContent: simpleCSV,
    });

    expect(result.importId).toBeDefined();
    expect(result.headers).toEqual(["Date", "Description", "Debit", "Credit", "Balance"]);
    // simpleCSV has 2 data rows; preview is min(5, rows)
    expect(result.previewRows.length).toBe(2);
    expect(result.totalRows).toBe(2);
  });

  it("confirmMapping creates statement lines with correct dates and amounts", async () => {
    const caller = callerForRamesh();

    const upload = await caller.bankRecon.uploadCSV({
      bankAccountId: account.id,
      fileName: "simple2.csv",
      csvContent: simpleCSV,
    });

    await caller.bankRecon.confirmMapping({
      importId: upload.importId,
      csvContent: simpleCSV,
      columnMapping: {
        date: 0,
        narration: 1,
        debit: 2,
        credit: 3,
        balance: 4,
        dateFormat: "DD/MM/YYYY",
        skipRows: 1,
      },
    });

    const db = getTenantTestDb();
    const lines = await db
      .select()
      .from(bankStatementLines)
      .where(eq(bankStatementLines.importId, upload.importId));

    expect(lines.length).toBe(2);
    // First line: debit 1500
    const debitLine = lines.find((l) => parseFloat(l.debit) > 0);
    expect(debitLine).toBeDefined();
    expect(parseFloat(debitLine!.debit)).toBeCloseTo(1500, 1);
    // Second line: credit 25000
    const creditLine = lines.find((l) => parseFloat(l.credit) > 0);
    expect(creditLine).toBeDefined();
    expect(parseFloat(creditLine!.credit)).toBeCloseTo(25000, 1);
  });

  it("auto-matches a statement line when an exact payment exists", async () => {
    const db = getTenantTestDb();
    const caller = callerForRamesh();

    // Create a payment that will match the credit line
    const paymentDate = new Date("2026-04-02");
    await createPayment(db, world.business1.id, party.id, {
      amount: "25000.00",
      paymentDate,
      mode: "bank",
      referenceNumber: "REF001",
    });

    // Upload CSV with that same credit amount on the same date
    const matchCSV = [
      "Date,Description,Debit,Credit,Balance",
      "02/04/2026,Client Payment Received,,25000.00,125000.00",
    ].join("\n");

    const upload = await caller.bankRecon.uploadCSV({
      bankAccountId: account.id,
      fileName: "match-test.csv",
      csvContent: matchCSV,
    });

    const result = await caller.bankRecon.confirmMapping({
      importId: upload.importId,
      csvContent: matchCSV,
      columnMapping: {
        date: 0,
        narration: 1,
        debit: 2,
        credit: 3,
        balance: 4,
        dateFormat: "DD/MM/YYYY",
        skipRows: 1,
      },
    });

    expect(result.matchedLines).toBeGreaterThanOrEqual(1);

    // Check the statement line has auto_matched status
    const lines = await db
      .select()
      .from(bankStatementLines)
      .where(eq(bankStatementLines.importId, upload.importId));

    const matched = lines.find((l) => l.matchStatus === "auto_matched");
    expect(matched).toBeDefined();
    expect(matched!.matchedPaymentId).not.toBeNull();
  });

  it("creates an expense from an unmatched debit line and marks it as created", async () => {
    const caller = callerForRamesh();

    const debitCSV = [
      "Date,Description,Debit,Credit,Balance",
      "03/04/2026,Office Supplies,3000.00,,97000.00",
    ].join("\n");

    const upload = await caller.bankRecon.uploadCSV({
      bankAccountId: account.id,
      fileName: "debit-test.csv",
      csvContent: debitCSV,
    });

    await caller.bankRecon.confirmMapping({
      importId: upload.importId,
      csvContent: debitCSV,
      columnMapping: {
        date: 0,
        narration: 1,
        debit: 2,
        credit: 3,
        balance: 4,
        dateFormat: "DD/MM/YYYY",
        skipRows: 1,
      },
    });

    const db = getTenantTestDb();
    const lines = await db
      .select()
      .from(bankStatementLines)
      .where(eq(bankStatementLines.importId, upload.importId));

    const debitLine = lines.find((l) => parseFloat(l.debit) > 0);
    expect(debitLine).toBeDefined();
    expect(debitLine!.matchStatus).toBe("unmatched");

    // Create an expense from the unmatched line
    const expense = await caller.bankRecon.createExpense({
      lineId: debitLine!.id,
      expense: {
        category: "Office Supplies",
        description: "Office Supplies purchase",
        amount: "3000.00",
        mode: "bank",
        expenseDate: new Date("2026-04-03").toISOString(),
      },
    });

    expect(expense).toBeDefined();
    expect(expense.category).toBe("Office Supplies");
    expect(expense.amount).toBe("3000.00");

    // Verify line is now marked as "created"
    const refreshed = await db
      .select()
      .from(bankStatementLines)
      .where(eq(bankStatementLines.id, debitLine!.id));

    expect(refreshed[0]!.matchStatus).toBe("created");
    expect(refreshed[0]!.matchedExpenseId).toBe(expense.id);
  });

  it("records the bank withdrawal for an expense created from a debit line", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();

    const csv = [
      "Date,Description,Debit,Credit,Balance",
      "05/04/2026,Courier charges,1250.50,,95000.00",
      "06/04/2026,Refund received,,400.00,95400.00",
    ].join("\n");

    const upload = await caller.bankRecon.uploadCSV({
      bankAccountId: account.id,
      fileName: "withdrawal-test.csv",
      csvContent: csv,
    });
    await caller.bankRecon.confirmMapping({
      importId: upload.importId,
      csvContent: csv,
      columnMapping: {
        date: 0,
        narration: 1,
        debit: 2,
        credit: 3,
        balance: 4,
        dateFormat: "DD/MM/YYYY",
        skipRows: 1,
      },
    });

    const lines = await db
      .select()
      .from(bankStatementLines)
      .where(eq(bankStatementLines.importId, upload.importId));
    const debitLine = lines.find((l) => parseFloat(l.debit) > 0)!;
    const creditLine = lines.find((l) => parseFloat(l.credit) > 0)!;
    expect(debitLine.matchStatus).toBe("unmatched");

    const [before] = await db
      .select({ currentBalance: bankAccounts.currentBalance })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, account.id));

    const expense = await caller.bankRecon.createExpense({
      lineId: debitLine.id,
      expense: {
        category: "Freight",
        amount: "1250.50",
        mode: "bank",
        expenseDate: new Date("2026-04-05").toISOString(),
      },
    });

    expect(expense.bankAccountId).toBe(account.id);

    const txns = await db
      .select()
      .from(bankTransactions)
      .where(and(
        eq(bankTransactions.referenceType, "expense"),
        eq(bankTransactions.referenceId, expense.id),
      ));
    expect(txns).toHaveLength(1);
    expect(txns[0]!.type).toBe("withdrawal");
    expect(txns[0]!.bankAccountId).toBe(account.id);
    expect(txns[0]!.amount).toBe("1250.50");

    const [after] = await db
      .select({ currentBalance: bankAccounts.currentBalance })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, account.id));
    expect(parseFloat(after!.currentBalance)).toBeCloseTo(
      parseFloat(before!.currentBalance) - 1250.5,
      2,
    );

    const [line] = await db
      .select()
      .from(bankStatementLines)
      .where(eq(bankStatementLines.id, debitLine.id));
    expect(line!.matchStatus).toBe("created");
    expect(line!.matchedExpenseId).toBe(expense.id);
    expect(line!.matchedBankTransactionId).toBe(txns[0]!.id);

    // A credit (deposit) line is not a withdrawal — no expense can be created.
    await expect(
      caller.bankRecon.createExpense({
        lineId: creditLine.id,
        expense: { category: "Misc", amount: "400.00", mode: "bank" },
      }),
    ).rejects.toThrow(/debit/);
  });

  it("applies a categorization rule to auto-categorize a matching line on import", async () => {
    const caller = callerForRamesh();

    // Create a rule: narration contains SALARY → expense in Salary category
    await caller.bankRecon.ruleCreate({
      matchField: "narration",
      matchType: "contains",
      matchValue: "SALARY",
      action: "create_expense",
      expenseCategory: "Salary",
      priority: 10,
    });

    const upload = await caller.bankRecon.uploadCSV({
      bankAccountId: account.id,
      fileName: "salary.csv",
      csvContent: salaryCSV,
    });

    await caller.bankRecon.confirmMapping({
      importId: upload.importId,
      csvContent: salaryCSV,
      columnMapping: {
        date: 0,
        narration: 1,
        debit: 2,
        credit: 3,
        balance: 4,
        dateFormat: "DD/MM/YYYY",
        skipRows: 1,
      },
    });

    const db = getTenantTestDb();
    const lines = await db
      .select()
      .from(bankStatementLines)
      .where(eq(bankStatementLines.importId, upload.importId));

    // The credit line should have auto_category = Salary
    const salaryLine = lines.find((l) => l.narration?.toUpperCase().includes("SALARY"));
    expect(salaryLine).toBeDefined();
    expect(salaryLine!.autoCategory).toBe("Salary");
  });

  it("saves templateId and templateVersion on import when templateId provided", async () => {
    const caller = callerForRamesh();

    // Get the HDFC template (seeded by first test)
    const templates = await caller.bankRecon.templateList();
    const hdfcTemplate = templates.find((t) => t.bankSlug === "hdfc" && t.isSeeded);
    expect(hdfcTemplate).toBeDefined();

    const upload = await caller.bankRecon.uploadCSV({
      bankAccountId: account.id,
      fileName: "hdfc-import.csv",
      csvContent: hdfcCSV,
    });

    // Confirm with explicit templateId
    await caller.bankRecon.confirmMapping({
      importId: upload.importId,
      csvContent: hdfcCSV,
      templateId: hdfcTemplate!.id,
      columnMapping: {
        date: 0,
        narration: 1,
        reference: 2,
        debit: 4,
        credit: 5,
        balance: 6,
        dateFormat: "DD/MM/YY",
        skipRows: 1,
      },
    });

    const db = getTenantTestDb();
    const [importRecord] = await db
      .select()
      .from(bankStatementImports)
      .where(eq(bankStatementImports.id, upload.importId));

    expect(importRecord!.templateId).toBe(hdfcTemplate!.id);
    expect(importRecord!.templateVersion).toBe(hdfcTemplate!.version);
  });
});

// ── Expense created from a statement line: its lifecycle ─────────────────────

describe("Bank Reconciliation — expense created from a line", () => {
  /** Import a one-line debit statement on `bankAccountId` and return the line. */
  async function importDebitLine(bankAccountId: string, row: string) {
    const caller = callerForRamesh();
    const csv = ["Date,Description,Debit,Credit,Balance", row].join("\n");
    const upload = await caller.bankRecon.uploadCSV({
      bankAccountId,
      fileName: "single-line.csv",
      csvContent: csv,
    });
    await caller.bankRecon.confirmMapping({
      importId: upload.importId,
      csvContent: csv,
      columnMapping: {
        date: 0,
        narration: 1,
        debit: 2,
        credit: 3,
        balance: 4,
        dateFormat: "DD/MM/YYYY",
        skipRows: 1,
      },
    });
    const [line] = await getTenantTestDb()
      .select()
      .from(bankStatementLines)
      .where(eq(bankStatementLines.importId, upload.importId));
    expect(line!.matchStatus).toBe("unmatched");
    return line!;
  }

  async function balanceOf(bankAccountId: string) {
    const [row] = await getTenantTestDb()
      .select({ currentBalance: bankAccounts.currentBalance })
      .from(bankAccounts)
      .where(eq(bankAccounts.id, bankAccountId));
    return row!.currentBalance;
  }

  async function withdrawalsFor(expenseId: string) {
    return getTenantTestDb()
      .select()
      .from(bankTransactions)
      .where(and(
        eq(bankTransactions.referenceType, "expense"),
        eq(bankTransactions.referenceId, expenseId),
      ));
  }

  // Regression: the "is the line still unmatched?" check ran outside the
  // transaction, so a double-submit recorded two expenses and two withdrawals.
  it("records the withdrawal exactly once when the request is sent twice", async () => {
    const caller = callerForRamesh();
    const line = await importDebitLine(account.id, "11/05/2026,Printer toner,777.77,,90000.00");
    const before = await balanceOf(account.id);

    const expense = {
      category: "Office Supplies",
      amount: "777.77",
      mode: "bank" as const,
      expenseDate: new Date("2026-05-11").toISOString(),
    };
    const results = await Promise.allSettled([
      caller.bankRecon.createExpense({ lineId: line.id, expense }),
      caller.bankRecon.createExpense({ lineId: line.id, expense }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);

    const db = getTenantTestDb();
    const txns = await db
      .select()
      .from(bankTransactions)
      .where(and(
        eq(bankTransactions.bankAccountId, account.id),
        eq(bankTransactions.amount, "777.77"),
      ));
    expect(txns).toHaveLength(1);
    expect(money.sub(before, await balanceOf(account.id))).toBe("777.77");

    const [refreshed] = await db
      .select()
      .from(bankStatementLines)
      .where(eq(bankStatementLines.id, line.id));
    expect(refreshed!.matchStatus).toBe("created");
    expect(refreshed!.matchedBankTransactionId).toBe(txns[0]!.id);
  });

  // Regression: deleting the expense reversed the withdrawal but left the line
  // "created" and pointing at the deleted expense, so it could never be
  // reconciled again (unmatch and createExpense both refused it).
  it("deleting the expense reverses the withdrawal and reopens the line", async () => {
    const caller = callerForRamesh();
    const line = await importDebitLine(account.id, "12/05/2026,Stationery,333.33,,89000.00");
    const before = await balanceOf(account.id);

    const expense = await caller.bankRecon.createExpense({
      lineId: line.id,
      expense: { category: "Stationery", amount: "333.33", mode: "bank" },
    });
    expect(await withdrawalsFor(expense.id)).toHaveLength(1);

    await caller.expense.delete({ id: expense.id });

    expect(await withdrawalsFor(expense.id)).toHaveLength(0);
    expect(await balanceOf(account.id)).toBe(before);

    const db = getTenantTestDb();
    const [reopened] = await db
      .select()
      .from(bankStatementLines)
      .where(eq(bankStatementLines.id, line.id));
    expect(reopened!.matchStatus).toBe("unmatched");
    expect(reopened!.matchedExpenseId).toBeNull();
    expect(reopened!.matchedBankTransactionId).toBeNull();

    const [imp] = await db
      .select()
      .from(bankStatementImports)
      .where(eq(bankStatementImports.id, line.importId));
    expect(imp!.unmatchedLines).toBe(1);
    expect(imp!.matchedLines).toBe(0);

    // The line can be reconciled again.
    const again = await caller.bankRecon.createExpense({
      lineId: line.id,
      expense: { category: "Stationery", amount: "333.33", mode: "bank" },
    });
    expect(await withdrawalsFor(again.id)).toHaveLength(1);
  });

  // Regression: expense.update re-created the withdrawal on the default account
  // for the payment mode, moving it off the statement's account and leaving
  // the line linked to a deleted bank transaction.
  it("editing the expense keeps the withdrawal on the statement's account", async () => {
    const caller = callerForRamesh();
    const db = getTenantTestDb();
    const other = await createBankAccount(db, world.business1.id, {
      accountName: "ICICI Current Account",
      accountNumber: "99887766554433",
      ifsc: "ICIC0000001",
      bankName: "ICICI Bank",
      accountType: "current",
      openingBalance: "50000.00",
      currentBalance: "50000.00",
      isDefault: false,
    });
    const line = await importDebitLine(other.id, "13/05/2026,Internet bill,1111.00,,48889.00");
    const defaultBefore = await balanceOf(account.id);

    const expense = await caller.bankRecon.createExpense({
      lineId: line.id,
      expense: { category: "Internet", amount: "1111.00", mode: "bank" },
    });
    expect(await balanceOf(other.id)).toBe("48889.00");

    // What the Expenses page sends when the user edits the description.
    await caller.expense.update({
      id: expense.id,
      data: {
        category: "Internet",
        description: "Broadband for May",
        amount: "1111.00",
        mode: "bank",
        expenseDate: new Date("2026-05-13").toISOString(),
      },
    });

    const txns = await withdrawalsFor(expense.id);
    expect(txns).toHaveLength(1);
    expect(txns[0]!.bankAccountId).toBe(other.id);
    expect(await balanceOf(other.id)).toBe("48889.00");
    expect(await balanceOf(account.id)).toBe(defaultBefore);

    const [refreshed] = await db
      .select()
      .from(bankStatementLines)
      .where(eq(bankStatementLines.id, line.id));
    expect(refreshed!.matchStatus).toBe("created");
    expect(refreshed!.matchedBankTransactionId).toBe(txns[0]!.id);
  });
});

// ── Converted statement formats (OFX, QIF, Excel) ────────────────────────────
//
// The web app turns OFX/QFX, QIF, Excel and PDF statements into CSV in the
// browser with the @fintranzact/shared converters, then calls uploadCSV. The
// converters' column names must be ones the API auto-maps.

describe("Bank Reconciliation — converted statement formats", () => {
  let plainAccount: TestBankAccount;

  beforeAll(async () => {
    // No IFSC or bank name, so no bank template is suggested and the
    // header heuristics decide the mapping.
    plainAccount = await createBankAccount(getTenantTestDb(), world.business1.id, {
      accountName: "Converted Formats Account",
      accountNumber: "99990000111122",
      ifsc: null,
      bankName: null,
    });
  });

  async function importConverted(fileName: string, csvContent: string) {
    const caller = callerForRamesh();
    const upload = await caller.bankRecon.uploadCSV({ bankAccountId: plainAccount.id, fileName, csvContent });
    const m = upload.detectedMapping;
    await caller.bankRecon.confirmMapping({
      importId: upload.importId,
      csvContent,
      columnMapping: {
        date: m.date!,
        narration: m.narration!,
        debit: m.debit,
        credit: m.credit,
        reference: m.reference,
        balance: m.balance,
        dateFormat: m.dateFormat ?? "DD/MM/YYYY",
        skipRows: m.skipRows ?? 1,
      },
    });
    const lines = await getTenantTestDb()
      .select()
      .from(bankStatementLines)
      .where(eq(bankStatementLines.importId, upload.importId));
    return { upload, lines: lines.sort((a, b) => a.lineNumber - b.lineNumber) };
  }

  it("auto-maps every column of an OFX statement and imports its lines", async () => {
    const csv = rowsToCsv(
      ofxToRows(
        [
          "OFXHEADER:100",
          "<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>",
          "<STMTTRN><DTPOSTED>20260401<TRNAMT>-1500.00<FITID>OFX001<NAME>Office, Supplies</STMTTRN>",
          "<STMTTRN><DTPOSTED>20260402<TRNAMT>25000<FITID>OFX002<NAME>Client Payment</STMTTRN>",
          "</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>",
        ].join("\n"),
      ),
    );
    const { upload, lines } = await importConverted("april.ofx", csv);

    expect(upload.detectedTemplate).toBeNull();
    expect(upload.detectedMapping).toMatchObject({ date: 0, narration: 1, reference: 2, debit: 3, credit: 4 });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ narration: "Office, Supplies", referenceNumber: "OFX001", debit: "1500.00", credit: "0.00" });
    expect(lines[1]).toMatchObject({ narration: "Client Payment", referenceNumber: "OFX002", debit: "0.00", credit: "25000.00" });
    expect(lines[0]!.transactionDate.getDate()).toBe(1);
    expect(lines[0]!.transactionDate.getMonth()).toBe(3);
  });

  it("doesn't force the bank's template on a file without its headers", async () => {
    // HDFC IFSC and bank name on the account, but an OFX export's columns.
    const csvContent = rowsToCsv(
      ofxToRows("<OFX><STMTTRN><DTPOSTED>20260405<TRNAMT>-750<FITID>OFX009<NAME>Courier</STMTTRN></OFX>"),
    );
    const upload = await callerForRamesh().bankRecon.uploadCSV({ bankAccountId: account.id, fileName: "hdfc.ofx", csvContent });

    expect(upload.detectedTemplate).toBeNull();
    expect(upload.detectedMapping).toMatchObject({ date: 0, narration: 1, reference: 2, debit: 3, credit: 4 });
  });

  it("imports a QIF statement", async () => {
    const csv = rowsToCsv(qifToRows("!Type:Bank\nD1/4'26\nT-2,000.00\nPATM WDL\nN000123\n^\n"));
    const { upload, lines } = await importConverted("april.qif", csv);

    expect(upload.detectedMapping).toMatchObject({ date: 0, narration: 1, reference: 2, debit: 3, credit: 4 });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ narration: "ATM WDL", referenceNumber: "000123", debit: "2000.00" });
  });

  it("imports an Excel sheet from its header row", async () => {
    const csv = rowsToCsv(
      sheetToRows([
        ["Statement of Account", null],
        ["Account No", "99990000111122"],
        ["Txn Date", "Description", "Debit", "Credit", "Balance"],
        [new Date(Date.UTC(2026, 3, 3)), "Bank charges", 118, null, 9882],
      ]),
    );
    const { upload, lines } = await importConverted("april.xlsx", csv);

    expect(upload.headers).toEqual(["Txn Date", "Description", "Debit", "Credit", "Balance"]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ narration: "Bank charges", debit: "118.00", credit: "0.00", balance: "9882.00" });
  });
});
