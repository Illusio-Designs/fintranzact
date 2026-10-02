/**
 * J1 — Sign-up & onboarding, as a new customer does it in the browser.
 *
 *   A. Password sign-up: /register → plan selection: the paid Business plan
 *      → the demo checkout (test mode, paid with the test card) → the
 *      "Set up your business" wizard with a GSTIN (pincode fills city/state,
 *      GSTIN fills PAN and the state code) → dashboard. Then sign out, a wrong
 *      password is refused, and the right one lands the owner on the dashboard.
 *   B. Password sign-up on the free plan (dark theme): /register → plan
 *      selection (Forever Free) → onboarding (owner without a business lands
 *      there) → an unregistered business. Then sign out and log in again with
 *      the password, straight into the dashboard.
 *
 * Turnstile is stubbed at the network layer; nothing external is called.
 * The checkout is the demo one (no gateway, no money): Business is given a
 * listed price for the journey, since by default it is priced on request.
 */
import type { Page } from "@playwright/test";
import {
  API_URL,
  test,
  expect,
  expectNoHorizontalScroll,
  expectTheme,
  signOut,
  uid,
} from "../../helpers/journey";
import {
  businessesCreatedBy,
  membershipsOf,
  offerBusinessPlanAt,
  userByEmail,
  withdrawPlanPrice,
} from "../../helpers/db";

const PASSWORD = "Journey@1234";
const DASHBOARD_HEADING = /Good (morning|afternoon|evening)/;
/** Business at ₹2,499 a month: + 18% GST (₹449.82) = ₹2,948.82. */
const BUSINESS_PRICE_INR = 2499;
const BUSINESS_TOTAL = "₹2,948.82";

async function choosePlan(page: Page, planName: RegExp) {
  await expect(page).toHaveURL(/\/auth\/plan-selection/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Select the plan that fits your business" })).toBeVisible();
  await expectNoHorizontalScroll(page, "plan selection");
  await page.getByRole("button", { name: planName }).first().click();
  await page.getByRole("button", { name: "Create your company" }).click();
}

/** Pick the paid Business plan and pay for it with the test card in the demo checkout. */
async function payForBusinessPlan(page: Page) {
  await expect(page).toHaveURL(/\/auth\/plan-selection/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Select the plan that fits your business" })).toBeVisible();
  await expectNoHorizontalScroll(page, "plan selection");
  await page.getByRole("button", { name: /Business.*₹2,499/ }).first().click();
  await page.getByRole("button", { name: "Continue to payment" }).click();

  const checkout = page.getByRole("dialog", { name: "Pay for Business" });
  await expect(checkout).toBeVisible();
  await expect(checkout.getByText("Test mode — no money is taken")).toBeVisible();
  await expect(checkout.getByTestId("checkout-total")).toHaveText(BUSINESS_TOTAL);
  await expectNoHorizontalScroll(page, "demo checkout");

  await checkout.getByRole("tab", { name: "Card" }).click();
  const pay = checkout.getByRole("button", { name: `Pay ${BUSINESS_TOTAL}` });
  await checkout.getByLabel("Card number").fill("4111111111111112");
  await checkout.getByLabel("Card number").blur();
  await expect(checkout.getByText("Enter a valid card number")).toBeVisible();
  await checkout.getByLabel("Card number").fill("4111111111111111");
  await expect(checkout.getByLabel("Card number")).toHaveValue("4111 1111 1111 1111");
  await checkout.getByLabel("Expiry (MM/YY)").fill("1230");
  await checkout.getByLabel("CVV").fill("123");
  await expect(pay).toBeDisabled(); // no name on the card yet
  await checkout.getByLabel("Name on card").fill("J1 Owner");
  await expectNoHorizontalScroll(page, "demo checkout: card");
  await pay.click();
  await expect(checkout.getByRole("button", { name: "Processing…" })).toBeDisabled();

  await expect(checkout.getByText("Payment successful")).toBeVisible({ timeout: 15_000 });
  await expect(checkout.getByTestId("payment-id")).toHaveText(/^pay_demo_[\w-]{14}$/);
  await checkout.getByRole("button", { name: "Create your company" }).click();
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
  test.beforeEach(async ({ page }) => {
    // Business is priced on request by default; give it a price to pay.
    await offerBusinessPlanAt(BUSINESS_PRICE_INR);
    // The API caches the plan catalogue for up to 30 seconds.
    await expect
      .poll(async () => (await page.request.get(`${API_URL}/api/trpc/plan.list`)).text(), { timeout: 45_000, intervals: [1_000] })
      .toContain(`"monthlyPriceInr":${BUSINESS_PRICE_INR}`);
  });

  test.afterEach(async () => {
    await withdrawPlanPrice("business");
  });

  test("password sign-up → paid plan (demo checkout) → business with GSTIN → dashboard; logout; wrong and right password", async ({
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

    // ── Plan: Business, paid in the demo checkout ───────────────
    await expect(page).toHaveURL(/\/auth\/plan-selection/, { timeout: 15_000 });
    const fresh = await userByEmail(email);
    const [freshOrg] = await membershipsOf(fresh!.id);
    expect(freshOrg, "a new organisation has not chosen a plan").toMatchObject({ plan: "forever_free", plan_selected_at: null });
    await payForBusinessPlan(page);

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
    expect(orgs[0]).toMatchObject({ role: "owner", plan: "business" });
    expect(orgs[0].plan_selected_at, "plan choice recorded").toBeInstanceOf(Date);
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
    await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Invalid email or password" })).toBeVisible();
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

test.describe("J1 sign-up on the free plan (dark theme)", () => {
  test.use({ theme: "dark" });

  test("password sign-up → plan (Forever Free) → onboarding (unregistered business) → dashboard; sign out and log in", async ({
    page,
  }) => {
    const id = uid();
    const email = `j1-free-${id}@test.fintranzact.com`;
    const username = `Meera ${id}`;
    const bizName = `J1 Kirana ${id}`;

    // ── Register with a brand-new address ───────────────────────
    await page.goto("/register");
    await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
    await expectTheme(page, "dark");
    await expectNoHorizontalScroll(page, "register");
    await page.getByLabel("Username").fill(username);
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Retype password").fill(PASSWORD);
    await page.locator("form").getByRole("button", { name: "Create free account" }).click();

    // A new organisation's owner chooses a plan first, however they signed up.
    await choosePlan(page, /Forever Free/);
    await expect(page).toHaveURL(/\/onboarding/, { timeout: 15_000 });
    await expectTheme(page, "dark");

    const user = await userByEmail(email);
    expect(user).toMatchObject({ name: username, has_password: true });

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
    expect(orgs).toEqual([expect.objectContaining({ role: "owner", plan: "forever_free", plan_selected_at: expect.any(Date) })]);

    // ── Sign out, then log in with the password ─────────────────
    await signOut(page);
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.locator("form").getByRole("button", { name: "Log in" }).click();
    await openCompany(page, bizName);
  });
});
