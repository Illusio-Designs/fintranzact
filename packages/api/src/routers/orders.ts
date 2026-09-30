/**
 * What is still pending on sales orders, purchase orders, GRNs and delivery
 * challans, and short-closing them. The documents themselves are created,
 * listed and converted through their own routers and document.convert.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { invoices } from "@fintranzact/db";
import { pendingOrdersInputSchema, type PendingTrackedDocumentType } from "@fintranzact/shared";
import { router, viewerProcedure, memberProcedure } from "../trpc.js";
import { requireCan } from "../lib/permissions.js";
import { logAudit } from "../lib/audit.js";
import { FULFILLED_BY, fulfilmentStatus, isPendingTracked, listPendingLines, loadPendingLines, loadRejectedLines } from "../lib/order-fulfilment.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

async function findTracked(db: Db, businessId: string, id: string) {
  const [doc] = await db
    .select({
      id: invoices.id,
      documentType: invoices.documentType,
      invoiceNumber: invoices.invoiceNumber,
      status: invoices.status,
      deletedAt: invoices.deletedAt,
      closedAt: invoices.closedAt,
    })
    .from(invoices)
    .where(and(eq(invoices.id, id), eq(invoices.businessId, businessId)))
    .limit(1);
  if (!doc || !isPendingTracked(doc.documentType)) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
  }
  return doc as { id: string; documentType: PendingTrackedDocumentType; invoiceNumber: string; status: string; deletedAt: Date | null; closedAt: Date | null };
}

export const ordersRouter = router({
  /** Open lines with ordered, fulfilled and pending quantities — the pending order/challan/GRN reports. */
  pending: viewerProcedure
    .input(pendingOrdersInputSchema)
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Invoice");
      return listPendingLines(ctx.db, ctx.businessId, input);
    }),

  /** One document's lines with what is pending (billed and free), and the documents made from it. */
  fulfilment: viewerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Invoice");
      const doc = await findTracked(ctx.db, ctx.businessId, input.id);
      const [lines, rejections, linked] = await Promise.all([
        loadPendingLines(ctx.db, ctx.businessId, [doc.id]).then((m) => m.get(doc.id) ?? []),
        doc.documentType === "goods_receipt_note" ? loadRejectedLines(ctx.db, ctx.businessId, doc.id) : Promise.resolve([]),
        ctx.db
          .select({
            id: invoices.id,
            documentType: invoices.documentType,
            type: invoices.type,
            invoiceNumber: invoices.invoiceNumber,
            invoiceDate: invoices.invoiceDate,
            status: invoices.status,
            totalAmount: invoices.totalAmount,
          })
          .from(invoices)
          .where(and(
            eq(invoices.businessId, ctx.businessId),
            eq(invoices.referenceDocumentId, doc.id),
            // A GRN's rejected goods go back on purchase returns and debit notes.
            inArray(invoices.documentType, doc.documentType === "goods_receipt_note"
              ? [...FULFILLED_BY[doc.documentType], "purchase_return", "debit_note"]
              : FULFILLED_BY[doc.documentType]),
            isNull(invoices.deletedAt),
          ))
          .orderBy(invoices.invoiceDate, invoices.createdAt),
      ]);
      return {
        id: doc.id,
        documentType: doc.documentType,
        status: fulfilmentStatus(doc, lines),
        closedAt: doc.closedAt,
        convertsTo: FULFILLED_BY[doc.documentType],
        lines,
        /** GRNs: goods rejected on receipt, and how much has gone back to the supplier. */
        rejections,
        linkedDocuments: linked,
      };
    }),

  /** Short-close: nothing more is expected against it, whatever is still pending. */
  close: memberProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "Invoice");
      const doc = await findTracked(ctx.db, ctx.businessId, input.id);
      if (doc.deletedAt || doc.status === "cancelled") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "A cancelled document can't be closed" });
      }
      if (doc.closedAt) return { success: true };
      await ctx.db
        .update(invoices)
        .set({ closedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(invoices.id, doc.id), eq(invoices.businessId, ctx.businessId), sql`${invoices.closedAt} IS NULL`));
      logAudit(ctx.db, {
        businessId: ctx.businessId,
        userId: ctx.user!.id,
        action: `${doc.documentType}.close`,
        entityType: doc.documentType,
        entityId: doc.id,
        metadata: { invoiceNumber: doc.invoiceNumber },
        ipAddress: ctx.ipAddress,
      });
      return { success: true };
    }),

  /** Undo a short-close: what was pending is expected again. */
  reopen: memberProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "Invoice");
      const doc = await findTracked(ctx.db, ctx.businessId, input.id);
      if (!doc.closedAt) return { success: true };
      await ctx.db
        .update(invoices)
        .set({ closedAt: null, updatedAt: new Date() })
        .where(and(eq(invoices.id, doc.id), eq(invoices.businessId, ctx.businessId)));
      logAudit(ctx.db, {
        businessId: ctx.businessId,
        userId: ctx.user!.id,
        action: `${doc.documentType}.reopen`,
        entityType: doc.documentType,
        entityId: doc.id,
        metadata: { invoiceNumber: doc.invoiceNumber },
        ipAddress: ctx.ipAddress,
      });
      return { success: true };
    }),
});
