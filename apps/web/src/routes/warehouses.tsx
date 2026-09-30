import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import { Building03Icon, CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import { usePageSearch } from "@/lib/page-search";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { PageHeader } from "@/components/ui/PageHeader";
import { SlideOver } from "@/components/ui/SlideOver";
import { InputField } from "@/components/ui/FormField";
import { Listbox } from "@/components/ui/Listbox";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { Pagination } from "@/components/ui/Pagination";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils";
import { formatQty, useWarehouses } from "@/components/inventory/shared";

export const Route = createFileRoute("/warehouses")({
  component: WarehousesPage,
});

const PAGE_SIZE = 25;

const TYPE_OPTIONS = [
  { value: "main", label: "Main warehouse" },
  { value: "godown", label: "Godown" },
  { value: "store", label: "Shop / store" },
  { value: "transit", label: "In transit" },
  { value: "other", label: "Other" },
];
const TYPE_LABEL = Object.fromEntries(TYPE_OPTIONS.map((t) => [t.value, t.label]));

const POLICY_OPTIONS = [
  { value: "allow", label: "Allow", hint: "Stock can go below zero without a warning." },
  { value: "warn", label: "Warn", hint: "Entry forms flag a shortfall, but saving still works." },
  { value: "block", label: "Block", hint: "Documents that would take a warehouse below zero can't be saved." },
] as const;

const VALUATION_OPTIONS = [
  { value: "weighted_average", label: "Average cost", hint: "Stock is valued at the average cost of its purchases." },
  { value: "fifo", label: "FIFO", hint: "What's left is valued at the most recent purchase prices." },
] as const;

type Option = { value: string; label: string; hint: string };

/** One setting: its title and current explanation, and a segmented choice. */
function SettingRow({
  title,
  options,
  value,
  canEdit,
  pending,
  onChange,
}: {
  title: string;
  options: readonly Option[];
  value: string;
  canEdit: boolean;
  pending: boolean;
  onChange: (value: string) => void;
}) {
  const current = options.find((o) => o.value === value) ?? options[0]!;
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 p-5">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
        <p className="mt-0.5 text-xs text-text-tertiary">{current.hint}</p>
      </div>
      {canEdit ? (
        <div className="inline-flex rounded-lg border border-border-light p-0.5" role="radiogroup" aria-label={title}>
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={o.value === current.value}
              disabled={pending}
              onClick={() => o.value !== current.value && onChange(o.value)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                o.value === current.value ? "bg-brand-600 text-white" : "text-text-secondary hover:bg-surface-2",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      ) : (
        <span className="rounded-full bg-surface-2 px-3 py-1 text-xs font-medium text-text-secondary">{current.label}</span>
      )}
    </div>
  );
}

/** Business-wide stock rules: selling below zero, and how stock is valued. */
function InventorySettings() {
  const utils = trpc.useUtils();
  const { data: session } = trpc.auth.me.useQuery();
  const { data: settings } = trpc.stock.settings.useQuery();
  const canEdit = ["owner", "admin", "superadmin"].includes(session?.role ?? "");
  const update = trpc.stock.updateSettings.useMutation({
    onSuccess: () => {
      utils.stock.settings.invalidate();
      utils.stock.availability.invalidate();
      utils.reports.invalidate();
      toast.success("Inventory setting saved");
    },
    onError: (err) => toast.error(err.message),
  });
  if (!settings) return null;

  return (
    <div className="card mb-6 divide-y divide-border-light">
      <SettingRow
        title="Selling more than you have"
        options={POLICY_OPTIONS}
        value={settings.negativeStockPolicy}
        canEdit={canEdit}
        pending={update.isPending}
        onChange={(v) => update.mutate({ negativeStockPolicy: v as (typeof POLICY_OPTIONS)[number]["value"] })}
      />
      <SettingRow
        title="Stock valuation"
        options={VALUATION_OPTIONS}
        value={settings.valuationMethod}
        canEdit={canEdit}
        pending={update.isPending}
        onChange={(v) => update.mutate({ valuationMethod: v as (typeof VALUATION_OPTIONS)[number]["value"] })}
      />
    </div>
  );
}

function WarehousesPage() {
  const utils = trpc.useUtils();
  const { data: warehouses, isLoading } = useWarehouses();
  const [search] = usePageSearch("Search item or SKU…");
  const [page, setPage] = useState(1);
  // A new search starts from the first page.
  useEffect(() => setPage(1), [search]);
  const { data: balances, isFetching } = trpc.stock.balances.useQuery(
    { search: search || undefined, page, limit: PAGE_SIZE },
    { placeholderData: keepPreviousData },
  );

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", code: "", warehouseType: "godown", premiseId: "", address: "" });
  const { data: premises } = trpc.warehouse.premiseList.useQuery(undefined, { enabled: open });
  const premiseId = form.premiseId || premises?.[0]?.id || "";

  const create = trpc.warehouse.warehouseCreate.useMutation({
    onSuccess: async () => {
      await utils.stock.warehouses.invalidate();
      toast({ title: "Warehouse added", variant: "success" });
      setOpen(false);
      setForm({ name: "", code: "", warehouseType: "godown", premiseId: "", address: "" });
    },
    onError: (e) => toast({ title: "Couldn't add warehouse", description: e.message, variant: "error" }),
  });

  // A business that has never moved stock has no warehouse yet; set up Main.
  const setup = trpc.stock.setup.useMutation({ onSuccess: () => utils.stock.warehouses.invalidate() });
  const needsSetup = !!warehouses && warehouses.length === 0;
  useEffect(() => {
    if (needsSetup && setup.isIdle) setup.mutate();
  }, [needsSetup]); // eslint-disable-line react-hooks/exhaustive-deps

  const active = (warehouses ?? []).filter((w) => w.status === "active");
  const totalPages = balances ? Math.max(1, Math.ceil(balances.total / PAGE_SIZE)) : 1;

  return (
    <div>
      <PageHeader
        title="Warehouses"
        description="Where your stock is kept, and how much each place holds"
        actions={
          <button className="btn-primary" onClick={() => setOpen(true)}>
            + Add warehouse
          </button>
        }
      />

      {/* Warehouse cards */}
      {isLoading ? (
        <SkeletonRows count={2} height="h-24" />
      ) : (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {(warehouses ?? []).map((w) => (
            <div key={w.id} className={cn("card p-5", w.status !== "active" && "opacity-60")}>
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-950 dark:text-brand-300">
                  <Icon icon={Building03Icon} size={19} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-semibold text-text-primary">
                    <span className="truncate">{w.name}</span>
                    {w.isDefault && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                        <Icon icon={CheckmarkCircle02Icon} size={12} />
                        Default
                      </span>
                    )}
                    {w.status !== "active" && (
                      <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-text-secondary">Inactive</span>
                    )}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-text-tertiary">
                    {w.code} · {TYPE_LABEL[w.warehouseType] ?? w.warehouseType}
                    {w.premiseName ? ` · ${w.premiseName}` : ""}
                  </p>
                </div>
              </div>
              <div className="mt-4 flex items-end justify-between border-t border-border-light pt-3">
                <div>
                  <p className="text-[11px] text-text-tertiary">Units in stock</p>
                  <p className="text-lg font-bold tabular-nums text-text-primary">{formatQty(w.quantity)}</p>
                </div>
                <p className="max-w-[55%] truncate text-right text-xs text-text-tertiary">{w.address || "No address"}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <InventorySettings />

      {/* Stock by warehouse */}
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-light px-4 py-3">
          <h2 className="text-sm font-semibold text-text-primary">Stock by warehouse</h2>
        </div>
        {!balances ? (
          <SkeletonRows />
        ) : balances.data.length === 0 ? (
          <EmptyState
            title="No stock items"
            description={search ? "No items match your search" : "Products you add under Items appear here"}
          />
        ) : (
          <>
            <div className={cn("overflow-x-auto", isFetching && "opacity-70")}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    {active.map((w) => (
                      <th key={w.id} className="text-right whitespace-nowrap">{w.name}</th>
                    ))}
                    <th className="text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {balances.data.map((row) => {
                    const low = row.lowStock !== null && parseFloat(row.total) <= parseFloat(row.lowStock);
                    return (
                      <tr key={`${row.itemId}:${row.variantId ?? ""}`}>
                        <td>
                          <p className="font-medium text-text-primary">{row.name}</p>
                          {row.sku && <p className="text-xs text-text-tertiary">{row.sku}</p>}
                        </td>
                        {active.map((w) => {
                          const q = parseFloat(row.byWarehouse[w.id] ?? "0");
                          return (
                            <td key={w.id} className={cn("text-right tabular-nums", q === 0 ? "text-text-tertiary" : "text-text-secondary")}>
                              {formatQty(q)}
                            </td>
                          );
                        })}
                        <td className={cn("text-right font-semibold tabular-nums", low ? "text-amber-700 dark:text-amber-400" : "text-text-primary")}>
                          {formatQty(row.total, row.unit)}
                          {low && <span className="ml-1.5 text-[11px] font-medium">low</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="border-t border-border-light px-4 py-3">
              <Pagination page={page} totalPages={totalPages} onPageChange={setPage} total={balances.total} pageSize={PAGE_SIZE} />
            </div>
          </>
        )}
      </div>

      <SlideOver
        open={open}
        onClose={() => setOpen(false)}
        title="Add warehouse"
        description="A godown, shop or any place you keep stock"
        footer={
          <div className="flex justify-end gap-3">
            <button className="btn-secondary" onClick={() => setOpen(false)} disabled={create.isPending}>
              Cancel
            </button>
            <button
              className="btn-primary"
              disabled={create.isPending || !form.name.trim() || !form.code.trim() || !premiseId}
              onClick={() =>
                create.mutate({
                  premiseId,
                  name: form.name.trim(),
                  code: form.code.trim().toUpperCase(),
                  warehouseType: form.warehouseType,
                  address: form.address.trim() || null,
                })
              }
            >
              {create.isPending ? "Adding..." : "Add warehouse"}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <InputField
            label="Name"
            required
            autoFocus
            placeholder="e.g. Pune godown"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <div className="grid grid-cols-2 gap-4">
            <InputField
              label="Short code"
              required
              placeholder="e.g. PUNE"
              value={form.code}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
            />
            <Listbox
              label="Type"
              value={form.warehouseType}
              onChange={(v) => setForm((f) => ({ ...f, warehouseType: v }))}
              options={TYPE_OPTIONS}
            />
          </div>
          {(premises?.length ?? 0) > 1 && (
            <Listbox
              label="Premises"
              value={premiseId}
              onChange={(v) => setForm((f) => ({ ...f, premiseId: v }))}
              options={(premises ?? []).map((p) => ({ value: p.id, label: p.name }))}
            />
          )}
          <InputField
            label="Address (optional)"
            placeholder="Street, city"
            value={form.address}
            onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
          />
        </div>
      </SlideOver>
    </div>
  );
}
