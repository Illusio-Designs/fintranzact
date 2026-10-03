/**
 * J13 — The platform admin's console, as a Fintranzact operator uses it.
 *
 *   Sign in (password, /login) → lands on /platform: Overview counts and the
 *   newest organisations → Organisations: search, open one, see its members
 *   and businesses, move it to Pro → Plans: edit Pro (tagline, a monthly
 *   price instead of "Custom", a team-member limit), see it on the public
 *   pricing page, reset it to the original → Partners: a pending application
 *   (sent from the public form, J14's part — seeded here) is opened, given a
 *   commission and approved (referral code shown) → a payout recorded for the
 *   month and marked paid with a bank reference → Upcoming features: a
 *   feature added, moved to In progress, deleted. An owner who is not an
 *   admin is turned away from /platform. A second window shows the console in
 *   the dark theme.
 *
 * Every change is checked in the database too. Plans are shared by every
 * organisation, so the Pro edit is reset in the journey (and reset first if a
 * failed run left it edited).
 *
 * External services: none. Approving a partner "emails" their code through
 * the dev console mailer (no RESEND_API_KEY); payouts are records only — no
 * payment is made. Needs the platform admin's credentials (see
 * helpers/admin.ts); skipped without them.
 */
import {
  API_URL,
  test,
  expect,
  expectNoHorizontalScroll,
  expectTheme,
  isPhone,
  newJourneyContext,
  toast,
  uid,
} from "../../helpers/journey";
import { seedOwner } from "../../helpers/journey-seed";
import { dialog, istIsoDate, listRow } from "../../helpers/journey-ui";
import { adminSection, hasPlatformAdmin, NO_ADMIN_REASON, signInAsPlatformAdmin } from "../../helpers/admin";
import { db } from "../../helpers/db";
import { partnerByEmail, partnerPayoutsOf, planOverride, roadmapItemsTitled, tenantPlan } from "../../helpers/settings-db";

test.describe("J13 platform admin", () => {
  test.setTimeout(300_000);
  test.skip(!hasPlatformAdmin, NO_ADMIN_REASON);

  test("overview → organisation & plan → plans editor save/reset → partner approve & payout → upcoming features", async ({
    page,
    browser,
    guard,
  }) => {
    // Shared state a failed earlier run may have left: Growth edited.
    await db()`delete from plan_settings where plan = 'growth'`;

    // An organisation to look after (signed up through the API: J1 owns sign-up).
    const ownerContext = await newJourneyContext(browser, guard);
    const owner = await seedOwner(ownerContext, "j13");
    // Not an admin: /platform turns them away.
    const ownerPage = await ownerContext.newPage();
    await ownerPage.goto("/platform");
    await expect(ownerPage.getByText("Platform admin access only")).toBeVisible({ timeout: 20_000 });
    await ownerContext.close();

    // A partner application from the public form (J14 sends it in the UI).
    const id = uid();
    const partnerEmail = `j13-partner-${id}@test.fintranzact.com`;
    const anon = await newJourneyContext(browser, guard);
    const apply = await anon.request.post(`${API_URL}/api/trpc/partner.submitApplication`, {
      headers: { "Content-Type": "application/json", "X-Requested-With": "fintranzact" },
      data: {
        json: {
          contactName: "Kavita Rao",
          companyName: `Rao & Associates ${id}`,
          email: partnerEmail,
          phone: "+919845011122",
          city: "Bengaluru",
          partnerType: "accountant",
          clientCount: "11-50",
          message: "We keep books for 40 small traders.",
          listPublicly: true,
        },
      },
    });
    expect(apply.ok(), await apply.text()).toBe(true);
    await anon.close();

    // ── Sign in ─────────────────────────────────────────────────
    await signInAsPlatformAdmin(page);
    await expectTheme(page, "light");
    await expectNoHorizontalScroll(page, "platform overview");
    const orgCount = Number((await db()`select count(*)::int as n from tenants`)[0].n);
    await expect(page.getByRole("main").getByText("Organisations", { exact: true }).locator("xpath=following-sibling::p[1]")).toHaveText(String(orgCount));
    await expect(page.getByRole("button", { name: new RegExp(`^${owner.name}'s Organization`) }).first()).toBeVisible();

    // ── Organisations: find one, open it, change its plan ───────
    await adminSection(page, "Organisations");
    await page.getByRole("searchbox", { name: "Search organisations" }).fill(owner.email);
    const orgRow = listRow(page, owner.email);
    await expect(orgRow).toHaveCount(1);
    await expect(orgRow).toContainText("Business");
    await expect(orgRow).not.toContainText("Grandfathered");
    await expectNoHorizontalScroll(page, "organisations");
    await orgRow.getByRole("button").first().click();
    const org = dialog(page, `${owner.name}'s Organization`);
    await expect(org.getByRole("heading", { name: "Members · 1" })).toBeVisible();
    await expect(org).toContainText(owner.email);
    await expect(org.getByRole("heading", { name: "Businesses · 1" })).toBeVisible();
    await expect(org).toContainText(owner.businessName);
    await expect(org).toContainText("GSTIN 27AAPFU0939F1ZV");
    await org.getByRole("combobox", { name: "Plan" }).click();
    await page.getByRole("option", { name: "Growth", exact: true }).click();
    await org.getByRole("button", { name: "Save plan" }).click();
    await expect(toast(page, "Plan updated")).toBeVisible();
    await expect.poll(() => tenantPlan(owner.tenantId)).toBe("growth");
    await org.getByRole("button", { name: "Close", exact: true }).click();
    await expect(orgRow).toContainText("Growth");

    // ── Plans: edit Growth, see it on the pricing page, reset it ─
    await adminSection(page, "Plans");
    await expect(page.locator("main").getByText(/^(Starter|Growth|Business)$/)).toHaveCount(3);
    await page.getByRole("button", { name: "Edit plan Growth" }).click();
    const editor = dialog(page, "Edit Growth");
    await editor.getByLabel("Tagline").fill("For growing teams — J13 offer");
    await editor.getByLabel("Monthly price (₹)").fill("1999");
    // Yearly blank means ten months of the monthly price, shown as a hint.
    await editor.getByLabel("Yearly price (₹)").fill("");
    await expect(editor.getByText(/₹19,990 a year, 2 months free/)).toBeVisible();
    // A yearly price above 12 months is flagged, not refused.
    await editor.getByLabel("Yearly price (₹)").fill("30000");
    await expect(editor.getByRole("status")).toContainText("more than 12 months");
    await editor.getByLabel("Yearly price (₹)").fill("19999");
    // Feature flags: enforced ones carry no note; the feature that is not built yet (approvals) and the operational ones say so.
    await expect(editor.getByText("Not built yet: shown on the plan only")).toBeVisible();
    await expect(editor.getByText(/^Operational: the support team sees a badge/).first()).toBeVisible();
    await expect(editor.getByText("Shown on the plan; not enforced yet")).toHaveCount(0);
    await editor.getByRole("checkbox", { name: /^e-invoicing/ }).uncheck();
    await editor.getByLabel("Team members", { exact: true }).fill("25");
    await expectNoHorizontalScroll(page, "plan editor");
    await editor.getByRole("button", { name: "Save plan" }).click();
    await expect(toast(page, "Plan saved")).toBeVisible();
    await expect(editor).toBeHidden();
    expect(await planOverride("growth")).toMatchObject({
      name: "Growth",
      tagline: "For growing teams — J13 offer",
      monthly_price_inr: 1999,
      yearly_price_inr: 19999,
      limits: expect.objectContaining({ maxTeamMembers: 25, eInvoicing: false }),
    });
    const proCard = page.locator("div.rounded-2xl").filter({ has: page.getByRole("button", { name: "Edit plan Growth" }) });
    await expect(proCard).toContainText("₹1,999");
    await expect(proCard).toContainText("Edited");
    await expect(proCard).toContainText("Team members25");
    await expect(proCard).toContainText("₹19,999 /year");

    // The public pricing page reads the same catalogue.
    const visitor = await newJourneyContext(browser, guard, { viewport: page.viewportSize()!, hasTouch: isPhone(page) });
    const pricing = await visitor.newPage();
    await pricing.goto("/pricing");
    await expect(pricing.getByRole("columnheader", { name: /^Growth/ })).toContainText("₹1,999");
    await expect(pricing.getByText("For growing teams — J13 offer").first()).toBeVisible();
    await expectNoHorizontalScroll(pricing, "pricing (edited plan)");

    await page.getByRole("button", { name: "Edit plan Growth" }).click();
    await editor.getByRole("button", { name: "Reset to original" }).click();
    await dialog(page, "Reset Growth?").getByRole("button", { name: "Reset plan" }).click();
    await expect(toast(page, "Plan reset")).toBeVisible();
    await expect(proCard).toContainText("₹699");
    await expect(proCard).not.toContainText("Edited");
    expect(await planOverride("growth")).toBeUndefined();
    await pricing.reload();
    await expect(pricing.getByRole("columnheader", { name: /^Growth/ })).toContainText("₹699");
    await expect(pricing.getByText("For growing teams — J13 offer")).toHaveCount(0);
    await visitor.close();

    // ── Partners: approve the application ───────────────────────
    await adminSection(page, "Partners");
    await page.getByRole("searchbox", { name: "Search partners" }).fill(id);
    const partnerRow = listRow(page, `Rao & Associates ${id}`);
    await expect(partnerRow).toContainText("Pending");
    await expectNoHorizontalScroll(page, "partners");
    await partnerRow.click();
    const partner = dialog(page, `Rao & Associates ${id}`);
    await expect(partner).toContainText("We keep books for 40 small traders.");
    await expect(partner).toContainText(partnerEmail);
    await partner.getByLabel(/^Commission %/).fill("15");
    await partner.getByRole("button", { name: "Approve" }).click();
    await expect(toast(page, "Partner approved")).toBeVisible();
    const approved = await partnerByEmail(partnerEmail);
    expect(approved).toMatchObject({ status: "approved", commission_percent: 15, list_publicly: true, partner_type: "accountant" });
    expect(approved!.referral_code).toMatch(/^FTZ-[A-Z0-9]{4,}$/);
    expect(approved!.reviewed_at).not.toBeNull();
    await expect(partner.getByText(approved!.referral_code!, { exact: true })).toBeVisible();
    await expect(partner).toContainText(`/register?ref=${approved!.referral_code}`);
    await expect(partner).toContainText("Nobody has signed up with this code yet.");

    // ── Payouts: record this month, then mark it paid ───────────
    const month = istIsoDate().slice(0, 7);
    await partner.getByLabel("Month").fill(month);
    await partner.getByLabel("Amount (₹)").fill("1500");
    await partner.getByRole("button", { name: "Record payout" }).click();
    await expect(toast(page, "Payout recorded")).toBeVisible();
    await expect(partner).toContainText(`₹1,500.00 · ${month}`);
    await expect(partner).toContainText("Not paid yet");
    await partner.getByRole("button", { name: "Mark paid" }).click();
    await partner.getByLabel("Payment reference").fill("UTR J13 4455");
    await partner.getByRole("button", { name: "Paid", exact: true }).click();
    await expect(toast(page, "Marked as paid")).toBeVisible();
    await expect(partner).toContainText("UTR J13 4455");
    expect(await partnerPayoutsOf(approved!.id)).toMatchObject([
      { period: month, amount: "1500.00", status: "paid", reference: "UTR J13 4455" },
    ]);
    await expectNoHorizontalScroll(page, "partner panel");
    await partner.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: /^Approved/ }).click();
    await expect(listRow(page, `Rao & Associates ${id}`)).toContainText("Approved");

    // ── Upcoming features ───────────────────────────────────────
    const feature = `J13 bulk payout export ${id}`;
    await adminSection(page, "Upcoming features");
    await page.getByRole("button", { name: "Add feature" }).click();
    const form = dialog(page, "Add feature");
    await form.getByLabel("Title").fill(feature);
    await form.getByLabel("Description").fill("Download a month's partner payouts as a bank upload file.");
    await form.getByLabel("Category").fill("Partners");
    await expectNoHorizontalScroll(page, "add feature");
    await form.getByRole("button", { name: "Add feature" }).click();
    await expect(toast(page, "Feature added")).toBeVisible();
    expect(await roadmapItemsTitled(feature)).toMatchObject([{ category: "Partners" }]);
    await page.getByRole("searchbox", { name: "Search features" }).fill(id);
    const status = page.getByRole("combobox", { name: `Status of ${feature}` });
    await status.click();
    await page.getByRole("option", { name: "In progress", exact: true }).click();
    await expect(toast(page, "Moved to In progress")).toBeVisible();
    expect(await roadmapItemsTitled(feature)).toMatchObject([{ status: "in_progress" }]);
    await page.getByRole("button", { name: feature }).click();
    const item = dialog(page, feature);
    await item.getByRole("button", { name: "Delete" }).click();
    await dialog(page, `Delete “${feature}”?`).getByRole("button", { name: "Delete feature" }).click();
    await expect(toast(page, "Feature deleted")).toBeVisible();
    expect(await roadmapItemsTitled(feature)).toEqual([]);

    // ── The console at night ────────────────────────────────────
    const night = await newJourneyContext(browser, guard, {
      theme: "dark",
      storageState: await page.context().storageState(),
      viewport: page.viewportSize()!,
      hasTouch: isPhone(page),
    });
    const nightPage = await night.newPage();
    await nightPage.goto("/platform?view=partners");
    await expect(nightPage.getByRole("heading", { name: "Partners", level: 1 })).toBeVisible({ timeout: 20_000 });
    await expectTheme(nightPage, "dark");
    await expectNoHorizontalScroll(nightPage, "partners (dark)");
    await night.close();
  });
});
