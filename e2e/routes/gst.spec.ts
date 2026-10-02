/**
 * gst.spec.ts — Layer 1 (Presence) specification for /gst.
 *
 * The GST / Tax Reports page adapts its title and tab labels based on whether
 * the active business is GST-registered:
 *   - GST-registered  → title "GST Returns", first tab "GSTR-1"
 *   - Unregistered    → title "Tax Reports",  first tab "Sales Report"
 *
 * The global setup seeds a business with gstin "27AABCU9603R1ZM" so the
 * GST-registered variant is expected.
 *
 * Profit & Loss, Trial Balance, Balance Sheet, Ageing Report, Party Ledger
 * and Tally Export live in Reports; this page links there.
 *
 * Period selector (month + year dropdowns) is visible when the GSTR-1 or
 * GSTR-3B tab is active (which is the default).
 */
import { test, expect, waitForPageReady } from "../helpers/fixtures";

// ═════════════════════════════════════════════════════════════════
// Layer 1: PRESENCE
// ═════════════════════════════════════════════════════════════════

test.describe("GST / Tax Reports — Presence", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/gst");
    await waitForPageReady(page);
  });

  test("renders page header", async ({ page }) => {
    // GST-registered business → "GST Returns"; fallback accepts either variant
    await expect(page.locator("h1").first()).toContainText(
      /GST Returns|Tax Reports/i,
    );
  });

  test("renders GSTR-1 tab for GST-registered business", async ({ page }) => {
    // The seeded business has a GSTIN, so the first tab must be "GSTR-1"
    await expect(page.getByText("GSTR-1").first()).toBeVisible();
  });

  test("renders the GST return tabs and points to Reports for the statements", async ({ page }) => {
    const tabs = page.getByTestId("gst-report-tabs");
    for (const tab of ["GSTR-3B", "GSTR-9"]) {
      await expect(tabs.getByRole("button", { name: tab })).toBeVisible();
    }
    // P&L, trial balance and the rest moved to Reports
    await expect(tabs.getByRole("button", { name: "Profit & Loss" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Reports" })).toHaveAttribute("href", /\/reports\?report=pnl/);
  });

  test("renders period selector with current year", async ({ page }) => {
    // Month + year <select> elements are shown for GSTR-1 / GSTR-3B (default tab)
    const currentYear = new Date().getFullYear().toString();
    // The year picker is the custom Select (a combobox button carrying its value)
    await expect(page.locator(`[role="combobox"][data-value="${currentYear}"]`).first()).toBeAttached();
  });
});
