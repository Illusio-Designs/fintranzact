import type { StoreConfig, OrderResult, StorePolicies, PaymentMethod, PublicOrder } from "./types";

const API_URL = import.meta.env.API_URL || "";

// In production: API_URL = "${import.meta.env.API_URL}" → calls /store/<slug>/...
// In dev: API_URL is empty → calls /<slug>/... → Vite proxy rewrites to /store/<slug>/...
const STORE_PREFIX = API_URL ? `${API_URL}/store` : "";

export async function fetchCatalog(slug: string): Promise<StoreConfig> {
  // `credentials: "omit"` — the store is fully public. Never attach the
  // admin session_id cookie from a same-origin self-hosted deploy. If we
  // ever did, the (now removed) global CSRF gate would trip and the
  // storefront would break on checkout.
  const res = await fetch(`${STORE_PREFIX}/${slug}/catalog.json`, {
    credentials: "omit",
  });
  if (!res.ok) throw new Error("Store not found");
  return res.json();
}

export async function fetchPolicies(slug: string): Promise<StorePolicies> {
  const res = await fetch(`${STORE_PREFIX}/${slug}/policies.json`, {
    credentials: "omit",
  });
  if (!res.ok) throw new Error("Store not found");
  return res.json();
}

export async function placeOrder(
  slug: string,
  order: {
    customerName: string;
    customerPhone: string;
    customerEmail?: string;
    deliveryAddress?: string;
    deliveryCity?: string;
    deliveryPincode?: string;
    deliveryNotes?: string;
    items: Array<{
      itemId: string;
      quantity: number;
      selectedUnit?: string;
      conversionFactor?: number;
      variantId?: string;
    }>;
    turnstileToken?: string;
    /** How the shopper chose to pay; the server checks it against what the store offers. */
    paymentMethod?: PaymentMethod;
  }
): Promise<OrderResult> {
  // `credentials: "omit"` — never attach cookies. `X-Requested-With` is
  // defence in depth so the client keeps working if someone later
  // narrows the server's `/store/*` CSRF exemption.
  const res = await fetch(`${STORE_PREFIX}/${slug}/order`, {
    method: "POST",
    credentials: "omit",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "fintranzact",
    },
    body: JSON.stringify(order),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Order failed" }));
    throw new Error(err.error || "Order failed");
  }
  return res.json();
}

/** The public status page of one order: totals, payment state, whether it can still be paid online. */
export async function fetchOrder(slug: string, orderId: string): Promise<PublicOrder> {
  const res = await fetch(`${STORE_PREFIX}/${slug}/order/${orderId}`, { credentials: "omit" });
  if (!res.ok) throw new Error(res.status === 404 ? "We could not find this order." : "Could not load your order. Please try again.");
  return res.json();
}

/** A (new or reused) Razorpay payment page for an unpaid online order: "Pay now" / "Pay again". */
export async function payOrder(slug: string, orderId: string): Promise<string> {
  const res = await fetch(`${STORE_PREFIX}/${slug}/order/${orderId}/pay`, {
    method: "POST",
    credentials: "omit",
    headers: { "X-Requested-With": "fintranzact" },
  });
  const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !body.url) throw new Error(body.error || "Online payment is unavailable right now. Please try again in a moment.");
  return body.url;
}
