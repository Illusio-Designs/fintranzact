/**
 * "Pay online" block for an invoice's detail panel: a Razorpay payment link
 * for the balance due, on the business's own Razorpay account. Shown only when
 * the business has connected Razorpay and the invoice can still be paid
 * online. The amount is always worked out on the server from the balance due.
 */
import { Copy01Icon, Link01Icon } from "@hugeicons/core-free-icons";
import { trpc } from "@/lib/trpc";
import { formatCurrency } from "@/lib/utils";
import { toast } from "@/hooks/useToast";
import { Icon } from "@/components/ui/Icon";

interface PaymentLinkSectionProps {
  invoiceId: string;
  /** e.g. "Invoice INV-001", used in the WhatsApp message. */
  documentLabel: string;
  /** The customer's phone, to open WhatsApp straight to their chat. */
  partyPhone?: string | null;
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function whatsappNumber(phone: string | null | undefined) {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  return digits.length >= 11 ? digits : "";
}

export function PaymentLinkSection({ invoiceId, documentLabel, partyPhone }: PaymentLinkSectionProps) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.onlinePayments.invoiceLink.useQuery({ invoiceId });

  const create = trpc.onlinePayments.createInvoiceLink.useMutation({
    onSuccess: async (made) => {
      await utils.onlinePayments.invoiceLink.invalidate({ invoiceId });
      toast.success((await copyText(made.url)) ? "Payment link copied" : "Payment link ready");
    },
    onError: (err) => toast.error("Could not make the payment link", err.message),
  });

  // Nothing to show until Razorpay is connected and the invoice can take a payment.
  if (isLoading || !data || !data.canPay) return null;

  const link = data.link;
  const stale = !!link && !link.current;
  const wa = link
    ? `https://wa.me/${whatsappNumber(partyPhone)}?text=${encodeURIComponent(`${documentLabel}: pay ${formatCurrency(link.amount)} online: ${link.url}`)}`
    : "";

  return (
    <div data-testid="payment-link-section">
      <p className="text-2xs font-medium text-text-tertiary uppercase tracking-wide mb-2">Pay online</p>
      {!link || stale ? (
        <div className="card p-3 flex items-center justify-between gap-3">
          <p className="text-xs text-text-secondary">
            {stale
              ? `The balance is now ${formatCurrency(data.balance)}. Make a new link for it.`
              : `Razorpay link for the balance due, ${formatCurrency(data.balance)}. Pays straight into your account.`}
          </p>
          <button
            onClick={() => create.mutate({ invoiceId })}
            disabled={create.isPending}
            className="shrink-0 inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-950 border border-brand-200 dark:border-brand-800 transition-colors disabled:opacity-50"
          >
            <Icon icon={Link01Icon} size={14} />
            {stale ? "New link" : "Get payment link"}
          </button>
        </div>
      ) : (
        <div className="card p-3 space-y-2">
          <div className="flex items-center gap-2">
            <input readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} aria-label="Payment link" className="input flex-1 min-w-0 text-xs font-mono" />
            <button
              onClick={async () => ((await copyText(link.url)) ? toast.success("Payment link copied") : toast.error("Could not copy the link"))}
              className="shrink-0 inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium text-text-secondary hover:bg-surface-2 border border-border-light transition-colors"
            >
              <Icon icon={Copy01Icon} size={14} />
              Copy
            </button>
            <a href={wa} target="_blank" rel="noopener noreferrer" className="shrink-0 text-xs px-3 py-1.5 rounded-lg font-medium text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 transition-colors">
              WhatsApp
            </a>
            <a href={link.url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-xs px-3 py-1.5 rounded-lg font-medium text-text-secondary hover:bg-surface-2 border border-border-light transition-colors">
              Open
            </a>
          </div>
          <p className="text-2xs text-text-tertiary">Asks for {formatCurrency(link.amount)}, the balance due. A part payment is accepted and recorded automatically.</p>
        </div>
      )}
    </div>
  );
}
