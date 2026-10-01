import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { POSStore, usePOSSelector } from "./state";
import { useScanner } from "./useScanner";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";
import { ItemGrid, type POSTile } from "./ItemGrid";
import { Cart } from "./Cart";
import { CustomerPicker } from "./CustomerPicker";
import { PaymentSheet } from "./PaymentSheet";
import { ReceiptPrinter } from "./ReceiptPrinter";

interface Props {
  businessId: string;
  walkInPartyId: string;
}

/**
 * POS fullscreen shell — layout + keyboard + scanner + cross-tab stock
 * broadcast. Owns a single `POSStore` instance for this tab's lifetime.
 */
export function POSShell({ businessId, walkInPartyId }: Props) {
  const navigate = useNavigate();
  const shellRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [search, setSearch] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [printInvoiceId, setPrintInvoiceId] = useState<string | null>(null);

  // Store is tied to businessId — recreate if the active business changes.
  const store = useMemo(
    () => new POSStore(businessId, walkInPartyId),
    [businessId, walkInPartyId],
  );

  const carts = usePOSSelector(store, (s) => s.carts);
  const activeCartId = usePOSSelector(store, (s) => s.activeCartId);
  const activeCart = carts.find((c) => c.id === activeCartId);

  const utils = trpc.useUtils();

  // ── Cross-tab coordination ─────────────────────────────────────
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(`pos:${businessId}`);
    channel.onmessage = (ev) => {
      if (!ev.data) return;
      // Another tab finalised a sale — invalidate stock/listings.
      if (ev.data.type === "invoice:finalized") {
        utils.item.list.invalidate();
        utils.pos.catalog.invalidate();
      }
    };
    return () => channel.close();
  }, [businessId, utils]);

  const broadcast = (payload: unknown) => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(`pos:${businessId}`);
    try {
      channel.postMessage(payload);
    } finally {
      channel.close();
    }
  };

  // ── Scanner ────────────────────────────────────────────────────
  const handleScan = async (scanned: string) => {
    // Resolve the code to an item first: it may be a box / carton code that
    // stands for several pieces, which catalogue search can't know. Then pick
    // that item's tile from the catalogue for price, tax and unit.
    //
    // A scan made with the search box focused typed the code into it too.
    // If the box holds more than the code and the whole of it is a known
    // code, the detector caught only the tail of a burst (its first keys
    // came in slowly): use the whole. Either way take what was scanned back
    // out of the box now (before the lookup, so a second scan right after is
    // not appended to it), or the grid filters on the barcode.
    const typed = searchRef.current?.value.trim() ?? "";
    const whole =
      typed !== scanned && typed.endsWith(scanned)
        ? await utils.item.lookupByCode.fetch({ code: typed }).catch(() => null)
        : null;
    const code = whole ? typed : scanned;
    setSearch((s) => (s.trim().endsWith(code) ? s.trim().slice(0, -code.length) : s));
    try {
      const hit = whole ?? (await utils.item.lookupByCode.fetch({ code }));
      const search = hit
        ? (hit.variant?.barcode ?? hit.item.barcode ?? hit.item.sku ?? hit.item.name)
        : code;
      const data = await utils.pos.catalog.fetch({ search, page: 1, limit: 20 });
      const tiles = data?.tiles ?? [];
      const tile = hit
        ? tiles.find((t) => t.itemId === hit.item.id && (t.variantId ?? null) === (hit.variant?.id ?? null)) ?? tiles[0]
        : tiles[0];
      if (!tile) {
        toast.error("No item found", `Scan: ${code}`);
        return;
      }
      handlePickItem(tile, hit?.packQty ?? 1);
    } catch (err) {
      toast.error("Scanner lookup failed", err instanceof Error ? err.message : String(err));
    }
  };
  useScanner(shellRef, handleScan);

  // ── Keyboard shortcuts ─────────────────────────────────────────
  const shortcuts = useMemo(
    () => [
      { combo: "F2", handler: () => searchRef.current?.focus() },
      { combo: "F3", handler: () => setPickerOpen(true) },
      { combo: "F9", handler: () => setPaymentOpen(true) },
      { combo: "F6", handler: () => store.parkActive(walkInPartyId, "Walk-in Customer") },
      { combo: "Escape", handler: () => {
        setPickerOpen(false);
        setPaymentOpen(false);
      }},
      ...[1, 2, 3, 4, 5].map((n) => ({
        combo: `Alt+${n}`,
        handler: () => {
          const target = carts[n - 1];
          if (target) store.resumeCart(target.id);
        },
      })),
    ],
    [carts, store, walkInPartyId],
  );
  useKeyboardShortcuts(shellRef, shortcuts);

  // The scanner and the shortcuts listen on the shell. When the payment sheet
  // or customer picker closes, the button that had focus is gone and focus
  // falls to <body>, outside the shell: take it back, or the next scan and
  // F9 go nowhere. (The shell, not the search box, so a phone's keyboard
  // does not pop up after every sale.)
  useEffect(() => {
    if (paymentOpen || pickerOpen) return;
    const active = document.activeElement;
    if (!active || active === document.body) shellRef.current?.focus({ preventScroll: true });
  }, [paymentOpen, pickerOpen]);

  // ── Tile → cart handler ────────────────────────────────────────
  // Matches the tile's composite identity (item + variant OR item + unit)
  // so two different alt-units of the same item don't merge into one line.
  const handlePickItem = (tile: POSTile, pieces = 1) => {
    store.addOrBumpLine(
      { itemId: tile.itemId, variantId: tile.variantId, unit: tile.unit },
      {
        itemId: tile.itemId,
        variantId: tile.variantId,
        itemName: tile.displayName,
        quantity: String(pieces),
        unit: tile.unit,
        unitPrice: tile.unitPrice,
        taxPercent: tile.taxPercent,
        discountPercent: "0",
        conversionFactor: tile.conversionFactor,
      },
    );
  };

  const handleCustomerPick = (p: { id: string; name: string }) => {
    store.setCustomer(p.id, p.name);
    setPickerOpen(false);
  };

  const handleFinalized = (invoiceId: string, invoiceNumber: string) => {
    setPaymentOpen(false);
    // Print receipt (fire-and-forget)
    setPrintInvoiceId(invoiceId);
    // Drop the finalised cart and start a fresh one
    if (activeCart) {
      store.removeCart(activeCart.id, walkInPartyId, "Walk-in Customer");
    }
    // The tiles' "in stock" counts are stale now, here and in other tabs
    // (a BroadcastChannel does not deliver to its own tab).
    utils.pos.catalog.invalidate();
    utils.item.list.invalidate();
    broadcast({ type: "invoice:finalized", invoiceId });
    toast.success("Sale complete", `Invoice ${invoiceNumber || invoiceId.slice(0, 8)}`);
  };

  return (
    <div
      ref={shellRef}
      tabIndex={-1}
      data-testid="pos-shell"
      className="fixed inset-0 flex flex-col bg-surface-0 text-text-primary outline-none"
    >
      {/* Top bar */}
      {/* On a phone the search box takes its own row under the buttons. */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 border-b border-border bg-surface-1">
        <button
          type="button"
          onClick={() => navigate({ to: "/invoices" })}
          className="text-xs text-text-tertiary hover:text-text-primary"
          aria-label="Exit POS"
        >
          ← Exit
        </button>
        <div className="text-sm font-semibold">POS Register</div>
        <div className="order-last basis-full md:order-none md:basis-0 md:flex-1">
          <input
            ref={searchRef}
            type="search"
            className="w-full max-w-md px-3 py-1.5 rounded border border-border bg-surface-2 text-sm"
            placeholder="Search item — F2, or scan barcode"
            aria-label="Search item or scan barcode"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              // Enter on a code typed by hand (a label the scanner can't
              // read), or a scan the timing detector missed because the
              // keys arrived slowly: look it up like a scan. A burst the
              // detector did catch never gets here (it stops the Enter).
              const code = search.trim();
              if (e.key !== "Enter" || !code) return;
              e.preventDefault();
              void handleScan(code);
            }}
          />
        </div>
        <button
          type="button"
          className="px-3 py-1.5 rounded border border-border bg-surface-2 hover:bg-surface-3 text-sm"
          onClick={() => setPickerOpen(true)}
          aria-label={`Customer: ${activeCart?.partyName ?? "Walk-in"} (F3 to change)`}
        >
          {activeCart?.partyName ?? "Walk-in"}{" "}
          <span className="text-text-tertiary text-xs ml-1">F3</span>
        </button>
        <button
          type="button"
          className="px-3 py-1.5 rounded border border-border bg-surface-2 hover:bg-surface-3 text-sm"
          onClick={() => store.parkActive(walkInPartyId, "Walk-in Customer")}
          title="Hold current sale and start a new one (F6)"
        >
          Hold <span className="text-text-tertiary text-xs ml-1">F6</span>
        </button>
      </header>

      {/* Parked tabs strip — always rendered so the layout doesn't shift
          when a cashier parks their first sale. The active cart is shown
          as a selected tab; a "+ Hold" affordance sits alongside so the
          park concept is discoverable without having used it first. */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-border bg-surface-1 overflow-x-auto min-h-[48px]">
        {carts.map((c, idx) => (
          <button
            key={c.id}
            type="button"
            onClick={() => store.resumeCart(c.id)}
            className={`h-9 px-3 rounded-md text-xs whitespace-nowrap transition-colors flex items-center gap-2 ${
              c.id === activeCartId
                ? "bg-brand-600 text-white"
                : "bg-surface-2 hover:bg-surface-3 text-text-secondary"
            }`}
          >
            <span className={c.id === activeCartId ? "opacity-80" : "opacity-60"}>
              Alt+{idx + 1}
            </span>
            <span className="font-medium">{c.partyName}</span>
            <span className="opacity-70">· {c.lineItems.length}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => store.parkActive(walkInPartyId, "Walk-in Customer")}
          className="h-9 px-3 rounded-md text-xs whitespace-nowrap border border-dashed border-border text-text-tertiary hover:text-text-secondary hover:border-text-tertiary flex items-center gap-1"
          title="Hold current sale and start a new one (F6)"
          disabled={carts.length >= 5}
        >
          + Hold <span className="opacity-60">F6</span>
        </button>
      </div>

      {/* Main two-pane */}
      {/* Item grid beside the cart; on a phone the cart sits under the grid. */}
      <main className="flex-1 flex flex-col md:flex-row min-h-0">
        <section className="flex-1 min-w-0 min-h-0 overflow-y-auto" aria-label="Items">
          <ItemGrid search={search} onPick={(t) => handlePickItem(t)} />
        </section>
        <aside className="h-[55%] md:h-auto md:w-[360px] flex-shrink-0 flex flex-col min-h-0 border-t border-border md:border-t-0" aria-label="Cart">
          <Cart store={store} />
        </aside>
      </main>

      {/* Bottom pay bar */}
      <footer className="border-t border-border bg-surface-1 px-4 py-3 flex items-center gap-3">
        <div className="hidden md:block text-xs text-text-tertiary">
          F2 search · F3 customer · F6 hold · F9 pay · Alt+1..5 switch
        </div>
        <div className="flex-1" />
        <button
          type="button"
          className="btn-primary px-6 py-2.5 text-base"
          onClick={() => setPaymentOpen(true)}
          disabled={!activeCart || activeCart.lineItems.length === 0}
        >
          Pay · F9
        </button>
      </footer>

      <CustomerPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={handleCustomerPick}
        walkIn={{ id: walkInPartyId, name: "Walk-in Customer" }}
      />
      {activeCart && (
        <PaymentSheet
          open={paymentOpen}
          cart={activeCart}
          onClose={() => setPaymentOpen(false)}
          onFinalized={handleFinalized}
        />
      )}
      <ReceiptPrinter
        invoiceId={printInvoiceId}
        onDone={() => setPrintInvoiceId(null)}
      />
    </div>
  );
}
