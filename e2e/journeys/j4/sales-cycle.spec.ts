/**
 * J4 — Sales cycle, end to end, as the business owner does it in the app.
 *
 *   quotation → sales order → delivery challan (stock out, batches first-
 *   expiry-first-out) → invoice from the challan (no second stock movement)
 *   → e-way bill (the business's threshold is respected) → part payment →
 *   full payment (partial → paid) → PDF download and a share link opened
 *   signed out — with a document discount, round-off, a shipping charge, a
 *   free-quantity line, a batch-tracked item and the business's own delivery
 *   method; a walk-in sale.
 *
 *   Returns, other state: an IGST invoice → part payment → credit note for
 *   part of it → sales return (stock back) → status and balance recompute →
 *   the return cancelled (stock out again) → recompute again.
 *
 * Masters (customers, items, batches, the POS walk-in customer) are seeded
 * through the API; J3 owns creating them in the UI.
 *
 * GST valuation of the quotation → invoice chain (CGST Act s.15): the lines
 * are 10 × ₹1,000 at 18% and 8 (+2 free) × ₹512.50 at 12% = ₹14,100. The
 * ₹1,000.40 document discount reduces the taxable value, spread over the
 * lines pro rata and paise-exact (₹709.50 / ₹290.90 — or, once the challan
 * splits the syrup by batch, ₹709.50 / ₹181.81 / ₹109.09), and each line is
 * taxed on what is left: 18% of ₹9,290.50 = ₹1,672.29; 12% of ₹3,809.10 =
 * ₹457.09 (by batch: 12% of ₹2,380.69 = ₹285.68 and of ₹1,428.41 = ₹171.41).
 * The ₹500 shipping is part of the value of supply and is taxed at the
 * highest line rate, 18% = ₹90. Taxable value ₹14,100 − ₹1,000.40 + ₹500 =
 * ₹13,599.60; tax ₹1,672.29 + ₹457.09 + ₹90 = ₹2,219.38; ₹15,818.98 before
 * round-off. Intra-state, CGST = SGST = ₹1,109.69.
 *
 * Tax split: GSTR-1's B2B table shows CGST + SGST for the Maharashtra buyer
 * and IGST for the Karnataka one (the split is worked out from the business's
 * and the party's state codes, which the DB assertions pin down).
 *
 * External services: nothing leaves the test environment. The API runs with
 * no NIC GSP credentials (IRP_CLIENT_*, NIC_EWB_CLIENT_*) and e-invoicing is
 * not switched on, so no IRP or e-way bill portal is ever called: the e-way
 * bill request is refused by the app's own threshold check, which runs
 * before any portal call and is what is exercised here (₹20,000 set by the
 * business, the statutory ₹50,000 by default). Generating an IRN or an EWB
 * against a stand-in portal is not covered.
 */
import type { Download, Locator, Page } from "@playwright/test";
import {
  test,
  expect,
  expectNoHorizontalScroll,
  expectTheme,
  navTo,
  newJourneyContext,
  toast,
} from "../../helpers/journey";
import { seedOwner, type SeededOwner } from "../../helpers/journey-seed";
import { seedSalesMasters, type SalesMasters } from "../../helpers/sales-seed";
import {
  businessRow,
  customerBookBalance,
  documentById,
  documentLines,
  documentsOf,
  documentStockMoves,
  ewayBillConfig,
  ewayBillsFor,
  itemStock,
  paymentsOf,
} from "../../helpers/db";

// ── Helpers ─────────────────────────────────────────────────────

/** ₹ amount the way the app prints it (en-IN grouping, two decimals). */
function inr(n: number) {
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function openBusiness(page: Page, owner: SeededOwner) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Choose a company" })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: `Open ${owner.businessName}` }).click();
  await expect(page.getByTestId("app-sidebar")).toBeAttached({ timeout: 20_000 });
}

async function openPage(page: Page, label: string, heading: string = label) {
  await navTo(page, label);
  await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
  await expectNoHorizontalScroll(page, label);
}

/** Pick `text` in a searchable combobox (party, item, invoice pickers). */
async function pick(page: Page, combobox: Locator, search: string, option: RegExp = startsWith(search)) {
  await combobox.click();
  await combobox.fill(search);
  // Not the "Create …" entry the picker offers for new names.
  await page.getByRole("option", { name: option }).first().click();
  await expect(combobox).toHaveValue(search);
}

function startsWith(text: string) {
  return new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
}

/** Choose `label` in one of the app's dropdowns (a combobox with a listbox). */
async function choose(page: Page, combobox: Locator, label: string) {
  await combobox.click();
  await page.getByRole("option", { name: label, exact: true }).click();
  await expect(combobox).toContainText(label);
}

/** The document form (New Quotation, New Invoice …). */
function documentForm(page: Page, title: string | RegExp) {
  return page.getByRole("dialog", { name: title });
}

type LineInput = { item: string; qty: string; free?: string; price?: string };

async function fillLine(page: Page, form: Locator, index: number, line: LineInput) {
  const lines = form.getByTestId("document-line");
  if ((await lines.count()) <= index) await form.getByRole("button", { name: "+ Add line item" }).click();
  const row = lines.nth(index);
  await pick(page, row.getByPlaceholder("Select product or custom item"), line.item);
  await row.getByLabel("Quantity", { exact: true }).fill(line.qty);
  if (line.free) await row.getByLabel("Free quantity").fill(line.free);
  if (line.price) await row.getByLabel("Unit price").fill(line.price);
}

/** A row of a list page's table, by the text it shows. */
function listRow(page: Page, text: string) {
  return page.getByRole("row").filter({ hasText: text });
}

/** The document detail panel (SlideOver) titled with its number. */
function panel(page: Page, title: string | RegExp) {
  return page.getByRole("dialog", { name: title });
}

/** The customer's balance as the Parties list shows it. */
async function expectPartyBalance(page: Page, name: string, amount: number) {
  await openPage(page, "Parties");
  await page.getByRole("searchbox", { name: "Search by name…" }).fill(name);
  const row = page.getByRole("row").filter({ hasText: name });
  await expect(row).toHaveCount(1);
  const headers = await page.getByRole("columnheader").allInnerTexts();
  const column = headers.findIndex((h) => h.trim().startsWith("Balance"));
  expect(column, "the parties table has a Balance column").toBeGreaterThan(-1);
  await expect(row.getByRole("cell").nth(column)).toHaveText(amount === 0 ? /^(—|₹0\.00)$/ : inr(amount));
}

async function saveDownload(download: Download) {
  const path = await download.path();
  const { readFileSync } = await import("node:fs");
  return readFileSync(path!);
}

// ── Journey ─────────────────────────────────────────────────────

test.describe("J4 sales cycle", () => {
  test.setTimeout(420_000);

  test("quotation → order → challan → invoice → e-way bill → payments → PDF & share link; walk-in sale", async ({
    context,
    page,
    browser,
    guard,
  }) => {
    const owner = await seedOwner(context, "j4");
    const m: SalesMasters = await seedSalesMasters(owner);
    const customer = m.localCustomer.name;

    await openBusiness(page, owner);
    await expectTheme(page, "light");

    // ── Settings: the business's own delivery method ──────────────
    await navTo(page, "Settings");
    await page.getByRole("button", { name: "Shipping" }).click();
    await page.getByPlaceholder("e.g. Dunzo, Porter, Local Tempo").fill("Porter Tempo");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByRole("button", { name: "Save Shipping Settings" }).click();
    await expect(toast(page, /saved|updated/i)).toBeVisible();
    await expectNoHorizontalScroll(page, "settings / shipping");
    await expect.poll(async () => (await businessRow(owner.businessId)).custom_shipping_methods).toEqual([
      { id: "porter_tempo", label: "Porter Tempo", hasTracking: false },
    ]);

    // ── Settings: e-way bills on, with the business's own threshold ─
    // (The statutory default is ₹50,000; this business uses ₹20,000.)
    await page.getByRole("button", { name: "Business", exact: true }).click();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByRole("switch", { name: /Enable E-Way Bill/ }).check();
    await page.getByLabel("Portal ID").last().fill("j4-ewb-user");
    await page.getByLabel("Portal Password").last().fill("j4-ewb-pass");
    await page.getByLabel("E-Way Bill Threshold (₹)").fill("20000");
    await expectNoHorizontalScroll(page, "settings / business edit");
    await page.getByRole("button", { name: "Save Changes" }).click();
    await expect(toast(page, /updated|saved/i)).toBeVisible();
    await expect
      .poll(async () => {
        const b = await businessRow(owner.businessId);
        return [b.e_way_bill_enabled, b.e_way_bill_threshold];
      })
      .toEqual([true, "20000.00"]);
    await expect
      .poll(() => ewayBillConfig(owner.businessId))
      .toMatchObject({ gstin: "27AAPFU0939F1ZV", is_enabled: true, is_sandbox: true });

    // ── Quotation ────────────────────────────────────────────────
    await openPage(page, "Quotations");
    await page.getByRole("button", { name: "+ New Quotation" }).first().click();
    const form = documentForm(page, "New Quotation");
    await pick(page, form.getByRole("combobox", { name: "Customer" }), customer);
    await choose(page, form.getByRole("combobox", { name: "Delivery method" }), "Porter Tempo");
    await fillLine(page, form, 0, { item: m.bracket.name, qty: "10" });
    await expect(form.getByTestId("document-line").nth(0)).toContainText(inr(11800));
    await fillLine(page, form, 1, { item: m.syrup.name, qty: "8", free: "2" });
    // Free goods carry no price or tax.
    await expect(form.getByTestId("document-line").nth(1)).toContainText(inr(4592));
    await form.getByLabel("Document discount").fill("1000.40");
    await form.getByRole("button", { name: "Shipping" }).click();
    await form.getByLabel("Shipping amount").fill("500");
    await expect(form.getByTestId("document-subtotal")).toHaveText(inr(14100));
    // Tax after the discount, plus 18% on the shipping (see the header).
    await expect(form.getByTestId("document-tax")).toHaveText(inr(2219.38));
    // The business rounds totals down by default (₹15,818.98 → ₹15,818.00);
    // this quotation rounds up instead.
    await expect(form.getByLabel("Round off")).toHaveValue("-0.98");
    await expect(form.getByTestId("document-total")).toHaveText(inr(15818));
    await form.getByLabel("Round off").fill("0.02");
    await expect(form.getByTestId("document-total")).toHaveText(inr(15819));
    await form.getByLabel("Notes", { exact: true }).fill("Deliver to the back gate");
    await expectNoHorizontalScroll(page, "new quotation");
    await form.getByRole("button", { name: "Create Quotation" }).click();
    await expect(toast(page, "Quotation created")).toBeVisible();
    await expect(form).toBeHidden();

    const [quotation] = await documentsOf(m.localCustomer.id, "quotation");
    expect(quotation).toMatchObject({
      status: "draft",
      subtotal: "14100.00",
      tax_amount: "2219.38",
      discount_amount: "1000.40",
      additional_charges: "500.00",
      charges: [{ label: "Shipping", amount: "500.00" }],
      round_off: "0.02",
      total_amount: "15819.00",
      delivery_method: "porter_tempo",
      stock_mode: "none",
    });
    // Each line carries its share of the discount: tax on what is left.
    expect(await documentLines(quotation.id)).toMatchObject([
      { item_id: m.bracket.id, quantity: "10.000", free_quantity: "0.000", unit_price: "1000.00", tax_amount: "1672.29", total_amount: "10962.79" },
      { item_id: m.syrup.id, quantity: "8.000", free_quantity: "2.000", unit_price: "512.50", tax_amount: "457.09", total_amount: "4266.19", batch_number: null },
    ]);
    // A quotation moves no stock and owes nothing.
    expect((await itemStock(m.bracket.id)).total).toBe(100);
    expect(await customerBookBalance(m.localCustomer.id)).toBe(0);

    let row = listRow(page, quotation.invoice_number);
    await expect(row).toContainText(customer);
    await expect(row).toContainText(inr(15819));
    await row.click();
    let detail = panel(page, quotation.invoice_number);
    await expect(detail.getByText("+ 2 free")).toBeVisible();
    await expectNoHorizontalScroll(page, "quotation detail");
    await detail.getByRole("button", { name: "Mark Sent" }).click();
    await expect(toast(page, "Status updated")).toBeVisible();
    await expect.poll(async () => (await documentById(quotation.id))!.status).toBe("sent");
    // The panel adds up: round-off shows with the rest.
    await expect(detail.getByText("Round Off")).toBeVisible();
    await expect(detail.getByText(inr(15819))).toBeVisible();

    // ── Quotation → sales order ─────────────────────────────────
    await detail.getByRole("button", { name: "Convert to Sales Order" }).click();
    await expect(toast(page, /^Sales Order SO-\d+ created$/)).toBeVisible();
    await expect(page).toHaveURL(/\/sales-orders\?id=/);
    const [order] = await documentsOf(m.localCustomer.id, "sales_order");
    expect(order).toMatchObject({
      reference_document_id: quotation.id,
      subtotal: "14100.00",
      discount_amount: "1000.40",
      charges: [{ label: "Shipping", amount: "500.00" }],
      round_off: "0.02",
      total_amount: "15819.00",
      delivery_method: "porter_tempo",
      stock_mode: "none",
    });
    expect(await documentLines(order.id)).toMatchObject([
      { item_id: m.bracket.id, quantity: "10.000", free_quantity: "0.000" },
      { item_id: m.syrup.id, quantity: "8.000", free_quantity: "2.000" },
    ]);
    detail = panel(page, order.invoice_number);
    await expect(detail.getByText(`Made from Quotation`)).toBeVisible();
    await expect(detail.getByRole("button", { name: quotation.invoice_number })).toBeVisible();
    await expectNoHorizontalScroll(page, "sales order detail");

    // ── Sales order → delivery challan: the goods go out ─────────
    await detail.getByRole("button", { name: "Convert", exact: true }).click();
    let convertDialog = page.getByRole("dialog", { name: "Convert pending items" });
    await expect(convertDialog.getByLabel(`Quantity of ${m.bracket.name}`, { exact: true })).toHaveValue("10");
    await expect(convertDialog.getByLabel(`Quantity of ${m.syrup.name}`, { exact: true })).toHaveValue("8");
    await expect(convertDialog.getByLabel(`Free quantity of ${m.syrup.name}`)).toHaveValue("2");
    await expectNoHorizontalScroll(page, "convert order");
    await convertDialog.getByRole("button", { name: "Create Delivery Challan" }).click();
    await expect(toast(page, /^Delivery Challan DC-\d+ created$/)).toBeVisible();
    await expect(convertDialog).toBeHidden();

    const [challan] = await documentsOf(m.localCustomer.id, "delivery_challan");
    // Split by batch, the discount is re-spread over three lines; the tax
    // still adds up to ₹2,219.38.
    expect(challan).toMatchObject({ reference_document_id: order.id, tax_amount: "2219.38", round_off: "0.02", total_amount: "15819.00", stock_mode: "tracked", delivery_method: "porter_tempo" });
    // First expiry first out: all 5 of batch SOON, then 5 of LATE (billed
    // goods first, the free ones after).
    expect(await documentLines(challan.id)).toMatchObject([
      { item_id: m.bracket.id, quantity: "10.000", free_quantity: "0.000", batch_number: null, tax_amount: "1672.29", total_amount: "10962.79" },
      { item_id: m.syrup.id, quantity: "5.000", free_quantity: "0.000", batch_number: "SOON", tax_amount: "285.68", total_amount: "2666.37" },
      { item_id: m.syrup.id, quantity: "3.000", free_quantity: "2.000", batch_number: "LATE", tax_amount: "171.41", total_amount: "1599.82" },
    ]);
    expect(await documentStockMoves(challan.id)).toEqual(
      expect.arrayContaining([
        { itemId: m.bracket.id, batch: "(unbatched)", qty: -10 },
        { itemId: m.syrup.id, batch: "SOON", qty: -5 },
        { itemId: m.syrup.id, batch: "LATE", qty: -5 },
      ]),
    );
    expect(await itemStock(m.bracket.id)).toMatchObject({ total: 90 });
    expect(await itemStock(m.syrup.id)).toEqual({ total: 15, byBatch: { LATE: 15, SOON: 0 } });
    // A challan is not a bill: nothing is owed yet.
    expect(await customerBookBalance(m.localCustomer.id)).toBe(0);

    // The order shows it delivered.
    await page.reload();
    detail = panel(page, order.invoice_number);
    await expect(detail.getByText(challan.invoice_number)).toBeVisible();
    await expect(detail.getByText("Fulfilled").first()).toBeVisible();
    await detail.getByRole("button", { name: "Close" }).click();

    // ── Delivery challan → invoice: billed, no second stock movement ─
    await openPage(page, "Delivery Challans");
    row = listRow(page, challan.invoice_number);
    await expect(row).toContainText("Not billed");
    await row.click();
    detail = panel(page, challan.invoice_number);
    await expect(detail.getByText("SOON")).toBeHidden(); // batches are on the lines, not the panel
    await detail.getByRole("button", { name: "Convert", exact: true }).click();
    convertDialog = page.getByRole("dialog", { name: "Convert pending items" });
    await convertDialog.getByRole("button", { name: "Create Invoice" }).click();
    await expect(toast(page, /^Invoice INV-\d+ created$/)).toBeVisible();
    await expect(convertDialog).toBeHidden();

    const [invoice] = await documentsOf(m.localCustomer.id, "invoice");
    expect(invoice).toMatchObject({
      reference_document_id: challan.id,
      subtotal: "14100.00",
      tax_amount: "2219.38",
      discount_amount: "1000.40",
      additional_charges: "500.00",
      round_off: "0.02",
      total_amount: "15819.00",
      amount_paid: "0.00",
      delivery_method: "porter_tempo",
      // The challan already moved the goods.
      stock_mode: "none",
    });
    expect(await documentLines(invoice.id)).toMatchObject([
      { item_id: m.bracket.id, quantity: "10.000", batch_number: null },
      { item_id: m.syrup.id, quantity: "5.000", free_quantity: "0.000", batch_number: "SOON" },
      { item_id: m.syrup.id, quantity: "3.000", free_quantity: "2.000", batch_number: "LATE" },
    ]);
    expect(await documentStockMoves(invoice.id)).toEqual([]);
    expect((await itemStock(m.bracket.id)).total).toBe(90);
    expect((await itemStock(m.syrup.id)).total).toBe(15);
    await page.reload();
    await expect(listRow(page, challan.invoice_number)).toContainText("Billed");

    // ── The invoice: issue it ────────────────────────────────────
    await openPage(page, "Invoices");
    row = listRow(page, invoice.invoice_number);
    await expect(row).toContainText(inr(15819));
    await row.click();
    detail = panel(page, `Invoice ${invoice.invoice_number}`);
    await expect(detail.getByText("Porter Tempo").first()).toBeVisible();
    await expect(detail.getByText("+ 2 free")).toBeVisible();
    await expect(detail.getByText("Round Off")).toBeVisible();
    await expectNoHorizontalScroll(page, "invoice detail");
    await detail.getByRole("button", { name: "Mark Sent" }).click();
    await expect(toast(page, "Invoice status updated")).toBeVisible();
    await expect.poll(async () => (await documentById(invoice.id))!.status).toBe("sent");
    await detail.getByRole("button", { name: "Close" }).click();

    // What the customer owes: the invoice alone — not the quotation, the
    // order or the challan it came through.
    await expectPartyBalance(page, customer, 15819);
    expect(await customerBookBalance(m.localCustomer.id)).toBe(15819);

    // ── E-way bill: below this business's ₹20,000 threshold ─────
    await openPage(page, "E-Way Bills");
    await expect(page.getByText(/above ₹20,000/).first()).toBeVisible();
    await page.getByRole("button", { name: "+ Generate EWB" }).click();
    const ewbForm = page.getByRole("dialog", { name: "Generate E-Way Bill" });
    await pick(page, ewbForm.getByRole("combobox", { name: "Invoice" }), invoice.invoice_number);
    await ewbForm.getByLabel("Vehicle Number").fill("mh12ab1234");
    await ewbForm.getByLabel("Distance (km)").fill("150");
    await expectNoHorizontalScroll(page, "generate e-way bill");
    // The refusal comes back as a 400, which the browser logs.
    guard.allow(/api\/trpc\/ewayBill\.generate/);
    await ewbForm.getByRole("button", { name: "Generate EWB" }).click();
    await expect(toast(page, "Invoice total (₹15819.00) is below the ₹20,000 threshold for E-Way Bill")).toBeVisible();
    expect(await ewayBillsFor(invoice.id)).toEqual([]);
    await ewbForm.getByRole("button", { name: "Cancel" }).click();

    // ── Part payment, then the rest ──────────────────────────────
    await openPage(page, "Invoices");
    await listRow(page, invoice.invoice_number).click();
    detail = panel(page, `Invoice ${invoice.invoice_number}`);
    await detail.getByRole("button", { name: "Record Payment" }).click();
    let pay = page.getByRole("dialog", { name: "Record Payment" });
    await expect(pay.getByLabel("Payment Amount (₹)")).toHaveValue("15819.00");
    await pay.getByLabel("Payment Amount (₹)").fill("5000");
    await expectNoHorizontalScroll(page, "record payment");
    await pay.getByRole("button", { name: `Record ${inr(5000)}` }).click();
    await expect(toast(page, "Payment recorded")).toBeVisible();
    await expect.poll(async () => (await documentById(invoice.id))!.status).toBe("partial");
    expect(await documentById(invoice.id)).toMatchObject({ amount_paid: "5000.00" });
    row = listRow(page, invoice.invoice_number);
    await expect(row).toContainText("Partial");
    await row.click();
    await expect(detail.getByText("Balance Due")).toBeVisible();
    await expect(detail.getByText(inr(10819))).toBeVisible();
    await expect(detail.getByRole("row", { name: /PAY-\d+/ })).toContainText(inr(5000));
    expect(await customerBookBalance(m.localCustomer.id)).toBe(10819);

    await detail.getByRole("button", { name: "Record Payment" }).click();
    pay = page.getByRole("dialog", { name: "Record Payment" });
    await expect(pay.getByLabel("Payment Amount (₹)")).toHaveValue("10819.00");
    await pay.getByRole("button", { name: `Record ${inr(10819)}` }).click();
    await expect(toast(page, "Payment recorded")).toBeVisible();
    await expect.poll(async () => (await documentById(invoice.id))!.status).toBe("paid");
    expect(await documentById(invoice.id)).toMatchObject({ amount_paid: "15819.00" });
    const payments = await paymentsOf(m.localCustomer.id);
    expect(payments.map((p) => [p.amount, p.allocations.map((a) => [a.invoiceId, Number(a.amount)])])).toEqual([
      ["5000.00", [[invoice.id, 5000]]],
      ["10819.00", [[invoice.id, 10819]]],
    ]);
    row = listRow(page, invoice.invoice_number);
    await expect(row).toContainText("Paid");
    await row.click();
    await expect(detail.getByText("Total Paid")).toBeVisible();
    await expect(detail.getByText("Balance Due")).toBeHidden();
    await expect(detail.getByRole("button", { name: "Record Payment" })).toBeHidden();
    expect(await customerBookBalance(m.localCustomer.id)).toBe(0);

    // ── PDF ───────────────────────────────────────────────────────
    await detail.getByRole("button", { name: "Download PDF" }).click();
    const [pdfDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "GST Invoice (A4)" }).click(),
    ]);
    expect(pdfDownload.suggestedFilename()).toBe(`${invoice.invoice_number}_a4.pdf`);
    const pdf = await saveDownload(pdfDownload);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(2_000);

    // ── Share link, opened by someone who isn't signed in ─────────
    const share = detail.getByTestId("share-link-section");
    await share.getByRole("button", { name: "Get link" }).click();
    const linkInput = share.getByRole("textbox", { name: "Share link" });
    await expect(linkInput).toHaveValue(/\/i\/[A-Za-z0-9_-]{43}$/);
    const sharePath = new URL(await linkInput.inputValue()).pathname;
    const visitor = await newJourneyContext(browser, guard, { theme: "dark", viewport: page.viewportSize() ?? undefined });
    const guest = await visitor.newPage();
    await guest.goto(sharePath);
    await expect(guest.getByText(invoice.invoice_number).first()).toBeVisible();
    await expect(guest.getByTestId("share-amount")).toContainText("15,819.00");
    await expect(guest).toHaveURL(new RegExp(`${sharePath}$`));
    await expectTheme(guest, "dark");
    await expectNoHorizontalScroll(guest, "shared invoice");
    const pdfHref = await guest.getByRole("link", { name: /download pdf/i }).getAttribute("href");
    const sharedPdf = await guest.request.get(pdfHref!);
    expect(sharedPdf.status()).toBe(200);
    expect((await sharedPdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
    // The customer sees the same bill: lines by batch, free goods, the
    // discount, shipping, round-off, and that it is paid.
    await expect(guest.getByText("Paid", { exact: true }).first()).toBeVisible();
    // (a table on a wide screen, a list on a phone)
    await expect(guest.getByText(/3 btl.*\+ 2 free/).filter({ visible: true })).toHaveCount(1);
    await expect(guest.getByText(inr(1599.82)).filter({ visible: true })).toHaveCount(1);
    for (const [term, value] of [
      ["Subtotal", inr(14100)],
      ["Discount", `-${inr(1000.4)}`],
      ["Tax", inr(2219.38)],
      ["Other charges", inr(500)],
      ["Round off", inr(0.02)],
      ["Total", inr(15819)],
      ["Balance", inr(0)],
    ]) {
      await expect(guest.getByRole("term").filter({ hasText: new RegExp(`^${term}$`) }).locator("xpath=following-sibling::dd[1]")).toHaveText(value);
    }
    await visitor.close();
    // The owner's panel counts the visit.
    await page.reload();
    await listRow(page, invoice.invoice_number).click();
    await expect(detail.getByTestId("share-link-section")).toContainText(/Opened \d+ times?/);
    await detail.getByRole("button", { name: "Close" }).click();

    // ── Walk-in sale, paid on the spot ───────────────────────────
    await page.getByRole("button", { name: /New Invoice/ }).first().click();
    const invoiceForm = documentForm(page, "New Invoice");
    await pick(page, invoiceForm.getByRole("combobox", { name: "Customer" }), "Walk-in Customer");
    await fillLine(page, invoiceForm, 0, { item: m.bracket.name, qty: "1" });
    await fillLine(page, invoiceForm, 1, { item: m.syrup.name, qty: "2" });
    // Batch SOON is gone; earliest-expiry-first now takes LATE.
    const batchPicker = invoiceForm.getByTestId("document-line").nth(1).getByRole("combobox", { name: "Batch" });
    await batchPicker.click();
    await expect(page.getByRole("option", { name: /Earliest expiry first/ })).toContainText("LATE × 2");
    await expect(page.getByRole("option", { name: /^SOON/ })).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(invoiceForm.getByTestId("document-total")).toHaveText(inr(2328));
    await expectNoHorizontalScroll(page, "new invoice");
    await invoiceForm.getByRole("button", { name: "Create Invoice" }).click();
    await expect(toast(page, /^Invoice INV-\d+ created$/)).toBeVisible();
    const [walkInInvoice] = await documentsOf(m.walkIn.id, "invoice");
    expect(walkInInvoice).toMatchObject({ subtotal: "2025.00", tax_amount: "303.00", total_amount: "2328.00", stock_mode: "tracked" });
    expect(await documentLines(walkInInvoice.id)).toMatchObject([
      { item_id: m.bracket.id, quantity: "1.000", tax_amount: "180.00" },
      { item_id: m.syrup.id, quantity: "2.000", tax_amount: "123.00", batch_number: "LATE" },
    ]);
    expect(await documentStockMoves(walkInInvoice.id)).toEqual(
      expect.arrayContaining([
        { itemId: m.bracket.id, batch: "(unbatched)", qty: -1 },
        { itemId: m.syrup.id, batch: "LATE", qty: -2 },
      ]),
    );
    expect(await itemStock(m.syrup.id)).toEqual({ total: 13, byBatch: { LATE: 13, SOON: 0 } });
    expect((await itemStock(m.bracket.id)).total).toBe(89);

    row = listRow(page, walkInInvoice.invoice_number);
    await row.click();
    detail = panel(page, `Invoice ${walkInInvoice.invoice_number}`);
    await detail.getByRole("button", { name: "Mark Sent" }).click();
    await expect(toast(page, "Invoice status updated")).toBeVisible();
    await detail.getByRole("button", { name: "Record Payment" }).click();
    pay = page.getByRole("dialog", { name: "Record Payment" });
    await expect(pay.getByLabel("Payment Amount (₹)")).toHaveValue("2328.00");
    await pay.getByRole("button", { name: `Record ${inr(2328)}` }).click();
    await expect(toast(page, "Payment recorded")).toBeVisible();
    await expect(listRow(page, walkInInvoice.invoice_number)).toContainText("Paid");
    expect(await documentById(walkInInvoice.id)).toMatchObject({ status: "paid", amount_paid: "2328.00" });
    expect((await paymentsOf(m.walkIn.id)).map((p) => [p.amount, p.mode])).toEqual([["2328.00", "cash"]]);
    expect(await customerBookBalance(m.walkIn.id)).toBe(0);
    await expectPartyBalance(page, "Walk-in Customer", 0);
    await expectLedger(page, customer, 0);

    // GSTR-1: a buyer in the seller's own state — CGST + SGST, no IGST. The
    // walk-in sale (no GSTIN) is B2C, not in the B2B table.
    await expectGstr1Row(page, invoice.invoice_number, { taxable: 13599.6, cgst: 1109.69, sgst: 1109.69, igst: 0, total: 15819 });
    await expect(page.getByRole("row").filter({ hasText: walkInInvoice.invoice_number })).toHaveCount(0);
  });
});

test.describe("J4 sales cycle — returns", () => {
  test.setTimeout(420_000);
  test.use({ theme: "dark" });

  test("other-state invoice (IGST) → part payment → credit note → sales return → cancel the return; balance at each step", async ({
    context,
    page,
    guard,
  }) => {
    const owner = await seedOwner(context, "j4r");
    const m: SalesMasters = await seedSalesMasters(owner);
    const customer = m.outstationCustomer.name;

    await openBusiness(page, owner);
    await expectTheme(page, "dark");

    // ── Invoice to a customer in Karnataka ───────────────────────
    await openPage(page, "Invoices");
    await page.getByRole("button", { name: /New Invoice/ }).first().click();
    const form = documentForm(page, "New Invoice");
    await pick(page, form.getByRole("combobox", { name: "Customer" }), customer);
    await fillLine(page, form, 0, { item: m.bracket.name, qty: "20" });
    await expect(form.getByTestId("document-total")).toHaveText(inr(23600));
    await form.getByRole("button", { name: "Create Invoice" }).click();
    await expect(toast(page, /^Invoice INV-\d+ created$/)).toBeVisible();
    const [invoice] = await documentsOf(m.outstationCustomer.id, "invoice");
    expect(invoice).toMatchObject({ subtotal: "20000.00", tax_amount: "3600.00", total_amount: "23600.00", status: "draft" });
    expect((await itemStock(m.bracket.id)).total).toBe(80);

    let row = listRow(page, invoice.invoice_number);
    await row.click();
    let detail = panel(page, `Invoice ${invoice.invoice_number}`);
    await detail.getByRole("button", { name: "Mark Sent" }).click();
    await expect(toast(page, "Invoice status updated")).toBeVisible();
    await expect.poll(async () => (await documentById(invoice.id))!.status).toBe("sent");
    await detail.getByRole("button", { name: "Close" }).click();

    // No threshold of its own: the statutory ₹50,000 applies.
    await openPage(page, "E-Way Bills");
    await expect(page.getByText(/above ₹50,000/).first()).toBeVisible();
    await page.getByRole("button", { name: "+ Generate EWB" }).click();
    const ewbForm = page.getByRole("dialog", { name: "Generate E-Way Bill" });
    await pick(page, ewbForm.getByRole("combobox", { name: "Invoice" }), invoice.invoice_number);
    await ewbForm.getByLabel("Vehicle Number").fill("KA06AB4321");
    await ewbForm.getByLabel("Distance (km)").fill("980");
    guard.allow(/api\/trpc\/ewayBill\.generate/);
    await ewbForm.getByRole("button", { name: "Generate EWB" }).click();
    await expect(toast(page, "Invoice total (₹23600.00) is below the ₹50,000 threshold for E-Way Bill")).toBeVisible();
    await ewbForm.getByRole("button", { name: "Cancel" }).click();

    await expectLedger(page, customer, 23600);
    expect(await customerBookBalance(m.outstationCustomer.id)).toBe(23600);

    // Karnataka buyer, Maharashtra seller: all IGST.
    await expectGstr1Row(page, invoice.invoice_number, { taxable: 20000, cgst: 0, sgst: 0, igst: 3600, total: 23600 });

    // ── Part payment ─────────────────────────────────────────────
    await openPage(page, "Invoices");
    await listRow(page, invoice.invoice_number).click();
    await detail.getByRole("button", { name: "Record Payment" }).click();
    const pay = page.getByRole("dialog", { name: "Record Payment" });
    await pay.getByLabel("Payment Amount (₹)").fill("11800");
    await pay.getByRole("button", { name: `Record ${inr(11800)}` }).click();
    await expect(toast(page, "Payment recorded")).toBeVisible();
    await expect(listRow(page, invoice.invoice_number)).toContainText("Partial");
    expect(await documentById(invoice.id)).toMatchObject({ status: "partial", amount_paid: "11800.00" });
    expect(await customerBookBalance(m.outstationCustomer.id)).toBe(11800);
    await expectLedger(page, customer, 11800);
    await openPage(page, "Invoices");

    // ── Credit note for part of it (2 of the 20 brackets) ─────────
    await listRow(page, invoice.invoice_number).click();
    await detail.getByRole("button", { name: "Issue Credit Note" }).click();
    let noteForm = documentForm(page, "New Credit Note");
    let line = noteForm.getByTestId("document-line").first();
    await expect(line.getByLabel("Quantity", { exact: true })).toHaveValue("20.000");
    await line.getByLabel("Quantity", { exact: true }).fill("2");
    await expect(noteForm.getByTestId("document-total")).toHaveText(inr(2360));
    await expectNoHorizontalScroll(page, "new credit note");
    await noteForm.getByRole("button", { name: "Create Credit Note" }).click();
    await expect(toast(page, "Credit Note created")).toBeVisible();
    const [creditNote] = await documentsOf(m.outstationCustomer.id, "credit_note");
    expect(creditNote).toMatchObject({ reference_document_id: invoice.id, total_amount: "2360.00", tax_amount: "360.00", stock_mode: "none" });
    // A credit note moves no goods.
    expect((await itemStock(m.bracket.id)).total).toBe(80);
    // Paid 11,800 + credited 2,360 of 23,600: still part paid.
    expect(await documentById(invoice.id)).toMatchObject({ status: "partial" });
    expect(await customerBookBalance(m.outstationCustomer.id)).toBe(9440);
    await listRow(page, invoice.invoice_number).click();
    await expect(detail.getByText("CN/SR Adjusted")).toBeVisible();
    await expect(detail.getByText(inr(9440))).toBeVisible(); // balance due
    await expect(detail.getByRole("link", { name: `See ${creditNote.invoice_number}` })).toBeVisible();
    await detail.getByRole("button", { name: "Close" }).click();
    await expectLedger(page, customer, 9440);
    await openPage(page, "Invoices");
    await listRow(page, invoice.invoice_number).click();

    // ── Sales return for the rest of the balance: 8 brackets back ─
    await detail.getByRole("button", { name: "Create Sales Return" }).click();
    noteForm = documentForm(page, "New Sales Return");
    line = noteForm.getByTestId("document-line").first();
    await expect(line.getByText("of 20 invoiced")).toBeVisible();
    await line.getByLabel("Quantity", { exact: true }).fill("8");
    await expect(noteForm.getByTestId("document-total")).toHaveText(inr(9440));
    await noteForm.getByRole("button", { name: "Create Sales Return" }).click();
    await expect(toast(page, "Sales Return created")).toBeVisible();
    const [salesReturn] = await documentsOf(m.outstationCustomer.id, "sales_return");
    expect(salesReturn).toMatchObject({ reference_document_id: invoice.id, total_amount: "9440.00", stock_mode: "tracked" });
    expect(await documentStockMoves(salesReturn.id)).toEqual([{ itemId: m.bracket.id, batch: "(unbatched)", qty: 8 }]);
    expect((await itemStock(m.bracket.id)).total).toBe(88);
    // Payments and adjustments now cover it.
    await expect(listRow(page, invoice.invoice_number)).toContainText("Paid");
    expect(await documentById(invoice.id)).toMatchObject({ status: "paid", amount_paid: "11800.00" });
    await expectLedger(page, customer, 0);
    expect(await customerBookBalance(m.outstationCustomer.id)).toBe(0);

    // ── The return is cancelled: goods out again, balance back ────
    await openPage(page, "Sales Returns");
    row = listRow(page, salesReturn.invoice_number);
    await expect(row).toContainText(inr(9440));
    await row.click();
    detail = panel(page, salesReturn.invoice_number);
    await detail.getByRole("button", { name: "Mark Sent" }).click();
    await expect(toast(page, "Status updated")).toBeVisible();
    await detail.getByRole("button", { name: "Cancel Sales Return" }).click();
    const confirm = page.getByRole("dialog").filter({ hasText: `Cancel sales return ${salesReturn.invoice_number}?` });
    await expectNoHorizontalScroll(page, "cancel sales return");
    await confirm.getByRole("button", { name: "Cancel Sales Return" }).click();
    await expect(toast(page, "Cancelled")).toBeVisible();
    await expect.poll(async () => (await documentById(salesReturn.id))!.status).toBe("cancelled");
    await expect(detail.getByText("Cancelled").first()).toBeVisible();
    // Its movement is reversed: nets to nothing.
    expect(await documentStockMoves(salesReturn.id)).toEqual([{ itemId: m.bracket.id, batch: "(unbatched)", qty: 0 }]);
    expect((await itemStock(m.bracket.id)).total).toBe(80);
    expect(await documentById(invoice.id)).toMatchObject({ status: "partial", amount_paid: "11800.00" });
    expect(await customerBookBalance(m.outstationCustomer.id)).toBe(9440);
    await detail.getByRole("button", { name: "Close" }).click();
    await expectLedger(page, customer, 9440);
    await openPage(page, "Invoices");
    await expect(listRow(page, invoice.invoice_number)).toContainText("Partial");
    await listRow(page, invoice.invoice_number).click();
    detail = panel(page, `Invoice ${invoice.invoice_number}`);
    await expect(detail.getByText(inr(9440))).toBeVisible();
    // The cancelled return is no longer offered as one of its returns.
    await expect(detail.getByRole("link", { name: `See ${salesReturn.invoice_number}` })).toBeHidden();
  });
});

/** GSTR-1's B2B table: the tax split of one invoice. */
async function expectGstr1Row(
  page: Page,
  invoiceNumber: string,
  v: { taxable: number; cgst: number; sgst: number; igst: number; total: number },
) {
  await openPage(page, "GST Returns");
  const row = page.getByRole("row").filter({ hasText: invoiceNumber });
  await expect(row.getByRole("cell")).toHaveText([
    /\w+/, // party GSTIN
    /\w+/, // name
    invoiceNumber,
    inr(v.taxable),
    inr(v.cgst),
    inr(v.sgst),
    inr(v.igst),
    inr(v.total),
  ]);
}

/** Party detail: the balance card and the ledger's last running balance. */
async function expectLedger(page: Page, name: string, balance: number) {
  await expectPartyBalance(page, name, balance);
  await page.getByRole("row").filter({ hasText: name }).click();
  const detail = page.getByRole("dialog", { name });
  await detail.getByRole("button", { name: "Ledger", exact: true }).click();
  await expectNoHorizontalScroll(page, "party ledger");
  const rows = detail.getByRole("row");
  await expect(rows.last()).toContainText(inr(balance));
  await detail.getByRole("button", { name: "Close" }).click();
}
