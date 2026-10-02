import { asc, desc, sql, type SQL } from "drizzle-orm";
import { invoices, parties } from "@fintranzact/db";
import { z } from "zod";

/** How a list of invoices or other documents can be sorted. */
export const documentSortSchema = {
  sortBy: z.enum(["date", "amount", "number", "party", "due", "created"]).nullish(),
  sortDir: z.enum(["asc", "desc"]).nullish(),
};

type SortBy = "date" | "amount" | "number" | "party" | "due" | "created";

/**
 * ORDER BY for a document list (the query must join `parties`). With no
 * sort given, `fallback` decides: document date (invoices) or when it was
 * added (quotations, orders and the other document lists). Ends with created time and id so rows that tie (same date, same
 * amount) keep one fixed order, and no row shows up on two pages.
 */
export function documentListOrder(
  sortBy?: SortBy | null,
  sortDir?: "asc" | "desc" | null,
  fallback: "date" | "created" = "date",
): SQL[] {
  const dir = sortDir === "asc" ? asc : desc;
  const up = sortDir === "asc";
  let primary: SQL[];
  switch (sortBy ?? fallback) {
    case "amount":
      primary = [up ? sql`${invoices.totalAmount}::numeric ASC` : sql`${invoices.totalAmount}::numeric DESC`];
      break;
    case "number":
      primary = [dir(invoices.invoiceNumber)];
      break;
    case "party":
      primary = [up ? sql`lower(${parties.name}) ASC` : sql`lower(${parties.name}) DESC`, desc(invoices.invoiceDate)];
      break;
    case "due":
      // Documents without a due date go last either way.
      primary = [up ? sql`${invoices.dueDate} ASC NULLS LAST` : sql`${invoices.dueDate} DESC NULLS LAST`];
      break;
    case "created":
      primary = [];
      break;
    default:
      primary = [dir(invoices.invoiceDate)];
  }
  return [...primary, dir(invoices.createdAt), dir(invoices.id)];
}
