/**
 * The shopper-facing half of online store payments: which payment methods a
 * store offers, the public view of one order (status, totals, whether it can
 * still be paid online) and making (or re-making) the payment link.
 *
 * Everything here is derived from the database. The amount of a payment link
 * is always the order's invoice balance as stored; a client never names an
 * amount, a business or a link. The response never contains keys or secrets,
 * and the link's return address comes only from the configured STORE_URL.
 */

import { and, eq } from "drizzle-orm";
import { businesses, invoiceItems, invoices, storeOrders, type TenantDatabase } from "@fintranzact/db";
import { getConnectionRow } from "../razorpay/connection.js";
import { PaymentLinkError, ensureInvoicePaymentLink, loadInvoiceBalance, paymentLinkRefusal } from "../razorpay/payment-link.js";
import { storeOrderUrl } from "./urls.js";

export type StorePaymentMethod = "online" | "cod";

export interface StorePaymentOptions {
  /** The owner has switched online payments on AND has a Razorpay connection. */
  online: boolean;
  cod: boolean;
}

/** The payment methods a store offers right now. Cash on Delivery shows only when switched on. */
export async function loadStorePaymentOptions(db: TenantDatabase, businessId: string): Promise<StorePaymentOptions> {
  const [biz] = await db
    .select({ online: businesses.storeOnlinePaymentsEnabled, cod: businesses.storeCodEnabled })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  if (!biz) return { online: false, cod: false };
  // Without the webhook secret a payment could never be recorded, so a connection missing it does not count.
  const conn = biz.online ? await getConnectionRow(db, businessId) : null;
  return { online: biz.online && !!conn?.webhookSecretEncrypted, cod: biz.cod };
}

export interface PublicStoreOrder {
  orderId: string;
  orderNumber: string;
  status: string;
  paymentMethod: StorePaymentMethod;
  /** unpaid | paid | partially_refunded | refunded */
  paymentStatus: string;
  currency: string;
  subtotal: string;
  taxAmount: string;
  totalAmount: string;
  refundedAmount: string;
  /** What is still to pay online (only for an unpaid online order). */
  balance: string | null;
  /** Whether "Pay now" / "Pay again" can be offered. */
  canPayOnline: boolean;
  lines: Array<{ name: string; quantity: string; total: string }>;
  createdAt: Date;
}

/** One order as its shopper may see it (no address, phone, email or notes). */
export async function getPublicStoreOrder(db: TenantDatabase, businessId: string, orderId: string): Promise<PublicStoreOrder | null> {
  const [order] = await db
    .select()
    .from(storeOrders)
    .where(and(eq(storeOrders.id, orderId), eq(storeOrders.businessId, businessId)))
    .limit(1);
  if (!order) return null;
  const [biz] = await db.select({ currency: businesses.currency }).from(businesses).where(eq(businesses.id, businessId)).limit(1);

  let subtotal = order.totalAmount;
  let taxAmount = "0.00";
  let lines: PublicStoreOrder["lines"] = [];
  let balance: string | null = null;
  let payable = false;
  if (order.invoiceId) {
    const [inv] = await db
      .select({ subtotal: invoices.subtotal, taxAmount: invoices.taxAmount })
      .from(invoices)
      .where(and(eq(invoices.id, order.invoiceId), eq(invoices.businessId, businessId)))
      .limit(1);
    if (inv) {
      subtotal = inv.subtotal;
      taxAmount = inv.taxAmount;
    }
    lines = (await db
      .select({ name: invoiceItems.itemName, quantity: invoiceItems.quantity, total: invoiceItems.totalAmount })
      .from(invoiceItems)
      .where(eq(invoiceItems.invoiceId, order.invoiceId))
      .orderBy(invoiceItems.sortOrder));
    if (order.paymentMethod === "online" && order.paymentStatus === "unpaid" && order.status !== "cancelled") {
      const bal = await loadInvoiceBalance(db, businessId, order.invoiceId);
      if (bal && !paymentLinkRefusal(bal)) {
        balance = bal.balance;
        payable = true;
      }
    }
  }
  const options = payable ? await loadStorePaymentOptions(db, businessId) : { online: false, cod: false };
  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    paymentMethod: order.paymentMethod === "online" ? "online" : "cod",
    paymentStatus: order.paymentStatus,
    currency: biz?.currency ?? "INR",
    subtotal,
    taxAmount,
    totalAmount: order.totalAmount,
    refundedAmount: order.refundedAmount,
    balance,
    canPayOnline: payable && options.online,
    lines,
    createdAt: order.createdAt,
  };
}

export type OrderLinkResult =
  | { ok: true; url: string; amountPaise: number }
  | { ok: false; status: 404 | 409 | 502; error: string };

/**
 * Create (or reuse) the Razorpay payment link for an unpaid online order, on
 * the business's own account. Asked again it returns the same live link; once
 * the old one expired or was cancelled it makes a fresh one ("Pay again").
 */
export async function createStoreOrderPaymentLink(
  db: TenantDatabase,
  params: { businessId: string; slug: string; orderId: string },
): Promise<OrderLinkResult> {
  const [order] = await db
    .select()
    .from(storeOrders)
    .where(and(eq(storeOrders.id, params.orderId), eq(storeOrders.businessId, params.businessId)))
    .limit(1);
  if (!order || !order.invoiceId) return { ok: false, status: 404, error: "Order not found" };
  if (order.status === "cancelled") return { ok: false, status: 409, error: "This order was cancelled." };
  if (order.paymentStatus !== "unpaid") return { ok: false, status: 409, error: "This order has already been paid." };
  if (order.paymentMethod !== "online") return { ok: false, status: 409, error: "This order is Cash on Delivery." };
  const options = await loadStorePaymentOptions(db, params.businessId);
  if (!options.online) return { ok: false, status: 409, error: "Online payment is not available for this store right now." };

  try {
    const { link } = await ensureInvoicePaymentLink(db, {
      businessId: params.businessId,
      invoiceId: order.invoiceId,
      shareUrl: storeOrderUrl(params.slug, order.id),
      storeOrder: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        customerEmail: order.customerEmail,
        customerPhone: order.customerPhone,
      },
    });
    return { ok: true, url: link.shortUrl, amountPaise: link.amountPaise };
  } catch (err) {
    if (err instanceof PaymentLinkError) {
      if (err.reason === "not_connected" || err.reason === "not_found") return { ok: false, status: 404, error: "Order not found" };
      if (err.reason === "gateway_error") return { ok: false, status: 502, error: "Online payment is unavailable right now. Please try again in a moment." };
      return { ok: false, status: 409, error: err.reason === "settled" ? "This order has already been paid." : "This order cannot be paid online." };
    }
    throw err;
  }
}
