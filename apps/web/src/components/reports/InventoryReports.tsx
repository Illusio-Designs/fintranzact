/**
 * Inventory reports: stock ledger, movement summary, godown summary, stock
 * ageing, reorder status and dead stock. Rendered from the Reports page.
 */
import { useState, type ReactNode } from "react";
import { Alert02Icon, Download04Icon } from "@hugeicons/core-free-icons";
import { trpc } from "@/lib/trpc";
import { cn, downloadCSV, formatCurrency, formatDate } from "@/lib/utils";
import { useDebounce } from "@/hooks/useDebounce";
import { Combobox } from "@/components/ui/Combobox";
import { Listbox } from "@/components/ui/Listbox";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { StatCard } from "@/components/ui/StatCard";
import { Icon } from "@/components/ui/Icon";
import { formatQty, useWarehouses } from "@/components/inventory/shared";

// ── Building blocks ────────────────────────────────────────────

type Column<T> = {
  label: string;
  align?: "right";
  hideBelow?: "md" | "lg";
  render: (row: T) => ReactNode;
};

export function ReportTable<T>({ columns, rows, rowKey, footer }: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  footer?: ReactNode;
}) {
  const hide = (c: Column<T>) => (c.hideBelow === "md" ? "hidden md:table-cell" : c.hideBelow === "lg" ? "hidden lg:table-cell" : "");
  return (
    <div className="bg-surface rounded-2xl border border-border overflow-hidden">
      <div className="max-h-[calc(100vh-320px)] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-border bg-surface-2">
              {columns.map((c) => (
                <th
                  key={c.label}
                  className={cn(
                    "px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary whitespace-nowrap",
                    c.align === "right" ? "text-right" : "text-left",
                    hide(c),
                  )}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={rowKey(row)} className="border-b border-border-light last:border-0 hover:bg-surface-1">
                {columns.map((c) => (
                  <td
                    key={c.label}
                    className={cn("px-4 py-2.5 text-text-primary", c.align === "right" && "text-right tabular-nums", hide(c))}
                  >
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {footer}
        </table>
      </div>
    </div>
  );
}

export function Loading() {
  return (
    <div className="flex items-center justify-center py-16">
      <Spinner size="md" className="text-brand-600" />
    </div>
  );
}

export function LoadError({ what }: { what: string }) {
  return (
    <EmptyState
      icon={<Icon icon={Alert02Icon} size={20} className="text-text-tertiary" />}
      title={`Could not load ${what}`}
      description="Try again in a moment."
    />
  );
}

export function ExportButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="btn-secondary inline-flex items-center gap-1.5 text-xs">
      <Icon icon={Download04Icon} size={14} />
      Export CSV
    </button>
  );
}

function WarehouseFilter({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { data } = useWarehouses();
  const active = (data ?? []).filter((w) => w.status === "active");
  if (active.length < 2) return null;
  return (
    <div className="w-56">
      <Listbox
        value={value}
        onChange={onChange}
        options={[{ value: "", label: "All warehouses" }, ...active.map((w) => ({ value: w.id, label: w.name }))]}
      />
    </div>
  );
}

const valuationLabel = (m?: string) => (m === "fifo" ? "FIFO" : "average cost");

// ── Stock ledger ───────────────────────────────────────────────

export function StockLedgerReport({ fromDate, toDate }: { fromDate?: string; toDate?: string }) {
  const [itemId, setItemId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [search, setSearch] = useState("");
  const debounced = useDebounce(search, 300);

  const { data: items, isFetching } = trpc.item.list.useQuery({ search: debounced || undefined, page: 1, limit: 50 });
  const picked = items?.data.find((i) => i.id === itemId);
  const { data: variants } = trpc.item.listVariants.useQuery(
    { itemId },
    { enabled: !!itemId && picked?.itemMode === "variants" },
  );
  const needsVariant = picked?.itemMode === "variants";
  const ready = !!itemId && !!fromDate && !!toDate && (!needsVariant || !!variantId);

  const { data, isLoading, error } = trpc.inventoryReports.stockLedger.useQuery(
    {
      itemId,
      variantId: variantId || null,
      warehouseId: warehouseId || null,
      fromDate: fromDate!,
      toDate: toDate!,
    },
    { enabled: ready },
  );
  const unit = picked?.unit ?? "";

  function exportCsv() {
    if (!data || !picked) return;
    downloadCSV(
      `stock-ledger-${picked.name}`,
      ["Date", "Particulars", "Party", "Warehouse", "Inward", "Outward", "Balance"],
      [
        ["", "Opening balance", "", "", "", "", data.opening],
        ...data.lines.map((l) => [formatDate(l.date), l.particulars, l.party ?? "", l.warehouse, l.inward || "", l.outward || "", l.balance]),
        ["", "Closing balance", "", "", data.inward, data.outward, data.closing],
      ],
    );
  }

  return (
    <div>
      <div className="flex items-end gap-2 mb-4 flex-wrap">
        <div className="w-72">
          <Combobox
            label="Item"
            value={itemId}
            onChange={(id) => { setItemId(id); setVariantId(""); }}
            options={(items?.data ?? []).map((i) => ({ value: i.id, label: i.name }))}
            placeholder="Choose an item…"
            emptyMessage="No items found"
            onQueryChange={setSearch}
            isLoading={isFetching && !!debounced}
          />
        </div>
        {needsVariant && (
          <div className="w-56">
            <Listbox
              label="Variant"
              value={variantId}
              onChange={setVariantId}
              placeholder="Choose a variant"
              options={(variants ?? []).map((v) => ({
                value: v.id,
                label: Object.values((v.attributeValues ?? {}) as Record<string, string>).join(" / ") || "Variant",
              }))}
            />
          </div>
        )}
        <WarehouseFilter value={warehouseId} onChange={setWarehouseId} />
        {data && <div className="ml-auto"><ExportButton onClick={exportCsv} /></div>}
      </div>

      {!ready ? (
        <EmptyState
          icon={<Icon icon={Alert02Icon} size={20} className="text-text-tertiary" />}
          title="Choose an item"
          description="See every movement of an item in the period, with its running balance."
        />
      ) : isLoading ? <Loading /> : error || !data ? <LoadError what="the stock ledger" /> : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <StatCard size="lg" label="Opening" value={formatQty(data.opening, unit)} />
            <StatCard size="lg" label="Inward" value={formatQty(data.inward, unit)} valueColor="text-emerald-600 dark:text-emerald-400" />
            <StatCard size="lg" label="Outward" value={formatQty(data.outward, unit)} valueColor="text-red-600 dark:text-red-400" />
            <StatCard size="lg" label="Closing" value={formatQty(data.closing, unit)} />
          </div>
          {data.lines.length === 0 ? (
            <EmptyState
              icon={<Icon icon={Alert02Icon} size={20} className="text-text-tertiary" />}
              title="No movements in this period"
              description={`The balance stayed at ${formatQty(data.opening, unit)}.`}
            />
          ) : (
            <ReportTable
              rows={data.lines}
              rowKey={(l) => l.id}
              columns={[
                { label: "Date", render: (l) => formatDate(l.date) },
                { label: "Particulars", render: (l) => (
                  <div>
                    <p>{l.particulars}</p>
                    {l.party && <p className="text-xs text-text-tertiary">{l.party}</p>}
                  </div>
                ) },
                { label: "Warehouse", hideBelow: "md", render: (l) => <span className="text-text-secondary">{l.warehouse}</span> },
                { label: "Inward", align: "right", render: (l) => (l.inward ? formatQty(l.inward) : "") },
                { label: "Outward", align: "right", render: (l) => (l.outward ? formatQty(l.outward) : "") },
                { label: "Balance", align: "right", render: (l) => <span className="font-medium">{formatQty(l.balance)}</span> },
              ]}
            />
          )}
          {data.truncated && (
            <p className="mt-2 text-xs text-text-tertiary">Showing the first 2,000 movements — narrow the period to see the rest.</p>
          )}
        </>
      )}
    </div>
  );
}

// ── Movement summary ───────────────────────────────────────────

export function MovementSummaryReport({ fromDate, toDate }: { fromDate?: string; toDate?: string }) {
  const [warehouseId, setWarehouseId] = useState("");
  const { data, isLoading, error } = trpc.inventoryReports.movementSummary.useQuery(
    { fromDate: fromDate!, toDate: toDate!, warehouseId: warehouseId || null },
    { enabled: !!fromDate && !!toDate },
  );

  function exportCsv() {
    if (!data) return;
    downloadCSV(
      "stock-movement-summary",
      ["Item", "Unit", "Opening", "Inward", "Outward", "Closing", "Closing value"],
      data.data.map((r) => [r.name, r.unit, r.opening, r.inward, r.outward, r.closing, r.closingValue]),
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <WarehouseFilter value={warehouseId} onChange={setWarehouseId} />
        {data && (
          <p className="text-xs text-text-tertiary">
            Closing value at {valuationLabel(data.valuationMethod)}: <span className="font-semibold text-text-primary">{formatCurrency(data.totals.closingValue)}</span>
          </p>
        )}
        {data && <div className="ml-auto"><ExportButton onClick={exportCsv} /></div>}
      </div>
      {isLoading ? <Loading /> : error || !data ? <LoadError what="the movement summary" /> : data.data.length === 0 ? (
        <EmptyState icon={<Icon icon={Alert02Icon} size={20} className="text-text-tertiary" />} title="No stock movements" description="Nothing moved in this period." />
      ) : (
        <ReportTable
          rows={data.data}
          rowKey={(r) => `${r.itemId}:${r.variantId ?? ""}`}
          columns={[
            { label: "Item", render: (r) => r.name },
            { label: "Opening", align: "right", hideBelow: "md", render: (r) => formatQty(r.opening) },
            { label: "Inward", align: "right", render: (r) => <span className="text-emerald-700 dark:text-emerald-400">{formatQty(r.inward)}</span> },
            { label: "Outward", align: "right", render: (r) => <span className="text-red-600 dark:text-red-400">{formatQty(r.outward)}</span> },
            { label: "Closing", align: "right", render: (r) => <span className="font-medium">{formatQty(r.closing, r.unit)}</span> },
            { label: "Value", align: "right", hideBelow: "md", render: (r) => formatCurrency(r.closingValue) },
          ]}
        />
      )}
    </div>
  );
}

// ── Godown summary ─────────────────────────────────────────────

export function GodownSummaryReport() {
  const { data, isLoading, error } = trpc.inventoryReports.godownSummary.useQuery();
  if (isLoading) return <Loading />;
  if (error || !data) return <LoadError what="the godown summary" />;

  return (
    <div>
      <div className="flex items-center mb-4">
        <p className="text-xs text-text-tertiary">
          Total stock value at {valuationLabel(data.valuationMethod)}: <span className="font-semibold text-text-primary">{formatCurrency(data.totalValue)}</span>
        </p>
        <div className="ml-auto">
          <ExportButton onClick={() => downloadCSV(
            "godown-summary",
            ["Warehouse", "Code", "Premises", "Status", "Items", "Quantity", "Value"],
            data.data.map((w) => [w.name, w.code, w.premise ?? "", w.status, w.itemCount, w.quantity, w.value]),
          )} />
        </div>
      </div>
      <ReportTable
        rows={data.data}
        rowKey={(w) => w.id}
        columns={[
          { label: "Warehouse", render: (w) => (
            <div>
              <p className={cn(w.status !== "active" && "text-text-tertiary")}>{w.name}</p>
              <p className="text-xs text-text-tertiary">{w.code}{w.premise ? ` · ${w.premise}` : ""}</p>
            </div>
          ) },
          { label: "Items", align: "right", render: (w) => w.itemCount },
          { label: "Quantity", align: "right", hideBelow: "md", render: (w) => formatQty(w.quantity) },
          { label: "Value", align: "right", render: (w) => <span className="font-medium">{formatCurrency(w.value)}</span> },
        ]}
      />
    </div>
  );
}

// ── Stock ageing ───────────────────────────────────────────────

export function StockAgeingReport() {
  const { data, isLoading, error } = trpc.inventoryReports.ageing.useQuery();
  if (isLoading) return <Loading />;
  if (error || !data) return <LoadError what="stock ageing" />;

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        {data.bucketLabels.map((label, i) => (
          <StatCard
            key={label}
            size="lg"
            label={label}
            value={formatCurrency(data.bucketTotals[i] ?? 0)}
            valueColor={i >= 3 ? "text-amber-600 dark:text-amber-400" : undefined}
          />
        ))}
      </div>
      <div className="flex justify-end mb-3">
        <ExportButton onClick={() => downloadCSV(
          "stock-ageing",
          ["Item", "Quantity", "Value", ...data.bucketLabels],
          data.data.map((r) => [r.name, r.quantity, r.value, ...r.buckets.map((b) => b.value)]),
        )} />
      </div>
      {data.data.length === 0 ? (
        <EmptyState icon={<Icon icon={Alert02Icon} size={20} className="text-text-tertiary" />} title="No stock on hand" description="Ageing shows once you hold stock." />
      ) : (
        <ReportTable
          rows={data.data}
          rowKey={(r) => `${r.itemId}:${r.variantId ?? ""}`}
          columns={[
            { label: "Item", render: (r) => (
              <div>
                <p>{r.name}</p>
                <p className="text-xs text-text-tertiary">{formatQty(r.quantity, r.unit)} · {formatCurrency(r.value)}</p>
              </div>
            ) },
            ...data.bucketLabels.map((label, i) => ({
              label,
              align: "right" as const,
              hideBelow: i === 0 || i === 4 ? undefined : ("md" as const),
              render: (r: (typeof data.data)[number]) =>
                r.buckets[i]!.quantity ? (
                  <span className={cn(i >= 3 && "text-amber-700 dark:text-amber-400")}>{formatQty(r.buckets[i]!.quantity)}</span>
                ) : "",
            })),
          ]}
        />
      )}
    </div>
  );
}

// ── Reorder status ─────────────────────────────────────────────

export function ReorderStatusReport() {
  const [coverDays, setCoverDays] = useState(30);
  const { data, isLoading, error } = trpc.inventoryReports.reorderStatus.useQuery({ coverDays });
  if (isLoading) return <Loading />;
  if (error || !data) return <LoadError what="reorder status" />;

  return (
    <div>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="w-48">
          <Listbox
            value={String(coverDays)}
            onChange={(v) => setCoverDays(Number(v))}
            options={[15, 30, 45, 60, 90].map((d) => ({ value: String(d), label: `Order for ${d} days` }))}
          />
        </div>
        <p className="text-xs text-text-tertiary">Suggested order = shortfall to the reorder level + {coverDays} days of sales at the last 30 days' pace.</p>
        {data.data.length > 0 && (
          <div className="ml-auto">
            <ExportButton onClick={() => downloadCSV(
              "reorder-status",
              ["Item", "SKU", "On hand", "Reorder level", "Shortfall", "Sold per day", "Days left", "Suggested order"],
              data.data.map((r) => [r.name, r.sku ?? "", r.onHand, r.reorderLevel, r.shortfall, r.dailySales, r.daysLeft ?? "", r.suggestedOrder]),
            )} />
          </div>
        )}
      </div>
      {data.data.length === 0 ? (
        <EmptyState
          icon={<Icon icon={Alert02Icon} size={20} className="text-text-tertiary" />}
          title="Nothing to reorder"
          description="Every item with a low-stock alert is above its level."
        />
      ) : (
        <ReportTable
          rows={data.data}
          rowKey={(r) => `${r.itemId}:${r.variantId ?? ""}`}
          columns={[
            { label: "Item", render: (r) => (
              <div>
                <p>{r.name}</p>
                {r.sku && <p className="text-xs text-text-tertiary">{r.sku}</p>}
              </div>
            ) },
            { label: "On hand", align: "right", render: (r) => <span className="text-red-600 dark:text-red-400">{formatQty(r.onHand, r.unit)}</span> },
            { label: "Reorder level", align: "right", hideBelow: "md", render: (r) => formatQty(r.reorderLevel) },
            { label: "Sold / day", align: "right", hideBelow: "lg", render: (r) => formatQty(r.dailySales) },
            { label: "Days left", align: "right", hideBelow: "md", render: (r) => (r.daysLeft === null ? "—" : r.daysLeft) },
            { label: "Suggested order", align: "right", render: (r) => <span className="font-semibold">{formatQty(r.suggestedOrder, r.unit)}</span> },
          ]}
        />
      )}
    </div>
  );
}

// ── Dead stock ─────────────────────────────────────────────────

export function DeadStockReport() {
  const [days, setDays] = useState(90);
  const { data, isLoading, error } = trpc.inventoryReports.deadStock.useQuery({ days });
  if (isLoading) return <Loading />;
  if (error || !data) return <LoadError what="dead stock" />;

  return (
    <div>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="w-48">
          <Listbox
            value={String(days)}
            onChange={(v) => setDays(Number(v))}
            options={[30, 60, 90, 180, 365].map((d) => ({ value: String(d), label: `Not sold in ${d} days` }))}
          />
        </div>
        <p className="text-xs text-text-tertiary">
          {data.data.length} items holding <span className="font-semibold text-text-primary">{formatCurrency(data.totalValue)}</span>
        </p>
        {data.data.length > 0 && (
          <div className="ml-auto">
            <ExportButton onClick={() => downloadCSV(
              "dead-stock",
              ["Item", "Category", "Quantity", "Value", "Last sold", "Days idle"],
              data.data.map((r) => [r.name, r.category ?? "", r.quantity, r.value, r.lastSold ? formatDate(r.lastSold) : "Never", r.idleDays ?? ""]),
            )} />
          </div>
        )}
      </div>
      {data.data.length === 0 ? (
        <EmptyState
          icon={<Icon icon={Alert02Icon} size={20} className="text-text-tertiary" />}
          title="No dead stock"
          description={`Everything in stock has sold within the last ${days} days.`}
        />
      ) : (
        <ReportTable
          rows={data.data}
          rowKey={(r) => `${r.itemId}:${r.variantId ?? ""}`}
          columns={[
            { label: "Item", render: (r) => r.name },
            { label: "Category", hideBelow: "lg", render: (r) => <span className="text-text-secondary">{r.category ?? "—"}</span> },
            { label: "Quantity", align: "right", render: (r) => formatQty(r.quantity, r.unit) },
            { label: "Value", align: "right", render: (r) => <span className="font-medium">{formatCurrency(r.value)}</span> },
            { label: "Last sold", align: "right", hideBelow: "md", render: (r) => (r.lastSold ? formatDate(r.lastSold) : "Never") },
          ]}
        />
      )}
    </div>
  );
}

// ── Stock group summary ────────────────────────────────────────

type GroupSummaryRow =
  | { kind: "group"; id: string; name: string; itemCount: number; quantity: number; value: number }
  | { kind: "item"; id: string; name: string; unit: string; quantity: number; rate: number; value: number };

/** Groups not in any group; drilled into like a group. */
const UNGROUPED = "none";

/**
 * Tally's stock group summary: each group's closing quantity and value
 * (including the groups under it). Click a group to see what's inside it.
 */
export function StockGroupSummaryReport({ toDate }: { toDate?: string }) {
  const [groupId, setGroupId] = useState<string | null>(null);
  const { data, isLoading, error } = trpc.inventoryReports.stockGroupSummary.useQuery({ asOf: toDate });
  if (isLoading) return <Loading />;
  if (error || !data) return <LoadError what="the stock group summary" />;

  const byId = new Map(data.groups.map((g) => [g.id, g]));
  const current = groupId && groupId !== UNGROUPED ? byId.get(groupId) ?? null : null;
  // Breadcrumb from the top down to the open group.
  const path: Array<{ id: string; name: string }> = [];
  for (let g = current; g; g = g.parentId ? byId.get(g.parentId) ?? null : null) path.unshift({ id: g.id, name: g.name });
  if (groupId === UNGROUPED) path.push({ id: UNGROUPED, name: "Not in a group" });

  const parentKey = groupId === UNGROUPED ? undefined : current?.id ?? null;
  const rows: GroupSummaryRow[] = [
    ...data.groups
      .filter((g) => parentKey !== undefined && (g.parentId ?? null) === parentKey && (g.itemCount > 0 || g.value !== 0))
      .map((g) => ({ kind: "group" as const, id: g.id, name: g.name, itemCount: g.itemCount, quantity: g.quantity, value: g.value })),
    ...(groupId === null && data.ungrouped.itemCount > 0
      ? [{ kind: "group" as const, id: UNGROUPED, name: "Not in a group", ...data.ungrouped }]
      : []),
    ...(groupId !== null
      ? data.items
          .filter((i) => (groupId === UNGROUPED ? i.groupId === null : i.groupId === groupId))
          .map((i) => ({ kind: "item" as const, id: `${i.itemId}:${i.variantId ?? ""}`, name: i.name, unit: i.unit, quantity: i.quantity, rate: i.rate, value: i.value }))
      : []),
  ];
  const levelValue = rows.reduce((s, r) => s + r.value, 0);

  return (
    <div>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <nav className="flex items-center gap-1 text-sm" aria-label="Stock group path">
          <button className={cn("font-medium", groupId ? "text-brand-600 hover:underline dark:text-brand-400" : "text-text-primary")} onClick={() => setGroupId(null)}>
            All groups
          </button>
          {path.map((p, i) => (
            <span key={p.id} className="flex items-center gap-1">
              <span className="text-text-tertiary">›</span>
              <button
                className={cn("font-medium", i < path.length - 1 ? "text-brand-600 hover:underline dark:text-brand-400" : "text-text-primary")}
                onClick={() => setGroupId(p.id)}
              >
                {p.name}
              </button>
            </span>
          ))}
        </nav>
        <p className="text-xs text-text-tertiary">
          · Value at {valuationLabel(data.valuationMethod)}: <span className="font-semibold text-text-primary">{formatCurrency(levelValue)}</span>
          {groupId && <> of {formatCurrency(data.totalValue)}</>}
        </p>
        <div className="ml-auto">
          <ExportButton onClick={() => downloadCSV(
            "stock-group-summary",
            ["Group", "Parent", "Items", "Quantity", "Value"],
            [
              ...data.groups.map((g) => [g.name, g.parentId ? byId.get(g.parentId)?.name ?? "" : "", g.itemCount, g.quantity, g.value]),
              ["Not in a group", "", data.ungrouped.itemCount, data.ungrouped.quantity, data.ungrouped.value],
            ],
          )} />
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          icon={<Icon icon={Alert02Icon} size={20} className="text-text-tertiary" />}
          title="No stock here"
          description={groupId ? "Nothing in this group holds stock." : "Add stock groups under Inventory → Stock Groups and file your items in them."}
        />
      ) : (
        <ReportTable
          rows={rows}
          rowKey={(r) => `${r.kind}:${r.id}`}
          columns={[
            { label: "Particulars", render: (r) => r.kind === "group" ? (
              <button className="text-left font-medium text-brand-600 hover:underline dark:text-brand-400" onClick={() => setGroupId(r.id)}>
                {r.name}
                <span className="ml-1.5 text-xs font-normal text-text-tertiary">{r.itemCount} item{r.itemCount === 1 ? "" : "s"}</span>
              </button>
            ) : r.name },
            { label: "Quantity", align: "right", render: (r) => formatQty(r.quantity, r.kind === "item" ? r.unit : undefined) },
            { label: "Rate", align: "right", hideBelow: "md", render: (r) => (r.kind === "item" ? formatCurrency(r.rate) : "") },
            { label: "Value", align: "right", render: (r) => <span className="font-medium">{formatCurrency(r.value)}</span> },
          ]}
        />
      )}
    </div>
  );
}
