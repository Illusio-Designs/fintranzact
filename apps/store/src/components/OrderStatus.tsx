import { useEffect, useState } from "react";
import type { PublicOrder, StoreConfig } from "../types";
import { fetchOrder } from "../api";
import { PayNowButton } from "./PayNowButton";

interface OrderStatusProps {
  slug: string;
  orderId: string;
  config: StoreConfig;
}

/** How long (and how often) to look for a payment that has just been made. The webhook usually lands within seconds. */
const POLL_EVERY_MS = 3000;
const POLL_TIMES = 15;

function returningFromPayment(): boolean {
  const q = new URLSearchParams(window.location.search);
  return q.has("razorpay_payment_id") || q.has("razorpay_payment_link_status");
}

/**
 * /<slug>/order/<id>: where Razorpay sends the shopper back to, and the page
 * an order email links to. It never trusts the address bar (Razorpay's return
 * parameters are only a hint to look again): what it shows comes from the
 * server, which marks the order paid only when the signed webhook arrives.
 */
export function OrderStatus({ slug, orderId, config }: OrderStatusProps) {
  const { business } = config;
  const symbol = business.currency === "INR" ? "₹" : business.currency;
  const accent = business.accentColor || "var(--store-accent)";

  const [order, setOrder] = useState<PublicOrder | null>(null);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const returning = returningFromPayment();

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function load(n: number) {
      try {
        const o = await fetchOrder(slug, orderId);
        if (cancelled) return;
        setOrder(o);
        setError("");
        const waiting = returning && o.paymentMethod === "online" && o.paymentStatus === "unpaid" && o.status !== "cancelled";
        if (waiting && n < POLL_TIMES) {
          setChecking(true);
          setAttempts(n + 1);
          timer = setTimeout(() => void load(n + 1), POLL_EVERY_MS);
        } else {
          setChecking(false);
        }
      } catch (err) {
        if (cancelled) return;
        setChecking(false);
        setError(err instanceof Error ? err.message : "Could not load your order. Please try again.");
      }
    }
    void load(0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [slug, orderId, returning]);

  const money = (v: string) => `${symbol}${parseFloat(v).toFixed(2)}`;

  return (
    <div className="min-h-dvh px-4 py-8" style={{ background: "var(--store-bg-secondary)" }}>
      <div className="max-w-md mx-auto">
        <p className="text-sm font-semibold mb-3" style={{ color: "var(--store-text)" }}>
          {business.name}
        </p>

        {error && !order && (
          <div className="rounded-2xl p-6 text-center" style={{ background: "var(--store-bg)", boxShadow: "var(--store-shadow-lg)" }}>
            <p className="text-sm" role="alert" style={{ color: "var(--store-text-secondary)" }}>
              {error}
            </p>
            <a className="btn-ghost inline-block mt-4 px-4 py-2" href={`/${slug}`}>
              Back to the store
            </a>
          </div>
        )}

        {!order && !error && (
          <p className="text-sm" style={{ color: "var(--store-muted)" }}>
            Loading your order...
          </p>
        )}

        {order && (
          <div className="rounded-2xl p-6 space-y-5" style={{ background: "var(--store-bg)", boxShadow: "var(--store-shadow-lg)" }}>
            <div>
              <h1 className="text-xl font-bold" style={{ color: "var(--store-text)", letterSpacing: "-0.02em" }}>
                Order <span data-testid="order-number">{order.orderNumber}</span>
              </h1>
              <PaymentBanner order={order} checking={checking} attempts={attempts} returning={returning} money={money} />
            </div>

            <div className="space-y-1.5 text-sm" data-testid="order-lines">
              {order.lines.map((l, i) => (
                <div key={i} className="flex justify-between gap-3" style={{ color: "var(--store-text-secondary)" }}>
                  <span className="min-w-0 truncate">
                    {l.name} <span style={{ color: "var(--store-muted)" }}>x{parseFloat(l.quantity)}</span>
                  </span>
                  <span className="tabular-nums">{money(l.total)}</span>
                </div>
              ))}
            </div>

            <div className="space-y-1.5 border-t pt-3 text-sm" style={{ borderColor: "var(--store-border-light)" }}>
              <Row label="Subtotal" value={money(order.subtotal)} />
              <Row
                label="Delivery"
                value={parseFloat(order.deliveryCharge ?? "0") > 0 ? money(order.deliveryCharge!) : "Free delivery"}
                testId="order-delivery"
              />
              <Row label="GST" value={money(order.taxAmount)} />
              <div className="flex justify-between font-bold pt-1.5" style={{ color: "var(--store-text)" }}>
                <span>Total</span>
                <span className="tabular-nums" data-testid="order-total">
                  {money(order.totalAmount)}
                </span>
              </div>
              {parseFloat(order.refundedAmount) > 0 && (
                <Row label="Refunded to you" value={money(order.refundedAmount)} />
              )}
            </div>

            {order.canPayOnline && (
              <PayNowButton
                slug={slug}
                orderId={order.orderId}
                accent={accent}
                label={returning ? "Pay again" : `Pay ${money(order.balance ?? order.totalAmount)} now`}
              />
            )}

            <a className="btn-ghost block w-full py-3 text-center" href={`/${slug}`}>
              Continue shopping
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="flex justify-between" style={{ color: "var(--store-text-secondary)" }}>
      <span>{label}</span>
      <span className="tabular-nums" data-testid={testId}>{value}</span>
    </div>
  );
}

function PaymentBanner({
  order,
  checking,
  attempts,
  returning,
  money,
}: {
  order: PublicOrder;
  checking: boolean;
  attempts: number;
  returning: boolean;
  money: (v: string) => string;
}) {
  let tone: "ok" | "wait" | "warn" | "plain" = "plain";
  let text: string;
  if (order.status === "cancelled") {
    tone = "warn";
    text = order.paymentStatus === "refunded" || order.paymentStatus === "partially_refunded"
      ? "This order was cancelled and your payment has been refunded. Banks usually take 5 to 7 working days to show it."
      : "This order was cancelled.";
  } else if (order.paymentStatus === "paid") {
    tone = "ok";
    text = "Payment received. Thank you! The store will confirm your order shortly.";
  } else if (order.paymentStatus === "refunded") {
    tone = "plain";
    text = "Your payment has been refunded. Banks usually take 5 to 7 working days to show it.";
  } else if (order.paymentStatus === "partially_refunded") {
    tone = "plain";
    text = `Part of your payment (${money(order.refundedAmount)}) has been refunded. Banks usually take 5 to 7 working days to show it.`;
  } else if (order.paymentMethod === "cod") {
    text = "Cash on Delivery: pay in cash when your order arrives.";
  } else if (checking) {
    tone = "wait";
    text = attempts > 1 ? "Still confirming your payment. This can take a minute..." : "Confirming your payment...";
  } else if (returning) {
    tone = "warn";
    text = "We have not received your payment yet. If you have just paid, give it a minute and refresh this page. If it did not go through, you can try again below. Any amount your bank took for a failed payment is returned by the bank.";
  } else {
    tone = "wait";
    text = "Your order is saved and is waiting for payment. Pay online to confirm it.";
  }
  const colors: Record<typeof tone, { bg: string; fg: string }> = {
    ok: { bg: "var(--store-success-bg)", fg: "var(--store-success)" },
    wait: { bg: "var(--store-bg-secondary)", fg: "var(--store-text-secondary)" },
    warn: { bg: "var(--store-danger-bg)", fg: "var(--store-danger)" },
    plain: { bg: "var(--store-bg-secondary)", fg: "var(--store-text-secondary)" },
  };
  return (
    <p className="mt-2 text-sm rounded-lg p-3" role="status" data-testid="payment-banner" style={{ background: colors[tone].bg, color: colors[tone].fg }}>
      {text}
    </p>
  );
}
