/**
 * Settings, Online Store: the delivery charge at checkout. A flat fee, an
 * optional "free above" order subtotal, and the note shoppers see (for example
 * "Delivery in 3-5 working days"). The charge is worked out on the server from
 * these settings when an order is placed; the storefront only displays it. On
 * the invoice it is an additional charge and takes GST like any invoice charge.
 */
import { useState } from "react";
import { STORE_DELIVERY_FEE_MAX, STORE_FREE_DELIVERY_ABOVE_MAX, calcStoreDelivery } from "@fintranzact/shared";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { formatCurrency } from "@/lib/utils";

const MONEY = /^\d+(\.\d{1,2})?$/;

/** Validation for the two money inputs; returns an error text or null. */
export function validateDeliveryAmount(raw: string, max: number, opts: { required: boolean }): string | null {
  const v = raw.trim();
  if (v === "") return opts.required ? "Enter 0 for no delivery charge" : null;
  if (!MONEY.test(v)) return "Enter an amount in rupees, like 49 or 49.50";
  if (Number(v) > max) return `At most ${formatCurrency(max)}`;
  return null;
}

export function StoreDeliveryCard() {
  const utils = trpc.useUtils();
  const { data: settings, isLoading } = trpc.store.getSettings.useQuery();

  const [fee, setFee] = useState<string | null>(null);
  const [freeAbove, setFreeAbove] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const update = trpc.store.updateSettings.useMutation({
    onSuccess: () => {
      utils.store.getSettings.invalidate();
      toast.success("Delivery settings saved");
      setFee(null);
      setFreeAbove(null);
      setNote(null);
    },
    onError: (err) => toast.error("Could not save", err.message),
  });

  if (isLoading || !settings) return <div className="skeleton mt-6 h-48 rounded-xl" data-testid="store-delivery-loading" />;

  // Saved values show as plain numbers ("49", not "49.00") until the owner edits.
  const plain = (v: string | null | undefined) => (v ? String(Number(v)) : "");
  const effFee = fee ?? plain(settings.storeDeliveryFee);
  const effFreeAbove = freeAbove ?? plain(settings.storeFreeDeliveryAbove);
  const effNote = note ?? settings.storeDeliveryNote ?? "";

  const feeError = validateDeliveryAmount(effFee, STORE_DELIVERY_FEE_MAX, { required: true });
  const freeAboveError = validateDeliveryAmount(effFreeAbove, STORE_FREE_DELIVERY_ABOVE_MAX, { required: false });
  const valid = !feeError && !freeAboveError;
  const dirty = fee !== null || freeAbove !== null || note !== null;

  // What a shopper sees: the same rule the server applies (calcStoreDelivery).
  const feeNum = valid ? Number(effFee || "0") : 0;
  const thresholdNum = valid && effFreeAbove.trim() !== "" ? Number(effFreeAbove) : 0;
  const preview = (subtotal: number) => calcStoreDelivery({ fee: String(feeNum), freeAbove: thresholdNum ? String(thresholdNum) : null, subtotal });
  const exampleBelow = thresholdNum > 0 ? Math.max(0, Math.floor(thresholdNum / 2)) : 300;
  const below = preview(exampleBelow);
  const above = thresholdNum > 0 ? preview(thresholdNum) : null;

  function save() {
    update.mutate({
      storeDeliveryFee: effFee.trim() === "" ? "0" : effFee.trim(),
      storeFreeDeliveryAbove: effFreeAbove.trim() === "" ? null : effFreeAbove.trim(),
      storeDeliveryNote: effNote.trim() === "" ? null : effNote.trim(),
    });
  }

  return (
    <div className="card mt-6 p-6" data-testid="store-delivery-card">
      <h3 className="text-sm font-semibold text-text-primary">Delivery charge</h3>
      <p className="mt-1 text-xs text-text-tertiary">
        A flat fee added to every order, shown to shoppers at checkout. Leave it at 0 if you deliver free or the order is for pickup.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="store-delivery-fee">Delivery fee (₹, before GST)</label>
          <input
            id="store-delivery-fee"
            className="input"
            inputMode="decimal"
            value={effFee}
            onChange={(e) => setFee(e.target.value)}
            placeholder="0"
            aria-invalid={!!feeError}
            aria-describedby={feeError ? "store-delivery-fee-error" : undefined}
          />
          {feeError && <p id="store-delivery-fee-error" className="mt-1 text-xs text-red-600" role="alert">{feeError}</p>}
        </div>
        <div>
          <label className="label" htmlFor="store-free-delivery-above">Free delivery on orders of (₹)</label>
          <input
            id="store-free-delivery-above"
            className="input"
            inputMode="decimal"
            value={effFreeAbove}
            onChange={(e) => setFreeAbove(e.target.value)}
            placeholder="Optional, like 500"
            aria-invalid={!!freeAboveError}
            aria-describedby={freeAboveError ? "store-free-delivery-above-error" : undefined}
          />
          {freeAboveError && <p id="store-free-delivery-above-error" className="mt-1 text-xs text-red-600" role="alert">{freeAboveError}</p>}
          <p className="mt-1 text-xs text-text-tertiary">Judged on the order subtotal, before GST. Leave empty to always charge the fee.</p>
        </div>
      </div>

      <div className="mt-4">
        <label className="label" htmlFor="store-delivery-note">Delivery Note</label>
        <input
          id="store-delivery-note"
          className="input"
          value={effNote}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Delivery in 3-5 working days"
          maxLength={500}
        />
        <p className="mt-1 text-xs text-text-tertiary">Shown in the cart and at checkout.</p>
      </div>

      <div className="mt-4 rounded-xl bg-surface-1 px-4 py-3 text-sm" data-testid="store-delivery-preview">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">What shoppers see</p>
        {!valid ? (
          <p className="mt-1 text-text-secondary">Fix the amounts above to see the preview.</p>
        ) : below.reason === "none" ? (
          <p className="mt-1 text-text-primary" data-testid="store-delivery-preview-free">Delivery: Free delivery</p>
        ) : (
          <>
            <p className="mt-1 text-text-primary" data-testid="store-delivery-preview-fee">
              Order below {thresholdNum > 0 ? formatCurrency(thresholdNum) : "any amount"}: Delivery {formatCurrency(below.charge)}
              {below.amountToFree ? `. Add ${formatCurrency(below.amountToFree)} more for free delivery` : ""}
            </p>
            {above && (
              <p className="mt-0.5 text-text-primary" data-testid="store-delivery-preview-threshold">
                Order of {formatCurrency(thresholdNum)} or more: Free delivery
              </p>
            )}
          </>
        )}
        {effNote.trim() !== "" && <p className="mt-1 text-text-secondary">{effNote.trim()}</p>}
      </div>

      <p className="mt-3 text-xs text-text-tertiary" data-testid="store-delivery-gst-note">
        On the invoice the fee is an additional charge and takes GST like any other charge on an invoice: at the highest GST rate among the items in the order.
        Please have your CA confirm this treatment for your business.
      </p>

      <button className="btn-primary mt-4" onClick={save} disabled={!dirty || !valid || update.isPending}>
        {update.isPending ? "Saving…" : dirty ? "Save delivery settings" : "No changes"}
      </button>
    </div>
  );
}
