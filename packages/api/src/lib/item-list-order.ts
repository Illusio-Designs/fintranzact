import { asc, desc, sql, type SQL } from "drizzle-orm";
import { items, itemVariants } from "@fintranzact/db";
import { z } from "zod";

/** How the Stock Items list can be sorted. No sort means recently changed first. */
export const itemSortSchema = {
  sortBy: z.enum(["name", "stock", "price"]).nullish(),
  sortDir: z.enum(["asc", "desc"]).nullish(),
};

type SortBy = "name" | "stock" | "price";

/**
 * ORDER BY for the Stock Items list. Stock sorts by what the list shows:
 * a variant item's stock is the sum of its live variants, not its own
 * (unused) column. Items without a sale price go last either way. Always
 * ends with updated time and id so tied rows keep one fixed order and no
 * row shows up on two pages.
 */
export function itemListOrder(sortBy?: SortBy | null, sortDir?: "asc" | "desc" | null): SQL[] {
  // With no sort the list keeps its old order: recently changed first.
  if (!sortBy) return [desc(items.updatedAt), desc(items.id)];
  const up = sortDir !== "desc";
  const dir = up ? asc : desc;
  let primary: SQL;
  switch (sortBy) {
    case "stock": {
      const stock = sql`CASE WHEN ${items.itemMode} = 'variants' THEN (SELECT COALESCE(SUM(${itemVariants.stockQuantity}::numeric), 0) FROM ${itemVariants} WHERE ${itemVariants.itemId} = ${items.id} AND ${itemVariants.deletedAt} IS NULL) ELSE ${items.stockQuantity}::numeric END`;
      primary = up ? sql`${stock} ASC` : sql`${stock} DESC`;
      break;
    }
    case "price":
      primary = up ? sql`${items.salePrice}::numeric ASC NULLS LAST` : sql`${items.salePrice}::numeric DESC NULLS LAST`;
      break;
    default:
      primary = up ? sql`lower(${items.name}) ASC` : sql`lower(${items.name}) DESC`;
  }
  return [primary, dir(items.updatedAt), dir(items.id)];
}
