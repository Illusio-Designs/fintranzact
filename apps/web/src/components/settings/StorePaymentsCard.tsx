/**
 * Settings, Online Store: how shoppers pay at checkout. The store reuses the
 * business's own Razorpay connection (Settings, Online payments), so there is
 * nothing to connect twice: this card shows that connection's state and holds
 * the two store-specific switches, Pay online and Cash on Delivery. Money goes
 * straight to the business's Razorpay account; the keys never reach this page.
 */
import { Link } from "@tanstack/react-router";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";

interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}

function Switch({ checked, onChange, label, disabled }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
        checked ? "bg-brand-600" : "bg-border-light dark:bg-surface-3",
        disabled && "opacity-50 cursor-not-allowed",
      )}
    >
      <span
        className={cn(
          "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm ring-0 transition-transform",
          checked ? "translate-x-5" : "translate-x-0",
        )}
      />
    </button>
  );
}

export function StorePaymentsCard() {
  const utils = trpc.useUtils();
  const { data: settings, isLoading } = trpc.store.getSettings.useQuery();

  const update = trpc.store.updateSettings.useMutation({
    onSuccess: () => {
      utils.store.getSettings.invalidate();
      toast.success("Payment options saved");
    },
    onError: (err) => toast.error("Could not save", err.message),
  });

  if (isLoading || !settings) return <div className="skeleton mt-6 h-40 rounded-xl" />;

  const { payments } = settings;
  const ready = payments.connected && payments.hasWebhookSecret;

  return (
    <div className="card mt-6 p-6" data-testid="store-payments-card">
      <h3 className="text-sm font-semibold text-text-primary">Payments at checkout</h3>
      <p className="mt-1 text-xs text-text-tertiary">
        Choose how shoppers can pay. Online payments (UPI, cards and net banking) go straight to your own Razorpay account, not through Fintranzact.
      </p>

      {/* The business's Razorpay connection: the same one that takes invoice payments. */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-1 px-4 py-3" data-testid="store-payments-connection">
        <div className="text-sm">
          {payments.connected ? (
            <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-400">
              <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
              Razorpay connected
              <span className="font-normal text-text-tertiary">
                {payments.mode === "live" ? "(live mode)" : "(test mode: no real money)"}
              </span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 font-medium text-text-secondary">
              <span className="h-2 w-2 rounded-full bg-text-tertiary" aria-hidden />
              Razorpay is not connected
            </span>
          )}
        </div>
        <Link to="/settings" search={{ tab: "payments" }} className="btn-secondary px-3 py-1.5 text-xs">
          {payments.connected ? "Manage in Online payments" : "Connect Razorpay"}
        </Link>
      </div>

      {payments.connected && !payments.hasWebhookSecret && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300" role="alert">
          Add your Razorpay webhook secret in Settings, Online payments. Until then a payment cannot be recorded, so Pay online stays off.
        </p>
      )}

      <div className="mt-5 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-text-primary">Pay online</p>
          <p className="text-xs text-text-tertiary">
            {ready
              ? "Shoppers pay with UPI, cards or net banking on Razorpay's secure page."
              : "Connect Razorpay and add its webhook secret to switch this on."}
          </p>
        </div>
        <Switch
          label="Accept online payments at checkout"
          checked={settings.storeOnlinePaymentsEnabled}
          disabled={update.isPending || (!ready && !settings.storeOnlinePaymentsEnabled)}
          onChange={(next) => update.mutate({ storeOnlinePaymentsEnabled: next })}
        />
      </div>

      <div className="mt-4 flex items-center justify-between gap-4 border-t border-border-light pt-4">
        <div>
          <p className="text-sm font-medium text-text-primary">Cash on Delivery</p>
          <p className="text-xs text-text-tertiary">Shoppers pay in cash when the order arrives. You record the cash on the invoice.</p>
        </div>
        <Switch
          label="Offer Cash on Delivery"
          checked={settings.storeCodEnabled}
          disabled={update.isPending}
          onChange={(next) => update.mutate({ storeCodEnabled: next })}
        />
      </div>

      {settings.storeOnlinePaymentsEnabled && !payments.onlineActive && (
        <p className="mt-3 text-xs text-amber-700 dark:text-amber-400" role="status">
          Online payment is switched on but your Razorpay connection is not ready, so shoppers do not see it yet.
        </p>
      )}

      <p className="mt-4 text-xs text-text-tertiary" data-testid="store-payments-webhook-note">
        Paid orders are recorded by the same webhook you set up for invoice payments in Settings, Online payments. There is nothing more to add in Razorpay.
      </p>
    </div>
  );
}
