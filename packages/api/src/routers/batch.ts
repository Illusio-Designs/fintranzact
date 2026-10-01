/**
 * Batch / lot master for items that track batches (see lib/batches).
 *
 * Stock per batch is read from the movement ledger, per warehouse. Batches
 * come into being on inward documents, opening stock and adjustments, or
 * here by hand; a batch that has moved stock or sits on a document line
 * can't be deleted.
 */
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { itemBatches, items, itemVariants } from "@fintranzact/db";
import { batchFieldsSchema, dateOnlyStr } from "@fintranzact/shared";
import { router, viewerProcedure, memberProcedure, adminProcedure } from "../trpc.js";
import { requireCan } from "../lib/permissions.js";
import { logAudit, withAudit } from "../lib/audit.js";
import { assertBatchFields, businessDay, findOrCreateBatch } from "../lib/batches.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

const round3 = (n: number) => Math.round(n * 1000) / 1000;

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

async function assertItem(tx: Tx, businessId: string, itemId: string, variantId?: string | null) {
  const [item] = await tx
    .select({ id: items.id, name: items.name, trackExpiry: items.trackExpiry })
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.businessId, businessId)))
    .limit(1);
  if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Item not found" });
  if (variantId) {
    const [v] = await tx
      .select({ id: itemVariants.id })
      .from(itemVariants)
      .where(and(eq(itemVariants.id, variantId), eq(itemVariants.itemId, itemId)))
      .limit(1);
    if (!v) throw new TRPCError({ code: "NOT_FOUND", message: "Variant not found" });
  }
  return item as { id: string; name: string; trackExpiry: boolean };
}

async function getBatch(tx: Tx, businessId: string, id: string) {
  const [b] = await tx
    .select()
    .from(itemBatches)
    .where(and(eq(itemBatches.id, id), eq(itemBatches.businessId, businessId)))
    .limit(1);
  if (!b) throw new TRPCError({ code: "NOT_FOUND", message: "Batch not found" });
  return b as typeof itemBatches.$inferSelect;
}

export const batchRouter = router({
  /**
   * An item's batches, earliest expiry first, with the stock each holds —
   * in one warehouse, or in total with the split by warehouse. `unbatched`
   * is stock of the item no batch accounts for (from before tracking).
   */
  list: viewerProcedure
    .input(z.object({
      itemId: z.string().uuid(),
      variantId: z.string().uuid().nullish(),
      warehouseId: z.string().uuid().nullish(),
      /** Include batches with no stock (default: only batches holding stock). */
      includeEmpty: z.boolean().default(false),
      /** Judge expiry as of this date (a document's date); default today. */
      asOf: dateOnlyStr.nullish(),
    }))
    .query(async ({ ctx, input }) => {
      requireCan(ctx.ability, "read", "Item");
      const day = input.asOf ?? businessDay();
      const variantCond = input.variantId ? sql`b.variant_id = ${input.variantId}` : sql`b.variant_id IS NULL`;
      const rows = (await ctx.db.execute(sql`
        SELECT b.id, b.batch_number AS "batchNumber", b.mfg_date::text AS "mfgDate",
               b.expiry_date::text AS "expiryDate", b.mrp::text AS mrp, b.created_at AS "createdAt",
               COALESCE((
                 SELECT json_object_agg(s.warehouse_id, s.qty) FROM (
                   SELECT m.warehouse_id, SUM(m.quantity::numeric)::text AS qty
                   FROM stock_movements m
                   WHERE m.business_id = ${ctx.businessId} AND m.batch_id = b.id
                   GROUP BY m.warehouse_id
                   HAVING SUM(m.quantity::numeric) <> 0
                 ) s
               ), '{}'::json) AS "byWarehouse"
        FROM item_batches b
        WHERE b.business_id = ${ctx.businessId} AND b.item_id = ${input.itemId} AND ${variantCond}
        ORDER BY b.expiry_date ASC NULLS LAST, b.created_at, b.batch_number
      `)) as unknown as Array<{
        id: string; batchNumber: string; mfgDate: string | null; expiryDate: string | null;
        mrp: string | null; createdAt: string; byWarehouse: Record<string, string>;
      }>;

      const [pool] = (await ctx.db.execute(sql`
        SELECT COALESCE(SUM(quantity::numeric), 0)::text AS qty
        FROM stock_movements
        WHERE business_id = ${ctx.businessId} AND item_id = ${input.itemId} AND batch_id IS NULL
          AND ${input.variantId ? sql`variant_id = ${input.variantId}` : sql`variant_id IS NULL`}
          ${input.warehouseId ? sql`AND warehouse_id = ${input.warehouseId}` : sql``}
      `)) as unknown as Array<{ qty: string }>;

      const data = rows
        .map((r) => {
          const quantity = input.warehouseId
            ? parseFloat(r.byWarehouse[input.warehouseId] ?? "0")
            : Object.values(r.byWarehouse).reduce((s, v) => s + parseFloat(v), 0);
          const daysToExpiry = r.expiryDate ? daysBetween(day, r.expiryDate) : null;
          return {
            ...r,
            quantity: round3(quantity).toFixed(3),
            expired: daysToExpiry !== null && daysToExpiry < 0,
            daysToExpiry,
          };
        })
        .filter((r) => input.includeEmpty || Math.abs(parseFloat(r.quantity)) >= 0.0005);
      return { data, unbatched: round3(parseFloat(pool?.qty ?? "0")).toFixed(3), asOf: day };
    }),

  /** Add a batch by hand (inward documents create them as they go too). */
  create: memberProcedure
    .input(batchFieldsSchema.extend({
      itemId: z.string().uuid(),
      variantId: z.string().uuid().nullish(),
    }))
    .mutation(withAudit(async ({ ctx, input }) => {
      requireCan(ctx.ability, "update", "Item");
      return ctx.db.transaction(async (tx: Tx) => {
        const item = await assertItem(tx, ctx.businessId, input.itemId, input.variantId);
        const variantCond = input.variantId
          ? eq(itemBatches.variantId, input.variantId)
          : sql`${itemBatches.variantId} IS NULL`;
        const [dup] = await tx
          .select({ id: itemBatches.id })
          .from(itemBatches)
          .where(and(
            eq(itemBatches.businessId, ctx.businessId),
            eq(itemBatches.itemId, input.itemId),
            variantCond,
            eq(itemBatches.batchNumber, input.batchNumber.trim()),
          ))
          .limit(1);
        if (dup) throw new TRPCError({ code: "CONFLICT", message: `${item.name} already has batch ${input.batchNumber.trim()}` });
        return findOrCreateBatch(tx, {
          businessId: ctx.businessId,
          itemId: input.itemId,
          variantId: input.variantId ?? null,
          itemName: item.name,
          batchNumber: input.batchNumber,
          mfgDate: input.mfgDate,
          expiryDate: input.expiryDate,
          mrp: input.mrp,
          requireExpiry: item.trackExpiry,
        });
      });
    }, (r) => ({ action: "batch.create", entityType: "item_batch", entityId: r.id, metadata: { batchNumber: r.batchNumber, itemId: r.itemId } }))),

  /** Correct a batch's number, dates or MRP. */
  update: memberProcedure
    .input(z.object({
      id: z.string().uuid(),
      batchNumber: z.string().trim().min(1).max(60).optional(),
      mfgDate: dateOnlyStr.nullish(),
      expiryDate: dateOnlyStr.nullish(),
      mrp: z.string().regex(/^\d{1,13}(\.\d{1,2})?$/).nullish(),
    }))
    .mutation(async ({ ctx, input }) => {
      requireCan(ctx.ability, "update", "Item");
      return ctx.db.transaction(async (tx: Tx) => {
        const before = await getBatch(tx, ctx.businessId, input.id);
        const next = {
          batchNumber: input.batchNumber ?? before.batchNumber,
          mfgDate: input.mfgDate !== undefined ? input.mfgDate : before.mfgDate,
          expiryDate: input.expiryDate !== undefined ? input.expiryDate : before.expiryDate,
          mrp: input.mrp !== undefined ? input.mrp : before.mrp,
        };
        assertBatchFields(next);
        if (next.batchNumber !== before.batchNumber) {
          const [dup] = await tx
            .select({ id: itemBatches.id })
            .from(itemBatches)
            .where(and(
              eq(itemBatches.businessId, ctx.businessId),
              eq(itemBatches.itemId, before.itemId),
              before.variantId ? eq(itemBatches.variantId, before.variantId) : sql`${itemBatches.variantId} IS NULL`,
              eq(itemBatches.batchNumber, next.batchNumber),
            ))
            .limit(1);
          if (dup) throw new TRPCError({ code: "CONFLICT", message: `This item already has batch ${next.batchNumber}` });
        }
        const [updated] = await tx
          .update(itemBatches)
          .set({ ...next, updatedAt: new Date() })
          .where(eq(itemBatches.id, before.id))
          .returning();
        logAudit(ctx.db, {
          businessId: ctx.businessId,
          userId: ctx.user.id,
          action: "batch.update",
          entityType: "item_batch",
          entityId: before.id,
          metadata: { before: { batchNumber: before.batchNumber, expiryDate: before.expiryDate }, after: { batchNumber: next.batchNumber, expiryDate: next.expiryDate } },
          ipAddress: ctx.ipAddress,
        });
        return updated;
      });
    }),

  /** Remove a batch nothing refers to (typed in by mistake). */
  delete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(withAudit(async ({ ctx, input }) => {
      requireCan(ctx.ability, "delete", "Item");
      return ctx.db.transaction(async (tx: Tx) => {
        const batch = await getBatch(tx, ctx.businessId, input.id);
        const [used] = (await tx.execute(sql`
          SELECT EXISTS (SELECT 1 FROM stock_movements WHERE batch_id = ${batch.id})
              OR EXISTS (SELECT 1 FROM invoice_items WHERE batch_id = ${batch.id}) AS used
        `)) as unknown as Array<{ used: boolean }>;
        if (used?.used) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "This batch has stock movements or document lines, so it can't be deleted" });
        }
        await tx.delete(itemBatches).where(eq(itemBatches.id, batch.id));
        return { success: true };
      });
    }, (_r, input) => ({ action: "batch.delete", entityType: "item_batch", entityId: input.id }))),
});
