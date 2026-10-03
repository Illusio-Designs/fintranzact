/**
 * J2 — Team: the owner builds a team in Settings → Team and each member
 * works in their own browser.
 *
 *   1. Owner (seeded through the API: sign-up is J1's journey) opens the
 *      business and invites four people, one per role: Admin, Sales Manager
 *      (seller_manager), Seller and Accountant. Pending invitations are listed.
 *   2. Each invitee opens the link from the invite in a second browser
 *      context, registers with the invited address and joins.
 *   3. What each role sees: the sidebar sections, where they land, and the
 *      actions they are refused — the accountant cannot create an invoice,
 *      the sales manager cannot delete a paid invoice nor one older than two
 *      hours, the seller has no settings for the team.
 *   4. The owner changes the seller to accountant: the seller's sidebar
 *      follows. The owner removes the member: they lose access at once.
 *
 * Invoices and a payment are seeded through the API (other journeys own
 * them); the "older than two hours" invoice is backdated in the database.
 * Invitation emails go to the dev console mailer: the invitee uses the link
 * the owner sees in the invite panel, exactly as the owner would share it.
 */
import type { Browser, BrowserContext, Page } from "@playwright/test";
import {
  test,
  expect,
  expectNoHorizontalScroll,
  expectTheme,
  navTo,
  toast,
  newJourneyContext,
  sidebarLabels,
  uid,
  type ConsoleGuard,
} from "../../helpers/journey";
import { seedOwner, Trpc, type SeededOwner } from "../../helpers/journey-seed";
import {
  backdateInvoice,
  businessMembers,
  invitationsFor,
  invoiceRow,
  sessionTenants,
  tenantMembers,
  userByEmail,
} from "../../helpers/db";

type Role = "admin" | "seller_manager" | "seller" | "accountant";
const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  seller_manager: "Sales Manager",
  seller: "Seller",
  accountant: "Accountant (bookkeeping)",
};

/** Sidebar sections each role must (and must not) see. */
const SIDEBAR: Record<Role, { visible: string[]; hidden: string[] }> = {
  admin: {
    visible: ["Dashboard", "Parties", "Cash & Bank", "Stock Items", "Invoices", "Payments", "Expenses", "Journal Entries", "Reports"],
    hidden: [],
  },
  seller_manager: {
    visible: ["Parties", "Stock Items", "Invoices", "Quotations", "Payments"],
    hidden: ["Dashboard", "Cash & Bank", "Expenses", "Journal Entries", "Reports"],
  },
  seller: {
    visible: ["Parties", "Stock Items", "Invoices", "Quotations", "Payments"],
    hidden: ["Dashboard", "Cash & Bank", "Expenses", "Journal Entries", "Reports"],
  },
  accountant: {
    visible: ["Dashboard", "Parties", "Cash & Bank", "Stock Items", "Invoices", "Payments", "Expenses", "Journal Entries", "Reports"],
    hidden: [],
  },
};

const PASSWORD = "Member@1234";

async function openBusiness(page: Page, businessName: string) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Choose a company" })).toBeVisible({ timeout: 20_000 });
  await expectNoHorizontalScroll(page, "choose a company");
  await page.getByRole("button", { name: `Open ${businessName}` }).click();
  await expect(page.getByTestId("app-sidebar")).toBeAttached({ timeout: 20_000 });
}

async function openTeamSettings(page: Page) {
  await navTo(page, "Settings");
  await expect(page).toHaveURL(/\/settings/);
  await page.getByRole("button", { name: "Team", exact: true }).filter({ visible: true }).click();
  await expect(page.getByRole("heading", { name: "Team Members" })).toBeVisible();
  await expectNoHorizontalScroll(page, "settings: team");
}

/** Owner invites `email` with `role`; returns the invite link shown to them. */
async function invite(page: Page, email: string, role: Role): Promise<string> {
  await page.getByRole("button", { name: "+ Invite" }).click();
  const panel = page.getByRole("dialog", { name: "Invite Team Member" });
  await expect(panel).toBeVisible();
  await panel.getByLabel("Email address").fill(email);
  await panel.getByRole("combobox", { name: "Role" }).click();
  await page.getByRole("option", { name: ROLE_LABEL[role], exact: true }).click();
  await expect(panel.getByRole("combobox", { name: "Role" })).toContainText(ROLE_LABEL[role]);
  await expectNoHorizontalScroll(page, "invite panel");
  await panel.getByRole("button", { name: "Send Invite" }).click();
  await expect(panel.getByText("Invitation created!")).toBeVisible();
  const link = await panel.getByLabel("Invite Link").inputValue();
  expect(link).toMatch(/\/invite\/[A-Za-z0-9_-]{32}$/);
  await panel.getByRole("button", { name: "Done" }).click();
  await expect(panel).toBeHidden();
  return link;
}

/** The invitee opens the link signed out, registers with the invited address and joins. */
async function acceptInvite(
  browser: Browser,
  guard: ConsoleGuard,
  link: string,
  who: { email: string; name: string },
  tenantName: string,
  role: Role,
  viewport: { width: number; height: number },
) {
  // The accountant works late: their browser gets the dark (evening) theme.
  const theme = role === "accountant" ? "dark" : "light";
  const context = await newJourneyContext(browser, guard, { viewport, theme });
  const page = await context.newPage();
  await page.goto(link);
  // Signed out: the invite sends them to log in / register first.
  await expect(page).toHaveURL(/\/login\?invite=/, { timeout: 15_000 });
  await expect(page.getByRole("status").filter({ hasText: "Log in to accept your invitation" })).toBeVisible();
  await page.getByRole("tab", { name: "Register" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Create your account with the email address the invite was sent to" })).toBeVisible();
  await expectNoHorizontalScroll(page, "register (invited)");
  await page.getByLabel("Username").fill(who.name);
  await page.getByLabel("Email address").fill(who.email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Retype password").fill(PASSWORD);
  await page.locator("form").getByRole("button", { name: "Create free account" }).click();

  await expect(page.getByRole("heading", { name: `You've joined ${tenantName}!` })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(`as ${ROLE_LABEL[role]}`)).toBeVisible();
  await expectTheme(page, theme);
  await expectNoHorizontalScroll(page, "invite accepted");
  await page.getByRole("button", { name: `Continue with ${tenantName}` }).click();
  return { context, page };
}

test.describe("J2 team", () => {
  test.setTimeout(420_000);

  test("owner invites every role; each member's access; role change; removal", async ({ browser, context, page, guard }, testInfo) => {
    const viewport = testInfo.project.use.viewport!;
    const owner: SeededOwner = await seedOwner(context, "j2");
    const tenantName = (await owner.api.query<Array<{ tenantId: string; tenantName: string }>>("tenant.list")).find(
      (t) => t.tenantId === owner.tenantId,
    )!.tenantName;

    // ── Seed sales the roles will try to change (owned by other journeys) ─
    const party = await owner.api.mutate<{ id: string }>("party.create", {
      name: `J2 Customer ${uid()}`,
      type: "customer",
      phone: "9123400001",
      state: "Maharashtra",
      stateCode: "27",
    });
    const item = await owner.api.mutate<{ id: string }>("item.create", {
      name: `J2 Widget ${uid()}`,
      hsn: "8471",
      unit: "pcs",
      itemMode: "simple",
      salePrice: "1000.00",
      purchasePrice: "700.00",
      taxPercent: "18.00",
      itemType: "product",
      taxInclusive: false,
    });
    const sale = (qty: string) =>
      owner.api.mutate<{ id: string; invoiceNumber: string; totalAmount: string }>("invoice.create", {
        type: "sale",
        partyId: party.id,
        invoiceDate: new Date().toISOString(),
        dueDate: new Date(Date.now() + 7 * 86400000).toISOString(),
        lineItems: [{ itemId: item.id, itemName: "J2 Widget", quantity: qty, unitPrice: "1000.00", taxPercent: "18.00", discountPercent: "0", conversionFactor: "1" }],
        invoiceDiscount: "0",
        invoiceDiscountType: "amount",
        additionalCharges: "0",
        roundOff: "0",
      });
    const paidInvoice = await sale("1");
    await owner.api.mutate("payment.create", {
      partyId: party.id,
      invoiceId: paidInvoice.id,
      amount: "1180.00",
      mode: "cash",
    });
    expect((await invoiceRow(paidInvoice.id))!.status).toBe("paid");
    const oldInvoice = await sale("2");
    await backdateInvoice(oldInvoice.id, 3);
    const freshInvoice = await sale("3");

    // ── Owner: Settings → Team, invite one person per role ──────
    await openBusiness(page, owner.businessName);
    await expectTheme(page, "light");
    await openTeamSettings(page);
    const members = {} as Record<Role, { email: string; name: string; link: string }>;
    for (const role of ["admin", "seller_manager", "seller", "accountant"] as Role[]) {
      const email = `j2-${role.replace("_", "-")}-${uid()}@test.fintranzact.com`;
      const link = await invite(page, email, role);
      members[role] = { email, name: `J2 ${ROLE_LABEL[role]} ${uid()}`, link };
      const pendingRow = page.getByRole("row").filter({ hasText: email });
      await expect(pendingRow).toContainText(ROLE_LABEL[role]);
    }
    for (const role of Object.keys(members) as Role[]) {
      const [inv] = await invitationsFor(owner.tenantId, members[role].email);
      expect(inv).toMatchObject({ role, accepted_at: null });
      // Only a hash of the link's token is stored.
      expect(inv.token).not.toBe(members[role].link.split("/").pop());
    }

    // ── Each member joins in their own browser ──────────────────
    const sessions = {} as Record<Role, { context: BrowserContext; page: Page }>;
    for (const role of Object.keys(members) as Role[]) {
      sessions[role] = await acceptInvite(browser, guard, members[role].link, members[role], tenantName, role, viewport);
    }

    const team = await tenantMembers(owner.tenantId);
    for (const role of Object.keys(members) as Role[]) {
      expect(team).toContainEqual(expect.objectContaining({ email: members[role].email, role }));
      const [inv] = await invitationsFor(owner.tenantId, members[role].email);
      expect(inv.accepted_at).not.toBeNull();
    }
    // Joining the organisation gives access to its business.
    const bizMembers = await businessMembers(owner.businessId);
    expect(bizMembers.map((m) => m.email).sort()).toEqual(
      [owner.email, ...Object.values(members).map((m) => m.email)].map((e) => e.toLowerCase()).sort(),
    );

    // Owner's team list shows everyone, no pending invitations left.
    await page.reload();
    await page.getByRole("button", { name: "Team", exact: true }).filter({ visible: true }).click();
    for (const role of Object.keys(members) as Role[]) {
      await expect(page.getByRole("row").filter({ hasText: members[role].email })).toBeVisible();
    }
    await expect(page.getByText("Pending Invitations")).toHaveCount(0);

    // ── What each role sees ─────────────────────────────────────
    for (const role of Object.keys(members) as Role[]) {
      const mp = sessions[role].page;
      await openBusiness(mp, owner.businessName);
      // Landing: roles without the dashboard start on Invoices.
      if (role === "seller" || role === "seller_manager") {
        await expect(mp).toHaveURL(/\/invoices/, { timeout: 15_000 });
      } else {
        await expect(mp.locator("h1").first()).toContainText(/Good (morning|afternoon|evening)/, { timeout: 15_000 });
      }
      await expectNoHorizontalScroll(mp, `${role}: landing`);
      await expectTheme(mp, role === "accountant" ? "dark" : "light");
      const labels = await sidebarLabels(mp);
      for (const l of SIDEBAR[role].visible) expect(labels, `${role} sees ${l}`).toContain(l);
      for (const l of SIDEBAR[role].hidden) expect(labels, `${role} does not see ${l}`).not.toContain(l);
    }

    // Accountant: invoices are read-only — no way to create one.
    {
      const mp = sessions.accountant.page;
      await navTo(mp, "Invoices");
      await expect(mp.getByRole("heading", { name: "Invoices", level: 1 })).toBeVisible();
      await expect(mp.getByRole("row").filter({ hasText: paidInvoice.invoiceNumber })).toBeVisible();
      await expect(mp.getByRole("button", { name: /New Invoice/ })).toHaveCount(0);
      await expectNoHorizontalScroll(mp, "accountant: invoices");
    }

    // Sales manager: may delete a fresh unpaid invoice, not a paid or an old one.
    {
      const mp = sessions.seller_manager.page;
      guard.allow(/status of 403 .*invoice\.delete/); // the refusals below are 403s by design
      await navTo(mp, "Invoices");
      await expect(mp.getByRole("heading", { name: "Invoices", level: 1 })).toBeVisible();
      const paidRow = mp.getByRole("row").filter({ hasText: paidInvoice.invoiceNumber });
      await expect(paidRow).toBeVisible();
      // Each row's actions are in its "Actions" menu; a paid invoice offers no delete.
      await paidRow.getByRole("button", { name: /^Actions for/ }).click();
      await expect(mp.getByRole("menu")).toBeVisible();
      await expect(mp.getByRole("menuitem", { name: "Delete invoice" })).toHaveCount(0);
      await mp.keyboard.press("Escape");

      const oldRow = mp.getByRole("row").filter({ hasText: oldInvoice.invoiceNumber });
      await oldRow.getByRole("button", { name: /^Actions for/ }).click();
      await mp.getByRole("menuitem", { name: "Delete invoice" }).click();
      await mp.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
      await expect(toast(mp, "Can only delete invoices within 2 hours of creation")).toBeVisible();
      expect((await invoiceRow(oldInvoice.id))!.deleted_at).toBeNull();

      const freshRow = mp.getByRole("row").filter({ hasText: freshInvoice.invoiceNumber });
      await freshRow.getByRole("button", { name: /^Actions for/ }).click();
      await mp.getByRole("menuitem", { name: "Delete invoice" }).click();
      await mp.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
      await expect(toast(mp, "Invoice deleted")).toBeVisible();
      await expect(freshRow).toHaveCount(0);
      expect((await invoiceRow(freshInvoice.id))!.deleted_at).not.toBeNull();
    }

    // Seller: no team management.
    {
      const mp = sessions.seller.page;
      await navTo(mp, "Settings");
      await mp.getByRole("button", { name: "Team", exact: true }).filter({ visible: true }).click();
      await expect(mp.getByRole("heading", { name: "Team Members" })).toBeVisible();
      await expect(mp.getByRole("button", { name: "+ Invite" })).toHaveCount(0);
      await expect(mp.getByRole("button", { name: "Remove" })).toHaveCount(0);
    }

    // Admin: can manage the team like the owner.
    {
      const mp = sessions.admin.page;
      await openTeamSettings(mp);
      await expect(mp.getByRole("button", { name: "+ Invite" })).toBeVisible();
    }

    // ── Owner changes the seller to accountant ──────────────────
    const sellerRow = page.getByRole("row").filter({ hasText: members.seller.email });
    await sellerRow.getByRole("combobox").click();
    await page.getByRole("option", { name: "Accountant (bookkeeping)", exact: true }).click();
    await expect(toast(page, "Role updated")).toBeVisible();
    await expect(sellerRow.getByRole("combobox")).toContainText("Accountant (bookkeeping)");
    expect(await tenantMembers(owner.tenantId)).toContainEqual(
      expect.objectContaining({ email: members.seller.email, role: "accountant" }),
    );
    {
      const mp = sessions.seller.page;
      await mp.goto("/");
      const labels = await sidebarLabels(mp);
      for (const l of SIDEBAR.accountant.visible) expect(labels, `ex-seller now sees ${l}`).toContain(l);
    }

    // ── Owner removes the (ex-)seller: access ends immediately ──
    // Their still-open tab keeps polling; those requests are now refused.
    guard.allow(/status of 40[013] /);
    await sellerRow.getByRole("button", { name: "Remove" }).click();
    await expect(toast(page, "Member removed")).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: members.seller.email })).toHaveCount(0);
    const removed = await userByEmail(members.seller.email);
    expect((await tenantMembers(owner.tenantId)).map((m) => m.email)).not.toContain(members.seller.email);
    expect(await sessionTenants(removed!.id)).not.toContain(owner.tenantId);
    {
      const mp = sessions.seller.page;
      await mp.goto("/invoices");
      // They are back to having no organisation.
      await expect(mp.getByRole("heading", { name: "No organization found" })).toBeVisible({ timeout: 15_000 });
      await expect(mp.getByText(owner.businessName)).toHaveCount(0);
      await expect(mp.getByRole("row").filter({ hasText: paidInvoice.invoiceNumber })).toHaveCount(0);
      // Nothing of the business can be fetched any more.
      const api = new Trpc(sessions.seller.context.request, owner.businessId);
      await expect(api.query("invoice.list", { type: "sale" })).rejects.toThrow(/failed \(40[013]\)/);
      await expectNoHorizontalScroll(mp, "removed member");
    }

    for (const s of Object.values(sessions)) await s.context.close();
  });
});
