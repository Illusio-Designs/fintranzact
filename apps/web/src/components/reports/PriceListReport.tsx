/**
 * Price List report: every item (and variant) with its sale price, MRP and
 * price on each price level as of a date. Rendered from the Reports page.
 */
import { useState } from "react";
import { Alert02Icon, Download04Icon } from "@hugeicons/core-free-icons";
import { trpc } from "@/lib/trpc";
import { downloadCSV, formatCurrency, formatDate } from "@/lib/utils";
import { useDebounce } from "@/hooks/useDebounce";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { Icon } from "@/components/ui/Icon";

const money = (v: string | null | undefined) => (v ? formatCurrency(v) : "—");

export function PriceListReport({ asOf }: { asOf?: string }) {
  const [category, setCategory] = useState("");
  const debounced = useDebounce(category, 300);
  const date = asOf && /^\d{4}-\d{2}-\d{2}/.test(asOf) ? asOf.slice(0, 10) : undefined;
  const { data, isLoading, error } = trpc.priceLevel.priceList.useQuery({ date, category: debounced.trim() || undefined });

  function exportCsv() {
    if (!data) return;
    downloadCSV(
      `price-list-${data.date}`,
      ["Item", "HSN", "Category", "Unit", "Sale price", "MRP", ...data.levels.map((l) => l.name)],
      data.rows.map((r) => [
        r.name, r.hsn ?? "", r.category ?? "", r.unit, r.salePrice ?? "", r.mrp ?? "",
        ...data.levels.map((l) => r.prices[l.id] ?? ""),
      ]),
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div className="w-56">
          <input
            className="input"
            aria-label="Category"
            placeholder="All categories"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          />
        </div>
        {data && <p className="text-xs text-text-tertiary">Prices as on {formatDate(data.date)}, for one unit</p>}
        {data && data.rows.length > 0 && (
          <button onClick={exportCsv} className="btn-secondary ml-auto inline-flex items-center gap-1.5 text-xs">
            <Icon icon={Download04Icon} size={14} />
            Export CSV
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Spinner size="md" className="text-brand-600" />
        </div>
      ) : error || !data ? (
        <EmptyState
          icon={<Icon icon={Alert02Icon} size={20} className="text-text-tertiary" />}
          title="Could not load the price list"
          description="Try again in a moment."
        />
      ) : data.rows.length === 0 ? (
        <EmptyState title="No items" description="Items and their prices on each level appear here." />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface">
          <div className="max-h-[calc(100vh-320px)] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-border bg-surface-2 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                  <th className="px-4 py-2.5 text-left">Item</th>
                  <th className="hidden px-4 py-2.5 text-left md:table-cell">Unit</th>
                  <th className="px-4 py-2.5 text-right">Sale price</th>
                  <th className="px-4 py-2.5 text-right">MRP</th>
                  {data.levels.map((l) => (
                    <th key={l.id} className="whitespace-nowrap px-4 py-2.5 text-right">
                      {l.name}
                      {l.isDefault && <span className="ml-1 normal-case tracking-normal">(default)</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={`${r.itemId}:${r.variantId ?? ""}`} className="border-b border-border-light last:border-0 hover:bg-surface-1">
                    <td className="px-4 py-2.5 text-text-primary">
                      {r.name}
                      {r.category && <span className="ml-2 text-xs text-text-tertiary">{r.category}</span>}
                    </td>
                    <td className="hidden px-4 py-2.5 text-text-secondary md:table-cell">{r.unit}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{money(r.salePrice)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-text-secondary">{money(r.mrp)}</td>
                    {data.levels.map((l) => (
                      <td key={l.id} className="px-4 py-2.5 text-right tabular-nums">
                        {r.prices[l.id] ? money(r.prices[l.id]) : <span className="text-text-tertiary">{money(r.salePrice)}</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {data && data.levels.length === 0 && (
        <p className="mt-3 text-xs text-text-tertiary">No price levels yet. Create them on the Price Levels page.</p>
      )}
    </div>
  );
}
