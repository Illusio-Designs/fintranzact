import { useState } from "react";
import { payOrder } from "../api";

interface PayNowButtonProps {
  slug: string;
  orderId: string;
  /** "Pay now" the first time, "Pay again" after an attempt that did not go through. */
  label: string;
  accent: string;
}

/**
 * Takes the shopper to Razorpay's payment page for an unpaid online order. The
 * server makes (or reuses) the payment page for the order's own amount; this
 * only asks for it and follows it. A failure is a polite message, never a dead end.
 */
export function PayNowButton({ slug, orderId, label, accent }: PayNowButtonProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function go() {
    setBusy(true);
    setError("");
    try {
      const url = await payOrder(slug, orderId);
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Online payment is unavailable right now. Please try again in a moment.");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        className="btn-primary w-full py-3"
        style={{ background: accent }}
        onClick={go}
        disabled={busy}
        data-testid="pay-now"
      >
        {busy ? "Taking you to payment..." : label}
      </button>
      {error && (
        <p className="text-sm text-center" role="alert" style={{ color: "var(--store-danger)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
