import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { invoices, invoiceItems } from "@fintranzact/db";
import { calcInvoiceTotals, convertDocumentSchema, createInvoiceSchema, money, type DocumentType } from "@fintranzact/shared";
import { router, memberProcedure, createCallerFactory } from "../trpc.js";
import { createDocumentRouter } from "../lib/document-router-factory.js";
import { logAudit } from "../lib/audit.js";
import { FULFILLED_BY, isPendingTracked, loadPendingLines, loadRejectedLines } from "../lib/order-fulfilment.js";
import { requireCan } from "../lib/permissions.js";
import { findDeliveryMethod } from "../lib/delivery-methods.js";

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
  fixedType: "sale", // goods back from a customer
});

export const purchaseReturnRouter = createDocumentRouter({
  documentType: "purchase_return",
  prefixColumn: "creditNotePrefix",
  counterColumn: "nextCreditNoteNumber",
  allowedStatuses: ["draft", "sent", "cancelled"],
  stockEffect: "decrement", // sending items back reduces stock
  fixedType: "purchase", // goods back to a supplier
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
   * Billed and free quantities travel separately; a purchase order received
   * on a GRN can record rejected goods per line, which stay pending on the
   * order. With `fromRejected`, a GRN's rejected goods become a purchase
   * return or debit note that moves no stock.
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

      // Goods go back the way they came: returning a purchase makes a
      // purchase return (stock out, ITC reversed) and returning a sale a
      // sales return, whichever return the caller asked for.
      let targetType = input.targetDocumentType;
      if (targetType === "sales_return" && sourceDoc.type === "purchase") targetType = "purchase_return";
      else if (targetType === "purchase_return" && sourceDoc.type === "sale") targetType = "sales_return";
      const fromRejected = !!input.fromRejected;
      const fulfils = !fromRejected
        && isPendingTracked(sourceDoc.documentType)
        && FULFILLED_BY[sourceDoc.documentType].includes(targetType);

      if (fromRejected && (sourceDoc.documentType !== "goods_receipt_note" || !["purchase_return", "debit_note"].includes(targetType))) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Rejected goods go back from a goods receipt note on a purchase return or debit note",
        });
      }
      if (ORDER_SOURCES.has(sourceDoc.documentType) && !fulfils && !fromRejected) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `A ${sourceDoc.documentType.replace(/_/g, " ")} can't be converted into a ${targetType.replace(/_/g, " ")}`,
        });
      }
      if (input.lines && !fulfils && !fromRejected) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Quantities can only be picked when converting an order, challan or GRN" });
      }
      const receiving = sourceDoc.documentType === "purchase_order" && targetType === "goods_receipt_note";
      if (!receiving && input.lines?.some((l) => parseFloat(l.rejectedQuantity ?? "0") > 0)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Rejected quantities are recorded when receiving a purchase order on a GRN" });
      }

      // 2. Lines to carry over, with the billed and free quantity for each
      // (and, on a GRN made from a purchase order, what was rejected).
      type CarriedLine = {
        li: (typeof sourceLineItems)[number];
        quantity: string;
        freeQuantity: string;
        rejectedQuantity?: string;
        rejectionReason?: string;
        /** Batch the goods arrive in, typed in while converting. */
        batch?: { batchNumber: string; expiryDate?: string; mfgDate?: string };
      };
      const q3 = (n: number) => String(Math.round(n * 1000) / 1000);
      let lines: CarriedLine[] = sourceLineItems.map((li) => ({ li, quantity: li.quantity, freeQuantity: li.freeQuantity ?? "0" }));
      let wholeDocument = true;
      if (fromRejected) {
        if (sourceDoc.deletedAt || sourceDoc.status === "cancelled") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "A cancelled document can't be converted" });
        }
        const open = new Map((await loadRejectedLines(ctx.db, ctx.businessId, sourceDoc.id)).map((l) => [l.lineId, l]));
        const requested = input.lines ? new Map(input.lines.map((l) => [l.sourceLineId, l])) : null;
        if (requested) {
          for (const id of requested.keys()) {
            if (!open.has(id)) throw new TRPCError({ code: "BAD_REQUEST", message: "A picked line has no rejected goods" });
          }
        }
        lines = [];
        for (const li of sourceLineItems) {
          const r = open.get(li.id);
          if (!r) continue;
          const qty = requested ? parseFloat(requested.get(li.id)?.quantity ?? "0") : r.open;
          if (!(qty > 0)) continue;
          if (qty > r.open + 0.0005) {
            throw new TRPCError({ code: "BAD_REQUEST", message: `Only ${r.open} of ${li.itemName} is rejected and not yet returned` });
          }
          lines.push({ li, quantity: q3(qty), freeQuantity: "0" });
        }
        if (lines.length === 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "No rejected goods are left to return on this GRN" });
        }
        wholeDocument = false;
      }
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
        const requested = input.lines ? new Map(input.lines.map((l) => [l.sourceLineId, l])) : null;
        if (requested) {
          for (const id of requested.keys()) {
            if (!pending.has(id)) throw new TRPCError({ code: "BAD_REQUEST", message: "A picked line is not on this document" });
          }
        }
        lines = [];
        for (const li of sourceLineItems) {
          const p = pending.get(li.id);
          if (!p) continue;
          const req = requested ? requested.get(li.id) : undefined;
          if (requested && !req) continue;
          const qty = req ? parseFloat(req.quantity) : p.pending;
          // Free goods go along with the whole pending billed quantity unless
          // asked for explicitly.
          const free = req?.freeQuantity !== undefined
            ? parseFloat(req.freeQuantity)
            : qty >= p.pending - 0.0005 ? p.freePending : 0;
          const rejected = parseFloat(req?.rejectedQuantity ?? "0");
          if (!(qty > 0) && !(free > 0) && !(rejected > 0)) continue;
          if (qty > p.pending + 0.0005) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Only ${p.pending} of ${li.itemName} is pending`,
            });
          }
          if (free > p.freePending + 0.0005) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Only ${p.freePending} of ${li.itemName} is pending free`,
            });
          }
          if (qty + rejected > p.pending + 0.0005) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Accepted and rejected ${li.itemName} come to more than the ${p.pending} pending`,
            });
          }
          lines.push({
            li,
            quantity: q3(qty),
            freeQuantity: q3(free),
            ...(rejected > 0 ? { rejectedQuantity: q3(rejected), rejectionReason: req?.rejectionReason } : {}),
            ...(req?.batchNumber ? { batch: { batchNumber: req.batchNumber, expiryDate: req.expiryDate, mfgDate: req.mfgDate } } : {}),
          });
          if (Math.abs(qty - p.ordered) > 0.0005 || Math.abs(free - p.freeOrdered) > 0.0005) wholeDocument = false;
        }
        if (lines.length === 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Nothing is pending on this document" });
        }
        if (lines.length !== sourceLineItems.length) wholeDocument = false;
      }

      // When converting a delivery_challan or GRN to an invoice, skip the stock
      // adjustment: the challan/GRN already moved the goods — we must not move
      // them again.
      // A purchase return of goods rejected on receipt moves nothing either:
      // they never came into stock.
      const skipStockAdjustment = fromRejected || (
        (sourceDoc.documentType === "delivery_challan" || sourceDoc.documentType === "goods_receipt_note") &&
        targetType === "invoice");

      // An order's date and delivery date are its own; what's made from it is
      // dated today.
      const fromOrder = ORDER_SOURCES.has(sourceDoc.documentType);
      const notes = fromRejected
        ? [sourceDoc.notes, `Goods rejected on ${sourceDoc.invoiceNumber}`].filter(Boolean).join("\n")
        : sourceDoc.notes;

      // The document-level discount goes along with the lines: all of it for
      // the whole document, else the share of the lines' value taken.
      const sourceDiscount = sourceDoc.discountAmount ?? "0";
      let invoiceDiscount = wholeDocument ? sourceDiscount : "0";
      if (!wholeDocument && !fromRejected && money.isPositive(sourceDiscount) && money.isPositive(sourceDoc.subtotal)) {
        const { subtotal } = calcInvoiceTotals({
          lineItems: lines.map(({ li, quantity }) => ({
            quantity,
            unitPrice: li.unitPrice,
            taxPercent: li.taxPercent,
            discountPercent: li.discountPercent,
          })),
        });
        invoiceDiscount = money.mul(sourceDiscount, money.toNumber(subtotal) / money.toNumber(sourceDoc.subtotal));
      }
      // Itemised charges travel as they are; the shipments behind any stay
      // with the source document.
      const sourceCharges = wholeDocument
        ? (sourceDoc.charges ?? []).map(({ label, amount }) => ({ label, amount }))
        : [];

      // The delivery method goes along while the business still offers it.
      const deliveryMethod = sourceDoc.deliveryMethod
        ? await findDeliveryMethod(ctx.db, ctx.businessId, sourceDoc.deliveryMethod)
        : null;

      const convertInput = createInvoiceSchema.parse({
        partyId: sourceDoc.partyId,
        type: sourceDoc.type,
        documentType: targetType,
        invoiceDate: fromOrder ? new Date().toISOString() : sourceDoc.invoiceDate.toISOString(),
        dueDate: !fromOrder && sourceDoc.dueDate ? sourceDoc.dueDate.toISOString() : undefined,
        notes: notes ?? undefined,
        termsAndConditions: sourceDoc.termsAndConditions ?? undefined,
        // Part of a document doesn't take its charges and round-off along.
        additionalCharges: wholeDocument ? sourceDoc.additionalCharges : "0",
        charges: sourceCharges.length > 0 ? sourceCharges : undefined,
        invoiceDiscount,
        invoiceDiscountType: "amount",
        roundOff: wholeDocument ? sourceDoc.roundOff : "0",
        referenceDocumentId: sourceDoc.id,
        warehouseId: input.warehouseId ?? undefined,
        deliveryMethod: deliveryMethod ?? undefined,
        skipStockAdjustment,
        lineItems: lines.map(({ li, quantity, freeQuantity, rejectedQuantity, rejectionReason, batch }) => ({
          itemId: li.itemId ?? undefined,
          itemName: li.itemName,
          // Carry forward optional notes verbatim. Null stays null.
          description: fromRejected ? (li.rejectionReason ? `Rejected: ${li.rejectionReason}` : null) : li.description ?? null,
          quantity,
          freeQuantity: freeQuantity !== "0" ? freeQuantity : undefined,
          rejectedQuantity,
          rejectionReason,
          unitPrice: li.unitPrice,
          taxPercent: li.taxPercent,
          discountPercent: li.discountPercent,
          selectedUnit: li.selectedUnit,
          conversionFactor: li.conversionFactor,
          variantId: li.variantId,
          // The batch travels with the goods: an invoice billed from a
          // challan prints the challan's batches, a return goes back into
          // the batch it came from. Returning an expired batch to the
          // supplier is the usual case, so a purchase return allows it.
          // A batch typed in while receiving wins over the source line's.
          ...(batch
            ? { batchNumber: batch.batchNumber, expiryDate: batch.expiryDate, mfgDate: batch.mfgDate }
            : { batchId: li.batchId }),
          ...(!batch && li.batchId && targetType === "purchase_return" ? { allowExpired: true } : {}),
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
