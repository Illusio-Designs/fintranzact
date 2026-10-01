import { and, eq, inArray } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { TRPCError } from "@trpc/server";
import { items, itemVariants, type TenantDatabase } from "@fintranzact/db";

/** A tenant table with an `id` and a `businessId` column. */
type BusinessTable = PgTable & { id: PgColumn; businessId: PgColumn };

type Reader = Pick<TenantDatabase, "select">;

function distinct(ids: string | null | undefined | Array<string | null | undefined>): string[] {
  const list = Array.isArray(ids) ? ids : [ids];
  return [...new Set(list.filter((id): id is string => !!id))];
}

/**
 * Throws BAD_REQUEST unless every given id is a row of `table` in business
 * `businessId`. Null/undefined ids are skipped.
 *
 * Every id a client sends as a reference (a bank account on an expense, an
 * invoice in a payment allocation, …) has to go through a check like this
 * before it is stored: tenant databases are shared by every business of an
 * organisation — and, in self-hosted mode, by every organisation — so a
 * foreign id would otherwise be stored and later joined back, showing or
 * changing another business's records.
 */
export async function assertInBusiness(
  db: Reader,
  table: BusinessTable,
  ids: string | null | undefined | Array<string | null | undefined>,
  businessId: string,
  what: string,
): Promise<void> {
  const wanted = distinct(ids);
  if (wanted.length === 0) return;
  const rows = await db
    .select({ id: table.id })
    .from(table)
    .where(and(inArray(table.id, wanted), eq(table.businessId, businessId)));
  if (rows.length !== wanted.length) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `${what} not found in this business` });
  }
}

/** assertInBusiness for item variants, which belong to a business through their item. */
export async function assertVariantsInBusiness(
  db: Reader,
  variantIds: string | null | undefined | Array<string | null | undefined>,
  businessId: string,
): Promise<void> {
  const wanted = distinct(variantIds);
  if (wanted.length === 0) return;
  const rows = await db
    .select({ id: itemVariants.id })
    .from(itemVariants)
    .innerJoin(items, eq(items.id, itemVariants.itemId))
    .where(and(inArray(itemVariants.id, wanted), eq(items.businessId, businessId)));
  if (rows.length !== wanted.length) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Item variant not found in this business" });
  }
}
