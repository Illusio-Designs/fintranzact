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
 * Anything else is stored for the audit trail and acknowledged.
 */

import type { Hono } from "hono";
import { eq } from "drizzle-orm";
import { controlDb, billingEvents, billingSubscriptions } from "@fintranzact/db";
import { verifyRazorpayWebhookSignature } from "../lib/billing/gateway.js";
import {
  activateSubscription,
  endSubscription,
  haltSubscription,
  recordBillingEvent,
  recordRenewal,
  recordRenewalFailure,
} from "../lib/billing/service.js";
import { logger } from "../lib/logger.js";

interface RazorpayEvent {
  event: string;
  payload?: {
    subscription?: { entity?: { id?: string } };
    payment?: { entity?: { id?: string; method?: string; invoice_id?: string; error_description?: string } };
  };
}

export async function handleRazorpayEvent(event: RazorpayEvent, eventId: string | null): Promise<void> {
  const providerSubId = event.payload?.subscription?.entity?.id ?? null;
  const payment = event.payload?.payment?.entity;

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
