/**
 * Login-page helpers shared by the auth setup and flow specs.
 *
 * Sign-up lives at /register and sign-in at /login; both pages show
 * "Register" / "Log in" tabs (links with role="tab"). Register asks for a
 * username, optional referral code, email, password and a retyped password,
 * and submits with "Start free trial"; Log in asks for email + password
 * and submits with "Log in".
 *
 * Both submit through a Cloudflare Turnstile check. The script is replaced with
 * a stub that passes immediately, so the suite doesn't depend on reaching
 * Cloudflare; the API accepts any token when TURNSTILE_SECRET_KEY is unset
 * outside production.
 */
import { expect, type Page } from "@playwright/test";

const TURNSTILE_STUB = `window.turnstile = {
  render: function (_el, opts) { setTimeout(function () { opts.callback("e2e-turnstile-token"); }, 0); return "e2e"; },
  reset: function () {},
  remove: function () {},
};`;

export async function stubTurnstile(page: Page) {
  await page.route("https://challenges.cloudflare.com/turnstile/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/javascript", body: TURNSTILE_STUB }),
  );
}

export async function openRegisterForm(page: Page) {
  await stubTurnstile(page);
  await page.goto("/register");
  await expect(page.getByText("Create your account")).toBeVisible();
}

export async function openLoginForm(page: Page) {
  await stubTurnstile(page);
  await page.goto("/login");
  await expect(page.getByPlaceholder("Enter password")).toBeVisible();
}

/**
 * A valid Indian mobile number for the sign-up form (required there). Random so
 * runs do not collide; the e2e server runs with TRIAL_CLAIMS=off, so reusing a
 * number would not block a trial anyway.
 */
export function e2ePhone(): string {
  return `9${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
}

export async function fillRegisterForm(
  page: Page,
  user: { username: string; email: string; password: string; confirmPassword?: string; phone?: string },
) {
  await page.getByPlaceholder("Enter username").fill(user.username);
  await page.getByPlaceholder("you@yourcompany.com").fill(user.email);
  await page.getByLabel("Mobile number").fill(user.phone ?? e2ePhone());
  await page.getByPlaceholder("Min 8 characters").fill(user.password);
  await page.getByPlaceholder("Retype password").fill(user.confirmPassword ?? user.password);
  await page.locator("form").getByRole("button", { name: "Start free trial" }).click();
}

/** Registers a new user through the UI and waits until the app leaves the auth pages. */
export async function registerViaUI(
  page: Page,
  user: { username: string; email: string; password: string; phone?: string },
) {
  await openRegisterForm(page);
  await fillRegisterForm(page, user);
  await expect(page).not.toHaveURL(/\/(login|register)/, { timeout: 15_000 });
}
