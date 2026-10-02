import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { trpc } from "@/lib/trpc";
import { invalidateStockViews } from "@/lib/stock-cache";
import { toast } from "@/hooks/useToast";
import { formatDate, todayISODate, toISOString } from "@/lib/utils";
import { PageHeader } from "@/components/ui/PageHeader";
import { SlideOver } from "@/components/ui/SlideOver";
import { InputField } from "@/components/ui/FormField";
import { EmptyState } from "@/components/ui/EmptyState";
import { ListCard } from "@/components/ui/ListCard";
import { usePageSize } from "@/hooks/usePageSize";
import { Icon } from "@/components/ui/Icon";
import {
  StockLinesEditor,
  WarehouseSelect,
  formatQty,
  newLine,
  readyLines,
  type StockLine,
} from "@/components/inventory/shared";

export const Route = createFileRoute("/stock-transfers")({
  component: StockTransfersPage,
});

function StockTransfersPage() {
  const utils = trpc.useUtils();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize("stock-transfers", 25);
  const tableRef = useRef<HTMLDivElement>(null);
  // Back to page 1 when rows per page change.
  useEffect(() => setPage(1), [pageSize]);
  // A new page starts at its first row.
  useEffect(() => { tableRef.current?.scrollTo({ top: 0 }); }, [page]);
  const { data, isFetching } = trpc.stock.transfers.useQuery(
    { page, limit: pageSize },
    // Keep the current page on screen while the next one loads.
    { placeholderData: (prev) => prev },
  );

  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [date, setDate] = useState(todayISODate());
  const [lines, setLines] = useState<StockLine[]>([newLine()]);

  function reset() {
    setFrom("");
    setTo("");
    setDate(todayISODate());
    setLines([newLine()]);
  }

  const transfer = trpc.stock.transfer.useMutation({
    onSuccess: async () => {
      await invalidateStockViews(utils);
      toast({ title: "Stock transferred", variant: "success" });
      setOpen(false);
      reset();
    },
    onError: (e) => toast({ title: "Transfer failed", description: e.message, variant: "error" }),
  });

  const ready = readyLines(lines);
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  // The last page emptied out (or rows per page grew): step back.
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  return (
    <div>
      <PageHeader
        title="Stock Transfers"
        description="Move stock between your warehouses. Every transfer is kept in this journal."
        actions={
          <button className="btn-primary" onClick={() => setOpen(true)}>
            + New transfer
          </button>
        }
      />

      <ListCard
        pagination={{ page, totalPages, onPageChange: setPage, total, pageSize, onPageSizeChange: setPageSize }}
        loading={!data}
        fetching={isFetching}
        tableRef={tableRef}
        empty={
          data && data.data.length === 0 ? (
            <EmptyState
              title="No transfers yet"
              description="Transfers between warehouses show up here, newest first."
              action={
                <button className="btn-primary" onClick={() => setOpen(true)}>
                  Make a transfer
                </button>
              }
            />
          ) : undefined
        }
      >
              <table className="data-table w-full">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>From → To</th>
                    <th>Items</th>
                    <th className="text-right">Quantity</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.data ?? []).map((t) => (
                    <tr key={t.referenceId}>
                      <td className="whitespace-nowrap text-text-secondary">{formatDate(t.date)}</td>
                      <td>
                        <span className="inline-flex items-center gap-1.5 font-medium text-text-primary">
                          {t.sourceName}
                          <Icon icon={ArrowRight01Icon} size={14} className="text-text-tertiary" />
                          {t.destinationName ?? "—"}
                        </span>
                      </td>
                      <td className="max-w-[420px]">
                        <p className="truncate text-text-secondary">
                          {t.lines.map((l) => `${l.name}${l.batchNumber ? ` (${l.batchNumber})` : ""} × ${formatQty(l.quantity, l.unit)}`).join(", ")}
                        </p>
                        {t.lineCount > 1 && <p className="text-xs text-text-tertiary">{t.lineCount} items</p>}
                      </td>
                      <td className="text-right font-semibold tabular-nums text-text-primary">{formatQty(t.totalQuantity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
      </ListCard>

      <SlideOver
        open={open}
        onClose={() => setOpen(false)}
        title="New stock transfer"
        description="Stock leaves one warehouse and arrives in the other. Your total stock doesn't change."
        footer={
          <div className="flex justify-end gap-3">
            <button className="btn-secondary" onClick={() => setOpen(false)} disabled={transfer.isPending}>
              Cancel
            </button>
            <button
              className="btn-primary"
              disabled={transfer.isPending || !from || !to || ready.length === 0}
              onClick={() =>
                transfer.mutate({
                  sourceWarehouseId: from,
                  destinationWarehouseId: to,
                  date: toISOString(date),
                  lines: ready.map(({ newBatch: _newBatch, ...l }) => l),
                })
              }
            >
              {transfer.isPending ? "Transferring…" : `Transfer ${ready.length || ""} item${ready.length === 1 ? "" : "s"}`}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <WarehouseSelect label="From" value={from} onChange={setFrom} exclude={to} required />
            <WarehouseSelect label="To" value={to} onChange={setTo} exclude={from} required />
          </div>
          <InputField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <StockLinesEditor lines={lines} onChange={setLines} warehouseId={from || undefined} batchMode="out" />
        </div>
      </SlideOver>
    </div>
  );
}
