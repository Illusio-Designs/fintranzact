/**
 * J14 — A partner, from the public page to their first referral.
 *
 *   /partners → "Apply as a reseller" → /partners/apply: the form, sent
 *   through the Turnstile check → "Partner login" → they create an account
 *   with the address they applied with → the partner portal says the application is
 *   being reviewed → a platform admin approves it in /platform (another
 *   browser) → the portal shows the referral code and the sign-up link
 *   (/register?ref=FTZ-…) → a new business owner opens that link in a fresh
 *   browser, the code is already filled in, signs up and starts a trial on the default plan (Growth) →
 *   the partner's portal (and the admin's panel) list the new organisation.
 *   The portal is also checked in the dark theme.
 *
 * External services: none. Turnstile is replaced by a stub that passes and
 * the API runs without TURNSTILE_SECRET_KEY (its test mode). The partner
 * signs up with the register form, as J1 does. Approving the partner
 * needs the platform admin's credentials (helpers/admin.ts); the journey is
 * skipped without them.
 */
import {
  test,
  expect,
  expectNoHorizontalScroll,
  expectTheme,
  isPhone,
  newJourneyContext,
  toast,
  uid,
} from "../../helpers/journey";
import { dialog, listRow } from "../../helpers/journey-ui";
import { adminSection, hasPlatformAdmin, NO_ADMIN_REASON, signInAsPlatformAdmin } from "../../helpers/admin";
import { membershipsOf, userByEmail } from "../../helpers/db";
import { partnerByEmail, tenantsReferredBy } from "../../helpers/settings-db";

test.describe("J14 partner", () => {
  test.setTimeout(300_000);
  test.skip(!hasPlatformAdmin, NO_ADMIN_REASON);

  test("apply → admin approves → partner portal & referral link → a new organisation signs up with it", async ({
    page,
    browser,
    guard,
  }) => {
    const id = uid();
    const email = `j14-partner-${id}@test.fintranzact.com`;
    const company = `Shah Tally Solutions ${id}`;

    // ── The public partner page and the application ─────────────
    await page.goto("/partners");
    await expect(page.getByRole("heading", { name: "Grow your practice with Fintranzact", level: 1 })).toBeVisible();
    await expectTheme(page, "light");
    await expectNoHorizontalScroll(page, "/partners");
    await page.getByRole("link", { name: "Apply as a reseller" }).click();
    await expect(page).toHaveURL(/\/partners\/apply/);
    const form = page.getByRole("form", { name: "Partner application" });
    await expect(form.getByRole("combobox", { name: /^Partner programme/ })).toContainText("Resellers");
    await form.getByRole("textbox", { name: /^Name/ }).fill("Nikhil Shah");
    await form.getByRole("textbox", { name: /^Company or firm/ }).fill(company);
    await form.getByRole("textbox", { name: /^Email/ }).fill(email);
    await form.getByRole("textbox", { name: "Phone" }).fill("9824012345");
    await form.getByRole("textbox", { name: /^City/ }).fill("Ahmedabad");
    await form.getByRole("textbox", { name: "Website" }).fill("shahtally.example.in");
    await form.getByRole("combobox", { name: "Clients you serve" }).click();
    await page.getByRole("option").nth(2).click();
    await form.getByRole("textbox", { name: "Tell us about your work" }).fill("Tally implementer for 60 traders in Gujarat.");
    await expectNoHorizontalScroll(page, "/partners/apply");
    await form.getByRole("button", { name: "Send application" }).click();
    await expect(page.getByRole("heading", { name: "Application received" })).toBeVisible();
    await expect(page.getByText(`get back to you at ${email}`)).toBeVisible();
    const applied = await partnerByEmail(email);
    expect(applied).toMatchObject({
      status: "pending",
      referral_code: null,
      partner_type: "reseller",
      company_name: company,
      contact_name: "Nikhil Shah",
      city: "Ahmedabad",
      website: "shahtally.example.in",
      message: "Tally implementer for 60 traders in Gujarat.",
      list_publicly: true,
    });
    expect(applied!.phone).toContain("9824012345");
    expect(applied!.client_count).not.toBeNull();

    // ── Partner login → create an account with the address they applied with ──
    await page.goto("/partners");
    await page.getByRole("link", { name: "Partner login →" }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/register");
    await page.getByLabel("Username").fill("Nikhil Shah");
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password", { exact: true }).fill("Partner@12345");
    await page.getByLabel("Retype password").fill("Partner@12345");
    await page.locator("form").getByRole("button", { name: "Start free trial" }).click();
    // A partner with no business of their own is taken to their portal.
    await expect(page).toHaveURL(/\/partner-portal/, { timeout: 20_000 });
    await expect(page.getByText("Your application is being reviewed")).toBeVisible();
    // Until approval verifies the email, the firm's details stay hidden.
    await expect(page.getByText(company)).toHaveCount(0);
    await expectNoHorizontalScroll(page, "partner portal (pending)");
    expect(await userByEmail(email)).toMatchObject({ name: "Nikhil Shah", has_password: true, email_verified: false });

    // ── A platform admin approves it ────────────────────────────
    const adminContext = await newJourneyContext(browser, guard, { viewport: page.viewportSize()!, hasTouch: isPhone(page) });
    const admin = await adminContext.newPage();
    await signInAsPlatformAdmin(admin);
    await adminSection(admin, "Partners");
    await admin.getByRole("searchbox", { name: "Search partners" }).fill(id);
    await listRow(admin, company).click();
    const panel = dialog(admin, company);
    await panel.getByRole("button", { name: "Approve" }).click();
    await expect(toast(admin, "Partner approved")).toBeVisible();
    const approved = await partnerByEmail(email);
    expect(approved!.status).toBe("approved");
    // Approval verifies the partner's email.
    expect(await userByEmail(email)).toMatchObject({ email_verified: true });
    const code = approved!.referral_code!;
    expect(code).toMatch(/^FTZ-[A-Z0-9]{4,}$/);

    // ── The partner's portal: code and sign-up link ─────────────
    await page.reload();
    await expect(page.getByText("Your referral code")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(code, { exact: true })).toBeVisible();
    const referralLink = page.getByText(new RegExp(`/register\\?ref=${code}$`));
    await expect(referralLink).toBeVisible();
    const link = (await referralLink.innerText()).trim();
    expect(link).toMatch(new RegExp(`^https?://[^/]+/register\\?ref=${code}$`));
    await expect(page.getByText("Nobody has signed up with your code yet.")).toBeVisible();
    await expectNoHorizontalScroll(page, "partner portal (approved)");

    // ── A new business owner signs up through the link ──────────
    const ownerName = `J14 Referred ${id}`;
    const ownerEmail = `j14-referred-${id}@test.fintranzact.com`;
    const newcomer = await newJourneyContext(browser, guard, { viewport: page.viewportSize()!, hasTouch: isPhone(page) });
    const signup = await newcomer.newPage();
    await signup.goto(link);
    await expect(signup.getByLabel(/^Referral code/)).toHaveValue(code);
    await signup.getByPlaceholder("Enter username").fill(ownerName);
    await signup.getByPlaceholder("you@yourcompany.com").fill(ownerEmail);
    await signup.getByPlaceholder("Min 8 characters").fill("Referred@12345");
    await signup.getByPlaceholder("Retype password").fill("Referred@12345");
    await expectNoHorizontalScroll(signup, "register with referral");
    await signup.locator("form").getByRole("button", { name: "Start free trial" }).click();
    await expect(signup.getByRole("heading", { name: "Select the plan that fits your business" })).toBeVisible({ timeout: 20_000 });
    await signup.getByRole("button", { name: "Start 14-day free trial" }).click();
    await expect(signup).not.toHaveURL(/plan-selection/, { timeout: 20_000 });
    const owner = await userByEmail(ownerEmail);
    const [membership] = await membershipsOf(owner!.id);
    expect(membership).toMatchObject({ role: "owner", plan: "growth" });
    expect(await tenantsReferredBy(approved!.id)).toEqual([{ id: membership.tenant_id, name: membership.tenant_name, plan: "growth" }]);
    await newcomer.close();

    // ── The portal lists the referral ───────────────────────────
    await page.reload();
    const referrals = page.getByRole("heading", { name: "Your referrals" }).locator("xpath=..");
    await expect(referrals).toContainText(membership.tenant_name);
    await expect(page.getByText("Nobody has signed up with your code yet.")).toHaveCount(0);
    await expect(page.getByText("Businesses referred", { exact: true }).locator("xpath=following-sibling::p[1]")).toHaveText("1");

    // …and so does the admin's panel.
    await admin.reload();
    await adminSection(admin, "Partners");
    await admin.getByRole("button", { name: /^Approved/ }).click();
    await admin.getByRole("searchbox", { name: "Search partners" }).fill(id);
    await listRow(admin, company).click();
    await expect(dialog(admin, company).getByRole("heading", { name: "Referred organisations · 1" })).toBeVisible();
    await expect(dialog(admin, company)).toContainText(membership.tenant_name);
    await adminContext.close();

    // ── The portal at night ─────────────────────────────────────
    const night = await newJourneyContext(browser, guard, {
      theme: "dark",
      storageState: await page.context().storageState(),
      viewport: page.viewportSize()!,
      hasTouch: isPhone(page),
    });
    const nightPage = await night.newPage();
    await nightPage.goto("/partner-portal");
    await expect(nightPage.getByText(code, { exact: true })).toBeVisible({ timeout: 20_000 });
    await expectTheme(nightPage, "dark");
    await expectNoHorizontalScroll(nightPage, "partner portal (dark)");
    await night.close();
  });
});
