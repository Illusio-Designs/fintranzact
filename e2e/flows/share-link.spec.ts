/**
 * share-link.spec.ts — Public invoice links.
 *
 * Makes a link from the invoice panel, opens it signed out (document, amount
 * and PDF download all work without an account), then turns the link off and
 * checks the old URL stops working.
 */
import { test, expect, ApiHelper } from "../helpers/fixtures";
import { loadSeed, SeedApi, createParty, createItem, createInvoice } from "../helpers/seed";

let businessId: string;
let partyId: string;
let itemId: string;

test.beforeAll(async () => {
  businessId = loadSeed().businessId;
  const api = new SeedApi();
  const ts = Date.now();
  partyId = (await createParty(api, businessId, { name: `Share Test Customer ${ts}` })).id;
  itemId = (await createItem(api, businessId, { name: `Share Test Widget ${ts}`, salePrice: "500.00", taxPercent: "18.00" })).id;
});

test.describe("Share link", () => {
  test("customer opens the invoice from a link without signing in, until it is turned off", async ({ page, browser }) => {
    const api = new ApiHelper(page, process.env.API_URL ?? "http://localhost:3000");
    const invoice = await createInvoice(api, businessId, partyId, itemId);

    await page.goto(`/invoices?id=${invoice.id}`);
    const panel = page.locator('[role="dialog"]').first();
    await expect(panel).toBeVisible({ timeout: 10_000 });

    const section = panel.getByTestId("share-link-section");
    await section.getByRole("button", { name: /get link/i }).click();
    const linkInput = section.getByRole("textbox", { name: "Share link" });
    await expect(linkInput).toHaveValue(/\/i\/[A-Za-z0-9_-]{43}$/, { timeout: 10_000 });
    const url = await linkInput.inputValue();
    const sharePath = new URL(url).pathname;

    // A visitor with no account opens it.
    const visitor = await browser.newContext({
      baseURL: test.info().project.use.baseURL,
      storageState: { cookies: [], origins: [] },
    });
    const guest = await visitor.newPage();
    await guest.goto(sharePath);
    await expect(guest.getByText(invoice.invoiceNumber)).toBeVisible({ timeout: 10_000 });
    await expect(guest.getByTestId("share-amount")).toContainText("1,180.00");
    await expect(guest).toHaveURL(new RegExp(`${sharePath}$`)); // not bounced to /login

    const pdfHref = await guest.getByRole("link", { name: /download pdf/i }).getAttribute("href");
    const pdf = await guest.request.get(pdfHref!);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toContain("application/pdf");

    // The panel counts the visit (dev StrictMode may load the page twice).
    await page.reload();
    await expect(page.getByTestId("share-link-section")).toContainText(/opened \d+ times?/i, { timeout: 10_000 });

    // Turn it off: the old link stops working.
    await page.getByTestId("share-link-section").getByRole("button", { name: /turn off link/i }).click();
    await page.getByRole("button", { name: /^turn off$/i }).click();
    await expect(page.getByTestId("share-link-section").getByRole("button", { name: /get link/i })).toBeVisible({
      timeout: 10_000,
    });

    await guest.reload();
    await expect(guest.getByText(/not valid any more/i)).toBeVisible({ timeout: 10_000 });
    await visitor.close();
  });
});
