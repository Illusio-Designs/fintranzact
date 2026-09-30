/**
 * login-negative.spec.ts — Login page error handling and validation.
 *
 * Tests negative paths: wrong credentials, validation errors, and
 * unauthenticated redirects. These tests use fresh browser contexts
 * WITHOUT storageState to simulate unauthenticated users.
 */
import { test, expect } from "../helpers/fixtures";
import { openLoginForm, openRegisterForm, fillRegisterForm } from "../helpers/auth";

test.describe("Login Negative Paths", () => {
  test("login page shows the Log in form with a Register tab", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();

    await page.goto("/login");

    // Should show Fintranzact branding
    await expect(page.getByText("Fintranzact").first()).toBeVisible();

    await expect(page.getByRole("tab", { name: "Register" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Log in" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByPlaceholder("you@yourcompany.com")).toBeVisible();
    await expect(page.getByPlaceholder("Enter password")).toBeVisible();
    await expect(page.locator("form").getByRole("button", { name: "Log in" })).toBeVisible();

    await page.close();
    await ctx.close();
  });

  test("the Register tab opens the sign-up form", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();

    await page.goto("/login");
    await page.getByRole("tab", { name: "Register" }).click();

    await expect(page).toHaveURL(/\/register/);
    await expect(page.getByText("Create your account")).toBeVisible();
    await expect(page.getByPlaceholder("Enter username")).toBeVisible();
    await expect(page.getByPlaceholder("Retype password")).toBeVisible();

    await page.close();
    await ctx.close();
  });

  test("wrong password shows error message", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();

    await openLoginForm(page);

    await page.getByPlaceholder("you@yourcompany.com").fill("nonexistent-user@test.fintranzact.com");
    await page.getByPlaceholder("Enter password").fill("WrongPassword123!");
    await page.locator("form").getByRole("button", { name: "Log in" }).click();

    // Either an error toast or inline error should appear
    await expect(
      page.getByText(/invalid|error|incorrect|wrong|not found|failed/i).first(),
    ).toBeVisible({ timeout: 5_000 });

    await page.close();
    await ctx.close();
  });

  test("register with mismatched passwords shows error", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();

    await openRegisterForm(page);
    await fillRegisterForm(page, {
      username: "Test User",
      email: `mismatch-${Date.now()}@test.fintranzact.com`,
      password: "Test@1234!",
      confirmPassword: "DifferentPass123!",
    });

    await expect(page.getByText(/passwords don't match/i)).toBeVisible({ timeout: 5_000 });

    await page.close();
    await ctx.close();
  });

  test("unauthenticated user visiting /invoices is redirected to /login", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();

    await page.goto("/invoices");
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });

    await page.close();
    await ctx.close();
  });

  test("unauthenticated user visiting /parties is redirected to /login", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();

    await page.goto("/parties");
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });

    await page.close();
    await ctx.close();
  });
});
