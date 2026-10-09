#!/usr/bin/env tsx
/**
 * rotate-encryption-key.ts — re-encrypt every ENCRYPTION_KEY-protected column under the current key.
 * Full procedure: docs/security/key-rotation.md.
 *
 * USAGE (from the repo root):
 *   pnpm --filter @fintranzact/api exec tsx src/bin/rotate-encryption-key.ts --dry-run   # counts only
 *   pnpm --filter @fintranzact/api exec tsx src/bin/rotate-encryption-key.ts             # rotate + verify
 *   pnpm --filter @fintranzact/api exec tsx src/bin/rotate-encryption-key.ts --verify-only
 *   options: --batch-size <n> (default 200)
 *
 * Environment: ENCRYPTION_KEY = the new key; ENCRYPTION_KEYS_PREVIOUS = every key that still
 * protects some value (comma separated). MULTI_TENANT=true walks every tenant database.
 *
 * Safe to stop and re-run: values already under the current key are skipped. Output has counts and
 * row ids only, never values or keys. Exit codes: 0 done and verified, 1 some value failed or the
 * verification found a problem, 3 bad usage or configuration.
 */

import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { isNotNull } from "drizzle-orm";
import { controlDb, getTenantDb, tenants, hasEncryptionKey } from "@fintranzact/db";
import {
  addCounts,
  currentKeyIdForLog,
  emptyCounts,
  rotateScope,
  verifyScope,
  type RotationCounts,
  type RotationDb,
  type RotationFailure,
} from "../lib/key-rotation.js";

config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../.env"), quiet: true });

function parseArgs(argv: string[]) {
  const out = { dryRun: false, verifyOnly: false, batchSize: 200 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--verify-only") out.verifyOnly = true;
    else if (a === "--batch-size") {
      const n = parseInt(argv[++i] ?? "", 10);
      if (!Number.isInteger(n) || n < 1 || n > 5000) throw new Error("--batch-size needs a number from 1 to 5000");
      out.batchSize = n;
    } else if (a === "--") continue;
    else throw new Error(`Unknown argument ${a}`);
  }
  if (out.dryRun && out.verifyOnly) throw new Error("--dry-run and --verify-only cannot be combined");
  return out;
}

const log = (line: string) => console.log(`[${new Date().toISOString()}] ${line}`);

async function main(): Promise<number> {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
    if (!hasEncryptionKey()) throw new Error("ENCRYPTION_KEY is not set. Set it to the NEW key.");
  } catch (err) {
    console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    return 3;
  }

  const multiTenant = process.env.MULTI_TENANT === "true";
  const mode = args.verifyOnly ? "VERIFY ONLY" : args.dryRun ? "DRY RUN (no writes)" : "ROTATE";
  log(`Mode: ${mode}; current key id: ${currentKeyIdForLog()}; layout: ${multiTenant ? "multi-tenant" : "single database"}`);

  let total: RotationCounts = emptyCounts();
  const failures: RotationFailure[] = [];
  const verifyFailures: RotationFailure[] = [];
  let verified = 0;

  const asDb = (db: unknown) => db as RotationDb;

  // Databases to walk: the control database, then each tenant database (or the one shared database).
  const targets: Array<{ label: string; scope: "control" | "tenant"; db: RotationDb }> = [
    { label: "control database", scope: "control", db: asDb(controlDb) },
  ];
  let tenantsFailedToOpen = 0;
  if (multiTenant) {
    const rows = await controlDb
      .select({ id: tenants.id, slug: tenants.slug })
      .from(tenants)
      .where(isNotNull(tenants.dbName));
    for (const t of rows) {
      try {
        targets.push({ label: `tenant ${t.slug}`, scope: "tenant", db: asDb(await getTenantDb(t.id)) });
      } catch {
        tenantsFailedToOpen++;
        log(`ERROR cannot open the database of tenant ${t.slug} (${t.id}); it was NOT processed`);
      }
    }
  } else {
    targets.push({ label: "tenant data (same database)", scope: "tenant", db: asDb(await getTenantDb("single")) });
  }

  if (!args.verifyOnly) {
    for (const t of targets) {
      log(`== ${t.label} ==`);
      const r = await rotateScope(t.db, t.scope, { dryRun: args.dryRun, batchSize: args.batchSize, log });
      total = addCounts(total, r.counts);
      failures.push(...r.failures);
    }
  }

  if (!args.dryRun) {
    log("== verification: every value must decrypt with the current key alone ==");
    for (const t of targets) {
      log(`-- ${t.label}`);
      const v = await verifyScope(t.db, t.scope, { batchSize: args.batchSize, log });
      verified += v.checked;
      verifyFailures.push(...v.failures);
    }
  }

  for (const f of [...failures, ...verifyFailures]) {
    log(`PROBLEM ${f.table}.${f.column} row ${f.rowId}: ${f.reason}`);
  }

  log("---------------------------------------------");
  if (!args.verifyOnly) {
    log(`${args.dryRun ? "Would rotate" : "Rotated"}: ${total.rotated} (of which from plaintext ${total.fromPlaintext})`);
    log(`Already on the current key: ${total.skipped}; scanned: ${total.scanned}; failed: ${total.failed}`);
  }
  if (!args.dryRun) log(`Verified under the current key alone: ${verified}; problems: ${verifyFailures.length}`);
  if (tenantsFailedToOpen > 0) log(`Tenant databases that could not be opened: ${tenantsFailedToOpen}`);

  const ok = failures.length === 0 && verifyFailures.length === 0 && tenantsFailedToOpen === 0;
  if (ok && !args.dryRun) {
    log("Done. ENCRYPTION_KEYS_PREVIOUS can now be removed once the backups that still need it have aged out (see docs/security/key-rotation.md).");
  } else if (ok && args.dryRun) {
    log("Dry run finished. Nothing was written.");
  } else {
    log("FAILED. Fix the problems above (usually a missing key in ENCRYPTION_KEYS_PREVIOUS) and run again.");
  }
  return ok ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    // Never print the error object: driver errors can echo query parameters.
    console.error("FATAL:", err instanceof Error ? err.name : "error");
    process.exit(1);
  });

