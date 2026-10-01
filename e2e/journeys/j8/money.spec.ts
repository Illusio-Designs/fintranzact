/**
 * J8 — Money, end to end, as the business owner does it in the app.
 *
 * Cash & bank:
 *   a current account opened (number, IFSC, bank, ₹50,000 opening balance,
 *   made the default) and its opening balance corrected to ₹60,000; ₹5,000
 *   moved from the bank to the cash box; cash received and paid out; bank
 *   interest credited.
 * Expenses:
 *   rent and electricity by bank transfer (electricity booked ten days back),
 *   stationery in cash, travel by UPI — each lands on the account its mode
 *   says; the list filtered by category.
 * Bank statement:
 *   an HDFC-format CSV for the account uploaded and auto-matched (the
 *   transfer, a customer's NEFT, the rent, the interest); the customer's
 *   receipt confirmed; the electricity bill matched by hand; a card purchase
 *   at a stationery shop — the same ₹450 as the cash stationery bought that
 *   day, but a different payment — booked as an expense from its line with a
 *   double click (one expense, one withdrawal); bank charges ignored; that
 *   expense then deleted from Expenses and the line is open again.
 * Journal entries:
 *   depreciation entered unbalanced (refused, difference shown), corrected
 *   and saved: ledger lines in the DB.
 * Recurring invoices:
 *   a monthly template for the customer starting today: the API's own
 *   scheduler (a one-minute tick) raises today's invoice by itself; "Run now"
 *   raises next month's early; the run history lists both and the next run
 *   is two months on. (The browser runs in India time, as the business does.)
 *
 * Runs at 1280px and 390px; the bank & cash test in the light theme, the
 * journal & recurring test in the dark.
 *
 * Balances, worked out by hand:
 *   HDFC  60,000 − 5,000 + 1,250 + 11,800 − 25,000 − 4,500 (− 450 + 450) = 38,550
 *   Cash  5,000 + 2,000 − 350 − 450 = 6,200
 *
 * Prerequisites another journey owns are seeded through the API: the
 * customer and service item (J3), the customer's invoice and its payment
 * into the bank account (J4). No bank, payment gateway or other outside
 * service is involved: statements are CSV files the user uploads.
 */
import type { Locator, Page } from "@playwright/test";
import {
  test,
  expect,
  expectNoHorizontalScroll,
  expectTheme,
  toast,
} from "../../helpers/journey";
import { seedOwner, type SeededOwner } from "../../helpers/journey-seed";
import { seedMoneyMasters, seedReceiptIntoAccount, type MoneyMasters } from "../../helpers/money-seed";
import { choose, dialog, inr, listRow, openBusiness, openPage, pick, pickDateDaysAhead } from "../../helpers/journey-ui";

/** Pick a period from the date menu (one "Date range: …" button). */
async function chooseDateRange(page: import("@playwright/test").Page, label: string) {
  await page.getByRole("button", { name: /^Date range:/ }).first().click();
  await page.getByRole("menuitemradio", { name: label }).click();
}
import {
  bankAccountsOf,
  bankTransactionsOf,
  bookBankBalance,
  documentLines,
  documentsOf,
  expensesOf,
  journalEntriesOf,
  recurringRunsOf,
  recurringTemplatesOfBusiness,
  statementImportsOf,
  statementLinesOf,
} from "../../helpers/db";

// ── Helpers ─────────────────────────────────────────────────────

/** Today in India as an HDFC statement writes it: dd/mm/yy. */
function istToday() {
  const d = new Date(Date.now() + 330 * 60_000);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${String(d.getUTCFullYear()).slice(2)}`;
}

/** An account in the Cash & Bank list (its select button). */
function accountButton(page: Page, name: string) {
  return page.getByRole("button", { name: new RegExp(`^${name} `) });
}

async function expectAccountBalance(page: Page, name: string, amount: number) {
  await expect(accountButton(page, name)).toContainText(inr(amount));
}

/** The figure under a stat card's label. */
function stat(page: Page, label: string) {
  return page.locator("p").filter({ hasText: new RegExp(`^${label}$`) }).locator("xpath=following-sibling::p[1]");
}

async function addTransaction(page: Page, type: "Deposit" | "Withdrawal", amount: string, description: string) {
  await page.getByRole("button", { name: "+ Add Transaction" }).click();
  const form = dialog(page, "Add Transaction");
  await form.getByRole("tab", { name: type }).or(form.getByRole("button", { name: type, exact: true })).click();
  await form.getByLabel("Amount (₹)").fill(amount);
  await form.getByLabel("Description").fill(description);
  await expectNoHorizontalScroll(page, "add transaction");
  await form.getByRole("button", { name: "Add Transaction" }).click();
  await expect(toast(page, "Transaction recorded")).toBeVisible();
  await expect(form).toBeHidden();
}

/** A statement line's row in the review table, by its narration. */
function statementRow(page: Page, narration: string): Locator {
  return page.getByRole("row").filter({ hasText: narration });
}

async function newExpense(
  page: Page,
  e: { category: string; amount: string; mode: string; reference?: string; description?: string; daysAgo?: number },
) {
  await page.getByRole("button", { name: "+ New Expense" }).click();
  const form = dialog(page, "Add Expense");
  await form.getByLabel("Category").fill(e.category);
  await form.getByLabel("Amount").fill(e.amount);
  await choose(page, form.getByRole("combobox", { name: "Payment Mode" }), e.mode);
  if (e.daysAgo) await pickDateDaysAhead(page, form.getByLabel("Date"), -e.daysAgo);
  if (e.reference) await form.getByLabel("Reference # (optional)").fill(e.reference);
  if (e.description) await form.getByLabel("Description (optional)").fill(e.description);
  await expectNoHorizontalScroll(page, "add expense");
  await form.getByRole("button", { name: "Add Expense" }).click();
  await expect(toast(page, "Expense added")).toBeVisible();
  await expect(form).toBeHidden();
}

// ── Journey ─────────────────────────────────────────────────────

test.describe("J8 money", () => {
  test.setTimeout(420_000);
  // An Indian business: dates picked in forms are India dates.
  test.use({ timezoneId: "Asia/Kolkata" });

  test("bank & cash accounts, transfer, expenses, statement import → auto/manual match → expense from a line → delete", async ({
    context,
    page,
  }) => {
    const owner: SeededOwner = await seedOwner(context, "j8");
    const m: MoneyMasters = await seedMoneyMasters(owner);

    await openBusiness(page, owner);
    await expectTheme(page, "light");

    // ── A current account with an opening balance ────────────────
    await openPage(page, "Cash & Bank");
    // Every business starts with its cash box.
    await expectAccountBalance(page, "Cash", 0);
    await page.getByRole("button", { name: "+ Add Account" }).click();
    let form = dialog(page, "Add Bank Account");
    await expect(form.getByRole("combobox", { name: "Account Type" })).toContainText("Current Account");
    await form.getByLabel("Account Name").fill("HDFC Current");
    await form.getByLabel("Account Number").fill("50200012345678");
    await form.getByLabel("IFSC Code").fill("HDFC0000123");
    await form.getByLabel("Bank Name").fill("HDFC Bank");
    await form.getByLabel("Opening Balance (₹)").fill("50000");
    await form.getByRole("switch", { name: "Set as default account" }).click();
    await expectNoHorizontalScroll(page, "add bank account");
    await form.getByRole("button", { name: "Create Account" }).click();
    await expect(toast(page, "Account created")).toBeVisible();
    await expectAccountBalance(page, "HDFC Current", 50000);
    let [cash, hdfc] = await bankAccountsOf(owner.businessId);
    expect(cash).toMatchObject({ account_name: "Cash", account_type: "cash", current_balance: "0.00" });
    expect(hdfc).toMatchObject({
      account_name: "HDFC Current",
      account_type: "current",
      account_number: "50200012345678",
      ifsc: "HDFC0000123",
      bank_name: "HDFC Bank",
      opening_balance: "50000.00",
      current_balance: "50000.00",
      is_default: true,
    });

    // The opening balance was wrong: ₹60,000. The balance moves with it.
    await page.getByRole("button", { name: "Edit HDFC Current" }).click();
    form = dialog(page, "Edit Account");
    await expect(form.getByLabel("Opening Balance (₹)")).toHaveValue("50000.00");
    await form.getByLabel("Opening Balance (₹)").fill("60000");
    await expectNoHorizontalScroll(page, "edit account");
    await form.getByRole("button", { name: "Save Changes" }).click();
    await expect(toast(page, "Account updated")).toBeVisible();
    await expectAccountBalance(page, "HDFC Current", 60000);
    [cash, hdfc] = await bankAccountsOf(owner.businessId);
    expect([hdfc.opening_balance, hdfc.current_balance]).toEqual(["60000.00", "60000.00"]);

    // ── Cash drawn from the bank into the cash box ───────────────
    await page.getByRole("button", { name: "Transfer", exact: true }).first().click();
    form = dialog(page, "Transfer Money");
    await choose(page, form.getByRole("combobox", { name: "From Account" }), `HDFC Current (${inr(60000)})`);
    await choose(page, form.getByRole("combobox", { name: "To Account" }), `Cash (${inr(0)})`);
    await form.getByLabel("Amount (₹)").fill("5000");
    await form.getByLabel("Description").fill("ATM cash for the counter");
    await expectNoHorizontalScroll(page, "transfer money");
    await form.getByRole("button", { name: "Transfer", exact: true }).click();
    await expect(toast(page, "Transfer completed")).toBeVisible();
    await expectAccountBalance(page, "HDFC Current", 55000);
    await expectAccountBalance(page, "Cash", 5000);

    // ── Cash in and out of the cash box ──────────────────────────
    await accountButton(page, "Cash").click();
    // Transactions load once a period is picked.
    await expect(page.getByText("Select a time period above to load transactions")).toBeVisible();
    await page.getByRole("button", { name: "All", exact: true }).click();
    await addTransaction(page, "Deposit", "2000", "Counter sales");
    await addTransaction(page, "Withdrawal", "350", "Courier charges");
    await expectAccountBalance(page, "Cash", 6650);
    const cashTxns = page.getByRole("row").filter({ hasText: /Counter sales|Courier charges|ATM cash/ });
    await expect(cashTxns).toHaveCount(3);
    await expect(statementRow(page, "Courier charges")).toContainText(`-${inr(350)}`);
    await expect(statementRow(page, "Courier charges")).toContainText(inr(6650)); // running balance
    await expectNoHorizontalScroll(page, "cash account transactions");

    // ── Interest credited by the bank ────────────────────────────
    await accountButton(page, "HDFC Current").click();
    await page.getByRole("button", { name: "All", exact: true }).click();
    await addTransaction(page, "Deposit", "1250", "Interest credit");
    await expectAccountBalance(page, "HDFC Current", 56250);
    await expect(statementRow(page, "ATM cash for the counter")).toContainText(`-${inr(5000)}`);

    expect((await bankTransactionsOf(cash.id)).map((t) => [t.type, t.amount, t.description])).toEqual([
      ["deposit", "5000.00", "ATM cash for the counter"],
      ["deposit", "2000.00", "Counter sales"],
      ["withdrawal", "350.00", "Courier charges"],
    ]);
    expect((await bankTransactionsOf(hdfc.id)).map((t) => [t.type, t.amount, t.description, t.reference_type])).toEqual([
      ["withdrawal", "5000.00", "ATM cash for the counter", "transfer"],
      ["deposit", "1250.00", "Interest credit", null],
    ]);

    // ── A customer pays ₹11,800 into the account by NEFT (J4) ────
    const receipt = await seedReceiptIntoAccount(owner, m, hdfc.id, "NEFTN26100012345");

    // ── Expenses, by mode ────────────────────────────────────────
    await openPage(page, "Expenses");
    await newExpense(page, { category: "Rent", amount: "25000", mode: "Bank Transfer", reference: "RENT-OCT", description: "Shop rent" });
    await newExpense(page, {
      category: "Electricity",
      amount: "4500",
      mode: "Bank Transfer",
      daysAgo: 10,
      description: "MSEDCL bill",
    });
    await newExpense(page, { category: "Office Supplies", amount: "450", mode: "Cash", description: "Printer paper" });
    await newExpense(page, { category: "Travel", amount: "800", mode: "UPI", description: "Cab to the warehouse" });
    await chooseDateRange(page, "All");
    for (const [category, amount] of [["Rent", 25000], ["Electricity", 4500], ["Office Supplies", 450], ["Travel", 800]] as const) {
      await expect(listRow(page, category)).toContainText(inr(amount));
    }
    await expectNoHorizontalScroll(page, "Expenses");
    // By category.
    await page.getByRole("button", { name: "Rent", exact: true }).click();
    await expect(listRow(page, "Shop rent")).toBeVisible();
    await expect(listRow(page, "Printer paper")).toHaveCount(0);
    await page.getByRole("button", { name: "All", exact: true }).last().click();
    await expect(listRow(page, "Printer paper")).toBeVisible();

    const expensesBefore = await expensesOf(owner.businessId);
    expect(expensesBefore.map((e) => [e.category, e.amount, e.mode])).toEqual([
      ["Rent", "25000.00", "bank"],
      ["Electricity", "4500.00", "bank"],
      ["Office Supplies", "450.00", "cash"],
      ["Travel", "800.00", "upi"],
    ]);
    const [rent, electricity] = expensesBefore;
    // Bank-transfer expenses come out of the default bank account, cash out
    // of the cash box; there is no UPI account, so travel moves neither.
    const withdrawals = async (accountId: string) =>
      (await bankTransactionsOf(accountId)).filter((t) => t.reference_type === "expense").map((t) => [t.amount, t.reference_id]);
    expect(await withdrawals(hdfc.id)).toEqual([["25000.00", rent.id], ["4500.00", electricity.id]]);
    expect(await withdrawals(cash.id)).toEqual([["450.00", expensesBefore[2].id]]);

    await openPage(page, "Cash & Bank");
    await expectAccountBalance(page, "HDFC Current", 38550);
    await expectAccountBalance(page, "Cash", 6200);
    await expect(stat(page, "Bank Balance")).toHaveText(inr(38550));
    await expect(stat(page, "Cash in Hand")).toHaveText(inr(6200));
    await expect(stat(page, "Total Balance")).toHaveText(inr(44750));

    // ── The bank's statement ─────────────────────────────────────
    const today = istToday();
    const csv = [
      "Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance",
      `${today},ATM WDL MG ROAD MUMBAI,ATM00123,${today},5000.00,,55000.00`,
      `${today},NEFT CR-PUNE RETAIL-NEFTN26100012345,NEFTN26100012345,${today},,11800.00,66800.00`,
      `${today},RENT OCT SHOP,RENT-OCT,${today},25000.00,,41800.00`,
      `${today},INTEREST CREDIT,INT0001,${today},,1250.00,43050.00`,
      `${today},ECS MSEDCL ELECTRICITY,ECS99881,${today},4500.00,,38550.00`,
      `${today},POS 4587XXXX STATIONERY MART,POS77812,${today},450.00,,38100.00`,
      `${today},BANK CHARGES INCL GST,CHG0001,${today},118.00,,37982.00`,
    ].join("\n");

    await openPage(page, "Bank Reconciliation");
    await page.getByRole("button", { name: "Upload & Map" }).click();
    await choose(page, page.getByRole("combobox", { name: "Bank Account" }), "HDFC Current — HDFC Bank");
    const chooser = page.waitForEvent("filechooser");
    await page.getByText("Drag & drop a statement here").click();
    await (await chooser).setFiles({ name: "hdfc-oct.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await expect(page.getByText("hdfc-oct.csv")).toBeVisible();
    await expectNoHorizontalScroll(page, "statement upload");
    await page.getByRole("button", { name: "Upload & Detect Columns" }).click();
    await expect(page.getByRole("heading", { name: "Map Columns — hdfc-oct.csv" })).toBeVisible();
    await expectNoHorizontalScroll(page, "statement column mapping");
    await page.getByRole("button", { name: "Confirm & Auto-Match" }).click();
    await expect(toast(page, "Parsed 7 lines. 4 auto-matched, 3 unmatched.")).toBeVisible();

    // ── Review: what matched, and the rest by hand ───────────────
    await expect(statementRow(page, "ATM WDL")).toContainText("Auto-matched");
    await expect(statementRow(page, "NEFT CR-PUNE RETAIL")).toContainText("Auto-matched");
    await expect(statementRow(page, "RENT OCT SHOP")).toContainText("Auto-matched");
    await expect(statementRow(page, "INTEREST CREDIT")).toContainText("Auto-matched");
    await expect(statementRow(page, "ECS MSEDCL")).toContainText("Unmatched");
    await expect(statementRow(page, "STATIONERY MART")).toContainText("Unmatched");
    await expect(statementRow(page, "BANK CHARGES")).toContainText("Unmatched");
    await expectNoHorizontalScroll(page, "statement review");

    let lines = await statementLinesOf(hdfc.id);
    const line = (narration: string) => lines.find((l) => l.narration?.includes(narration))!;
    expect(line("NEFT CR").matched_payment_id).toBe(receipt.payment.id);
    expect(line("RENT OCT").matched_expense_id).toBe(rent.id);
    expect(line("ATM WDL").matched_bank_transaction_id).not.toBeNull();
    expect(line("INTEREST").matched_bank_transaction_id).not.toBeNull();
    // Not the cash stationery of the same amount and day.
    expect(line("STATIONERY").matched_expense_id).toBeNull();

    await statementRow(page, "NEFT CR-PUNE RETAIL").getByRole("button", { name: "Confirm" }).click();
    await expect(toast(page, "Match confirmed")).toBeVisible();
    await expect(statementRow(page, "NEFT CR-PUNE RETAIL")).toContainText("Manual");

    // The electricity bill was booked ten days before the bank paid it.
    await statementRow(page, "ECS MSEDCL").getByRole("button", { name: "Match" }).click();
    const match = dialog(page, /^Manual Match/);
    await choose(page, match.getByRole("combobox", { name: "Select Expense" }), new RegExp(`^${inr(4500).replace(/[.]/g, "\\.")} — Electricity`));
    await expectNoHorizontalScroll(page, "manual match");
    await match.getByRole("button", { name: "Confirm Match" }).click();
    await expect(toast(page, "Manually matched")).toBeVisible();
    await expect(statementRow(page, "ECS MSEDCL")).toContainText("Manual");

    // The card purchase becomes its own expense — a double click books it once.
    const hdfcTxnsBefore = (await bankTransactionsOf(hdfc.id)).length;
    await statementRow(page, "STATIONERY MART").getByRole("button", { name: "+ Expense" }).click();
    const create = dialog(page, `Create Expense — ${inr(450)}`);
    await create.getByLabel("Category *").fill("Office Supplies");
    await expect(create.getByLabel("Description")).toHaveValue("POS 4587XXXX STATIONERY MART");
    await create.getByRole("button", { name: "Create Expense" }).dblclick();
    await expect(toast(page, "Expense created and linked")).toBeVisible();
    await expect(create).toBeHidden();
    await expect(statementRow(page, "STATIONERY MART")).toContainText("Expense created");

    await statementRow(page, "BANK CHARGES").getByRole("button", { name: "Ignore" }).click();
    await expect(toast(page, "Line ignored")).toBeVisible();
    await expect(statementRow(page, "BANK CHARGES")).toContainText("Ignored");

    const afterCreate = await expensesOf(owner.businessId);
    const fromLine = afterCreate.filter((e) => e.description === "POS 4587XXXX STATIONERY MART");
    expect(fromLine.map((e) => [e.category, e.amount, e.mode, e.bank_account_id])).toEqual([
      ["Office Supplies", "450.00", "bank", hdfc.id],
    ]);
    const hdfcTxns = await bankTransactionsOf(hdfc.id);
    expect(hdfcTxns).toHaveLength(hdfcTxnsBefore + 1);
    expect(hdfcTxns.filter((t) => t.reference_id === fromLine[0].id).map((t) => [t.type, t.amount])).toEqual([["withdrawal", "450.00"]]);
    expect(await bookBankBalance(hdfc.id)).toBe(38100);
    lines = await statementLinesOf(hdfc.id);
    expect(lines.map((l) => [l.narration, l.match_status])).toEqual([
      ["ATM WDL MG ROAD MUMBAI", "auto_matched"],
      ["NEFT CR-PUNE RETAIL-NEFTN26100012345", "manual_matched"],
      ["RENT OCT SHOP", "auto_matched"],
      ["INTEREST CREDIT", "auto_matched"],
      ["ECS MSEDCL ELECTRICITY", "manual_matched"],
      ["POS 4587XXXX STATIONERY MART", "created"],
      ["BANK CHARGES INCL GST", "ignored"],
    ]);
    expect(lines.find((l) => l.narration?.includes("ECS MSEDCL"))!.matched_expense_id).toBe(electricity.id);
    const [imp] = await statementImportsOf(hdfc.id);
    expect(imp).toMatchObject({ file_name: "hdfc-oct.csv", total_lines: 7 });

    await openPage(page, "Cash & Bank");
    await expectAccountBalance(page, "HDFC Current", 38100);

    // ── That expense deleted: withdrawal reversed, line open again ─
    await openPage(page, "Expenses");
    await chooseDateRange(page, "All");
    const stationeryRow = listRow(page, "POS 4587XXXX STATIONERY MART");
    await stationeryRow.getByRole("button", { name: "Delete expense" }).click();
    const confirm = page.getByRole("alertdialog").or(page.getByRole("dialog")).filter({ hasText: /Delete/ });
    await expectNoHorizontalScroll(page, "delete expense");
    await confirm.getByRole("button", { name: /^Delete/ }).click();
    await expect(toast(page, "Expense deleted")).toBeVisible();
    await expect(stationeryRow).toHaveCount(0);
    expect((await expensesOf(owner.businessId)).find((e) => e.id === fromLine[0].id)!.deleted_at).not.toBeNull();
    expect((await bankTransactionsOf(hdfc.id)).filter((t) => t.reference_id === fromLine[0].id)).toEqual([]);
    expect(await bookBankBalance(hdfc.id)).toBe(38550);
    expect((await statementLinesOf(hdfc.id)).find((l) => l.narration?.includes("STATIONERY"))).toMatchObject({
      match_status: "unmatched",
      matched_expense_id: null,
      matched_bank_transaction_id: null,
    });

    await openPage(page, "Bank Reconciliation");
    // The hub's import row counts the reopened line as unmatched again.
    const importRow = listRow(page, "hdfc-oct.csv");
    await expect(importRow.getByRole("cell")).toHaveText([/hdfc-oct\.csv/, /review/i, "7", "5", "1", /\d{4}/, "Review"]);
    expect(await statementImportsOf(hdfc.id)).toMatchObject([{ matched_lines: 5, unmatched_lines: 1 }]);
    await importRow.getByRole("button", { name: "Review" }).click();
    await expect(statementRow(page, "STATIONERY MART")).toContainText("Unmatched");
    await expect(statementRow(page, "STATIONERY MART").getByRole("button", { name: "+ Expense" })).toBeVisible();

    await openPage(page, "Cash & Bank");
    await expectAccountBalance(page, "HDFC Current", 38550);
    await expectAccountBalance(page, "Cash", 6200);
    // The stored balances agree with opening balance + transactions.
    for (const a of await bankAccountsOf(owner.businessId)) {
      expect(Number(a.current_balance), a.account_name).toBe(await bookBankBalance(a.id));
    }
  });

  test.describe("in the evening", () => {
    test.use({ theme: "dark" });

    test("journal entries (unbalanced refused, balanced saved); recurring invoice: schedule → run → invoice", async ({
      context,
      page,
    }) => {
      const owner: SeededOwner = await seedOwner(context, "j8j");
      const m: MoneyMasters = await seedMoneyMasters(owner);

      await openBusiness(page, owner);
      await expectTheme(page, "dark");

      // ── Journal entry: depreciation on the shop fittings ─────────
      await openPage(page, "Journal Entries");
      await page.getByRole("button", { name: "+ New Entry" }).click();
      const entry = dialog(page, "New Journal Entry");
      await entry.getByLabel("Narration").fill("Depreciation on shop fittings, H1");
      const accountLine = (i: number) => entry.getByRole("combobox", { name: "Account" }).nth(i);
      await pickAccount(page, accountLine(0), "Depreciation", "5900 - Depreciation");
      await pickAccount(page, accountLine(1), "Fixed Assets", "1500 - Fixed Assets");
      await entry.getByLabel("Debit").nth(0).fill("12000");
      await entry.getByLabel("Credit").nth(1).fill("10000");
      // Debits and credits must agree.
      await expect(entry.getByText(`Unbalanced (${inr(2000)})`)).toBeVisible();
      await expect(entry.getByRole("button", { name: "Create Entry" })).toBeDisabled();
      await expectNoHorizontalScroll(page, "new journal entry");
      await entry.getByLabel("Credit").nth(1).fill("12000");
      await expect(entry.getByText("Balanced")).toBeVisible();
      await entry.getByRole("button", { name: "Create Entry" }).click();
      await expect(toast(page, "Journal entry created")).toBeVisible();
      await expect(entry).toBeHidden();
      const [je] = await journalEntriesOf(owner.businessId);
      expect(je).toMatchObject({ narration: "Depreciation on shop fittings, H1", source: "manual", is_voided: false });
      expect(je.lines.map((l) => [l.code, Number(l.debit), Number(l.credit)])).toEqual([
        ["5900", 12000, 0],
        ["1500", 0, 12000],
      ]);
      const jeRow = listRow(page, je.entry_number);
      await expect(jeRow).toContainText("Depreciation on shop fittings");
      await expect(jeRow).toContainText(inr(12000));
      await expectNoHorizontalScroll(page, "Journal Entries");
      // Opened, it shows its two ledger lines.
      await jeRow.click();
      await expect(page.getByText("2 line items")).toBeVisible();
      await expect(page.getByRole("row").filter({ hasText: /^5900\s*Depreciation/ })).toContainText(inr(12000));
      await expect(page.getByRole("row").filter({ hasText: /^1500\s*Fixed Assets/ })).toContainText(inr(12000));

      // ── Recurring invoice: every month for the customer ──────────
      await openPage(page, "Recurring Invoices");
      await page.getByRole("button", { name: "+ New Template" }).click();
      const tpl = dialog(page, "Create Template");
      await tpl.getByLabel("Template Name").fill("Monthly AMC");
      await pick(page, tpl.getByRole("combobox", { name: "Party" }), m.customer.name);
      await expect(tpl.getByRole("combobox", { name: "Type" })).toContainText(/Sale/);
      await choose(page, tpl.getByRole("combobox", { name: "Frequency" }), "Monthly");
      await choose(page, tpl.getByRole("combobox", { name: "Item" }), m.amc.name);
      await expect(tpl.getByLabel("Item name")).toHaveValue(m.amc.name);
      await tpl.getByLabel("Qty").fill("1");
      await tpl.getByLabel("Unit Price").fill("5000");
      await tpl.getByLabel("Tax %").fill("18");
      await expectNoHorizontalScroll(page, "create recurring template");
      await tpl.getByRole("button", { name: "Create Template" }).click();
      await expect(toast(page, "Automated invoice template created")).toBeVisible();
      await expect(tpl).toBeHidden();
      const [template] = await recurringTemplatesOfBusiness(owner.businessId);
      expect(template).toMatchObject({ name: "Monthly AMC", party_id: m.customer.id, type: "sale", frequency: "monthly", status: "active", total_runs: 0 });
      expect(template.line_items.map((l) => [l.itemId, Number(l.quantity), Number(l.unitPrice), Number(l.taxPercent)])).toEqual([
        [m.amc.id, 1, 5000, 18],
      ]);
      const tplRow = listRow(page, "Monthly AMC");
      await expect(tplRow).toContainText(m.customer.name);
      await expect(tplRow).toContainText("Monthly");
      await expectNoHorizontalScroll(page, "Recurring Invoices");

      // It starts today, so the scheduler raises today's invoice on its
      // next tick (once a minute) without anyone pressing anything.
      await expect
        .poll(async () => (await recurringRunsOf(template.id)).map((r) => r.status), { timeout: 90_000, intervals: [2_000] })
        .toEqual(["success"]);
      const [scheduled] = await documentsOf(m.customer.id, "invoice");
      expect((await recurringRunsOf(template.id))[0].invoice_id).toBe(scheduled.id);
      expect(scheduled).toMatchObject({ type: "sale", subtotal: "5000.00", tax_amount: "900.00", total_amount: "5900.00" });
      expect((await documentLines(scheduled.id)).map((l) => [l.item_id, l.quantity, l.unit_price, l.tax_percent])).toEqual([
        [m.amc.id, "1.000", "5000.00", "18.00"],
      ]);
      const monthsAhead = (d: Date | string) => {
        const next = new Date(d);
        const now = new Date(Date.now() + 330 * 60_000);
        const ist = new Date(next.getTime() + 330 * 60_000);
        return (ist.getUTCFullYear() - now.getUTCFullYear()) * 12 + ist.getUTCMonth() - now.getUTCMonth();
      };
      let [after] = await recurringTemplatesOfBusiness(owner.businessId);
      expect([after.total_runs, monthsAhead(after.next_run_date)]).toEqual([1, 1]);

      // Run now: next month's invoice raised early, the schedule moves on.
      await page.reload();
      await expect(tplRow.getByRole("cell").nth(-2)).toHaveText("1"); // runs
      await tplRow.getByRole("button", { name: "Run now" }).click();
      await expect(toast(page, "Invoice generated successfully")).toBeVisible();
      await expect(tplRow.getByRole("cell").nth(-2)).toHaveText("2");
      const runs = await recurringRunsOf(template.id);
      expect(runs.map((r) => r.status)).toEqual(["success", "success"]);
      const generated = await documentsOf(m.customer.id, "invoice");
      expect(generated.map((i) => i.id)).toEqual(runs.map((r) => r.invoice_id));
      const invoice = generated[1];
      expect(invoice).toMatchObject({ type: "sale", total_amount: "5900.00" });
      [after] = await recurringTemplatesOfBusiness(owner.businessId);
      expect(after.total_runs).toBe(2);
      expect(after.last_run_date).not.toBeNull();
      expect(monthsAhead(after.next_run_date)).toBe(2);

      // The template's history, and the invoice in Invoices.
      await tplRow.getByRole("cell").first().click();
      const detail = page.getByRole("dialog").filter({ hasText: "Monthly AMC" });
      await expect(detail.getByText("Total Runs").locator("xpath=following-sibling::*[1]")).toHaveText("2");
      await expect(detail.getByText("Next Run").locator("xpath=following-sibling::*[1]")).toHaveText(/\d{2} \w{3} \d{4}/);
      await detail.getByRole("button", { name: "Execution History" }).click();
      await expect(detail.getByText(scheduled.invoice_number)).toBeVisible();
      await expect(detail.getByText(invoice.invoice_number)).toBeVisible();
      await expectNoHorizontalScroll(page, "recurring template detail");
      await detail.getByRole("button", { name: "Close" }).click();
      await openPage(page, "Invoices");
      const invRow = listRow(page, invoice.invoice_number);
      await expect(invRow).toContainText(m.customer.name);
      await expect(invRow).toContainText(inr(5900));
      await expectTheme(page, "dark");
    });
  });
});

/** Choose a ledger account in a journal line by searching for it. */
async function pickAccount(page: Page, combobox: Locator, search: string, option: string) {
  await combobox.click();
  await combobox.fill(search);
  await page.getByRole("option", { name: option }).click();
  await expect(combobox).toHaveValue(option);
}
