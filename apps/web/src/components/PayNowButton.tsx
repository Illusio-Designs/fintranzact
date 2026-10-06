/**
 * "Pay now" on the public share page. Public and unauthenticated: it asks the
 * server (by the share token alone) for a Razorpay payment link for the
 * invoice's balance due and sends the customer there. No amount or key is
 * ever sent from or shown on this page.
 */
import { useState } from "react";
import { apiUrl } from "@/lib/api-url";

interface PayNowButtonProps {
  token: string;
  /** Called with the Razorpay URL; the page navigates there. Injectable for tests. */
  onRedirect?: (url: string) => void;
}

export function PayNowButton({ token, onRedirect }: PayNowButtonProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(apiUrl(`/api/share/${encodeURIComponent(token)}/pay`), { method: "POST", credentials: "omit" });
      const body = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (!res.ok || !body?.url) {
        setError(body?.error ?? "Online payment is unavailable right now. Please try again shortly.");
        setBusy(false);
        return;
      }
      (onRedirect ?? ((url: string) => window.location.assign(url)))(body.url);
    } catch {
      setError("Could not reach the payment page. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={pay} disabled={busy} className="btn-primary px-4 py-2 disabled:opacity-60" data-testid="pay-now">
        {busy ? "Opening payment page..." : "Pay now"}
      </button>
      {error && (
        <p role="alert" className="basis-full text-sm text-red-600" data-testid="pay-now-error">
          {error}
        </p>
      )}
    </>
  );
}
