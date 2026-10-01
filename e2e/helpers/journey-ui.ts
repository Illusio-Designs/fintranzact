/**
 * journey-ui.ts — Small UI steps the purchase and inventory journeys share:
 * opening the business, a sidebar page, picking from the app's comboboxes,
 * filling document lines and choosing dates the way a user does.
 */
import type { Locator, Page } from "@playwright/test";
import { expect, expectNoHorizontalScroll, isPhone, navTo } from "./journey";
import type { SeededOwner } from "./journey-seed";

/** ₹ amount the way the app prints it (en-IN grouping, two decimals). */
export function inr(n: number) {
  const sign = n < 0 ? "-" : "";
  return `${sign}₹${Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function escapeRe(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function startsWith(text: string) {
  return new RegExp(`^${escapeRe(text)}`);
}

/** Pick the seeded business on the company chooser. */
export async function openBusiness(page: Page, owner: SeededOwner) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Choose a company" })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: `Open ${owner.businessName}` }).click();
  await expect(page.getByTestId("app-sidebar")).toBeAttached({ timeout: 20_000 });
}

/** A sidebar page, its heading, and (on a phone) no sideways scroll. */
export async function openPage(page: Page, label: string, heading: string | RegExp = label) {
  await navTo(page, label);
  await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
  await expectNoHorizontalScroll(page, label);
}

/** Pick `search` in a searchable combobox (party, item, invoice pickers). */
export async function pick(page: Page, combobox: Locator, search: string, option: RegExp = startsWith(search)) {
  await combobox.click();
  await combobox.fill(search);
  // Not the "Create …" entry the picker offers for new names.
  await page.getByRole("option", { name: option }).first().click();
  await expect(combobox).toHaveValue(search);
}

/** Choose `label` in one of the app's dropdowns (a combobox with a listbox). */
export async function choose(page: Page, combobox: Locator, label: string | RegExp) {
  await combobox.click();
  await page.getByRole("option", { name: label, exact: typeof label === "string" }).click();
}

export type LineInput = { item: string; qty: string; free?: string; price?: string };

/** Fill line `index` of a document form, adding the line when needed. */
export async function fillLine(page: Page, form: Locator, index: number, line: LineInput) {
  const lines = form.getByTestId("document-line");
  if ((await lines.count()) <= index) await form.getByRole("button", { name: "+ Add line item" }).click();
  const row = lines.nth(index);
  await pick(page, row.getByPlaceholder("Select product or custom item"), line.item);
  await row.getByLabel(/^(Quantity|Accepted quantity)$/).fill(line.qty);
  if (line.free) await row.getByLabel("Free quantity").fill(line.free);
  if (line.price) await row.getByLabel("Unit price").fill(line.price);
}

/** A row of a list page's table, by the text it shows. */
export function listRow(page: Page, text: string) {
  return page.getByRole("row").filter({ hasText: text });
}

/** A side panel or dialog by its title. */
export function dialog(page: Page, title: string | RegExp) {
  return page.getByRole("dialog", { name: title });
}

/** ISO date `months` months from today (the day capped at 28), as the calendar's PageDown steps it. */
export function isoMonthsAhead(months: number, from = new Date()) {
  const d = new Date(from.getFullYear(), from.getMonth() + months, Math.min(from.getDate(), 28));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Choose a date `months` months from today in one of the app's date pickers,
 * by keyboard: open the calendar, PageDown a month at a time (PageUp for a
 * negative `months`, a date in the past), Enter.
 */
export async function pickDateMonthsAhead(page: Page, trigger: Locator, months: number) {
  await trigger.click();
  await expect(page.getByRole("dialog", { name: "Choose date" })).toBeVisible();
  // Each PageDown / PageUp moves a month from the focused day (today when empty).
  for (let i = 0; i < Math.abs(months); i++) await trigger.press(months < 0 ? "PageUp" : "PageDown");
  await trigger.press("Enter");
  await expect(page.getByRole("dialog", { name: "Choose date" })).toBeHidden();
}

/** Close a side panel by its close button. */
export async function closePanel(panel: Locator) {
  await panel.getByRole("button", { name: "Close", exact: true }).click();
  await expect(panel).toBeHidden();
}

export { isPhone };
