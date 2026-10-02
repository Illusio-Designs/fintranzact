/**
 * J5 — Purchase cycle, end to end, as the business owner does it in the app.
 *
 *   purchase order (100 + 10 free capsules, 40 packs of paper) → GRN from
 *   the order: 90 accepted, 10 rejected ("Damaged in transit"), 10 free,
 *   into batch AMX-2611 with an expiry → "Return rejected goods" on a
 *   purchase return for 6 of them (no stock moves) → purchase invoice from
 *   the GRN (no second stock-in) → paid from the bank (a withdrawal) →
 *   purchase return of 5 boxes from the Purchase Returns page (stock out of
 *   the batch) → debit note to the supplier for the other 4 rejected →
 *   ITC: the ITC page's GSTR-3B table 4, the GST page's GSTR-3B and the trial
 *   balance, net of what went back → the supplier's ledger and balance; and
 *   the GRN and ITC screens again in the dark theme.
 *
 * Masters (the supplier, both items, the bank account) are seeded through the
 * API: J3 owns creating them in the UI, and the Cash & Bank journey the
 * account.
 *
 * Tax split: the supplier is in Maharashtra like the business, so every
 * document's tax is CGST + SGST (pinned in the ITC ledger rows).
 *
 * External services: none. No GSTIN lookup (the supplier is seeded), no GSP
 * or bank connection — the payment is recorded against the app's own bank
 * account.
 */
import {
  test,
  expect,
  expectNoHorizontalScroll,
  expectTheme,
  isPhone,
  newJourneyContext,
  toast,
} from "../../helpers/journey";
import { seedOwner } from "../../helpers/journey-seed";
import { seedPurchaseMasters } from "../../helpers/purchase-seed";
import {
  closePanel,
  dialog,
  fillLine,
  inr,
  isoMonthsAhead,
  listRow,
  openBusiness,
  openPage,
  openReport,
  pick,
  pickDateMonthsAhead,
} from "../../helpers/journey-ui";
import {
  bankBalance,
  documentById,
  documentsMadeFrom,
  documentsOf,
  documentStockMoves,
  itcEntries,
  itemStock,
  receivedLines,
  supplierBookBalance,
  supplierPayments,
} from "../../helpers/db";
import type { Page } from "@playwright/test";

/** The value on one of the app's stat cards, by its label. */
function statCard(page: Page, label: string) {
  return page.getByText(label, { exact: true }).locator("xpath=following-sibling::p[1]");
}

test.describe("J5 purchase cycle", () => {
  test.setTimeout(420_000);

  test("PO → GRN with rejections → return rejected → bill → pay → purchase return & debit note → ITC → ledger", async ({
    context,
    page,
    browser,
    guard,
  }) => {
    const owner = await seedOwner(context, "j5");
    const m = await seedPurchaseMasters(owner);
    const supplier = m.supplier.name;

    await openBusiness(page, owner);
    await expectTheme(page, "light");

    // ── Purchase order ───────────────────────────────────────────
    await openPage(page, "Purchase Orders");
    await page.getByRole("button", { name: "+ New Purchase Order" }).first().click();
    const form = dialog(page, "New Purchase Order");
    await pick(page, form.getByRole("combobox", { name: "Supplier" }), supplier);
    await fillLine(page, form, 0, { item: m.capsules.name, qty: "100", free: "10" });
    await expect(form.getByTestId("document-line").nth(0).getByLabel("Unit price")).toHaveValue("80.00");
    await fillLine(page, form, 1, { item: m.paper.name, qty: "40" });
    await expect(form.getByTestId("document-subtotal")).toHaveText(inr(18000));
    await expect(form.getByTestId("document-tax")).toHaveText(inr(2760));
    await expect(form.getByTestId("document-total")).toHaveText(inr(20760));
    await expectNoHorizontalScroll(page, "new purchase order");
    await form.getByRole("button", { name: "Create Purchase Order" }).click();
    await expect(toast(page, "Purchase Order created")).toBeVisible();
    await expect(form).toBeHidden();
    const [po] = await documentsOf(m.supplier.id, "purchase_order");
    expect(po).toMatchObject({ type: "purchase", subtotal: "18000.00", tax_amount: "2760.00", total_amount: "20760.00", stock_mode: "none" });
    expect((await itemStock(m.capsules.id)).total).toBe(0);

    await listRow(page, po.invoice_number).click();
    let detail = dialog(page, po.invoice_number);
    await detail.getByRole("button", { name: "Mark Sent" }).click();
    await expect(toast(page, "Status updated")).toBeVisible();
    await expect.poll(async () => (await documentById(po.id))!.status).toBe("sent");

    // ── GRN: 90 accepted, 10 rejected, 10 free, into batch AMX-2611 ─
    await detail.getByRole("button", { name: "Convert", exact: true }).click();
    const convert = dialog(page, "Convert pending items");
    await expect(convert.getByRole("button", { name: "Goods Receipt Note", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(convert.getByLabel(`Accepted quantity of ${m.capsules.name}`)).toHaveValue("100");
    await expect(convert.getByLabel(`Free quantity of ${m.capsules.name}`)).toHaveValue("10");
    await convert.getByLabel(`Accepted quantity of ${m.capsules.name}`).fill("90");
    await convert.getByLabel(`Rejected quantity of ${m.capsules.name}`).fill("10");
    await expect(convert.getByText("Give a reason for each rejection.")).toBeVisible();
    await convert.getByLabel(`Reason for rejecting ${m.capsules.name}`).fill("Damaged in transit");
    await expect(convert.getByText(`Enter a batch number for ${m.capsules.name}.`)).toBeVisible();
    await convert.getByLabel(`Batch number of ${m.capsules.name}`).fill("AMX-2611");
    await pickDateMonthsAhead(page, convert.getByLabel(`Expiry of ${m.capsules.name}'s batch`), 14);
    const expiry = isoMonthsAhead(14);
    await expectNoHorizontalScroll(page, "receive purchase order");
    await convert.getByRole("button", { name: "Create Goods Receipt Note" }).click();
    await expect(toast(page, /^Goods Receipt Note GRN-\d+ created$/)).toBeVisible();
    await expect(convert).toBeHidden();

    const [grn] = await documentsOf(m.supplier.id, "goods_receipt_note");
    expect(grn).toMatchObject({ reference_document_id: po.id, subtotal: "17200.00", tax_amount: "2664.00", total_amount: "19864.00", stock_mode: "tracked" });
    expect(await receivedLines(grn.id)).toMatchObject([
      { item_id: m.capsules.id, quantity: "90.000", free_quantity: "10.000", rejected_quantity: "10.000", rejection_reason: "Damaged in transit", batch_number: "AMX-2611", expiry_date: expiry, total_amount: "8064.00" },
      { item_id: m.paper.id, quantity: "40.000", free_quantity: "0.000", batch_number: null, total_amount: "11800.00" },
    ]);
    // Accepted and free goods come in; the rejected ones don't.
    expect(await documentStockMoves(grn.id)).toEqual(
      expect.arrayContaining([
        { itemId: m.capsules.id, batch: "AMX-2611", qty: 100 },
        { itemId: m.paper.id, batch: "(unbatched)", qty: 40 },
      ]),
    );
    expect(await itemStock(m.capsules.id)).toEqual({ total: 100, byBatch: { "AMX-2611": 100 } });
    expect((await itemStock(m.paper.id)).total).toBe(40);

    // The order: rejected goods are still to come.
    await expect(detail.getByText("Partly received").first()).toBeVisible();
    await expect(detail.getByText("10 rejected").first()).toBeVisible();
    await expect(detail.getByText(grn.invoice_number)).toBeVisible();
    await closePanel(detail);
    await expect(listRow(page, po.invoice_number)).toContainText("Partly received");

    // ── Return rejected goods: 6 of the 10 go back, no stock moves ─
    await openPage(page, "Goods Receipts (GRN)", "Goods Receipt Notes");
    let row = listRow(page, grn.invoice_number);
    await expect(row).toContainText(inr(19864));
    await expect(row).toContainText("Not billed");
    await row.click();
    detail = dialog(page, grn.invoice_number);
    const rejectedBox = detail.getByTestId("grn-rejections");
    await expect(rejectedBox).toContainText(`${m.capsules.name}: 10 (Damaged in transit)`);
    await expect(detail.getByText("10 rejected (Damaged in transit)")).toBeVisible();
    await expectNoHorizontalScroll(page, "GRN detail");
    await rejectedBox.getByRole("button", { name: "Return rejected goods" }).click();
    let back = dialog(page, "Return rejected goods");
    await expect(back.getByRole("button", { name: "Purchase Return", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(back.getByText("Stock doesn't change: rejected goods never came in.")).toBeVisible();
    await expect(back.getByLabel(`Quantity of ${m.capsules.name} to return`)).toHaveValue("10");
    await back.getByLabel(`Quantity of ${m.capsules.name} to return`).fill("11");
    await expect(back.getByText("A quantity is more than what is left to return.")).toBeVisible();
    await expect(back.getByRole("button", { name: "Create Purchase Return" })).toBeDisabled();
    await back.getByLabel(`Quantity of ${m.capsules.name} to return`).fill("6");
    await expectNoHorizontalScroll(page, "return rejected goods");
    await back.getByRole("button", { name: "Create Purchase Return" }).click();
    await expect(toast(page, /^Purchase Return \S+ created$/)).toBeVisible();
    await expect(back).toBeHidden();
    const [rejectedReturn] = (await documentsMadeFrom(grn.id)).filter((d) => d.document_type === "purchase_return");
    expect(rejectedReturn).toMatchObject({ type: "purchase", subtotal: "480.00", tax_amount: "57.60", total_amount: "537.60", stock_mode: "none" });
    expect(await receivedLines(rejectedReturn.id)).toMatchObject([{ item_id: m.capsules.id, quantity: "6.000", total_amount: "537.60" }]);
    expect(await documentStockMoves(rejectedReturn.id)).toEqual([]);
    expect(await itemStock(m.capsules.id)).toEqual({ total: 100, byBatch: { "AMX-2611": 100 } });
    await expect(rejectedBox).toContainText("6 returned");

    // ── Purchase invoice from the GRN: billed, no second stock-in ──
    await detail.getByRole("button", { name: "Convert", exact: true }).click();
    const billIt = dialog(page, "Convert pending items");
    await expect(billIt.getByLabel(`Quantity of ${m.capsules.name}`, { exact: true })).toHaveValue("90");
    await expect(billIt.getByLabel(`Free quantity of ${m.capsules.name}`)).toHaveValue("10");
    await expect(billIt.getByLabel(`Quantity of ${m.paper.name}`, { exact: true })).toHaveValue("40");
    await billIt.getByRole("button", { name: "Create Purchase Invoice" }).click();
    await expect(toast(page, /^Invoice \S+ created$/)).toBeVisible();
    await expect(billIt).toBeHidden();
    const [bill] = await documentsOf(m.supplier.id, "invoice");
    expect(bill).toMatchObject({
      type: "purchase",
      reference_document_id: grn.id,
      subtotal: "17200.00",
      tax_amount: "2664.00",
      total_amount: "19864.00",
      amount_paid: "0.00",
      stock_mode: "none",
    });
    expect(await receivedLines(bill.id)).toMatchObject([
      { item_id: m.capsules.id, quantity: "90.000", free_quantity: "10.000", batch_number: "AMX-2611", total_amount: "8064.00" },
      { item_id: m.paper.id, quantity: "40.000", total_amount: "11800.00" },
    ]);
    expect(await documentStockMoves(bill.id)).toEqual([]);
    expect((await itemStock(m.capsules.id)).total).toBe(100);
    expect((await itemStock(m.paper.id)).total).toBe(40);
    // A supplier in Maharashtra: the bill's ₹2,664 tax is CGST + SGST.
    expect(await itcEntries([bill.id])).toMatchObject([{ status: "available", cgst: "1332.00", sgst: "1332.00", igst: "0.00" }]);
    await expect(detail.getByText(bill.invoice_number)).toBeVisible();
    await closePanel(detail);
    await expect(listRow(page, grn.invoice_number)).toContainText("Billed");
    expect(await supplierBookBalance(m.supplier.id)).toBeCloseTo(19864 - 537.6, 2);

    // ── Pay the supplier from the bank ───────────────────────────
    await openPage(page, "Invoices");
    await page.getByRole("button", { name: "Purchases", exact: true }).click();
    row = listRow(page, bill.invoice_number);
    await expect(row).toContainText(inr(19864));
    await row.click();
    detail = dialog(page, `Invoice ${bill.invoice_number}`);
    await expect(detail.getByText("+ 10 free")).toBeVisible();
    await expectNoHorizontalScroll(page, "purchase invoice detail");
    await detail.getByRole("button", { name: "Mark Sent" }).click();
    await expect(toast(page, "Invoice status updated")).toBeVisible();
    await detail.getByRole("button", { name: "Record Payment" }).click();
    const pay = dialog(page, "Record Payment");
    await expect(pay.getByLabel("Payment Amount (₹)")).toHaveValue("19864.00");
    await expect(pay.getByText("Pay from")).toBeVisible();
    await pay.getByRole("button", { name: new RegExp(m.bank.name) }).click();
    await expect(pay.getByRole("button", { name: new RegExp(m.bank.name) })).toHaveAttribute("aria-pressed", "true");
    await pay.getByLabel("Reference #").fill("NEFT-J5-0001");
    await expectNoHorizontalScroll(page, "pay supplier");
    await pay.getByRole("button", { name: `Record ${inr(19864)}` }).click();
    await expect(toast(page, "Payment recorded")).toBeVisible();
    await expect.poll(async () => (await documentById(bill.id))!.status).toBe("paid");
    expect(await documentById(bill.id)).toMatchObject({ amount_paid: "19864.00" });
    expect(await supplierPayments(m.supplier.id)).toMatchObject([
      {
        amount: "19864.00",
        mode: "bank",
        bank_account_id: m.bank.id,
        allocations: [{ invoiceId: bill.id, amount: 19864 }],
        bank: [{ type: "withdrawal", amount: 19864, accountId: m.bank.id }],
      },
    ]);
    expect(await bankBalance(m.bank.id)).toBe(100000 - 19864);
    await expect(listRow(page, bill.invoice_number)).toContainText("Paid");

    // ── Purchase return from the Purchase Returns page: 5 boxes out ─
    await openPage(page, "Purchase Returns");
    await page.getByRole("button", { name: "+ New Purchase Return" }).first().click();
    const ret = dialog(page, "New Purchase Return");
    await pick(page, ret.getByRole("combobox", { name: "Supplier" }), supplier);
    // The bill is cached from its panel (and stale since the payment), so
    // its lines fill in at once while it is fetched again behind. Hold that
    // refetch until the lines are edited: its late answer used to put the
    // removed line and the quantities back.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(/\/api\/trpc\/[^?]*invoice\.getById/, async (route) => {
      await held;
      await route.continue();
    });
    const refetched = page.waitForResponse(/\/api\/trpc\/[^?]*invoice\.getById/);
    await pick(page, ret.getByRole("combobox", { name: /Against purchase invoice/ }), bill.invoice_number);
    const lines = ret.getByTestId("document-line");
    await expect(lines).toHaveCount(2);
    await lines.nth(1).getByRole("button", { name: "Remove line" }).click();
    await expect(lines).toHaveCount(1);
    await lines.nth(0).getByLabel("Quantity", { exact: true }).fill("5");
    if (await lines.nth(0).getByLabel("Free quantity").count()) await lines.nth(0).getByLabel("Free quantity").fill("0");
    release();
    await refetched;
    await page.unroute(/\/api\/trpc\/[^?]*invoice\.getById/);
    await expect(lines).toHaveCount(1);
    await expect(lines.nth(0).getByLabel("Quantity", { exact: true })).toHaveValue("5");
    await expect(lines.nth(0).getByRole("combobox", { name: "Batch" })).toContainText("AMX-2611");
    await expect(ret.getByTestId("document-total")).toHaveText(inr(448));
    await expectNoHorizontalScroll(page, "new purchase return");
    await ret.getByRole("button", { name: "Create Purchase Return" }).click();
    await expect(toast(page, "Purchase Return created")).toBeVisible();
    await expect(ret).toBeHidden();
    const goodsBack = (await documentsOf(m.supplier.id, "purchase_return")).find((d) => d.id !== rejectedReturn.id)!;
    expect(goodsBack).toMatchObject({ reference_document_id: bill.id, subtotal: "400.00", tax_amount: "48.00", total_amount: "448.00", stock_mode: "tracked" });
    expect(await documentStockMoves(goodsBack.id)).toEqual([{ itemId: m.capsules.id, batch: "AMX-2611", qty: -5 }]);
    expect(await itemStock(m.capsules.id)).toEqual({ total: 95, byBatch: { "AMX-2611": 95 } });
    row = listRow(page, goodsBack.invoice_number);
    await expect(row).toContainText(inr(448));
    await row.click();
    detail = dialog(page, goodsBack.invoice_number);
    await detail.getByRole("button", { name: "Mark Sent" }).click();
    await expect(toast(page, "Status updated")).toBeVisible();
    await closePanel(detail);

    // ── Debit note to the supplier for the other 4 rejected boxes ──
    await openPage(page, "Goods Receipts (GRN)", "Goods Receipt Notes");
    await listRow(page, grn.invoice_number).click();
    detail = dialog(page, grn.invoice_number);
    await detail.getByTestId("grn-rejections").getByRole("button", { name: "Return rejected goods" }).click();
    back = dialog(page, "Return rejected goods");
    await back.getByRole("button", { name: "Debit Note", exact: true }).click();
    await expect(back.getByText("Claims the value back when the supplier has billed the rejected goods.")).toBeVisible();
    await expect(back.getByLabel(`Quantity of ${m.capsules.name} to return`)).toHaveValue("4");
    await back.getByRole("button", { name: "Create Debit Note" }).click();
    await expect(toast(page, /^Debit Note \S+ created$/)).toBeVisible();
    const [debitNote] = (await documentsMadeFrom(grn.id)).filter((d) => d.document_type === "debit_note");
    expect(debitNote).toMatchObject({ type: "purchase", subtotal: "320.00", tax_amount: "38.40", total_amount: "358.40", stock_mode: "none" });
    expect(await documentStockMoves(debitNote.id)).toEqual([]);
    expect((await itemStock(m.capsules.id)).total).toBe(95);
    // Every rejected box is accounted for: nothing left to send back.
    await expect(detail.getByTestId("grn-rejections")).toContainText("10 returned");
    await expect(detail.getByTestId("grn-rejections").getByRole("button", { name: "Return rejected goods" })).toBeHidden();
    await closePanel(detail);

    // What the supplier owes back: the goods returned (537.60 + 448) and
    // the debit note (358.40); the bill itself is paid.
    expect(await supplierBookBalance(m.supplier.id)).toBeCloseTo(-1344, 2);

    // ── ITC: GSTR-3B table 4 nets off what went back ──────────────
    // CGST = SGST = 1332 − (28.80 + 24 + 19.20) = 1260.
    expect(await itcEntries([bill.id, rejectedReturn.id, goodsBack.id, debitNote.id])).toMatchObject([
      { invoice_id: rejectedReturn.id, cgst: "-28.80", sgst: "-28.80" },
      { invoice_id: bill.id, cgst: "1332.00", sgst: "1332.00" },
      { invoice_id: goodsBack.id, cgst: "-24.00", sgst: "-24.00" },
      { invoice_id: debitNote.id, cgst: "-19.20", sgst: "-19.20" },
    ]);
    await openPage(page, "Input Tax Credit");
    await page.getByRole("button", { name: "GSTR-3B Table 4" }).click();
    const allOther = page.getByRole("row").filter({ hasText: "(5) All other ITC" });
    await expect(allOther.getByRole("cell")).toHaveText(["(5) All other ITC", inr(0), inr(1260), inr(1260), inr(0)]);
    const net = page.getByRole("row").filter({ hasText: "4(C) Net ITC Available" });
    await expect(net.getByRole("cell")).toHaveText([/4\(C\)/, inr(0), inr(1260), inr(1260), inr(0)]);
    await expectNoHorizontalScroll(page, "ITC table 4");

    await openPage(page, "GST Returns");
    await page.getByTestId("gst-report-tabs").getByRole("button", { name: "GSTR-3B" }).click();
    await expect(statCard(page, "ITC — CGST")).toHaveText(inr(1260));
    await expect(statCard(page, "ITC — SGST")).toHaveText(inr(1260));
    await expect(statCard(page, "ITC — IGST")).toHaveText(inr(0));
    await expect(statCard(page, "Total ITC available")).toHaveText(inr(2520));
    await expectNoHorizontalScroll(page, "GSTR-3B");

    // The books (the journal derived from these documents): purchases at
    // their taxable value, input GST net of what went back, the returns and
    // debit note in Purchase Returns, and the supplier's account settled
    // past zero by the payment and the returns.
    await openReport(page, "Trial Balance");
    const account = async (code: string, debit: number, credit: number) => {
      const cells = page.getByRole("row").filter({ has: page.getByRole("cell", { name: code, exact: true }) }).getByRole("cell");
      await expect(cells.nth(3)).toHaveText(debit ? inr(debit) : "—");
      await expect(cells.nth(4)).toHaveText(credit ? inr(credit) : "—");
    };
    await account("5000", 17200, 0); // Purchases
    await account("5010", 0, 1200); // Purchase Returns: 480 + 400 + 320
    await account("1510", 1332, 72); // Input CGST: 28.80 + 24 + 19.20 back
    await account("1511", 1332, 72); // Input SGST
    await account("2000", 21208, 19864); // Payable: paid 19,864 + returned 1,344 vs billed 19,864
    await expectNoHorizontalScroll(page, "trial balance");

    // ── The supplier's ledger ─────────────────────────────────────
    await openPage(page, "Parties");
    await page.getByRole("searchbox", { name: "Search by name…" }).fill(supplier);
    row = page.getByRole("row").filter({ hasText: supplier });
    await expect(row).toHaveCount(1);
    await row.click();
    const partyPanel = dialog(page, supplier);
    await partyPanel.getByRole("button", { name: "Ledger", exact: true }).click();
    await expectNoHorizontalScroll(page, "supplier ledger");
    // Debit / credit by what each entry does to what we owe: the bill is a
    // credit; the payment, both returns and the debit note are debits.
    const ledger = partyPanel.getByRole("row");
    const entry = async (number: string, debit: string, credit: string) => {
      const cells = ledger.filter({ hasText: number }).getByRole("cell");
      await expect(cells.nth(3)).toHaveText(debit);
      await expect(cells.nth(4)).toHaveText(credit);
    };
    await entry(bill.invoice_number, "—", inr(19864));
    await entry("PAY-", inr(19864), "—");
    await entry(rejectedReturn.invoice_number, inr(537.6), "—");
    await entry(goodsBack.invoice_number, inr(448), "—");
    await entry(debitNote.invoice_number, inr(358.4), "—");
    // The supplier owes us ₹1,344 (a debit balance).
    await expect(ledger.last().getByRole("cell").last()).toHaveText(inr(1344));
    // The parties list shows what we owe them: −₹1,344.
    await closePanel(partyPanel);
    await expect(row.getByRole("cell").filter({ hasText: "₹" })).toHaveText(inr(-1344));

    // ── After 7 pm India time: the same books in the dark theme ───
    const evening = await newJourneyContext(browser, guard, {
      theme: "dark",
      storageState: await context.storageState(),
      viewport: page.viewportSize() ?? undefined,
      hasTouch: isPhone(page),
    });
    const night = await evening.newPage();
    await openBusiness(night, owner);
    await expectTheme(night, "dark");
    await openPage(night, "Goods Receipts (GRN)", "Goods Receipt Notes");
    await listRow(night, grn.invoice_number).click();
    const grnPanel = dialog(night, grn.invoice_number);
    await expect(grnPanel.getByTestId("grn-rejections")).toContainText("10 returned");
    await expect(grnPanel.getByText(bill.invoice_number)).toBeVisible();
    await expectNoHorizontalScroll(night, "GRN detail (dark)");
    await closePanel(grnPanel);
    await openPage(night, "Input Tax Credit");
    await night.getByRole("button", { name: "Dashboard", exact: true }).click();
    const available = night.getByText("Available ITC", { exact: true }).locator("..");
    await expect(available).toContainText(inr(2520));
    await expect(available).toContainText(`CGST: ${inr(1260)}`);
    await night.getByRole("button", { name: "Ledger", exact: true }).click();
    // Each return and the debit note takes its tax back in the ledger.
    await expect(listRow(night, goodsBack.invoice_number)).toContainText(inr(-24));
    await expect(listRow(night, debitNote.invoice_number)).toContainText(inr(-19.2));
    await expect(listRow(night, bill.invoice_number)).toContainText(inr(1332));
    await expectNoHorizontalScroll(night, "ITC ledger (dark)");
    await evening.close();
  });
});
