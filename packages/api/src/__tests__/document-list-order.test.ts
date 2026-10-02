import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { documentListOrder } from "../lib/document-list-order.js";

// The ORDER BY a document list uses, as SQL text.
const orderSql = (...args: Parameters<typeof documentListOrder>) =>
  new PgDialect().sqlToQuery(sql.join(documentListOrder(...args), sql`, `)).sql;

describe("documentListOrder", () => {
  it("sorts invoices newest first by date when no sort is given", () => {
    expect(orderSql()).toMatch(/^"invoices"\."invoice_date" desc/);
  });

  it("sorts other document lists by when they were added when no sort is given", () => {
    expect(orderSql(null, null, "created")).toMatch(/^"invoices"\."created_at" desc/);
  });

  it("always ends with created time and id so tied rows never appear on two pages", () => {
    for (const by of ["date", "amount", "number", "party", "due", "created"] as const) {
      expect(orderSql(by, "asc")).toMatch(/"invoices"\."created_at" asc, "invoices"\."id" asc$/);
      expect(orderSql(by, "desc")).toMatch(/"invoices"\."created_at" desc, "invoices"\."id" desc$/);
    }
  });

  it("sorts by party name ignoring case, and puts missing due dates last", () => {
    expect(orderSql("party", "asc")).toMatch(/^lower\("parties"\."name"\) ASC/);
    expect(orderSql("due", "desc")).toMatch(/^"invoices"\."due_date" DESC NULLS LAST/);
  });
});
