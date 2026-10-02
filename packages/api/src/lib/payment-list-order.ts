import { asc, desc, sql, type SQL } from "drizzle-orm";
import { payments, parties } from "@fintranzact/db";
import { z } from "zod";

/** How the payments list can be sorted. */
export const paymentSortSchema = {
  sortBy: z.enum(["date", "amount", "party"]).nullish(),
  sortDir: z.enum(["asc", "desc"]).nullish(),
};

type SortBy = "date" | "amount" | "party";

/**
 * ORDER BY for the payments list (the query must join `parties`). With no
 * sort given it stays newest payment date first, as before. Ends with created
 * time and id so rows that tie (same date, same amount) keep one fixed order,
 * and no row shows up on two pages.
 */
export function paymentListOrder(sortBy?: SortBy | null, sortDir?: "asc" | "desc" | null): SQL[] {
  const dir = sortDir === "asc" ? asc : desc;
  const up = sortDir === "asc";
  let primary: SQL[];
  switch (sortBy ?? "date") {
    case "amount":
      primary = [up ? sql`${payments.amount}::numeric ASC` : sql`${payments.amount}::numeric DESC`];
      break;
    case "party":
      // Same party: newest payment first.
      primary = [up ? sql`lower(${parties.name}) ASC` : sql`lower(${parties.name}) DESC`, desc(payments.paymentDate)];
      break;
    default:
      primary = [dir(payments.paymentDate)];
  }
  return [...primary, dir(payments.createdAt), dir(payments.id)];
}
