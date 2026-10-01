import { useMemo, useState } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import { Add01Icon, Delete02Icon } from "@hugeicons/core-free-icons";
import { trpc } from "@/lib/trpc";
import { Combobox, type ComboboxOption } from "@/components/ui/Combobox";
import { Listbox } from "@/components/ui/Listbox";
import { Icon } from "@/components/ui/Icon";
import { BatchInFields, BatchOutSelect, type BatchInValue } from "@/components/inventory/BatchFields";

/** A stock unit is an item, or one variant of a variant item. */
export function unitKey(itemId: string, variantId: string | null | undefined) {
  return `${itemId}:${variantId ?? ""}`;
}

export function parseUnitKey(key: string) {
  const [itemId, variantId] = key.split(":");
  return { itemId: itemId!, variantId: variantId || null };
}

/** "12.5 kg" — trims trailing zeros from the 3-decimal stock values. */
export function formatQty(value: string | number, unit?: string | null) {
  const n = typeof value === "number" ? value : parseFloat(value);
  const text = Number.isFinite(n) ? n.toLocaleString("en-IN", { maximumFractionDigits: 3 }) : "0";
  return unit ? `${text} ${unit}` : text;
}

export function useWarehouses() {
  const query = trpc.stock.warehouses.useQuery(undefined, { staleTime: 60_000 });
  return { data: query.data, isLoading: query.isLoading };
}

export function WarehouseSelect({
  label,
  value,
  onChange,
  exclude,
  required,
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
  exclude?: string;
  required?: boolean;
}) {
  const { data } = useWarehouses();
  const options = (data ?? [])
    .filter((w) => w.status === "active" && w.id !== exclude)
    .map((w) => ({ value: w.id, label: w.isDefault ? `${w.name} (default)` : w.name }));
  return (
    <Listbox
      label={label}
      value={value}
      onChange={onChange}
      options={options}
      placeholder="Choose a warehouse"
      required={required}
    />
  );
}

export type StockLine = {
  key: string;
  unitKey: string;
  quantity: string;
  /** Items that track batches: the batch taken from (empty = earliest expiry first)… */
  batchId?: string;
  /** …or, for stock added, the batch it goes into. */
  newBatch?: BatchInValue;
};

let lineSeq = 0;
export function newLine(): StockLine {
  lineSeq += 1;
  return { key: `l${lineSeq}`, unitKey: "", quantity: "" };
}

/**
 * Item + quantity rows. Shows how much of each item the given warehouse holds,
 * so people don't have to leave the form to check.
 */
export function StockLinesEditor({
  lines,
  onChange,
  warehouseId,
  quantityLabel = "Quantity",
  allowNegative = false,
  batchMode,
}: {
  lines: StockLine[];
  onChange: (lines: StockLine[]) => void;
  warehouseId?: string;
  quantityLabel?: string;
  allowNegative?: boolean;
  /** Show batch fields for items that track batches: stock going "out" of
   *  the warehouse picks a batch, stock coming "in" names one. */
  batchMode?: "in" | "out";
}) {
  const [query, setQuery] = useState("");
  const { data, isFetching } = trpc.stock.balances.useQuery(
    { search: query || undefined, page: 1, limit: 30 },
    { placeholderData: keepPreviousData },
  );
  // Remember every unit we have seen so chosen rows keep their labels.
  const [seen, setSeen] = useState<Record<string, { name: string; unit: string; byWarehouse: Record<string, string>; trackBatches: boolean; trackExpiry: boolean }>>({});
  const units = data?.data ?? [];
  const options: ComboboxOption[] = useMemo(
    () =>
      units.map((u) => ({
        value: unitKey(u.itemId, u.variantId),
        label: u.name,
        description: warehouseId
          ? `${formatQty(u.byWarehouse[warehouseId] ?? "0", u.unit)} here${u.sku ? ` · ${u.sku}` : ""}`
          : `${formatQty(u.total, u.unit)} in stock${u.sku ? ` · ${u.sku}` : ""}`,
      })),
    [units, warehouseId],
  );

  function update(key: string, patch: Partial<StockLine>) {
    if (patch.unitKey) {
      const u = units.find((x) => unitKey(x.itemId, x.variantId) === patch.unitKey);
      if (u) {
        setSeen((s) => ({
          ...s,
          [patch.unitKey!]: { name: u.name, unit: u.unit, byWarehouse: u.byWarehouse, trackBatches: u.trackBatches, trackExpiry: u.trackExpiry },
        }));
      }
      // A different item starts without a batch.
      patch = { ...patch, batchId: undefined, newBatch: undefined };
    }
    onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  return (
    <div className="space-y-3">
      {lines.map((line, index) => {
        const info = seen[line.unitKey];
        const available = warehouseId && info ? info.byWarehouse[warehouseId] ?? "0" : null;
        const lineOptions = info && !options.some((o) => o.value === line.unitKey)
          ? [{ value: line.unitKey, label: info.name }, ...options]
          : options;
        return (
          <div key={line.key} className="grid grid-cols-[minmax(0,1fr)_120px_36px] items-end gap-2">
            <Combobox
              label={index === 0 ? "Item" : undefined}
              ariaLabel={`Item, line ${index + 1}`}
              value={line.unitKey}
              onChange={(v) => update(line.key, { unitKey: v })}
              options={lineOptions}
              onQueryChange={setQuery}
              isLoading={isFetching}
              placeholder="Search items"
              emptyMessage="No stock items match"
            />
            <div>
              {index === 0 && (
                <label className="mb-1.5 block text-xs font-medium text-text-secondary">{quantityLabel}</label>
              )}
              <input
                className="input tabular-nums"
                inputMode="decimal"
                aria-label={`${quantityLabel} for line ${index + 1}`}
                placeholder={allowNegative ? "e.g. -2" : "0"}
                value={line.quantity}
                onChange={(e) => update(line.key, { quantity: e.target.value })}
              />
            </div>
            <button
              type="button"
              onClick={() => onChange(lines.length > 1 ? lines.filter((l) => l.key !== line.key) : [newLine()])}
              className="mb-0.5 grid h-9 w-9 place-items-center rounded-lg text-text-tertiary hover:bg-red-600/[0.08] hover:text-red-500"
              aria-label={`Remove line ${index + 1}`}
            >
              <Icon icon={Delete02Icon} size={15} />
            </button>
            {available !== null && info && (
              <p className="col-span-3 -mt-1 text-xs text-text-tertiary">
                {formatQty(available, info.unit)} in this warehouse
              </p>
            )}
            {batchMode && info?.trackBatches && (
              <div className="col-span-3 rounded-lg border border-border-light px-3 py-2">
                {batchMode === "out" ? (
                  <BatchOutSelect
                    itemId={parseUnitKey(line.unitKey).itemId}
                    variantId={parseUnitKey(line.unitKey).variantId}
                    warehouseId={warehouseId}
                    needed={Math.abs(parseFloat(line.quantity || "0")) || 0}
                    unit={info.unit}
                    batchId={line.batchId ?? ""}
                    allowExpired
                    expiredAlwaysAllowed
                    onChange={(p) => onChange(lines.map((l) => (l.key === line.key ? { ...l, batchId: p.batchId ?? l.batchId } : l)))}
                  />
                ) : (
                  <BatchInFields
                    itemId={parseUnitKey(line.unitKey).itemId}
                    variantId={parseUnitKey(line.unitKey).variantId}
                    trackExpiry={info.trackExpiry}
                    value={line.newBatch ?? {}}
                    onChange={(p) => onChange(lines.map((l) => (l.key === line.key ? { ...l, newBatch: { ...l.newBatch, ...p } } : l)))}
                  />
                )}
              </div>
            )}
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => onChange([...lines, newLine()])}
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline dark:text-brand-300"
      >
        <Icon icon={Add01Icon} size={15} />
        Add item
      </button>
    </div>
  );
}

/** Lines that have an item and a usable quantity, in API shape. */
export function readyLines(lines: StockLine[], allowNegative = false) {
  return lines
    .filter((l) => l.unitKey && l.quantity.trim() !== "")
    .map((l) => {
      const batchNumber = l.newBatch?.batchNumber?.trim();
      return {
        ...parseUnitKey(l.unitKey),
        quantity: l.quantity.trim(),
        ...(l.batchId ? { batchId: l.batchId } : {}),
        ...(batchNumber
          ? {
              newBatch: {
                batchNumber,
                expiryDate: l.newBatch?.expiryDate || undefined,
                mfgDate: l.newBatch?.mfgDate || undefined,
                mrp: l.newBatch?.batchMrp || undefined,
              },
            }
          : {}),
      };
    })
    .filter((l) => {
      const n = parseFloat(l.quantity);
      return Number.isFinite(n) && (allowNegative ? n !== 0 : n > 0);
    });
}
