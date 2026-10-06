/**
 * Refunding a paid online store order, in full or in part, through the
 * business's OWN Razorpay account, with the books kept straight.
 *
 * Order of events (each step safe to repeat with the same idempotency key):
 *   1. a refund row is written "pending" (unique per business and key, and
 *      capped under a per-order lock so two requests cannot refund more than
 *      was paid);
 *   2. Razorpay is asked to refund that payment, with the row id as Razorpay's
 *      own idempotency key;
 *   3. a credit note against the order's invoice books it (GST reversed with
 *      the sale: one line per tax rate in the order);
 *   4. one transaction settles it: the note is marked refunded, the invoice has
 *      that much less paid against it, the gateway account gets the money-out
 *      entry, the order's payment state moves to
 *      partially refunded / refunded and (cancellation) the stock the order
 *      took goes back. The row becomes "processed".
 * A repeat of a finished request answers with the first result; a repeat of
 * an interrupted one carries on from where it stopped. If Razorpay refuses, the
 * row is "failed" and nothing in the books changes.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import {
  bankAccounts,
  bankTransactions,
  invoiceItems,
  invoices,
  paymentAllocations,
  payments,
  razorpayPayments,
  storeOrderRefunds,
  storeOrders,
  type TenantDatabase,
} from "@fintranzact/db";
import { calcInvoiceTotals, chargeSupplyOf, createInvoiceSchema, money } from "@fintranzact/shared";
import { createCallerFactory } from "../../trpc.js";
import { creditNoteRouter } from "../../routers/document.js";
import { logAudit } from "../audit.js";
import { applyInvoicePayment } from "../invoice-status.js";
import { documentIsIntraState } from "../document-totals.js";
import { syncDocumentStock } from "../inventory-service.js";
import { logger } from "../logger.js";
import { decryptConnection, getConnectionRow } from "../razorpay/connection.js";
import { moneyToPaise, paiseToMoney, razorpay } from "../razorpay/client.js";
import { findRazorpayGatewayAccount } from "../razorpay/webhook.js";
import { sendStoreOrderEmail } from "./emails.js";

export type RefundErrorCode = "NOT_FOUND" | "BAD_REQUEST" | "CONFLICT" | "PRECONDITION_FAILED" | "BAD_GATEWAY";

export class RefundError extends Error {
  constructor(
    readonly code: RefundErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RefundError";
  }
}

// ── Pure arithmetic (unit tested) ───────────────────────────────────────────

/**
 * Split a refund (paise) across the order's tax rates in proportion to what
 * each rate contributed to the order total, with the rounding left over given
 * out one paisa at a time to the biggest remainders, so the parts always add
 * up to exactly the refund.
 */
export function splitRefundByRate(
  groups: Array<{ taxPercent: string; grossPaise: number }>,
  refundPaise: number,
): Array<{ taxPercent: string; grossPaise: number }> {
  const total = groups.reduce((s, g) => s + g.grossPaise, 0);
  if (total <= 0 || refundPaise <= 0) return [];
  const raw = groups.map((g) => ({ taxPercent: g.taxPercent, exact: (refundPaise * g.grossPaise) / total }));
  const floors = raw.map((r) => Math.floor(r.exact));
  let left = refundPaise - floors.reduce((s, f) => s + f, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r.exact - Math.floor(r.exact) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i] = (floors[i] ?? 0) + 1;
    left--;
  }
  return raw.map((r, i) => ({ taxPercent: r.taxPercent, grossPaise: floors[i] ?? 0 })).filter((g) => g.grossPaise > 0);
}

/**
 * The tax-exclusive price that makes a one-line credit note come to `grossPaise`
 * with GST at `taxPercent` (the document calculator adds tax on top of the
 * price). Tries the nearest prices and keeps the one that lands on the amount;
 * when none does exactly (CGST/SGST rounding), the closest.
 */
export function netPriceForGross(grossPaise: number, taxPercent: string, intraState: boolean): { unitPrice: string; total: string } {
  const rate = Number(taxPercent) || 0;
  const guess = Math.round((grossPaise * 100) / (100 + rate));
  let best = { unitPrice: paiseToMoney(guess), total: "0.00", diff: Number.POSITIVE_INFINITY };
  for (let d = -3; d <= 3; d++) {
    const net = guess + d;
    if (net < 0) continue;
    const unitPrice = paiseToMoney(net);
    const { total } = calcInvoiceTotals({
      lineItems: [{ quantity: "1", unitPrice, taxPercent, discountPercent: "0" }],
      intraState,
    });
    const diff = Math.abs(moneyToPaise(total) - grossPaise);
    if (diff < best.diff) best = { unitPrice, total, diff };
    if (diff === 0) break;
  }
  return { unitPrice: best.unitPrice, total: best.total };
}

// ── The refund ──────────────────────────────────────────────────────────────

/** What the caller's request context must provide (the tRPC context of an owner/admin). */
export interface RefundContext {
  db: TenantDatabase;
  tenantId: string;
  businessId: string;
  user: { id: string; name?: string | null };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  req: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resHeaders: any;
  ipAddress?: string | null;
}

export interface RefundInput {
  orderId: string;
  /** Money string; omitted refunds everything still refundable on the order's payment. */
  amount?: string;
  reason?: string;
  idempotencyKey: string;
  /** Cancellation: the stock the order took goes back into stock. */
  restock?: boolean;
}

export interface RefundResult {
  refundId: string;
  razorpayRefundId: string;
  /** Money string. */
  amount: string;
  creditNoteId: string;
  creditNoteNumber: string;
  paymentStatus: "partially_refunded" | "refunded";
  /** True when this answered an earlier, finished request with the same key. */
  replayed: boolean;
}

/** What can still be refunded on an order (money string), counting refunds pending or done. */
export async function refundableForOrder(db: Pick<TenantDatabase, "select">, businessId: string, invoiceId: string): Promise<{ paidPaise: number; refundedPaise: number; remainingPaise: number }> {
  const [paid] = await db
    .select({ n: sql<string>`COALESCE(SUM(${razorpayPayments.amountPaise}), 0)::text` })
    .from(razorpayPayments)
    .where(and(eq(razorpayPayments.businessId, businessId), eq(razorpayPayments.invoiceId, invoiceId)));
  const [refunded] = await db
    .select({ n: sql<string>`COALESCE(SUM(${storeOrderRefunds.amountPaise}), 0)::text` })
    .from(storeOrderRefunds)
    .innerJoin(storeOrders, eq(storeOrders.id, storeOrderRefunds.storeOrderId))
    .where(and(
      eq(storeOrderRefunds.businessId, businessId),
      eq(storeOrders.invoiceId, invoiceId),
      inArray(storeOrderRefunds.status, ["pending", "processed"]),
    ));
  const paidPaise = Number(paid?.n ?? 0);
  const refundedPaise = Number(refunded?.n ?? 0);
  return { paidPaise, refundedPaise, remainingPaise: Math.max(0, paidPaise - refundedPaise) };
}

type RefundRow = typeof storeOrderRefunds.$inferSelect;

export async function refundStoreOrder(ctx: RefundContext, input: RefundInput): Promise<RefundResult> {
  const { db, businessId } = ctx;
  const [order] = await db
    .select()
    .from(storeOrders)
    .where(and(eq(storeOrders.id, input.orderId), eq(storeOrders.businessId, businessId)))
    .limit(1);
  if (!order) throw new RefundError("NOT_FOUND", "Order not found");
  if (!order.invoiceId) throw new RefundError("PRECONDITION_FAILED", "This order has no invoice to refund against.");
  const invoiceId = order.invoiceId;

  const requestedPaise = input.amount === undefined ? null : parseAmountPaise(input.amount);

  // ── 1. The refund row (or the earlier one this key already made) ──────────
  let row: RefundRow;
  const [existing] = await db
    .select()
    .from(storeOrderRefunds)
    .where(and(eq(storeOrderRefunds.businessId, businessId), eq(storeOrderRefunds.idempotencyKey, input.idempotencyKey)))
    .limit(1);
  if (existing) {
    if (existing.storeOrderId !== order.id) throw new RefundError("CONFLICT", "That request key was used for another order.");
    if (requestedPaise !== null && requestedPaise !== existing.amountPaise) {
      throw new RefundError("CONFLICT", "That request key was used for a different amount.");
    }
    if (existing.status === "processed" && existing.creditNoteId) {
      return replayResult(db, existing, order.paymentStatus);
    }
    // Carry on an earlier attempt only when it is not still running: a failed one is retried at once,
    // a pending one only once it has been quiet for a minute (it was interrupted). One request at a time.
    const [claimed] = await db
      .update(storeOrderRefunds)
      .set({ status: "pending", updatedAt: new Date() })
      .where(and(
        eq(storeOrderRefunds.id, existing.id),
        sql`(${storeOrderRefunds.status} = 'failed' OR (${storeOrderRefunds.status} = 'pending' AND ${storeOrderRefunds.updatedAt} < now() - interval '60 seconds'))`,
      ))
      .returning();
    if (!claimed) throw new RefundError("CONFLICT", "That refund is already being processed. Try again in a minute.");
    row = claimed;
  } else {
    const conn = await getConnectionRow(db, businessId);
    if (!conn) throw new RefundError("PRECONDITION_FAILED", "Razorpay is not connected for this business, so this payment cannot be refunded here.");
    row = await db.transaction(async (tx) => {
      // One refund at a time per order, so the cap below cannot be raced.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"store-refund:" + order.id}))`);
      const payments = await tx
        .select()
        .from(razorpayPayments)
        .where(and(eq(razorpayPayments.businessId, businessId), eq(razorpayPayments.invoiceId, invoiceId)))
        .orderBy(razorpayPayments.createdAt);
      if (payments.length === 0) {
        throw new RefundError("PRECONDITION_FAILED", "No online payment was received for this order, so there is nothing to refund through Razorpay.");
      }
      const refunds = await tx
        .select({ paymentId: storeOrderRefunds.razorpayPaymentId, amountPaise: storeOrderRefunds.amountPaise })
        .from(storeOrderRefunds)
        .where(and(eq(storeOrderRefunds.storeOrderId, order.id), inArray(storeOrderRefunds.status, ["pending", "processed"])));
      const room = payments.map((p) => ({
        p,
        remaining: p.amountPaise - refunds.filter((r) => r.paymentId === p.razorpayPaymentId).reduce((s, r) => s + r.amountPaise, 0),
      }));
      const target = requestedPaise === null
        ? room.reduce((best, r) => (r.remaining > best.remaining ? r : best), room[0]!)
        : room.find((r) => r.remaining >= requestedPaise);
      const totalRemaining = room.reduce((s, r) => s + Math.max(0, r.remaining), 0);
      if (!target || target.remaining <= 0) {
        throw new RefundError("BAD_REQUEST", totalRemaining <= 0
          ? "This order has already been refunded in full."
          : `That is more than one Razorpay payment can still refund. At most ${paiseToMoney(Math.max(...room.map((r) => r.remaining)))} can be refunded in one go.`);
      }
      const amountPaise = requestedPaise ?? target.remaining;
      if (amountPaise < 100) throw new RefundError("BAD_REQUEST", "The smallest refund is Rs 1.00.");
      if (amountPaise > target.remaining) {
        throw new RefundError("BAD_REQUEST", `You can refund at most ${paiseToMoney(target.remaining)} on this order.`);
      }
      const [created] = await tx
        .insert(storeOrderRefunds)
        .values({
          businessId,
          storeOrderId: order.id,
          razorpayPaymentId: target.p.razorpayPaymentId,
          amountPaise,
          idempotencyKey: input.idempotencyKey,
          reason: input.reason?.trim() || null,
          createdByUserId: ctx.user.id,
        })
        .onConflictDoNothing()
        .returning();
      if (!created) throw new RefundError("CONFLICT", "That request is already being processed. Try again in a moment.");
      return created;
    });
  }

  // ── 2. Razorpay ───────────────────────────────────────────────────────────
  let razorpayRefundId = row.razorpayRefundId;
  if (!razorpayRefundId) {
    const conn = await getConnectionRow(db, businessId);
    if (!conn) throw new RefundError("PRECONDITION_FAILED", "Razorpay is not connected for this business.");
    try {
      const refund = await razorpay.refundPayment(decryptConnection(conn), row.razorpayPaymentId, {
        amountPaise: row.amountPaise,
        receipt: `${order.orderNumber}-${row.id.slice(0, 8)}`,
        // The row id is the key Razorpay sees: a retry of this refund returns the same refund.
        idempotencyKey: row.id,
        notes: { store_order_id: order.id, business_id: businessId },
      });
      razorpayRefundId = refund.id;
      await db
        .update(storeOrderRefunds)
        .set({ razorpayRefundId, status: "pending", updatedAt: new Date() })
        .where(eq(storeOrderRefunds.id, row.id));
    } catch (err) {
      const e = err as { status?: number; description?: string };
      await db.update(storeOrderRefunds).set({ status: "failed", updatedAt: new Date() }).where(eq(storeOrderRefunds.id, row.id));
      logger.warn({ businessId, status: e.status }, "[store-refund] Razorpay refused or could not be reached");
      throw new RefundError(
        "BAD_GATEWAY",
        e.status === 401
          ? "Razorpay rejected this business's keys. Check them in Settings, Online payments."
          : e.status === 0
            ? "Could not reach Razorpay. Nothing was refunded; try again in a moment."
            : `Razorpay did not refund this payment${e.description ? `: ${e.description}` : "."} Nothing was refunded.`,
      );
    }
  }

  // ── 3. The credit note ────────────────────────────────────────────────────
  let creditNoteId = row.creditNoteId;
  let creditNoteNumber = "";
  const amount = paiseToMoney(row.amountPaise);
  if (!creditNoteId) {
    const note = await createRefundCreditNote(ctx, { orderNumber: order.orderNumber, invoiceId, amountPaise: row.amountPaise, reason: row.reason });
    creditNoteId = note.id;
    creditNoteNumber = note.invoiceNumber;
    await db.update(storeOrderRefunds).set({ creditNoteId, updatedAt: new Date() }).where(eq(storeOrderRefunds.id, row.id));
  } else {
    const [n] = await db.select({ n: invoices.invoiceNumber }).from(invoices).where(eq(invoices.id, creditNoteId)).limit(1);
    creditNoteNumber = n?.n ?? "";
  }

  // ── 4. Settle the books in one transaction ────────────────────────────────
  const finalCreditNoteId = creditNoteId;
  const paymentStatus = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"store-refund:" + order.id}))`);
    const [fresh] = await tx.select({ status: storeOrderRefunds.status }).from(storeOrderRefunds).where(eq(storeOrderRefunds.id, row.id)).for("update").limit(1);
    const [o] = await tx.select().from(storeOrders).where(eq(storeOrders.id, order.id)).for("update").limit(1);
    if (fresh?.status === "processed") return (o?.paymentStatus ?? "partially_refunded") as "partially_refunded" | "refunded";

    const now = new Date();
    // The note is a refund already paid out: settled, so it stays out of what the customer is owed.
    await tx
      .update(invoices)
      .set({ status: "paid", amountPaid: amount, updatedAt: now })
      .where(and(eq(invoices.id, finalCreditNoteId), eq(invoices.businessId, businessId)));

    // The customer's money went back: that much less is paid against the invoice (so the credit note
    // and the refund together leave nothing owed either way), and the same much less of the Razorpay
    // payment is allocated to it, which keeps "amount paid = what payments allocated" true.
    await applyInvoicePayment(tx, businessId, invoiceId, `-${amount}`);
    const [rzp] = await tx
      .select({ paymentId: razorpayPayments.paymentId })
      .from(razorpayPayments)
      .where(and(eq(razorpayPayments.businessId, businessId), eq(razorpayPayments.razorpayPaymentId, row.razorpayPaymentId)))
      .limit(1);
    if (rzp?.paymentId) {
      const [alloc] = await tx
        .select({ id: paymentAllocations.id, amount: paymentAllocations.amount })
        .from(paymentAllocations)
        .where(and(eq(paymentAllocations.paymentId, rzp.paymentId), eq(paymentAllocations.invoiceId, invoiceId)))
        .for("update")
        .limit(1);
      if (alloc) {
        const left = money.max0(money.sub(alloc.amount, amount));
        if (money.compare(left, "0") > 0) {
          await tx.update(paymentAllocations).set({ amount: left }).where(eq(paymentAllocations.id, alloc.id));
        } else {
          // Nothing of this payment is left on the invoice: it is no longer attached to it (an allocation is
          // never zero, and a payment with no allocation but an invoice would read as an older single-invoice one).
          await tx.delete(paymentAllocations).where(eq(paymentAllocations.id, alloc.id));
          await tx.update(payments).set({ invoiceId: null }).where(eq(payments.id, rzp.paymentId));
        }
      }
    }

    // Money leaves the gateway account the sale went into.
    const gatewayAccountId = await findRazorpayGatewayAccount(tx, businessId);
    if (gatewayAccountId) {
      const [account] = await tx
        .select({ currentBalance: bankAccounts.currentBalance })
        .from(bankAccounts)
        .where(and(eq(bankAccounts.id, gatewayAccountId), eq(bankAccounts.businessId, businessId)))
        .for("update")
        .limit(1);
      if (account) {
        await tx.insert(bankTransactions).values({
          businessId,
          bankAccountId: gatewayAccountId,
          type: "withdrawal",
          amount,
          description: `Refund for order ${order.orderNumber}`,
          referenceType: "refund",
          referenceId: finalCreditNoteId,
          transactionDate: now,
        });
        await tx
          .update(bankAccounts)
          .set({ currentBalance: money.sub(account.currentBalance, amount), updatedAt: now })
          .where(eq(bankAccounts.id, gatewayAccountId));
      }
    }

    const refundedTotal = money.add(o!.refundedAmount, amount);
    const next = money.compare(refundedTotal, o!.totalAmount) >= 0 ? "refunded" : "partially_refunded";
    await tx
      .update(storeOrders)
      .set({ refundedAmount: refundedTotal, paymentStatus: next, updatedAt: now })
      .where(eq(storeOrders.id, order.id));

    if (input.restock) await restoreInvoiceStock(tx, businessId, invoiceId, ctx.user.id);

    await tx
      .update(storeOrderRefunds)
      .set({ status: "processed", creditNoteId: finalCreditNoteId, updatedAt: now })
      .where(eq(storeOrderRefunds.id, row.id));
    return next as "partially_refunded" | "refunded";
  });

  await logAudit(db, {
    businessId,
    userId: ctx.user.id,
    action: "storeOrder.refund",
    entityType: "storeOrder",
    entityId: order.id,
    metadata: {
      orderNumber: order.orderNumber,
      amount,
      razorpayRefundId,
      creditNote: creditNoteNumber,
      paymentStatus,
      ...(input.reason ? { reason: input.reason.slice(0, 200) } : {}),
    },
    ipAddress: ctx.ipAddress ?? null,
  });
  await sendStoreOrderEmail(db, businessId, order.id, "refund", { amount });

  return { refundId: row.id, razorpayRefundId: razorpayRefundId!, amount, creditNoteId: finalCreditNoteId, creditNoteNumber, paymentStatus, replayed: false };
}

function parseAmountPaise(raw: string): number {
  if (!/^\d{1,13}(\.\d{1,2})?$/.test(raw.trim())) throw new RefundError("BAD_REQUEST", "Enter the refund amount as rupees, like 250 or 250.50.");
  const paise = moneyToPaise(raw.trim());
  if (paise <= 0) throw new RefundError("BAD_REQUEST", "The refund amount must be more than zero.");
  return paise;
}

async function replayResult(db: TenantDatabase, row: RefundRow, paymentStatus: string): Promise<RefundResult> {
  const [n] = row.creditNoteId
    ? await db.select({ n: invoices.invoiceNumber }).from(invoices).where(eq(invoices.id, row.creditNoteId)).limit(1)
    : [undefined];
  return {
    refundId: row.id,
    razorpayRefundId: row.razorpayRefundId ?? "",
    amount: paiseToMoney(row.amountPaise),
    creditNoteId: row.creditNoteId!,
    creditNoteNumber: n?.n ?? "",
    paymentStatus: paymentStatus === "refunded" ? "refunded" : "partially_refunded",
    replayed: true,
  };
}

/**
 * The credit note that books a refund: against the order's invoice, one line
 * per GST rate in the order (so the tax is reversed at the rate it was
 * charged), together exactly the refunded amount.
 */
async function createRefundCreditNote(
  ctx: RefundContext,
  p: { orderNumber: string; invoiceId: string; amountPaise: number; reason: string | null },
): Promise<{ id: string; invoiceNumber: string }> {
  const [inv] = await ctx.db
    .select({ partyId: invoices.partyId, additionalCharges: invoices.additionalCharges, taxAmount: invoices.taxAmount })
    .from(invoices)
    .where(and(eq(invoices.id, p.invoiceId), eq(invoices.businessId, ctx.businessId)))
    .limit(1);
  if (!inv) throw new RefundError("NOT_FOUND", "The order's invoice was not found.");
  const lines = await ctx.db
    .select({ taxPercent: invoiceItems.taxPercent, total: invoiceItems.totalAmount, taxAmount: invoiceItems.taxAmount })
    .from(invoiceItems)
    .where(eq(invoiceItems.invoiceId, p.invoiceId));
  const byRate = new Map<string, number>();
  for (const l of lines) byRate.set(l.taxPercent, (byRate.get(l.taxPercent) ?? 0) + moneyToPaise(l.total));
  // A delivery charge (an additional charge on the invoice) is part of what was paid and carries its own
  // GST at the rate the invoice taxed it at: it joins the credit note under that rate, so a refund
  // reverses the tax exactly as it was charged.
  const charge = chargeSupplyOf({ additionalCharges: inv.additionalCharges, taxAmount: inv.taxAmount }, lines);
  const chargeGrossPaise = moneyToPaise(charge.taxableValue) + moneyToPaise(charge.taxAmount);
  if (chargeGrossPaise > 0) byRate.set(charge.rate, (byRate.get(charge.rate) ?? 0) + chargeGrossPaise);
  const groups = [...byRate.entries()].map(([taxPercent, grossPaise]) => ({ taxPercent, grossPaise }));
  const parts = splitRefundByRate(groups, p.amountPaise);
  if (parts.length === 0) throw new RefundError("PRECONDITION_FAILED", "The order's invoice has no lines to credit.");

  const intraState = await documentIsIntraState(ctx.db, ctx.businessId, inv.partyId);
  const lineItems = parts.map((part) => {
    const { unitPrice } = netPriceForGross(part.grossPaise, part.taxPercent, intraState);
    return {
      itemName: `Refund, order ${p.orderNumber}${Number(part.taxPercent) > 0 ? ` (GST ${Number(part.taxPercent)}%)` : ""}`,
      quantity: "1",
      unitPrice,
      taxPercent: part.taxPercent,
      discountPercent: "0",
    };
  });
  const input = createInvoiceSchema.parse({
    partyId: inv.partyId,
    type: "sale",
    documentType: "credit_note",
    invoiceDate: new Date().toISOString(),
    notes: `Refund of online order ${p.orderNumber}${p.reason ? `: ${p.reason.slice(0, 300)}` : ""}`,
    referenceDocumentId: p.invoiceId,
    lineItems,
  });
  const callerCtx = {
    user: ctx.user,
    businessId: ctx.businessId,
    tenantId: ctx.tenantId,
    db: ctx.db,
    req: ctx.req,
    resHeaders: ctx.resHeaders,
    ipAddress: ctx.ipAddress,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const note = await createCallerFactory(creditNoteRouter)(callerCtx as any).create(input);
  return { id: note.id, invoiceNumber: note.invoiceNumber };
}

type Tx = Parameters<Parameters<TenantDatabase["transaction"]>[0]>[0];

/**
 * Put back the stock an order's invoice took, while the invoice itself stays
 * (the credit note, not a cancellation, reverses the sale). Uses the same
 * stock synchroniser as cancelling a document, by showing it the invoice as
 * cancelled for that one call; what is held is a difference, so doing it
 * twice changes nothing.
 */
export async function restoreInvoiceStock(tx: Tx, businessId: string, invoiceId: string, actorUserId: string): Promise<void> {
  const [inv] = await tx
    .select({ status: invoices.status })
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.businessId, businessId)))
    .for("update")
    .limit(1);
  if (!inv || inv.status === "cancelled") return;
  await tx.update(invoices).set({ status: "cancelled" }).where(eq(invoices.id, invoiceId));
  await syncDocumentStock(tx, { businessId, documentId: invoiceId, event: "CANCEL", actorUserId });
  await tx.update(invoices).set({ status: inv.status }).where(eq(invoices.id, invoiceId));
}
