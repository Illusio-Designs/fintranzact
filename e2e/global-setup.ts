/**
 * global-setup.ts — Authenticate once, persist session for all tests.
 *
 * Registers a test user via the UI, creates a business via tRPC API,
 * then saves the browser storage state (cookies) so all test projects
 * can reuse the session without logging in again.
 *
 * Sign-up flow: /register (username, email, password) → Create free account
 * Business creation: done via API (more reliable than filling the complex form)
 */
import { test as setup, expect } from "@playwright/test";
import path from "path";
import fs from "fs";
import type { GlobalSeed } from "./helpers/seed";
import { registerViaUI } from "./helpers/auth";

const AUTH_FILE = path.join(__dirname, ".auth", "user.json");
const SEED_FILE = path.join(__dirname, ".auth", "seed.json");

setup("authenticate", async ({ page, request }) => {
  // Ensure .auth directory exists
  const authDir = path.dirname(AUTH_FILE);
  if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

  const email = `e2e-${Date.now()}@test.fintranzact.com`;
  const password = "Test@1234!";
  const name = "E2E Test User";

  // ── Step 1: Register via UI ───────────────────────────────────
  await registerViaUI(page, { username: name, email, password });

  // ── Step 2: Create business via API ───────────────────────────
  // Extract cookies from the browser context to use in API calls
  const cookies = await page.context().cookies();
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const apiUrl = process.env.API_URL ?? "http://localhost:3000";

  const createBizRes = await request.post(`${apiUrl}/api/trpc/business.create`, {
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "fintranzact",
      Cookie: cookieHeader,
    },
    data: {
      json: {
        name: "E2E Test Business",
        gstRegistrationType: "regular",
        gstin: "27AABCU9603R1ZM",
        pan: "AAACE0000A",
        phone: "9876500000",
        email: email,
        address: "123 Test Road",
        city: "Mumbai",
        state: "Maharashtra",
        stateCode: "27",
        pincode: "400001",
        currency: "INR",
      },
    },
  });

  expect(createBizRes.ok(), `business.create failed: ${await createBizRes.text()}`).toBeTruthy();

  const bizData = await createBizRes.json();
  const businessId = bizData.result?.data?.json?.id ?? bizData.result?.data?.id;

  // ── Step 3: Seed a standard party + item ──────────────────────
  const partyName = "E2E Standard Customer";
  const itemName = "E2E Standard Product";

  const createPartyRes = await request.post(`${apiUrl}/api/trpc/party.create`, {
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "fintranzact",
      Cookie: cookieHeader,
      "x-business-id": businessId,
    },
    data: {
      json: {
        name: partyName,
        type: "customer",
        phone: "9123400000",
        gstin: "",
        state: "Maharashtra",
        stateCode: "27",
      },
    },
  });
  expect(createPartyRes.ok(), `party.create failed: ${await createPartyRes.text()}`).toBeTruthy();
  const partyData = await createPartyRes.json();
  const partyId = partyData.result?.data?.json?.id ?? partyData.result?.data?.id;

  const createItemRes = await request.post(`${apiUrl}/api/trpc/item.create`, {
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "fintranzact",
      Cookie: cookieHeader,
      "x-business-id": businessId,
    },
    data: {
      json: {
        name: itemName,
        hsn: "5208",
        unit: "pcs",
        itemMode: "simple",
        salePrice: "500.00",
        purchasePrice: "400.00",
        taxPercent: "18.00",
        itemType: "product",
        taxInclusive: false,
      },
    },
  });
  expect(createItemRes.ok(), `item.create failed: ${await createItemRes.text()}`).toBeTruthy();
  const itemData = await createItemRes.json();
  const itemId = itemData.result?.data?.json?.id ?? itemData.result?.data?.id;

  // Write seed IDs for tests to read
  const seed: GlobalSeed = { businessId, partyId, itemId, partyName, itemName };
  fs.writeFileSync(SEED_FILE, JSON.stringify(seed, null, 2));

  // ── Step 4: Verify we're in the main app ──────────────────────
  // Select the new business (kept in sessionStorage) and open the app
  await page.evaluate((id) => sessionStorage.setItem("selectedBusinessId", id), businessId);
  await page.goto("/invoices");
  await expect(page.locator("h1").first()).toContainText("Invoices", { timeout: 10_000 });

  // Save authenticated state
  await page.context().storageState({ path: AUTH_FILE });
});
