/**
 * J10 — Dashboard and reports, checked against the GST month J9 books.
 *
 * The month is the one J9 enters through the invoice forms (helpers/gst-seed:
 * five sales — one at 00:05 IST on the 1st — three supplier bills and two
 * credit notes); J9 owns entering it in the UI, so here it is seeded through
 * the API, together with a receipt from a customer, a payment to a supplier
 * (J8's money journey owns those) and a rent expense. Every sale and bill is
 * issued (marked sent).
 *
 * Then, for "Last Month" — the month just ended, as the owner reviews it
 * after closing it:
 *
 *   Dashboard: sales, purchases, to collect, to pay, cash position, expenses,
 *   gross and net profit, invoice status, payment modes, month on month.
 *   Business Reports: day book, sales register, purchase register,
 *   outstanding (receivables and payables), item-wise sales, tax summary.
 *   GST Returns page: profit & loss, trial balance, balance sheet,
 *   receivables aging and a party ledger.
 *
 * Every figure is worked out twice: by hand from the month's documents (the
 * comments say how) and from the database rows the API stored (gst-db.ts),
 * and the screens must show exactly that. Sales and purchases are invoice
 * totals (with GST); profit is on taxable value, net of credit notes, with
 * cost of goods sold from stock (all bought at one price, so stock is at
 * that cost); what is outstanding is each bill less its payments and the
 * credit notes against it.
 *
 * Theme: the dashboard is checked in the light theme and the reports again in
 * the dark one (browser clock moved to India night, page reloaded).
 *
 * External services: none (no payment gateway — receipts are recorded cash).
 */
import type { Locator, Page } from "@playwright/test";
import { test, expect, expectNoHorizontalScroll, expectTheme, instantFor, isPhone } from "../../helpers/journey";
import { seedOwner } from "../../helpers/journey-seed";
import { inr, openBusiness, openPage, openReport, pick } from "../../helpers/journey-ui";
import { GST_MONTH, istMidnight, lastMonthInIndia, seedGstMasters, seedGstMonthViaApi } from "../../helpers/gst-seed";
import { gstDocuments, paymentsOfBusiness, round2, taxableOf } from "../../helpers/gst-db";
import { db, itemStock } from "../../helpers/db";

test.use({ timezoneId: "Asia/Kolkata" });

function statCard(scope: Page | Locator, label: string) {
  return scope.getByText(label, { exact: true }).locator("xpath=following-sibling::p[1]");
}

/** Index of a table column by its header (columns a phone hides are not there). */
async function columnOf(page: Page, header: string) {
  await expect(page.getByRole("columnheader").first()).toBeVisible();
  const headers = (await page.getByRole("columnheader").allInnerTexts()).map((h) => h.trim().toLowerCase());
  const i = headers.indexOf(header.toLowerCase());
  expect(i, `a "${header}" column in ${headers.join(" | ")}`).toBeGreaterThanOrEqual(0);
  return i;
}

/** Pick "Last Month" in the page's date-range bar. */
async function lastMonth(page: Page) {
  const button = page.getByRole("button", { name: "Last Month", exact: true }).first();
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
}

test.describe("J10 dashboard & reports", () => {
  test.setTimeout(420_000);

  test("the GST month on the dashboard and in every report, to the paisa", async ({ context, page }) => {
    const p = lastMonthInIndia();
    const owner = await seedOwner(context, "j10");
    const m = await seedGstMasters(owner);
    const ids = await seedGstMonthViaApi(owner, m, p);
    for (const key of ["boundary", "bill118", "bill42", "b2bIntra", "b2bInter", "b2cl", "exempt", "bill131"]) {
      await owner.api.mutate("invoice.updateStatus", { id: ids[key].id, status: "sent" });
    }
    for (const key of ["cnUnreg", "cnReg"]) {
      await owner.api.mutate("creditNote.updateStatus", { id: ids[key].id, status: "sent" });
    }
    // Money (J8's journey): ₹10,000 received from Pune against its invoice,
    // the Bengaluru bill paid in full, ₹1,500 rent — all cash.
    await owner.api.mutate("payment.create", {
      partyId: m.pune.id,
      invoiceId: ids.b2bIntra.id,
      amount: "10000",
      mode: "cash",
      paymentDate: istMidnight(p, 20).toISOString(),
    });
    await owner.api.mutate("payment.create", {
      partyId: m.bengaluru.id,
      invoiceId: ids.bill42.id,
      amount: "10080",
      mode: "cash",
      paymentDate: istMidnight(p, 21).toISOString(),
    });
    await owner.api.mutate("expense.create", {
      category: "Rent",
      description: "Shop rent",
      amount: "1500",
      mode: "cash",
      expenseDate: istMidnight(p, 25).toISOString(),
    });

    // ── The figures, from the database ─────────────────────────────
    const docs = await gstDocuments(owner.businessId);
    const pays = await paymentsOfBusiness(owner.businessId);
    const sum = (xs: number[]) => round2(xs.reduce((a, b) => a + b, 0));
    const of = (type: string, documentType: string) => docs.filter((d) => d.type === type && d.document_type === documentType);
    const saleInvoices = of("sale", "invoice");
    const creditNotes = of("sale", "credit_note");
    const bills = of("purchase", "invoice");
    const received = sum(pays.filter((x) => x.party_id !== m.bengaluru.id).map((x) => Number(x.amount)));
    const paid = sum(pays.filter((x) => x.party_id === m.bengaluru.id).map((x) => Number(x.amount)));
    const [{ total: expenseTotal }] = await db()`select coalesce(sum(amount), 0)::float as total from expenses where business_id = ${owner.businessId} and deleted_at is null`;
    const F = {
      sales: sum(saleInvoices.map((d) => Number(d.total_amount))), // 1,47,040
      salesTaxable: sum(saleInvoices.map(taxableOf)), // 1,25,500 (Item-wise Sales is excl. GST)
      notes: sum(creditNotes.map((d) => Number(d.total_amount))), // 14,160
      purchases: sum(bills.map((d) => Number(d.total_amount))), // 1,20,960
      received, // 10,000
      paid, // 10,080
      expenses: Number(expenseTotal), // 1,500
      netSalesTaxable: sum(saleInvoices.map(taxableOf)) - sum(creditNotes.map(taxableOf)), // 1,13,500
      purchasesTaxable: sum(bills.map(taxableOf)), // 1,03,500
      outputTax: sum(saleInvoices.map((d) => Number(d.tax_amount))) - sum(creditNotes.map((d) => Number(d.tax_amount))), // 19,380
      inputTax: sum(bills.map((d) => Number(d.tax_amount))), // 17,460
    };
    // Closing stock at cost: each item's stock × the one price it was bought at
    const closingStock =
      (await itemStock(m.bracket.id)).total * 700 + (await itemStock(m.tonic.id)).total * 300 + (await itemStock(m.rice.id)).total * 35;
    const toCollect = F.sales - F.notes - F.received;
    const toPay = F.purchases - F.paid;
    const cogs = F.purchasesTaxable - closingStock;
    const grossProfit = F.netSalesTaxable - cogs;
    const netProfit = grossProfit - F.expenses;
    // The hand-worked month agrees with the database
    expect({ sales: F.sales, notes: F.notes, purchases: F.purchases, closingStock, toCollect, toPay, grossProfit, netProfit }).toEqual({
      sales: GST_MONTH.gstr1.value,
      notes: 14160,
      purchases: 120960,
      closingStock: 17900,
      toCollect: 122880,
      toPay: 110880,
      grossProfit: 27900,
      netProfit: 26400,
    });
    expect(round2(F.outputTax - F.inputTax)).toBe(GST_MONTH.gstr3b.net.total);

    // ── Dashboard (light) ──────────────────────────────────────────
    await openBusiness(page, owner);
    await expectTheme(page, "light");
    await lastMonth(page);
    const tile = (name: string) => page.getByTestId(`dashboard-${name}`);
    await expect(tile("sales")).toHaveText(inr(F.sales));
    await expect(tile("purchases")).toHaveText(inr(F.purchases));
    await expect(tile("to-collect")).toHaveText(inr(toCollect));
    await expect(tile("to-pay")).toHaveText(inr(toPay));
    await expect(tile("cash-position")).toHaveText(inr(F.received - F.paid - F.expenses));
    await expect(tile("expenses")).toHaveText(inr(F.expenses));
    await expect(tile("gross-profit")).toHaveText(inr(grossProfit));
    await expect(tile("net-profit")).toHaveText(inr(netProfit));
    // The sale invoices only (no supplier bills): four unpaid, Pune's part paid
    const status = page.getByTestId("dashboard-invoice-status");
    await expect(status).toContainText(`${saleInvoices.length} invoices`);
    await expect(status).toContainText(inr(F.sales - 14040));
    await expect(status).toContainText(inr(14040));
    // Money received only — the supplier payment is not a receipt
    await expect(page.getByTestId("dashboard-payment-modes")).toContainText(`${inr(F.received)} received`);
    // Month on month: the month just ended is the earlier column
    const mom = page.getByTestId("dashboard-month-on-month");
    const shortMonth = new Date(Date.UTC(p.year, p.month - 1, 15)).toLocaleString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" });
    await expect(mom).toContainText(shortMonth);
    await expect(mom.getByText("Sales", { exact: true }).locator("xpath=following-sibling::span[1]")).toHaveText(inr(F.sales));
    await expectNoHorizontalScroll(page, "dashboard");

    // ── Business Reports, in the dark ──────────────────────────────
    await page.clock.setSystemTime(instantFor("dark"));
    await page.reload();
    await expectTheme(page, "dark");

    await openReport(page, "Daybook");
    await lastMonth(page);
    // Sales net of the credit notes; the 1st's sale is in (an Indian day)
    await expect(statCard(page, "Sales Invoiced")).toHaveText(inr(F.sales - F.notes));
    await expect(statCard(page, "Purchase Invoiced")).toHaveText(inr(F.purchases));
    await expect(statCard(page, "Payments Received")).toHaveText(inr(F.received));
    await expect(statCard(page, "Payments Made")).toHaveText(inr(F.paid));
    await expect(statCard(page, "Expenses")).toHaveText(inr(F.expenses));
    await expect(statCard(page, "Net Cash Movement")).toHaveText(inr(F.received - F.paid - F.expenses));
    // The 1st's sale opens the book; a credit note to a customer is on the
    // debit side (the phone shows fewer columns: find them by header)
    await expect(page.getByRole("row").nth(1)).toHaveText(new RegExp(`^0?1 \\w+ ${p.year}$`));
    const debitCol = await columnOf(page, "Debit");
    const creditCol = await columnOf(page, "Credit");
    const bookRow = (party: string, amount: number) =>
      page.getByRole("row").filter({ hasText: party }).filter({ hasText: inr(amount) }).getByRole("cell");
    await expect(bookRow(m.ramesh.name, 2360).nth(creditCol)).toHaveText(inr(2360));
    await expect(bookRow(m.anand.name, 11800).nth(debitCol)).toHaveText(inr(11800));
    await expect(bookRow(m.anand.name, 11800).nth(creditCol)).toHaveText("—");
    await expectNoHorizontalScroll(page, "daybook");

    await openReport(page, "Sales Register");
    await expect(statCard(page, "Subtotal")).toHaveText(inr(126000 - 12000)); // lines before the ₹500 discount, less the notes
    await expect(statCard(page, "Total Tax")).toHaveText(inr(F.outputTax));
    await expect(statCard(page, "Total Amount")).toHaveText(inr(F.sales - F.notes));
    await expect(statCard(page, "Invoices")).toHaveText(String(saleInvoices.length + creditNotes.length));
    await expectNoHorizontalScroll(page, "sales register");

    await openReport(page, "Purchase Register");
    await expect(statCard(page, "Subtotal")).toHaveText(inr(F.purchasesTaxable));
    await expect(statCard(page, "Total Tax")).toHaveText(inr(F.inputTax));
    await expect(statCard(page, "Total Amount")).toHaveText(inr(F.purchases));
    await expect(statCard(page, "Bills")).toHaveText(String(bills.length));
    await expect(page.getByRole("row").filter({ hasText: ids.bill42.invoiceNumber })).toContainText("Paid");

    await openReport(page, "Outstanding Report");
    await expect(statCard(page, "Total Receivable")).toHaveText(inr(toCollect));
    await expect(statCard(page, "Total Payable")).toHaveText(inr(toPay));
    const owes = (name: string) => page.getByRole("row").filter({ hasText: name }).getByRole("cell").last();
    await expect(owes(m.anand.name)).toHaveText(inr(118000 - 11800));
    await expect(owes(m.pune.name)).toHaveText(inr(14040 - 2360 - 10000));
    await expect(owes(m.tumkur.name)).toHaveText(inr(10640));
    await expect(owes(m.ramesh.name)).toHaveText(inr(2360 + 2000));
    await expect(owes(m.bhiwandi.name)).toHaveText(inr(102620 + 8260));
    await expect(page.getByRole("row").filter({ hasText: m.bengaluru.name })).toHaveCount(0);
    await expectNoHorizontalScroll(page, "outstanding");

    await openReport(page, "Item-wise Sales");
    await lastMonth(page);
    await expect(statCard(page, "Total Revenue (excl. GST)")).toHaveText(inr(F.salesTaxable));
    // (the phone hides some columns: cells are found by their header)
    const sold = async (name: string, header: string) =>
      page.getByRole("row").filter({ hasText: name }).getByRole("cell").nth(await columnOf(page, header));
    await expect(await sold(m.bracket.name, "Qty Sold")).toHaveText("110 pcs");
    await expect(await sold(m.bracket.name, "Revenue (excl. GST)")).toHaveText(inr(110000));
    await expect(await sold(m.tonic.name, "Qty Sold")).toHaveText("24 btl");
    await expect(await sold(m.tonic.name, "Revenue (excl. GST)")).toHaveText(inr(11500));
    await expect(await sold(m.rice.name, "Qty Sold")).toHaveText("40 kg");
    await expect(await sold(m.rice.name, "Revenue (excl. GST)")).toHaveText(inr(2000));
    await expect(await sold(m.install.name, "Revenue (excl. GST)")).toHaveText(inr(2000));

    await openReport(page, "Tax Summary");
    // Net of the credit notes, as GSTR-3B
    await expect(statCard(page, "Tax Collected (Output)")).toHaveText(inr(F.outputTax));
    await expect(statCard(page, "Tax Paid (Input)")).toHaveText(inr(F.inputTax));
    await expect(statCard(page, "Net Tax Liability")).toHaveText(inr(GST_MONTH.gstr3b.net.total));
    await expectNoHorizontalScroll(page, "tax summary");

    // ── GST Returns page: P&L, trial balance, balance sheet, aging, ledger ─
    await openPage(page, "GST Returns");
    const tabs = page.getByTestId("gst-report-tabs");
    await tabs.getByRole("button", { name: "Profit & Loss", exact: true }).click();
    await lastMonth(page);
    await expect(statCard(page, "Revenue")).toHaveText(inr(F.netSalesTaxable));
    await expect(statCard(page, "Cost of Goods Sold")).toHaveText(inr(cogs));
    await expect(statCard(page, "Gross Profit")).toHaveText(inr(grossProfit));
    await expect(statCard(page, "Expenses")).toHaveText(inr(F.expenses));
    await expect(statCard(page, "Net Profit")).toHaveText(inr(netProfit));
    await expect(page.getByRole("row").filter({ hasText: "Less: Closing stock" })).toContainText(inr(closingStock));
    await expectNoHorizontalScroll(page, "profit & loss");

    // The trial balance and balance sheet are for the financial year to
    // date: the month is in it unless it was March and this is April.
    const today = new Date(Date.now() + 330 * 60_000);
    const thisFy = today.getUTCMonth() >= 3 ? today.getUTCFullYear() : today.getUTCFullYear() - 1;
    if (p.fyStart === thisFy) {
      await tabs.getByRole("button", { name: "Trial Balance", exact: true }).click();
      const account = (name: string) => page.getByRole("row").filter({ hasText: name }).getByRole("cell").last();
      await expect(account("Accounts Receivable")).toHaveText(inr(toCollect));
      await expect(account("Accounts Payable")).toHaveText(inr(-toPay));
      await expect(account("Sales Returns")).toHaveText(inr(12000));
      await expect(account("Output IGST Payable")).toHaveText(inr(-GST_MONTH.gstr3b.outward.igst));
      await expect(account("Input CGST")).toHaveText(inr(GST_MONTH.gstr3b.itc.cgst));
      const totals = page.getByRole("row").filter({ hasText: /^Total/ }).last().getByRole("cell");
      await expect(totals.nth(1)).toHaveText(await totals.nth(2).innerText()); // debits = credits
      await expectNoHorizontalScroll(page, "trial balance");

      await tabs.getByRole("button", { name: "Balance Sheet", exact: true }).click();
      const assets = toCollect + closingStock + (F.received - F.paid - F.expenses) + GST_MONTH.gstr3b.itc.total;
      const liabilities = toPay + GST_MONTH.gstr3b.outward.igst + GST_MONTH.gstr3b.outward.cgst + GST_MONTH.gstr3b.outward.sgst;
      await expect(page.getByText("Total Assets", { exact: true }).locator("..")).toContainText(inr(assets));
      await expect(page.getByText("Total Liabilities", { exact: true }).locator("..")).toContainText(inr(liabilities));
      await expect(page.getByText("Total Equity", { exact: true }).locator("..")).toContainText(inr(netProfit));
      expect(round2(assets - liabilities)).toBe(netProfit);
      await expectNoHorizontalScroll(page, "balance sheet");
    }

    await tabs.getByRole("button", { name: "Aging Report", exact: true }).click();
    await expect(page.getByText("Total Outstanding", { exact: true }).locator("xpath=following-sibling::p[1]")).toHaveText(inr(toCollect));
    await expect(page.getByRole("row").filter({ hasText: m.anand.name }).getByRole("cell").last()).toHaveText(inr(106200));
    await expectNoHorizontalScroll(page, "aging");

    await tabs.getByRole("button", { name: "Party Ledger", exact: true }).click();
    await lastMonth(page);
    await pick(page, page.getByRole("combobox", { name: "Select Party" }), m.pune.name);
    // Invoice 14,040 − credit note 2,360 − receipt 10,000
    const ledger = page.getByRole("row");
    await expect(ledger.filter({ hasText: ids.b2bIntra.invoiceNumber })).toContainText(inr(14040));
    await expect(ledger.filter({ hasText: ids.cnReg.invoiceNumber })).toContainText(inr(2360));
    await expect(page.getByText(/Closing balance/i).first().locator("..")).toContainText(inr(1680));
    await expectNoHorizontalScroll(page, "party ledger");
    if (isPhone(page)) await expectTheme(page, "dark");
  });
});
