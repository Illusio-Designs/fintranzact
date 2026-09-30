import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { formatDate, todayISODate, toISOString, cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/PageHeader";
import { SlideOver } from "@/components/ui/SlideOver";
import { InputField } from "@/components/ui/FormField";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { Pagination } from "@/components/ui/Pagination";
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

const PAGE_SIZE = 25;

function StockTransfersPage() {
  const utils = trpc.useUtils();
  const [page, setPage] = useState(1);
  const { data, isFetching } = trpc.stock.transfers.useQuery(
    { page, limit: PAGE_SIZE },
    { placeholderData: keepPreviousData },
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
      await Promise.all([utils.stock.transfers.invalidate(), utils.stock.warehouses.invalidate(), utils.stock.balances.invalidate()]);
      toast({ title: "Stock transferred", variant: "success" });
      setOpen(false);
      reset();
    },
    onError: (e) => toast({ title: "Transfer failed", description: e.message, variant: "error" }),
  });

  const ready = readyLines(lines);
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div>
      <PageHeader
        title="Stock transfers"
        description="Move stock between your warehouses. Every transfer is kept in this journal."
        actions={
          <button className="btn-primary" onClick={() => setOpen(true)}>
            + New transfer
          </button>
        }
      />

      <div className="card overflow-hidden">
        {!data ? (
          <SkeletonRows />
        ) : data.data.length === 0 ? (
          <EmptyState
            title="No transfers yet"
            description="Transfers between warehouses show up here, newest first."
            action={
              <button className="btn-primary" onClick={() => setOpen(true)}>
                Make a transfer
              </button>
            }
          />
        ) : (
          <>
            <div className={cn("overflow-x-auto", isFetching && "opacity-70")}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>From → To</th>
                    <th>Items</th>
                    <th className="text-right">Quantity</th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((t) => (
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
                          {t.lines.map((l) => `${l.name} × ${formatQty(l.quantity, l.unit)}`).join(", ")}
                        </p>
                        {t.lineCount > 1 && <p className="text-xs text-text-tertiary">{t.lineCount} items</p>}
                      </td>
                      <td className="text-right font-semibold tabular-nums text-text-primary">{formatQty(t.totalQuantity)}</td>
                    </tr>
                  ))}
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
                  lines: ready,
                })
              }
            >
              {transfer.isPending ? "Transferring..." : `Transfer ${ready.length || ""} item${ready.length === 1 ? "" : "s"}`}
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
          <StockLinesEditor lines={lines} onChange={setLines} warehouseId={from || undefined} />
        </div>
      </SlideOver>
    </div>
  );
}
