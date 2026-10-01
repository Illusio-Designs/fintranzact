/**
 * J1 — Sign-up & onboarding, as a new customer does it in the browser.
 *
 *   A. Password sign-up: /register → plan selection (Forever Free) → the
 *      "Set up your business" wizard with a GSTIN (pincode fills city/state,
 *      GSTIN fills PAN and the state code) → dashboard. Then sign out, a wrong
 *      password is refused, and the right one lands the owner on the dashboard.
 *   B. Magic-link sign-up (dark theme): "Email me a sign-in link" for a new
 *      address → open the emailed link → complete profile → onboarding (the
 *      organisation already starts on Forever Free, so no plan step)
 *      (owner without a business lands there) → an unregistered business.
 *      The spent link and an expired link are both refused; a fresh link signs
 *      the now-established owner straight into the dashboard.
 *
 * Emails: the API runs without RESEND_API_KEY, so links go to the dev console
 * mailer and the API stores only a hash. The journey reads "the email" by
 * re-keying the newest token row for the address (db.claimLatestMagicLink).
 * Turnstile is stubbed at the network layer; nothing external is called.
 */
import type { Page } from "@playwright/test";
import {
  test,
  expect,
  expectNoHorizontalScroll,
  expectTheme,
  signOut,
  uid,
} from "../../helpers/journey";
import {
  businessesCreatedBy,
  claimLatestMagicLink,
  expireMagicLinkToken,
  magicLinkTokens,
  membershipsOf,
  userByEmail,
} from "../../helpers/db";

const PASSWORD = "Journey@1234";
const DASHBOARD_HEADING = /Good (morning|afternoon|evening)/;

async function choosePlan(page: Page, planName: RegExp) {
  await expect(page).toHaveURL(/\/auth\/plan-selection/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Select the plan that fits your business" })).toBeVisible();
  await expectNoHorizontalScroll(page, "plan selection");
  await page.getByRole("button", { name: planName }).first().click();
  await page.getByRole("button", { name: "Continue to dashboard" }).click();
}

/** The wizard's current step title (the big heading above the fields). */
async function expectStep(page: Page, title: string) {
  await expect(page.locator("form h3").first()).toHaveText(title);
}

type BusinessInput = {
  name: string;
  phone: string;
  address: string;
  pincode: string;
  expectCity: string;
  expectState: string;
  gstin?: string;
  pan?: string;
};

/** Fill the onboarding wizard the way a user does, step by step. */
async function completeBusinessWizard(page: Page, biz: BusinessInput) {
  await expect(page.getByRole("heading", { name: "Set up your business" }).first()).toBeVisible({ timeout: 15_000 });
  await expectNoHorizontalScroll(page, "onboarding: business details");

  await page.getByLabel(/^Business Name/).fill(biz.name);
  await page.getByLabel(/^Phone/).fill(biz.phone);
  await page.getByLabel(/^Address Line 1/).fill(biz.address);
  await page.getByLabel("Pincode").fill(biz.pincode);
  // The PIN lookup fills city, state and country.
  await expect(page.getByText(`Got it! ${biz.expectCity}, ${biz.expectState}`)).toBeVisible();
  await expect(page.getByLabel(/^City/)).toHaveValue(biz.expectCity);
  await expect(page.getByRole("combobox", { name: /^State/ })).toHaveValue(biz.expectState);
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 2 — GST details
  await expectStep(page, "GST details");
  await expectNoHorizontalScroll(page, "onboarding: GST details");
  const regType = page.getByRole("combobox", { name: "GST Registration" });
  if (biz.gstin) {
    await regType.click();
    await page.getByRole("option", { name: "GST Regular" }).click();
    await page.getByLabel("GSTIN").fill(biz.gstin);
    await expect(page.getByText(`PAN detected: ${biz.pan}`)).toBeVisible();
    await expect(page.getByLabel(/^PAN/)).toHaveValue(biz.pan!);
  } else {
    // A new business starts as not GST registered: no GSTIN asked for.
    await expect(regType).toContainText("Not GST Registered");
    await expect(page.getByLabel("GSTIN")).toHaveCount(0);
    await page.getByLabel(/^PAN/).fill(biz.pan!);
  }
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 3 — corporate tax (optional), step 4 — documents & branding (optional)
  await expectStep(page, "Corporate Tax details");
  await expectNoHorizontalScroll(page, "onboarding: corporate tax");
  await page.getByRole("button", { name: "Continue" }).click();
  await expectStep(page, "Documents & branding");
  await expectNoHorizontalScroll(page, "onboarding: documents & branding");
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 5 — review shows what will be created
  await expectStep(page, "Review & create");
  await expectNoHorizontalScroll(page, "onboarding: review");
  const review = page.locator("form");
  await expect(review.getByText(biz.name).first()).toBeVisible();
  if (biz.gstin) await expect(review.getByText(biz.gstin).first()).toBeVisible();
  await page.getByRole("button", { name: "Create business" }).click();
}

/**
 * Signed in with a business: the app asks which company's books to open
 * ("Choose a company", shown even for one company), then opens its dashboard.
 */
async function openCompany(page: Page, businessName: string) {
  await expect(page.getByRole("heading", { name: "Choose a company" })).toBeVisible({ timeout: 20_000 });
  await expectNoHorizontalScroll(page, "choose a company");
  await page.getByRole("button", { name: `Open ${businessName}` }).click();
  await expectDashboard(page, businessName);
}

async function expectDashboard(page: Page, businessName: string) {
  await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });
  await expect(page.locator("h1").first()).toContainText(DASHBOARD_HEADING, { timeout: 20_000 });
  await expect(page.getByTestId("app-sidebar").getByText(businessName).first()).toBeAttached();
  await expectNoHorizontalScroll(page, "dashboard");
}

test.describe("J1 sign-up & onboarding", () => {
  test("password sign-up → plan → business with GSTIN → dashboard; logout; wrong and right password", async ({
    page,
    guard,
  }) => {
    const id = uid();
    const email = `j1-owner-${id}@test.fintranzact.com`;
    const username = `J1 Owner ${id}`;
    const bizName = `J1 Traders ${id}`;
    const gstin = "27AAPFU0939F1ZV";

    // ── Register ────────────────────────────────────────────────
    await page.goto("/register");
    await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
    await expectTheme(page, "light");
    await expectNoHorizontalScroll(page, "register");
    await page.getByLabel("Username").fill(username);
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await expect(page.getByText("Password strength: Strong")).toBeVisible();
    await page.getByLabel("Retype password").fill(PASSWORD);
    await page.locator("form").getByRole("button", { name: "Create free account" }).click();

    // ── Plan (as implemented: Forever Free is self-serve) ───────
    await choosePlan(page, /Forever Free/);

    // ── Owner without a business lands on onboarding ────────────
    await expect(page).toHaveURL(/\/onboarding/, { timeout: 15_000 });
    await completeBusinessWizard(page, {
      name: bizName,
      phone: "9876543210",
      address: "12 Marine Drive",
      pincode: "400001",
      expectCity: "Mumbai",
      expectState: "Maharashtra",
      gstin,
      pan: "AAPFU0939F",
    });

    await openCompany(page, bizName);
    await expectTheme(page, "light");

    // ── Database: user, organisation, plan, business ────────────
    const user = await userByEmail(email);
    expect(user, "user row").toBeTruthy();
    expect(user!.name).toBe(username);
    expect(user!.has_password).toBe(true);
    const orgs = await membershipsOf(user!.id);
    expect(orgs).toHaveLength(1);
    expect(orgs[0]).toMatchObject({ role: "owner", plan: "forever_free" });
    const [biz] = await businessesCreatedBy(user!.id);
    expect(biz).toMatchObject({
      name: bizName,
      gst_registration_type: "regular",
      gstin,
      pan: "AAPFU0939F",
      state: "Maharashtra",
      state_code: "27",
      city: "Mumbai",
      pincode: "400001",
      address_line_1: "12 Marine Drive",
      country_of_operations: "India",
    });
    expect(biz.phone).toContain("9876543210");

    // ── Sign out, wrong password, right password ────────────────
    await signOut(page);
    await expectNoHorizontalScroll(page, "login");
    guard.allow(/status of 401 .*auth\.login/); // the refused login below is a 401 by design
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password", { exact: true }).fill("Wrong@12345");
    await page.locator("form").getByRole("button", { name: "Log in" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Invalid email or password" })).toBeVisible();
    await expect(page).toHaveURL(/\/login/);

    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.locator("form").getByRole("button", { name: "Log in" }).click();
    // Owner with a business: pick the company, then its dashboard.
    await openCompany(page, bizName);

    // Signed in, the auth pages bounce back into the app.
    await page.goto("/login");
    await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
  });
});

test.describe("J1 sign-up by magic link (dark theme)", () => {
  test.use({ theme: "dark" });

  test("magic-link sign-up → profile → onboarding (unregistered); spent and expired links refused", async ({
    page,
    guard,
  }) => {
    const id = uid();
    const email = `j1-magic-${id}@test.fintranzact.com`;
    const name = `Meera ${id}`;
    const bizName = `J1 Kirana ${id}`;

    // ── Ask for a sign-in link with a brand-new address ─────────
    await page.goto("/login");
    await expectNoHorizontalScroll(page, "login");
    await page.getByLabel("Email address").fill(email);
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await expect(page.getByRole("status").filter({ hasText: "We sent a sign-in link to" })).toContainText(email);
    await expect(page.getByRole("button", { name: /Resend link in \d+s/ })).toBeDisabled();

    const [issued] = await magicLinkTokens(email);
    expect(issued, "magic link row").toBeTruthy();
    expect(issued.used_at).toBeNull();
    // Valid for 15 minutes from issue.
    expect(Math.abs(issued.expires_at.getTime() - issued.created_at.getTime() - 15 * 60_000)).toBeLessThan(5_000);
    expect(await userByEmail(email), "no account until the link is opened").toBeUndefined();

    // ── Open the emailed link ───────────────────────────────────
    const link = await claimLatestMagicLink(email);
    await page.goto(`/auth/verify?token=${encodeURIComponent(link)}`);

    // First sign-in: tell us your name
    await expect(page.getByRole("heading", { name: "Welcome to Fintranzact" })).toBeVisible({ timeout: 15_000 });
    await expectTheme(page, "dark");
    await expectNoHorizontalScroll(page, "complete profile");
    await page.getByLabel("Your name").fill(name);
    await page.getByRole("button", { name: "Continue" }).click();

    // As implemented, a magic-link sign-up's organisation starts on Forever
    // Free, so there is no plan step: the owner goes straight to onboarding.
    await expect(page).toHaveURL(/\/onboarding/, { timeout: 15_000 });
    await expectTheme(page, "dark");

    const user = await userByEmail(email);
    expect(user).toMatchObject({ name, email_verified: true, has_password: false });
    const [spent] = await magicLinkTokens(email);
    expect(spent.used_at, "link is single-use").not.toBeNull();

    // ── Business without GST: state code follows the chosen state ─
    await completeBusinessWizard(page, {
      name: bizName,
      phone: "9123456780",
      address: "4 Residency Road",
      pincode: "560001",
      expectCity: "Bengaluru",
      expectState: "Karnataka",
      pan: "ABCPM1234K",
    });
    await openCompany(page, bizName);
    await expectTheme(page, "dark");

    const [biz] = await businessesCreatedBy(user!.id);
    expect(biz).toMatchObject({
      name: bizName,
      gst_registration_type: "unregistered",
      gstin: null,
      pan: "ABCPM1234K",
      state: "Karnataka",
      state_code: "29",
    });
    const orgs = await membershipsOf(user!.id);
    expect(orgs).toEqual([expect.objectContaining({ role: "owner", plan: "forever_free" })]);

    // ── Spent link: refused ─────────────────────────────────────
    await signOut(page);
    guard.allow(/status of 400 .*auth\.verifyMagicLink/); // spent / expired links are refused with a 400
    await page.goto(`/auth/verify?token=${encodeURIComponent(link)}`);
    await expect(page.getByRole("heading", { name: "Link expired or invalid" })).toBeVisible({ timeout: 15_000 });
    await expectNoHorizontalScroll(page, "verify: spent link");
    await page.getByRole("button", { name: "Back to sign in" }).click();
    await expect(page).toHaveURL(/\/login/);

    // ── Expired link: refused ───────────────────────────────────
    await page.getByLabel("Email address").fill(email);
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await expect(page.getByRole("status").filter({ hasText: "We sent a sign-in link to" })).toBeVisible();
    const expired = await claimLatestMagicLink(email);
    await expireMagicLinkToken(expired);
    await page.goto(`/auth/verify?token=${encodeURIComponent(expired)}`);
    await expect(page.getByRole("heading", { name: "Link expired or invalid" })).toBeVisible({ timeout: 15_000 });

    // ── A fresh link signs the owner straight into the dashboard ─
    await page.goto("/login");
    await page.getByLabel("Email address").fill(email);
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await expect(page.getByRole("status").filter({ hasText: "We sent a sign-in link to" })).toBeVisible();
    const fresh = await claimLatestMagicLink(email);
    await page.goto(`/auth/verify?token=${encodeURIComponent(fresh)}`);
    await openCompany(page, bizName);
  });
});
