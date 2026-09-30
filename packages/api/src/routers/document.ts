import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { invoices, invoiceItems } from "@fintranzact/db";
import { convertDocumentSchema, createInvoiceSchema, type DocumentType } from "@fintranzact/shared";
import { router, memberProcedure, createCallerFactory } from "../trpc.js";
import { createDocumentRouter } from "../lib/document-router-factory.js";
import { logAudit } from "../lib/audit.js";
import { FULFILLED_BY, isPendingTracked, loadPendingLines } from "../lib/order-fulfilment.js";
import { requireCan } from "../lib/permissions.js";

// ── Per-document-type routers ───────────────────────────────────

export const quotationRouter = createDocumentRouter({
  documentType: "quotation",
  prefixColumn: "quotationPrefix",
  counterColumn: "nextQuotationNumber",
  allowedStatuses: ["draft", "sent", "cancelled"],
  stockEffect: "none",
});

export const creditNoteRouter = createDocumentRouter({
  documentType: "credit_note",
  prefixColumn: "creditNotePrefix",
  counterColumn: "nextCreditNoteNumber",
  allowedStatuses: ["draft", "sent", "paid", "cancelled"],
  stockEffect: "none", // financial adjustment only — no stock change
});

export const debitNoteRouter = createDocumentRouter({
  documentType: "debit_note",
  prefixColumn: "creditNotePrefix", // shares credit note counter
  counterColumn: "nextCreditNoteNumber",
  allowedStatuses: ["draft", "sent", "paid", "cancelled"],
  stockEffect: "none",
});

export const deliveryChallanRouter = createDocumentRouter({
  documentType: "delivery_challan",
  prefixColumn: "deliveryChallanPrefix",
  counterColumn: "nextDeliveryChallanNumber",
  allowedStatuses: ["draft", "sent", "cancelled"],
  stockEffect: "decrement",
});

export const proformaRouter = createDocumentRouter({
  documentType: "proforma",
  prefixColumn: "proformaPrefix",
  counterColumn: "nextProformaNumber",
  allowedStatuses: ["draft", "sent", "cancelled"],
  stockEffect: "none",
});

export const salesReturnRouter = createDocumentRouter({
  documentType: "sales_return",
  prefixColumn: "creditNotePrefix",
  counterColumn: "nextCreditNoteNumber",
  allowedStatuses: ["draft", "sent", "cancelled"],
  stockEffect: "increment", // returned items come back into stock
});

export const purchaseReturnRouter = createDocumentRouter({
  documentType: "purchase_return",
  prefixColumn: "creditNotePrefix",
  counterColumn: "nextCreditNoteNumber",
  allowedStatuses: ["draft", "sent", "cancelled"],
  stockEffect: "decrement", // sending items back reduces stock
});

export const purchaseOrderRouter = createDocumentRouter({
  documentType: "purchase_order",
  prefixColumn: "purchaseOrderPrefix",
  counterColumn: "nextPurchaseOrderNumber",
  allowedStatuses: ["draft", "sent", "cancelled"],
  stockEffect: "none", // goods arrive on a GRN or the purchase invoice
  fixedType: "purchase",
});

export const salesOrderRouter = createDocumentRouter({
  documentType: "sales_order",
  prefixColumn: "salesOrderPrefix",
  counterColumn: "nextSalesOrderNumber",
  allowedStatuses: ["draft", "sent", "cancelled"],
  stockEffect: "none", // goods leave on a delivery challan or the invoice
  fixedType: "sale",
});

export const goodsReceiptNoteRouter = createDocumentRouter({
  documentType: "goods_receipt_note",
  prefixColumn: "goodsReceiptNotePrefix",
  counterColumn: "nextGoodsReceiptNoteNumber",
  allowedStatuses: ["draft", "sent", "cancelled"],
  stockEffect: "increment", // received goods come into stock before the bill
  fixedType: "purchase",
});

const targetRouterMap: Record<Exclude<DocumentType, "invoice">, ReturnType<typeof createDocumentRouter>> = {
  quotation: quotationRouter,
  credit_note: creditNoteRouter,
  debit_note: debitNoteRouter,
  delivery_challan: deliveryChallanRouter,
  proforma: proformaRouter,
  sales_return: salesReturnRouter,
  purchase_return: purchaseReturnRouter,
  purchase_order: purchaseOrderRouter,
  sales_order: salesOrderRouter,
  goods_receipt_note: goodsReceiptNoteRouter,
};

/** Order documents convert only into what fulfils them. */
const ORDER_SOURCES = new Set<string>(["sales_order", "purchase_order", "goods_receipt_note"]);

// ── Document conversion router ──────────────────────────────────

export const documentRouter = router({
  /**
   * Convert a document (e.g. quotation → invoice, sales order → delivery
   * challan, GRN → purchase invoice). Creates a document of the target type
   * linked via referenceDocumentId.
   *
   * Orders, challans and GRNs converted into what fulfils them carry over only
   * what is still pending on each line — or the quantities asked for in
   * `lines`, which may not exceed it. Anything else copies every line.
   */
  convert: memberProcedure
    .input(convertDocumentSchema)
    .mutation(async ({ input, ctx }) => {
      // Converting reads the source document and creates a new one; both
      // are Invoice-table documents, so enforce the same CASL checks as invoices.
      requireCan(ctx.ability, "read", "Invoice");
      requireCan(ctx.ability, "create", "Invoice");

      // 1. Fetch source document with line items
      const [sourceDoc] = await ctx.db
        .select()
        .from(invoices)
        .where(
          and(
            eq(invoices.id, input.sourceDocumentId),
            eq(invoices.businessId, ctx.businessId)
          )
        )
        .limit(1);

      if (!sourceDoc) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Source document not found" });
      }

      const sourceLineItems = await ctx.db
        .select()
        .from(invoiceItems)
        .where(eq(invoiceItems.invoiceId, sourceDoc.id))
        .orderBy(invoiceItems.sortOrder);

      const targetType = input.targetDocumentType;
      const fulfils = isPendingTracked(sourceDoc.documentType)
        && FULFILLED_BY[sourceDoc.documentType].includes(targetType);

      if (ORDER_SOURCES.has(sourceDoc.documentType) && !fulfils) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `A ${sourceDoc.documentType.replace(/_/g, " ")} can't be converted into a ${targetType.replace(/_/g, " ")}`,
        });
      }
      if (input.lines && !fulfils) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Quantities can only be picked when converting an order, challan or GRN" });
      }

      // 2. Lines to carry over, with the quantity for each.
      let lines = sourceLineItems.map((li) => ({ li, quantity: li.quantity }));
      let wholeDocument = true;
      if (fulfils) {
        if (sourceDoc.deletedAt || sourceDoc.status === "cancelled") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "A cancelled document can't be converted" });
        }
        if (sourceDoc.closedAt) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "This document is closed. Reopen it to convert what is pending." });
        }
        const pending = new Map(
          ((await loadPendingLines(ctx.db, ctx.businessId, [sourceDoc.id])).get(sourceDoc.id) ?? []).map((l) => [l.lineId, l]),
        );
        const requested = input.lines ? new Map(input.lines.map((l) => [l.sourceLineId, l.quantity])) : null;
        if (requested) {
          for (const id of requested.keys()) {
            if (!pending.has(id)) throw new TRPCError({ code: "BAD_REQUEST", message: "A picked line is not on this document" });
          }
        }
        lines = [];
        for (const li of sourceLineItems) {
          const p = pending.get(li.id);
          if (!p) continue;
          const qty = requested ? parseFloat(requested.get(li.id) ?? "0") : p.pending;
          if (!(qty > 0)) continue;
          if (qty > p.pending + 0.0005) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Only ${p.pending} of ${li.itemName} is pending`,
            });
          }
          lines.push({ li, quantity: String(Math.round(qty * 1000) / 1000) });
          if (Math.abs(qty - p.ordered) > 0.0005) wholeDocument = false;
        }
        if (lines.length === 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Nothing is pending on this document" });
        }
        if (lines.length !== sourceLineItems.length) wholeDocument = false;
      }

      // When converting a delivery_challan or GRN to an invoice, skip the stock
      // adjustment: the challan/GRN already moved the goods — we must not move
      // them again.
      const skipStockAdjustment =
        (sourceDoc.documentType === "delivery_challan" || sourceDoc.documentType === "goods_receipt_note") &&
        targetType === "invoice";

      // An order's date and delivery date are its own; what's made from it is
      // dated today.
      const fromOrder = ORDER_SOURCES.has(sourceDoc.documentType);

      const convertInput = createInvoiceSchema.parse({
        partyId: sourceDoc.partyId,
        type: sourceDoc.type,
        documentType: targetType,
        invoiceDate: fromOrder ? new Date().toISOString() : sourceDoc.invoiceDate.toISOString(),
        dueDate: !fromOrder && sourceDoc.dueDate ? sourceDoc.dueDate.toISOString() : undefined,
        notes: sourceDoc.notes ?? undefined,
        termsAndConditions: sourceDoc.termsAndConditions ?? undefined,
        // Part of a document doesn't take its charges and round-off along.
        additionalCharges: wholeDocument ? sourceDoc.additionalCharges : "0",
        roundOff: wholeDocument ? sourceDoc.roundOff : "0",
        referenceDocumentId: sourceDoc.id,
        warehouseId: input.warehouseId ?? undefined,
        skipStockAdjustment,
        lineItems: lines.map(({ li, quantity }) => ({
          itemId: li.itemId ?? undefined,
          itemName: li.itemName,
          // Carry forward optional notes verbatim. Null stays null.
          description: li.description ?? null,
          quantity,
          unitPrice: li.unitPrice,
          taxPercent: li.taxPercent,
          discountPercent: li.discountPercent,
          selectedUnit: li.selectedUnit,
          conversionFactor: li.conversionFactor,
          variantId: li.variantId,
        })),
      });

      // 3. Determine which router to delegate to and invoke its create procedure
      const callerCtx = { user: ctx.user, businessId: ctx.businessId, tenantId: ctx.tenantId, db: ctx.db, req: ctx.req, resHeaders: ctx.resHeaders, ipAddress: ctx.ipAddress };

      let newDoc: { id: string; invoiceNumber: string };
      if (targetType === "invoice") {
        // Imported dynamically to avoid circular deps
        const { invoiceRouter } = await import("./invoice.js");
        newDoc = await createCallerFactory(invoiceRouter)(callerCtx).create(convertInput);
      } else {
        const targetRouter = targetRouterMap[targetType];
        if (!targetRouter) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Unsupported target document type: ${targetType}` });
        }
        // Use createCallerFactory to reuse the factory-generated create procedure
        newDoc = await createCallerFactory(targetRouter)(callerCtx).create(convertInput);
      }

      logAudit(ctx.db, {
        businessId: ctx.businessId,
        userId: ctx.user!.id,
        action: "document.convert",
        entityType: "document",
        entityId: newDoc.id,
        metadata: { sourceType: sourceDoc.documentType, targetType, sourceId: input.sourceDocumentId },
        ipAddress: ctx.ipAddress,
      });

      return { id: newDoc.id, documentType: targetType as DocumentType, invoiceNumber: newDoc.invoiceNumber };
    }),
});
