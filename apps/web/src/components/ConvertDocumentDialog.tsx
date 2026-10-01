/**
 * Convert an order, challan or GRN into what fulfils it (a delivery challan,
 * GRN or invoice), taking all or part of what is still pending on each line
 * — billed and free quantities apart. Receiving a purchase order on a GRN
 * also records what was rejected, and why.
 */
import { Fragment, useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { invalidateStockViews } from "@/lib/stock-cache";
import { cn, getDocumentTypeLabel } from "@/lib/utils";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { toast } from "@/hooks/useToast";
import { WarehouseSelect, formatQty, useWarehouses } from "@/components/inventory/shared";
import type { DocumentType } from "@/components/DocumentCreator";
import { rejectionReasons } from "@fintranzact/shared";
import { DateInput } from "@/components/ui/DateInput";

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
  const [free, setFree] = useState<Record<string, string>>({});
  const [rejected, setRejected] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<Record<string, string>>({});
  // Items that track batches: the batch the goods arrive in.
  const [batchNo, setBatchNo] = useState<Record<string, string>>({});
  const [expiry, setExpiry] = useState<Record<string, string>>({});
  const [warehouseId, setWarehouseId] = useState("");
  const { data: warehouseList } = useWarehouses();
  const showWarehouse = !!data && movesStock(data.documentType, target)
    && (warehouseList ?? []).filter((w) => w.status === "active").length > 1;

  // Start every line at what is still pending, billed and free.
  useEffect(() => {
    if (!data) return;
    setQty(Object.fromEntries(data.lines.map((l) => [l.lineId, l.pending > 0 ? String(l.pending) : "0"])));
    setFree(Object.fromEntries(data.lines.map((l) => [l.lineId, l.freePending > 0 ? String(l.freePending) : "0"])));
  }, [data]);

  const receiving = data?.documentType === "purchase_order" && target === "goods_receipt_note";
  const hasFree = !!data?.lines.some((l) => l.freeOrdered > 0);
  // Goods coming in from a purchase order name their batch.
  const inward = data?.documentType === "purchase_order" && (target === "goods_receipt_note" || target === "invoice");
  const batchInfo = (l: { itemId: string | null }) => (inward && l.itemId ? data?.batchItems?.[l.itemId] ?? null : null);

  const convert = trpc.document.convert.useMutation({
    onSuccess: (res) => {
      toast.success(`${getDocumentTypeLabel(res.documentType)} ${res.invoiceNumber} created`);
      utils.invoice.list.invalidate();
      utils.deliveryChallan.list.invalidate();
      utils.purchaseOrder.list.invalidate();
      utils.salesOrder.list.invalidate();
      utils.goodsReceiptNote.list.invalidate();
      utils.orders.invalidate();
      void invalidateStockViews(utils);
      utils.party.invalidate();
      onClose();
    },
    onError: (err) => toast.error("Failed to convert", err.message),
  });

  const lines = data?.lines ?? [];
  const num = (m: Record<string, string>, id: string) => parseFloat(m[id] || "0");
  const rejectedOf = (id: string) => (receiving ? num(rejected, id) : 0);
  const lineError = (l: (typeof lines)[number]) => {
    const n = num(qty, l.lineId);
    const f = num(free, l.lineId);
    const r = rejectedOf(l.lineId);
    if (![n, f, r].every((v) => Number.isFinite(v) && v >= 0)) return "Quantities can't be negative.";
    if (n > l.pending + 0.0005) return "A quantity is more than what is pending.";
    if (f > l.freePending + 0.0005) return "A free quantity is more than what is pending free.";
    if (n + r > l.pending + 0.0005) return "Accepted and rejected come to more than what is pending.";
    if (r > 0 && !(reason[l.lineId] ?? "").trim()) return "Give a reason for each rejection.";
    const b = batchInfo(l);
    if (b && n + f > 0) {
      if (!(batchNo[l.lineId] ?? "").trim()) return `Enter a batch number for ${l.itemName}.`;
      if (b.trackExpiry && !expiry[l.lineId]) return `Enter the expiry of ${l.itemName}'s batch.`;
    }
    return null;
  };
  const firstError = lines.map(lineError).find(Boolean) ?? null;
  const picked = lines.filter((l) => num(qty, l.lineId) > 0 || num(free, l.lineId) > 0 || rejectedOf(l.lineId) > 0);

  function submit() {
    convert.mutate({
      sourceDocumentId: sourceId,
      targetDocumentType: target,
      lines: picked.map((l) => ({
        sourceLineId: l.lineId,
        quantity: String(num(qty, l.lineId) || 0),
        freeQuantity: String(num(free, l.lineId) || 0),
        ...(rejectedOf(l.lineId) > 0
          ? { rejectedQuantity: String(rejectedOf(l.lineId)), rejectionReason: (reason[l.lineId] ?? "").trim() }
          : {}),
        ...(batchInfo(l) && (batchNo[l.lineId] ?? "").trim()
          ? { batchNumber: batchNo[l.lineId]!.trim(), expiryDate: expiry[l.lineId] || undefined }
          : {}),
      })),
      warehouseId: showWarehouse && warehouseId ? warehouseId : undefined,
    });
  }

  return (
    <Modal open onClose={onClose} title="Convert pending items" className={receiving ? "max-w-4xl" : "max-w-2xl"}>
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
                  aria-pressed={target === t.type}
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
                  <th className="px-3 py-2 text-right font-medium text-text-tertiary w-28">{receiving ? "Accept" : "Take now"}</th>
                  {hasFree && <th className="px-3 py-2 text-right font-medium text-text-tertiary w-24">Free</th>}
                  {receiving && (
                    <>
                      <th className="px-3 py-2 text-right font-medium text-text-tertiary w-24">Reject</th>
                      <th className="px-3 py-2 text-left font-medium text-text-tertiary w-40">Reason</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-border-light">
                {lines.map((l) => {
                  const value = qty[l.lineId] ?? "0";
                  const bad = !!lineError(l);
                  const rejectedValue = rejected[l.lineId] ?? "";
                  const b = batchInfo(l);
                  return (
                    <Fragment key={l.lineId}>
                    <tr>
                      <td className="px-3 py-2 font-medium text-text-primary">
                        {l.itemName}
                        {l.rejected > 0 && (
                          <span className="block text-[11px] font-normal text-amber-600">{formatQty(l.rejected)} rejected earlier</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-text-secondary">
                        {formatQty(l.ordered, l.selectedUnit)}
                        {l.freeOrdered > 0 && <span className="block text-[11px]">+ {formatQty(l.freeOrdered)} free</span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-text-secondary">
                        {formatQty(l.fulfilled)}
                        {l.freeFulfilled > 0 && <span className="block text-[11px]">+ {formatQty(l.freeFulfilled)} free</span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">
                        {formatQty(l.pending)}
                        {l.freePending > 0 && <span className="block text-[11px] font-normal">+ {formatQty(l.freePending)} free</span>}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={value}
                          disabled={l.pending <= 0}
                          onChange={(e) => setQty((q) => ({ ...q, [l.lineId]: e.target.value }))}
                          className={cn("input h-8 text-right tabular-nums", bad && "border-red-500")}
                          aria-label={`${receiving ? "Accepted quantity" : "Quantity"} of ${l.itemName}`}
                        />
                      </td>
                      {hasFree && (
                        <td className="px-3 py-1.5 text-right">
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={free[l.lineId] ?? "0"}
                            disabled={l.freePending <= 0}
                            onChange={(e) => setFree((q) => ({ ...q, [l.lineId]: e.target.value }))}
                            className="input h-8 text-right tabular-nums"
                            aria-label={`Free quantity of ${l.itemName}`}
                          />
                        </td>
                      )}
                      {receiving && (
                        <>
                          <td className="px-3 py-1.5 text-right">
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={rejectedValue}
                              placeholder="0"
                              disabled={l.pending <= 0}
                              onChange={(e) => setRejected((q) => ({ ...q, [l.lineId]: e.target.value }))}
                              className="input h-8 text-right tabular-nums"
                              aria-label={`Rejected quantity of ${l.itemName}`}
                            />
                          </td>
                          <td className="px-3 py-1.5">
                            <input
                              list="convert-rejection-reasons"
                              value={reason[l.lineId] ?? ""}
                              disabled={!(parseFloat(rejectedValue || "0") > 0)}
                              maxLength={200}
                              onChange={(e) => setReason((q) => ({ ...q, [l.lineId]: e.target.value }))}
                              className="input h-8 disabled:opacity-50"
                              placeholder="Reason"
                              aria-label={`Reason for rejecting ${l.itemName}`}
                            />
                          </td>
                        </>
                      )}
                    </tr>
                    {b && (
                      <tr className="bg-surface-1/40">
                        <td colSpan={5 + (hasFree ? 1 : 0) + (receiving ? 2 : 0)} className="px-3 py-1.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[11px] text-text-tertiary">Batch</span>
                            <input
                              value={batchNo[l.lineId] ?? ""}
                              maxLength={60}
                              onChange={(e) => setBatchNo((q) => ({ ...q, [l.lineId]: e.target.value }))}
                              className="input h-8 w-36"
                              placeholder="Batch no."
                              aria-label={`Batch number of ${l.itemName}`}
                            />
                            <span className="text-[11px] text-text-tertiary">Expiry{b.trackExpiry ? " *" : ""}</span>
                            <DateInput
                              value={expiry[l.lineId] ?? ""}
                              onChange={(e) => setExpiry((q) => ({ ...q, [l.lineId]: e.target.value }))}
                              className="input h-8 w-40"
                              aria-label={`Expiry of ${l.itemName}'s batch`}
                            />
                          </div>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {receiving && (
            <>
              <datalist id="convert-rejection-reasons">
                {rejectionReasons.map((r) => <option key={r} value={r} />)}
              </datalist>
              <p className="text-xs text-text-tertiary">
                Only accepted and free goods come into stock. Rejected goods stay pending on this order until they are replaced or the order is short-closed.
              </p>
            </>
          )}

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
            {firstError && <p className="mr-auto text-xs text-red-600">{firstError}</p>}
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={submit}
              disabled={convert.isPending || !!firstError || picked.length === 0}
            >
              {convert.isPending ? "Converting…" : `Create ${targets.find((t) => t.type === target)?.label ?? ""}`}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
