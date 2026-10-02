import { asc, desc, sql, type SQL } from "drizzle-orm";
import { expenses } from "@fintranzact/db";
import { z } from "zod";

/** How the expense list can be sorted. Each key maps to a real column. */
export const expenseSortSchema = {
  sortBy: z.enum(["date", "amount", "category"]).nullish(),
  sortDir: z.enum(["asc", "desc"]).nullish(),
};

type SortBy = "date" | "amount" | "category";

/**
 * ORDER BY for the expense list. With no sort given it keeps the old order
 * (newest expense date first). Ends with created time and id so rows that
 * tie (same date, same amount) keep one fixed order, and no row shows up on
 * two pages.
 */
export function expenseListOrder(sortBy?: SortBy | null, sortDir?: "asc" | "desc" | null): SQL[] {
  const dir = sortDir === "asc" ? asc : desc;
  const up = sortDir === "asc";
  let primary: SQL[];
  switch (sortBy ?? "date") {
    case "amount":
      primary = [dir(expenses.amount)];
      break;
    case "category":
      // Ignore case so "rent" and "Rent" sit together; newest first within a category.
      primary = [up ? sql`lower(${expenses.category}) ASC` : sql`lower(${expenses.category}) DESC`, desc(expenses.expenseDate)];
      break;
    default:
      primary = [dir(expenses.expenseDate)];
  }
  return [...primary, dir(expenses.createdAt), dir(expenses.id)];
}
