import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { invalidateStockViews } from "@/lib/stock-cache";
import { toast } from "@/hooks/useToast";
import { formatDate, todayISODate, toISOString, cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/PageHeader";
import { SlideOver } from "@/components/ui/SlideOver";
import { InputField } from "@/components/ui/FormField";
import { Listbox } from "@/components/ui/Listbox";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { Pagination } from "@/components/ui/Pagination";
import { TableScroll } from "@/components/ui/Table";
import { usePageSize } from "@/hooks/usePageSize";
import { PillTabs } from "@/components/ui/Tabs";
import {
  StockLinesEditor,
  WarehouseSelect,
  formatQty,
  newLine,
  readyLines,
  type StockLine,
} from "@/components/inventory/shared";

export const Route = createFileRoute("/stock-adjustments")({
  component: StockAdjustmentsPage,
});

const REASONS = [
  "Damaged goods",
  "Expired",
  "Lost or stolen",
  "Found extra stock",
  "Opening stock",
  "Sample or free issue",
  "Other",
];

function StockAdjustmentsPage() {
  const utils = trpc.useUtils();
  const [page, setPage] = useState(1);
  const [kind, setKind] = useState<"all" | "physical">("all");
  const [pageSize, setPageSize] = usePageSize("stock-adjustments", 25);
  const tableRef = useRef<HTMLDivElement>(null);
  // Back to page 1 when the tab or rows per page change.
  useEffect(() => setPage(1), [kind, pageSize]);
  // A new page starts at its first row.
  useEffect(() => { tableRef.current?.scrollTo({ top: 0 }); }, [page]);
  const { data, isFetching } = trpc.stock.adjustments.useQuery(
    { kind, page, limit: pageSize },
    // Keep the current page on screen while the next one loads.
    { placeholderData: (prev) => prev },
  );

  const [open, setOpen] = useState(false);
  const [warehouseId, setWarehouseId] = useState("");
  const [direction, setDirection] = useState<"remove" | "add">("remove");
  const [reason, setReason] = useState(REASONS[0]!);
  const [otherReason, setOtherReason] = useState("");
  const [date, setDate] = useState(todayISODate());
  const [lines, setLines] = useState<StockLine[]>([newLine()]);

  const adjust = trpc.stock.adjust.useMutation({
    onSuccess: async () => {
      await invalidateStockViews(utils);
      toast({ title: "Stock adjusted", variant: "success" });
      setOpen(false);
      setLines([newLine()]);
      setOtherReason("");
    },
    onError: (e) => toast({ title: "Adjustment failed", description: e.message, variant: "error" }),
  });

  const ready = readyLines(lines);
  const finalReason = reason === "Other" ? otherReason.trim() : reason;
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  // The last page emptied out (or rows per page grew): step back.
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  return (
    <div>
      <PageHeader
        title="Stock Adjustments"
        description="Stock added or removed outside of sales and purchases, with the reason"
        actions={
          <button className="btn-primary" onClick={() => setOpen(true)}>
            + New adjustment
          </button>
        }
      />

      <div className="card overflow-clip">
        <div className="border-b border-border-light px-4 py-2">
          {/* The tabs scroll sideways on narrow phones instead of wrapping. */}
          <div className="min-w-0 max-w-full overflow-x-auto">
            <PillTabs
              tabs={[
                { value: "all", label: "All adjustments" },
                { value: "physical", label: "From physical counts" },
              ]}
              value={kind}
              onChange={(v) => setKind(v as "all" | "physical")}
            />
          </div>
        </div>
        {!data ? (
          <SkeletonRows />
        ) : data.data.length === 0 ? (
          <EmptyState title="No adjustments" description="Damaged, expired, found or counted stock changes show up here." />
        ) : (
          <div className={cn("transition-opacity", isFetching && "opacity-60")}>
            <Pagination placement="top" page={page} totalPages={totalPages} onPageChange={setPage} total={total} pageSize={pageSize} />
            <TableScroll ref={tableRef}>
              <table className="data-table w-full">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Item</th>
                    <th>Warehouse</th>
                    <th className="text-right">Change</th>
                    <th className="text-right">Stock after</th>
                    <th>Reason</th>
                    <th>By</th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((a) => {
                    const change = parseFloat(a.quantity);
                    return (
                      <tr key={a.id}>
                        <td className="whitespace-nowrap text-text-secondary">{formatDate(a.date)}</td>
                        <td className="font-medium text-text-primary">
                          {a.itemName}
                          {a.batchNumber && (
                            <span className="block text-xs font-normal text-text-tertiary">
                              Batch {a.batchNumber}{a.expiryDate ? ` · exp ${formatDate(a.expiryDate)}` : ""}
                            </span>
                          )}
                        </td>
                        <td className="text-text-secondary">{a.warehouseName ?? "—"}</td>
                        <td
                          className={cn(
                            "text-right font-semibold tabular-nums",
                            change < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400",
                          )}
                        >
                          {change > 0 ? "+" : ""}
                          {formatQty(change, a.unit)}
                        </td>
                        <td className="text-right tabular-nums text-text-secondary">{formatQty(a.newStock)}</td>
                        <td className="max-w-[260px] truncate text-text-secondary">{a.reason ?? "—"}</td>
                        <td className="whitespace-nowrap text-text-tertiary">{a.createdByName ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableScroll>
            <Pagination
              page={page}
              totalPages={totalPages}
              onPageChange={setPage}
              total={total}
              pageSize={pageSize}
              onPageSizeChange={setPageSize}
            />
          </div>
        )}
      </div>

      <SlideOver
        open={open}
        onClose={() => setOpen(false)}
        title="New stock adjustment"
        description="Add or remove stock at one warehouse and say why."
        footer={
          <div className="flex justify-end gap-3">
            <button className="btn-secondary" onClick={() => setOpen(false)} disabled={adjust.isPending}>
              Cancel
            </button>
            <button
              className="btn-primary"
              disabled={adjust.isPending || !warehouseId || ready.length === 0 || !finalReason}
              onClick={() =>
                adjust.mutate({
                  warehouseId,
                  reason: finalReason,
                  date: toISOString(date),
                  lines: ready.map(({ batchId, newBatch, ...l }) => ({
                    ...l,
                    quantity: direction === "remove" ? `-${l.quantity}` : l.quantity,
                    // Stock taken out comes from a batch; stock added goes into one.
                    ...(direction === "remove" ? (batchId ? { batchId } : {}) : (newBatch ? { newBatch } : {})),
                  })),
                })
              }
            >
              {adjust.isPending ? "Saving…" : direction === "remove" ? "Remove stock" : "Add stock"}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <WarehouseSelect label="Warehouse" value={warehouseId} onChange={setWarehouseId} required />
          <div>
            <p className="mb-1.5 text-xs font-medium text-text-secondary">Adjustment</p>
            <PillTabs
              tabs={[
                { value: "remove", label: "Remove stock" },
                { value: "add", label: "Add stock" },
              ]}
              value={direction}
              onChange={(v) => setDirection(v as "remove" | "add")}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Listbox label="Reason" value={reason} onChange={setReason} options={REASONS.map((r) => ({ value: r, label: r }))} />
            <InputField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          {reason === "Other" && (
            <InputField
              label="Describe the reason"
              required
              value={otherReason}
              onChange={(e) => setOtherReason(e.target.value)}
              placeholder="e.g. Used for repairs"
            />
          )}
          <StockLinesEditor
            lines={lines}
            onChange={setLines}
            warehouseId={warehouseId || undefined}
            quantityLabel={direction === "remove" ? "Remove" : "Add"}
            batchMode={direction === "remove" ? "out" : "in"}
          />
        </div>
      </SlideOver>
    </div>
  );
}
