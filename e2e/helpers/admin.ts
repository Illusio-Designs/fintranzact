/**
 * admin.ts — The platform admin account for the J13 / J14 journeys.
 *
 * The API makes the account named by PLATFORM_ADMIN_EMAIL /
 * PLATFORM_ADMIN_PASSWORD a platform admin at start-up. The journeys sign in
 * with the same pair, given to Playwright as E2E_PLATFORM_ADMIN_EMAIL /
 * E2E_PLATFORM_ADMIN_PASSWORD (throwaway values for the run, never committed).
 * Without them, the journeys that need an admin are skipped.
 */
import type { Page } from "@playwright/test";
import { expect, isPhone } from "./journey";

export const PLATFORM_ADMIN = {
  email: process.env.E2E_PLATFORM_ADMIN_EMAIL ?? "",
  password: process.env.E2E_PLATFORM_ADMIN_PASSWORD ?? "",
};

export const hasPlatformAdmin = !!(PLATFORM_ADMIN.email && PLATFORM_ADMIN.password);

export const NO_ADMIN_REASON =
  "set E2E_PLATFORM_ADMIN_EMAIL / E2E_PLATFORM_ADMIN_PASSWORD to the API's PLATFORM_ADMIN_EMAIL / PLATFORM_ADMIN_PASSWORD";

/** Sign in on /login as the platform admin; with no organisation, they land on /platform. */
export async function signInAsPlatformAdmin(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("you@yourcompany.com").fill(PLATFORM_ADMIN.email);
  await page.getByPlaceholder("Enter password").fill(PLATFORM_ADMIN.password);
  await page.locator("form").getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/platform/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Platform overview", level: 1 })).toBeVisible();
}

/** A section of the admin's side menu (a drawer on a phone). */
export async function adminSection(page: Page, label: string, heading: string | RegExp = label) {
  const nav = page.getByRole("navigation", { name: "Platform admin" });
  if (isPhone(page)) {
    // As navTo does: a finger lifts off the toasts (they pause under the
    // pointer) and waits for the ones over the menu button to go.
    await page.mouse.move(1, (page.viewportSize()?.height ?? 800) - 1);
    await expect(page.getByLabel(/^Notifications/).locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 15_000 });
    await page.getByRole("button", { name: "Open menu" }).click();
  }
  // (A section's link may carry a count: "Partners 2 waiting for review".)
  await nav.getByRole("link", { name: new RegExp(`^${label}( \\d+ waiting for review)?$`) }).click();
  await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
}
