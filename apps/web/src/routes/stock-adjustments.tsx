import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { formatDate, todayISODate, toISOString, cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/PageHeader";
import { SlideOver } from "@/components/ui/SlideOver";
import { InputField } from "@/components/ui/FormField";
import { Listbox } from "@/components/ui/Listbox";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { Pagination } from "@/components/ui/Pagination";
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

const PAGE_SIZE = 25;

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
  const { data, isFetching } = trpc.stock.adjustments.useQuery(
    { kind, page, limit: PAGE_SIZE },
    { placeholderData: keepPreviousData },
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
      await Promise.all([utils.stock.adjustments.invalidate(), utils.stock.warehouses.invalidate(), utils.stock.balances.invalidate()]);
      toast({ title: "Stock adjusted", variant: "success" });
      setOpen(false);
      setLines([newLine()]);
      setOtherReason("");
    },
    onError: (e) => toast({ title: "Adjustment failed", description: e.message, variant: "error" }),
  });

  const ready = readyLines(lines);
  const finalReason = reason === "Other" ? otherReason.trim() : reason;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div>
      <PageHeader
        title="Stock adjustments"
        description="Stock added or removed outside of sales and purchases, with the reason"
        actions={
          <button className="btn-primary" onClick={() => setOpen(true)}>
            + New adjustment
          </button>
        }
      />

      <div className="card overflow-hidden">
        <div className="border-b border-border-light px-4 py-2">
          <PillTabs
            tabs={[
              { value: "all", label: "All adjustments" },
              { value: "physical", label: "From physical counts" },
            ]}
            value={kind}
            onChange={(v) => {
              setKind(v as "all" | "physical");
              setPage(1);
            }}
          />
        </div>
        {!data ? (
          <SkeletonRows />
        ) : data.data.length === 0 ? (
          <EmptyState title="No adjustments" description="Damaged, expired, found or counted stock changes show up here." />
        ) : (
          <>
            <div className={cn("overflow-x-auto", isFetching && "opacity-70")}>
              <table className="data-table">
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
                        <td className="font-medium text-text-primary">{a.itemName}</td>
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
            </div>
            <div className="border-t border-border-light px-4 py-3">
              <Pagination page={page} totalPages={totalPages} onPageChange={setPage} total={data.total} pageSize={PAGE_SIZE} />
            </div>
          </>
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
                  lines: ready.map((l) => ({
                    ...l,
                    quantity: direction === "remove" ? `-${l.quantity}` : l.quantity,
                  })),
                })
              }
            >
              {adjust.isPending ? "Saving..." : direction === "remove" ? "Remove stock" : "Add stock"}
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
          />
        </div>
      </SlideOver>
    </div>
  );
}
