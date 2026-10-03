/**
 * role-visibility.spec.ts — Verifies nav items and route access per role.
 *
 * For each role (seller, accountant), this test:
 *   1. Invites a user with that role (via owner's API)
 *   2. Registers the invited user via UI
 *   3. Visits the invite link, which accepts it automatically
 *   3b. Checks the member can open the seeded business (business
 *       access is per business; joining the organization alone shows none)
 *   4. Verifies which sidebar nav items are visible vs. hidden
 *   5. Verifies which routes are accessible vs. redirected
 *
 * Only tests seller + accountant (the two most different permission sets)
 * to keep the run short (every role is covered by the API role sweep).
 */
import { test, expect, ApiHelper } from "../helpers/fixtures";
import { openRegisterForm, fillRegisterForm } from "../helpers/auth";
import { loadSeed } from "../helpers/seed";
import { sidebarLabels } from "../helpers/journey";

const API_URL = process.env.API_URL ?? "http://localhost:3000";

/** Nav items that each role should see in the sidebar */
const ROLE_NAV_VISIBLE: Record<string, string[]> = {
  seller: [
    "Invoices",
    "Quotations",
    "Sales Returns",
    "Credit Notes",
    "Delivery Challans",
    "Proforma Invoices",
    "Parties",
    "Stock Items",
    "Payments",
  ],
  accountant: [
    "Invoices",
    "Parties",
    "Stock Items",
    "Payments",
    "Cash & Bank",
    "Expenses",
    "Reports",
  ],
};

/**
 * Nav items that each role should NOT see. Accountants can read every
 * section in the sidebar, so only sellers have hidden items.
 */
const ROLE_NAV_HIDDEN = {
  seller: ["Dashboard", "Cash & Bank", "Expenses"],
};

/**
 * Helper: invite a user, register them via UI, accept the invite via
 * the /invite/:token page, and return the authenticated page.
 */
async function createRoleUser(
  browser: any,
  ownerPage: any,
  role: "seller" | "accountant",
) {
  const api = new ApiHelper(ownerPage, API_URL);
  const ts = Date.now();
  const email = `e2e-${role}-${ts}@test.fintranzact.com`;
  const password = "Test@1234!";
  const name = `E2E ${role} User`;

  // Clean up any stale pending invitations to stay within plan limits
  const pending = await api.query<Array<{ id: string }>>("tenant.pendingInvitations");
  for (const inv of pending) {
    await api.mutate("tenant.revokeInvitation", { id: inv.id }).catch(() => {});
  }

  // Step 1: Owner sends invite via API
  const invite = await api.mutate<{ token: string }>("tenant.inviteMember", {
    email,
    role,
  });

  // Step 2: Register the new user via UI in a fresh, logged-out context
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();

  await openRegisterForm(page);
  await fillRegisterForm(page, { username: name, email, password });

  // Wait for redirect — user has a pending invite so may land differently
  await expect(page).not.toHaveURL(/\/(login|register)/, { timeout: 15_000 });

  // Step 3: Visit the invite acceptance page
  await page.goto(`/invite/${invite.token}`);

  // The invite page auto-accepts, says so, and continues on request
  await page.getByRole("button", { name: /Continue with / }).click();
  await expect(page).not.toHaveURL(/\/invite\//, { timeout: 15_000 });

  // Step 3b: Owner assigns the new member to the seeded business
  const { businessId } = loadSeed();
  const members = await api.query<Array<{ userId: string; userEmail: string }>>("tenant.members");
  const member = members.find((m) => m.userEmail === email);
  expect(member, `invited ${role} not found in tenant members`).toBeDefined();
  // Joining the organisation already opened its businesses to the member.
  const access = await api.query<Array<{ userId: string }>>("business.members", { businessId }, { "x-business-id": businessId });
  expect(access.map((m) => m.userId)).toContain(member!.userId);

  // Open the app with that business selected (kept in sessionStorage)
  await page.evaluate((id: string) => sessionStorage.setItem("selectedBusinessId", id), businessId);
  await page.goto("/invoices");
  await expect(page.locator("h1").first()).toContainText("Invoices", { timeout: 15_000 });

  return { context, page };
}

// ═════════════════════════════════════════════════════════════════
// SELLER — can see sales + inventory, not dashboard/money/compliance
// ═════════════════════════════════════════════════════════════════

test.describe("Role: Seller", () => {
  let rolePage: any;
  let roleCtx: any;

  test.beforeAll(async ({ browser }) => {
    const ownerCtx = await browser.newContext({ storageState: "e2e/.auth/user.json" });
    const ownerPage = await ownerCtx.newPage();

    const result = await createRoleUser(browser, ownerPage, "seller");
    rolePage = result.page;
    roleCtx = result.context;

    await ownerPage.close();
    await ownerCtx.close();
  });

  test.afterAll(async () => {
    await rolePage?.close();
    await roleCtx?.close();
  });

  test("seller sees expected nav items", async () => {
    await rolePage.goto("/invoices");
    await rolePage.locator("h1").first().waitFor({ state: "visible", timeout: 10_000 });

    // Every group's links, opening the accordion group by group.
    const labels = await sidebarLabels(rolePage);
    for (const item of ROLE_NAV_VISIBLE.seller) expect(labels).toContain(item);
  });

  test("seller does NOT see restricted nav items", async () => {
    await rolePage.goto("/invoices");
    await rolePage.locator("h1").first().waitFor({ state: "visible", timeout: 10_000 });

    const labels = await sidebarLabels(rolePage);
    for (const item of ROLE_NAV_HIDDEN.seller) expect(labels).not.toContain(item);
  });

  test("seller is redirected from dashboard to invoices", async () => {
    await rolePage.goto("/");
    // Seller can't see Dashboard (no Report:read), should redirect to /invoices
    await expect(rolePage).toHaveURL(/\/invoices/, { timeout: 10_000 });
  });

  test("seller can access invoices page", async () => {
    await rolePage.goto("/invoices");
    await expect(rolePage.locator("h1").first()).toContainText("Invoices", { timeout: 10_000 });
  });

  test("seller can access items page", async () => {
    await rolePage.goto("/items");
    await expect(rolePage.locator("h1").first()).toContainText("Items", { timeout: 10_000 });
  });

  test("seller can access parties page", async () => {
    await rolePage.goto("/parties");
    await expect(rolePage.locator("h1").first()).toContainText("Parties", { timeout: 10_000 });
  });

  test("seller can access payments page", async () => {
    await rolePage.goto("/payments");
    await expect(rolePage.locator("h1").first()).toContainText("Payments", { timeout: 10_000 });
  });

  test("seller does NOT see delete button on invoice rows", async () => {
    await rolePage.goto("/invoices");
    await rolePage.locator("h1").first().waitFor({ state: "visible", timeout: 10_000 });

    const rows = rolePage.locator("tbody tr");
    const count = await rows.count();
    // If there are rows, open the row's Actions menu: it must not offer delete.
    if (count > 0) {
      await rows.first().getByRole("button", { name: /^Actions for/ }).click();
      await expect(rolePage.getByRole("menu")).toBeVisible();
      await expect(rolePage.getByRole("menuitem", { name: /delete/i })).toHaveCount(0);
      await rolePage.keyboard.press("Escape");
    }
  });

  test("seller does NOT see delete button in invoice detail panel", async () => {
    await rolePage.goto("/invoices");
    await rolePage.locator("h1").first().waitFor({ state: "visible", timeout: 10_000 });

    const rows = rolePage.locator("tbody tr");
    const count = await rows.count();
    if (count > 0) {
      await rows.first().click();
      const panel = rolePage.locator('[role="dialog"]').first();
      const panelVisible = await panel.isVisible().catch(() => false);
      if (panelVisible) {
        // Seller should NOT see Delete button in the detail panel
        await expect(
          panel.getByRole("button", { name: /^delete$/i }),
        ).not.toBeVisible();
      }
    }
  });
});

// ═════════════════════════════════════════════════════════════════
// ACCOUNTANT — sees money/compliance, limited sales
// ═════════════════════════════════════════════════════════════════

test.describe("Role: Accountant", () => {
  let rolePage: any;
  let roleCtx: any;
  let setupFailed = false;

  test.beforeAll(async ({ browser }) => {
    const ownerCtx = await browser.newContext({ storageState: "e2e/.auth/user.json" });
    const ownerPage = await ownerCtx.newPage();

    try {
      const result = await createRoleUser(browser, ownerPage, "accountant");
      rolePage = result.page;
      roleCtx = result.context;
    } catch (err: any) {
      // Plan limit may prevent adding a 4th member — mark for skip
      if (err.message?.includes("plan allows up to")) {
        setupFailed = true;
      } else {
        throw err;
      }
    }

    await ownerPage.close();
    await ownerCtx.close();
  });

  test.afterAll(async () => {
    await rolePage?.close();
    await roleCtx?.close();
  });

  test.beforeEach(() => {
    test.skip(setupFailed, "Skipped: plan member limit reached — cannot invite accountant");
  });

  test("accountant sees expected nav items", async () => {
    await rolePage.goto("/invoices");
    await rolePage.locator("h1").first().waitFor({ state: "visible", timeout: 10_000 });

    const labels = await sidebarLabels(rolePage);
    for (const item of ROLE_NAV_VISIBLE.accountant) expect(labels).toContain(item);
  });

  test("accountant can access expenses page", async () => {
    await rolePage.goto("/expenses");
    await expect(rolePage.locator("h1").first()).toContainText("Expenses", { timeout: 10_000 });
  });

  test("accountant can access cash & bank page", async () => {
    await rolePage.goto("/cash-and-bank");
    await expect(rolePage.locator("h1").first()).toContainText(/cash|bank/i, { timeout: 10_000 });
  });

  test("accountant can access reports page", async () => {
    await rolePage.goto("/reports");
    // The heading shows the open report (e.g. "Daybook"), so check the page
    // loaded without redirecting away.
    await expect(rolePage.locator("h1").first()).toBeVisible({ timeout: 10_000 });
    await expect(rolePage).toHaveURL(/\/reports/);
  });

  test("accountant can access invoices page", async () => {
    await rolePage.goto("/invoices");
    await expect(rolePage.locator("h1").first()).toContainText("Invoices", { timeout: 10_000 });
  });

  test("accountant does NOT see delete button on invoice rows", async () => {
    await rolePage.goto("/invoices");
    await rolePage.locator("h1").first().waitFor({ state: "visible", timeout: 10_000 });

    const rows = rolePage.locator("tbody tr");
    const count = await rows.count();
    if (count > 0) {
      await rows.first().hover();
      const deleteBtn = rows.first().locator('[aria-label*="delete" i], [aria-label*="Delete" i], [title*="delete" i]');
      await expect(deleteBtn).not.toBeVisible();
    }
  });

  test("accountant does NOT see delete button in invoice detail panel", async () => {
    await rolePage.goto("/invoices");
    await rolePage.locator("h1").first().waitFor({ state: "visible", timeout: 10_000 });

    const rows = rolePage.locator("tbody tr");
    const count = await rows.count();
    if (count > 0) {
      await rows.first().click();
      const panel = rolePage.locator('[role="dialog"]').first();
      const panelVisible = await panel.isVisible().catch(() => false);
      if (panelVisible) {
        await expect(
          panel.getByRole("button", { name: /^delete$/i }),
        ).not.toBeVisible();
      }
    }
  });
});
