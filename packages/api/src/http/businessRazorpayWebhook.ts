/**
 * POST /webhooks/razorpay/business/:token: callbacks from a BUSINESS's OWN
 * Razorpay account (invoice payment links). Not to be confused with
 * POST /webhooks/razorpay, which is the platform's subscription billing.
 *
 * The token in the URL identifies the business, so the right webhook secret
 * is used to verify X-Razorpay-Signature (HMAC-SHA256 over the raw body,
 * constant-time compare). A bad token, no secret saved and a bad signature
 * all answer the same generic 401, so nothing can be probed. The raw body is
 * read once as text and parsed only after the signature checks out.
 *
 * Entitlements (rest-entitlement-policy.ts: exempt-webhook): the customer has
 * already paid, so events are recorded even for a READ-ONLY organisation; a
 * suspended one is not an active tenant, so its token does not resolve.
 */

import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createFixedWindowLimiter } from "../lib/fixed-window-limiter.js";
import { logger } from "../lib/logger.js";
import { verifyWebhookSignature } from "../lib/razorpay/client.js";
import { resolveWebhookConnection } from "../lib/razorpay/connection.js";
import { processBusinessWebhookEvent, type RazorpayEvent } from "../lib/razorpay/webhook.js";

const limiter = createFixedWindowLimiter({ limit: 300, windowMs: 60_000 });

export function registerBusinessRazorpayWebhook(
  app: Hono,
  opts: { clientIp: (c: Context) => string; rateLimitDisabled: boolean },
): void {
  app.post(
    "/webhooks/razorpay/business/:token",
    bodyLimit({ maxSize: 1024 * 1024, onError: (c) => c.json({ error: "Invalid request" }, 400) }),
    async (c) => {
      if (!opts.rateLimitDisabled && !limiter.hit(opts.clientIp(c))) {
        return c.json({ error: "Too many requests" }, 429);
      }
      const signature = c.req.header("x-razorpay-signature");
      const rawBody = await c.req.text();

      const conn = await resolveWebhookConnection(c.req.param("token") ?? "");
      if (!conn || !verifyWebhookSignature(rawBody, signature, conn.webhookSecret)) {
        return c.json({ error: "Invalid request" }, 401);
      }

      let event: RazorpayEvent;
      try {
        event = JSON.parse(rawBody);
      } catch {
        return c.json({ error: "Invalid request" }, 400);
      }

      try {
        const outcome = await processBusinessWebhookEvent(conn.db, conn.businessId, event);
        logger.info({ tenantId: conn.tenantId, businessId: conn.businessId, event: event.event, result: outcome.result }, "[razorpay] business webhook handled");
      } catch (err) {
        // A 5xx makes Razorpay redeliver; recording is idempotent, so the retry is safe.
        logger.error({ err, tenantId: conn.tenantId, event: event.event }, "[razorpay] business webhook failed");
        return c.json({ error: "Handling failed" }, 500);
      }
      return c.json({ ok: true });
    },
  );
}
