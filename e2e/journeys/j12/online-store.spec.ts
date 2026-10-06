/**
 * J12 — The online store, from the owner switching it on to a customer's
 * order being confirmed (and another cancelled).
 *
 *   Settings → Online Store: switched on, a store URL (slug, locked once
 *   saved), tagline, ₹500 minimum order, delivery note → Manage Items puts two
 *   items on the store → the "Open store" link is opened in a fresh browser
 *   (a customer's phone: 390 px, no session) → the customer adds 2 mango
 *   boxes and a cashew pack, sees GST in the cart, verifies the mobile number
 *   (a new customer gives a name), fills the delivery details and places the
 *   order → order 2: two cashew packs → back in the app, Store Orders lists
 *   both; order 1 is confirmed, order 2 cancelled with a reason → the
 *   invoices and stock, in the app and in the DB. A second window shows Store
 *   Orders in the dark theme.
 *
 * Amounts (Maharashtra business; the order's walk-in customer has no state,
 * so it is an intra-state B2C sale: CGST + SGST):
 *   order 1  mango box 2 × ₹800 @5% + cashew pack 1 × ₹450 @12%
 *            = ₹1,600 + ₹80 + ₹450 + ₹54 = ₹2,184.00 (taxable ₹2,050, GST ₹134)
 *   order 2  cashew pack 2 × ₹450 @12% = ₹900 + ₹108 = ₹1,008.00
 *   Placing an order takes its stock out (the order raises an "unfulfilled"
 *   invoice); confirming marks that invoice sent; cancelling cancels it and
 *   puts the stock back. Mango 10 → 8; cashew 20 → 19 → 17 → 19.
 *
 * External services: none. Cloudflare Turnstile (on the phone step and the
 * order) is replaced in the browser by a stub that passes, and the API runs
 * without TURNSTILE_SECRET_KEY, so it accepts the stub's token (its test
 * mode). The store has no SMS one-time password: "phone verify" is the
 * Turnstile-guarded lookup of the number (new vs returning customer), which
 * is what is exercised. No payment gateway is involved (orders are paid on
 * delivery). Items are seeded through the API (J3 creates items in the UI).
 */
import type { Page } from "@playwright/test";
import {
  test,
  expect,
  expectNoHorizontalScroll,
  expectTheme,
  isPhone,
  navTo,
  newJourneyContext,
  toast,
  uid,
} from "../../helpers/journey";
import { seedOwner } from "../../helpers/journey-seed";
import { dialog, inr, listRow, openBusiness, openPage } from "../../helpers/journey-ui";
import { documentLines, documentStockMoves, itemStock } from "../../helpers/db";
import { storeEnabledItems, storeOrdersOf, storeSettings } from "../../helpers/settings-db";

/** The store prints whole-rupee prices on cards and two decimals in totals. */
function rupees(n: number) {
  return `₹${n.toFixed(2)}`;
}

async function expectCartCount(store: Page, n: number) {
  await expect(store.getByRole("button", { name: `Cart with ${n} items` })).toBeVisible();
}

test.describe("J12 online store", () => {
  test.setTimeout(300_000);

  test("enable store → items → customer orders on a phone → Store Orders → confirm one, cancel another", async ({
    context,
    page,
    browser,
    guard,
  }) => {
    const owner = await seedOwner(context, "j12");
    const id = uid();
    const make = (name: string, hsn: string, unit: string, price: string, tax: string, stock: string) =>
      owner.api.mutate<{ id: string; name: string }>("item.create", {
        name: `${name} ${id}`,
        hsn,
        unit,
        itemMode: "simple",
        itemType: "product",
        salePrice: price,
        purchasePrice: (Number(price) * 0.6).toFixed(2),
        taxPercent: tax,
        stockQuantity: stock,
        taxInclusive: false,
      });
    const mango = await make("Alphonso Mango Box", "0804", "box", "800.00", "5", "10");
    const cashew = await make("Roasted Cashew Pack", "0801", "pkt", "450.00", "12", "20");
    // An item that stays off the store.
    const hidden = await make("Wholesale Sack", "1006", "bag", "2500.00", "5", "5");
    const slug = `j12-${id}`;

    await openBusiness(page, owner);
    await expectTheme(page, "light");

    // ── Settings → Online Store ─────────────────────────────────
    await navTo(page, "Settings");
    await page.getByRole("button", { name: "Online Store", exact: true }).click();
    await page.getByRole("switch", { name: "Enable online store" }).click();
    await page.getByLabel("Store URL").fill(`J12-${id}!`);
    // Lower case, letters, digits and dashes only.
    await expect(page.getByLabel("Store URL")).toHaveValue(slug);
    await expect(page.getByText("This URL is available!")).toBeVisible();
    await page.getByLabel("Store Tagline").fill("Konkan mangoes and dry fruit, delivered");
    await page.getByLabel("Minimum Order Amount").fill("500");
    await page.getByLabel("Delivery Note").fill("Free delivery in Mumbai");
    await expectNoHorizontalScroll(page, "settings / online store");
    await page.getByRole("button", { name: "Save Settings" }).click();
    await expect(toast(page, "Store settings saved")).toBeVisible();
    await expect(page.getByText("Store URL cannot be changed once set")).toBeVisible();
    await expect(page.getByLabel("Store URL")).toBeDisabled();
    expect(await storeSettings(owner.businessId)).toEqual({
      store_enabled: true,
      store_slug: slug,
      store_tagline: "Konkan mangoes and dry fruit, delivered",
      store_min_order_amount: "500.00",
      store_delivery_note: "Free delivery in Mumbai",
    });

    // Items on the store.
    await expect(page.getByText(/^0 of \d+ items on your store$/)).toBeVisible();
    await page.getByRole("button", { name: "Manage Items" }).click();
    const manage = dialog(page, "Manage Store Items");
    await manage.getByPlaceholder("Search items…").fill(id);
    await manage.getByRole("checkbox", { name: mango.name }).click();
    await manage.getByRole("checkbox", { name: cashew.name }).click();
    await expect(manage.getByRole("checkbox", { name: mango.name })).toHaveAttribute("aria-checked", "true");
    await expect(manage.getByRole("checkbox", { name: hidden.name })).toHaveAttribute("aria-checked", "false");
    await expectNoHorizontalScroll(page, "manage store items");
    await manage.getByRole("button", { name: "Apply 2 Changes" }).click();
    await expect(manage).toBeHidden();
    await expect(page.getByText(/^2 of \d+ items on your store$/)).toBeVisible();
    expect(await storeEnabledItems(owner.businessId)).toEqual([mango.name, cashew.name].sort());

    // ── The customer, on a phone, from the store link ───────────
    const storeHref = await page.getByRole("link", { name: new RegExp(`/${slug}$`) }).first().getAttribute("href");
    expect(storeHref).toMatch(new RegExp(`^https?://[^/]+/${slug}$`));
    const shopper = await newJourneyContext(browser, guard, {
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    const store = await shopper.newPage();
    await store.goto(storeHref!);
    await expect(store.getByRole("heading", { level: 1, name: owner.businessName })).toBeVisible({ timeout: 20_000 });
    await expect(store.getByText("Konkan mangoes and dry fruit, delivered")).toBeVisible();
    // The footer links the five policy pages, each at its own URL under the store.
    const footerPolicies = store.getByRole("navigation", { name: "Store policies" });
    for (const [label, kind] of [
      ["Terms & Conditions", "terms"],
      ["Refund & Cancellation", "refund"],
      ["Shipping & Delivery", "shipping"],
      ["Contact Us", "contact"],
      ["Privacy Policy", "privacy"],
    ] as const) {
      await expect(footerPolicies.getByRole("link", { name: label })).toHaveAttribute("href", `/${slug}/policies/${kind}`);
    }
    await expect(store.getByRole("heading", { level: 3, name: mango.name })).toBeVisible();
    await expect(store.getByRole("heading", { level: 3, name: cashew.name })).toBeVisible();
    await expect(store.getByRole("heading", { level: 3, name: hidden.name })).toHaveCount(0);
    await expectNoHorizontalScroll(store, "store home");

    await store.getByRole("button", { name: `Add ${mango.name}` }).click();
    await store.getByRole("button", { name: `Add one more ${mango.name}` }).click();
    await store.getByRole("button", { name: `Add ${cashew.name}` }).click();
    await expectCartCount(store, 3);

    const cart = store.getByRole("dialog", { name: "Your Cart" });
    await store.getByRole("button", { name: "Cart with 3 items" }).click();
    await expect(cart).toBeVisible();
    await expect(cart.getByTestId("cart-subtotal")).toHaveText(rupees(2050));
    await expect(cart.getByTestId("cart-tax")).toHaveText(rupees(134));
    await expect(cart.getByTestId("cart-total")).toHaveText(rupees(2184));
    await expect(cart.getByText("Free delivery in Mumbai")).toBeVisible();
    await expectNoHorizontalScroll(store, "store cart");
    await cart.getByRole("button", { name: "Proceed to Checkout" }).click();

    // Phone verification: a new number, so the customer gives a name.
    const phone = `98${String(Date.now()).slice(-8)}`;
    await expect(store.getByRole("heading", { name: "Enter your mobile number" })).toBeVisible();
    await store.getByLabel("Mobile number").fill(phone);
    await expectNoHorizontalScroll(store, "store phone step");
    await store.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(store.getByRole("heading", { name: "Welcome!" })).toBeVisible();
    await store.getByLabel("Your name").fill("Meera Kulkarni");
    await store.getByRole("button", { name: "Continue to Checkout" }).click();

    await expect(store.getByRole("heading", { name: "Checkout" })).toBeVisible();
    // Policy links sit by the Place Order button.
    await expect(
      store.getByRole("navigation", { name: "Store policies" }).getByRole("link", { name: "Refund & Cancellation" }),
    ).toBeVisible();
    await expect(store.getByLabel("Full Name")).toHaveValue("Meera Kulkarni");
    await store.getByLabel("Delivery Address").fill("Flat 12, Shanti Kunj, Dadar West");
    await store.getByLabel("City").fill("Mumbai");
    await store.getByLabel("Pincode").fill("400028");
    await store.getByLabel("Order Notes").fill("Ring the bell twice");
    await expect(store.getByTestId("checkout-total")).toHaveText(rupees(2184));
    // Totals are laid out before paying: subtotal, GST, delivery, total.
    await expect(store.getByTestId("checkout-subtotal")).toHaveText(rupees(2050));
    await expect(store.getByTestId("checkout-tax")).toHaveText(rupees(134));
    await expect(store.getByTestId("checkout-delivery")).toBeVisible();
    // This store has not switched on online payment, so Cash on Delivery is the one way to pay.
    await expect(store.getByTestId("payment-choice")).toContainText("Cash on Delivery");
    await expect(store.getByTestId("payment-choice")).not.toContainText("Pay online");
    await expectNoHorizontalScroll(store, "store checkout");
    await store.getByRole("button", { name: `Place Order · ${rupees(2184)}` }).click();
    await expect(store.getByRole("heading", { name: "Order Placed!" })).toBeVisible();
    // What the store showed is what the order is charged at.
    await expect(store.getByTestId("order-total")).toHaveText(rupees(2184));
    const order1 = (await store.getByTestId("order-number").innerText()).trim();
    await expectNoHorizontalScroll(store, "store order placed");

    // ── A second order, to be cancelled ─────────────────────────
    await store.getByRole("button", { name: "Continue Shopping" }).click();
    await expectCartCount(store, 0);
    await store.getByRole("button", { name: `Add ${cashew.name}` }).click();
    await store.getByRole("button", { name: `Add one more ${cashew.name}` }).click();
    await store.getByRole("button", { name: "Cart with 2 items" }).click();
    await expect(cart.getByTestId("cart-total")).toHaveText(rupees(1008));
    await cart.getByRole("button", { name: "Proceed to Checkout" }).click();
    await store.getByLabel("Mobile number").fill(phone);
    await store.getByRole("button", { name: "Continue", exact: true }).click();
    // The number is new to the business's books (orders go to the walk-in
    // customer), so the name is asked again.
    await store.getByLabel("Your name").fill("Meera Kulkarni");
    await store.getByRole("button", { name: "Continue to Checkout" }).click();
    await store.getByRole("button", { name: `Place Order · ${rupees(1008)}` }).click();
    await expect(store.getByRole("heading", { name: "Order Placed!" })).toBeVisible();
    const order2 = (await store.getByTestId("order-number").innerText()).trim();
    expect(order2).not.toBe(order1);
    await shopper.close();

    // Stock left the shelf when the orders were placed.
    let orders = await storeOrdersOf(owner.businessId);
    expect(orders.map((o) => [o.order_number, o.status, o.total_amount, o.invoice_status])).toEqual([
      [order1, "pending", "2184.00", "unfulfilled"],
      [order2, "pending", "1008.00", "unfulfilled"],
    ]);
    expect((await itemStock(mango.id)).total).toBe(8);
    expect((await itemStock(cashew.id)).total).toBe(17);

    // ── Store Orders: confirm order 1 ───────────────────────────
    await openPage(page, "Store Orders");
    await expect(listRow(page, order1)).toContainText("Meera Kulkarni");
    await expect(listRow(page, order1)).toContainText(inr(2184));
    await expect(listRow(page, order2)).toContainText(inr(1008));
    await listRow(page, order1).click();
    const detail1 = dialog(page, `Order ${order1}`);
    await expect(detail1).toContainText(`+91${phone}`.slice(-10));
    await expect(detail1).toContainText(mango.name);
    // (Regression: the panel read fields the API does not send — every line
    // showed ₹NaN and the invoice, address and notes never appeared.)
    await expect(detail1).toContainText(orders[0].invoice_number!);
    await expect(detail1.getByRole("row").filter({ hasText: mango.name })).toContainText(inr(1680));
    await expect(detail1.getByRole("row").filter({ hasText: cashew.name })).toContainText(inr(504));
    await expect(detail1.getByTestId("store-order-address")).toHaveText("Flat 12, Shanti Kunj, Dadar West, Mumbai 400028");
    await expect(detail1.getByTestId("store-order-payment")).toContainText("Cash on Delivery");
    await expect(detail1).toContainText("Ring the bell twice");
    await expectNoHorizontalScroll(page, "store order detail");
    await detail1.getByRole("button", { name: "Confirm Order" }).click();
    await expect(toast(page, "Order confirmed")).toBeVisible();
    await detail1.getByRole("button", { name: "Close", exact: true }).click();
    await expect(listRow(page, order1)).toContainText("Confirmed");

    // ── …and cancel order 2 ─────────────────────────────────────
    await listRow(page, order2).click();
    const detail2 = dialog(page, `Order ${order2}`);
    await detail2.getByRole("button", { name: "Cancel Order" }).click();
    const cancel = dialog(page, "Cancel Order");
    await cancel.getByLabel("Reason (optional)").fill("Customer changed their mind");
    await cancel.getByRole("button", { name: "Cancel Order" }).click();
    await expect(toast(page, "Order cancelled")).toBeVisible();
    await expect(cancel).toBeHidden();
    await expect(detail2).toContainText("Reason: Customer changed their mind");
    await detail2.getByRole("button", { name: "Close", exact: true }).click();
    await expect(listRow(page, order2)).toContainText("Cancelled");

    // ── DB: orders, invoices, lines, stock ──────────────────────
    orders = await storeOrdersOf(owner.businessId);
    expect(orders).toMatchObject([
      {
        order_number: order1,
        status: "confirmed",
        customer_name: "Meera Kulkarni",
        customer_phone: phone,
        delivery_city: "Mumbai",
        delivery_pincode: "400028",
        total_amount: "2184.00",
        item_count: 2,
        invoice_status: "sent",
        invoice_source: "online_store",
        subtotal: "2050.00",
        tax_amount: "134.00",
        invoice_total: "2184.00",
        party_name: "Walk-in Customer",
      },
      {
        order_number: order2,
        status: "cancelled",
        cancellation_reason: "Customer changed their mind",
        total_amount: "1008.00",
        invoice_status: "cancelled",
        subtotal: "900.00",
        tax_amount: "108.00",
      },
    ]);
    expect(orders[0].confirmed_at).not.toBeNull();
    expect(orders[1].cancelled_at).not.toBeNull();
    expect(await documentLines(orders[0].invoice_id!)).toMatchObject([
      { item_id: mango.id, quantity: "2.000", unit_price: "800.00", tax_percent: "5.00", tax_amount: "80.00", total_amount: "1680.00" },
      { item_id: cashew.id, quantity: "1.000", unit_price: "450.00", tax_percent: "12.00", tax_amount: "54.00", total_amount: "504.00" },
    ]);
    expect(await documentStockMoves(orders[0].invoice_id!)).toEqual(
      expect.arrayContaining([
        { itemId: mango.id, batch: "(unbatched)", qty: -2 },
        { itemId: cashew.id, batch: "(unbatched)", qty: -1 },
      ]),
    );
    // The cancelled order put its two packs back: out and in again, net zero.
    expect(await documentStockMoves(orders[1].invoice_id!)).toEqual([{ itemId: cashew.id, batch: "(unbatched)", qty: 0 }]);
    expect((await itemStock(mango.id)).total).toBe(8);
    expect((await itemStock(cashew.id)).total).toBe(19);

    // ── The app agrees: invoice and stock ───────────────────────
    await openPage(page, "Invoices");
    await expect(listRow(page, orders[0].invoice_number!)).toContainText(inr(2184));
    await openPage(page, "Stock Items");
    await page.getByRole("searchbox").first().fill(id);
    const headers = (await page.getByRole("columnheader").allInnerTexts()).map((h) => h.trim().toLowerCase());
    const stockColumn = headers.findIndex((h) => h.startsWith("stock"));
    expect(stockColumn, "the items table has a Stock column").toBeGreaterThan(-1);
    await expect(listRow(page, mango.name).getByRole("cell").nth(stockColumn)).toHaveText("8");
    await expect(listRow(page, cashew.name).getByRole("cell").nth(stockColumn)).toHaveText("19");

    // ── Store Orders at night ───────────────────────────────────
    const night = await newJourneyContext(browser, guard, {
      theme: "dark",
      storageState: await context.storageState(),
      viewport: page.viewportSize()!,
      hasTouch: isPhone(page),
    });
    const nightPage = await night.newPage();
    await nightPage.goto("/store-orders");
    await nightPage.getByRole("button", { name: `Open ${owner.businessName}` }).click();
    await expect(nightPage.getByRole("heading", { name: "Store Orders", level: 1 })).toBeVisible({ timeout: 20_000 });
    await expectTheme(nightPage, "dark");
    await expect(listRow(nightPage, order1)).toContainText("Confirmed");
    await expectNoHorizontalScroll(nightPage, "store orders (dark)");
    await night.close();
  });
});
