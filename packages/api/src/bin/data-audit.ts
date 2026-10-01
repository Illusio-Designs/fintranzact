#!/usr/bin/env tsx
/**
 * data-audit.ts — Layer-4 data completeness check.
 *
 * Checks that what the app saved is complete per business logic (not just
 * per NOT NULL): totals that must add up, nullable columns the writers always
 * fill, ledgers that must reconcile, stock that must equal its movements,
 * audit entries for user mutations. Rules live in src/lib/data-audit/rules.
 *
 * USAGE (from the repo root):
 *   pnpm data:audit                                  # whole database in DATABASE_URL
 *   pnpm data:audit --business <uuid>[,<uuid>…]      # only these businesses
 *   pnpm data:audit --only invoices,payments.bank    # rule id prefixes
 *   pnpm data:audit --strict                         # warnings fail too
 *   pnpm data:audit --json                           # machine-readable report
 *   pnpm data:audit --samples 10                     # sample rows per rule
 *   pnpm data:audit --list                           # print the rule catalogue
 *
 * The database is DATABASE_URL (TENANT_DATABASE_URL wins when set — in cloud
 * mode point it at one tenant's database). The repo-root .env is loaded like
 * the API does, without overriding variables already set.
 *
 * Exit codes: 0 clean, 1 violations (errors, or warnings with --strict),
 * 2 a rule query failed, 3 bad usage / no database.
 */

import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";
import postgres from "postgres";
import { runAudit, formatReport, exitCodeFor } from "../lib/data-audit/runner.js";
import { TABLE_COVERAGE } from "../lib/data-audit/registry.js";

config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../.env"), quiet: true });

function parseArgs(argv: string[]) {
  const out = { businessIds: [] as string[], only: [] as string[], strict: false, json: false, list: false, samples: 5 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => {
      const v = argv[++i];
      if (!v) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--business" || a === "-b") out.businessIds.push(...next().split(",").map((s) => s.trim()).filter(Boolean));
    else if (a === "--only") out.only.push(...next().split(",").map((s) => s.trim()).filter(Boolean));
    else if (a === "--samples") out.samples = Math.max(1, parseInt(next(), 10) || 5);
    else if (a === "--strict") out.strict = true;
    else if (a === "--json") out.json = true;
    else if (a === "--list") out.list = true;
    else if (a === "--") continue;
    else throw new Error(`Unknown argument ${a}`);
  }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const bad = out.businessIds.find((id) => !uuid.test(id));
  if (bad) throw new Error(`--business expects UUIDs, got ${bad}`);
  return out;
}

function printCatalogue() {
  for (const t of TABLE_COVERAGE) {
    console.log(`${t.table}`);
    if (t.rules.length === 0) console.log(`  (no extra requirements) ${t.noExtraRequirements}`);
    for (const r of t.rules) console.log(`  [${r.severity}] ${r.id}: ${r.description}`);
  }
  const rules = TABLE_COVERAGE.reduce((s, t) => s + t.rules.length, 0);
  console.log(`\n${TABLE_COVERAGE.length} tables, ${rules} rules`);
}

async function main() {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 3;
  }
  if (args.list) {
    printCatalogue();
    return 0;
  }

  const url = process.env.TENANT_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL (or TENANT_DATABASE_URL) is required");
    return 3;
  }
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const report = await runAudit(sql, { businessIds: args.businessIds, only: args.only, samples: args.samples });
    if (args.json) console.log(JSON.stringify(report, null, 2));
    else console.log(formatReport(report));
    return exitCodeFor(report, { strict: args.strict });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(2);
  },
);
