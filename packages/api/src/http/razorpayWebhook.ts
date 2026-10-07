/**
 * POST /webhooks/razorpay — subscription lifecycle events from Razorpay.
 *
 * Verified with HMAC-SHA256 over the raw body (RAZORPAY_WEBHOOK_SECRET) and
 * made idempotent through billing_events: the x-razorpay-event-id is unique
 * there, so a redelivered event is acknowledged without being applied twice.
 * No cookies are involved, so the CSRF middleware does not apply.
 *
 * Events handled (the subscription is found by its Razorpay id):
 *   subscription.activated   first charge done → active, GST invoice, plan applied
 *   subscription.charged     renewal → period extended, next invoice
 *   subscription.pending     renewal failing, Razorpay retrying → past_due + grace
 *   subscription.halted      Razorpay gave up → halted (read-only)
 *   subscription.cancelled / subscription.completed → cancelled
 * One-time payments for extra AI question packs (an Order on the platform account) arrive on the
 * same endpoint and are matched by their order id (lib/billing/ai-packs.ts):
 *   payment.captured / order.paid   the order is paid → GST invoice and the credit grant (once)
 *   payment.failed                  the order is marked failed, nothing is granted
 *   refund.processed                the unused credits are taken back and a credit note is raised
 * Those are made idempotent by the order itself (a row lock and unique payment ids), not by the
 * event id, so a delivery that failed half way is simply handled again when Razorpay redelivers.
 * Anything else is stored for the audit trail and acknowledged.
 */

import type { Hono } from "hono";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { controlDb, aiPackOrders, billingEvents, billingSubscriptions } from "@fintranzact/db";
import { verifyRazorpayWebhookSignature } from "../lib/billing/gateway.js";
import {
  activateSubscription,
  endSubscription,
  haltSubscription,
  recordBillingEvent,
  recordRenewal,
  recordRenewalFailure,
} from "../lib/billing/service.js";
import { failPackPayment, fulfilPackPayment, refundPackPayment } from "../lib/billing/ai-packs.js";
import { logger } from "../lib/logger.js";

interface RazorpayEvent {
  event: string;
  payload?: {
    subscription?: { entity?: { id?: string } };
    payment?: { entity?: { id?: string; order_id?: string; amount?: number; method?: string; invoice_id?: string; error_description?: string } };
    order?: { entity?: { id?: string } };
    refund?: { entity?: { id?: string; payment_id?: string; amount?: number } };
  };
}

const PACK_EVENTS = new Set(["payment.captured", "order.paid", "payment.failed", "refund.processed"]);

/**
 * A payment or refund event for an extra-AI-pack order. Returns true when the event belongs to
 * one (it is then fully handled here), false to let the subscription handling carry on.
 */
async function handlePackEvent(event: RazorpayEvent, eventId: string | null): Promise<boolean> {
  if (!PACK_EVENTS.has(event.event)) return false;
  const payment = event.payload?.payment?.entity;
  const refund = event.payload?.refund?.entity;

  let orderRow: { providerOrderId: string; tenantId: string } | null = null;
  if (event.event === "refund.processed") {
    const paymentId = refund?.payment_id;
    if (!paymentId) return false;
    [orderRow] = await controlDb
      .select({ providerOrderId: aiPackOrders.providerOrderId, tenantId: aiPackOrders.tenantId })
      .from(aiPackOrders)
      .where(eq(aiPackOrders.providerPaymentId, paymentId))
      .limit(1);
  } else {
    const orderId = payment?.order_id ?? event.payload?.order?.entity?.id;
    if (!orderId) return false;
    [orderRow] = await controlDb
      .select({ providerOrderId: aiPackOrders.providerOrderId, tenantId: aiPackOrders.tenantId })
      .from(aiPackOrders)
      .where(eq(aiPackOrders.providerOrderId, orderId))
      .limit(1);
  }
  if (!orderRow) return false;

  switch (event.event) {
    case "payment.captured":
    case "order.paid":
      if (!payment?.id) {
        logger.warn({ event: event.event }, "[billing] pack payment event without a payment id");
        break;
      }
      try {
        await fulfilPackPayment({
          providerOrderId: orderRow.providerOrderId,
          providerPaymentId: payment.id,
          method: payment.method ?? null,
          amountPaise: typeof payment.amount === "number" ? payment.amount : null,
        });
      } catch (err) {
        // A payment whose amount is not the order's: nothing is granted, and the event is acknowledged
        // (a redelivery would fail the same way); the audit trail carries the error for follow-up.
        if (err instanceof TRPCError && err.code === "BAD_REQUEST") {
          await recordBillingEvent({ provider: "razorpay", type: "ai_pack.payment_rejected", tenantId: orderRow.tenantId, payload: event, error: err.message });
          return true;
        }
        throw err;
      }
      break;
    case "payment.failed":
      await failPackPayment(orderRow.providerOrderId, payment?.error_description ?? null);
      break;
    case "refund.processed":
      if (refund?.id && refund.payment_id) {
        await refundPackPayment({ providerPaymentId: refund.payment_id, refundId: refund.id, amountPaise: refund.amount ?? 0 });
      }
      break;
  }

  // The audit row, after the work succeeded (a redelivery of a duplicate inserts nothing).
  if (eventId) {
    await controlDb
      .insert(billingEvents)
      .values({ provider: "razorpay", eventId, type: event.event, tenantId: orderRow.tenantId, payload: event })
      .onConflictDoNothing();
  } else {
    await recordBillingEvent({ provider: "razorpay", type: event.event, tenantId: orderRow.tenantId, payload: event });
  }
  return true;
}

export async function handleRazorpayEvent(event: RazorpayEvent, eventId: string | null): Promise<void> {
  const providerSubId = event.payload?.subscription?.entity?.id ?? null;
  const payment = event.payload?.payment?.entity;

  // Extra AI question packs are one-time orders, not subscriptions.
  if (await handlePackEvent(event, eventId)) return;

  const sub = providerSubId
    ? (await controlDb
        .select()
        .from(billingSubscriptions)
        .where(eq(billingSubscriptions.providerSubscriptionId, providerSubId))
        .limit(1))[0] ?? null
    : null;

  // Idempotency + audit in one insert: a duplicate event id inserts nothing
  // and we stop before applying the event again.
  if (eventId) {
    const inserted = await controlDb
      .insert(billingEvents)
      .values({
        provider: "razorpay",
        eventId,
        type: event.event,
        tenantId: sub?.tenantId ?? null,
        subscriptionId: sub?.id ?? null,
        payload: event,
      })
      .onConflictDoNothing()
      .returning({ id: billingEvents.id });
    if (inserted.length === 0) return;
  } else {
    await recordBillingEvent({ provider: "razorpay", type: event.event, tenantId: sub?.tenantId, subscriptionId: sub?.id, payload: event });
  }

  if (!sub) {
    if (event.event.startsWith("subscription.")) {
      logger.warn({ event: event.event, providerSubId }, "[billing] webhook for unknown subscription");
    }
    return;
  }

  switch (event.event) {
    case "subscription.activated":
      await activateSubscription({
        subscriptionId: sub.id,
        method: payment?.method ?? null,
        providerPaymentId: payment?.id ?? null,
      });
      break;
    case "subscription.charged":
      // The very first charge can also arrive as "charged": activate then.
      if (sub.status === "created") {
        await activateSubscription({ subscriptionId: sub.id, method: payment?.method ?? null, providerPaymentId: payment?.id ?? null });
      } else {
        await recordRenewal(sub, {
          providerPaymentId: payment?.id ?? null,
          providerInvoiceId: payment?.invoice_id ?? null,
          method: payment?.method ?? null,
        });
      }
      break;
    case "subscription.pending":
      await recordRenewalFailure(sub, payment?.error_description ?? "Renewal payment failed; the gateway is retrying");
      break;
    case "subscription.halted":
      await haltSubscription(sub.id);
      break;
    case "subscription.cancelled":
    case "subscription.completed":
      await endSubscription(sub.id);
      break;
    default:
      break; // stored above; nothing to apply
  }
}

export function registerRazorpayWebhook(app: Hono): void {
  app.post("/webhooks/razorpay", async (c) => {
    if (!process.env.RAZORPAY_WEBHOOK_SECRET) {
      return c.json({ error: "Webhook not configured" }, 503);
    }
    const signature = c.req.header("x-razorpay-signature");
    if (!signature) return c.json({ error: "Missing signature" }, 401);

    const rawBody = await c.req.text();
    if (!verifyRazorpayWebhookSignature(rawBody, signature)) {
      return c.json({ error: "Invalid signature" }, 401);
    }

    let event: RazorpayEvent;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }

    try {
      await handleRazorpayEvent(event, c.req.header("x-razorpay-event-id") ?? null);
    } catch (err) {
      // A 5xx makes Razorpay redeliver; idempotency makes the retry safe.
      logger.error({ err, event: event.event }, "[billing] webhook handling failed");
      return c.json({ error: "Handling failed" }, 500);
    }
    return c.json({ ok: true });
  });
}
