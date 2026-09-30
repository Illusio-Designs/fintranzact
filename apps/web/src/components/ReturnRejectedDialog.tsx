/**
 * Send goods a GRN rejected back to the supplier on a purchase return or a
 * debit note. Rejected goods never came into stock, so neither moves stock.
 */
import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { cn, getDocumentTypeLabel } from "@/lib/utils";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { toast } from "@/hooks/useToast";
import { formatQty } from "@/components/inventory/shared";

type Target = "purchase_return" | "debit_note";

const TARGETS: Array<{ type: Target; label: string; hint: string }> = [
  { type: "purchase_return", label: "Purchase Return", hint: "Records the goods going back to the supplier." },
  { type: "debit_note", label: "Debit Note", hint: "Claims the value back when the supplier has billed the rejected goods." },
];

export function ReturnRejectedDialog({ grnId, onClose }: { grnId: string; onClose: () => void }) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.orders.fulfilment.useQuery({ id: grnId });
  const [target, setTarget] = useState<Target>("purchase_return");
  const [qty, setQty] = useState<Record<string, string>>({});

  const rows = (data?.rejections ?? []).filter((r) => r.open > 0);

  useEffect(() => {
    if (!data) return;
    setQty(Object.fromEntries(data.rejections.map((r) => [r.lineId, r.open > 0 ? String(r.open) : "0"])));
  }, [data]);

  const convert = trpc.document.convert.useMutation({
    onSuccess: (res) => {
      toast.success(`${getDocumentTypeLabel(res.documentType)} ${res.invoiceNumber} created`);
      utils.purchaseReturn.list.invalidate();
      utils.debitNote.list.invalidate();
      utils.goodsReceiptNote.list.invalidate();
      utils.orders.invalidate();
      onClose();
    },
    onError: (err) => toast.error("Failed to create", err.message),
  });

  const value = (id: string) => parseFloat(qty[id] || "0");
  const invalid = rows.some((r) => {
    const n = value(r.lineId);
    return !Number.isFinite(n) || n < 0 || n > r.open + 0.0005;
  });
  const picked = rows.filter((r) => value(r.lineId) > 0);

  return (
    <Modal open onClose={onClose} title="Return rejected goods" className="max-w-2xl">
      {isLoading || !data ? (
        <div className="flex justify-center py-10">
          <Spinner size="md" className="text-brand-600" />
        </div>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-text-secondary">Every rejected item on this GRN has already gone back.</p>
      ) : (
        <div className="space-y-4">
          <div className="flex gap-2">
            {TARGETS.map((t) => (
              <button
                key={t.type}
                type="button"
                onClick={() => setTarget(t.type)}
                className={cn(
                  "flex-1 py-1.5 px-3 rounded-lg text-sm font-medium transition-colors border",
                  target === t.type
                    ? "bg-brand-600 text-white border-brand-600"
                    : "border-border-light text-text-secondary hover:bg-surface-1",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-text-tertiary">
            {TARGETS.find((t) => t.type === target)!.hint} Stock doesn't change: rejected goods never came in.
          </p>

          <div className="overflow-hidden rounded-xl border border-border-light">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-surface-1 border-b border-border-light">
                  <th className="px-3 py-2 text-left font-medium text-text-tertiary">Item</th>
                  <th className="px-3 py-2 text-left font-medium text-text-tertiary">Reason</th>
                  <th className="px-3 py-2 text-right font-medium text-text-tertiary">Rejected</th>
                  <th className="px-3 py-2 text-right font-medium text-text-tertiary">Returned</th>
                  <th className="px-3 py-2 text-right font-medium text-text-tertiary w-28">Return now</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-light">
                {rows.map((r) => {
                  const n = value(r.lineId);
                  const bad = !Number.isFinite(n) || n < 0 || n > r.open + 0.0005;
                  return (
                    <tr key={r.lineId}>
                      <td className="px-3 py-2 font-medium text-text-primary">{r.itemName}</td>
                      <td className="px-3 py-2 text-text-secondary">{r.reason ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-text-secondary">{formatQty(r.rejected, r.selectedUnit)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-text-secondary">{formatQty(r.returned)}</td>
                      <td className="px-3 py-1.5 text-right">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={qty[r.lineId] ?? "0"}
                          onChange={(e) => setQty((q) => ({ ...q, [r.lineId]: e.target.value }))}
                          className={cn("input h-8 text-right tabular-nums", bad && "border-red-500")}
                          aria-label={`Quantity of ${r.itemName} to return`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            {invalid && <p className="mr-auto text-xs text-red-600">A quantity is more than what is left to return.</p>}
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={convert.isPending || invalid || picked.length === 0}
              onClick={() =>
                convert.mutate({
                  sourceDocumentId: grnId,
                  targetDocumentType: target,
                  fromRejected: true,
                  lines: picked.map((r) => ({ sourceLineId: r.lineId, quantity: String(value(r.lineId)) })),
                })
              }
            >
              {convert.isPending ? "Creating…" : `Create ${TARGETS.find((t) => t.type === target)!.label}`}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
