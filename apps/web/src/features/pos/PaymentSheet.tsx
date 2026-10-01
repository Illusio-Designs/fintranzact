import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import type { POSCart } from "./state";
import { computeCartTotals } from "./state";
import { useIntraState } from "./useIntraState";
import {
  TENDERS,
  TENDER_LABEL,
  TENDER_MODE,
  fromPaise,
  paymentsForSplit,
  splitRemainder,
  type Tender,
} from "./payment-split";

interface Props {
  open: boolean;
  cart: POSCart;
  onClose: () => void;
  onFinalized: (invoiceId: string, invoiceNumber: string) => void;
}

type Mode = Tender | "split";

/**
 * Bottom payment sheet. Mode tiles (Cash / UPI / Card / Split), shows the
 * total, confirms, creates an invoice + its payment(s), and hands back the
 * invoice id for receipt printing. A split sale records one payment per
 * tender used, each allocated to the invoice.
 *
 * Failure mode: if invoice creates but payment fails, we surface the error
 * and DON'T clear the cart. The user can retry payment via the normal flow.
 * The invoice lives as an unpaid "sent" sale.
 */
export function PaymentSheet({ open, cart, onClose, onFinalized }: Props) {
  const [mode, setMode] = useState<Mode>("cash");
  const [phase, setPhase] = useState<"idle" | "creating" | "paying">("idle");
  const [split, setSplit] = useState<Partial<Record<Tender, string>>>({});

  useEffect(() => {
    if (!open) {
      setPhase("idle");
      setSplit({});
    }
  }, [open]);

  const createInvoice = trpc.invoice.create.useMutation();
  const createPayment = trpc.payment.create.useMutation();

  const intraState = useIntraState(cart.partyId);
  const totals = computeCartTotals(cart.lineItems, intraState);
  const remainder = splitRemainder(split, totals.total);
  const splitReady = mode !== "split" || remainder === 0;

  async function handleConfirm() {
    if (cart.lineItems.length === 0) {
      toast.error("Cart is empty");
      return;
    }
    if (!splitReady) return;
    setPhase("creating");
    let invoiceId: string | undefined;
    let invoiceTotal: string | undefined;
    let invoiceNumber = "";
    try {
      const inv = await createInvoice.mutateAsync({
        partyId: cart.partyId,
        type: "sale",
        documentType: "invoice",
        // Tag this invoice as originating from the POS register so reports
        // and the invoice list can attribute revenue by channel.
        source: "pos",
        // Every POS sale is "just another invoice" — the server is the
        // single source of truth for numbering, stock, GST, and audit.
        // selectedUnit + conversionFactor + variantId are what let the
        // existing stock-decrement path work correctly for alt_units and
        // variants without any POS-specific server logic.
        lineItems: cart.lineItems.map((li) => ({
          itemId: li.itemId ?? undefined,
          variantId: li.variantId ?? undefined,
          itemName: li.itemName,
          quantity: li.quantity,
          selectedUnit: li.unit,
          conversionFactor: li.conversionFactor,
          unitPrice: li.unitPrice,
          taxPercent: li.taxPercent,
          discountPercent: li.discountPercent,
        })),
        additionalCharges: "0",
        invoiceDiscount: "0",
        invoiceDiscountType: "amount",
        roundOff: "0",
        isReverseCharge: false,
        deliveryMethod: "self_pickup",
      });
      invoiceId = inv.id;
      invoiceTotal = inv.totalAmount;
      invoiceNumber = inv.invoiceNumber;
    } catch (err) {
      setPhase("idle");
      toast.error("Could not create sale", err instanceof Error ? err.message : String(err));
      return;
    }

    setPhase("paying");
    const tenders =
      mode === "split" ? paymentsForSplit(split, invoiceTotal!) : [{ tender: mode, amount: invoiceTotal! }];
    try {
      // One payment per tender, each against this invoice.
      for (const t of tenders) {
        await createPayment.mutateAsync({
          invoiceId,
          partyId: cart.partyId,
          amount: t.amount,
          mode: TENDER_MODE[t.tender],
          paymentDate: new Date().toISOString(),
          notes: mode === "split" ? `POS split payment (${TENDER_LABEL[t.tender]})` : undefined,
        });
      }
    } catch (err) {
      setPhase("idle");
      toast.error(
        "Sale saved but payment step failed",
        `Invoice created. Settle payment via the normal flow. ${err instanceof Error ? err.message : ""}`,
      );
      // Still advance — the invoice exists and the cashier can reprint later.
      onFinalized(invoiceId, invoiceNumber);
      return;
    }

    setPhase("idle");
    onFinalized(invoiceId, invoiceNumber);
  }

  if (!open) return null;

  const busy = phase !== "idle";

  return (
    <div
      className="fixed inset-0 z-40 bg-black/40 flex items-end justify-center"
      onClick={busy ? undefined : onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pos-payment-title"
        className="w-full max-w-lg max-h-full overflow-y-auto bg-surface-1 border border-border rounded-t-2xl shadow-xl p-6 space-y-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-baseline justify-between">
          <h2 id="pos-payment-title" className="text-xl font-semibold">Take Payment</h2>
          <div className="text-3xl font-bold tabular-nums" data-testid="pos-payment-total">
            ₹{totals.total.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" role="radiogroup" aria-label="Payment mode">
          {TENDERS.map((t) => (
            <PayModeTile key={t} active={mode === t} onClick={() => setMode(t)} label={TENDER_LABEL[t]} />
          ))}
          <PayModeTile active={mode === "split"} onClick={() => setMode("split")} label="Split" />
        </div>

        {mode === "split" && (
          <div className="space-y-3">
            {TENDERS.map((t) => (
              <label key={t} className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium">{TENDER_LABEL[t]} amount</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  className="input w-36 text-right tabular-nums"
                  value={split[t] ?? ""}
                  onChange={(e) => setSplit((s) => ({ ...s, [t]: e.target.value }))}
                  disabled={busy}
                />
              </label>
            ))}
            <p
              className={`text-sm tabular-nums ${remainder === 0 ? "text-text-secondary" : "text-red-500"}`}
              data-testid="pos-split-remainder"
            >
              {remainder === 0
                ? "Fully covered"
                : remainder > 0
                  ? `₹${fromPaise(remainder)} still to pay`
                  : `₹${fromPaise(-remainder)} more than the total`}
            </p>
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button className="btn-secondary flex-1" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn-primary flex-1 text-base py-3"
            onClick={handleConfirm}
            disabled={busy || !splitReady}
          >
            {phase === "creating"
              ? "Saving sale…"
              : phase === "paying"
                ? "Recording payment…"
                : `Confirm ${mode === "split" ? "Split" : TENDER_LABEL[mode]}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function PayModeTile({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={`p-4 sm:p-6 rounded-lg border text-center transition-colors ${
        active
          ? "border-brand-600 bg-brand-600/10 ring-2 ring-brand-600"
          : "border-border bg-surface-2 hover:bg-surface-3"
      }`}
    >
      <div className="text-lg font-semibold">{label}</div>
    </button>
  );
}
