import { eq, and, sql, desc, inArray, isNull } from "drizzle-orm";
import { withAllocatedLines } from "./document-totals.js";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  invoices,
  invoiceItems,
  items,
  itemVariants,
  businesses,
  parties,
  shipments,
} from "@fintranzact/db";
import {
  createInvoiceSchema,
  paginationSchema,
  type DocumentType,
  calcLineItem,
  calcInvoiceTotals,
} from "@fintranzact/shared";
import { router, viewerProcedure, memberProcedure, adminProcedure } from "../trpc.js";
import { logAudit } from "./audit.js";
import { documentStockDirection, resolveDocumentWarehouseId, resolveInvoiceWarehouse, syncDocumentStock } from "./inventory-service.js";
import { resolveLineBatches } from "./batches.js";
import { lineBatchDetails } from "./batch-display.js";
import { requireCan } from "./permissions.js";
import { assertNotLockedByGovernment } from "./government-lock.js";
import { assertInBusiness } from "./business-scope.js";
import { buildBusinessDateFilter } from "./business-date.js";
import { escapeLike } from "./escape-like.js";
import { fulfilmentStatuses, isPendingTracked } from "./order-fulfilment.js";
import { assertLineExtras, lineExtras } from "./line-extras.js";
import { resolveDeliveryMethod } from "./delivery-methods.js";
import { recomputeReferencedInvoice } from "./invoice-status.js";

type InvoiceStatus = "draft" | "sent" | "paid" | "partial" | "overdue" | "cancelled";

export interface DocumentRouterConfig {
  documentType: string;
  /** column name on businesses table for prefix, e.g. "quotationPrefix" */
  prefixColumn: keyof typeof businesses.$inferSelect | null;
  /** column name for next number counter, e.g. "nextQuotationNumber" */
  counterColumn: keyof typeof businesses.$inferSelect | null;
  allowedStatuses: string[];
  /** whether creating this document type affects item stock */
  stockEffect: "none" | "decrement" | "increment";
  /** Sale or purchase regardless of what the client sends (orders, GRNs). */
  fixedType?: "sale" | "purchase";
}

// Map document type to prefix/counter columns on businesses table
const bizColumns = {
  quotation: {
    prefix: businesses.quotationPrefix,
    counter: businesses.nextQuotationNumber,
    setCounter: (n: number) => ({ nextQuotationNumber: n }),
  },
  credit_note: {
    prefix: businesses.creditNotePrefix,
    counter: businesses.nextCreditNoteNumber,
    setCounter: (n: number) => ({ nextCreditNoteNumber: n }),
  },
  debit_note: {
    prefix: businesses.debitNotePrefix,
    counter: businesses.nextDebitNoteNumber,
    setCounter: (n: number) => ({ nextDebitNoteNumber: n }),
  },
  delivery_challan: {
    prefix: businesses.deliveryChallanPrefix,
    counter: businesses.nextDeliveryChallanNumber,
    setCounter: (n: number) => ({ nextDeliveryChallanNumber: n }),
  },
  proforma: {
    prefix: businesses.proformaPrefix,
    counter: businesses.nextProformaNumber,
    setCounter: (n: number) => ({ nextProformaNumber: n }),
  },
  sales_return: {
    prefix: businesses.salesReturnPrefix,
    counter: businesses.nextSalesReturnNumber,
    setCounter: (n: number) => ({ nextSalesReturnNumber: n }),
  },
  purchase_return: {
    prefix: businesses.purchaseReturnPrefix,
    counter: businesses.nextPurchaseReturnNumber,
    setCounter: (n: number) => ({ nextPurchaseReturnNumber: n }),
  },
  purchase_order: {
    prefix: businesses.purchaseOrderPrefix,
    counter: businesses.nextPurchaseOrderNumber,
    setCounter: (n: number) => ({ nextPurchaseOrderNumber: n }),
  },
  sales_order: {
    prefix: businesses.salesOrderPrefix,
    counter: businesses.nextSalesOrderNumber,
    setCounter: (n: number) => ({ nextSalesOrderNumber: n }),
  },
  goods_receipt_note: {
    prefix: businesses.goodsReceiptNotePrefix,
    counter: businesses.nextGoodsReceiptNoteNumber,
    setCounter: (n: number) => ({ nextGoodsReceiptNoteNumber: n }),
  },
} as const;

/**
 * A challan or GRN whose goods were billed on an invoice made from it can't be
 * cancelled or deleted while that invoice stands: the invoice was saved
 * without moving stock, so taking the challan's movement back would lose it.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function assertNotBilled(tx: any, businessId: string, doc: { id: string; documentType: string }) {
  if (doc.documentType !== "goods_receipt_note" && doc.documentType !== "delivery_challan") return;
  const [bill] = await tx
    .select({ invoiceNumber: invoices.invoiceNumber })
    .from(invoices)
    .where(and(
      eq(invoices.businessId, businessId),
      eq(invoices.referenceDocumentId, doc.id),
      eq(invoices.documentType, "invoice"),
      isNull(invoices.deletedAt),
      sql`${invoices.status} <> 'cancelled'`,
    ))
    .limit(1);
  if (bill) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Invoice ${bill.invoiceNumber} was billed from this document. Cancel or delete that invoice first.`,
    });
  }
}

type KnownDocType = keyof typeof bizColumns;

export function createDocumentRouter(config: DocumentRouterConfig) {
  const docType = config.documentType;
  const allowedStatusEnum = config.allowedStatuses as [string, ...string[]];

  return router({
    list: viewerProcedure
      .input(
        z.object({
          type: z.enum(["sale", "purchase"]).optional(),
          status: z.union([z.enum(allowedStatusEnum), z.array(z.enum(allowedStatusEnum))]).optional(),
          partyId: z.string().uuid().optional(),
          fromDate: z.string().datetime().optional(),
          toDate: z.string().datetime().optional(),
          search: z.string().optional(),
          itemId: z.string().uuid().optional(),
          /** Orders, challans and GRNs: filter by how much is still pending. */
          fulfilment: z.enum(["open", "partial", "fulfilled", "closed"]).optional(),
          ...paginationSchema.shape,
        })
      )
      .query(async ({ input, ctx }) => {
        requireCan(ctx.ability, "read", "Invoice");
        const conditions = [
          eq(invoices.businessId, ctx.businessId),
          eq(invoices.documentType, docType as DocumentType),
          isNull(invoices.deletedAt),
        ];

        if (input.type) conditions.push(eq(invoices.type, input.type));
        if (input.status) {
          if (Array.isArray(input.status)) {
            conditions.push(inArray(invoices.status, input.status as InvoiceStatus[]));
          } else {
            conditions.push(eq(invoices.status, input.status as InvoiceStatus));
          }
        }
        if (input.partyId) conditions.push(eq(invoices.partyId, input.partyId));
        conditions.push(...buildBusinessDateFilter(invoices, { from: input.fromDate, to: input.toDate }));
        if (input.search) {
          const term = `%${escapeLike(input.search)}%`;
          conditions.push(
            sql`(${invoices.invoiceNumber} ILIKE ${term} OR EXISTS (
              SELECT 1 FROM ${parties} WHERE ${parties.id} = ${invoices.partyId} AND ${parties.name} ILIKE ${term}
            ))`
          );
        }

        const offset = (input.page - 1) * input.limit;

        // If itemId filter: use EXISTS subquery instead of loading IDs into memory
        if (input.itemId) {
          conditions.push(
            sql`EXISTS (SELECT 1 FROM ${invoiceItems} WHERE ${invoiceItems.invoiceId} = ${invoices.id} AND ${invoiceItems.itemId} = ${input.itemId})`
          );
        }

        const tracked = isPendingTracked(docType);
        const columns = {
          id: invoices.id,
          invoiceNumber: invoices.invoiceNumber,
          type: invoices.type,
          status: invoices.status,
          documentType: invoices.documentType,
          invoiceDate: invoices.invoiceDate,
          dueDate: invoices.dueDate,
          totalAmount: invoices.totalAmount,
          amountPaid: invoices.amountPaid,
          referenceDocumentId: invoices.referenceDocumentId,
          closedAt: invoices.closedAt,
          deletedAt: invoices.deletedAt,
          partyName: parties.name,
          partyId: parties.id,
        };

        // The fulfilment filter is worked out from the documents' lines, so
        // find the matching ids first and page over those.
        if (tracked && input.fulfilment) {
          const candidates = await ctx.db
            .select({ id: invoices.id, status: invoices.status, deletedAt: invoices.deletedAt, closedAt: invoices.closedAt })
            .from(invoices)
            .where(and(...conditions))
            .orderBy(desc(invoices.createdAt));
          const statuses = await fulfilmentStatuses(ctx.db, ctx.businessId, candidates);
          const matching = candidates.filter((c) => statuses.get(c.id) === input.fulfilment).map((c) => c.id);
          const pageIds = matching.slice(offset, offset + input.limit);
          const rows = pageIds.length === 0 ? [] : await ctx.db
            .select(columns)
            .from(invoices)
            .innerJoin(parties, eq(parties.id, invoices.partyId))
            .where(and(eq(invoices.businessId, ctx.businessId), inArray(invoices.id, pageIds)))
            .orderBy(desc(invoices.createdAt));
          const data = rows.map(({ deletedAt: _deletedAt, ...r }) => ({ ...r, fulfilmentStatus: statuses.get(r.id) ?? null }));
          return { data, total: matching.length, page: input.page, limit: input.limit };
        }

        const [rows, [{ count }]] = await Promise.all([
          ctx.db
            .select(columns)
            .from(invoices)
            .innerJoin(parties, eq(parties.id, invoices.partyId))
            .where(and(...conditions))
            .orderBy(desc(invoices.createdAt))
            .limit(input.limit)
            .offset(offset),
          ctx.db
            .select({ count: sql<number>`count(*)::int` })
            .from(invoices)
            .where(and(...conditions)),
        ]);

        const statuses = tracked ? await fulfilmentStatuses(ctx.db, ctx.businessId, rows) : null;
        const data = rows.map(({ deletedAt: _deletedAt, ...r }) => ({ ...r, fulfilmentStatus: statuses?.get(r.id) ?? null }));

        return { data, total: count, page: input.page, limit: input.limit };
      }),

    getById: viewerProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ input, ctx }) => {
        requireCan(ctx.ability, "read", "Invoice");
        const [invoice] = await ctx.db
          .select()
          .from(invoices)
          .where(
            and(
              eq(invoices.id, input.id),
              eq(invoices.businessId, ctx.businessId),
              eq(invoices.documentType, docType as DocumentType)
            )
          )
          .limit(1);

        if (!invoice) return null;

        const [lineRows, [party]] = await Promise.all([
          ctx.db
            .select()
            .from(invoiceItems)
            .where(eq(invoiceItems.invoiceId, input.id))
            .orderBy(invoiceItems.sortOrder),
          ctx.db.select().from(parties).where(eq(parties.id, invoice.partyId)).limit(1),
        ]);
        const batchDetails = await lineBatchDetails(ctx.db, ctx.businessId, lineRows);
        const lineItems = lineRows.map((li) => ({ ...li, batch: li.batchId ? batchDetails.get(li.batchId) ?? null : null }));

        return { ...invoice, lineItems, party: party ?? null };
      }),

    create: memberProcedure
      .input(createInvoiceSchema)
      .mutation(async ({ input, ctx }) => {
        requireCan(ctx.ability, "create", "Invoice");
        const doc = await ctx.db.transaction(async (tx) => {
          // Security: validate that partyId belongs to the current business.
          const [partyCheck] = await tx.select({ id: parties.id })
            .from(parties)
            .where(and(eq(parties.id, input.partyId), eq(parties.businessId, ctx.businessId)))
            .limit(1);
          if (!partyCheck) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Party not found in this business" });
          }

          // Security: validate that every itemId in line items belongs to the current business.
          // Soft-delete note: mirrors `invoice.ts` — this is an ownership
          // check, not an active-state check. Allowing soft-deleted items
          // keeps backdated document creation (CLI, imports, historical
          // re-entry) functional.
          const createLineItemIds = input.lineItems
            .map((li) => li.itemId)
            .filter((id): id is string => Boolean(id));
          if (createLineItemIds.length > 0) {
            const ownedItems = await tx.select({ id: items.id })
              .from(items)
              .where(and(inArray(items.id, createLineItemIds), eq(items.businessId, ctx.businessId)));
            if (ownedItems.length !== new Set(createLineItemIds).size) {
              throw new TRPCError({ code: "BAD_REQUEST", message: "One or more items do not belong to this business" });
            }
          }

          // Stored references must be this business's records, for every
          // document type (the credit-note check below also caps amounts).
          await assertInBusiness(tx, invoices, input.referenceDocumentId, ctx.businessId, "Referenced document");
          await assertInBusiness(tx, shipments, (input.charges ?? []).map((c) => c.shipmentId), ctx.businessId, "Shipment");

          // Security: validate variantIds belong to items in this business.
          const variantIds = input.lineItems
            .map((li) => li.variantId)
            .filter((id): id is string => Boolean(id));
          if (variantIds.length > 0) {
            const ownedVariants = await tx.select({ id: itemVariants.id })
              .from(itemVariants)
              .innerJoin(items, eq(items.id, itemVariants.itemId))
              .where(and(inArray(itemVariants.id, variantIds), eq(items.businessId, ctx.businessId)));
            if (ownedVariants.length !== new Set(variantIds).size) {
              throw new TRPCError({ code: "BAD_REQUEST", message: "One or more variants do not belong to this business" });
            }
          }

          // Determine prefix/counter columns for this document type
          const cols = bizColumns[docType as KnownDocType];

          let docNumber: string;

          if (cols) {
            // Atomic counter increment with FOR UPDATE lock
            const [biz] = await tx
              .select({
                prefix: cols.prefix,
                counter: cols.counter,
              })
              .from(businesses)
              .where(eq(businesses.id, ctx.businessId))
              .for("update");

            docNumber = `${biz.prefix}-${String(biz.counter).padStart(5, "0")}`;

            await tx
              .update(businesses)
              .set(cols.setCounter((biz.counter as number) + 1))
              .where(eq(businesses.id, ctx.businessId));
          } else {
            // Fallback: derive number from MAX of existing documents of this type
            const [maxRow] = await tx
              .select({
                maxNum: sql<number>`coalesce(max(cast(regexp_replace(${invoices.invoiceNumber}, '[^0-9]', '', 'g') as integer)), 0)`,
              })
              .from(invoices)
              .where(
                and(
                  eq(invoices.businessId, ctx.businessId),
                  eq(invoices.documentType, docType as DocumentType)
                )
              );
            const nextNum = (maxRow?.maxNum ?? 0) + 1;
            const prefix = docType.toUpperCase().replace(/_/g, "").slice(0, 4);
            docNumber = `${prefix}-${String(nextNum).padStart(5, "0")}`;
          }

          assertLineExtras(docType, input.lineItems);
          // Check a picked warehouse before anything reads stock in it.
          const movesStock = config.stockEffect !== "none" && !input.skipStockAdjustment;
          if (input.warehouseId && movesStock) {
            await resolveInvoiceWarehouse(tx, {
              businessId: ctx.businessId,
              operation: "sale",
              warehouseId: input.warehouseId,
            });
          }

          // Lines of batch-tracked items get their batch (see lib/batches).
          const stockDoc = { documentType: docType, type: config.fixedType ?? input.type, warehouseId: input.warehouseId ?? null };
          const docDate = input.invoiceDate ? new Date(input.invoiceDate) : new Date();
          const direction = movesStock ? documentStockDirection(stockDoc) : 0;
          const lineItems = await resolveLineBatches(tx, {
            businessId: ctx.businessId,
            lines: input.lineItems,
            direction,
            warehouseId: direction === 0 ? null : await resolveDocumentWarehouseId(tx, { businessId: ctx.businessId, doc: stockDoc }),
            documentDate: docDate,
            strict: true,
          });

          // Calculate line item totals using fixed-point arithmetic
          const processedItems = lineItems.map((li, idx) => {
            const calc = calcLineItem({
              quantity: li.quantity,
              unitPrice: li.unitPrice,
              taxPercent: li.taxPercent || "0",
              discountPercent: li.discountPercent || "0",
            });
            return {
              itemId: li.itemId || null,
              itemName: li.itemName,
              description: li.description || null,
              quantity: li.quantity,
              unitPrice: li.unitPrice,
              taxPercent: li.taxPercent || "0",
              taxAmount: calc.taxAmount,
              discountPercent: li.discountPercent || "0",
              totalAmount: calc.total,
              sortOrder: idx,
              selectedUnit: li.selectedUnit || null,
              conversionFactor: li.variantId ? "1" : (li.conversionFactor || "1"),
              variantId: li.variantId || null,
              ...lineExtras(li),
              batchId: li.batchId,
            };
          });

          const charges = input.charges ?? [];
          // A flat additionalCharges (no itemised charges) is part of the total too —
          // it used to be stored but left out of totalAmount.
          const flatCharges = charges.length > 0 ? charges : [{ amount: input.additionalCharges || "0" }];
          const totals = calcInvoiceTotals({
            lineItems: lineItems.map((li) => ({
              quantity: li.quantity,
              unitPrice: li.unitPrice,
              taxPercent: li.taxPercent || "0",
              discountPercent: li.discountPercent || "0",
            })),
            charges: flatCharges,
            invoiceDiscount: input.invoiceDiscount || "0",
            invoiceDiscountType: input.invoiceDiscountType || "amount",
            roundOff: input.roundOff || "0",
          });
          const additionalCharges = totals.chargesTotal;
          const roundOff = input.roundOff || "0";

          // A return or note made from a goods receipt note sends back goods
          // rejected on receipt: the GRN is not a bill, so there is no bill
          // total to hold it to or to mark adjusted.
          let adjustsBill = !!input.referenceDocumentId
            && ["credit_note", "sales_return", "purchase_return"].includes(docType);
          if (adjustsBill) {
            const [ref] = await tx
              .select({ documentType: invoices.documentType })
              .from(invoices)
              .where(and(eq(invoices.id, input.referenceDocumentId!), eq(invoices.businessId, ctx.businessId)))
              .limit(1);
            if (ref?.documentType === "goods_receipt_note") adjustsBill = false;
          }

          // Server-side guard: CN/SR/PR total must not exceed the referenced invoice's total.
          // This prevents over-crediting or over-returning against a single invoice.
          if (adjustsBill && input.referenceDocumentId) {
            const [refInvoice] = await tx
              .select({ totalAmount: invoices.totalAmount, type: invoices.type })
              .from(invoices)
              .where(and(
                eq(invoices.id, input.referenceDocumentId),
                eq(invoices.businessId, ctx.businessId),
              ))
              .limit(1);

            if (!refInvoice) {
              throw new TRPCError({ code: "BAD_REQUEST", message: "Referenced invoice not found" });
            }

            // Goods go back the way they came: a sales return is against a
            // sale, a purchase return against a purchase. Anything else would
            // move stock and GST the wrong way.
            if (config.fixedType && refInvoice.type !== config.fixedType) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: refInvoice.type === "purchase"
                  ? "A purchase invoice is returned with a purchase return, not a sales return"
                  : "A sale invoice is returned with a sales return, not a purchase return",
              });
            }

            // Sum all existing CN/SR/PR already issued against this invoice
            const [{ alreadyAdjusted }] = await tx
              .select({
                alreadyAdjusted: sql<string>`COALESCE(SUM(${invoices.totalAmount}::numeric), 0)`,
              })
              .from(invoices)
              .where(and(
                eq(invoices.referenceDocumentId, input.referenceDocumentId),
                eq(invoices.businessId, ctx.businessId),
                sql`${invoices.documentType} IN ('credit_note', 'sales_return', 'purchase_return')`,
                sql`${invoices.status} NOT IN ('cancelled')`,
                isNull(invoices.deletedAt),
              ));

            const remaining = parseFloat(refInvoice.totalAmount) - parseFloat(alreadyAdjusted);
            if (parseFloat(totals.total) > remaining + 0.01) { // 0.01 tolerance for rounding
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `Amount exceeds remaining adjustable amount. Invoice total: ${refInvoice.totalAmount}, already adjusted: ${alreadyAdjusted}, remaining: ${remaining.toFixed(2)}, attempted: ${totals.total}`,
              });
            }
          }

          // A built-in delivery method, or one of the business's own.
          const deliveryMethod = await resolveDeliveryMethod(tx, ctx.businessId, input.deliveryMethod || "self_pickup");

          const [result] = await tx
            .insert(invoices)
            .values({
              businessId: ctx.businessId,
              partyId: input.partyId,
              type: config.fixedType ?? input.type,
              // ALWAYS use config.documentType — never trust client-supplied value
              documentType: docType as DocumentType,
              invoiceNumber: docNumber,
              invoiceDate: docDate,
              dueDate: input.dueDate ? new Date(input.dueDate) : null,
              subtotal: totals.subtotal,
              taxAmount: totals.taxTotal,
              discountAmount: totals.invoiceDiscountAmount,
              charges: charges.length > 0 ? charges : null,
              additionalCharges,
              roundOff,
              totalAmount: totals.total,
              notes: input.notes,
              termsAndConditions: input.termsAndConditions,
              referenceDocumentId: input.referenceDocumentId || null,
              deliveryMethod,
              stockMode: config.stockEffect === "none" || input.skipStockAdjustment ? "none" : "tracked",
              warehouseId: config.stockEffect === "none" || input.skipStockAdjustment ? null : input.warehouseId ?? null,
              createdByUserId: ctx.user!.id,
              createdByName: ctx.user!.name,
            })
            .returning();

          if (processedItems.length > 0) {
            await tx
              .insert(invoiceItems)
              .values(withAllocatedLines(processedItems, totals.lines).map((li) => ({ ...li, invoiceId: result.id })));
          }

          // Stock effect, recorded per warehouse.
          await syncDocumentStock(tx, {
            businessId: ctx.businessId,
            documentId: result.id,
            event: "CREATE",
            enforceStock: true,
            actorUserId: ctx.user!.id,
          });

          // The invoice it adjusts: adjusted, paid, partial... from what now settles it.
          await recomputeReferencedInvoice(tx, ctx.businessId, result);

          return result;
        });

        logAudit(ctx.db, {
          businessId: ctx.businessId,
          userId: ctx.user!.id,
          action: `${config.documentType}.create`,
          entityType: config.documentType,
          entityId: doc.id,
          metadata: { invoiceNumber: doc.invoiceNumber, type: config.documentType },
          ipAddress: ctx.ipAddress,
        });

        return doc;
      }),

    updateStatus: memberProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          status: z.enum(allowedStatusEnum),
        })
      )
      .mutation(async ({ input, ctx }) => {
        requireCan(ctx.ability, "update", "Invoice");
        if (input.status === "cancelled") {
          await assertNotLockedByGovernment(ctx.db, ctx.businessId, input.id, "cancel");
        }
        const { doc, fromStatus } = await ctx.db.transaction(async (tx) => {
          const [before] = await tx
            .select({ status: invoices.status })
            .from(invoices)
            .where(and(eq(invoices.id, input.id), eq(invoices.businessId, ctx.businessId)))
            .limit(1);

          if (input.status === "cancelled" && before && before.status !== "cancelled") {
            await assertNotBilled(tx, ctx.businessId, { id: input.id, documentType: docType });
          }

          const [updated] = await tx
            .update(invoices)
            .set({
              status: input.status as InvoiceStatus,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(invoices.id, input.id),
                eq(invoices.businessId, ctx.businessId),
                eq(invoices.documentType, docType as DocumentType),
                // A deleted document stays deleted: reinstating it here
                // would put its stock back while it's still hidden.
                isNull(invoices.deletedAt),
              )
            )
            .returning();

          if (!updated) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });
          }

          // Cancelling gives the stock effect back; reinstating re-applies it.
          const wasCancelled = before?.status === "cancelled";
          const isCancelled = input.status === "cancelled";
          if (wasCancelled !== isCancelled) {
            await syncDocumentStock(tx, {
              businessId: ctx.businessId,
              documentId: input.id,
              event: isCancelled ? "CANCEL" : "REINSTATE",
              enforceStock: !isCancelled,
              actorUserId: ctx.user!.id,
            });
          }
          // A cancelled or reinstated note or return changes what settles its invoice.
          if (wasCancelled !== isCancelled) {
            await recomputeReferencedInvoice(tx, ctx.businessId, updated);
          }
          return { doc: updated, fromStatus: before?.status ?? null };
        });

        logAudit(ctx.db, {
          businessId: ctx.businessId,
          userId: ctx.user!.id,
          action: `${config.documentType}.updateStatus`,
          entityType: config.documentType,
          entityId: input.id,
          metadata: { invoiceNumber: doc.invoiceNumber, fromStatus, toStatus: input.status },
          ipAddress: ctx.ipAddress,
        });

        return doc;
      }),

    delete: adminProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ input, ctx }) => {
        requireCan(ctx.ability, "delete", "Invoice");
        await assertNotLockedByGovernment(ctx.db, ctx.businessId, input.id, "delete");
        const deleteResult = await ctx.db.transaction(async (tx) => {
          const [doc] = await tx
            .select()
            .from(invoices)
            .where(
              and(
                eq(invoices.id, input.id),
                eq(invoices.businessId, ctx.businessId),
                eq(invoices.documentType, docType as DocumentType)
              )
            )
            .limit(1);

          if (!doc) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });
          }

          // Already soft-deleted — return early
          if (doc.deletedAt) return { success: true, invoiceNumber: doc.invoiceNumber, deleted: false };

          // seller_manager: same limit as invoice.delete — unpaid, within 2 hours of creation
          if (ctx.role === "seller_manager") {
            if (doc.status === "paid") {
              throw new TRPCError({ code: "FORBIDDEN", message: "Cannot delete paid documents" });
            }
            const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
            if (doc.createdAt < twoHoursAgo) {
              throw new TRPCError({ code: "FORBIDDEN", message: "Can only delete documents within 2 hours of creation" });
            }
          }

          await assertNotBilled(tx, ctx.businessId, doc);

          // Soft delete: set deletedAt + cancel the document
          await tx
            .update(invoices)
            .set({ deletedAt: new Date(), status: "cancelled" as const, updatedAt: new Date() })
            .where(
              and(
                eq(invoices.id, input.id),
                eq(invoices.businessId, ctx.businessId)
              )
            );

          // A deleted document holds no stock.
          await syncDocumentStock(tx, {
            businessId: ctx.businessId,
            documentId: input.id,
            event: "DELETE",
            actorUserId: ctx.user!.id,
          });

          // A deleted note or return no longer settles its invoice.
          await recomputeReferencedInvoice(tx, ctx.businessId, doc);

          return { success: true, invoiceNumber: doc.invoiceNumber, deleted: true };
        });

        if (deleteResult.deleted) {
          logAudit(ctx.db, {
            businessId: ctx.businessId,
            userId: ctx.user!.id,
            action: `${config.documentType}.delete`,
            entityType: config.documentType,
            entityId: input.id,
            metadata: { invoiceNumber: deleteResult.invoiceNumber },
            ipAddress: ctx.ipAddress,
          });
        }

        return { success: deleteResult.success };
      }),
  });
}
