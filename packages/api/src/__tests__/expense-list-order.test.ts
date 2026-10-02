import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { expenseListOrder } from "../lib/expense-list-order.js";

// The ORDER BY the expense list uses, as SQL text.
const orderSql = (...args: Parameters<typeof expenseListOrder>) =>
  new PgDialect().sqlToQuery(sql.join(expenseListOrder(...args), sql`, `)).sql;

describe("expenseListOrder", () => {
  it("sorts newest expense date first when no sort is given, as before", () => {
    expect(orderSql()).toBe(
      '"expenses"."expense_date" desc, "expenses"."created_at" desc, "expenses"."id" desc',
    );
  });

  it("always ends with created time and id so tied rows never appear on two pages", () => {
    for (const by of ["date", "amount", "category"] as const) {
      expect(orderSql(by, "asc")).toMatch(/"expenses"\."created_at" asc, "expenses"\."id" asc$/);
      expect(orderSql(by, "desc")).toMatch(/"expenses"\."created_at" desc, "expenses"\."id" desc$/);
    }
  });

  it("sorts by amount and oldest date in the asked direction", () => {
    expect(orderSql("amount", "desc")).toMatch(/^"expenses"\."amount" desc/);
    expect(orderSql("amount", "asc")).toMatch(/^"expenses"\."amount" asc/);
    expect(orderSql("date", "asc")).toMatch(/^"expenses"\."expense_date" asc/);
  });

  it("sorts by category ignoring case, newest first within a category", () => {
    expect(orderSql("category", "asc")).toMatch(/^lower\("expenses"\."category"\) ASC, "expenses"\."expense_date" desc/);
  });
});
