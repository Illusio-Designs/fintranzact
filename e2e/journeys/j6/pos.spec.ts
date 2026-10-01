/**
 * J6 — Point of sale, end to end, as the shop owner does it in the app.
 *
 *   Settings → Point-of-Sale switched on → Invoices → "Switch to POS" → the
 *   register: items rung up by scanning their barcodes (typed into the scan
 *   field the way a keyboard-wedge scanner types them) and by tapping tiles,
 *   several items per sale, quantities bumped and a line removed; four sales
 *   paid by cash, UPI, card and a cash + UPI + card split; the thermal
 *   receipt fetched for printing after each sale; the tiles' stock going
 *   down as each sale completes. Then, outside the register: the invoices
 *   (source POS, paid), stock items, payments by mode, Business Reports
 *   (Sales Register, Payment Summary) and GSTR-1's B2CS table. A second
 *   window opens the register in the dark theme.
 *
 * Amounts (all walk-in sales, Maharashtra business, so CGST + SGST):
 *   1 cash   shampoo 1 × ₹250 @18% + biscuits 2 × ₹45 @5% + slippers 1 × ₹1,200 @12%
 *            = ₹1,540 + ₹45 + ₹4.50 + ₹144 = ₹1,733.50
 *   2 UPI    biscuits 3 × ₹45 @5% = ₹135 + ₹6.75 = ₹141.75
 *   3 card   slippers 2 × ₹1,200 @12% = ₹2,400 + ₹288 = ₹2,688
 *   4 split  shampoo 2 × ₹250 @18% + biscuits 1 × ₹45 @5% = ₹545 + ₹92.25 = ₹637.25
 *            paid ₹300 cash + ₹200 UPI + ₹137.25 card
 *   Taxable ₹4,620, tax ₹580.50: 18% ₹750 / ₹135, 12% ₹3,600 / ₹432, 5% ₹270 / ₹13.50.
 *
 * Same-state treatment: the walk-in customer has no GSTIN and carries the
 * business's own state, so every sale is intra-state B2C (CGST = SGST, no
 * IGST) — checked in GSTR-1 and against the state codes in the DB.
 *
 * Items are seeded through the API (J3 owns creating them in the UI). No
 * payment gateway or other outside service is involved: POS payments are
 * recorded against the invoice; card and UPI are tender types, not gateway
 * charges. The receipt is the app's own thermal PDF; the browser's print
 * dialog itself is not driven (headless Chromium has none).
 */
import type { Page, Response } from "@playwright/test";
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
import { seedPosMasters, type PosItem, type PosMasters } from "../../helpers/pos-seed";
import { inr, listRow, openBusiness, openPage, openReport } from "../../helpers/journey-ui";
import {
  documentLines,
  documentStockMoves,
  itemStock,
  partiesNamed,
  paymentsOf,
  posEnabled,
  saleInvoicesOf,
  salesTaxByRate,
  type DocRow,
} from "../../helpers/db";

// ── Register helpers ────────────────────────────────────────────

function scanField(page: Page) {
  return page.getByRole("searchbox", { name: "Search item or scan barcode" });
}

function cart(page: Page) {
  return page.getByRole("complementary", { name: "Cart" });
}

function cartLine(page: Page, item: PosItem) {
  return cart(page).getByRole("listitem").filter({ hasText: item.name });
}

function tile(page: Page, item: PosItem) {
  return page.getByRole("region", { name: "Items" }).getByRole("button", { name: new RegExp(`^${item.name} `) });
}

/**
 * Scan a barcode: a keyboard-wedge scanner "types" the code in a burst and
 * presses Enter. The scan lands in the cart as one more of the item and the
 * code does not stay behind in the search box.
 */
async function scan(page: Page, item: PosItem, expectQty: number) {
  await scanField(page).click();
  await page.keyboard.type(item.barcode);
  await page.keyboard.press("Enter");
  await expect(cartLine(page, item)).toContainText(`× ${expectQty} `);
  await expect(scanField(page)).toHaveValue("");
}

async function expectCartTotals(page: Page, subtotal: number, tax: number, total: number) {
  await expect(cart(page).getByTestId("pos-cart-subtotal")).toHaveText(inr(subtotal));
  await expect(cart(page).getByTestId("pos-cart-tax")).toHaveText(inr(tax));
  await expect(cart(page).getByTestId("pos-cart-total")).toHaveText(inr(total));
}

type Tender = "Cash" | "UPI" | "Card";

/**
 * Take payment for the cart: one tender, or a split. The
 * sale is saved as `invoiceNumber` (the toast says so) and its receipt PDF
 * is fetched for printing.
 */
async function pay(page: Page, businessId: string, invoiceNumber: string, total: number, tender: Tender | Partial<Record<Tender, string>>) {
  if (isPhone(page)) await page.getByRole("button", { name: "Pay · F9" }).click();
  else await page.keyboard.press("F9"); // the cashier's shortcut
  const sheet = page.getByRole("dialog", { name: "Take Payment" });
  await expect(sheet.getByTestId("pos-payment-total")).toHaveText(inr(total));
  await expectNoHorizontalScroll(page, "POS payment");
  let confirm: string;
  if (typeof tender === "string") {
    await sheet.getByRole("radio", { name: tender }).click();
    await expect(sheet.getByRole("radio", { name: tender })).toHaveAttribute("aria-checked", "true");
    confirm = `Confirm ${tender}`;
  } else {
    await sheet.getByRole("radio", { name: "Split" }).click();
    for (const [t, amount] of Object.entries(tender)) await sheet.getByLabel(`${t} amount`).fill(amount);
    await expect(sheet.getByTestId("pos-split-remainder")).toHaveText("Fully covered");
    confirm = "Confirm Split";
  }
  const receipt = page.waitForResponse((r: Response) => /\/api\/invoices\/[0-9a-f-]+\/pdf\?format=thermal$/.test(r.url()));
  await sheet.getByRole("button", { name: confirm }).click();
  await expect(sheet).toBeHidden();
  await expect(toast(page, `Invoice ${invoiceNumber}`)).toBeVisible();
  // The thermal receipt: the app's own PDF, loaded into the print frame.
  const res = await receipt;
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/pdf");
  // (Its body went into the page's blob; fetch the same receipt to read it.)
  const pdf = await page.request.get(res.url(), { headers: { "x-business-id": businessId } });
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  await expect(page.locator('iframe[title="thermal-receipt"]')).toHaveAttribute("src", /^blob:/);
  // A fresh, empty cart for the next customer.
  await expect(cart(page)).toContainText("Scan or tap an item to start.");
}

async function expectTileStock(page: Page, item: PosItem, qty: number, unit: string) {
  await expect(tile(page, item)).toContainText(`${qty} ${unit} in stock`);
}

// ── Journey ─────────────────────────────────────────────────────

test.describe("J6 point of sale", () => {
  test.setTimeout(300_000);

  test("enable POS → scan & tap items → cash, UPI, card, split → receipts → stock, invoices, reports, GST", async ({
    context,
    page,
    browser,
    guard,
  }) => {
    const owner = await seedOwner(context, "j6");
    const m: PosMasters = await seedPosMasters(owner);
    const { shampoo, biscuits, slippers } = m;

    await openBusiness(page, owner);
    await expectTheme(page, "light");

    // ── Settings: switch POS on ──────────────────────────────────
    await openPage(page, "Settings");
    await page.getByRole("button", { name: "Point-of-Sale" }).click();
    const posSwitch = page.getByRole("switch", { name: "Point-of-Sale mode" });
    await expect(posSwitch).toHaveAttribute("aria-checked", "false");
    await posSwitch.click();
    await expect(toast(page, "POS mode enabled")).toBeVisible();
    await expect(posSwitch).toHaveAttribute("aria-checked", "true");
    await expect(page.getByText("Using POS mode")).toBeVisible();
    await expectNoHorizontalScroll(page, "settings / point-of-sale");
    expect(await posEnabled(owner.businessId)).toBe(true);

    // ── Into the register from Invoices ──────────────────────────
    await openPage(page, "Invoices");
    await page.getByRole("link", { name: "Switch to POS" }).click();
    await expect(page).toHaveURL(/\/pos$/);
    await expect(page.getByTestId("pos-shell")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Customer: Walk-in Customer (F3 to change)" })).toBeVisible();
    await expectTheme(page, "light");
    await expectTileStock(page, shampoo, 40, "pcs");
    await expectTileStock(page, biscuits, 200, "pcs");
    await expectTileStock(page, slippers, 10, "pair");
    await expectNoHorizontalScroll(page, "POS register");
    const [walkIn] = await partiesNamed(owner.businessId, "Walk-in Customer");
    expect(walkIn, "the register set up its walk-in customer").toBeTruthy();

    // ── Sale 1: scanned and tapped, paid in cash ─────────────────
    await scan(page, shampoo, 1);
    await scan(page, biscuits, 1);
    await scan(page, biscuits, 2); // the same code again bumps the line
    await tile(page, slippers).click();
    await expect(cartLine(page, slippers)).toContainText("× 1 pair");
    await expect(cart(page).getByRole("listitem")).toHaveCount(3);
    await expect(cartLine(page, biscuits)).toContainText(inr(90));
    await expectCartTotals(page, 1540, 193.5, 1733.5);
    await expectNoHorizontalScroll(page, "POS cart");
    const sale1 = "INV-00001";
    await pay(page, owner.businessId, sale1, 1733.5, "Cash");
    await expectTileStock(page, shampoo, 39, "pcs");
    await expectTileStock(page, biscuits, 198, "pcs");
    await expectTileStock(page, slippers, 9, "pair");

    // ── Sale 2: a wrong item removed, quantity stepped up, UPI ────
    await scan(page, shampoo, 1);
    await scan(page, biscuits, 1);
    await cart(page).getByRole("button", { name: `Remove ${shampoo.name} from cart` }).click();
    await expect(cartLine(page, shampoo)).toHaveCount(0);
    const biscuitsLine = cartLine(page, biscuits);
    await biscuitsLine.getByRole("button", { name: "Increase quantity" }).click();
    await biscuitsLine.getByRole("button", { name: "Increase quantity" }).click();
    await expect(biscuitsLine).toContainText("× 3 pcs");
    await expectCartTotals(page, 135, 6.75, 141.75);
    const sale2 = "INV-00002";
    await pay(page, owner.businessId, sale2, 141.75, "UPI");
    await expectTileStock(page, biscuits, 195, "pcs");

    // ── Sale 3: by search and tap, paid by card ──────────────────
    await scanField(page).fill("Rubber");
    await expect(page.getByRole("region", { name: "Items" }).getByRole("button")).toHaveCount(1);
    await tile(page, slippers).click();
    await tile(page, slippers).click();
    await expect(cartLine(page, slippers)).toContainText("× 2 pair");
    await scanField(page).fill("");
    await expectCartTotals(page, 2400, 288, 2688);
    const sale3 = "INV-00003";
    await pay(page, owner.businessId, sale3, 2688, "Card");
    await expectTileStock(page, slippers, 7, "pair");

    // ── Sale 4: split across cash, UPI and card ──────────────────
    await scan(page, shampoo, 1);
    await scan(page, shampoo, 2);
    await scan(page, biscuits, 1);
    await expectCartTotals(page, 545, 92.25, 637.25);
    // The sheet will not take more or less than the total.
    await page.getByRole("button", { name: "Pay · F9" }).click();
    let sheet = page.getByRole("dialog", { name: "Take Payment" });
    await sheet.getByRole("radio", { name: "Split" }).click();
    await sheet.getByLabel("Cash amount").fill("300");
    await expect(sheet.getByTestId("pos-split-remainder")).toHaveText(`${inr(337.25)} still to pay`);
    await expect(sheet.getByRole("button", { name: "Confirm Split" })).toBeDisabled();
    await sheet.getByLabel("UPI amount").fill("200");
    await sheet.getByLabel("Card amount").fill("150");
    await expect(sheet.getByTestId("pos-split-remainder")).toHaveText("₹12.75 more than the total");
    await expect(sheet.getByRole("button", { name: "Confirm Split" })).toBeDisabled();
    await sheet.getByRole("button", { name: "Cancel" }).click();
    await expect(sheet).toBeHidden();
    const sale4 = "INV-00004";
    await pay(page, owner.businessId, sale4, 637.25, { Cash: "300", UPI: "200", Card: "137.25" });
    await expectTileStock(page, shampoo, 37, "pcs");
    await expectTileStock(page, biscuits, 194, "pcs");

    // ── The register in the dark, in a second window ─────────────
    const night = await newJourneyContext(browser, guard, {
      theme: "dark",
      storageState: await context.storageState(),
      viewport: page.viewportSize()!,
      hasTouch: isPhone(page),
    });
    const nightPage = await night.newPage();
    await nightPage.goto("/pos");
    // A new window picks its company first, then opens straight on the register.
    await nightPage.getByRole("button", { name: `Open ${owner.businessName}` }).click();
    await expect(nightPage.getByTestId("pos-shell")).toBeVisible({ timeout: 20_000 });
    await expectTheme(nightPage, "dark");
    await expectTileStock(nightPage, shampoo, 37, "pcs");
    await expectNoHorizontalScroll(nightPage, "POS register (dark)");
    await night.close();

    // ── DB: four paid POS invoices to the walk-in customer ───────
    const sales: DocRow[] = await saleInvoicesOf(walkIn.id);
    expect(sales.map((s) => s.invoice_number)).toEqual([sale1, sale2, sale3, sale4]);
    expect(sales.map((s) => [s.subtotal, s.tax_amount, s.total_amount, s.amount_paid, s.status, s.source])).toEqual([
      ["1540.00", "193.50", "1733.50", "1733.50", "paid", "pos"],
      ["135.00", "6.75", "141.75", "141.75", "paid", "pos"],
      ["2400.00", "288.00", "2688.00", "2688.00", "paid", "pos"],
      ["545.00", "92.25", "637.25", "637.25", "paid", "pos"],
    ]);
    const [inv1, inv2, inv3, inv4] = sales;
    const lines1 = await documentLines(inv1.id);
    expect(lines1.map((l) => [l.item_id, l.quantity, l.unit_price, l.tax_percent, l.tax_amount, l.total_amount]).sort()).toEqual(
      [
        [shampoo.id, "1.000", "250.00", "18.00", "45.00", "295.00"],
        [biscuits.id, "2.000", "45.00", "5.00", "4.50", "94.50"],
        [slippers.id, "1.000", "1200.00", "12.00", "144.00", "1344.00"],
      ].sort(),
    );

    // Stock: one movement out per item and sale.
    const out = async (id: string) => (await documentStockMoves(id)).map((mv) => [mv.itemId, mv.qty]).sort();
    expect(await out(inv1.id)).toEqual([[shampoo.id, -1], [biscuits.id, -2], [slippers.id, -1]].sort());
    expect(await out(inv2.id)).toEqual([[biscuits.id, -3]]);
    expect(await out(inv3.id)).toEqual([[slippers.id, -2]]);
    expect(await out(inv4.id)).toEqual([[shampoo.id, -2], [biscuits.id, -1]].sort());
    expect((await itemStock(shampoo.id)).total).toBe(37);
    expect((await itemStock(biscuits.id)).total).toBe(194);
    expect((await itemStock(slippers.id)).total).toBe(7);

    // Payments: one per tender, each allocated in full to its sale.
    const payments = await paymentsOf(walkIn.id);
    expect(
      payments.map((p) => [p.mode, p.amount, p.allocations.map((a) => [a.invoiceId, Number(a.amount)])]),
    ).toEqual([
      ["cash", "1733.50", [[inv1.id, 1733.5]]],
      ["upi", "141.75", [[inv2.id, 141.75]]],
      ["credit_card", "2688.00", [[inv3.id, 2688]]],
      ["cash", "300.00", [[inv4.id, 300]]],
      ["upi", "200.00", [[inv4.id, 200]]],
      ["credit_card", "137.25", [[inv4.id, 137.25]]],
    ]);

    // GST: by rate from the lines; the walk-in is unregistered and in the
    // business's own state, so the supply is intra-state.
    const gst = await salesTaxByRate(walkIn.id);
    expect(gst.rows).toEqual([
      { rate: 18, taxable: 750, tax: 135 },
      { rate: 12, taxable: 3600, tax: 432 },
      { rate: 5, taxable: 270, tax: 13.5 },
    ]);
    expect(gst.buyer_gstin).toBeNull();
    expect(gst.seller).toBe("27");
    expect([null, gst.seller]).toContain(gst.buyer);

    // ── Back in the app: invoices, stock, payments ───────────────
    await page.getByRole("button", { name: "Exit POS" }).click();
    await expect(page.getByRole("heading", { name: "Invoices", level: 1 })).toBeVisible();
    await expectNoHorizontalScroll(page, "Invoices");
    for (const [number, total] of [[sale1, 1733.5], [sale2, 141.75], [sale3, 2688], [sale4, 637.25]] as const) {
      const row = listRow(page, number);
      await expect(row).toContainText("Walk-in Customer");
      await expect(row).toContainText(inr(total));
      await expect(row).toContainText("Paid");
      if (!isPhone(page)) await expect(row).toContainText("POS");
    }

    await openPage(page, "Stock Items");
    for (const [item, qty] of [[shampoo, 37], [biscuits, 194], [slippers, 7]] as const) {
      await expect(listRow(page, item.name).getByRole("cell", { name: String(qty), exact: true })).toBeVisible();
    }

    await openPage(page, "Payments");
    const cardRow = page.getByRole("row").filter({ hasText: inr(2688) });
    await expect(cardRow).toContainText("Credit Card");
    await expect(page.getByRole("row").filter({ hasText: inr(137.25) })).toContainText("Credit Card");
    await expect(page.getByRole("row").filter({ hasText: inr(141.75) })).toContainText("UPI");

    // ── Business Reports ─────────────────────────────────────────
    await openReport(page, "Sales Register");
    for (const n of [sale1, sale2, sale3, sale4]) await expect(listRow(page, n)).toContainText("Paid");
    // A stat card: its label paragraph, then the figure.
    const summary = (label: string) =>
      page.locator("p").filter({ hasText: new RegExp(`^${label}$`) }).locator("xpath=following-sibling::p[1]");
    await expect(summary("Subtotal")).toHaveText(inr(4620));
    await expect(summary("Total Tax")).toHaveText(inr(580.5));
    await expect(summary("Total Amount")).toHaveText(inr(5200.5));
    await expectNoHorizontalScroll(page, "Sales Register");

    await openReport(page, "Payment Summary");
    await expect(summary("Total Received")).toHaveText(inr(5200.5));
    const byMode = page.getByRole("table").first();
    await expect(byMode.getByRole("row").filter({ hasText: /^Cash/ })).toContainText(inr(2033.5));
    await expect(byMode.getByRole("row").filter({ hasText: /^UPI/ })).toContainText(inr(341.75));
    await expect(byMode.getByRole("row").filter({ hasText: /^Credit Card/ })).toContainText(inr(2825.25));
    await expectNoHorizontalScroll(page, "Payment Summary");

    // ── GSTR-1: B2C (small), same state — CGST + SGST, no IGST ───
    await openPage(page, "GST Returns");
    await expect(page.getByRole("heading", { name: /^B2CS/ })).toBeVisible();
    const b2cs = page.getByRole("table").filter({ has: page.getByRole("columnheader", { name: "Tax Rate" }) });
    const rateRow = (rate: string) => b2cs.getByRole("row").filter({ has: page.getByRole("cell", { name: rate, exact: true }) });
    await expect(rateRow("18%").getByRole("cell")).toHaveText(["18%", inr(750), inr(67.5), inr(67.5), inr(0)]);
    await expect(rateRow("12%").getByRole("cell")).toHaveText(["12%", inr(3600), inr(216), inr(216), inr(0)]);
    // Each invoice splits its own tax, CGST taking an odd paisa (half up):
    // the 5% tax of ₹4.50, ₹6.75 and ₹2.25 splits 2.25/2.25, 3.38/3.37 and
    // 1.13/1.12, so the rate adds up to ₹6.76 + ₹6.74 = ₹13.50.
    await expect(rateRow("5%").getByRole("cell")).toHaveText(["5%", inr(270), inr(6.76), inr(6.74), inr(0)]);
    await expect(summary("CGST")).toHaveText(inr(290.26));
    await expect(summary("SGST")).toHaveText(inr(290.24));
    await expect(summary("IGST")).toHaveText(inr(0));
    await expectNoHorizontalScroll(page, "GST Returns");
  });
});
