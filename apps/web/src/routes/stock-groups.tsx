import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { FolderLibraryIcon } from "@hugeicons/core-free-icons";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { PageHeader } from "@/components/ui/PageHeader";
import { SlideOver } from "@/components/ui/SlideOver";
import { Modal } from "@/components/ui/Modal";
import { InputField, SelectField } from "@/components/ui/FormField";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { Icon } from "@/components/ui/Icon";
import { indentedName, useStockGroups } from "@/components/inventory/StockGroups";

export const Route = createFileRoute("/stock-groups")({
  component: StockGroupsPage,
});

type Group = NonNullable<ReturnType<typeof useStockGroups>["data"]>[number];

/** Ids of a group and everything under it (groups come in tree order). */
function subtree(groups: Group[], id: string) {
  const out = new Set([id]);
  for (const g of groups) if (g.parentId && out.has(g.parentId)) out.add(g.id);
  return out;
}

function StockGroupsPage() {
  const utils = trpc.useUtils();
  const { data: groups, ungroupedItemCount, isLoading } = useStockGroups();
  const { data: session } = trpc.auth.me.useQuery();
  const role = session?.role ?? "";
  const canEdit = !!role && role !== "viewer";
  const canDelete = ["owner", "admin", "superadmin"].includes(role);

  // null = closed; { id: undefined } = new group
  const [editing, setEditing] = useState<{ id?: string; name: string; parentId: string } | null>(null);
  const [deleting, setDeleting] = useState<Group | null>(null);
  const [moveTo, setMoveTo] = useState("");

  const refresh = async () => {
    await utils.stockGroup.list.invalidate();
    utils.item.list.invalidate();
    utils.reports.invalidate();
    utils.inventoryReports.invalidate();
  };
  const onError = (e: { message: string }) => toast.error(e.message);
  const create = trpc.stockGroup.create.useMutation({ onError });
  const rename = trpc.stockGroup.rename.useMutation({ onError });
  const move = trpc.stockGroup.move.useMutation({ onError });
  const remove = trpc.stockGroup.delete.useMutation({
    onSuccess: async () => {
      await refresh();
      toast.success("Stock group deleted");
      setDeleting(null);
    },
    onError,
  });

  const all = groups ?? [];
  const pending = create.isPending || rename.isPending || move.isPending;

  async function save() {
    if (!editing) return;
    const name = editing.name.trim();
    const parentId = editing.parentId || null;
    if (!editing.id) {
      await create.mutateAsync({ name, parentId });
      toast.success("Stock group added");
    } else {
      const before = all.find((g) => g.id === editing.id)!;
      if (before.name !== name) await rename.mutateAsync({ id: editing.id, name });
      if ((before.parentId ?? null) !== parentId) await move.mutateAsync({ id: editing.id, parentId });
      toast.success("Stock group saved");
    }
    await refresh();
    setEditing(null);
  }

  // A group can't go under itself or anything below it.
  const blocked = editing?.id ? subtree(all, editing.id) : new Set<string>();
  const deleteBlocked = deleting ? subtree(all, deleting.id) : new Set<string>();
  const deletingHasContents = !!deleting && (deleting.directItemCount > 0 || deleting.childCount > 0);

  return (
    <div>
      <PageHeader
        title="Stock Groups"
        description="Group your stock items, one level inside another, the way Tally does"
        actions={
          canEdit && (
            <button className="btn-primary" onClick={() => setEditing({ name: "", parentId: "" })}>
              + Add group
            </button>
          )
        }
      />

      <div className="card overflow-hidden">
        {isLoading ? (
          <SkeletonRows count={4} />
        ) : all.length === 0 ? (
          <EmptyState
            icon={<Icon icon={FolderLibraryIcon} size={22} />}
            title="No stock groups yet"
            description="Add groups such as Electronics or Groceries, then choose a group on each item."
          />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Group</th>
                <th className="text-right">Sub-groups</th>
                <th className="text-right">Items</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {all.map((g) => (
                <tr key={g.id}>
                  <td>
                    <span className="font-medium text-text-primary" style={{ paddingLeft: g.depth * 20 }}>
                      {g.depth > 0 && <span className="mr-1.5 text-text-tertiary">└</span>}
                      {g.name}
                    </span>
                  </td>
                  <td className="text-right tabular-nums text-text-secondary">{g.childCount || "—"}</td>
                  <td className="text-right tabular-nums">
                    {g.itemCount}
                    {g.itemCount !== g.directItemCount && (
                      <span className="ml-1 text-xs text-text-tertiary">({g.directItemCount} direct)</span>
                    )}
                  </td>
                  <td className="text-right whitespace-nowrap">
                    {canEdit && (
                      <button
                        className="text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400"
                        onClick={() => setEditing({ id: g.id, name: g.name, parentId: g.parentId ?? "" })}
                      >
                        Edit
                      </button>
                    )}
                    {canDelete && (
                      <button
                        className="ml-4 text-xs font-medium text-red-600 hover:text-red-700 dark:text-red-400"
                        onClick={() => {
                          setMoveTo("");
                          setDeleting(g);
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {ungroupedItemCount > 0 && (
        <p className="mt-3 text-xs text-text-tertiary">
          {ungroupedItemCount} item{ungroupedItemCount === 1 ? " is" : "s are"} not in any group.{" "}
          <Link to="/items" className="text-brand-600 hover:underline dark:text-brand-400">Open Stock Items</Link> to file them.
        </p>
      )}

      <SlideOver
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? "Edit stock group" : "Add stock group"}
        description="Items in a group count towards every group above it in reports"
        footer={
          <div className="flex justify-end gap-3">
            <button className="btn-secondary" onClick={() => setEditing(null)} disabled={pending}>
              Cancel
            </button>
            <button className="btn-primary" disabled={pending || !editing?.name.trim()} onClick={() => save().catch(() => {})}>
              {pending ? "Saving..." : "Save"}
            </button>
          </div>
        }
      >
        {editing && (
          <div className="space-y-4">
            <InputField
              label="Name"
              required
              autoFocus
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              placeholder="e.g. Electronics"
            />
            <SelectField
              label="Under"
              value={editing.parentId}
              onChange={(e) => setEditing({ ...editing, parentId: e.target.value })}
            >
              <option value="">Primary (top level)</option>
              {all.filter((g) => !blocked.has(g.id)).map((g) => (
                <option key={g.id} value={g.id}>{indentedName(g.name, g.depth)}</option>
              ))}
            </SelectField>
          </div>
        )}
      </SlideOver>

      <Modal open={!!deleting} onClose={() => setDeleting(null)} title={`Delete "${deleting?.name ?? ""}"?`} className="max-w-md">
        {deleting && (
          <div className="space-y-4">
            {deletingHasContents ? (
              <>
                <p className="text-sm text-text-secondary">
                  This group has{" "}
                  {[
                    deleting.directItemCount > 0 && `${deleting.directItemCount} item${deleting.directItemCount === 1 ? "" : "s"}`,
                    deleting.childCount > 0 && `${deleting.childCount} sub-group${deleting.childCount === 1 ? "" : "s"}`,
                  ].filter(Boolean).join(" and ")}
                  . Sub-groups move up one level.
                </p>
                <SelectField label="Move its items to" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
                  <option value="">No group</option>
                  {all.filter((g) => !deleteBlocked.has(g.id)).map((g) => (
                    <option key={g.id} value={g.id}>{indentedName(g.name, g.depth)}</option>
                  ))}
                </SelectField>
              </>
            ) : (
              <p className="text-sm text-text-secondary">The group is empty and will be removed.</p>
            )}
            <div className="flex justify-end gap-2 border-t border-border-light pt-4">
              <button className="btn-ghost" onClick={() => setDeleting(null)} disabled={remove.isPending}>
                Cancel
              </button>
              <button
                className="btn-danger"
                disabled={remove.isPending}
                onClick={() =>
                  remove.mutate(
                    deletingHasContents
                      ? { id: deleting.id, reassignItemsTo: moveTo || null }
                      : { id: deleting.id },
                  )
                }
              >
                {remove.isPending ? "Deleting..." : "Delete group"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
