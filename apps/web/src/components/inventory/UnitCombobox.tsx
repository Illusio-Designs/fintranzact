import { useMemo, useState } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";
import { Combobox, type ComboboxOption } from "@/components/ui/Combobox";
import { formatQty, unitKey } from "@/components/inventory/shared";

export type UnitChoice = { name: string; unit: string };

/**
 * Pick a stock unit (an item, or one variant of a variant item). `known`
 * supplies the label for a value chosen earlier (e.g. loaded from a BOM), so
 * it shows even when the current search doesn't include it.
 */
export function UnitCombobox({
  label,
  value,
  onChange,
  known,
  placeholder = "Search items",
}: {
  label?: string;
  value: string;
  onChange: (key: string, info: UnitChoice | null) => void;
  known?: UnitChoice | null;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const { data, isFetching } = trpc.stock.balances.useQuery(
    { search: query || undefined, page: 1, limit: 30 },
    { placeholderData: keepPreviousData, staleTime: 30_000 },
  );
  const units = useMemo(() => data?.data ?? [], [data]);
  const options: ComboboxOption[] = useMemo(() => {
    const list = units.map((u) => ({
      value: unitKey(u.itemId, u.variantId),
      label: u.name,
      description: `${formatQty(u.total, u.unit)} in stock${u.sku ? ` · ${u.sku}` : ""}`,
    }));
    if (value && known && !list.some((o) => o.value === value)) list.unshift({ value, label: known.name, description: "" });
    return list;
  }, [units, value, known]);

  return (
    <Combobox
      label={label}
      value={value}
      onChange={(v) => {
        const u = units.find((x) => unitKey(x.itemId, x.variantId) === v);
        onChange(v, u ? { name: u.name, unit: u.unit } : null);
      }}
      options={options}
      onQueryChange={setQuery}
      isLoading={isFetching}
      placeholder={placeholder}
      emptyMessage="No stock items match"
    />
  );
}
