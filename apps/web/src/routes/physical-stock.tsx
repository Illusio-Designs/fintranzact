import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { todayISODate, toISOString, cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/PageHeader";
import { InputField } from "@/components/ui/FormField";
import { SearchInput } from "@/components/ui/SearchInput";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { Pagination } from "@/components/ui/Pagination";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { WarehouseSelect, formatQty, unitKey, parseUnitKey, useWarehouses } from "@/components/inventory/shared";

export const Route = createFileRoute("/physical-stock")({
  component: PhysicalStockPage,
});

const PAGE_SIZE = 50;

/**
 * Physical stock verification: walk the warehouse, type what is actually on
 * the shelf, and post. Only the differences become adjustments.
 */
function PhysicalStockPage() {
  const utils = trpc.useUtils();
  const { data: warehouses } = useWarehouses();
  const [warehouseId, setWarehouseId] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [date, setDate] = useState(todayISODate());
  const [note, setNote] = useState("");
  // Counts survive paging and searching until posted.
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  const [pendingWarehouse, setPendingWarehouse] = useState<string | null>(null);

  useEffect(() => {
    if (!warehouseId && warehouses?.length) {
      setWarehouseId((warehouses.find((w) => w.isDefault) ?? warehouses[0])!.id);
    }
  }, [warehouses, warehouseId]);

  const { data, isFetching } = trpc.stock.balances.useQuery(
    { search: search || undefined, page, limit: PAGE_SIZE },
    { placeholderData: keepPreviousData },
  );

  // Book stock for every row seen, so the summary covers counts on other pages.
  const [book, setBook] = useState<Record<string, { name: string; unit: string; qty: number }>>({});
  useEffect(() => {
    if (!data || !warehouseId) return;
    setBook((b) => {
      const next = { ...b };
      for (const r of data.data) {
        next[unitKey(r.itemId, r.variantId)] = {
          name: r.name,
          unit: r.unit,
          qty: parseFloat(r.byWarehouse[warehouseId] ?? "0"),
        };
      }
      return next;
    });
  }, [data, warehouseId]);

  const entered = useMemo(
    () =>
      Object.entries(counts)
        .filter(([, v]) => v.trim() !== "" && Number.isFinite(parseFloat(v)) && parseFloat(v) >= 0)
        .map(([key, v]) => ({ key, counted: parseFloat(v), book: book[key]?.qty ?? 0 })),
    [counts, book],
  );
  const differences = entered.filter((e) => Math.abs(e.counted - e.book) >= 0.0005);

  const verify = trpc.stock.verify.useMutation({
    onSuccess: async (res) => {
      await Promise.all([utils.stock.balances.invalidate(), utils.stock.warehouses.invalidate(), utils.stock.adjustments.invalidate()]);
      toast({
        title: "Physical stock posted",
        description: `${res.checked} item${res.checked === 1 ? "" : "s"} checked, ${res.adjusted} adjusted.`,
        variant: "success",
      });
      setCounts({});
      setNote("");
      setConfirming(false);
    },
    onError: (e) => {
      setConfirming(false);
      toast({ title: "Couldn't post the count", description: e.message, variant: "error" });
    },
  });

  function changeWarehouse(id: string) {
    if (id === warehouseId) return;
    // Counts belong to one warehouse; confirm before throwing them away.
    if (entered.length) {
      setPendingWarehouse(id);
      return;
    }
    setWarehouseId(id);
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const warehouseName = warehouses?.find((w) => w.id === warehouseId)?.name ?? "this warehouse";

  return (
    <div>
      <PageHeader
        title="Physical stock"
        description="Count what's on the shelf and post it. Only the differences are adjusted."
        actions={
          <Link to="/stock-adjustments" className="btn-secondary">
            Past counts
          </Link>
        }
      />

      <div className="card mb-5 grid gap-4 p-4 sm:grid-cols-3">
        <WarehouseSelect label="Warehouse" value={warehouseId} onChange={changeWarehouse} />
        <InputField label="Count date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <InputField label="Note (optional)" placeholder="e.g. Quarter-end count" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-light px-4 py-3">
          <SearchInput
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder="Search item or SKU..."
            className="max-w-xs"
          />
          <p className="text-xs text-text-tertiary">
            {entered.length} counted · {differences.length} with a difference
          </p>
        </div>
        {!data ? (
          <SkeletonRows />
        ) : data.data.length === 0 ? (
          <EmptyState title="No stock items" description={search ? "No items match your search" : "Add products under Items first"} />
        ) : (
          <>
            <div className={cn("overflow-x-auto", isFetching && "opacity-70")}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className="text-right">In books</th>
                    <th className="w-40 text-right">Counted</th>
                    <th className="text-right">Difference</th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((r) => {
                    const key = unitKey(r.itemId, r.variantId);
                    const inBooks = parseFloat(r.byWarehouse[warehouseId] ?? "0");
                    const raw = counts[key] ?? "";
                    const counted = raw.trim() === "" ? null : parseFloat(raw);
                    const diff = counted === null || !Number.isFinite(counted) ? null : counted - inBooks;
                    return (
                      <tr key={key}>
                        <td>
                          <p className="font-medium text-text-primary">{r.name}</p>
                          {r.sku && <p className="text-xs text-text-tertiary">{r.sku}</p>}
                        </td>
                        <td className="text-right tabular-nums text-text-secondary">{formatQty(inBooks, r.unit)}</td>
                        <td className="text-right">
                          <input
                            className="input ml-auto w-32 text-right tabular-nums"
                            inputMode="decimal"
                            aria-label={`Counted quantity of ${r.name}`}
                            placeholder="—"
                            value={raw}
                            onChange={(e) => setCounts((c) => ({ ...c, [key]: e.target.value }))}
                          />
                        </td>
                        <td
                          className={cn(
                            "text-right font-semibold tabular-nums",
                            diff === null || Math.abs(diff) < 0.0005
                              ? "text-text-tertiary"
                              : diff < 0
                                ? "text-red-600 dark:text-red-400"
                                : "text-emerald-700 dark:text-emerald-400",
                          )}
                        >
                          {diff === null ? "—" : Math.abs(diff) < 0.0005 ? "Matches" : `${diff > 0 ? "+" : ""}${formatQty(diff)}`}
                        </td>
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

      <div className="sticky bottom-0 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border-light bg-surface-0 px-4 py-3 shadow-[0_-8px_24px_-18px_rgba(15,27,61,.4)]">
        <p className="text-sm text-text-secondary">
          {entered.length === 0
            ? "Type the counted quantity next to each item you've checked."
            : `${entered.length} item${entered.length === 1 ? "" : "s"} counted at ${warehouseName}; ${differences.length} will be adjusted.`}
        </p>
        <button className="btn-primary" disabled={!warehouseId || entered.length === 0 || verify.isPending} onClick={() => setConfirming(true)}>
          {verify.isPending ? "Posting..." : "Post count"}
        </button>
      </div>

      <ConfirmDialog
        open={pendingWarehouse !== null}
        onCancel={() => setPendingWarehouse(null)}
        onConfirm={() => {
          setWarehouseId(pendingWarehouse!);
          setCounts({});
          setPendingWarehouse(null);
        }}
        title="Switch warehouse?"
        description="The counts you've entered for this warehouse will be cleared."
        confirmLabel="Switch"
      />

      <ConfirmDialog
        open={confirming}
        onCancel={() => setConfirming(false)}
        loading={verify.isPending}
        onConfirm={() =>
          verify.mutate({
            warehouseId,
            date: toISOString(date),
            note: note.trim() || undefined,
            counts: entered.map((e) => ({ ...parseUnitKey(e.key), counted: String(e.counted) })),
          })
        }
        title="Post physical count?"
        description={
          differences.length
            ? `${differences.length} item${differences.length === 1 ? "" : "s"} at ${warehouseName} will be adjusted to match what you counted.`
            : "Everything you counted matches the books. Nothing will change."
        }
        confirmLabel="Post count"
      />
    </div>
  );
}
