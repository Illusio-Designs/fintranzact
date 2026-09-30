/**
 * Router gaps: bankRecon.
 *
 * bank-reconciliation.test.ts covers templates, CSV upload/mapping,
 * auto-matching and creating expenses. This file covers the listing and
 * review procedures (importList, importDetail, lines, confirmMatch,
 * manualMatch, unmatch, ignoreLine, summary), the rule CRUD, and the
 * validation, not-found, permission and cross-business rules of each.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { bankStatementImports, bankStatementLines, bankStatementTemplates } from "@fintranzact/db";
import { getTenantTestDb, truncateAllTables, closeTestDb } from "../helpers/test-db.js";
import {
  createBankAccount,
  createExpense,
  createParty,
  createPayment,
  createTestWorld,
  type TestBankAccount,
  type TestWorld,
} from "../helpers/fixtures.js";
import { callerFor, expectCode } from "../helpers/assertions.js";

let world: TestWorld;
let account: TestBankAccount;
let otherAccount: TestBankAccount;
const UNKNOWN = "00000000-0000-4000-8000-000000000000";
const caller = () => callerFor(world, "ramesh");
const seller = () => callerFor(world, "suresh");
const other = () => callerFor(world, "kiran");

const CSV = [
  "Date,Description,Debit,Credit,Balance",
  "01/04/2026,Stationery,1500.00,,98500.00",
  "02/04/2026,Client receipt,,25000.00,123500.00",
  "03/04/2026,Bank charges,50.00,,123450.00",
].join("\n");
const MAPPING = { date: 0, narration: 1, debit: 2, credit: 3, balance: 4, dateFormat: "DD/MM/YYYY", skipRows: 1 };

async function importStatement(c = caller(), bankAccountId = account.id) {
  const up = await c.bankRecon.uploadCSV({ bankAccountId, fileName: "gap.csv", csvContent: CSV });
  await c.bankRecon.confirmMapping({ importId: up.importId, csvContent: CSV, columnMapping: MAPPING });
  const lines = await getTenantTestDb().select().from(bankStatementLines)
    .where(eq(bankStatementLines.importId, up.importId)).orderBy(bankStatementLines.lineNumber);
  return { importId: up.importId, lines };
}

async function importRow(id: string) {
  const [row] = await getTenantTestDb().select().from(bankStatementImports).where(eq(bankStatementImports.id, id));
  return row!;
}

async function lineRow(id: string) {
  const [row] = await getTenantTestDb().select().from(bankStatementLines).where(eq(bankStatementLines.id, id));
  return row!;
}

beforeAll(async () => {
  world = await createTestWorld();
  const db = getTenantTestDb();
  account = await createBankAccount(db, world.business1.id, { currentBalance: "100000.00", openingBalance: "100000.00" });
  otherAccount = await createBankAccount(db, world.business2.id, { currentBalance: "5000.00" });
});

afterAll(async () => {
  await truncateAllTables();
  await closeTestDb();
});

describe("bankRecon.uploadCSV / confirmMapping", () => {
  it("uploadCSV validates input and refuses unknown or foreign accounts and empty files", async () => {
    await expectCode(caller().bankRecon.uploadCSV({ bankAccountId: account.id, fileName: "", csvContent: CSV }), "BAD_REQUEST");
    await expectCode(caller().bankRecon.uploadCSV({ bankAccountId: account.id, fileName: "a", csvContent: "" }), "BAD_REQUEST");
    await expectCode(caller().bankRecon.uploadCSV({ bankAccountId: UNKNOWN, fileName: "a", csvContent: CSV }), "NOT_FOUND");
    await expectCode(caller().bankRecon.uploadCSV({ bankAccountId: otherAccount.id, fileName: "a", csvContent: CSV }), "NOT_FOUND");
    await expectCode(caller().bankRecon.uploadCSV({ bankAccountId: account.id, fileName: "a", csvContent: "Date,Description" }), "BAD_REQUEST");
  });

  it("confirmMapping refuses unknown and foreign imports, foreign templates, and a mapping with no rows", async () => {
    const up = await caller().bankRecon.uploadCSV({ bankAccountId: account.id, fileName: "m.csv", csvContent: CSV });
    await expectCode(caller().bankRecon.confirmMapping({ importId: UNKNOWN, csvContent: CSV, columnMapping: MAPPING }), "NOT_FOUND");
    await expectCode(other().bankRecon.confirmMapping({ importId: up.importId, csvContent: CSV, columnMapping: MAPPING }), "NOT_FOUND");
    const theirs = await other().bankRecon.templateCreate({ bankDisplayName: "Their bank", columnMapping: MAPPING });
    await expectCode(caller().bankRecon.confirmMapping({ importId: up.importId, csvContent: CSV, columnMapping: MAPPING, templateId: theirs.id }), "NOT_FOUND");
    // Pointing the date column at the narration yields no parseable rows.
    await expectCode(caller().bankRecon.confirmMapping({ importId: up.importId, csvContent: CSV, columnMapping: { ...MAPPING, date: 1 } }), "BAD_REQUEST");
    await expectCode(caller().bankRecon.confirmMapping({ importId: up.importId, csvContent: CSV, columnMapping: { ...MAPPING, date: -1 } }), "BAD_REQUEST");
  });

  it("confirmMapping moves the import to review with counts and closing balance, and can't be repeated", async () => {
    const { importId, lines } = await importStatement();
    expect(lines).toHaveLength(3);
    const row = await importRow(importId);
    expect(row).toMatchObject({ status: "review", totalLines: 3, closingBalance: "123450.00" });
    await expectCode(caller().bankRecon.confirmMapping({ importId, csvContent: CSV, columnMapping: MAPPING }), "BAD_REQUEST");
  });

  it("sellers can't upload", async () => {
    await expectCode(seller().bankRecon.uploadCSV({ bankAccountId: account.id, fileName: "s", csvContent: CSV }), "FORBIDDEN");
  });
});

describe("bankRecon.importList / importDetail / lines", () => {
  it("lists imports newest first, filtered by account and paged; scoped to the business", async () => {
    const { importId } = await importStatement();
    const all = await caller().bankRecon.importList({ page: 1, limit: 100 });
    expect(all.data[0]!.id).toBe(importId);
    expect(all.total).toBe(all.data.length);
    const byAcct = await caller().bankRecon.importList({ bankAccountId: account.id, page: 1, limit: 100 });
    expect(byAcct.total).toBe(all.total);
    expect((await caller().bankRecon.importList({ bankAccountId: UNKNOWN, page: 1, limit: 100 })).total).toBe(0);
    expect((await other().bankRecon.importList({ page: 1, limit: 100 })).data.find((d) => d.id === importId)).toBeUndefined();
    await expectCode(caller().bankRecon.importList({ page: 0, limit: 10 }), "BAD_REQUEST");
  });

  it("importDetail: returns the import; NOT_FOUND for unknown and foreign ids", async () => {
    const { importId } = await importStatement();
    await expect(caller().bankRecon.importDetail({ importId })).resolves.toMatchObject({ id: importId, status: "review" });
    await expectCode(caller().bankRecon.importDetail({ importId: UNKNOWN }), "NOT_FOUND");
    await expectCode(other().bankRecon.importDetail({ importId }), "NOT_FOUND");
  });

  it("lines: in line order, filtered by status and paged; NOT_FOUND for other businesses", async () => {
    const { importId } = await importStatement();
    const res = await caller().bankRecon.lines({ importId, page: 1, limit: 100 });
    expect(res.data.map((l) => l.lineNumber)).toEqual(res.data.map((l) => l.lineNumber).sort((a, b) => a - b));
    expect(res.total).toBe(3);
    const unmatched = await caller().bankRecon.lines({ importId, status: "unmatched", page: 1, limit: 100 });
    expect(unmatched.data.every((l) => l.matchStatus === "unmatched")).toBe(true);
    expect((await caller().bankRecon.lines({ importId, page: 2, limit: 2 })).data).toHaveLength(1);
    await expectCode(other().bankRecon.lines({ importId, page: 1, limit: 10 }), "NOT_FOUND");
    await expectCode(caller().bankRecon.lines({ importId, status: "odd" as never, page: 1, limit: 10 }), "BAD_REQUEST");
  });

  it("a seller can't read reconciliation", async () => {
    await expectCode(seller().bankRecon.importList({ page: 1, limit: 10 }), "FORBIDDEN");
  });
});

describe("bankRecon matching", () => {
  it("manualMatch links a payment, updates counts; unmatch clears it", async () => {
    const { importId, lines } = await importStatement();
    const credit = lines.find((l) => parseFloat(l.credit) > 0)!;
    const pay = await createPayment(getTenantTestDb(), world.business1.id, world.party1.id, { amount: "25000.00" });
    await expect(caller().bankRecon.manualMatch({ lineId: credit.id, paymentId: pay.id })).resolves.toEqual({ success: true });
    expect(await lineRow(credit.id)).toMatchObject({ matchStatus: "manual_matched", matchedPaymentId: pay.id, matchConfidence: "1.00" });
    expect((await importRow(importId)).matchedLines).toBe(1);

    await caller().bankRecon.unmatch({ lineId: credit.id });
    expect(await lineRow(credit.id)).toMatchObject({ matchStatus: "unmatched", matchedPaymentId: null, matchConfidence: null });
    expect((await importRow(importId)).matchedLines).toBe(0);
    await expectCode(caller().bankRecon.unmatch({ lineId: credit.id }), "BAD_REQUEST");
  });

  it("manualMatch needs exactly one target", async () => {
    const { lines } = await importStatement();
    await expectCode(caller().bankRecon.manualMatch({ lineId: lines[0]!.id }), "BAD_REQUEST");
    await expectCode(caller().bankRecon.manualMatch({ lineId: lines[0]!.id, paymentId: UNKNOWN, expenseId: UNKNOWN }), "BAD_REQUEST");
  });

  it("manualMatch refuses a payment, expense or bank transaction of another business, or one that doesn't exist", async () => {
    const { lines } = await importStatement();
    const line = lines[0]!;
    const db = getTenantTestDb();
    const theirPay = await createPayment(db, world.business2.id, world.party2.id);
    const theirExp = await createExpense(db, world.business2.id);
    await expectCode(caller().bankRecon.manualMatch({ lineId: line.id, paymentId: theirPay.id }), "NOT_FOUND");
    await expectCode(caller().bankRecon.manualMatch({ lineId: line.id, expenseId: theirExp.id }), "NOT_FOUND");
    await expectCode(caller().bankRecon.manualMatch({ lineId: line.id, paymentId: UNKNOWN }), "NOT_FOUND");
    await expectCode(caller().bankRecon.manualMatch({ lineId: line.id, bankTransactionId: UNKNOWN }), "NOT_FOUND");
    expect((await lineRow(line.id)).matchStatus).toBe("unmatched");
  });

  it("manualMatch accepts the business's own expense", async () => {
    const { lines } = await importStatement();
    const exp = await createExpense(getTenantTestDb(), world.business1.id, { amount: "1500.00" });
    await caller().bankRecon.manualMatch({ lineId: lines[0]!.id, expenseId: exp.id });
    expect((await lineRow(lines[0]!.id)).matchedExpenseId).toBe(exp.id);
  });

  it("confirmMatch accepts only auto-matched lines", async () => {
    const { lines } = await importStatement();
    const line = lines[0]!;
    await expectCode(caller().bankRecon.confirmMatch({ lineId: line.id }), "BAD_REQUEST");
    await getTenantTestDb().update(bankStatementLines).set({ matchStatus: "auto_matched" }).where(eq(bankStatementLines.id, line.id));
    await expect(caller().bankRecon.confirmMatch({ lineId: line.id })).resolves.toEqual({ success: true });
    expect((await lineRow(line.id)).matchStatus).toBe("manual_matched");
  });

  it("ignoreLine marks the line ignored and drops it from the unmatched count", async () => {
    const { importId, lines } = await importStatement();
    const before = (await importRow(importId)).unmatchedLines;
    await caller().bankRecon.ignoreLine({ lineId: lines[2]!.id });
    expect((await lineRow(lines[2]!.id)).matchStatus).toBe("ignored");
    expect((await importRow(importId)).unmatchedLines).toBe(before - 1);
  });

  it("every line mutation is NOT_FOUND for unknown or foreign lines", async () => {
    const { lines } = await importStatement();
    const id = lines[0]!.id;
    const cases: Array<[ReturnType<typeof caller>, string]> = [[caller(), UNKNOWN], [other(), id]];
    for (const [c, lineId] of cases) {
      await expectCode(c.bankRecon.confirmMatch({ lineId }), "NOT_FOUND");
      await expectCode(c.bankRecon.manualMatch({ lineId, paymentId: UNKNOWN }), "NOT_FOUND");
      await expectCode(c.bankRecon.unmatch({ lineId }), "NOT_FOUND");
      await expectCode(c.bankRecon.ignoreLine({ lineId }), "NOT_FOUND");
      await expectCode(c.bankRecon.createExpense({ lineId, expense: { category: "x", amount: "1", mode: "bank" } as never }), "NOT_FOUND");
    }
  });

  it("createExpense refuses credit lines and invalid expenses", async () => {
    const { lines } = await importStatement();
    const credit = lines.find((l) => parseFloat(l.credit) > 0)!;
    await expectCode(caller().bankRecon.createExpense({ lineId: credit.id, expense: { category: "x", amount: "1", mode: "bank" } as never }), "BAD_REQUEST");
    await expectCode(caller().bankRecon.createExpense({ lineId: lines[0]!.id, expense: { category: "", amount: "1", mode: "bank" } as never }), "BAD_REQUEST");
    await expectCode(caller().bankRecon.createExpense({ lineId: lines[0]!.id, expense: { category: "x", amount: "0", mode: "bank" } as never }), "BAD_REQUEST");
  });

  it("sellers can't change lines", async () => {
    const { lines } = await importStatement();
    await expectCode(seller().bankRecon.ignoreLine({ lineId: lines[0]!.id }), "FORBIDDEN");
    await expectCode(seller().bankRecon.manualMatch({ lineId: lines[0]!.id, paymentId: UNKNOWN }), "FORBIDDEN");
  });
});

describe("bankRecon.summary", () => {
  it("compares the statement's closing balance with the book balance and sums unmatched lines", async () => {
    const acct = await createBankAccount(getTenantTestDb(), world.business1.id, { accountName: "Summary acct", currentBalance: "120000.00", isDefault: false });
    const { importId, lines } = await importStatement(caller(), acct.id);
    await caller().bankRecon.ignoreLine({ lineId: lines[2]!.id }); // the 50.00 charge
    const s = await caller().bankRecon.summary({ bankAccountId: acct.id });
    expect(s).toMatchObject({
      bookBalance: "120000.00",
      statementBalance: "123450.00",
      difference: "3450.00",
      unmatchedDebits: "1500.00",
      unmatchedCredits: "25000.00",
    });
    expect(s.import!.id).toBe(importId);
  });

  it("has no statement figures before any import", async () => {
    const fresh = await createBankAccount(getTenantTestDb(), world.business1.id, { accountName: "Fresh", isDefault: false });
    const s = await caller().bankRecon.summary({ bankAccountId: fresh.id });
    expect(s).toMatchObject({ statementBalance: null, difference: null, unmatchedDebits: "0.00", import: null });
  });

  it("NOT_FOUND for unknown and foreign accounts", async () => {
    await expectCode(caller().bankRecon.summary({ bankAccountId: UNKNOWN }), "NOT_FOUND");
    await expectCode(caller().bankRecon.summary({ bankAccountId: otherAccount.id }), "NOT_FOUND");
  });

  it("won't read another business's import, or another account's, through importId", async () => {
    const theirs = await importStatement(other(), otherAccount.id);
    const s = await caller().bankRecon.summary({ bankAccountId: account.id, importId: theirs.importId });
    expect(s.import).toBeNull();
    expect(s.statementBalance).toBeNull();

    const acct2 = await createBankAccount(getTenantTestDb(), world.business1.id, { accountName: "Second", isDefault: false });
    const mine = await importStatement(caller(), acct2.id);
    const cross = await caller().bankRecon.summary({ bankAccountId: account.id, importId: mine.importId });
    expect(cross.import).toBeNull();
  });
});

describe("bankRecon templates", () => {
  it("templateCreate validates input; templateList filters by search and is scoped", async () => {
    await expectCode(caller().bankRecon.templateCreate({ bankDisplayName: "", columnMapping: MAPPING }), "BAD_REQUEST");
    await expectCode(caller().bankRecon.templateCreate({ bankDisplayName: "X", columnMapping: { ...MAPPING, date: -1 } }), "BAD_REQUEST");
    const t = await caller().bankRecon.templateCreate({ bankDisplayName: "Zeta Co-op Bank", columnMapping: MAPPING, fileFormat: "csv" });
    expect(t.bankSlug).toMatch(/^custom_/);
    const found = await caller().bankRecon.templateList({ search: "zeta co-op" });
    expect(found.map((x) => x.id)).toEqual([t.id]);
    expect((await other().bankRecon.templateList({ search: "Zeta Co-op" })).map((x) => x.id)).not.toContain(t.id);
  });

  it("templateFork bumps the version across the slug; NOT_FOUND for foreign and unknown", async () => {
    const t = await caller().bankRecon.templateCreate({ bankSlug: "fork_gap", bankDisplayName: "Fork Gap", columnMapping: MAPPING });
    const f1 = await caller().bankRecon.templateFork({ templateId: t.id, label: "v2" });
    const f2 = await caller().bankRecon.templateFork({ templateId: t.id });
    expect([f1.version, f2.version]).toEqual([2, 3]);
    expect(f1).toMatchObject({ forkedFromId: t.id, label: "v2", isSeeded: false });
    await expectCode(caller().bankRecon.templateFork({ templateId: UNKNOWN }), "NOT_FOUND");
    await expectCode(other().bankRecon.templateFork({ templateId: t.id }), "NOT_FOUND");
  });

  it("templateUpdate and templateDelete: NOT_FOUND for unknown and foreign; update can deactivate", async () => {
    const t = await caller().bankRecon.templateCreate({ bankDisplayName: "Upd Gap", columnMapping: MAPPING });
    await expect(caller().bankRecon.templateUpdate({ id: t.id, isActive: false, label: "old" })).resolves.toMatchObject({ isActive: false, label: "old" });
    await expectCode(caller().bankRecon.templateUpdate({ id: UNKNOWN, label: "x" }), "NOT_FOUND");
    await expectCode(other().bankRecon.templateUpdate({ id: t.id, label: "x" }), "NOT_FOUND");
    await expectCode(other().bankRecon.templateDelete({ id: t.id }), "NOT_FOUND");
    await expectCode(caller().bankRecon.templateDelete({ id: UNKNOWN }), "NOT_FOUND");
    await caller().bankRecon.templateDelete({ id: t.id });
    const rows = await getTenantTestDb().select().from(bankStatementTemplates).where(eq(bankStatementTemplates.id, t.id));
    expect(rows).toHaveLength(0);
  });

  it("sellers can't manage templates", async () => {
    await expectCode(seller().bankRecon.templateCreate({ bankDisplayName: "S", columnMapping: MAPPING }), "FORBIDDEN");
    await expectCode(seller().bankRecon.templateList(), "FORBIDDEN");
  });
});

describe("bankRecon rules", () => {
  const rule = (extra: Record<string, unknown> = {}) => ({
    matchField: "narration" as const, matchType: "contains" as const, matchValue: "CHARGES", action: "create_expense" as const,
    expenseCategory: "Bank Charges", priority: 5, ...extra,
  });

  it("ruleCreate validates input and refuses a foreign account or party", async () => {
    await expectCode(caller().bankRecon.ruleCreate(rule({ matchValue: "" })), "BAD_REQUEST");
    await expectCode(caller().bankRecon.ruleCreate(rule({ matchType: "fuzzy" })), "BAD_REQUEST");
    await expectCode(caller().bankRecon.ruleCreate(rule({ priority: -1 })), "BAD_REQUEST");
    await expectCode(caller().bankRecon.ruleCreate(rule({ bankAccountId: otherAccount.id })), "NOT_FOUND");
    await expectCode(caller().bankRecon.ruleCreate(rule({ action: "tag_party", partyId: world.party2.id })), "NOT_FOUND");
  });

  it("ruleList orders by priority and includes account-less rules when filtered by account", async () => {
    const low = await caller().bankRecon.ruleCreate(rule({ matchValue: "LOW", priority: 1 }));
    const high = await caller().bankRecon.ruleCreate(rule({ matchValue: "HIGH", priority: 99, bankAccountId: account.id }));
    const acct2 = await createBankAccount(getTenantTestDb(), world.business1.id, { accountName: "Rules acct", isDefault: false });
    const scoped = await caller().bankRecon.ruleCreate(rule({ matchValue: "OTHER ACCT", bankAccountId: acct2.id }));
    const list = await caller().bankRecon.ruleList();
    expect(list[0]!.id).toBe(high.id);
    const forAccount = (await caller().bankRecon.ruleList({ bankAccountId: account.id })).map((r) => r.id);
    expect(forAccount).toEqual(expect.arrayContaining([low.id, high.id]));
    expect(forAccount).not.toContain(scoped.id);
    expect(await other().bankRecon.ruleList()).toEqual([]);
  });

  it("ruleUpdate changes fields; refuses a foreign account or party; NOT_FOUND for unknown and foreign rules", async () => {
    const r = await caller().bankRecon.ruleCreate(rule({ matchValue: "UPD" }));
    await expect(caller().bankRecon.ruleUpdate({ id: r.id, data: { isActive: false, priority: 7 } })).resolves.toMatchObject({ isActive: false, priority: 7 });
    await expectCode(caller().bankRecon.ruleUpdate({ id: r.id, data: { bankAccountId: otherAccount.id } }), "NOT_FOUND");
    await expectCode(caller().bankRecon.ruleUpdate({ id: r.id, data: { partyId: world.party2.id } }), "NOT_FOUND");
    await expectCode(caller().bankRecon.ruleUpdate({ id: UNKNOWN, data: { priority: 1 } }), "NOT_FOUND");
    await expectCode(other().bankRecon.ruleUpdate({ id: r.id, data: { priority: 1 } }), "NOT_FOUND");
    await expectCode(caller().bankRecon.ruleUpdate({ id: r.id, data: { matchValue: "" } }), "BAD_REQUEST");
  });

  it("ruleDelete removes the rule; NOT_FOUND for unknown and foreign rules; sellers refused", async () => {
    const r = await caller().bankRecon.ruleCreate(rule({ matchValue: "DEL" }));
    await expectCode(other().bankRecon.ruleDelete({ id: r.id }), "NOT_FOUND");
    await expectCode(seller().bankRecon.ruleDelete({ id: r.id }), "FORBIDDEN");
    await caller().bankRecon.ruleDelete({ id: r.id });
    expect((await caller().bankRecon.ruleList()).map((x) => x.id)).not.toContain(r.id);
    await expectCode(caller().bankRecon.ruleDelete({ id: r.id }), "NOT_FOUND");
  });

  it("a rule for the business's own party is accepted", async () => {
    const p = await createParty(getTenantTestDb(), world.business1.id, { name: "Rule party" });
    await expect(caller().bankRecon.ruleCreate(rule({ action: "tag_party", partyId: p.id, matchValue: "RULE PARTY" }))).resolves.toMatchObject({ partyId: p.id });
  });
});
