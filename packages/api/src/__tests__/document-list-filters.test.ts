import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { and } from "drizzle-orm";
import { documentFilterConditions } from "../lib/document-list-filters.js";

// The WHERE clause the "+ Filter" choices add, as SQL text and parameters.
const where = (f: Parameters<typeof documentFilterConditions>[0]) => {
  const conds = documentFilterConditions(f);
  return conds.length ? new PgDialect().sqlToQuery(and(...conds)!) : null;
};

describe("documentFilterConditions", () => {
  it("adds nothing when no filter is set", () => {
    expect(where({})).toBeNull();
    expect(where({ partyIds: [], source: [] })).toBeNull();
  });

  it("matches any of several parties", () => {
    const q = where({ partyIds: ["a8d3c1de-0000-4000-8000-000000000001", "a8d3c1de-0000-4000-8000-000000000002"] })!;
    expect(q.sql).toContain('"invoices"."party_id" in ($1, $2)');
  });

  it("keeps amounts inside the range, both ends included", () => {
    const q = where({ minAmount: 5000, maxAmount: 20000 })!;
    expect(q.sql).toContain('"invoices"."total_amount"::numeric >= $1');
    expect(q.sql).toContain('"invoices"."total_amount"::numeric <= $2');
    expect(q.params).toEqual([5000, 20000]);
  });

  it("finds documents due in the coming days, or with no due date", () => {
    expect(where({ due: "next7" })!.params).toEqual([8]);
    expect(where({ due: "none" })!.sql).toContain('"invoices"."due_date" is null');
  });

  it("treats no source as typed in the app, and any other source as imported", () => {
    const q = where({ source: ["manual", "pos", "import"] })!;
    expect(q.sql).toContain('"invoices"."source" IS NULL OR "invoices"."source" in ($1)');
    expect(q.sql).toContain("NOT IN ('pos', 'online_store', 'webhook')");
    expect(q.params).toEqual(["pos"]);
  });
});
