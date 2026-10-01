import { eq, and, sql, asc, desc, inArray, isNull } from "drizzle-orm";
import { saveAllocatedLines, withAllocatedLines } from "../lib/document-totals.js";
import { z } from "zod";
import { documentStockDirection, getDocumentWarehouseId, getDefaultWarehouse, resolveDocumentWarehouseId, resolveInvoiceWarehouse, syncDocumentStock } from "../lib/inventory-service.js";
import { resolveLineBatches } from "../lib/batches.js";
import { lineBatchDetails } from "../lib/batch-display.js";
import {
  invoices,
  invoiceItems,
  items,
  itemVariants,
  businesses,
  parties,
  payments,
  paymentAllocations,
  shipments,
  itcLedgerEntries,
  eInvoiceConfigs,
} from "@fintranzact/db";
import { createInvoiceSchema, updateInvoiceStatusSchema, paginationSchema, documentTypes, invoiceChargeSchema, invoiceLineItemSchema, deliveryMethodSchema, calcLineItem, calcInvoiceTotals, isIntraStateSupply, istReturnPeriod, money, splitIntraStateTax, tdsSectionCodes } from "@fintranzact/shared";
import { router, viewerProcedure, memberProcedure, adminProcedure } from "../trpc.js";
import { TRPCError } from "@trpc/server";
import { requireCan } from "../lib/permissions.js";
import { assertNotLockedByGovernment, getGovernmentLock } from "../lib/government-lock.js";
import { assertInBusiness } from "../lib/business-scope.js";
import { logAudit } from "../lib/audit.js";
import { escapeLike } from "../lib/escape-like.js";
import { buildBusinessDateFilter } from "../lib/business-date.js";
import { IRPError } from "../lib/irp-client.js";
import { createIRPClient } from "../lib/gov-provider.js";
import { assertBillTdsInput, syncBillTds } from "../lib/tds-service.js";
import { syncPurchaseItc } from "../lib/purchase-itc.js";
import { syncInvoiceTcs } from "../lib/tcs-service.js";
import { assertPeriodOpen } from "../lib/period-lock.js";
import { resolveIRPConfig } from "../lib/irp-config.js";
import { ensureBarcodeForStock } from "../lib/barcode-setup.js";
import { mapInvoiceToIRP } from "../lib/invoice-to-irp.js";
import { assertLineExtras, lineExtras } from "../lib/line-extras.js";
import { resolveDeliveryMethod } from "../lib/delivery-methods.js";
import { recomputeInvoiceStatus, recomputeReferencedInvoice } from "../lib/invoice-status.js";
import { syncReversingItc } from "../lib/itc-reversal.js";

export const invoiceRouter = router({
  list: viewerProcedure
    .input(z.object({
      type: z.enum(["sale", "purchase"]).nullish(),
      status: z.union([
        z.enum(["draft", "unfulfilled", "sent", "paid", "partial", "overdue", "cancelled"]),
        z.array(z.enum(["draft", "unfulfilled", "sent", "paid", "partial", "overdue", "cancelled"])),
      ]).nullish(),
      partyId: z.string().uuid().nullish(),
      documentType: z.enum(documentTypes).default("invoice"),
      fromDate: z.string().datetime().nullish(),
      toDate: z.string().datetime().nullish(),
      itemId: z.string().uuid().nullish(),
      search: z.string().nullish(),
      sortBy: z.enum(["date", "amount", "number"]).nullish(),
      sortDir: z.enum(["asc", "desc"]).nullish(),
      ...paginationSchema.shape,
    }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Invoice");
      const conditions = [
        eq(invoices.businessId, ctx.businessId),
        eq(invoices.documentType, input.documentType),
        isNull(invoices.deletedAt),
      ];
      if (input.type) conditions.push(eq(invoices.type, input.type));
      if (Array.isArray(input.status)) {
        conditions.push(inArray(invoices.status, input.status));
      } else if (input.status === "overdue") {
        // Overdue is computed: due date has passed AND invoice is not paid/cancelled/draft
        conditions.push(sql`${invoices.dueDate} < NOW()`);
        conditions.push(sql`${invoices.status} NOT IN ('paid', 'cancelled', 'draft')`);
      } else if (input.status) {
        conditions.push(eq(invoices.status, input.status));
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

      // itemId filter: find invoices that contain this item
      if (input.itemId) {
        const rows = await ctx.db
          .select({ invoiceId: invoiceItems.invoiceId })
          .from(invoiceItems)
          .where(eq(invoiceItems.itemId, input.itemId));
        const ids = rows.map((r) => r.invoiceId);
        if (ids.length === 0) {
          return { data: [], total: 0, page: input.page, limit: input.limit };
        }
        conditions.push(inArray(invoices.id, ids));
      }

      const offset = (input.page - 1) * input.limit;

      // Subquery: total CN/SR/PR amount issued against each invoice
      const adjSq = ctx.db
        .select({
          refId: invoices.referenceDocumentId,
          totalAdj: sql<string>`COALESCE(SUM(${invoices.totalAmount}::numeric), 0)`.as("total_adj"),
        })
        .from(invoices)
        .where(and(
          eq(invoices.businessId, ctx.businessId),
          sql`${invoices.documentType} IN ('credit_note', 'sales_return', 'purchase_return')`,
          sql`${invoices.status} NOT IN ('cancelled')`,
          isNull(invoices.deletedAt),
        ))
        .groupBy(invoices.referenceDocumentId)
        .as("adj");

      const [data, [{ count }]] = await Promise.all([
        ctx.db.select({
          id: invoices.id,
          invoiceNumber: invoices.invoiceNumber,
          type: invoices.type,
          status: invoices.status,
          documentType: invoices.documentType,
          invoiceDate: invoices.invoiceDate,
          dueDate: invoices.dueDate,
          totalAmount: invoices.totalAmount,
          amountPaid: invoices.amountPaid,
          totalAdjusted: sql<string>`COALESCE(${adjSq.totalAdj}::text, '0')`.as("total_adjusted"),
          partyName: parties.name,
          partyId: parties.id,
          createdByName: invoices.createdByName,
          // `source` carries the origin channel: "pos", "online_store",
          // "webhook", or null for manually-typed invoices. Surfaced in the
          // list UI as a small chip so managers can tell at a glance where
          // an invoice came from.
          source: invoices.source,
        }).from(invoices)
          .innerJoin(parties, eq(parties.id, invoices.partyId))
          .leftJoin(adjSq, eq(adjSq.refId, invoices.id))
          .where(and(...conditions))
          .orderBy(
            input.sortBy === "amount"
              ? (input.sortDir === "asc" ? sql`${invoices.totalAmount}::numeric ASC` : sql`${invoices.totalAmount}::numeric DESC`)
              : input.sortBy === "number"
                ? (input.sortDir === "asc" ? invoices.invoiceNumber : desc(invoices.invoiceNumber))
                : (input.sortDir === "asc" ? invoices.invoiceDate : desc(invoices.invoiceDate))
          )
          .limit(input.limit)
          .offset(offset),
        ctx.db.select({ count: sql<number>`count(*)::int` }).from(invoices)
          .where(and(...conditions)),
      ]);

      // Compute effective status: if fully adjusted, override to "adjusted"
      const enrichedData = data.map(inv => {
        const adj = parseFloat(inv.totalAdjusted || "0");
        const total = parseFloat(inv.totalAmount);
        const effectiveStatus = (adj >= total - 0.01 && inv.status !== "cancelled" && inv.status !== "draft")
          ? "adjusted"
          : inv.status;
        return { ...inv, status: effectiveStatus };
      });

      return { data: enrichedData, total: count, page: input.page, limit: input.limit };
    }),

  getById: viewerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Invoice");
      const [invoice] = await ctx.db.select().from(invoices)
        .where(and(eq(invoices.id, input.id), eq(invoices.businessId, ctx.businessId)))
        .limit(1);

      if (!invoice) return null;

      const [lineItems, [party]] = await Promise.all([
        ctx.db.select().from(invoiceItems)
          .where(eq(invoiceItems.invoiceId, input.id))
          .orderBy(invoiceItems.sortOrder),
        ctx.db.select().from(parties)
          .where(eq(parties.id, invoice.partyId)).limit(1),
      ]);

      // Fetch the base unit for each linked item so the UI can display a unit
      // even when selectedUnit is null (i.e. the item's base unit was used).
      //
      // Historical join — soft-deleted items must still resolve here so
      // legacy invoice detail pages render correctly after the item is
      // removed from the active catalog. Do NOT add `isNull(deletedAt)`.
      const linkedItemIds = lineItems.map(li => li.itemId).filter((id): id is string => Boolean(id));
      const itemUnitMap = new Map<string, string>();
      if (linkedItemIds.length > 0) {
        const itemUnits = await ctx.db
          .select({ id: items.id, unit: items.unit })
          .from(items)
          .where(inArray(items.id, linkedItemIds));
        for (const row of itemUnits) {
          itemUnitMap.set(row.id, row.unit);
        }
      }

      const batchDetails = await lineBatchDetails(ctx.db, ctx.businessId, lineItems);
      const lineItemsWithUnit = lineItems.map(li => ({
        ...li,
        itemUnit: li.itemId ? (itemUnitMap.get(li.itemId) ?? null) : null,
        batch: li.batchId ? batchDetails.get(li.batchId) ?? null : null,
      }));

      // Fetch child documents (CN/SR) that reference this invoice
      const relatedDocs = await ctx.db.select({
        id: invoices.id,
        documentType: invoices.documentType,
        invoiceNumber: invoices.invoiceNumber,
        totalAmount: invoices.totalAmount,
        status: invoices.status,
      }).from(invoices)
        .where(and(
          eq(invoices.referenceDocumentId, input.id),
          eq(invoices.businessId, ctx.businessId),
          isNull(invoices.deletedAt),
          sql`${invoices.status} NOT IN ('cancelled')`,
        ));

      // Compute total adjusted amount (CN + SR + PR) for effective balance
      const totalAdjusted = relatedDocs
        .filter(d => ["credit_note", "sales_return", "purchase_return"].includes(d.documentType))
        .reduce((sum, d) => sum + parseFloat(d.totalAmount), 0)
        .toFixed(2);

      // Dynamic effective status: if fully adjusted by CN/SR, override to "adjusted"
      const adjNum = parseFloat(totalAdjusted);
      const invTotal = parseFloat(invoice.totalAmount);
      const effectiveStatus = (adjNum >= invTotal - 0.01 && invoice.status !== "cancelled" && invoice.status !== "draft")
        ? "adjusted"
        : invoice.status;

      // Saved choice first; older documents only show it in their movements.
      const warehouseId = invoice.warehouseId ?? await getDocumentWarehouseId(ctx.db, ctx.businessId, invoice);

      const governmentLock = await getGovernmentLock(ctx.db, ctx.businessId, invoice.id);
      return { ...invoice, status: effectiveStatus, lineItems: lineItemsWithUnit, party: party ?? null, relatedDocuments: relatedDocs, totalAdjusted, warehouseId, governmentLock };
    }),

  create: memberProcedure.input(createInvoiceSchema).mutation(async ({ input, ctx }) => {
    requireCan(ctx.ability, "create", "Invoice");
    const invoice = await ctx.db.transaction(async (tx) => {
      // Security: validate that the partyId belongs to the current business before
      // creating the invoice. Without this check an attacker could associate an
      // invoice with a party from a different business within the same tenant.
      const [partyCheck] = await tx.select({ id: parties.id, stateCode: parties.stateCode, state: parties.state, gstin: parties.gstin })
        .from(parties)
        .where(and(eq(parties.id, input.partyId), eq(parties.businessId, ctx.businessId)))
        .limit(1);
      if (!partyCheck) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Party not found in this business" });
      }
      // Stored references must be this business's documents.
      await assertInBusiness(tx, invoices, input.referenceDocumentId, ctx.businessId, "Referenced document");
      await assertInBusiness(tx, shipments, (input.charges ?? []).map((c) => c.shipmentId), ctx.businessId, "Shipment");

      // Composition scheme: block inter-state sale invoices.
      // Composition dealers may only make intra-state outward supplies (GST rule).
      if (input.type === "sale") {
        const [biz] = await tx.select({
          gstRegistrationType: businesses.gstRegistrationType,
          stateCode: businesses.stateCode,
          state: businesses.state,
          gstin: businesses.gstin,
        }).from(businesses).where(eq(businesses.id, ctx.businessId)).limit(1);

        if (biz?.gstRegistrationType === "composition") {
          if (!isIntraStateSupply(biz, partyCheck)) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Composition scheme businesses cannot make inter-state outward supplies",
            });
          }
        }
      }

      // Security: validate that every itemId in line items belongs to the current business.
      // Without this an attacker could reference items from another business — which would
      // allow stock manipulation on entities they do not own.
      //
      // Soft-delete note: this check intentionally does NOT filter by
      // `deleted_at IS NULL`. The frontend item picker only shows active
      // items, so legitimate new invoices never reference soft-deleted
      // rows in practice. Allowing soft-deleted items here is what lets
      // historical invoices still be re-submitted through the edit path
      // (or replayed via the CLI) without manual unsoft-deletion.
      const lineItemIds = input.lineItems
        .map((li) => li.itemId)
        .filter((id): id is string => Boolean(id));
      if (lineItemIds.length > 0) {
        const ownedItems = await tx.select({ id: items.id })
          .from(items)
          .where(and(inArray(items.id, lineItemIds), eq(items.businessId, ctx.businessId)));
        if (ownedItems.length !== new Set(lineItemIds).size) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "One or more items do not belong to this business" });
        }
      }

      const variantItemMap = new Map<string, string>();

      // Security: validate variantIds belong to items in this business.
      if (input.lineItems) {
        const variantIds = input.lineItems
          .map((li) => li.variantId)
          .filter((id): id is string => Boolean(id));

        if (variantIds.length > 0) {
          const ownedVariants = await tx
            .select({
              id: itemVariants.id,
              itemId: itemVariants.itemId,
            })
            .from(itemVariants)
            .innerJoin(items, eq(items.id, itemVariants.itemId))
            .where(
              and(
                inArray(itemVariants.id, variantIds),
                eq(items.businessId, ctx.businessId),
              ),
            );

          if (ownedVariants.length !== new Set(variantIds).size) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "One or more variants do not belong to this business",
            });
          }

          // A variant must always be linked to its parent item.
          for (const variant of ownedVariants) {
            variantItemMap.set(variant.id, variant.itemId);
          }

          for (const li of input.lineItems) {
            if (li.variantId && !li.itemId) {
              const parentItemId = variantItemMap.get(li.variantId);

              if (!parentItemId) {
                throw new TRPCError({
                  code: "BAD_REQUEST",
                  message: "Variant parent item could not be resolved",
                });
              }
            }
          }
        }
      }

      // Get and increment invoice number atomically
      const [biz] = await tx.select({
        prefix: businesses.invoicePrefix,
        nextNum: businesses.nextInvoiceNumber,
      }).from(businesses)
        .where(eq(businesses.id, ctx.businessId))
        .for("update");

      const invoiceNumber = `${biz.prefix}-${String(biz.nextNum).padStart(5, "0")}`;

      await tx.update(businesses)
        .set({ nextInvoiceNumber: biz.nextNum + 1 })
        .where(eq(businesses.id, ctx.businessId));

      assertLineExtras("invoice", input.lineItems);
      // Check a picked warehouse before anything reads stock in it.
      if (input.warehouseId && !input.skipStockAdjustment) {
        await resolveInvoiceWarehouse(tx, {
          businessId: ctx.businessId,
          operation: input.type === "sale" ? "sale" : "purchase",
          warehouseId: input.warehouseId,
        });
      }

      // Lines of batch-tracked items get their batch: created or picked on a
      // purchase, first-expiry-first-out on a sale. A sale line may split
      // into one line per batch.
      const stockDoc = { documentType: "invoice", type: input.type, warehouseId: input.warehouseId ?? null };
      const invoiceDate = input.invoiceDate ? new Date(input.invoiceDate) : new Date();
      // Nothing can be added to a locked period.
      await assertPeriodOpen(tx, ctx.businessId, [invoiceDate]);
      const lineItems = await resolveLineBatches(tx, {
        businessId: ctx.businessId,
        lines: input.lineItems,
        direction: input.skipStockAdjustment ? 0 : documentStockDirection(stockDoc),
        warehouseId: input.skipStockAdjustment
          ? null
          : await resolveDocumentWarehouseId(tx, { businessId: ctx.businessId, doc: stockDoc }),
        documentDate: invoiceDate,
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

      // A built-in delivery method, or one of the business's own.
      const deliveryMethod = await resolveDeliveryMethod(tx, ctx.businessId, input.deliveryMethod || "self_pickup");

      // TDS applies to purchase bills only; the amount itself is worked out after insert.
      const isBill = input.type === "purchase" && input.documentType === "invoice";
      const billTds = isBill ? assertBillTdsInput(input.tdsMode, input.tdsSection, input.tdsAmount, totals.total) : null;

      const [invoice] = await tx.insert(invoices).values({
        businessId: ctx.businessId,
        partyId: input.partyId,
        type: input.type,
        documentType: "invoice",
        invoiceNumber,
        supplierInvoiceNumber: input.type === "purchase" ? input.supplierInvoiceNumber || null : null,
        invoiceDate,
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
        warehouseId: input.skipStockAdjustment ? null : input.warehouseId ?? null,
        deliveryMethod,
        isReverseCharge: input.isReverseCharge ?? false,
        source: input.source ?? null,
        stockMode: input.skipStockAdjustment ? "none" : "tracked",
        ...(billTds ? { tdsMode: billTds.mode, tdsSection: billTds.section, tdsAmount: billTds.amount } : {}),
        tcsMode: input.type === "sale" && input.documentType === "invoice" ? input.tcsMode : "auto",
        createdByUserId: ctx.user!.id,
        createdByName: ctx.user!.name,
      }).returning();

      if (processedItems.length > 0) {
        await tx.insert(invoiceItems).values(
          withAllocatedLines(processedItems, totals.lines).map((li) => ({ ...li, invoiceId: invoice.id }))
        );
      }

      // Record inventory movement for sale/purchase invoices. An invoice billed
      // against a delivery challan (skipStockAdjustment) is stored with stock
      // mode "none": the challan already moved the goods.
      await syncDocumentStock(tx, {
        businessId: ctx.businessId,
        documentId: invoice.id,
        event: "CREATE",
        enforceStock: true,
        actorUserId: ctx.user!.id,
      });

      // Goods receipt is the moment stock becomes something you put on a
      // shelf, so anything arriving without a scannable code gets an
      // in-store one now — ready to label straight off the purchase.
      // Sales never mint codes: selling an unbarcoded item is not a
      // reason to relabel it.
      if (input.type === "purchase" && !input.skipStockAdjustment) {
        for (const li of input.lineItems) {
          const itemId = li.itemId || (li.variantId ? variantItemMap.get(li.variantId) : null);
          if (itemId) await ensureBarcodeForStock(tx, ctx.businessId, itemId, li.variantId || null);
        }
      }

      // Auto-create a shipment entry only when a shipping charge is present on a
      // sale invoice. Kept inside the transaction so a failed shipment insert
      // rolls back the whole invoice rather than leaving a charged invoice with
      // no corresponding shipment record.
      if (input.type === "sale") {
        const shippingChargeIdx = (input.charges ?? []).findIndex((c) =>
          /shipping|delivery|freight|transport/i.test(c.label)
        );
        const shippingCharge = shippingChargeIdx >= 0 ? (input.charges ?? [])[shippingChargeIdx] : undefined;
        if (shippingCharge && parseFloat(shippingCharge.amount) > 0) {
          const [newShipment] = await tx.insert(shipments).values({
            businessId: ctx.businessId,
            invoiceId: invoice.id,
            partyId: input.partyId,
            mode: deliveryMethod === "self_pickup" ? "hand_delivery" : deliveryMethod,
            cost: shippingCharge.amount,
            status: "pending",
          }).returning();

          // Tag the charge entry in the invoice with the auto-created shipment ID
          const taggedCharges = (invoice.charges ?? []).map((c, i) =>
            i === shippingChargeIdx ? { ...c, shipmentId: newShipment.id } : c
          );
          await tx.update(invoices)
            .set({ charges: taggedCharges })
            .where(eq(invoices.id, invoice.id));
          // Reflect the tag in the returned object so callers see the shipmentId
          invoice.charges = taggedCharges as typeof invoice.charges;
        }
      }

      // Auto-create ITC (Input Tax Credit) ledger entry for purchase invoices
      // with GST. ITC is not available for composition scheme businesses.
      if (input.type === "purchase" && parseFloat(totals.taxTotal) > 0) {
        const [bizForItc] = await tx.select({
          gstRegistrationType: businesses.gstRegistrationType,
          stateCode: businesses.stateCode,
          state: businesses.state,
          gstin: businesses.gstin,
        }).from(businesses).where(eq(businesses.id, ctx.businessId)).limit(1);

        if (bizForItc?.gstRegistrationType !== "composition") {
          const invoiceDate = input.invoiceDate ? new Date(input.invoiceDate) : new Date();
          // The return month the invoice falls in, by the calendar in India
          const returnPeriod = istReturnPeriod(invoiceDate);

          // Shared place-of-supply rule (unknown supplier state → intra-state)
          const sameState = isIntraStateSupply(bizForItc ?? {}, partyCheck);

          // CGST = half rounded to the paisa, SGST = the rest (shared rule)
          let cgst = "0";
          let sgst = "0";
          let igst = "0";

          if (sameState) {
            const split = splitIntraStateTax(totals.taxTotal);
            cgst = split.cgst.toFixed(2);
            sgst = split.sgst.toFixed(2);
          } else {
            igst = money.add(totals.taxTotal, 0);
          }

          await tx.insert(itcLedgerEntries).values({
            businessId: ctx.businessId,
            invoiceId: invoice.id,
            returnPeriod,
            status: "available",
            cgst,
            sgst,
            igst,
            cess: "0",
            isReverseCharge: input.isReverseCharge ?? false,
          });
        }
      }

      // TDS on the purchase: deducted when the bill is credited, settled against it.
      if (isBill) {
        await syncBillTds(tx, { businessId: ctx.businessId, invoiceId: invoice.id, userId: ctx.user!.id, userName: ctx.user!.name });
        const [fresh] = await tx.select().from(invoices).where(eq(invoices.id, invoice.id)).limit(1);
        return fresh ?? invoice;
      }

      // TCS on the sale: collected from the customer with the invoice, on items with a TCS section.
      if (input.type === "sale" && input.documentType === "invoice") {
        await syncInvoiceTcs(tx, { businessId: ctx.businessId, invoiceId: invoice.id });
        const [fresh] = await tx.select().from(invoices).where(eq(invoices.id, invoice.id)).limit(1);
        return fresh ?? invoice;
      }

      return invoice;
    });

    await logAudit(ctx.db, {
      businessId: ctx.businessId,
      userId: ctx.user!.id,
      action: "invoice.create",
      entityType: "invoice",
      entityId: invoice.id,
      metadata: { invoiceNumber: invoice.invoiceNumber, type: invoice.type, totalAmount: invoice.totalAmount },
      ipAddress: ctx.ipAddress,
    });

    // ── Async e-invoice submission (fire-and-forget) ───────────────────────
    // Invoice creation MUST NOT fail due to IRP errors. We check eligibility
    // synchronously but submit asynchronously so the HTTP response is returned
    // immediately while the IRP call happens in the background.
    // Eligibility: sale invoice, B2B (party has GSTIN), tax > 0, e-invoicing enabled.
    if (
      input.type === "sale" &&
      input.documentType !== "quotation" &&
      input.documentType !== "delivery_challan" &&
      input.documentType !== "proforma" &&
      parseFloat(invoice.taxAmount) > 0
    ) {
      // Capture everything needed for the async task before returning
      const invoiceId = invoice.id;
      const businessId = ctx.businessId;
      const db = ctx.db;

      // Non-blocking: check e-invoice config + party GSTIN
      setTimeout(async () => {
        try {
          const [config] = await db
            .select()
            .from(eInvoiceConfigs)
            .where(and(eq(eInvoiceConfigs.businessId, businessId), eq(eInvoiceConfigs.isEnabled, true)))
            .limit(1);

          if (!config) return; // E-invoicing not configured/enabled

          // Fetch the full invoice with party
          const [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
          if (!inv) return;

          const [party] = await db.select().from(parties).where(eq(parties.id, inv.partyId)).limit(1);
          // B2C — skip. Exports to overseas buyers (no GSTIN) are e-invoiced.
          if (!party || (!party.gstin && party.gstRegistrationType !== "overseas")) return;

          const [biz] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
          if (!biz) return;

          // Historical join — the IRP submission is for a specific
          // (already created) invoice. Soft-deleted items must still
          // resolve so their HSN/itemType survive into the IRP payload.
          // Do NOT filter by `deletedAt` here.
          const lineItemRows = await db
            .select({
              itemName: invoiceItems.itemName,
              description: invoiceItems.description,
              quantity: invoiceItems.quantity,
              freeQuantity: invoiceItems.freeQuantity,
              unitPrice: invoiceItems.unitPrice,
              taxPercent: invoiceItems.taxPercent,
              taxAmount: invoiceItems.taxAmount,
              discountPercent: invoiceItems.discountPercent,
              totalAmount: invoiceItems.totalAmount,
              selectedUnit: invoiceItems.selectedUnit,
              itemType: items.itemType,
              itemHsn: items.hsn,
            })
            .from(invoiceItems)
            .leftJoin(items, eq(items.id, invoiceItems.itemId))
            .where(eq(invoiceItems.invoiceId, invoiceId))
            .orderBy(invoiceItems.sortOrder);

          // Mark as pending
          await db
            .update(invoices)
            .set({ eInvoiceStatus: "pending", updatedAt: new Date() })
            .where(eq(invoices.id, invoiceId));

          const irpJson = mapInvoiceToIRP(
            {
              invoiceNumber: inv.invoiceNumber,
              invoiceDate: inv.invoiceDate,
              type: inv.type,
              documentType: inv.documentType,
              subtotal: inv.subtotal,
              taxAmount: inv.taxAmount,
              discountAmount: inv.discountAmount,
              additionalCharges: inv.additionalCharges,
              tcsAmount: inv.tcsAmount,
              roundOff: inv.roundOff,
              totalAmount: inv.totalAmount,
              isReverseCharge: inv.isReverseCharge ?? false,
            },
            lineItemRows.map((li) => ({
              itemName: li.itemName,
              description: li.description,
              quantity: li.quantity,
              freeQuantity: li.freeQuantity,
              unitPrice: li.unitPrice,
              taxPercent: li.taxPercent,
              taxAmount: li.taxAmount,
              discountPercent: li.discountPercent,
              totalAmount: li.totalAmount,
              selectedUnit: li.selectedUnit,
              itemType: li.itemType,
              itemHsn: li.itemHsn,
            })),
            {
              gstin: party.gstin,
              name: party.name,
              billingAddress: party.billingAddress,
              city: party.city,
              state: party.state,
              stateCode: party.stateCode,
              pincode: party.pincode,
              phone: party.phone,
              email: party.email,
              gstRegistrationType: party.gstRegistrationType,
            },
            {
              gstin: biz.gstin,
              legalName: biz.legalName,
              name: biz.name,
              address: biz.address,
              city: biz.city,
              state: biz.state,
              stateCode: biz.stateCode,
              pincode: biz.pincode,
              phone: biz.phone,
              email: biz.email,
            },
          );

          const client = createIRPClient(resolveIRPConfig(config), db);
          const result = await client.generateIRN(irpJson);

          await db
            .update(invoices)
            .set({
              irn: result.irn,
              irnAckNumber: result.ackNo,
              irnAckDate: result.ackDt,
              signedQrCode: result.signedQrCode,
              signedInvoice: { signedInvoice: result.signedInvoice },
              eInvoiceStatus: "generated",
              eInvoiceError: null,
              updatedAt: new Date(),
            })
            .where(eq(invoices.id, invoiceId));
        } catch (err) {
          // IRP errors must not bubble up — just log and mark as failed
          const isRetryable = err instanceof IRPError && err.isRetryable;
          const errorMsg = err instanceof Error ? err.message : "Unknown IRP error";
          if (process.env.NODE_ENV !== "test") {
            console.error("[e-invoice auto-submit]", errorMsg);
          }
          await db
            .update(invoices)
            .set({
              eInvoiceStatus: isRetryable ? "pending" : "failed",
              eInvoiceError: errorMsg,
              eInvoiceRetryCount: sql`COALESCE(${invoices.eInvoiceRetryCount}, 0) + 1`,
              updatedAt: new Date(),
            })
            .where(eq(invoices.id, invoiceId))
            .catch(() => {/* swallow DB errors in background task */ });
        }
      }, 0);
    }

    return invoice;
  }),

  // Get the delivery method used on the most recent sale invoice for a party
  lastDeliveryMethod: viewerProcedure
    .input(z.object({ partyId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      requireCan(ctx.ability, "read", "Invoice");
      const [row] = await ctx.db.select({ deliveryMethod: invoices.deliveryMethod })
        .from(invoices)
        .where(and(
          eq(invoices.businessId, ctx.businessId),
          eq(invoices.partyId, input.partyId),
          eq(invoices.type, "sale"),
          eq(invoices.documentType, "invoice"),
          isNull(invoices.deletedAt),
        ))
        .orderBy(desc(invoices.invoiceDate))
        .limit(1);
      return row?.deliveryMethod || "self_pickup";
    }),

  updateStatus: memberProcedure
    .input(z.object({ id: z.string().uuid(), ...updateInvoiceStatusSchema.shape }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "Invoice");
      if (input.status === "cancelled") {
        await assertNotLockedByGovernment(ctx.db, ctx.businessId, input.id, "cancel");
      }
      // Fetch current status before the update for audit metadata
      const [before] = await ctx.db.select({ status: invoices.status, invoiceDate: invoices.invoiceDate })
        .from(invoices)
        .where(and(eq(invoices.id, input.id), eq(invoices.businessId, ctx.businessId)))
        .limit(1);
      await assertPeriodOpen(ctx.db, ctx.businessId, [before?.invoiceDate]);

      const invoice = await ctx.db.transaction(async (tx) => {
        const [updated] = await tx.update(invoices)
          .set({ status: input.status, updatedAt: new Date() })
          .where(and(eq(invoices.id, input.id), eq(invoices.businessId, ctx.businessId)))
          .returning();

        if (!updated) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
        }

        // A cancelled invoice gives its stock back; reinstating it takes the
        // stock out again.
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
          // A cancelled or reinstated note or return changes what settles its invoice.
          await recomputeReferencedInvoice(tx, ctx.businessId, updated);
          await syncReversingItc(tx, ctx.businessId, input.id);
        }
        // A sale invoice's TCS follows whether it is live (not cancelled or deleted).
        if (updated.type === "sale" && updated.documentType === "invoice" && before?.status !== input.status) {
          await syncInvoiceTcs(tx, { businessId: ctx.businessId, invoiceId: updated.id });
          const [fresh] = await tx.select().from(invoices).where(eq(invoices.id, updated.id)).limit(1);
          return fresh ?? updated;
        }
        // A purchase bill's TDS follows whether the bill is live (not cancelled or deleted).
        if (updated.type === "purchase" && updated.documentType === "invoice" && before?.status !== input.status) {
          await syncBillTds(tx, { businessId: ctx.businessId, invoiceId: updated.id, userId: ctx.user!.id, userName: ctx.user!.name });
          const [fresh] = await tx.select().from(invoices).where(eq(invoices.id, updated.id)).limit(1);
          return fresh ?? updated;
        }
        return updated;
      });

      // Auto-reverse ITC when a purchase invoice is cancelled
      if (input.status === "cancelled" && invoice.type === "purchase" && invoice.documentType === "invoice") {
        await ctx.db.update(itcLedgerEntries)
          .set({ status: "reversed", reversalReason: "invoice_cancelled", updatedAt: new Date() })
          .where(and(
            eq(itcLedgerEntries.invoiceId, input.id),
            eq(itcLedgerEntries.businessId, ctx.businessId),
            inArray(itcLedgerEntries.status, ["available", "blocked"]),
          ));
      }

      logAudit(ctx.db, {
        businessId: ctx.businessId,
        userId: ctx.user!.id,
        action: "invoice.updateStatus",
        entityType: "invoice",
        entityId: input.id,
        metadata: { invoiceNumber: invoice.invoiceNumber, fromStatus: before?.status, toStatus: input.status },
        ipAddress: ctx.ipAddress,
      });

      return invoice;
    }),

  update: memberProcedure
    .input(z.object({
      id: z.string().uuid(),
      partyId: z.string().uuid().optional(),
      invoiceDate: z.string().datetime().optional(),
      dueDate: z.string().datetime().optional().nullable(),
      /** Purchase invoices: the supplier's bill number (null clears it). */
      supplierInvoiceNumber: z.string().trim().max(50).optional().nullable(),
      notes: z.string().max(2000).optional().nullable(),
      termsAndConditions: z.string().max(2000).optional().nullable(),
      charges: z.array(invoiceChargeSchema).optional(),
      invoiceDiscount: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
      invoiceDiscountType: z.enum(["amount", "percent"]).optional(),
      roundOff: z.string().regex(/^-?\d+(\.\d{1,2})?$/).optional(),
      lineItems: z.array(invoiceLineItemSchema).min(1).optional(),
      warehouseId: z.string().uuid().nullish(),
      /** A built-in delivery method or one from Settings → Shipping. */
      deliveryMethod: deliveryMethodSchema.optional(),
      /** TDS on a purchase bill: auto, none, or manual (with tdsSection + tdsAmount). */
      tdsMode: z.enum(["auto", "none", "manual"]).optional(),
      tdsSection: z.enum(tdsSectionCodes).optional().nullable(),
      tdsAmount: z.string().regex(/^\d{1,13}(\.\d{1,2})?$/).optional(),
      /** TCS on a sale: auto (from the items' TCS sections) or none. */
      tcsMode: z.enum(["auto", "none"]).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "update", "Invoice");
      // Owner decision: sellers create documents but never edit them; a
      // manager or admin makes corrections.
      if (ctx.role === "seller") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Sellers can't edit invoices. Ask a sales manager or admin to make the change." });
      }
      await assertNotLockedByGovernment(ctx.db, ctx.businessId, input.id, "edit");
      const updated = await ctx.db.transaction(async (tx) => {
        // 1. Fetch existing invoice
        const [existing] = await tx.select()
          .from(invoices)
          .where(and(eq(invoices.id, input.id), eq(invoices.businessId, ctx.businessId)))
          .for("update")
          .limit(1);

        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
        // Neither the old nor the new date may be in a locked period.
        await assertPeriodOpen(tx, ctx.businessId, [existing.invoiceDate, input.invoiceDate]);
        if (existing.status === "paid") throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot edit a paid invoice. Remove payments first." });

        // Security: validate partyId belongs to this business before applying the update.
        if (input.partyId) {
          const [partyCheck] = await tx.select({ id: parties.id })
            .from(parties)
            .where(and(eq(parties.id, input.partyId), eq(parties.businessId, ctx.businessId)))
            .limit(1);
          if (!partyCheck) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Party not found in this business" });
          }
        }

        // Security: validate itemIds in line items belong to this business.
        // Soft-delete note: like `create`, this is an ownership check, not
        // an active-state check. Allowing soft-deleted items keeps the
        // edit path working for historical invoices whose line items
        // reference rows the user has since removed from their catalog.
        if (input.lineItems) {
          const updateLineItemIds = input.lineItems
            .map((li) => li.itemId)
            .filter((id): id is string => Boolean(id));
          if (updateLineItemIds.length > 0) {
            const ownedItems = await tx.select({ id: items.id })
              .from(items)
              .where(and(inArray(items.id, updateLineItemIds), eq(items.businessId, ctx.businessId)));
            if (ownedItems.length !== new Set(updateLineItemIds).size) {
              throw new TRPCError({ code: "BAD_REQUEST", message: "One or more items do not belong to this business" });
            }
          }

          // Security: validate variantIds belong to items in this business.
          // Same soft-delete rationale as above.
          const updateVariantIds = input.lineItems
            .map((li) => li.variantId)
            .filter((id): id is string => Boolean(id));
          if (updateVariantIds.length > 0) {
            const ownedVariants = await tx.select({ id: itemVariants.id })
              .from(itemVariants)
              .innerJoin(items, eq(items.id, itemVariants.itemId))
              .where(and(inArray(itemVariants.id, updateVariantIds), eq(items.businessId, ctx.businessId)));
            if (ownedVariants.length !== new Set(updateVariantIds).size) {
              throw new TRPCError({ code: "BAD_REQUEST", message: "One or more variants do not belong to this business" });
            }
          }
        }

        // 2. Build update payload
        const updates: Record<string, any> = { updatedAt: new Date() };

        if (input.partyId && input.partyId !== existing.partyId) {
          // Payments and credit notes/returns were made by (or to) the old
          // party; moving the invoice would leave them pointing at someone
          // else's bill. Same rule as editing a paid invoice.
          const [paid] = await tx.select({ id: paymentAllocations.id })
            .from(paymentAllocations)
            .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
            .where(and(
              eq(paymentAllocations.invoiceId, input.id),
              isNull(payments.deletedAt),
              sql`${payments.source} IS DISTINCT FROM 'tds'`, // the bill's own TDS adjustment is re-worked below
            ))
            .limit(1);
          const [adjusted] = await tx.select({ id: invoices.id })
            .from(invoices)
            .where(and(
              eq(invoices.referenceDocumentId, input.id),
              isNull(invoices.deletedAt),
              sql`${invoices.status} <> 'cancelled'`,
            ))
            .limit(1);
          if (paid || adjusted) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "This invoice has payments or documents made against it. Remove them before changing the party." });
          }
          // A shipment goes to the invoice's party.
          await tx.update(shipments).set({ partyId: input.partyId, updatedAt: new Date() })
            .where(and(eq(shipments.invoiceId, input.id), eq(shipments.businessId, ctx.businessId)));
        }
        if (input.partyId) updates.partyId = input.partyId;
        if (input.invoiceDate) updates.invoiceDate = new Date(input.invoiceDate);
        if (input.dueDate !== undefined) updates.dueDate = input.dueDate ? new Date(input.dueDate) : null;
        if (input.notes !== undefined) updates.notes = input.notes;
        if (input.termsAndConditions !== undefined) updates.termsAndConditions = input.termsAndConditions;
        if (input.supplierInvoiceNumber !== undefined && existing.type === "purchase") {
          updates.supplierInvoiceNumber = input.supplierInvoiceNumber || null;
        }
        // Keeping the saved method is always fine, even one since removed
        // from Settings → Shipping; a change must be one the business offers.
        if (input.deliveryMethod !== undefined && input.deliveryMethod !== existing.deliveryMethod) {
          updates.deliveryMethod = await resolveDeliveryMethod(tx, ctx.businessId, input.deliveryMethod);
        }

        // 3. Handle charges — preserve shipment-linked entries that should not be
        // directly edited by the user (they are managed via shipment mutations).
        if (input.charges !== undefined) {
          const existingShipmentCharges = (existing.charges ?? []).filter((c) => (c as { shipmentId?: string }).shipmentId);
          const userCharges = (input.charges ?? []).filter((c) => !(c as { shipmentId?: string }).shipmentId);
          const mergedCharges = [...userCharges, ...existingShipmentCharges];
          updates.charges = mergedCharges.length > 0 ? mergedCharges : null;
          updates.additionalCharges = mergedCharges.length > 0
            ? money.sum(mergedCharges.map((c) => c.amount))
            : "0.00";
        }
        if (input.roundOff !== undefined) updates.roundOff = input.roundOff;

        // Moving an invoice's stock to another warehouse means re-posting its
        // lines, so a warehouse change has to come with them.
        if (
          input.warehouseId !== undefined &&
          (input.warehouseId ?? null) !== existing.warehouseId &&
          !input.lineItems
        ) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Send the invoice lines to change its warehouse" });
        }

        // 4. Handle line items — delete old, insert new, recalculate totals
        let lineItems: typeof input.lineItems = input.lineItems;
        if (input.lineItems) {

          assertLineExtras(existing.documentType, input.lineItems);
          // Batches for the new lines, counting what this invoice already
          // holds as available again.
          const newWarehouseId = input.warehouseId !== undefined
            ? input.warehouseId ?? (await getDefaultWarehouse(tx, {
                businessId: ctx.businessId,
                operation: existing.type === "sale" ? "sale" : "purchase",
              })).id
            : undefined;
          if (input.warehouseId) {
            await resolveInvoiceWarehouse(tx, {
              businessId: ctx.businessId,
              operation: existing.type === "sale" ? "sale" : "purchase",
              warehouseId: input.warehouseId,
            });
          }
          const moves = existing.stockMode !== "none";
          lineItems = await resolveLineBatches(tx, {
            businessId: ctx.businessId,
            lines: input.lineItems,
            direction: moves ? documentStockDirection(existing) : 0,
            warehouseId: moves
              ? await resolveDocumentWarehouseId(tx, { businessId: ctx.businessId, doc: existing, warehouseId: newWarehouseId })
              : null,
            documentDate: input.invoiceDate ? new Date(input.invoiceDate) : existing.invoiceDate,
            documentId: existing.id,
            strict: true,
          });

          // Step 3: Delete existing line items
          await tx.delete(invoiceItems).where(eq(invoiceItems.invoiceId, input.id));

          // Step 4: Process and insert new line items using fixed-point arithmetic
          const processedItems = lineItems.map((li, idx) => {
            const calc = calcLineItem({
              quantity: li.quantity,
              unitPrice: li.unitPrice,
              taxPercent: li.taxPercent || "0",
              discountPercent: li.discountPercent || "0",
            });
            return {
              invoiceId: input.id,
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

          if (processedItems.length > 0) {
            await tx.insert(invoiceItems).values(processedItems);
          }

          // Step 5: Post only the change in stock against the new lines.
          await syncDocumentStock(tx, {
            businessId: ctx.businessId,
            documentId: input.id,
            event: "UPDATE",
            // null picks the business default again.
            warehouseId: newWarehouseId,
            enforceStock: true,
            actorUserId: ctx.user!.id,
          });
          if (input.warehouseId !== undefined) updates.warehouseId = input.warehouseId ?? null;
        }

        // Recalculate totals whenever anything they're made of changes — the
        // lines, or just the charges, discount or round-off — so the saved
        // total always matches its parts.
        if (
          input.lineItems ||
          input.charges !== undefined ||
          input.invoiceDiscount !== undefined ||
          input.roundOff !== undefined
        ) {
          const linesForTotals = lineItems ?? await tx
            .select({
              quantity: invoiceItems.quantity,
              unitPrice: invoiceItems.unitPrice,
              taxPercent: invoiceItems.taxPercent,
              discountPercent: invoiceItems.discountPercent,
            })
            .from(invoiceItems)
            .where(eq(invoiceItems.invoiceId, input.id))
            .orderBy(asc(invoiceItems.sortOrder), asc(invoiceItems.id));

          // Use merged charges (updates.charges) if charges were modified; otherwise
          // fall back to existing charges. This ensures shipment-linked charge entries
          // are included in the total even when the user didn't touch charges.
          const itemisedCharges = updates.charges !== undefined
            ? (updates.charges as Array<{ amount: string }> | null) ?? []
            : (existing.charges as Array<{ amount: string }> | null) ?? [];
          // An invoice with a flat additionalCharges and no itemised charges
          // keeps counting it, as it did when it was created.
          const chargesForTotals = itemisedCharges.length > 0 || updates.charges !== undefined
            ? itemisedCharges
            : [{ amount: existing.additionalCharges ?? "0" }];
          const roundOffStr = input.roundOff !== undefined ? input.roundOff : existing.roundOff;
          // A stored discount is always an amount; a new one may be a percent.
          const totals = calcInvoiceTotals({
            lineItems: linesForTotals.map((li) => ({
              quantity: li.quantity,
              unitPrice: li.unitPrice,
              taxPercent: li.taxPercent || "0",
              discountPercent: li.discountPercent || "0",
            })),
            charges: chargesForTotals.length > 0 ? chargesForTotals : undefined,
            invoiceDiscount: input.invoiceDiscount ?? existing.discountAmount ?? "0",
            invoiceDiscountType: input.invoiceDiscount !== undefined ? input.invoiceDiscountType || "amount" : "amount",
            roundOff: roundOffStr,
          });

          updates.subtotal = totals.subtotal;
          updates.taxAmount = totals.taxTotal;
          updates.discountAmount = totals.invoiceDiscountAmount;
          // The total includes the TCS already collected; syncInvoiceTcs below adjusts it.
          updates.totalAmount = existing.type === "sale" && existing.documentType === "invoice"
            ? money.add(totals.total, existing.tcsAmount)
            : totals.total;
          // The document discount is shared over the lines, so their tax moves with it.
          await saveAllocatedLines(tx, input.id, totals.lines);
        }

        if (input.tcsMode !== undefined && existing.type === "sale" && existing.documentType === "invoice") {
          updates.tcsMode = input.tcsMode;
        }

        // TDS settings entered on a purchase bill.
        const isBill = existing.type === "purchase" && existing.documentType === "invoice";
        if (isBill && (input.tdsMode !== undefined || input.tdsSection !== undefined || input.tdsAmount !== undefined)) {
          const mode = input.tdsMode ?? (existing.tdsMode as "auto" | "none" | "manual");
          const section = input.tdsSection === undefined ? existing.tdsSection : input.tdsSection;
          const amount = input.tdsAmount ?? existing.tdsAmount;
          const checked = assertBillTdsInput(mode, section ?? undefined, amount, updates.totalAmount ?? existing.totalAmount);
          updates.tdsMode = checked.mode;
          updates.tdsSection = checked.section;
          updates.tdsAmount = checked.amount;
        }

        // 5. Apply update
        const [result] = await tx.update(invoices).set(updates).where(eq(invoices.id, input.id)).returning();
        // An edited return or note to a supplier takes back its new tax.
        await syncReversingItc(tx, ctx.businessId, result.id);

        // A new total changes how much of it is settled: for a note or return,
        // on the invoice it adjusts; for an invoice, on itself.
        if (updates.totalAmount !== undefined && updates.totalAmount !== existing.totalAmount) {
          await recomputeReferencedInvoice(tx, ctx.businessId, result);
          if (result.documentType === "invoice") {
            const status = await recomputeInvoiceStatus(tx, ctx.businessId, result.id);
            if (status) result.status = status;
          }
        }

        // A purchase's input tax credit follows its tax, party and date.
        if (existing.status !== "cancelled" && !existing.deletedAt && (input.lineItems || input.partyId || input.invoiceDate)) {
          await syncPurchaseItc(tx, ctx.businessId, input.id);
        }

        // A sale invoice's TCS follows its lines, customer, date and TCS mode.
        if (existing.type === "sale" && existing.documentType === "invoice") {
          await syncInvoiceTcs(tx, { businessId: ctx.businessId, invoiceId: input.id });
          const [fresh] = await tx.select().from(invoices).where(eq(invoices.id, input.id)).limit(1);
          return fresh ?? result;
        }

        // A purchase bill's TDS follows its value, supplier, date and TDS settings.
        if (isBill) {
          await syncBillTds(tx, { businessId: ctx.businessId, invoiceId: input.id, userId: ctx.user!.id, userName: ctx.user!.name });
          const [fresh] = await tx.select().from(invoices).where(eq(invoices.id, input.id)).limit(1);
          return fresh ?? result;
        }

        return result;
      });

      logAudit(ctx.db, {
        businessId: ctx.businessId,
        userId: ctx.user!.id,
        action: "invoice.update",
        entityType: "invoice",
        entityId: updated.id,
        metadata: { invoiceNumber: updated.invoiceNumber },
        ipAddress: ctx.ipAddress,
      });

      return updated;
    }),

  delete: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      requireCan(ctx.ability, "delete", "Invoice");

      const [inv] = await ctx.db.select({ status: invoices.status, type: invoices.type, documentType: invoices.documentType, invoiceNumber: invoices.invoiceNumber, invoiceDate: invoices.invoiceDate, deletedAt: invoices.deletedAt, createdAt: invoices.createdAt })
        .from(invoices)
        .where(and(eq(invoices.id, input.id), eq(invoices.businessId, ctx.businessId)))
        .limit(1);

      if (!inv) return { success: true };
      if (inv.deletedAt) return { success: true }; // already soft-deleted
      await assertPeriodOpen(ctx.db, ctx.businessId, [inv.invoiceDate]);
      await assertNotLockedByGovernment(ctx.db, ctx.businessId, input.id, "delete");

      // seller_manager: can only delete unpaid invoices created within the last 2 hours
      if (ctx.role === "seller_manager") {
        if (inv.status === "paid") {
          throw new TRPCError({ code: "FORBIDDEN", message: "Cannot delete paid invoices" });
        }
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
        if (inv.createdAt < twoHoursAgo) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Can only delete invoices within 2 hours of creation" });
        }
      }

      await ctx.db.transaction(async (tx) => {


        // Auto-reverse ITC when a purchase invoice is deleted
        if (inv.type === "purchase" && inv.documentType === "invoice") {
          await tx.update(itcLedgerEntries)
            .set({ status: "reversed", reversalReason: "invoice_cancelled", updatedAt: new Date() })
            .where(and(
              eq(itcLedgerEntries.invoiceId, input.id),
              eq(itcLedgerEntries.businessId, ctx.businessId),
              inArray(itcLedgerEntries.status, ["available", "blocked"]),
            ));
        }

        // Soft delete
        await tx.update(invoices)
          .set({ deletedAt: new Date(), status: "cancelled" as const, updatedAt: new Date() })
          .where(and(eq(invoices.id, input.id), eq(invoices.businessId, ctx.businessId)));

        // A deleted invoice holds no stock.
        await syncDocumentStock(tx, {
          businessId: ctx.businessId,
          documentId: input.id,
          event: "DELETE",
          actorUserId: ctx.user!.id,
        });

        // ...and no TDS: take the bill's TDS adjustment out.
        if (inv.type === "purchase" && inv.documentType === "invoice") {
          await syncBillTds(tx, { businessId: ctx.businessId, invoiceId: input.id });
        }
        // ...and no TCS on a deleted sale.
        if (inv.type === "sale" && inv.documentType === "invoice") {
          await syncInvoiceTcs(tx, { businessId: ctx.businessId, invoiceId: input.id });
        }

        // A deleted note or return no longer settles its invoice.
        const [deleted] = await tx.select({ documentType: invoices.documentType, referenceDocumentId: invoices.referenceDocumentId })
          .from(invoices).where(eq(invoices.id, input.id)).limit(1);
        if (deleted) await recomputeReferencedInvoice(tx, ctx.businessId, deleted);
        await syncReversingItc(tx, ctx.businessId, input.id);
      });

      await logAudit(ctx.db, {
        businessId: ctx.businessId,
        userId: ctx.user!.id,
        action: "invoice.delete",
        entityType: "invoice",
        entityId: input.id,
        metadata: { invoiceNumber: inv.invoiceNumber, previousStatus: inv.status },
        ipAddress: ctx.ipAddress,
      });

      return { success: true };
    }),
});
