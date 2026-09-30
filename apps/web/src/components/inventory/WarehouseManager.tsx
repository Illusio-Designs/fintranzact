/**
 * Managing one warehouse: its details and status, its storage locations
 * (areas, racks, shelves, bins) and which team members may move stock there.
 * Plus the business's default warehouse for each kind of document.
 */
import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";
import { SlideOver } from "@/components/ui/SlideOver";
import { InputField } from "@/components/ui/FormField";
import { Listbox } from "@/components/ui/Listbox";
import { PillTabs } from "@/components/ui/Tabs";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useWarehouses } from "@/components/inventory/shared";

export const WAREHOUSE_TYPES = [
  { value: "main", label: "Main warehouse" },
  { value: "godown", label: "Godown" },
  { value: "store", label: "Shop / store" },
  { value: "transit", label: "In transit" },
  { value: "other", label: "Other" },
];

const LOCATION_TYPES = [
  { value: "AREA", label: "Area" },
  { value: "RACK", label: "Rack" },
  { value: "SHELF", label: "Shelf" },
  { value: "BIN", label: "Bin" },
] as const;

type Warehouse = {
  id: string;
  name: string;
  code: string;
  warehouseType: string;
  address: string | null;
  status: string;
};

export function WarehouseManager({ warehouse, onClose }: { warehouse: Warehouse; onClose: () => void }) {
  const [tab, setTab] = useState("details");
  return (
    <SlideOver
      open={true}
      onClose={onClose}
      title={warehouse.name}
      description={`${warehouse.code} · manage details, locations and who can move stock here`}
    >
      <PillTabs
        className="mb-5"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "details", label: "Details" },
          { value: "locations", label: "Locations" },
          { value: "access", label: "Access" },
        ]}
      />
      {tab === "details" && <DetailsTab warehouse={warehouse} onDeleted={onClose} />}
      {tab === "locations" && <LocationsTab warehouseId={warehouse.id} />}
      {tab === "access" && <AccessTab warehouseId={warehouse.id} />}
    </SlideOver>
  );
}

// ── Details ────────────────────────────────────────────────────

function DetailsTab({ warehouse, onDeleted }: { warehouse: Warehouse; onDeleted: () => void }) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState({
    name: warehouse.name,
    code: warehouse.code,
    warehouseType: warehouse.warehouseType,
    address: warehouse.address ?? "",
  });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const refresh = () => {
    utils.stock.warehouses.invalidate();
    utils.warehouse.warehouseList.invalidate();
  };

  const update = trpc.warehouse.warehouseUpdate.useMutation({
    onSuccess: () => { refresh(); toast.success("Warehouse saved"); },
    onError: (err) => toast.error(err.message),
  });
  const remove = trpc.warehouse.warehouseDelete.useMutation({
    onSuccess: () => { refresh(); toast.success("Warehouse deleted"); onDeleted(); },
    onError: (err) => { setConfirmDelete(false); toast.error(err.message); },
  });
  const active = warehouse.status === "active";

  return (
    <div className="space-y-5">
      <div className="space-y-4">
        <InputField label="Name" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        <div className="grid grid-cols-2 gap-4">
          <InputField label="Short code" required value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} />
          <Listbox label="Type" value={form.warehouseType} onChange={(v) => setForm((f) => ({ ...f, warehouseType: v }))} options={WAREHOUSE_TYPES} />
        </div>
        <InputField label="Address" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
        <div className="flex justify-end">
          <button
            className="btn-primary"
            disabled={update.isPending || !form.name.trim() || !form.code.trim()}
            onClick={() => update.mutate({
              id: warehouse.id,
              name: form.name.trim(),
              code: form.code.trim().toUpperCase(),
              warehouseType: form.warehouseType,
              address: form.address.trim() || null,
            })}
          >
            {update.isPending ? "Saving..." : "Save changes"}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-border-light p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-text-primary">{active ? "Active" : "Inactive"}</p>
            <p className="text-xs text-text-tertiary">
              {active
                ? "Inactive warehouses can't be picked on documents. Move stock out and pick another default first."
                : "This warehouse can't be picked on documents or transfers."}
            </p>
          </div>
          <button
            className="btn-secondary shrink-0"
            disabled={update.isPending}
            onClick={() => update.mutate({ id: warehouse.id, status: active ? "inactive" : "active" })}
          >
            {active ? "Make inactive" : "Make active"}
          </button>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-border-light pt-3">
          <p className="text-xs text-text-tertiary">Only a warehouse that has never held stock can be deleted.</p>
          <button className="btn-secondary shrink-0 text-red-600" onClick={() => setConfirmDelete(true)}>
            Delete
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete warehouse"
        description={`Delete ${warehouse.name}? This can't be undone.`}
        confirmLabel="Delete"
        variant="danger"
        loading={remove.isPending}
        onConfirm={() => remove.mutate({ id: warehouse.id })}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

// ── Locations ──────────────────────────────────────────────────

function LocationsTab({ warehouseId }: { warehouseId: string }) {
  const utils = trpc.useUtils();
  const { data: locations, isLoading } = trpc.warehouse.locationList.useQuery({ warehouseId });
  const [form, setForm] = useState({ name: "", code: "", locationType: "RACK" as (typeof LOCATION_TYPES)[number]["value"], parentId: "" });

  const create = trpc.warehouse.locationCreate.useMutation({
    onSuccess: () => {
      utils.warehouse.locationList.invalidate({ warehouseId });
      setForm((f) => ({ ...f, name: "", code: "" }));
      toast.success("Location added");
    },
    onError: (err) => toast.error(err.message),
  });
  const update = trpc.warehouse.locationUpdate.useMutation({
    onSuccess: () => utils.warehouse.locationList.invalidate({ warehouseId }),
    onError: (err) => toast.error(err.message),
  });

  const byId = new Map((locations ?? []).map((l) => [l.id, l]));
  const pathOf = (id: string | null): string => {
    const l = id ? byId.get(id) : undefined;
    return l ? [pathOf(l.parentId), l.name].filter(Boolean).join(" › ") : "";
  };
  const sorted = [...(locations ?? [])].sort((a, b) => pathOf(a.id).localeCompare(pathOf(b.id)));

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border-light p-4 space-y-3">
        <p className="text-sm font-medium text-text-primary">Add a location</p>
        <div className="grid grid-cols-2 gap-3">
          <InputField label="Name" placeholder="e.g. Rack A" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          <InputField label="Code" placeholder="e.g. A" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} />
          <Listbox label="Type" value={form.locationType} onChange={(v) => setForm((f) => ({ ...f, locationType: v as typeof f.locationType }))} options={[...LOCATION_TYPES]} />
          <Listbox
            label="Inside"
            value={form.parentId}
            onChange={(v) => setForm((f) => ({ ...f, parentId: v }))}
            options={[{ value: "", label: "Top level" }, ...sorted.map((l) => ({ value: l.id, label: pathOf(l.id) }))]}
          />
        </div>
        <div className="flex justify-end">
          <button
            className="btn-primary"
            disabled={create.isPending || !form.name.trim() || !form.code.trim()}
            onClick={() => create.mutate({
              warehouseId,
              name: form.name.trim(),
              code: form.code.trim().toUpperCase(),
              locationType: form.locationType,
              parentId: form.parentId || null,
            })}
          >
            {create.isPending ? "Adding..." : "Add location"}
          </button>
        </div>
      </div>

      {isLoading ? null : sorted.length === 0 ? (
        <p className="text-sm text-text-tertiary">No locations yet. Add areas, racks, shelves or bins to note where things are kept.</p>
      ) : (
        <ul className="divide-y divide-border-light rounded-xl border border-border-light">
          {sorted.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0">
                <p className={cn("truncate text-sm", l.status === "active" ? "text-text-primary" : "text-text-tertiary line-through")}>
                  {pathOf(l.id)}
                </p>
                <p className="text-xs text-text-tertiary">{l.code} · {LOCATION_TYPES.find((t) => t.value === l.locationType)?.label ?? l.locationType}</p>
              </div>
              <button
                className="text-xs font-medium text-text-secondary hover:text-text-primary"
                disabled={update.isPending}
                onClick={() => update.mutate({ id: l.id, status: l.status === "active" ? "inactive" : "active" })}
              >
                {l.status === "active" ? "Retire" : "Restore"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Access ─────────────────────────────────────────────────────

const ACCESS_FLAGS = [
  { key: "canTransfer", label: "Transfer" },
  { key: "canAdjust", label: "Adjust & count" },
] as const;

function AccessTab({ warehouseId }: { warehouseId: string }) {
  const utils = trpc.useUtils();
  const { data: members, isLoading } = trpc.warehouse.accessList.useQuery({ warehouseId });
  const set = trpc.warehouse.accessSet.useMutation({
    onSuccess: () => utils.warehouse.accessList.invalidate({ warehouseId }),
    onError: (err) => toast.error(err.message),
  });

  if (isLoading) return null;
  return (
    <div className="space-y-3">
      <p className="text-xs text-text-tertiary">
        Owners and admins can move stock in every warehouse. Other team members need permission here to transfer stock
        in or out, or to adjust and count it.
      </p>
      <ul className="divide-y divide-border-light rounded-xl border border-border-light">
        {(members ?? []).map((m) => (
          <li key={m.businessMemberId} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm text-text-primary">{m.name ?? m.email ?? "Team member"}</p>
              <p className="text-xs text-text-tertiary">{m.role.replace(/_/g, " ")}</p>
            </div>
            {m.fullAccess ? (
              <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-[11px] font-medium text-text-secondary">Full access</span>
            ) : (
              <div className="flex items-center gap-4">
                {ACCESS_FLAGS.map((f) => (
                  <label key={f.key} className="inline-flex items-center gap-1.5 text-xs text-text-secondary">
                    <input
                      type="checkbox"
                      checked={m[f.key]}
                      disabled={set.isPending}
                      onChange={(e) => {
                        const next = { ...m, [f.key]: e.target.checked };
                        const any = next.canTransfer || next.canAdjust;
                        set.mutate({
                          warehouseId,
                          businessMemberId: m.businessMemberId,
                          canView: any,
                          canReceive: next.canTransfer,
                          canIssue: next.canTransfer,
                          canTransfer: next.canTransfer,
                          canAdjust: next.canAdjust,
                        });
                      }}
                    />
                    {f.label}
                  </label>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Default warehouses ─────────────────────────────────────────

const DEFAULTS = [
  { key: "salesWarehouseId", label: "Sales & delivery challans" },
  { key: "purchaseWarehouseId", label: "Purchases" },
  { key: "salesReturnWarehouseId", label: "Sales returns" },
  { key: "purchaseReturnWarehouseId", label: "Purchase returns" },
  { key: "stockAdjustmentWarehouseId", label: "Opening stock & adjustments" },
] as const;

/** Which warehouse each kind of document uses when none is picked. */
export function DefaultWarehouses({ canEdit }: { canEdit: boolean }) {
  const utils = trpc.useUtils();
  const { data: settings } = trpc.stock.settings.useQuery();
  const { data: warehouses } = useWarehouses();
  const [draft, setDraft] = useState<Record<string, string>>({});
  useEffect(() => {
    if (settings) setDraft(Object.fromEntries(DEFAULTS.map((d) => [d.key, settings[d.key] ?? ""])));
  }, [settings]);

  const save = trpc.warehouse.inventorySettingsUpdate.useMutation({
    onSuccess: () => {
      utils.stock.settings.invalidate();
      utils.stock.warehouses.invalidate();
      toast.success("Default warehouses saved");
    },
    onError: (err) => toast.error(err.message),
  });

  const active = (warehouses ?? []).filter((w) => w.status === "active");
  if (!settings || active.length < 2) return null;
  const changed = DEFAULTS.some((d) => (draft[d.key] ?? "") !== (settings[d.key] ?? ""));

  return (
    <div className="p-5 space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-text-primary">Default warehouses</h2>
        <p className="mt-0.5 text-xs text-text-tertiary">Used when a document doesn't pick a warehouse. The sales default also holds stock not yet placed anywhere.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {DEFAULTS.map((d) => (
          canEdit ? (
            <Listbox
              key={d.key}
              label={d.label}
              value={draft[d.key] ?? ""}
              onChange={(v) => setDraft((prev) => ({ ...prev, [d.key]: v }))}
              options={active.map((w) => ({ value: w.id, label: w.name }))}
            />
          ) : (
            <div key={d.key}>
              <p className="text-xs text-text-tertiary">{d.label}</p>
              <p className="text-sm text-text-primary">{active.find((w) => w.id === settings[d.key])?.name ?? "—"}</p>
            </div>
          )
        ))}
      </div>
      {canEdit && changed && (
        <div className="flex justify-end">
          <button
            className="btn-primary"
            disabled={save.isPending}
            onClick={() => save.mutate(Object.fromEntries(DEFAULTS.map((d) => [d.key, draft[d.key] || null])))}
          >
            {save.isPending ? "Saving..." : "Save defaults"}
          </button>
        </div>
      )}
    </div>
  );
}
