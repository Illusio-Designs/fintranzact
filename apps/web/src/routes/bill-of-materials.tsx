import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Add01Icon, Delete02Icon } from "@hugeicons/core-free-icons";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { useDebounce } from "@/hooks/useDebounce";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/PageHeader";
import { FeatureNotice } from "@/components/billing/FeatureNotice";
import { useFeature } from "@/hooks/useFeature";
import { SlideOver } from "@/components/ui/SlideOver";
import { InputField, TextareaField } from "@/components/ui/FormField";
import { EmptyState } from "@/components/ui/EmptyState";
import { ListCard } from "@/components/ui/ListCard";
import { usePageSize } from "@/hooks/usePageSize";
import { SearchInput } from "@/components/ui/SearchInput";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Icon } from "@/components/ui/Icon";
import { formatQty, parseUnitKey, unitKey } from "@/components/inventory/shared";
import { UnitCombobox, type UnitChoice } from "@/components/inventory/UnitCombobox";

export const Route = createFileRoute("/bill-of-materials")({
  component: BillOfMaterialsPage,
});

type Row = { key: string; unitKey: string; info: UnitChoice | null; quantity: string; wastage: string };

let rowSeq = 0;
function newRow(): Row {
  rowSeq += 1;
  return { key: `r${rowSeq}`, unitKey: "", info: null, quantity: "", wastage: "" };
}

type Form = {
  id: string | null;
  unitKey: string;
  info: UnitChoice | null;
  name: string;
  outputQuantity: string;
  isDefault: boolean;
  isActive: boolean;
  notes: string;
  components: Row[];
  byProducts: Row[];
};

function emptyForm(): Form {
  return {
    id: null, unitKey: "", info: null, name: "", outputQuantity: "1", isDefault: false, isActive: true, notes: "",
    components: [newRow()], byProducts: [],
  };
}

const QTY = /^\d+(\.\d{1,3})?$/;

function BillOfMaterialsPage() {
  const utils = trpc.useUtils();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize("bill-of-materials", 25);
  const tableRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const debounced = useDebounce(search, 300);
  const { data, isFetching } = trpc.manufacturing.boms.useQuery(
    { search: debounced || undefined, page, limit: pageSize },
    // Keep the current page on screen while the next one loads.
    { placeholderData: (prev) => prev },
  );
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Back to page 1 whenever the search or rows per page change.
  useEffect(() => { setPage(1); }, [debounced, pageSize]);
  // Deleting the last row of the last page: step back a page.
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);
  // A new page starts at its first row.
  useEffect(() => { tableRef.current?.scrollTo({ top: 0 }); }, [page]);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(emptyForm);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const done = async (title: string) => {
    await utils.manufacturing.boms.invalidate();
    await utils.manufacturing.bom.invalidate();
    await utils.manufacturing.plan.invalidate();
    toast({ title, variant: "success" });
    setOpen(false);
  };
  const onError = (e: { message: string }) => toast({ title: "Couldn't save the BOM", description: e.message, variant: "error" });
  const create = trpc.manufacturing.bomCreate.useMutation({ onSuccess: () => done("BOM created"), onError });
  const update = trpc.manufacturing.bomUpdate.useMutation({ onSuccess: () => done("BOM saved"), onError });
  const remove = trpc.manufacturing.bomDelete.useMutation({
    onSuccess: async () => {
      setConfirmDelete(false);
      await done("BOM deleted");
    },
    onError: (e) => toast({ title: "Couldn't delete the BOM", description: e.message, variant: "error" }),
  });

  async function edit(id: string) {
    try {
      const bom = await utils.manufacturing.bom.fetch({ id });
      const toRow = (l: { itemId: string; variantId: string | null; name: string; unit: string; quantity: string; wastagePercent?: string }): Row => ({
        ...newRow(),
        unitKey: unitKey(l.itemId, l.variantId),
        info: { name: l.name, unit: l.unit },
        quantity: String(parseFloat(l.quantity)),
        wastage: l.wastagePercent && parseFloat(l.wastagePercent) !== 0 ? String(parseFloat(l.wastagePercent)) : "",
      });
      setForm({
        id: bom.id,
        unitKey: unitKey(bom.itemId, bom.variantId),
        info: { name: bom.itemName, unit: bom.unit },
        name: bom.name,
        outputQuantity: String(parseFloat(bom.outputQuantity)),
        isDefault: bom.isDefault,
        isActive: bom.isActive,
        notes: bom.notes ?? "",
        components: bom.components.map(toRow),
        byProducts: bom.byProducts.map(toRow),
      });
      setOpen(true);
    } catch (e) {
      toast({ title: "Couldn't open the BOM", description: (e as Error).message, variant: "error" });
    }
  }

  const components = form.components.filter((r) => r.unitKey);
  const byProducts = form.byProducts.filter((r) => r.unitKey);
  const invalid =
    !form.unitKey ||
    !form.name.trim() ||
    !QTY.test(form.outputQuantity) || !(parseFloat(form.outputQuantity) > 0) ||
    components.length === 0 ||
    [...components, ...byProducts].some((r) => !QTY.test(r.quantity.trim()) || !(parseFloat(r.quantity) > 0)) ||
    components.some((r) => r.wastage.trim() !== "" && !/^\d+(\.\d{1,2})?$/.test(r.wastage.trim()));

  function save() {
    const payload = {
      ...parseUnitKey(form.unitKey),
      name: form.name.trim(),
      outputQuantity: form.outputQuantity.trim(),
      isDefault: form.isDefault,
      isActive: form.isActive,
      notes: form.notes.trim() || null,
      components: components.map((r) => ({
        ...parseUnitKey(r.unitKey),
        quantity: r.quantity.trim(),
        ...(r.wastage.trim() ? { wastagePercent: r.wastage.trim() } : {}),
      })),
      byProducts: byProducts.map((r) => ({ ...parseUnitKey(r.unitKey), quantity: r.quantity.trim() })),
    };
    if (form.id) update.mutate({ id: form.id, ...payload });
    else create.mutate(payload);
  }

  const saving = create.isPending || update.isPending;
  const openNew = () => {
    setForm(emptyForm());
    setOpen(true);
  };

  const feature = useFeature("manufacturing");

  return (
    <div>
      <PageHeader
        title="Bill of Materials"
        description="What goes into each item you make. Manufacturing uses these to know what to take out of stock."
        actions={<button className="btn-primary" onClick={openNew} {...feature.lockedProps}>+ New BOM</button>}
      />
      <FeatureNotice flag="manufacturing">Your existing bills of material stay readable.</FeatureNotice>

      <ListCard
        filters={
          <div className="w-full max-w-xs">
            <SearchInput value={search} onChange={setSearch} placeholder="Search BOMs or items" />
          </div>
        }
        onClearFilters={search ? () => setSearch("") : undefined}
        loading={!data}
        fetching={isFetching}
        tableRef={tableRef}
        pagination={{ page, totalPages, onPageChange: setPage, total, pageSize, onPageSizeChange: setPageSize }}
        empty={
          data && data.data.length === 0 ? (
            <EmptyState
              title={debounced ? "No BOMs match" : "No bills of material yet"}
              description="Set up a BOM for each item you manufacture: the components and how much of each it takes."
              action={!debounced ? <button className="btn-primary" onClick={openNew} {...feature.lockedProps}>Create a BOM</button> : undefined}
            />
          ) : undefined
        }
      >
        <table className="data-table w-full">
          <thead>
            <tr>
              <th>Item made</th>
              <th>BOM</th>
              <th className="text-right">Makes</th>
              <th className="text-right">Components</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {(data?.data ?? []).map((b) => (
              <tr key={b.id} className="cursor-pointer" onClick={() => edit(b.id)}>
                <td className="font-medium text-text-primary">{b.itemName}</td>
                <td className="text-text-secondary">{b.name}</td>
                <td className="text-right tabular-nums">{formatQty(b.outputQuantity, b.unit)}</td>
                <td className="text-right tabular-nums">
                  {b.componentCount}
                  {b.byProductCount > 0 && <span className="text-text-tertiary"> + {b.byProductCount} by-product{b.byProductCount === 1 ? "" : "s"}</span>}
                </td>
                <td>
                  <div className="flex gap-1.5">
                    {b.isDefault && <Tag tone="brand">Default</Tag>}
                    {!b.isActive && <Tag tone="muted">Inactive</Tag>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ListCard>

      <SlideOver
        open={open}
        onClose={() => setOpen(false)}
        title={form.id ? "Edit BOM" : "New bill of materials"}
        description="Component quantities are for the output quantity. Wastage adds that percentage on top when manufacturing."
        footer={
          <div className="flex items-center justify-between gap-3">
            <div>
              {form.id && (
                <button className="btn-secondary text-red-600" onClick={() => setConfirmDelete(true)} disabled={saving}>
                  Delete
                </button>
              )}
            </div>
            <div className="flex gap-3">
              <button className="btn-secondary" onClick={() => setOpen(false)} disabled={saving}>Cancel</button>
              <button className="btn-primary" onClick={save} disabled={saving || invalid}>
                {saving ? "Saving…" : "Save BOM"}
              </button>
            </div>
          </div>
        }
      >
        <div className="space-y-5">
          <UnitCombobox
            label="Item made"
            value={form.unitKey}
            known={form.info}
            onChange={(key, info) => setForm((f) => ({
              ...f,
              unitKey: key,
              info: info ?? f.info,
              name: f.name || (info ? info.name : ""),
            }))}
          />
          <div className="grid grid-cols-2 gap-4">
            <InputField label="BOM name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <InputField
              label={`Output quantity${form.info ? ` (${form.info.unit})` : ""}`}
              inputMode="decimal"
              value={form.outputQuantity}
              onChange={(e) => setForm({ ...form, outputQuantity: e.target.value })}
              required
            />
          </div>
          <div className="flex flex-wrap gap-5 text-sm">
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} />
              Default BOM for this item
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
              Active
            </label>
          </div>

          <RowsEditor
            title="Components"
            rows={form.components}
            onChange={(components) => setForm({ ...form, components })}
            withWastage
            addLabel="Add component"
          />
          <RowsEditor
            title="By-products and scrap"
            hint="Optional. Goods given off while making, added to stock at no cost."
            rows={form.byProducts}
            onChange={(byProducts) => setForm({ ...form, byProducts })}
            addLabel="Add by-product"
          />

          <TextareaField label="Notes" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
      </SlideOver>

      <ConfirmDialog
        open={confirmDelete}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => form.id && remove.mutate({ id: form.id })}
        title="Delete this BOM?"
        description="Manufacturing journals already made from it are kept."
        confirmLabel="Delete"
        variant="danger"
        loading={remove.isPending}
      />
    </div>
  );
}

function Tag({ tone, children }: { tone: "brand" | "muted"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-2xs font-medium",
        tone === "brand" ? "bg-brand-600/10 text-brand-700 dark:text-brand-300" : "bg-surface-3 text-text-tertiary",
      )}
    >
      {children}
    </span>
  );
}

function RowsEditor({
  title,
  hint,
  rows,
  onChange,
  withWastage = false,
  addLabel,
}: {
  title: string;
  hint?: string;
  rows: Row[];
  onChange: (rows: Row[]) => void;
  withWastage?: boolean;
  addLabel: string;
}) {
  const update = (key: string, patch: Partial<Row>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const cols = withWastage ? "grid-cols-[minmax(0,1fr)_110px_90px_36px]" : "grid-cols-[minmax(0,1fr)_110px_36px]";
  return (
    <div>
      <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
      {hint && <p className="mt-0.5 text-xs text-text-tertiary">{hint}</p>}
      <div className="mt-2 space-y-2">
        {rows.length > 0 && (
          <div className={cn("grid gap-2 text-xs font-medium text-text-secondary", cols)}>
            <span>Item</span>
            <span>Quantity</span>
            {withWastage && <span>Wastage %</span>}
            <span />
          </div>
        )}
        {rows.map((r, i) => (
          <div key={r.key} className={cn("grid items-center gap-2", cols)}>
            <UnitCombobox ariaLabel={`${title} item, line ${i + 1}`} value={r.unitKey} known={r.info} onChange={(key, info) => update(r.key, { unitKey: key, info: info ?? r.info })} />
            <div className="relative">
              <input
                className="input tabular-nums"
                inputMode="decimal"
                aria-label={`${title} quantity, line ${i + 1}`}
                placeholder="0"
                value={r.quantity}
                onChange={(e) => update(r.key, { quantity: e.target.value })}
              />
              {r.info && <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-text-tertiary">{r.info.unit}</span>}
            </div>
            {withWastage && (
              <input
                className="input tabular-nums"
                inputMode="decimal"
                aria-label={`Wastage percent, line ${i + 1}`}
                placeholder="0"
                value={r.wastage}
                onChange={(e) => update(r.key, { wastage: e.target.value })}
              />
            )}
            <button
              type="button"
              onClick={() => onChange(rows.filter((x) => x.key !== r.key))}
              className="grid h-9 w-9 place-items-center rounded-lg text-text-tertiary hover:bg-red-600/[0.08] hover:text-red-500"
              aria-label={`Remove line ${i + 1}`}
            >
              <Icon icon={Delete02Icon} size={15} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => onChange([...rows, newRow()])}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline dark:text-brand-300"
        >
          <Icon icon={Add01Icon} size={15} />
          {addLabel}
        </button>
      </div>
    </div>
  );
}
