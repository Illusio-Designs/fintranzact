/**
 * reports.spec.ts — Layer 1 (Presence) specification for /reports.
 *
 * The Reports page is a Reports Centre: categories on the left (Favourites
 * and Recently viewed first), the selected category's reports on the right,
 * and "Go to a report" to find any report by name. A report opens at
 * /reports?report=<id> with a trail back.
 */
import { test, expect, waitForPageReady } from "../helpers/fixtures";

// ═════════════════════════════════════════════════════════════════
// Layer 1: PRESENCE
// ═════════════════════════════════════════════════════════════════

test.describe("Reports — Presence", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/reports");
    await waitForPageReady(page);
  });

  test("renders the report categories", async ({ page }) => {
    const rail = page.getByRole("navigation", { name: "Report categories" });
    for (const group of ["Favourites", "Recently viewed", "Business overview", "Receivables", "Inventory", "Accountant"]) {
      await expect(rail.getByRole("button", { name: new RegExp(`^${group}`) })).toBeVisible({ timeout: 10_000 });
    }
  });

  test("lists the favourite reports first", async ({ page }) => {
    for (const report of ["Outstanding Report", "Profit & Loss", "Sales Register"]) {
      await expect(page.getByRole("button", { name: report, exact: true })).toBeVisible();
    }
  });

  test("finds and opens a report with Go to a report", async ({ page }) => {
    await page.getByRole("searchbox", { name: "Go to a report" }).fill("daybook");
    await page.getByRole("button", { name: "Daybook", exact: true }).click();
    await expect(page).toHaveURL(/report=daybook/);
    await expect(page.getByRole("heading", { name: "Daybook", level: 1 })).toBeVisible();
    await page.getByRole("navigation", { name: "Where you are" }).getByRole("button", { name: "Reports" }).click();
    await expect(page.getByRole("heading", { name: "Reports", level: 1 })).toBeVisible();
  });
});
