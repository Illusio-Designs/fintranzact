#!/usr/bin/env tsx
/**
 * audit-check.ts — production dependency vulnerability gate (CI job "Dependency audit").
 *
 * USAGE (repo root):
 *   pnpm audit:prod              # list prod dependencies from the lockfile, ask the npm registry, apply the policy
 *   pnpm audit:prod --json       # machine-readable result
 *
 * Why not `pnpm audit`: pnpm 9 calls an endpoint npm has been retiring, and it cannot apply our
 * allowlist with expiry dates. This uses the registry's bulk advisory endpoint, which the current
 * npm and pnpm clients also use. The policy is in src/lib/security-audit.ts and has unit tests.
 *
 * Exit codes: 0 pass, 1 policy failure (blocking advisory or bad/expired allowlist entry),
 * 2 could not reach the registry or list dependencies (job fails; re-run).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluate, findingsFrom } from "../lib/security-audit.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const ENDPOINT = process.env.NPM_AUDIT_ENDPOINT ?? "https://registry.npmjs.org/-/npm/v1/security/advisories/bulk";
const json = process.argv.includes("--json");

function installedProdPackages(): Map<string, Set<string>> {
  const out = execFileSync("pnpm", ["licenses", "list", "--prod", "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  const byLicense = JSON.parse(out) as Record<string, Array<{ name: string; versions: string[] }>>;
  const map = new Map<string, Set<string>>();
  for (const pkgs of Object.values(byLicense)) {
    for (const p of pkgs) {
      const set = map.get(p.name) ?? new Set<string>();
      p.versions.forEach((v) => set.add(v));
      map.set(p.name, set);
    }
  }
  return map;
}

async function queryRegistry(installed: Map<string, Set<string>>) {
  const body: Record<string, string[]> = {};
  for (const [name, versions] of installed) body[name] = [...versions];
  let lastError = "";
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });
      if (res.ok) return (await res.json()) as Record<string, never[]>;
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : "network error";
    }
    await new Promise((r) => setTimeout(r, attempt * 2000));
  }
  throw new Error(`Could not reach the advisory service (${lastError})`);
}

async function main(): Promise<number> {
  let installed: Map<string, Set<string>>;
  let response: Record<string, never[]>;
  try {
    installed = installedProdPackages();
    response = await queryRegistry(installed);
  } catch (err) {
    console.error(`ERROR: ${err instanceof Error ? err.message : "audit failed"}`);
    return 2;
  }

  const allowlistPath = path.join(repoRoot, "security/audit-allowlist.json");
  const allowlist = JSON.parse(readFileSync(allowlistPath, "utf8")) as { entries: unknown };
  const today = new Date().toISOString().slice(0, 10);
  const findings = findingsFrom(response, installed);
  const result = evaluate(findings, allowlist.entries, today);

  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return result.ok ? 0 : 1;
  }

  const line = (f: { severity: string; package: string; version: string; id: string; title: string }) =>
    `  [${f.severity}] ${f.package}@${f.version}  ${f.id}  ${f.title}`;
  console.log(`Checked ${installed.size} production packages against the npm advisory database (${today}).`);
  if (result.reported.length) {
    console.log(`\nReported only (moderate/low), ${result.reported.length}:`);
    result.reported.forEach((f) => console.log(line(f)));
  }
  if (result.allowed.length) {
    console.log(`\nAccepted by security/audit-allowlist.json, ${result.allowed.length}:`);
    result.allowed.forEach((f) => console.log(`${line(f)}\n      until ${f.entry.expires}, owner ${f.entry.owner}: ${f.entry.reason}`));
  }
  if (result.stale.length) {
    console.log(`\nStale allowlist entries (no matching finding any more; remove them):`);
    result.stale.forEach((e) => console.log(`  ${e.advisory} ${e.package}`));
  }
  if (result.allowlistErrors.length) {
    console.log(`\nAllowlist problems:`);
    result.allowlistErrors.forEach((e) => console.log(`  ${e}`));
  }
  if (result.failures.length) {
    console.log(`\nBLOCKING (critical/high), ${result.failures.length}:`);
    result.failures.forEach((f) => console.log(`${line(f)}\n      ${f.url}`));
  }
  console.log(result.ok ? "\nPASS" : "\nFAIL");
  return result.ok ? 0 : 1;
}

main().then((c) => process.exit(c));
