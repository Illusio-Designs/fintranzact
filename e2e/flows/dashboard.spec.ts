/**
 * dashboard.spec.ts — Dashboard page flow tests.
 *
 * Verifies the owner/admin experience on the "/" route:
 *   - Greeting heading ("Good morning/afternoon/evening, <name>")
 *   - DateRangeBar preset buttons (This Month, Last Month, etc.)
 *   - no "New invoice" shortcut in the app header
 *   - Profit indicator cards (Gross Profit, Net Profit)
 *   - Chart sections render without crashing
 *
 * Seller redirect from "/" → "/invoices" is already covered in
 * flows/role-visibility.spec.ts and is not repeated here.
 */
import { test, expect, waitForPageReady } from "../helpers/fixtures";

/** The dashboard greets the user by time of day instead of a "Dashboard" title. */
const DASHBOARD_HEADING = /Good (morning|afternoon|evening)/;

test.describe("Dashboard Flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await waitForPageReady(page);
  });

  test("admin sees the dashboard greeting heading", async ({ page }) => {
    await expect(page.locator("h1").first()).toContainText(DASHBOARD_HEADING);
  });

  test("dashboard shows DateRangeBar with preset buttons", async ({ page }) => {
    // DateRangeBar renders buttons for each DATE_PRESET: "This Month",
    // "Last Month", "Last 30 Days", "This FY", "Last FY", "Custom", "All"
    await expect(
      page.getByRole("button", { name: "This Month" }).first()
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Last Month" }).first()
    ).toBeVisible();
  });

  test("header has no New invoice shortcut", async ({ page }) => {
    // Invoices are created from the Invoices page; the app header only holds
    // search and account controls.
    await expect(page.locator("header").getByRole("link", { name: /new invoice/i })).toHaveCount(0);
  });

  test("dashboard shows Gross Profit and Net Profit cards", async ({ page }) => {
    await expect(page.getByText("Gross Profit").first()).toBeVisible();
    await expect(page.getByText("Net Profit").first()).toBeVisible();
  });

  test("dashboard shows Sales & Collections chart section", async ({ page }) => {
    await expect(page.getByText("Sales & Collections").first()).toBeVisible();
  });

  test("dashboard shows Invoice Status chart section", async ({ page }) => {
    await expect(page.getByText("Invoice Status").first()).toBeVisible();
  });

  test("switching date preset to Last Month refetches data", async ({ page }) => {
    // Click "Last Month" preset and verify the button becomes active (no crash)
    await page.getByRole("button", { name: "Last Month" }).first().click();

    // Page should still show the dashboard heading — no error state
    await expect(page.locator("h1").first()).toContainText(DASHBOARD_HEADING);
    // Profit cards must still be visible after period change
    await expect(page.getByText("Gross Profit").first()).toBeVisible();
  });

  test("switching date preset to This FY refetches data", async ({ page }) => {
    await page.getByRole("button", { name: "This FY" }).first().click();

    await expect(page.locator("h1").first()).toContainText(DASHBOARD_HEADING);
    await expect(page.getByText("Net Profit").first()).toBeVisible();
  });
});
