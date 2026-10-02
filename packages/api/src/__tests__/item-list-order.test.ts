import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { itemListOrder } from "../lib/item-list-order.js";

// The ORDER BY the Stock Items list uses, as SQL text.
const orderSql = (...args: Parameters<typeof itemListOrder>) =>
  new PgDialect().sqlToQuery(sql.join(itemListOrder(...args), sql`, `)).sql;

describe("itemListOrder", () => {
  it("keeps recently changed items first when no sort is given", () => {
    expect(orderSql()).toBe(`"items"."updated_at" desc, "items"."id" desc`);
  });

  it("always ends with updated time and id so tied rows never appear on two pages", () => {
    for (const by of ["name", "stock", "price"] as const) {
      expect(orderSql(by, "asc")).toMatch(/"items"\."updated_at" asc, "items"\."id" asc$/);
      expect(orderSql(by, "desc")).toMatch(/"items"\."updated_at" desc, "items"\."id" desc$/);
    }
  });

  it("sorts by name ignoring case", () => {
    expect(orderSql("name", "asc")).toMatch(/^lower\("items"\."name"\) ASC/);
  });

  it("sorts variant items by the stock of their live variants", () => {
    const q = orderSql("stock", "asc");
    expect(q).toMatch(/^CASE WHEN "items"\."item_mode" = 'variants'/);
    expect(q).toContain(`"item_variants"."deleted_at" IS NULL`);
    expect(q).toContain(`ELSE "items"."stock_quantity"::numeric END ASC`);
  });

  it("puts items without a sale price last", () => {
    expect(orderSql("price", "desc")).toMatch(/^"items"\."sale_price"::numeric DESC NULLS LAST/);
    expect(orderSql("price", "asc")).toMatch(/^"items"\."sale_price"::numeric ASC NULLS LAST/);
  });
});
