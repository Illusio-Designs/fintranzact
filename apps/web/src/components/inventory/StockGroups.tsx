import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { Select } from "@/components/ui/Select";
import { FormField } from "@/components/ui/FormField";

/** Stock groups in tree order, with depth and item counts. */
export function useStockGroups(enabled = true) {
  const query = trpc.stockGroup.list.useQuery(undefined, { staleTime: 60_000, enabled });
  return { data: query.data?.data, ungroupedItemCount: query.data?.ungroupedItemCount ?? 0, isLoading: query.isLoading };
}

/** "Parent › Child" style indent for a group's name in a flat list. */
export function indentedName(name: string, depth: number) {
  return `${"   ".repeat(depth)}${depth > 0 ? "└ " : ""}${name}`;
}

const NEW = "__new__";

/**
 * The stock group an item belongs to. Lists the groups as a tree and lets the
 * user add a new top-level group on the spot. "" means no group.
 */
export function StockGroupPicker({ value, onChange, label = "Stock group" }: {
  value: string;
  onChange: (id: string) => void;
  label?: string;
}) {
  const utils = trpc.useUtils();
  const { data: groups } = useStockGroups();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const create = trpc.stockGroup.create.useMutation({
    onSuccess: async (group) => {
      await utils.stockGroup.list.invalidate();
      onChange(group.id);
      setAdding(false);
      setName("");
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <FormField label={label}>
      <Select
        value={adding ? NEW : value}
        aria-label={label}
        onChange={(e) => {
          if (e.target.value === NEW) {
            setAdding(true);
          } else {
            setAdding(false);
            onChange(e.target.value);
          }
        }}
      >
        <option value="">No group</option>
        {(groups ?? []).map((g) => (
          <option key={g.id} value={g.id}>{indentedName(g.name, g.depth)}</option>
        ))}
        <option value={NEW}>+ New group…</option>
      </Select>
      {adding && (
        <div className="mt-2 flex gap-2">
          <input
            className="input flex-1"
            autoFocus
            value={name}
            placeholder="Group name, e.g. Electronics"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (name.trim()) create.mutate({ name: name.trim() });
              }
              if (e.key === "Escape") setAdding(false);
            }}
          />
          <button
            type="button"
            className="btn-secondary"
            disabled={!name.trim() || create.isPending}
            onClick={() => create.mutate({ name: name.trim() })}
          >
            {create.isPending ? "Adding…" : "Add"}
          </button>
        </div>
      )}
    </FormField>
  );
}

/** Filter by stock group: all, one group (with the groups under it), or none. */
export function StockGroupFilter({ value, onChange, allowNone = false, className }: {
  value: string;
  onChange: (value: string) => void;
  allowNone?: boolean;
  className?: string;
}) {
  const { data: groups } = useStockGroups();
  if (!groups?.length) return null;
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Stock group" className={className}>
      <option value="">All groups</option>
      {groups.map((g) => (
        <option key={g.id} value={g.id}>{indentedName(g.name, g.depth)}</option>
      ))}
      {allowNone && <option value="none">No group</option>}
    </Select>
  );
}
