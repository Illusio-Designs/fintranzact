/**
 * Payment gateway adapter for subscription billing.
 *
 * Two implementations behind one interface:
 *  - razorpay: the real Razorpay Subscriptions API (REST over fetch, basic
 *    auth with RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET). Razorpay plan objects
 *    are created lazily per (item, cycle, amount) and cached in system_config,
 *    so changing a price in the admin console simply mints a new Razorpay plan.
 *  - demo: no gateway. Subscriptions "activate" instantly through our own
 *    checkout UI (DemoCheckout). Used in development and until the owner adds
 *    Razorpay keys; gated by DEMO_PAYMENTS in production (see routers/billing.ts).
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { controlDb, systemConfig } from "@fintranzact/db";
import type { BillingCycle } from "@fintranzact/shared";
import { nanoid } from "nanoid";

export type BillingProvider = "demo" | "razorpay";

export interface CreateSubscriptionOpts {
  /** Stable key for the thing being sold: "plan:pro" or "addon:ai_assistant". */
  itemKey: string;
  /** Shown on the Razorpay plan and the customer's bank statement. */
  itemName: string;
  cycle: BillingCycle;
  /** Amount charged per cycle including GST, in paise. */
  totalPaise: number;
  /** Attached to the Razorpay subscription for webhook routing. */
  notes: Record<string, string>;
}

export interface CreateOrderOpts {
  /** Amount to collect including GST, in paise. */
  amountPaise: number;
  /** Our reference (at most 40 characters for Razorpay). */
  receipt: string;
  /** Attached to the Razorpay order and its payments for webhook routing. */
  notes: Record<string, string>;
}

export interface BillingGateway {
  readonly name: BillingProvider;
  /** A one-time charge (extra AI question packs): a Razorpay Order, or a demo order id. */
  createOrder(opts: CreateOrderOpts): Promise<{ id: string }>;
  createSubscription(opts: CreateSubscriptionOpts): Promise<{ id: string }>;
  /** Stop charging: at the period end (owner cancel) or immediately (plan change). */
  cancelSubscription(id: string, atCycleEnd: boolean): Promise<void>;
}

// ── Demo ───────────────────────────────────────────────────────────────────

const demoGateway: BillingGateway = {
  name: "demo",
  async createSubscription() {
    return { id: "sub_demo_" + nanoid(14) };
  },
  async createOrder() {
    return { id: "order_demo_" + nanoid(14) };
  },
  async cancelSubscription() {},
};

// ── Razorpay ───────────────────────────────────────────────────────────────

const RAZORPAY_API = "https://api.razorpay.com/v1";

/** Key id, under either env name (RAZORPAY_KEY_ID, or RAZORPAY_KEY as set up here). */
export function razorpayKeyId(): string {
  return process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY || "";
}

function razorpayKeySecret(): string {
  return process.env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_SECRET || "";
}

function razorpayAuthHeader(): string {
  return "Basic " + Buffer.from(`${razorpayKeyId()}:${razorpayKeySecret()}`).toString("base64");
}

async function razorpayCall<T>(method: "GET" | "POST" | "PATCH", path: string, body?: unknown): Promise<T> {
  const res = await fetch(RAZORPAY_API + path, {
    method,
    headers: {
      Authorization: razorpayAuthHeader(),
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Razorpay ${method} ${path} failed (${res.status}): ${text.slice(0, 500)}`);
  }
  return (await res.json()) as T;
}

/**
 * The Razorpay plan id for an item+cycle+amount, created on first use. The
 * mapping is cached in system_config under one key, so every server shares it
 * and a price edit (new amount → new mapping entry) never mutates a Razorpay
 * plan that running subscriptions still reference.
 */
const RZP_PLAN_MAP_KEY = "razorpay_plan_ids";

async function ensureRazorpayPlan(opts: CreateSubscriptionOpts): Promise<string> {
  const mapKey = `${opts.itemKey}:${opts.cycle}:${opts.totalPaise}`;
  const [row] = await controlDb.select().from(systemConfig).where(eq(systemConfig.key, RZP_PLAN_MAP_KEY)).limit(1);
  const map = (row?.value ?? {}) as Record<string, string>;
  if (map[mapKey]) return map[mapKey];

  const plan = await razorpayCall<{ id: string }>("POST", "/plans", {
    period: opts.cycle === "yearly" ? "yearly" : "monthly",
    interval: 1,
    item: {
      name: opts.itemName,
      amount: opts.totalPaise,
      currency: "INR",
    },
  });

  await controlDb
    .insert(systemConfig)
    .values({ key: RZP_PLAN_MAP_KEY, value: { [mapKey]: plan.id } })
    .onConflictDoUpdate({
      target: systemConfig.key,
      set: {
        value: sql`${systemConfig.value} || ${JSON.stringify({ [mapKey]: plan.id })}::jsonb`,
        updatedAt: new Date(),
      },
    });
  return plan.id;
}

const razorpayGateway: BillingGateway = {
  name: "razorpay",
  async createOrder(opts) {
    const order = await razorpayCall<{ id: string }>("POST", "/orders", {
      amount: opts.amountPaise,
      currency: "INR",
      receipt: opts.receipt.slice(0, 40),
      notes: opts.notes,
    });
    return { id: order.id };
  },
  async createSubscription(opts) {
    const planId = await ensureRazorpayPlan(opts);
    const sub = await razorpayCall<{ id: string }>("POST", "/subscriptions", {
      plan_id: planId,
      // Auto-renew until cancelled; Razorpay requires a charge count, so use
      // a generous horizon (100 cycles is Razorpay's documented maximum).
      total_count: opts.cycle === "yearly" ? 10 : 100,
      customer_notify: 1,
      notes: opts.notes,
    });
    return { id: sub.id };
  },
  async cancelSubscription(id, atCycleEnd) {
    await razorpayCall("POST", `/subscriptions/${id}/cancel`, { cancel_at_cycle_end: atCycleEnd ? 1 : 0 });
  },
};

// ── Selection & signatures ─────────────────────────────────────────────────

export function razorpayConfigured(): boolean {
  return !!(razorpayKeyId() && razorpayKeySecret());
}

/** The gateway in use: Razorpay once its keys are set, the demo flow before that. */
export function getGateway(): BillingGateway {
  return razorpayConfigured() ? razorpayGateway : demoGateway;
}

/**
 * Verify Razorpay's checkout callback: the signature is HMAC-SHA256 of
 * "<payment_id>|<subscription_id>" with the key secret.
 */
export function verifyRazorpayCheckoutSignature(opts: {
  paymentId: string;
  subscriptionId: string;
  signature: string;
}): boolean {
  const secret = razorpayKeySecret();
  if (!secret) return false;
  const expected = createHmac("sha256", secret).update(`${opts.paymentId}|${opts.subscriptionId}`).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(opts.signature, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Verify Razorpay's checkout callback for an ORDER: the signature is HMAC-SHA256 of
 * "<order_id>|<payment_id>" with the key secret (the subscription callback above signs the
 * ids the other way round).
 */
export function verifyRazorpayOrderSignature(opts: { orderId: string; paymentId: string; signature: string }): boolean {
  const secret = razorpayKeySecret();
  if (!secret) return false;
  const expected = createHmac("sha256", secret).update(`${opts.orderId}|${opts.paymentId}`).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(opts.signature, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Verify a webhook delivery: HMAC-SHA256 of the raw body with the webhook secret. */
export function verifyRazorpayWebhookSignature(rawBody: string, signature: string): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
