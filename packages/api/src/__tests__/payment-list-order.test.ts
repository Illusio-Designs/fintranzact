import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { paymentListOrder } from "../lib/payment-list-order.js";

// The ORDER BY the payments list uses, as SQL text.
const orderSql = (...args: Parameters<typeof paymentListOrder>) =>
  new PgDialect().sqlToQuery(sql.join(paymentListOrder(...args), sql`, `)).sql;

describe("paymentListOrder", () => {
  it("sorts newest payment date first when no sort is given", () => {
    expect(orderSql()).toMatch(/^"payments"\."payment_date" desc/);
  });

  it("always ends with created time and id so tied rows never appear on two pages", () => {
    for (const by of ["date", "amount", "party"] as const) {
      expect(orderSql(by, "asc")).toMatch(/"payments"\."created_at" asc, "payments"\."id" asc$/);
      expect(orderSql(by, "desc")).toMatch(/"payments"\."created_at" desc, "payments"\."id" desc$/);
    }
  });

  it("sorts amounts as numbers and party names ignoring case", () => {
    expect(orderSql("amount", "desc")).toMatch(/^"payments"\."amount"::numeric DESC/);
    expect(orderSql("party", "asc")).toMatch(/^lower\("parties"\."name"\) ASC, "payments"\."payment_date" desc/);
  });
});
