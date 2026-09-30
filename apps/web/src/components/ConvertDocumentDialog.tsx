/**
 * Convert an order, challan or GRN into what fulfils it (a delivery challan,
 * GRN or invoice), taking all or part of what is still pending on each line.
 */
import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { cn, getDocumentTypeLabel } from "@/lib/utils";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { toast } from "@/hooks/useToast";
import { WarehouseSelect, formatQty, useWarehouses } from "@/components/inventory/shared";
import type { DocumentType } from "@/components/DocumentCreator";

export interface ConvertTarget {
  type: DocumentType;
  label: string;
}

/** Targets that move stock and so can pick a warehouse (GRN/challan billing doesn't). */
function movesStock(source: string, target: DocumentType) {
  if (target === "goods_receipt_note" || target === "delivery_challan") return true;
  return target === "invoice" && (source === "sales_order" || source === "purchase_order");
}

export function ConvertDocumentDialog({
  sourceId,
  targets,
  onClose,
}: {
  sourceId: string;
  targets: ConvertTarget[];
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.orders.fulfilment.useQuery({ id: sourceId });
  const [target, setTarget] = useState<DocumentType>(targets[0]!.type);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [warehouseId, setWarehouseId] = useState("");
  const { data: warehouseList } = useWarehouses();
  const showWarehouse = !!data && movesStock(data.documentType, target)
    && (warehouseList ?? []).filter((w) => w.status === "active").length > 1;

  // Start every line at what is still pending.
  useEffect(() => {
    if (!data) return;
    setQty(Object.fromEntries(data.lines.map((l) => [l.lineId, l.pending > 0 ? String(l.pending) : "0"])));
  }, [data]);

  const convert = trpc.document.convert.useMutation({
    onSuccess: (res) => {
      toast.success(`${getDocumentTypeLabel(res.documentType)} ${res.invoiceNumber} created`);
      utils.invoice.list.invalidate();
      utils.deliveryChallan.list.invalidate();
      utils.purchaseOrder.list.invalidate();
      utils.salesOrder.list.invalidate();
      utils.goodsReceiptNote.list.invalidate();
      utils.orders.invalidate();
      utils.item.list.invalidate();
      onClose();
    },
    onError: (err) => toast.error("Failed to convert", err.message),
  });

  const lines = data?.lines ?? [];
  const invalid = lines.some((l) => {
    const n = parseFloat(qty[l.lineId] ?? "0");
    return !Number.isFinite(n) || n < 0 || n > l.pending + 0.0005;
  });
  const picked = lines.filter((l) => parseFloat(qty[l.lineId] ?? "0") > 0);

  function submit() {
    convert.mutate({
      sourceDocumentId: sourceId,
      targetDocumentType: target,
      lines: picked.map((l) => ({ sourceLineId: l.lineId, quantity: String(parseFloat(qty[l.lineId]!)) })),
      warehouseId: showWarehouse && warehouseId ? warehouseId : undefined,
    });
  }

  return (
    <Modal open onClose={onClose} title="Convert pending items" className="max-w-2xl">
      {isLoading || !data ? (
        <div className="flex justify-center py-10">
          <Spinner size="md" className="text-brand-600" />
        </div>
      ) : (
        <div className="space-y-4">
          {targets.length > 1 && (
            <div className="flex gap-2">
              {targets.map((t) => (
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
          )}

          <div className="overflow-hidden rounded-xl border border-border-light">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-surface-1 border-b border-border-light">
                  <th className="px-3 py-2 text-left font-medium text-text-tertiary">Item</th>
                  <th className="px-3 py-2 text-right font-medium text-text-tertiary">Ordered</th>
                  <th className="px-3 py-2 text-right font-medium text-text-tertiary">Done</th>
                  <th className="px-3 py-2 text-right font-medium text-text-tertiary">Pending</th>
                  <th className="px-3 py-2 text-right font-medium text-text-tertiary w-28">Take now</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-light">
                {lines.map((l) => {
                  const value = qty[l.lineId] ?? "0";
                  const n = parseFloat(value);
                  const bad = !Number.isFinite(n) || n < 0 || n > l.pending + 0.0005;
                  return (
                    <tr key={l.lineId}>
                      <td className="px-3 py-2 font-medium text-text-primary">{l.itemName}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-text-secondary">{formatQty(l.ordered, l.selectedUnit)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-text-secondary">{formatQty(l.fulfilled)}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{formatQty(l.pending)}</td>
                      <td className="px-3 py-1.5 text-right">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={value}
                          disabled={l.pending <= 0}
                          onChange={(e) => setQty((q) => ({ ...q, [l.lineId]: e.target.value }))}
                          className={cn("input h-8 text-right tabular-nums", bad && "border-red-500")}
                          aria-label={`Quantity of ${l.itemName}`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {showWarehouse && (
            <div className="max-w-xs">
              <WarehouseSelect
                label={target === "delivery_challan" || data.documentType === "sales_order" ? "Dispatch from" : "Receive into"}
                value={warehouseId}
                onChange={setWarehouseId}
              />
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            {invalid && <p className="mr-auto text-xs text-red-600">A quantity is more than what is pending.</p>}
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={submit}
              disabled={convert.isPending || invalid || picked.length === 0}
            >
              {convert.isPending ? "Converting…" : `Create ${targets.find((t) => t.type === target)?.label ?? ""}`}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
