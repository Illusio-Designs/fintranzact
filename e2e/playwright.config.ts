import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:5173";
const API_URL = process.env.API_URL ?? "http://localhost:3000";
const STORE_URL = process.env.STORE_URL ?? "http://localhost:5174";

export default defineConfig({
  testDir: ".",
  testMatch: ["routes/**/*.spec.ts", "flows/**/*.spec.ts"],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    // A pre-installed Chromium whose revision differs from the pinned
    // Playwright's (sandboxes, CI images): point at its binary.
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } }
      : {}),
  },

  projects: [
    // "data-audit" runs after every project that depends on setup has
    // finished: the Layer 4 data completeness audit over what the web
    // journeys saved (see data-audit.teardown.ts).
    { name: "setup", testMatch: /global-setup\.ts/, teardown: "data-audit" },
    { name: "data-audit", testMatch: /data-audit\.teardown\.ts/ },
    // End-to-end user journeys (e2e/journeys). Each journey signs up or seeds
    // its own owner, so it needs no shared session, and runs once on a
    // desktop-width window and once on a phone-width one. They depend on
    // "setup" only so the data-audit teardown runs after them.
    {
      name: "journeys-desktop",
      testMatch: /journeys\/.*\.spec\.ts/,
      dependencies: ["setup"],
      timeout: 180_000,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 }, actionTimeout: 15_000 },
    },
    {
      name: "journeys-phone",
      testMatch: /journeys\/.*\.spec\.ts/,
      dependencies: ["setup"],
      timeout: 180_000,
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, hasTouch: true, actionTimeout: 15_000 },
    },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/user.json",
      },
      dependencies: ["setup"],
    },
  ],

  webServer: [
    {
      command: "pnpm --filter @fintranzact/api dev",
      url: `${API_URL}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: "pipe",
      stderr: "pipe",
      env: { DISABLE_RATE_LIMIT: "1", TRIAL_CLAIMS: "off", TRIAL_REMINDERS: "off" },
    },
    {
      command: "pnpm --filter @fintranzact/web dev",
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    // The customer-facing online store (apps/store) for the J12 journey. The
    // web app links to it (VITE_STORE_DOMAIN, localhost:5174 in dev); its dev
    // proxy sends /<slug>/catalog.json, /order and /identify to the API.
    {
      command: "pnpm --filter @fintranzact/store dev",
      url: STORE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: "pipe",
      stderr: "pipe",
      env: { API_PROXY_TARGET: API_URL },
    },
  ],
});
