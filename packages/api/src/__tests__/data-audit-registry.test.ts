/**
 * The data audit covers every tenant table: each has rules, or states why it
 * needs none beyond its constraints. Adding a table to tenant-schema.ts
 * without deciding its rules fails here.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ALL_RULES, TABLE_COVERAGE } from "../lib/data-audit/registry.js";

const schemaPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../db/src/tenant-schema.ts");
const tenantTables = [...readFileSync(schemaPath, "utf8").matchAll(/pgTable\(\s*"([a-z0-9_]+)"/g)].map((m) => m[1]!).sort();

describe("data audit registry", () => {
  it("has one coverage entry per tenant table", () => {
    expect(tenantTables.length).toBeGreaterThan(40);
    expect(TABLE_COVERAGE.map((t) => t.table).sort()).toEqual(tenantTables);
  });

  it("explains every table without rules", () => {
    for (const t of TABLE_COVERAGE) {
      if (t.rules.length === 0) expect(t.noExtraRequirements?.length ?? 0, t.table).toBeGreaterThan(30);
      else expect(t.noExtraRequirements, t.table).toBeUndefined();
    }
  });

  it("gives every rule a unique id under its table, a description, writers and the result columns", () => {
    const ids = ALL_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of TABLE_COVERAGE) {
      for (const r of t.rules) {
        expect(r.table).toBe(t.table);
        expect(r.id.startsWith(`${t.table}.`)).toBe(true);
        expect(r.description.length).toBeGreaterThan(20);
        expect(r.writers.length).toBeGreaterThan(0);
        expect(r.sql).toMatch(/^\s*(SELECT|WITH)\b/i);
      }
    }
  });
});
