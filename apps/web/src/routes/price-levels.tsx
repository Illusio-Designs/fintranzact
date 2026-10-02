import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import { mrpWarning } from "@fintranzact/shared";
import { usePageSearch } from "@/lib/page-search";
import { useDebounce } from "@/hooks/useDebounce";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { cn, formatCurrency } from "@/lib/utils";
import { PageHeader } from "@/components/ui/PageHeader";
import { SlideOver } from "@/components/ui/SlideOver";
import { InputField } from "@/components/ui/FormField";
import { Listbox } from "@/components/ui/Listbox";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { Badge } from "@/components/ui/Badge";
import { Pagination } from "@/components/ui/Pagination";
import { RowActions, tidyMenu } from "@/components/ui/Menu";
import { TableScroll } from "@/components/ui/Table";
import { usePageSize } from "@/hooks/usePageSize";

export const Route = createFileRoute("/price-levels")({
  component: PriceLevelsPage,
});

type Level = { id: string; name: string; description: string | null; isDefault: boolean; entryCount?: number; partyCount?: number };
type Row = { itemId: string; variantId: string | null; name: string };
const cellKey = (levelId: string, r: { itemId: string; variantId: string | null }) => `${levelId}:${r.itemId}:${r.variantId ?? ""}`;

function PriceLevelsPage() {
  const utils = trpc.useUtils();
  const [search] = usePageSearch("Search items…");
  const debounced = useDebounce(search, 300);
  const { data: levels } = trpc.priceLevel.list.useQuery();
  const { data: grid, isFetching } = trpc.priceLevel.grid.useQuery(
    { search: debounced || undefined },
    { placeholderData: keepPreviousData },
  );

  const [edits, setEdits] = useState<Record<string, string>>({});
  const [levelForm, setLevelForm] = useState<Level | "new" | null>(null);
  const [deleting, setDeleting] = useState<Level | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [slabs, setSlabs] = useState<{ level: Level; row: Row } | null>(null);

  const invalidate = () => Promise.all([utils.priceLevel.invalidate(), utils.pricing.invalidate()]);

  const saveGrid = trpc.priceLevel.setGridPrices.useMutation({
    onSuccess: async (r) => {
      await invalidate();
      setEdits({});
      toast({ title: `Saved ${r.updated} price${r.updated === 1 ? "" : "s"}`, variant: "success" });
    },
    onError: (e) => toast({ title: "Couldn't save prices", description: e.message, variant: "error" }),
  });
  const remove = trpc.priceLevel.delete.useMutation({
    onSuccess: async () => {
      await invalidate();
      setDeleting(null);
      toast({ title: "Price level deleted", variant: "success" });
    },
    onError: (e) => toast({ title: "Couldn't delete", description: e.message, variant: "error" }),
  });

  const makeDefault = trpc.priceLevel.update.useMutation({
    onSuccess: async () => {
      await invalidate();
      toast({ title: "Default level changed", variant: "success" });
    },
    onError: (e) => toast({ title: "Couldn't change the default", description: e.message, variant: "error" }),
  });

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize("price-levels", 25);
  const tableRef = useRef<HTMLDivElement>(null);
  // A new search or rows-per-page choice starts from the first page.
  useEffect(() => setPage(1), [debounced, pageSize]);
  // A new page starts at its first row.
  useEffect(() => { tableRef.current?.scrollTo({ top: 0 }); }, [page]);
  const totalPages = Math.max(1, Math.ceil((grid?.rows.length ?? 0) / pageSize));
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  const dirty = Object.keys(edits).length;
  function save() {
    const cells = Object.entries(edits).map(([key, price]) => {
      const [priceLevelId, itemId, variantId] = key.split(":");
      return { priceLevelId: priceLevelId!, itemId: itemId!, variantId: variantId || null, price: price.trim() ? String(Number(price)) : null };
    });
    if (cells.some((c) => c.price !== null && !/^\d{1,13}(\.\d{1,2})?$/.test(c.price))) {
      toast({ title: "Prices need at most two decimals", variant: "error" });
      return;
    }
    saveGrid.mutate({ cells });
  }

  return (
    <div>
      <PageHeader
        title="Price Levels"
        description="Selling prices per customer group, such as Retail, Wholesale or Dealer. A customer is billed at their level (or the default one); a blank price falls back to the item's sale price."
        actions={
          <div className="flex gap-2">
            {levels && levels.length > 0 && (
              <button className="btn-secondary" onClick={() => setBulkOpen(true)}>
                Bulk update
              </button>
            )}
            <button className="btn-primary" onClick={() => setLevelForm("new")}>
              + New level
            </button>
          </div>
        }
      />

      {levels && levels.length > 0 && (
        <div className="mb-5 grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
          {levels.map((l) => (
            <div key={l.id} className="card flex items-start justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-semibold text-text-primary">
                  <span className="truncate">{l.name}</span>
                  {l.isDefault && <Badge size="md" color="bg-brand-600/10 text-brand-600 dark:text-brand-400">Default</Badge>}
                </p>
                <p className="mt-1 whitespace-nowrap text-xs tabular-nums text-text-tertiary">
                  {l.entryCount} price{l.entryCount === 1 ? "" : "s"} · {l.partyCount} customer{l.partyCount === 1 ? "" : "s"}
                </p>
                {l.description && <p className="mt-1 line-clamp-2 text-xs text-text-secondary">{l.description}</p>}
              </div>
              <RowActions
                label={l.name}
                items={tidyMenu([
                  { label: "Edit level", onSelect: () => setLevelForm(l) },
                  !l.isDefault && {
                    label: "Make default",
                    disabled: makeDefault.isPending,
                    onSelect: () => makeDefault.mutate({ id: l.id, data: { isDefault: true } }),
                  },
                  { kind: "separator" },
                  { label: "Delete level", danger: true, onSelect: () => setDeleting(l) },
                ])}
              />
            </div>
          ))}
        </div>
      )}

      <div className="rounded-2xl border border-border-light bg-surface-0 overflow-clip">
        {!levels || !grid ? (
          <TableSkeleton columns={[{ label: "Item" }, { label: "Sale price", align: "right" }, { label: "MRP", align: "right" }, { align: "right" }, { align: "right" }, { align: "right" }]} rows={6} />
        ) : levels.length === 0 ? (
          <EmptyState
            title="No price levels yet"
            description="Create a level such as Wholesale, set its prices, then pick it on your customers."
            action={<button className="btn-primary" onClick={() => setLevelForm("new")}>Create a price level</button>}
          />
        ) : grid.rows.length === 0 ? (
          <EmptyState title="No items" description={search ? "No items match your search." : "Add stock items to price them."} />
        ) : (
          <div className={cn("transition-opacity", isFetching && "opacity-60")}>
            <Pagination placement="top" page={page} totalPages={totalPages} onPageChange={setPage} total={grid.rows.length} pageSize={pageSize} />
            <TableScroll ref={tableRef}>
              <table className="data-table w-full">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className="text-right">Sale price</th>
                    <th className="text-right">MRP</th>
                    {grid.levels.map((l) => (
                      <th key={l.id} className="min-w-[140px] text-right">{l.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {grid.rows.slice((page - 1) * pageSize, page * pageSize).map((r) => (
                    <tr key={`${r.itemId}:${r.variantId ?? ""}`}>
                      <td className={cn("font-medium text-text-primary", r.variantId && "pl-8 font-normal text-text-secondary")}>
                        {r.name}
                        <span className="ml-1 text-xs text-text-tertiary">/ {r.unit}</span>
                      </td>
                      <td className="text-right tabular-nums text-text-secondary">{r.salePrice ? formatCurrency(r.salePrice) : "—"}</td>
                      <td className="text-right tabular-nums text-text-secondary">{r.mrp ? formatCurrency(r.mrp) : "—"}</td>
                      {grid.levels.map((l) => {
                        const key = cellKey(l.id, r);
                        const value = edits[key] ?? r.prices[l.id] ?? "";
                        const warn = mrpWarning(value, r.mrp);
                        const extra = r.slabCount[l.id] ?? 0;
                        return (
                          <td key={l.id} className="text-right">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              aria-label={`${r.name} price on ${l.name}`}
                              className={cn("input w-28 py-1 text-right text-sm tabular-nums", key in edits && "border-brand-500", warn && "border-amber-500")}
                              value={value}
                              placeholder={r.salePrice ?? "—"}
                              title={warn ?? undefined}
                              onChange={(e) => {
                                const v = e.target.value;
                                setEdits((prev) => {
                                  const next = { ...prev };
                                  if (v === (r.prices[l.id] ?? "")) delete next[key];
                                  else next[key] = v;
                                  return next;
                                });
                              }}
                            />
                            <button
                              type="button"
                              className={cn(
                                "mt-1 block w-full text-right text-2xs hover:underline",
                                extra > 0 ? "font-medium text-brand-600 dark:text-brand-400" : "text-text-tertiary hover:text-brand-600",
                              )}
                              onClick={() => setSlabs({ level: l, row: r })}
                            >
                              {extra > 0 ? `+${extra} slab/unit/dated` : "Slabs…"}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
            <Pagination
              page={page}
              totalPages={totalPages}
              onPageChange={setPage}
              total={grid.rows.length}
              pageSize={pageSize}
              onPageSizeChange={setPageSize}
            />
            {/* Stays in view while scrolling a long grid, so unsaved prices are never out of sight. */}
            <div
              className={cn(
                "sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-border-light px-4 py-3 transition-colors",
                dirty > 0 ? "bg-brand-50/90 backdrop-blur dark:bg-brand-950/60" : "bg-surface-0",
              )}
            >
              <p className="text-xs text-text-tertiary">
                {dirty > 0
                  ? `${dirty} unsaved price${dirty === 1 ? "" : "s"}, kept when you change page.`
                  : "A blank cell means the item sells at its own sale price on that level."}
              </p>
              <div className="flex gap-2">
                {dirty > 0 && (
                  <button className="btn-secondary" onClick={() => setEdits({})} disabled={saveGrid.isPending}>Discard</button>
                )}
                <button className="btn-primary" disabled={dirty === 0 || saveGrid.isPending} onClick={save}>
                  {saveGrid.isPending ? "Saving…" : dirty > 0 ? `Save ${dirty} change${dirty === 1 ? "" : "s"}` : "Save"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {levelForm && <LevelForm level={levelForm === "new" ? null : levelForm} onClose={() => setLevelForm(null)} />}
      {bulkOpen && levels && <BulkUpdate levels={levels} onClose={() => setBulkOpen(false)} />}
      {slabs && <SlabEditor level={slabs.level} row={slabs.row} onClose={() => setSlabs(null)} />}
      <ConfirmDialog
        open={!!deleting}
        title={`Delete ${deleting?.name ?? ""}?`}
        description="Its prices are removed and its customers are billed at the default level."
        confirmLabel="Delete"
        variant="danger"
        loading={remove.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate({ id: deleting.id })}
      />
    </div>
  );
}

function LevelForm({ level, onClose }: { level: Level | null; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [name, setName] = useState(level?.name ?? "");
  const [description, setDescription] = useState(level?.description ?? "");
  const [isDefault, setIsDefault] = useState(level?.isDefault ?? false);
  const done = async () => {
    await Promise.all([utils.priceLevel.invalidate(), utils.pricing.invalidate()]);
    toast({ title: level ? "Price level saved" : "Price level created", variant: "success" });
    onClose();
  };
  const onError = (e: { message: string }) => toast({ title: "Couldn't save", description: e.message, variant: "error" });
  const create = trpc.priceLevel.create.useMutation({ onSuccess: done, onError });
  const update = trpc.priceLevel.update.useMutation({ onSuccess: done, onError });
  const pending = create.isPending || update.isPending;
  const data = { name: name.trim(), description: description.trim() || null, isDefault };

  return (
    <SlideOver
      open
      onClose={onClose}
      title={level ? `Edit ${level.name}` : "New price level"}
      footer={
        <div className="flex justify-end gap-3">
          <button className="btn-secondary" onClick={onClose} disabled={pending}>Cancel</button>
          <button
            className="btn-primary"
            disabled={pending || !data.name}
            onClick={() => (level ? update.mutate({ id: level.id, data }) : create.mutate(data))}
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <InputField label="Name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Wholesale" autoFocus />
        <InputField label="Description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
        <label className="flex items-start gap-2 text-sm text-text-secondary">
          <input type="checkbox" className="mt-0.5" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
          <span>
            Default level
            <span className="block text-xs text-text-tertiary">Customers without a level of their own (and walk-in sales) are billed at it.</span>
          </span>
        </label>
      </div>
    </SlideOver>
  );
}

function BulkUpdate({ levels, onClose }: { levels: Level[]; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [levelId, setLevelId] = useState(levels[0]?.id ?? "");
  const [basis, setBasis] = useState<"salePrice" | "current">("salePrice");
  const [percent, setPercent] = useState("");
  const [round, setRound] = useState<"none" | "rupee">("none");
  const [category, setCategory] = useState("");
  const bulk = trpc.priceLevel.bulkUpdate.useMutation({
    onSuccess: async (r) => {
      await Promise.all([utils.priceLevel.invalidate(), utils.pricing.invalidate()]);
      toast({ title: `Updated ${r.updated} price${r.updated === 1 ? "" : "s"}`, variant: "success" });
      onClose();
    },
    onError: (e) => toast({ title: "Bulk update failed", description: e.message, variant: "error" }),
  });
  const pct = Number(percent);
  const valid = levelId && percent.trim() !== "" && Number.isFinite(pct) && pct >= -100 && pct <= 1000;

  return (
    <SlideOver
      open
      onClose={onClose}
      title="Bulk update prices"
      description="Set or shift a whole level's prices by a percentage."
      footer={
        <div className="flex justify-end gap-3">
          <button className="btn-secondary" onClick={onClose} disabled={bulk.isPending}>Cancel</button>
          <button
            className="btn-primary"
            disabled={!valid || bulk.isPending}
            onClick={() => bulk.mutate({ priceLevelId: levelId, basis, percent: pct, round, category: category.trim() || undefined })}
          >
            {bulk.isPending ? "Updating…" : "Update prices"}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <Listbox label="Price level" value={levelId} onChange={setLevelId} options={levels.map((l) => ({ value: l.id, label: l.name }))} />
        <Listbox
          label="Start from"
          value={basis}
          onChange={(v) => setBasis(v as typeof basis)}
          options={[
            { value: "salePrice", label: "Items' sale prices (sets each item's price on the level)" },
            { value: "current", label: "The level's current prices" },
          ]}
        />
        <InputField
          label="Change (%)"
          type="number"
          step="0.01"
          value={percent}
          onChange={(e) => setPercent(e.target.value)}
          placeholder="e.g. -10 for 10% below, 5 for 5% above"
        />
        <Listbox
          label="Rounding"
          value={round}
          onChange={(v) => setRound(v as typeof round)}
          options={[
            { value: "none", label: "Keep paise" },
            { value: "rupee", label: "Round to the nearest rupee" },
          ]}
        />
        <InputField label="Only category" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="All items" />
      </div>
    </SlideOver>
  );
}

type SlabDraft = { minQuantity: string; price: string; discountPercent: string };

/** Quantity slabs of one item on one level, per unit and effective date. */
function SlabEditor({ level, row, onClose }: { level: Level; row: Row; onClose: () => void }) {
  const utils = trpc.useUtils();
  const { data: item } = trpc.item.getById.useQuery({ id: row.itemId });
  const { data: entries } = trpc.priceLevel.itemEntries.useQuery({ itemId: row.itemId });
  const [unit, setUnit] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [drafts, setDrafts] = useState<SlabDraft[] | null>(null);

  const mine = useMemo(
    () => (entries ?? []).filter((e) => e.priceLevelId === level.id && (e.variantId ?? null) === row.variantId),
    [entries, level.id, row.variantId],
  );
  const revisions = useMemo(() => {
    const seen = new Map<string, number>();
    for (const e of mine) {
      const k = `${e.unit ?? ""}|${e.effectiveFrom ?? ""}`;
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    return [...seen.entries()];
  }, [mine]);
  const current = mine.filter((e) => (e.unit ?? "") === unit && (e.effectiveFrom ?? "") === effectiveFrom);
  const rows: SlabDraft[] =
    drafts ??
    (current.length
      ? current.map((e) => ({
          minQuantity: String(parseFloat(e.minQuantity)),
          price: e.price ?? "",
          discountPercent: e.discountPercent ? String(parseFloat(e.discountPercent)) : "",
        }))
      : [{ minQuantity: "0", price: "", discountPercent: "" }]);

  const save = trpc.priceLevel.setItemPrices.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.priceLevel.invalidate(), utils.pricing.invalidate()]);
      setDrafts(null);
      toast({ title: "Slabs saved", variant: "success" });
    },
    onError: (e) => toast({ title: "Couldn't save slabs", description: e.message, variant: "error" }),
  });

  const unitOptions = item
    ? [
        { value: "", label: `${item.unit} (base unit)` },
        ...((item.unitVariants as Array<{ unit: string }> | null) ?? []).map((u) => ({ value: u.unit, label: u.unit })),
      ]
    : [];
  const edit = (i: number, patch: Partial<SlabDraft>) => setDrafts(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const ready = rows.filter((r) => r.price.trim() || r.discountPercent.trim());

  return (
    <SlideOver
      open
      onClose={onClose}
      title={`${row.name} on ${level.name}`}
      description="Quantity slabs: the highest slab a line's quantity reaches applies. A discount alone keeps the item's own price and fills the line discount."
      footer={
        <div className="flex justify-end gap-3">
          <button className="btn-secondary" onClick={onClose} disabled={save.isPending}>Close</button>
          <button
            className="btn-primary"
            disabled={save.isPending}
            onClick={() =>
              save.mutate({
                priceLevelId: level.id,
                itemId: row.itemId,
                variantId: row.variantId,
                unit: unit || null,
                effectiveFrom: effectiveFrom || null,
                slabs: ready.map((r) => ({
                  minQuantity: r.minQuantity.trim() || "0",
                  price: r.price.trim() || null,
                  discountPercent: r.discountPercent.trim() || null,
                })),
              })
            }
          >
            {save.isPending ? "Saving…" : ready.length === 0 && current.length > 0 ? "Remove these slabs" : "Save slabs"}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          {unitOptions.length > 1 ? (
            <Listbox label="Unit" value={unit} onChange={(v) => { setUnit(v); setDrafts(null); }} options={unitOptions} />
          ) : (
            <div />
          )}
          <InputField
            label="Effective from"
            type="date"
            value={effectiveFrom}
            onChange={(e) => { setEffectiveFrom(e.target.value); setDrafts(null); }}
          />
        </div>
        {revisions.length > 0 && (
          <p className="text-xs text-text-tertiary">
            Saved:{" "}
            {revisions.map(([k, n], i) => {
              const [u, d] = k.split("|");
              return (
                <button
                  key={k}
                  type="button"
                  className="mr-2 text-brand-600 hover:underline"
                  onClick={() => { setUnit(u ?? ""); setEffectiveFrom(d ?? ""); setDrafts(null); }}
                >
                  {u || item?.unit || "base"} · {d ? `from ${d}` : "always"} ({n}){i < revisions.length - 1 ? "," : ""}
                </button>
              );
            })}
          </p>
        )}
        <table className="data-table">
          <thead>
            <tr>
              <th>From qty</th>
              <th>Rate (₹)</th>
              <th>Discount %</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>
                  <input className="input w-24 py-1 text-sm" type="number" min="0" aria-label="From quantity" value={r.minQuantity} onChange={(e) => edit(i, { minQuantity: e.target.value })} />
                </td>
                <td>
                  <input className="input w-28 py-1 text-sm" type="number" min="0" step="0.01" aria-label="Rate" value={r.price} onChange={(e) => edit(i, { price: e.target.value })} />
                </td>
                <td>
                  <input className="input w-20 py-1 text-sm" type="number" min="0" max="100" step="0.01" aria-label="Discount percent" value={r.discountPercent} onChange={(e) => edit(i, { discountPercent: e.target.value })} />
                </td>
                <td className="text-right">
                  <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => setDrafts(rows.filter((_, j) => j !== i))}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="btn-secondary" onClick={() => setDrafts([...rows, { minQuantity: "", price: "", discountPercent: "" }])}>
          + Add slab
        </button>
      </div>
    </SlideOver>
  );
}
