#!/usr/bin/env npx tsx
/**
 * Sandbox.co.in smoke run for the TEST environment.
 *
 *   pnpm sandbox:smoke                  run every read-only check
 *   pnpm sandbox:smoke --only=auth-token,hsn-goods
 *   pnpm sandbox:smoke --list           list check ids and exit
 *   pnpm sandbox:smoke --no-file        do not write scripts/.sandbox-smoke-report.json
 *   pnpm sandbox:smoke --allow-live     permit a key_live_ key (read-only checks only)
 *
 * Credentials: SANDBOX_API_KEY / SANDBOX_API_SECRET (and optional
 * SANDBOX_BASE_URL) are read from the environment or the repo's .env, NEVER
 * from arguments. Keys are never printed: only the key type and a masked form.
 *
 * Output: a Markdown report on stdout and a sanitised JSON copy in
 * scripts/.sandbox-smoke-report.json (git-ignored). Send the Markdown report
 * back to the developer, not your .env.
 *
 * Needs no database: the Sandbox client runs with an injected no-op meter.
 * The pure logic lives in packages/api/src/lib/sandbox/smoke*.ts (unit tested).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// Keep the app logger quiet and transport-free (set before the client is imported).
process.env.LOG_LEVEL = "silent";
process.env.NODE_ENV = "production";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const REPORT_PATH = path.join(here, ".sandbox-smoke-report.json");

function readIfExists(p: string): string | null {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

async function main(): Promise<number> {
  const smoke = await import("../packages/api/src/lib/sandbox/smoke.js");
  const checks = await import("../packages/api/src/lib/sandbox/smoke-checks.js");
  const { SandboxClient, SANDBOX_LIVE_URL, SANDBOX_TEST_URL } = await import("../packages/api/src/lib/sandbox/client.js");

  const parsed = smoke.parseArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(parsed.error);
    return 2;
  }
  const { args } = parsed;

  if (args.list) {
    for (const c of checks.allChecks()) console.log(`${c.id}\t${c.title}`);
    return 0;
  }

  const dotenvText = readIfExists(path.join(root, ".env")) ?? readIfExists(path.join(process.cwd(), ".env"));
  const env = smoke.resolveSandboxEnv(process.env, dotenvText);
  const apiKey = env.SANDBOX_API_KEY;
  const apiSecret = env.SANDBOX_API_SECRET;
  const kind = smoke.keyKind(apiKey);
  const baseUrl = (env.SANDBOX_BASE_URL || (kind === "live" ? SANDBOX_LIVE_URL : SANDBOX_TEST_URL)).replace(/\/+$/, "");

  const guard = smoke.guardRun({ apiKey, apiSecret, baseUrl, allowLive: args.allowLive });
  if (!guard.ok) {
    console.error(`Refusing to run: ${guard.reason}`);
    return 2;
  }
  // From here the key and secret are known to exist.
  const key = apiKey as string;
  const secret = apiSecret as string;

  let selected = checks.allChecks();
  if (args.only) {
    const unknown = args.only.filter((id) => !selected.some((c) => c.id === id));
    if (unknown.length) {
      console.error(`Unknown check id(s): ${unknown.join(", ")}. Use --list to see them.`);
      return 2;
    }
    selected = selected.filter((c) => args.only!.includes(c.id));
  }
  if (guard.readOnlyOnly) selected = selected.filter((c) => c.kind === "read-only");

  // Injected no-op meter: no control-DB writes, no wallet alerts, no Postgres needed.
  const noopMeter = { onFailure() {}, onSuccess() {} };
  const apiVersion = env.SANDBOX_API_VERSION || "1.0.0";
  const client = new SandboxClient(
    { apiKey: key, apiSecret: secret, baseUrl, apiVersion, timeoutMs: 20_000 },
    undefined,
    undefined,
    noopMeter,
  );
  const ctx = checks.createSmokeContext({ client, baseUrl, apiKey: key, apiSecret: secret, apiVersion, timeoutMs: 20_000 });

  console.error(`Running ${selected.length} read-only check(s) against ${new URL(baseUrl).host} with ${smoke.maskKey(key)} ...`);
  const results = await smoke.runChecks(selected, ctx);

  const report = smoke.buildReport({
    env: {
      keyKind: guard.kind,
      maskedKey: smoke.maskKey(key),
      host: new URL(baseUrl).host,
      apiVersion,
      readOnlyOnly: guard.readOnlyOnly,
      warnings: guard.warnings,
    },
    results,
    generatedAt: new Date().toISOString(),
    secrets: [key, secret],
  });

  console.log(report.markdown);
  if (!args.noFile) {
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report.json, null, 2) + "\n", { mode: 0o600 });
    console.error(`Sanitised JSON report written to ${path.relative(root, REPORT_PATH)}`);
  }
  return results.some((r) => r.verdict === "FAIL") ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    // Never print the error object: it could carry request details.
    console.error(`Smoke run crashed: ${err instanceof Error ? err.name : "error"}`);
    process.exit(3);
  },
);
