/**
 * What a captured (or failed) Razorpay payment does to a store order, called
 * from the business webhook (lib/razorpay/webhook.ts).
 *
 * A store order's payment is recorded exactly like an invoice payment: the
 * order's invoice is what the payment link is for, so the webhook finds the
 * invoice and records the payment, the gateway charge and the allocation. All
 * this module adds is the order's own state: once the invoice's balance is
 * cleared the order is marked paid, in the same transaction as the payment so
 * the two cannot disagree. A failed or abandoned payment changes nothing but
 * (once per six hours) a polite email with the way to pay again.
 */

import { and, eq, sql } from "drizzle-orm";
import { storeOrders, type TenantDatabase } from "@fintranzact/db";
import { money } from "@fintranzact/shared";
import { loadInvoiceBalance } from "../razorpay/payment-link.js";
import { sendStoreOrderEmail } from "./emails.js";

type Tx = Parameters<Parameters<TenantDatabase["transaction"]>[0]>[0];

/**
 * Inside the payment's transaction: when `invoiceId` belongs to a store order
 * and the payment cleared its balance, mark the order paid online. Returns the
 * order id when this call is the one that made it paid.
 */
export async function markStoreOrderPaidTx(tx: Tx, businessId: string, invoiceId: string): Promise<string | null> {
  const [order] = await tx
    .select({ id: storeOrders.id, paymentStatus: storeOrders.paymentStatus })
    .from(storeOrders)
    .where(and(eq(storeOrders.businessId, businessId), eq(storeOrders.invoiceId, invoiceId)))
    .for("update")
    .limit(1);
  if (!order || order.paymentStatus !== "unpaid") return null;
  const bal = await loadInvoiceBalance(tx, businessId, invoiceId);
  if (!bal || money.compare(bal.balance, "0") > 0) return null;
  await tx
    .update(storeOrders)
    .set({ paymentMethod: "online", paymentStatus: "paid", paidAt: new Date(), updatedAt: new Date() })
    .where(eq(storeOrders.id, order.id));
  return order.id;
}

/** After the payment committed: tell the shopper it arrived. */
export async function notifyStoreOrderPaid(db: TenantDatabase, businessId: string, orderId: string, amount: string): Promise<void> {
  await sendStoreOrderEmail(db, businessId, orderId, "paid", { amount });
}

const FAILURE_EMAIL_GAP_HOURS = 6;

/**
 * A payment attempt failed. Nothing in the books changes (the order stays
 * unpaid and the link stays usable); the shopper is emailed the retry link,
 * at most once per six hours per order, claimed atomically so a redelivered
 * webhook cannot send it twice.
 */
export async function handleStorePaymentFailed(db: TenantDatabase, businessId: string, invoiceId: string): Promise<boolean> {
  const [claimed] = await db
    .update(storeOrders)
    .set({ paymentFailedEmailedAt: new Date() })
    .where(and(
      eq(storeOrders.businessId, businessId),
      eq(storeOrders.invoiceId, invoiceId),
      eq(storeOrders.paymentStatus, "unpaid"),
      sql`${storeOrders.status} <> 'cancelled'`,
      sql`(${storeOrders.paymentFailedEmailedAt} IS NULL OR ${storeOrders.paymentFailedEmailedAt} < now() - make_interval(hours => ${FAILURE_EMAIL_GAP_HOURS}))`,
    ))
    .returning({ id: storeOrders.id });
  if (!claimed) return false;
  return sendStoreOrderEmail(db, businessId, claimed.id, "failed");
}
