/**
 * docker-entrypoint.sh behaviour, run for real with a fake `node` on PATH.
 *
 * The default (migrate, then start the server) is what Railway and the
 * docker-compose files rely on and must never change. `migrate` and
 * RUN_MIGRATIONS=false are opt-in switches used by the AWS ECS deploy, which runs
 * migrations as a separate one-off task before the service is updated.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const entrypoint = resolve(here, "../../../../docker-entrypoint.sh");

let dir: string;
let log: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "entrypoint-test-"));
  log = join(dir, "calls.log");
  // Fake node: records its arguments, fails the migration when FAIL_MIGRATE is set.
  writeFileSync(
    join(dir, "node"),
    [
      "#!/bin/sh",
      'if [ "$1" = "--version" ]; then echo v22.0.0; exit 0; fi',
      'echo "$@" >> "$CALL_LOG"',
      'case "$1" in',
      '  *migrate.mjs) if [ -n "$FAIL_MIGRATE" ]; then exit 1; fi ;;',
      "esac",
      "exit 0",
      "",
    ].join("\n"),
  );
  chmodSync(join(dir, "node"), 0o755);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function run(args: string[], env: Record<string, string>) {
  rmSync(log, { force: true });
  const result = spawnSync("sh", [entrypoint, ...args], {
    env: { PATH: `${dir}:/usr/bin:/bin`, CALL_LOG: log, ...env },
    encoding: "utf-8",
  });
  const calls = existsSync(log) ? readFileSync(log, "utf-8").trim().split("\n").filter(Boolean) : [];
  return { status: result.status, out: `${result.stdout}${result.stderr}`, calls };
}

const migrateCall = "/app/packages/db/dist/migrate.mjs";
const serverCall = "packages/api/dist/server.js";

describe("docker-entrypoint.sh", () => {
  it("fails fast without DATABASE_URL", () => {
    const r = run([], {});
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/FATAL.*DATABASE_URL/);
    expect(r.calls).toEqual([]);
  });

  it("default: migrates, then starts the server (unchanged behaviour)", () => {
    const r = run([], { DATABASE_URL: "postgresql://x" });
    expect(r.status).toBe(0);
    expect(r.calls).toEqual([migrateCall, serverCall]);
  });

  it("default: a failed migration stops the start", () => {
    const r = run([], { DATABASE_URL: "postgresql://x", FAIL_MIGRATE: "1" });
    expect(r.status).toBe(1);
    expect(r.calls).toEqual([migrateCall]);
    expect(r.out).toContain("Migration failed");
  });

  it("migrate: runs the migrations and exits without starting the server", () => {
    const r = run(["migrate"], { DATABASE_URL: "postgresql://x" });
    expect(r.status).toBe(0);
    expect(r.calls).toEqual([migrateCall]);
  });

  it("migrate: exits non-zero when the migration fails", () => {
    const r = run(["migrate"], { DATABASE_URL: "postgresql://x", FAIL_MIGRATE: "1" });
    expect(r.status).toBe(1);
    expect(r.calls).toEqual([migrateCall]);
  });

  it("RUN_MIGRATIONS=false: skips the migrations and starts the server", () => {
    const r = run([], { DATABASE_URL: "postgresql://x", RUN_MIGRATIONS: "false" });
    expect(r.status).toBe(0);
    expect(r.calls).toEqual([serverCall]);
  });

  it("RUN_MIGRATIONS=true (or anything but false) still migrates", () => {
    const r = run([], { DATABASE_URL: "postgresql://x", RUN_MIGRATIONS: "true" });
    expect(r.calls).toEqual([migrateCall, serverCall]);
  });
});
