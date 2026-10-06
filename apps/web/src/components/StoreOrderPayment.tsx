/**
 * Payment block of a store order's detail panel: how the shopper chose to pay,
 * where the money stands, the Razorpay payment reference, the refunds made so
 * far, and (owner and admin) a Refund action for an order paid online. The
 * refund goes through the business's own Razorpay and is booked as a credit
 * note; the server works out what can still be refunded and enforces the role.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useCan } from "@/lib/permissions";
import { toast } from "@/hooks/useToast";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

export interface StoreOrderPaymentData {
  id: string;
  orderNumber: string;
  paymentMethod: string;
  paymentStatus: string;
  paidAt: Date | string | null;
  refundedAmount: string;
  refundable: string;
  razorpayPayments: Array<{ razorpayPaymentId: string; amount: string; fee: string | null; method: string | null; createdAt: Date | string }>;
  refunds: Array<{ id: string; amount: string; status: string; razorpayRefundId: string | null; reason: string | null; createdAt: Date | string }>;
}

const STATUS_LABEL: Record<string, { label: string; classes: string }> = {
  unpaid: { label: "Unpaid", classes: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400" },
  paid: { label: "Paid", classes: "bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-400" },
  partially_refunded: { label: "Partly refunded", classes: "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400" },
  refunded: { label: "Refunded", classes: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
};

function newKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }
}

/** Whether an order has online money that has not all been refunded yet. */
export function hasRefundableMoney(order: Pick<StoreOrderPaymentData, "refundable">): boolean {
  return Number(order.refundable) > 0;
}

export function StoreOrderPayment({ order, onChanged }: { order: StoreOrderPaymentData; onChanged?: () => void }) {
  const utils = trpc.useUtils();
  const canRefund = useCan("Store", "manage");
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  // One key per refund attempt, kept until it succeeds: a double click or a retry never refunds twice.
  const [key, setKey] = useState(newKey);

  const refund = trpc.store.refundOrder.useMutation({
    onSuccess: (res) => {
      toast.success("Refund sent", `${formatCurrency(res.amount)} refunded through Razorpay. Credit note ${res.creditNoteNumber} recorded.`);
      utils.store.getOrder.invalidate({ id: order.id });
      utils.store.listOrders.invalidate();
      setConfirming(false);
      setOpen(false);
      setAmount("");
      setReason("");
      setKey(newKey());
      onChanged?.();
    },
    onError: (err) => {
      setConfirming(false);
      toast.error("Could not refund", err.message);
    },
  });

  const status = STATUS_LABEL[order.paymentStatus] ?? STATUS_LABEL.unpaid!;
  const online = order.paymentMethod === "online";
  const refundable = Number(order.refundable);
  const typed = amount.trim();
  const amountValid = typed === "" || (/^\d{1,13}(\.\d{1,2})?$/.test(typed) && Number(typed) >= 1 && Number(typed) <= refundable + 0.0001);
  const refundAmount = typed === "" ? order.refundable : typed;

  return (
    <div data-testid="store-order-payment">
      <p className="text-2xs font-medium text-text-tertiary uppercase tracking-wide mb-2">Payment</p>
      <div className="card rounded-xl border border-border-light bg-surface-1 p-4 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-text-primary">{online ? "Paid online (Razorpay)" : "Cash on Delivery"}</p>
          <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-2xs font-medium", status.classes)} data-testid="payment-status">
            {status.label}
          </span>
        </div>
        {online && order.paymentStatus === "unpaid" && (
          <p className="text-xs text-text-tertiary">Waiting for the shopper to pay. Their order page has a Pay again button, and you will be able to see the payment here once it arrives.</p>
        )}
        {!online && <p className="text-xs text-text-tertiary">Record the cash against the order&apos;s invoice when it is collected.</p>}
        {order.paidAt && (
          <div className="flex items-center justify-between pt-1 border-t border-border-light">
            <span className="text-2xs text-text-tertiary">Paid on</span>
            <span className="text-xs text-text-secondary">{formatDate(order.paidAt)}</span>
          </div>
        )}
        {order.razorpayPayments.map((p) => (
          <div key={p.razorpayPaymentId} className="flex items-center justify-between gap-3" data-testid="razorpay-payment">
            <span className="text-2xs text-text-tertiary">
              Razorpay payment{p.method ? ` (${p.method})` : ""}
            </span>
            <span className="text-xs font-mono text-text-secondary text-right">
              {p.razorpayPaymentId} · {formatCurrency(p.amount)}
              {p.fee ? ` · fee ${formatCurrency(p.fee)}` : ""}
            </span>
          </div>
        ))}
        {order.refunds.filter((r) => r.status === "processed").map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-3" data-testid="store-refund">
            <span className="text-2xs text-text-tertiary">Refunded {formatDate(r.createdAt)}{r.reason ? `: ${r.reason}` : ""}</span>
            <span className="text-xs font-mono text-text-secondary">{formatCurrency(r.amount)}</span>
          </div>
        ))}
        {Number(order.refundedAmount) > 0 && (
          <div className="flex items-center justify-between pt-1 border-t border-border-light">
            <span className="text-2xs text-text-tertiary">Total refunded</span>
            <span className="text-xs font-medium text-text-primary">{formatCurrency(order.refundedAmount)}</span>
          </div>
        )}

        {online && refundable > 0 && canRefund && !open && (
          <button className="btn-secondary mt-1 px-3 py-1.5 text-xs" onClick={() => setOpen(true)}>
            Refund…
          </button>
        )}
        {online && refundable > 0 && !canRefund && (
          <p className="text-xs text-text-tertiary">Only an owner or admin can refund a payment.</p>
        )}

        {open && (
          <form
            className="mt-2 space-y-3 border-t border-border-light pt-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (amountValid) setConfirming(true);
            }}
          >
            <div>
              <label htmlFor="refund-amount" className="block text-xs font-medium text-text-secondary mb-1">
                Amount to refund (up to {formatCurrency(order.refundable)})
              </label>
              <input
                id="refund-amount"
                className="input"
                inputMode="decimal"
                value={amount}
                onChange={(e) => { setAmount(e.target.value); setKey(newKey()); }}
                placeholder={`${order.refundable} (everything left)`}
                aria-invalid={!amountValid}
              />
              {!amountValid && <p className="mt-1 text-2xs text-red-600">Enter an amount from 1.00 up to {order.refundable}.</p>}
            </div>
            <div>
              <label htmlFor="refund-reason" className="block text-xs font-medium text-text-secondary mb-1">Reason (optional)</label>
              <input id="refund-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
            </div>
            <div className="flex gap-2">
              <button type="submit" className="btn-primary px-3 py-1.5 text-xs" disabled={!amountValid || refund.isPending}>
                Review refund
              </button>
              <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
          </form>
        )}
      </div>

      <ConfirmDialog
        open={confirming}
        title={`Refund ${formatCurrency(refundAmount)}?`}
        description={`This sends ${formatCurrency(refundAmount)} back to the shopper through your Razorpay account and records a credit note. It cannot be undone.`}
        confirmLabel="Refund"
        variant="danger"
        loading={refund.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={() =>
          refund.mutate({
            orderId: order.id,
            amount: typed === "" ? undefined : typed,
            reason: reason.trim() || undefined,
            idempotencyKey: key,
          })
        }
      />
    </div>
  );
}
