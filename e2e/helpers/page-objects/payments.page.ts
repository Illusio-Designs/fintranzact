/**
 * payments.page.ts — Page object for /payments route.
 */
import { type Page, type Locator, expect } from "@playwright/test";
import { BasePage } from "./base.page";

export class PaymentsPage extends BasePage {
  readonly searchInput: Locator;
  readonly tableRows: Locator;
  readonly detailPanel: Locator;
  readonly dateRangeBar: Locator;

  constructor(page: Page) {
    super(page);
    this.searchInput = page.getByPlaceholder(/search/i);
    this.tableRows = page.locator("tbody tr");
    this.detailPanel = page.locator('[role="dialog"]').first();
    this.dateRangeBar = page.getByRole("button", { name: /this month|last month|this quarter|custom/i }).first();
  }

  async goto() {
    await super.goto("/payments");
  }

  // ── Presence ─────────────────────────────────────────────────

  async expectPageHeader() {
    await expect(this.pageHeader).toContainText("Payments");
  }

  async expectSearchInput() {
    await expect(this.searchInput).toBeVisible();
  }

  async expectDatePresets() {
    // One date button shows the period and opens the presets.
    const dateBtn = this.page.getByRole("button", { name: /^Date range:/ }).first();
    await expect(dateBtn).toContainText("This Month");
    await dateBtn.click();
    await expect(this.page.getByRole("menuitemradio", { name: "Last Month" })).toBeVisible();
    await this.page.keyboard.press("Escape");
  }

  /** Pick a period from the date menu. */
  async chooseDate(label: string) {
    await this.page.getByRole("button", { name: /^Date range:/ }).first().click();
    await this.page.getByRole("menuitemradio", { name: label }).click();
    await expect(this.page.getByRole("button", { name: /^Date range:/ }).first()).toContainText(label);
  }

  async expectRecordButton() {
    await expect(this.page.getByRole("button", { name: /record payment/i }).first()).toBeVisible();
  }

  async expectDateRangeBar() {
    await expect(this.dateRangeBar).toBeVisible();
  }

  async expectTableColumns() {
    // Only assert table columns when the table actually renders (not empty state)
    const hasTable = await this.page.locator("thead").count() > 0;
    if (!hasTable) return;

    const headers = ["Payment", "Date", "Party", "Amount"];
    for (const h of headers) {
      await expect(
        this.page.locator("thead").getByText(h, { exact: false }).first(),
      ).toBeVisible();
    }
  }

  // ── Interaction ──────────────────────────────────────────────

  async searchPayments(query: string) {
    await this.searchInput.fill(query);
    await this.waitForTrpcResponse();
  }

  async clickRow(index = 0) {
    await this.tableRows.nth(index).click();
  }

  async rowCount(): Promise<number> {
    return this.tableRows.count();
  }

  async expectDetailPanelOpen() {
    await expect(this.detailPanel).toBeVisible({ timeout: 5_000 });
  }

  async clickTypeTab(label: string) {
    // The page itself, not a sidebar link with the same name (closed sidebar groups keep theirs in the DOM).
    await this.page.getByTestId("app-content").getByText(label).first().click();
  }
}
