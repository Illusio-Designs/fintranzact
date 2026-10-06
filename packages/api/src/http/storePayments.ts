/**
 * Public store routes for online payment of an order:
 *
 *   GET  /store/:slug/order/:orderId       the order's status, totals and whether it can be paid
 *   POST /store/:slug/order/:orderId/pay   make (or re-make) the order's payment link ("Pay again")
 *
 * Both are unauthenticated like the rest of /store/*, so they follow the same
 * rules: unknown slug, store switched off, a plan without the online store and
 * a read-only or suspended organisation all answer the same neutral 404 (never
 * billing wording); every request is rate limited per IP, and the pay route
 * also per order; the POST passes the store Origin allow-list. The order id is
 * an unguessable UUID that only the shopper was given.
 *
 * Nothing here trusts the request for money or identity: no body is read, the
 * amount is the order's invoice balance from the database, the business is the
 * one the slug resolved to, and the order must belong to it. Responses never
 * carry keys, secrets, tokens or the shopper's address, phone or email, and the
 * link's return address comes only from STORE_URL.
 *
 * Entitlements (rest-entitlement-policy.ts): public-neutral.
 */

import type { Context, Hono } from "hono";
import type { TenantDatabase } from "@fintranzact/db";
import { createFixedWindowLimiter } from "../lib/fixed-window-limiter.js";
import { logger } from "../lib/logger.js";
import { createStoreOrderPaymentLink, getPublicStoreOrder } from "../lib/store-payments/order-payment.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { "Cache-Control": "no-store" };

/** A new link at most 6 times a minute per order, however many addresses ask. */
const perOrderLimiter = createFixedWindowLimiter({ limit: 6, windowMs: 60_000 });

export interface StorePaymentRouteDeps {
  clientIp: (c: Context) => string;
  /** The per-IP limiter shared with the other public store routes (false = over the limit). */
  checkIpRateLimit: (ip: string, path: string) => boolean;
  assertOrigin: (c: Context, ip: string) => { ok: boolean };
  resolveStoreSlug: (slug: string) => Promise<{ tenantId: string; businessId: string } | null>;
  getStoreDb: (tenantId: string) => Promise<TenantDatabase>;
  rateLimitDisabled: boolean;
}

export function registerStorePaymentRoutes(app: Hono, deps: StorePaymentRouteDeps): void {
  app.get("/store/:slug/order/:orderId", async (c) => {
    const ip = deps.clientIp(c);
    if (!deps.rateLimitDisabled && !deps.checkIpRateLimit(ip, "/store/order-status")) {
      return c.json({ error: "Too many requests. Please wait a moment." }, 429, NO_STORE);
    }
    const orderId = c.req.param("orderId") ?? "";
    if (!UUID_RE.test(orderId)) return c.json({ error: "Order not found" }, 404, NO_STORE);
    const resolved = await deps.resolveStoreSlug(c.req.param("slug") ?? "");
    if (!resolved) return c.json({ error: "Store not found" }, 404, NO_STORE);
    const db = await deps.getStoreDb(resolved.tenantId);
    const order = await getPublicStoreOrder(db, resolved.businessId, orderId);
    if (!order) return c.json({ error: "Order not found" }, 404, NO_STORE);
    return c.json(order, 200, NO_STORE);
  });

  app.post("/store/:slug/order/:orderId/pay", async (c) => {
    const ip = deps.clientIp(c);
    if (!deps.rateLimitDisabled && !deps.checkIpRateLimit(ip, "/store/order-pay")) {
      return c.json({ error: "Too many requests. Please wait a moment." }, 429, NO_STORE);
    }
    if (!deps.assertOrigin(c, ip).ok) return c.json({ error: "Origin not allowed" }, 403, NO_STORE);
    const slug = c.req.param("slug") ?? "";
    const orderId = c.req.param("orderId") ?? "";
    if (!UUID_RE.test(orderId)) return c.json({ error: "Order not found" }, 404, NO_STORE);
    if (!deps.rateLimitDisabled && !perOrderLimiter.hit(orderId)) {
      return c.json({ error: "Too many attempts for this order. Please wait a minute." }, 429, NO_STORE);
    }
    const resolved = await deps.resolveStoreSlug(slug);
    if (!resolved) return c.json({ error: "Store not found" }, 404, NO_STORE);
    const db = await deps.getStoreDb(resolved.tenantId);
    try {
      const result = await createStoreOrderPaymentLink(db, { businessId: resolved.businessId, slug, orderId });
      if (!result.ok) return c.json({ error: result.error }, result.status, NO_STORE);
      return c.json({ url: result.url }, 200, NO_STORE);
    } catch (err) {
      logger.error({ err }, "[store/pay] could not create the payment link");
      return c.json({ error: "Online payment is unavailable right now. Please try again shortly." }, 502, NO_STORE);
    }
  });
}
