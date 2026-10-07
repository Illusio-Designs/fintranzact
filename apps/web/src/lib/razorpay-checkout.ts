/**
 * Razorpay checkout popup for subscription payments.
 *
 * Loads checkout.razorpay.com/v1/checkout.js once (allowed by the CSP in
 * csp-hash.ts) and opens the subscription checkout (or, with `orderId`, a
 * one-time order checkout). On success the caller sends the payment id +
 * signature to billing.verifyCheckout (billing.verifyAiPackPayment for an
 * order), which verifies the HMAC server-side.
 */

export interface RazorpayCheckoutSuccess {
  razorpay_payment_id: string;
  razorpay_signature: string;
  /** Set for a subscription checkout. */
  razorpay_subscription_id?: string;
  /** Set for a one-time order checkout (extra AI question packs). */
  razorpay_order_id?: string;
}

interface RazorpayWindow extends Window {
  Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
}

let scriptLoading: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if ((window as RazorpayWindow).Razorpay) return Promise.resolve();
  if (!scriptLoading) {
    scriptLoading = new Promise<void>((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://checkout.razorpay.com/v1/checkout.js";
      s.onload = () => resolve();
      s.onerror = () => {
        scriptLoading = null;
        reject(new Error("Could not load the payment page. Check your connection and try again."));
      };
      document.head.appendChild(s);
    });
  }
  return scriptLoading;
}

export async function openRazorpayCheckout(opts: {
  keyId: string;
  /** A subscription checkout... */
  providerSubscriptionId?: string;
  /** ...or a one-time order checkout (extra AI question packs): the Razorpay order id. */
  orderId?: string;
  /** Shown in the checkout header. */
  name?: string;
  email?: string;
  onSuccess: (resp: RazorpayCheckoutSuccess) => void;
  /** The person closed the popup without paying. */
  onDismiss?: () => void;
}): Promise<void> {
  await loadScript();
  const Razorpay = (window as RazorpayWindow).Razorpay!;
  new Razorpay({
    key: opts.keyId,
    ...(opts.orderId ? { order_id: opts.orderId } : { subscription_id: opts.providerSubscriptionId }),
    name: "Fintranzact",
    description: opts.name,
    theme: { color: "#3b5eaa" },
    prefill: opts.email ? { email: opts.email } : undefined,
    handler: opts.onSuccess,
    modal: { ondismiss: opts.onDismiss },
  }).open();
}
