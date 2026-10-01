import { POSStore, usePOSSelector, computeCartTotals } from "./state";
import { useIntraState } from "./useIntraState";
import { Icon } from "@/components/ui/Icon";
import { Delete02Icon } from "@hugeicons/core-free-icons";

interface Props {
  store: POSStore;
}

function fmt(n: number): string {
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

/**
 * Right-pane cart for POS.
 *
 * Sized for touch: WCAG recommends ≥44px tap targets; Material Design
 * prefers 48px. These controls go to 44px minimum (the + / − buttons are
 * 48px to stand out as the primary interaction), which lets a cashier tap
 * them reliably with a finger or barcode scanner in hand without fat-
 * fingering the next line.
 */
export function Cart({ store }: Props) {
  const activeCart = usePOSSelector(store, (s) => s.carts.find((c) => c.id === s.activeCartId));
  const intraState = useIntraState(activeCart?.partyId ?? "");
  if (!activeCart) return null;

  const totals = computeCartTotals(activeCart.lineItems, intraState);

  return (
    <div className="flex flex-col h-full bg-surface-1 border-l border-border">
      <div className="flex-1 overflow-y-auto">
        {activeCart.lineItems.length === 0 ? (
          <div className="p-6 text-sm text-text-tertiary text-center">
            Scan or tap an item to start.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {activeCart.lineItems.map((li) => {
              const qty = parseFloat(li.quantity) || 0;
              const price = parseFloat(li.unitPrice) || 0;
              const lineTotal = qty * price * (1 - (parseFloat(li.discountPercent) || 0) / 100);
              return (
                <li key={li.lineId} className="px-3 py-4">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-[15px] font-semibold text-text-primary leading-tight">
                        {li.itemName}
                      </div>
                      <div className="text-xs text-text-tertiary mt-1 tabular-nums">
                        ₹{li.unitPrice} × {li.quantity} {li.unit}
                      </div>
                    </div>
                    <div className="text-right min-w-[88px]">
                      <div className="text-base font-bold tabular-nums">
                        ₹{fmt(lineTotal)}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="w-12 h-12 rounded-lg bg-surface-2 hover:bg-surface-3 active:bg-surface-3 text-2xl font-semibold flex items-center justify-center disabled:opacity-40"
                        onClick={() =>
                          store.updateLine(li.lineId, {
                            quantity: Math.max(1, qty - 1).toString(),
                          })
                        }
                        disabled={qty <= 1}
                        aria-label="Decrease quantity"
                      >
                        −
                      </button>
                      <span className="min-w-[3ch] text-center text-lg font-semibold tabular-nums">
                        {qty}
                      </span>
                      <button
                        type="button"
                        className="w-12 h-12 rounded-lg bg-surface-2 hover:bg-surface-3 active:bg-surface-3 text-2xl font-semibold flex items-center justify-center"
                        onClick={() =>
                          store.updateLine(li.lineId, {
                            quantity: (qty + 1).toString(),
                          })
                        }
                        aria-label="Increase quantity"
                      >
                        +
                      </button>
                    </div>

                    <button
                      type="button"
                      className="h-11 px-3 rounded-lg text-red-500 hover:bg-red-500/10 active:bg-red-500/20 text-sm font-medium flex items-center gap-2"
                      onClick={() => store.removeLine(li.lineId)}
                      aria-label={`Remove ${li.itemName} from cart`}
                    >
                      <Icon icon={Delete02Icon} size={16} />
                      Remove
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="border-t border-border p-4 space-y-1.5 bg-surface-0 text-sm">
        <div className="flex items-center justify-between text-text-secondary">
          <span>Subtotal</span>
          <span className="tabular-nums" data-testid="pos-cart-subtotal">₹{fmt(totals.subtotal)}</span>
        </div>
        {totals.discount > 0 && (
          <div className="flex items-center justify-between text-text-secondary">
            <span>Discount</span>
            <span className="tabular-nums">−₹{fmt(totals.discount)}</span>
          </div>
        )}
        <div className="flex items-center justify-between text-text-secondary">
          <span>Tax</span>
          <span className="tabular-nums" data-testid="pos-cart-tax">₹{fmt(totals.tax)}</span>
        </div>
        <div className="flex items-center justify-between text-lg font-bold text-text-primary pt-2 border-t border-border">
          <span>Total</span>
          <span className="tabular-nums" data-testid="pos-cart-total">₹{fmt(totals.total)}</span>
        </div>
      </div>
    </div>
  );
}
