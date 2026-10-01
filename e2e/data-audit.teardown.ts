/**
 * data-audit.teardown.ts — Layer 4 check after the web journeys.
 *
 * Runs once, after every spec of the "chromium" project has finished (it is
 * the setup project's teardown). It runs the data completeness audit
 * (`pnpm data:audit`, packages/api/src/bin/data-audit.ts) over the business
 * global-setup created, so every row the UI journeys saved through the real
 * API is checked for the fields business logic needs, not just NOT NULL.
 *
 * The audit reads the same database the e2e API server writes to: it takes
 * DATABASE_URL from the environment or the repo-root .env, exactly like the
 * API started by playwright.config.ts. Set E2E_DATA_AUDIT_DATABASE_URL to
 * point it elsewhere, E2E_SKIP_DATA_AUDIT=1 to skip it, and
 * E2E_DATA_AUDIT_STRICT=1 to fail on warnings too.
 */
import { test, expect } from "@playwright/test";
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

const SEED_FILE = path.join(__dirname, ".auth", "seed.json");
const ROOT = path.resolve(__dirname, "..");

test("saved data is complete per business logic (pnpm data:audit)", async () => {
  test.skip(process.env.E2E_SKIP_DATA_AUDIT === "1", "E2E_SKIP_DATA_AUDIT=1");
  test.skip(!fs.existsSync(SEED_FILE), "global setup did not run — no seeded business to audit");
  test.setTimeout(120_000);

  const { businessId } = JSON.parse(fs.readFileSync(SEED_FILE, "utf-8")) as { businessId: string };
  const args = ["--filter", "@fintranzact/api", "data:audit", "--business", businessId];
  if (process.env.E2E_DATA_AUDIT_STRICT === "1") args.push("--strict");

  const env = { ...process.env };
  if (process.env.E2E_DATA_AUDIT_DATABASE_URL) env.DATABASE_URL = process.env.E2E_DATA_AUDIT_DATABASE_URL;

  const run = spawnSync("pnpm", args, { cwd: ROOT, env, encoding: "utf-8", timeout: 110_000 });
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  console.log(output);
  expect(run.error, output).toBeUndefined();
  expect(run.status, output).toBe(0);
});
