/**
 * security-audit.test.ts — the dependency-audit policy (src/lib/security-audit.ts) and the
 * shape of the committed allowlist file. Dates are passed in, so nothing here depends on today's date.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MAX_ALLOWLIST_DAYS,
  compareVersions,
  evaluate,
  findingsFrom,
  inVulnerableRange,
  validateAllowlist,
  type Finding,
} from "../lib/security-audit.js";

const TODAY = "2026-10-09";

const finding = (over: Partial<Finding> = {}): Finding => ({
  id: "GHSA-AAAA-BBBB-CCCC",
  url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc",
  title: "x",
  severity: "high",
  vulnerableVersions: "<2.0.0",
  package: "left-pad",
  version: "1.0.0",
  ...over,
});

const entry = (over: Record<string, unknown> = {}) => ({
  advisory: "GHSA-AAAA-BBBB-CCCC",
  package: "left-pad",
  reason: "build tooling only",
  owner: "[owner]",
  added: "2026-10-01",
  expires: "2026-12-01",
  ...over,
});

describe("version ranges", () => {
  it("compares versions including prereleases", () => {
    expect(compareVersions("1.2.3", "1.10.0")).toBeLessThan(0);
    expect(compareVersions("2.0.0", "2.0.0-rc.1")).toBeGreaterThan(0);
    expect(compareVersions("2.0.0-rc.2", "2.0.0-rc.10")).toBeLessThan(0);
    expect(compareVersions("1.0", "1.0.0")).toBe(0);
  });

  it("matches the range shapes npm advisories use", () => {
    expect(inVulnerableRange("1.1.12", "<1.1.20")).toBe(true);
    expect(inVulnerableRange("1.1.20", "<1.1.20")).toBe(false);
    expect(inVulnerableRange("3.0.3", "<=3.0.3")).toBe(true);
    expect(inVulnerableRange("4.0.3", ">=4.0.0 <4.0.4")).toBe(true);
    expect(inVulnerableRange("5.0.0", ">=4.0.0 <4.0.4")).toBe(false);
    expect(inVulnerableRange("2.5.0", "<1.0.0 || >=2.0.0 <3.0.0")).toBe(true);
    expect(inVulnerableRange("1.5.0", "<1.0.0 || >=2.0.0 <3.0.0")).toBe(false);
    expect(inVulnerableRange("1.0.0", ">= 1.0.0 < 1.0.1")).toBe(true);
    expect(inVulnerableRange("9.9.9", "*")).toBe(true);
  });
});

describe("findingsFrom", () => {
  it("keeps only advisories that cover an installed version and reads the GHSA id", () => {
    const installed = new Map([["left-pad", new Set(["1.0.0", "3.0.0"])]]);
    const out = findingsFrom(
      {
        "left-pad": [
          { id: 1, url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc", title: "t", severity: "high", vulnerable_versions: "<2.0.0" },
        ],
        "not-installed": [{ id: 2, severity: "critical", vulnerable_versions: "*" }],
      },
      installed,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "GHSA-AAAA-BBBB-CCCC", package: "left-pad", version: "1.0.0", severity: "high" });
  });

  it("treats an unparseable range as affected", () => {
    const out = findingsFrom(
      { x: [{ id: 3, severity: "critical", vulnerable_versions: "weird" }] },
      new Map([["x", new Set(["1.0.0"])]]),
    );
    expect(out).toHaveLength(1);
  });
});

describe("evaluate", () => {
  it("fails on critical and high, reports moderate and low", () => {
    const r = evaluate(
      [finding({ severity: "critical" }), finding({ id: "GHSA-1", severity: "high" }), finding({ id: "GHSA-2", severity: "moderate" }), finding({ id: "GHSA-3", severity: "low" })],
      [],
      TODAY,
    );
    expect(r.ok).toBe(false);
    expect(r.failures).toHaveLength(2);
    expect(r.reported).toHaveLength(2);
  });

  it("passes when there is nothing blocking", () => {
    expect(evaluate([finding({ severity: "moderate" })], [], TODAY).ok).toBe(true);
  });

  it("an allowlist entry for the same advisory and package accepts the finding", () => {
    const r = evaluate([finding()], [entry()], TODAY);
    expect(r.ok).toBe(true);
    expect(r.allowed).toHaveLength(1);
    expect(r.stale).toHaveLength(0);
  });

  it("does not accept a different package or advisory", () => {
    expect(evaluate([finding({ package: "other" })], [entry()], TODAY).ok).toBe(false);
    expect(evaluate([finding({ id: "GHSA-ZZZZ" })], [entry()], TODAY).ok).toBe(false);
  });

  it("an expired entry fails the job and no longer accepts the finding", () => {
    const r = evaluate([finding()], [entry({ expires: "2026-10-08" })], TODAY);
    expect(r.ok).toBe(false);
    expect(r.failures).toHaveLength(1);
    expect(r.allowlistErrors.join(" ")).toMatch(/EXPIRED/);
  });

  it("an entry that expires today is still valid, and a stale one is reported", () => {
    expect(evaluate([finding()], [entry({ expires: TODAY })], TODAY).ok).toBe(true);
    const r = evaluate([], [entry()], TODAY);
    expect(r.ok).toBe(true);
    expect(r.stale).toHaveLength(1);
  });
});

describe("validateAllowlist", () => {
  it("rejects missing fields, bad dates and entries longer than the maximum", () => {
    expect(validateAllowlist([entry({ reason: "" })], TODAY).errors.join(" ")).toMatch(/"reason" is required/);
    expect(validateAllowlist([entry({ owner: undefined })], TODAY).errors.join(" ")).toMatch(/"owner" is required/);
    expect(validateAllowlist([entry({ expires: "tomorrow" })], TODAY).errors.join(" ")).toMatch(/YYYY-MM-DD/);
    expect(validateAllowlist([entry({ added: "2026-10-01", expires: "2027-03-01" })], TODAY).errors.join(" ")).toMatch(
      new RegExp(`maximum is ${MAX_ALLOWLIST_DAYS}`),
    );
    expect(validateAllowlist([entry({ added: "2026-10-05", expires: "2026-10-01" })], TODAY).errors.join(" ")).toMatch(/before it was added/);
    expect(validateAllowlist("nope", TODAY).errors).toHaveLength(1);
  });

  it("accepts exactly the maximum span", () => {
    expect(validateAllowlist([entry({ added: "2026-10-09", expires: "2027-01-07" })], TODAY).errors).toEqual([]);
  });
});

describe("security/audit-allowlist.json (the committed file)", () => {
  // Expiry is deliberately NOT checked here: an expired entry must fail the "Dependency audit"
  // job, not every other pull request's Test job.
  it("is well formed (fields, dates, 90-day maximum)", () => {
    const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../security/audit-allowlist.json");
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { entries: unknown };
    const { errors } = validateAllowlist(parsed.entries, "2000-01-01");
    expect(errors).toEqual([]);
  });
});
