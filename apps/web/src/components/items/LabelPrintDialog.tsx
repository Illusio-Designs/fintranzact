import { useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { InputField } from "@/components/ui/FormField";
import { Listbox } from "@/components/ui/Listbox";
import { Spinner } from "@/components/ui/Spinner";
import { apiUrl } from "@/lib/api-url";
import { getBusinessId } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";

/**
 * LabelPrintDialog — pick quantities, then print barcode labels.
 *
 * The sheet is rendered server-side as a PDF and printed from a hidden
 * iframe, the same approach the POS receipt printer uses: `window.print()`
 * on the page itself would print the whole app, and an iframe isolates the
 * print context. The request carries only ids and counts — every printed
 * value is read from the catalogue on the server, so nothing here can put
 * arbitrary text on a label.
 */

export interface LabelCandidate {
  itemId: string;
  variantId?: string;
  name: string;
  barcode: string | null;
  variantLabel?: string;
}

const PRESETS = [
  { value: "a4_21", label: "A4 sheet — 21 labels (63.5 × 38.1 mm)" },
  { value: "a4_65", label: "A4 sheet — 65 labels (38.1 × 21.2 mm)" },
  { value: "roll_50x25", label: "Thermal roll — 50 × 25 mm" },
];

interface Props {
  open: boolean;
  onClose: () => void;
  candidates: LabelCandidate[];
}

export function LabelPrintDialog({ open, onClose, candidates }: Props) {
  const [presetId, setPresetId] = useState("a4_21");
  const [showPrice, setShowPrice] = useState(true);
  const [showName, setShowName] = useState(true);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  // Anything without a barcode cannot be printed. Splitting them out here
  // means the dialog can say so up front rather than silently shipping a
  // short sheet.
  const printable = useMemo(
    () => candidates.filter((c) => !!c.barcode?.trim()),
    [candidates],
  );
  const missing = useMemo(
    () => candidates.filter((c) => !c.barcode?.trim()),
    [candidates],
  );

  const keyOf = (c: LabelCandidate) => c.variantId ?? c.itemId;

  useEffect(() => {
    if (!open) return;
    setQuantities(Object.fromEntries(printable.map((c) => [keyOf(c), "1"])));
  }, [open, printable]);

  useEffect(() => {
    return () => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, []);

  const totalLabels = printable.reduce(
    (sum, c) => sum + (parseInt(quantities[keyOf(c)] || "0", 10) || 0),
    0,
  );

  async function handlePrint() {
    const lines = printable
      .map((c) => ({
        itemId: c.itemId,
        variantId: c.variantId,
        quantity: parseInt(quantities[keyOf(c)] || "0", 10) || 0,
      }))
      .filter((l) => l.quantity > 0);

    if (lines.length === 0) {
      toast.error("Nothing to print", "Set a quantity of at least one.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(apiUrl("/api/items/labels"), {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-business-id": getBusinessId() || "",
        },
        body: JSON.stringify({ presetId, showPrice, showName, lines }),
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
          const skipped: Array<{ name: string; reason: string }> = JSON.parse(
            decodeURIComponent(skippedHeader),
          );
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
      iframe.onload = () => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } catch {
          // Pop-up blockers and sandboxed frames can refuse; the PDF is
          // still loaded, so fall back to opening it in a tab.
          window.open(url, "_blank", "noopener");
        }
      };
      iframe.src = url;
    } catch (err) {
      toast.error(
        "Could not print labels",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Print barcode labels" className="max-w-2xl">
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <Listbox
            label="Label stock"
            value={presetId}
            onChange={setPresetId}
            options={PRESETS}
          />

          <div className="space-y-2 pt-6">
            <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={showName}
                onChange={(e) => setShowName(e.target.checked)}
                className="switch"
                role="switch"
              />
              Show product name
            </label>
            <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={showPrice}
                onChange={(e) => setShowPrice(e.target.checked)}
                className="switch"
                role="switch"
              />
              Show price
            </label>
          </div>
        </div>

        {printable.length > 0 && (
          <div className="rounded-xl border border-border-light overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-surface-2">
                <tr>
                  <th className="text-left px-3 py-2 text-[11px] font-semibold text-text-tertiary uppercase tracking-wider">
                    Item
                  </th>
                  <th className="text-left px-3 py-2 text-[11px] font-semibold text-text-tertiary uppercase tracking-wider">
                    Barcode
                  </th>
                  <th className="text-right px-3 py-2 text-[11px] font-semibold text-text-tertiary uppercase tracking-wider w-28">
                    Labels
                  </th>
                </tr>
              </thead>
              <tbody>
                {printable.map((c) => (
                  <tr key={keyOf(c)} className="border-t border-border-light">
                    <td className="px-3 py-2 text-text-primary">
                      {c.name}
                      {c.variantLabel && (
                        <span className="text-text-tertiary"> · {c.variantLabel}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-text-secondary">
                      {c.barcode}
                    </td>
                    <td className="px-3 py-2">
                      <InputField
                        label=""
                        type="number"
                        min="0"
                        max="500"
                        value={quantities[keyOf(c)] ?? "1"}
                        onChange={(e) =>
                          setQuantities((q) => ({ ...q, [keyOf(c)]: e.target.value }))
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {missing.length > 0 && (
          <p className="text-xs text-text-tertiary">
            {missing.length} selected item{missing.length === 1 ? " has" : "s have"} no
            barcode and cannot be printed. Add one on the item, or receive it on a
            purchase to have one generated.
          </p>
        )}

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-text-tertiary">
            {totalLabels} label{totalLabels === 1 ? "" : "s"} will print.
          </p>
          <div className="flex gap-3">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={handlePrint}
              disabled={busy || totalLabels === 0}
            >
              {busy ? <Spinner size="sm" /> : "Print"}
            </button>
          </div>
        </div>
      </div>

      {/* Isolated print context — see the component doc comment. */}
      <iframe ref={iframeRef} title="Label print" className="hidden" />
    </Modal>
  );
}
