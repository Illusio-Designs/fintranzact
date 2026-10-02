import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { apiUrl } from "@/lib/api-url";
import { getBusinessId } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { cn, formatDate } from "@/lib/utils";
import { SlideOver } from "@/components/ui/SlideOver";
import { Listbox } from "@/components/ui/Listbox";
import { Spinner } from "@/components/ui/Spinner";
import { BARCODE_TYPE_NAMES, BarcodeSymbol, useBarcodeSetup } from "@/components/barcodes/BarcodeSymbol";

/**
 * Print barcode labels from a side panel: copies of one item, a few items at
 * once, or one label per piece received on a purchase bill.
 *
 * The label size is fixed by the business's barcode type (Settings →
 * Barcodes), so there is nothing to choose here. The PDF comes back at the
 * exact label size and prints through the computer's own print window, which
 * lists every printer installed on the machine.
 */

export interface LabelCandidate {
  itemId: string;
  variantId?: string;
  name: string;
  barcode: string | null;
  variantLabel?: string;
}

export type LabelMode = "one" | "many" | "bill";

interface Line {
  key: string;
  itemId: string;
  variantId?: string;
  name: string;
  barcode: string | null;
  note?: string;
  quantity: number;
}

const keyOf = (c: { itemId: string; variantId?: string | null }) => `${c.itemId}:${c.variantId ?? ""}`;

export function LabelPrintPanel({
  open,
  onClose,
  candidates,
  initialMode = "many",
  initialItemKey,
}: {
  open: boolean;
  onClose: () => void;
  /** Items the "One item" and "Many items" tabs choose from. */
  candidates: LabelCandidate[];
  initialMode?: LabelMode;
  /** Pre-selects the item on the "One item" tab. */
  initialItemKey?: string;
}) {
  const { data: setup } = useBarcodeSetup();
  const [mode, setMode] = useState<LabelMode>(initialMode);
  const [oneKey, setOneKey] = useState("");
  const [billId, setBillId] = useState("");
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [showName, setShowName] = useState(true);
  const [showPrice, setShowPrice] = useState(true);
  const [busy, setBusy] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    setOneKey(initialItemKey ?? (candidates[0] ? keyOf(candidates[0]) : ""));
    setQuantities({});
    setBillId("");
  }, [open, initialMode, initialItemKey, candidates]);

  useEffect(
    () => () => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    },
    [],
  );

  const { data: bills } = trpc.invoice.list.useQuery(
    { type: "purchase", page: 1, limit: 20 },
    { enabled: open && mode === "bill" },
  );
  const { data: bill } = trpc.invoice.getById.useQuery({ id: billId }, { enabled: open && mode === "bill" && !!billId });

  const baseLines: Line[] = useMemo(() => {
    if (mode === "one") {
      const c = candidates.find((x) => keyOf(x) === oneKey);
      return c ? [{ ...c, key: keyOf(c), quantity: 1 }] : [];
    }
    if (mode === "many") {
      return candidates.map((c) => ({ ...c, key: keyOf(c), quantity: 1 }));
    }
    const rows = (bill?.lineItems ?? []) as Array<{
      itemId: string | null;
      variantId: string | null;
      itemName?: string | null;
      description?: string | null;
      quantity: string;
      conversionFactor?: string | null;
    }>;
    const merged = new Map<string, Line>();
    for (const r of rows) {
      if (!r.itemId) continue;
      const pieces = Math.round(parseFloat(r.quantity) * parseFloat(r.conversionFactor || "1"));
      const key = keyOf({ itemId: r.itemId, variantId: r.variantId });
      const prev = merged.get(key);
      merged.set(key, {
        key,
        itemId: r.itemId,
        variantId: r.variantId ?? undefined,
        name: r.itemName || r.description || "Item",
        barcode: null,
        note: `Received ${pieces}`,
        quantity: (prev?.quantity ?? 0) + Math.max(0, pieces),
      });
    }
    return [...merged.values()];
  }, [mode, candidates, oneKey, bill]);

  const lines = baseLines.map((l) => ({ ...l, quantity: quantities[`${mode}:${l.key}`] ?? l.quantity }));
  const printable = lines.filter((l) => mode === "bill" || !!l.barcode?.trim());
  const withoutCode = mode === "bill" ? [] : lines.filter((l) => !l.barcode?.trim());
  const total = printable.reduce((s, l) => s + Math.min(500, Math.max(0, l.quantity)), 0);
  const setQty = (l: Line, n: number) =>
    setQuantities((q) => ({ ...q, [`${mode}:${l.key}`]: Math.max(0, Math.min(500, Math.round(n) || 0)) }));

  async function handlePrint() {
    const body = printable
      .filter((l) => l.quantity > 0)
      .map((l) => ({ itemId: l.itemId, variantId: l.variantId, quantity: Math.min(500, l.quantity) }));
    if (body.length === 0) {
      toast.error("Nothing to print", "Set at least one label.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(apiUrl("/api/items/labels"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "x-business-id": getBusinessId() || "" },
        body: JSON.stringify({ showPrice, showName, lines: body }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => null);
        throw new Error(detail?.error || `Label request failed (${res.status})`);
      }
      // The server reports anything it had to drop, so a partial run never
      // looks like a complete one.
      const skippedHeader = res.headers.get("X-Labels-Skipped");
      if (skippedHeader) {
        try {
          const skipped: Array<{ name: string; reason: string }> = JSON.parse(decodeURIComponent(skippedHeader));
          if (skipped.length > 0) {
            toast.error(
              `${skipped.length} label${skipped.length === 1 ? "" : "s"} skipped`,
              skipped.map((s) => `${s.name}: ${s.reason}`).join("; "),
            );
          }
        } catch {
          // A malformed header must not block the print.
        }
      }
      const blob = await res.blob();
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;
      const iframe = iframeRef.current;
      if (!iframe) return;
      // An iframe isolates the print: window.print() on the page would print
      // the whole app. The print window that opens lists the computer's printers.
      iframe.onload = () => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } catch {
          window.open(url, "_blank", "noopener");
        }
      };
      iframe.src = url;
    } catch (err) {
      toast.error("Could not print labels", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const sample = printable.find((l) => l.barcode)?.barcode ?? null;
  const size = setup?.label;

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title="Print labels"
      description={
        setup && size
          ? `${BARCODE_TYPE_NAMES[setup.type]} labels, ${size.width} × ${size.height} mm${size.across > 1 ? `, ${size.across} across` : ""} — set in Settings → Barcodes`
          : undefined
      }
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <p className="text-xs text-text-tertiary">Opens your computer's print window — pick the label printer there.</p>
          <div className="flex gap-3">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn-primary" onClick={handlePrint} disabled={busy || total === 0}>
              {busy ? <Spinner size="sm" /> : `Print ${total} label${total === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        <div role="tablist" aria-label="What to print" className="inline-flex rounded-lg bg-surface-2 p-1 text-sm font-semibold">
          {(
            [
              ["one", "One item"],
              ["many", "Many items"],
              ["bill", "From a purchase bill"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              onClick={() => setMode(value)}
              className={cn(
                "rounded-md px-3 py-1.5",
                mode === value ? "bg-surface-0 text-text-primary shadow-sm" : "text-text-tertiary",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === "one" && (
          <Listbox
            label="Item"
            value={oneKey}
            onChange={setOneKey}
            options={candidates.map((c) => ({
              value: keyOf(c),
              label: c.variantLabel ? `${c.name} · ${c.variantLabel}` : c.name,
              description: c.barcode ?? "No barcode",
            }))}
            placeholder="Choose an item"
          />
        )}
        {mode === "bill" && (
          <Listbox
            label="Purchase bill"
            value={billId}
            onChange={setBillId}
            options={(bills?.data ?? []).map((b) => ({
              value: b.id,
              label: `${b.invoiceNumber} · ${(b as { partyName?: string | null }).partyName ?? ""}`.trim(),
              description: formatDate(b.invoiceDate),
            }))}
            placeholder="Choose a recent purchase"
          />
        )}
        <p className="text-xs text-text-tertiary">
          {mode === "one" && "Any number of copies of a single item — e.g. to re-label a shelf."}
          {mode === "many" && "The items shown on the Stock items page (use search or the low-stock filter to narrow them), with a count for each."}
          {mode === "bill" && "One label per piece received on the bill, filled in for you. Items without a code are skipped and listed."}
        </p>

        {printable.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-border-light">
            <table className="w-full text-sm">
              <thead className="bg-surface-2">
                <tr>
                  <th className="px-3 py-2 text-left text-2xs font-semibold uppercase tracking-wider text-text-tertiary">Item</th>
                  <th className="w-32 px-3 py-2 text-right text-2xs font-semibold uppercase tracking-wider text-text-tertiary">Labels</th>
                </tr>
              </thead>
              <tbody>
                {printable.map((l) => (
                  <tr key={l.key} className="border-t border-border-light">
                    <td className="px-3 py-2">
                      <p className="text-text-primary">
                        {l.name}
                        {"variantLabel" in l && (l as LabelCandidate).variantLabel && (
                          <span className="text-text-tertiary"> · {(l as LabelCandidate).variantLabel}</span>
                        )}
                      </p>
                      <p className="font-mono text-xs text-text-tertiary">{l.barcode ?? l.note}</p>
                    </td>
                    <td className="px-3 py-2">
                      <div className="ml-auto flex h-9 w-28 items-center rounded-lg border border-border">
                        <button type="button" aria-label={`Fewer labels for ${l.name}`} className="h-full w-8 text-text-secondary" onClick={() => setQty(l, l.quantity - 1)}>
                          −
                        </button>
                        <input
                          className="w-full min-w-0 bg-transparent text-center text-sm font-semibold tabular-nums outline-none"
                          inputMode="numeric"
                          aria-label={`Labels for ${l.name}`}
                          value={l.quantity}
                          onChange={(e) => setQty(l, parseInt(e.target.value, 10))}
                        />
                        <button type="button" aria-label={`More labels for ${l.name}`} className="h-full w-8 text-text-secondary" onClick={() => setQty(l, l.quantity + 1)}>
                          +
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {withoutCode.length > 0 && (
          <p className="text-xs text-text-tertiary">
            {withoutCode.length} item{withoutCode.length === 1 ? " has" : "s have"} no barcode and can't be printed:{" "}
            {withoutCode.slice(0, 5).map((l) => l.name).join(", ")}
            {withoutCode.length > 5 ? "…" : ""}. Add a code on the item, or receive it on a purchase to have one created.
          </p>
        )}

        <div className="flex flex-wrap gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-text-secondary">
            <input type="checkbox" className="switch" role="switch" checked={showName} onChange={(e) => setShowName(e.target.checked)} />
            Show product name
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-text-secondary">
            <input type="checkbox" className="switch" role="switch" checked={showPrice} onChange={(e) => setShowPrice(e.target.checked)} />
            Show price
          </label>
        </div>

        {sample && setup && (
          <div className="rounded-xl bg-surface-2 p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-tertiary">Preview</p>
            <div className="flex justify-center">
              <div className="flex items-center gap-2 rounded bg-white p-2 text-black shadow-sm">
                {setup.type === "qr" ? (
                  <>
                    <BarcodeSymbol code={sample} type="qr" width={80} height={80} showText={false} />
                    <div className="text-xs">
                      {showName && <p className="font-bold">{printable[0]?.name}</p>}
                      <p className="font-mono text-2xs">{sample}</p>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center">
                    {showName && <p className="text-xs font-bold">{printable[0]?.name}</p>}
                    <BarcodeSymbol code={sample} width={setup.type === "code128" ? 240 : 190} height={60} />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
      <iframe ref={iframeRef} title="Label print" className="hidden" />
    </SlideOver>
  );
}
