/**
 * Razorpay client for a BUSINESS's OWN account (Settings, Online payments).
 *
 * This is deliberately separate from lib/billing/gateway.ts, which talks to
 * the platform's own Razorpay account for Fintranzact subscriptions. Customer
 * money for a business's invoices must only ever go through the keys that
 * business pasted in, never through the platform's RAZORPAY_KEY_ID.
 *
 * Nothing here logs or returns keys, secrets or signatures. The HTTP layer is
 * injectable (setRazorpayFetch) so tests never reach the real Razorpay.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const RAZORPAY_API = "https://api.razorpay.com/v1";
const REQUEST_TIMEOUT_MS = 10_000;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

let fetchImpl: FetchLike = (input, init) => fetch(input, init);

/** Tests only: replace (or with null restore) the HTTP layer. */
export function setRazorpayFetch(impl: FetchLike | null): void {
  fetchImpl = impl ?? ((input, init) => fetch(input, init));
}

// ── Amounts ─────────────────────────────────────────────────────────────────

/** Razorpay paise (integer) to the app's money string ("1234" -> "12.34"). */
export function paiseToMoney(paise: number): string {
  if (!Number.isFinite(paise) || !Number.isInteger(paise)) throw new Error("paise must be an integer");
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

/** The app's money string to paise, exactly (no floating point): "12.34" -> 1234. */
export function moneyToPaise(amount: string | number): number {
  const s = String(amount).trim();
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new Error("not a money amount");
  const [, sign, whole, fracRaw = ""] = m;
  // Round half up on a third decimal; the DB stores two so this is only safety.
  const frac = (fracRaw + "00").slice(0, 2);
  let paise = Number(whole) * 100 + Number(frac);
  if (fracRaw.length > 2 && Number(fracRaw[2]) >= 5) paise += 1;
  return sign === "-" ? -paise : paise;
}

// ── Signatures ──────────────────────────────────────────────────────────────

/**
 * Razorpay's webhook signature: hex HMAC-SHA256 of the RAW request body with
 * the webhook secret, compared in constant time. Any malformed input is just
 * "not valid".
 */
export function verifyWebhookSignature(rawBody: string, signature: string | null | undefined, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  if (!/^[0-9a-f]{64}$/i.test(signature)) return false;
  const given = Buffer.from(signature, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Razorpay key ids look like rzp_test_xxxxxxxx / rzp_live_xxxxxxxx. */
export function parseKeyId(keyId: string): { mode: "test" | "live" } | null {
  const m = /^rzp_(test|live)_[A-Za-z0-9]{6,40}$/.exec(keyId.trim());
  return m ? { mode: m[1] as "test" | "live" } : null;
}

/** "rzp_live_••••AbCd": enough to recognise the key, not enough to use it. */
export function maskKeyId(keyId: string): string {
  const prefix = /^(rzp_(?:test|live)_)/.exec(keyId)?.[1] ?? "rzp_";
  return `${prefix}••••${keyId.slice(-4)}`;
}

// ── HTTP ────────────────────────────────────────────────────────────────────

export class RazorpayApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    /** Razorpay's own description. Never contains our credentials. */
    readonly description: string,
  ) {
    super(`Razorpay request failed (${status}${code ? ` ${code}` : ""})`);
    this.name = "RazorpayApiError";
  }
  get isAuthError(): boolean {
    return this.status === 401;
  }
}

export interface RazorpayCredentials {
  keyId: string;
  keySecret: string;
}

export interface RazorpayPaymentLink {
  id: string;
  short_url: string;
  status: string;
  amount: number;
}

export interface CreatePaymentLinkParams {
  amountPaise: number;
  referenceId: string;
  description: string;
  customer: { name?: string; email?: string; contact?: string };
  callbackUrl: string | null;
  notes: Record<string, string>;
  /** Smallest part-payment the customer may make, in paise. */
  firstMinPartialPaise: number;
  /** Whether the customer may pay less than the whole amount. Defaults to on when the amount allows it; store orders are always paid in full. */
  acceptPartial?: boolean;
}

export interface RazorpayRefund {
  id: string;
  payment_id?: string;
  amount: number;
  status?: string;
}

async function call<T>(creds: RazorpayCredentials, method: "GET" | "POST", path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(RAZORPAY_API + path, {
      method,
      headers: {
        Authorization: "Basic " + Buffer.from(`${creds.keyId}:${creds.keySecret}`).toString("base64"),
        "Content-Type": "application/json",
        ...(extraHeaders ?? {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    // Network error or timeout: no detail that could carry a header.
    throw new RazorpayApiError(0, null, "Could not reach Razorpay");
  }
  const text = await res.text().catch(() => "");
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const err = (json as { error?: { code?: string; description?: string } } | null)?.error;
    throw new RazorpayApiError(res.status, err?.code ?? null, err?.description?.slice(0, 300) ?? "Razorpay rejected the request");
  }
  return json as T;
}

export const razorpay = {
  /** A cheap authenticated read that also proves Payment Links is enabled on the account. */
  async testConnection(creds: RazorpayCredentials): Promise<void> {
    await call(creds, "GET", "/payment_links?count=1");
  },

  createPaymentLink(creds: RazorpayCredentials, p: CreatePaymentLinkParams): Promise<RazorpayPaymentLink> {
    const customer: Record<string, string> = {};
    if (p.customer.name) customer.name = p.customer.name.slice(0, 100);
    if (p.customer.email) customer.email = p.customer.email;
    if (p.customer.contact) customer.contact = p.customer.contact;
    const partial = (p.acceptPartial ?? true) && p.amountPaise > p.firstMinPartialPaise;
    return call<RazorpayPaymentLink>(creds, "POST", "/payment_links", {
      amount: p.amountPaise,
      currency: "INR",
      accept_partial: partial,
      ...(partial ? { first_min_partial_amount: p.firstMinPartialPaise } : {}),
      reference_id: p.referenceId.slice(0, 40),
      description: p.description.slice(0, 2000),
      customer,
      // The business reminds its own customers; Razorpay must not message them.
      notify: { sms: false, email: false },
      reminder_enable: false,
      ...(p.callbackUrl ? { callback_url: p.callbackUrl, callback_method: "get" } : {}),
      notes: p.notes,
    });
  },

  async cancelPaymentLink(creds: RazorpayCredentials, linkId: string): Promise<void> {
    await call(creds, "POST", `/payment_links/${encodeURIComponent(linkId)}/cancel`);
  },

  /**
   * Refund all or part of a captured payment. The idempotency key is sent as
   * Razorpay's X-Refund-Idempotency header, so a retried call returns the
   * first refund instead of making another.
   */
  refundPayment(
    creds: RazorpayCredentials,
    paymentId: string,
    p: { amountPaise: number; receipt: string; idempotencyKey: string; notes?: Record<string, string> },
  ): Promise<RazorpayRefund> {
    return call<RazorpayRefund>(
      creds,
      "POST",
      `/payments/${encodeURIComponent(paymentId)}/refund`,
      { amount: p.amountPaise, speed: "normal", receipt: p.receipt.slice(0, 40), ...(p.notes ? { notes: p.notes } : {}) },
      { "X-Refund-Idempotency": p.idempotencyKey },
    );
  },
};

/** An Indian mobile number in the +91XXXXXXXXXX form Razorpay accepts, or undefined. */
export function razorpayContact(phone: string | null | undefined): string | undefined {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  return undefined;
}

export function razorpayEmail(email: string | null | undefined): string | undefined {
  const e = (email ?? "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : undefined;
}
