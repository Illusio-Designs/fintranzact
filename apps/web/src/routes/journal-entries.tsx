import { Bone, TableSkeleton } from "@/components/ui/Skeleton";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePageSearch } from "@/lib/page-search";
import { useSaveTick } from "@/hooks/useSaveTick";
import { SavedTick } from "@/components/ui/SavedTick";
import { trpc } from "@/lib/trpc";
import { formatCurrency, formatDate, cn, todayISODate, toISOString, formatDateInput } from "@/lib/utils";
import { toast } from "@/hooks/useToast";
import { useDateRange } from "@/hooks/useDateRange";
import { useHotkeys } from "@/hooks/useHotkeys";
import { useDeleteConfirmation } from "@/hooks/useDeleteConfirmation";
import { PageHeader } from "@/components/ui/PageHeader";
import { SlideOver } from "@/components/ui/SlideOver";
import { InputField, TextareaField } from "@/components/ui/FormField";
import { Combobox, type ComboboxOption } from "@/components/ui/Combobox";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DeleteConfirmDialog } from "@/components/ui/DeleteConfirmDialog";
import { DateRangeBar } from "@/components/ui/DateRangeBar";
import { PillTabs, SegmentedControl } from "@/components/ui/Tabs";
import { Badge } from "@/components/ui/Badge";
import { Pagination } from "@/components/ui/Pagination";
import { RowActions, tidyMenu } from "@/components/ui/Menu";
import { SortableTh, SortMenu, TableScroll, type SortOption, type SortState } from "@/components/ui/Table";
import { usePageSize } from "@/hooks/usePageSize";
import { Icon } from "@/components/ui/Icon";
import { AlertCircleIcon, ArrowRight01Icon, Delete02Icon, Tick02Icon } from "@hugeicons/core-free-icons";

export const Route = createFileRoute("/journal-entries")({
  component: JournalEntriesPage,
});

// ── Types ──────────────────────────────────────────────────────

type JournalLine = {
  accountId: string;
  debit: string;
  credit: string;
  narration: string;
};

type EntryFormState = {
  entryDate: string;
  narration: string;
  lines: JournalLine[];
};

const EMPTY_LINE: JournalLine = {
  accountId: "",
  debit: "",
  credit: "",
  narration: "",
};

const TODAY_ISO = todayISODate();

const EMPTY_FORM: EntryFormState = {
  entryDate: TODAY_ISO,
  narration: "",
  lines: [{ ...EMPTY_LINE }, { ...EMPTY_LINE }],
};

const PAGE_TABS = [
  { value: "entries", label: "Entries" },
  { value: "templates", label: "Templates" },
];

// ── Main Page ──────────────────────────────────────────────────

function JournalEntriesPage() {
  const [activeTab, setActiveTab] = useState("entries");
  const [showForm, setShowForm] = useState(false);
  const [editEntryId, setEditEntryId] = useState<string | null>(null);
  const [voidEntryId, setVoidEntryId] = useState<string | null>(null);
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);
  const [form, setForm] = useState<EntryFormState>({ ...EMPTY_FORM });
  const deleteTemplateConfirm = useDeleteConfirmation();
  const [saveAsTemplateName, setSaveAsTemplateName] = useState("");
  const [showSaveAsTemplate, setShowSaveAsTemplate] = useState(false);
  const [saveAsTemplateEntry, setSaveAsTemplateEntry] = useState<any>(null);

  const dateRange = useDateRange("journal-entries", "this-fy");

  const utils = trpc.useUtils();

  // ── Queries ────────────────────────────────────────────────

  const { data: entries, isLoading } = trpc.journal.list.useQuery(
    {
      fromDate: dateRange.fromDate,
      toDate: dateRange.toDate,
    },
    { placeholderData: (prev) => prev }
  );

  const { data: accounts } = trpc.account.list.useQuery();

  const { data: templates } = trpc.journal.templateList.useQuery(undefined, {
    enabled: activeTab === "templates",
  });

  const { data: expandedEntry, isFetching: isFetchingDetail } =
    trpc.journal.getById.useQuery(
      { id: expandedEntryId! },
      { enabled: !!expandedEntryId }
    );

  // ── Account options for Combobox ───────────────────────────

  const accountOptions: ComboboxOption[] = useMemo(
    () =>
      (accounts ?? [])
        .filter((a) => a.isActive)
        .map((a) => ({
          value: a.id,
          label: `${a.code} - ${a.name}`,
          description: a.accountType,
        })),
    [accounts]
  );

  // ── Mutations ──────────────────────────────────────────────

  // The save button shows a tick before the panel closes.
  const tick = useSaveTick();
  const createMutation = trpc.journal.create.useMutation({
    onSuccess: () => {
      utils.journal.list.invalidate();
      toast.success("Journal entry created");
      tick.finish(closeForm);
    },
    onError: (err) => toast.error(err.message),
  });

  const updateMutation = trpc.journal.update.useMutation({
    onSuccess: () => {
      utils.journal.list.invalidate();
      utils.journal.getById.invalidate();
      toast.success("Journal entry updated");
      tick.finish(closeForm);
    },
    onError: (err) => toast.error(err.message),
  });

  const voidMutation = trpc.journal.void.useMutation({
    onSuccess: () => {
      utils.journal.list.invalidate();
      utils.journal.getById.invalidate();
      toast.success("Journal entry voided");
      setVoidEntryId(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const templateCreateMutation = trpc.journal.templateCreate.useMutation({
    onSuccess: () => {
      utils.journal.templateList.invalidate();
      toast.success("Template saved");
      setShowSaveAsTemplate(false);
      setSaveAsTemplateName("");
      setSaveAsTemplateEntry(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const templateDeleteMutation = trpc.journal.templateDelete.useMutation({
    onSuccess: () => {
      utils.journal.templateList.invalidate();
      toast.success("Template deleted");
      deleteTemplateConfirm.cancelDelete();
    },
    onError: (err) => toast.error(err.message),
  });

  // ── Hotkeys ────────────────────────────────────────────────

  useHotkeys([
    {
      key: "n",
      handler: () => openCreate(),
      description: "New journal entry",
      scope: "journal-entries",
    },
  ]);

  // ── Form helpers ───────────────────────────────────────────

  function openCreate() {
    setEditEntryId(null);
    setForm({
      entryDate: todayISODate(),
      narration: "",
      lines: [{ ...EMPTY_LINE }, { ...EMPTY_LINE }],
    });
    setShowForm(true);
  }

  function openEdit(entry: any) {
    if (!expandedEntry) return;
    setEditEntryId(entry.id);
    setForm({
      entryDate: formatDateInput(entry.entryDate),
      narration: entry.narration || "",
      lines: expandedEntry.lines.map((l: any) => ({
        accountId: l.accountId,
        debit: l.debit && parseFloat(l.debit) > 0 ? l.debit : "",
        credit: l.credit && parseFloat(l.credit) > 0 ? l.credit : "",
        narration: l.narration || "",
      })),
    });
    setShowForm(true);
  }

  function openFromTemplate(template: any) {
    setEditEntryId(null);
    setForm({
      entryDate: todayISODate(),
      narration: template.narration || "",
      lines: template.lines.map((l: any) => ({
        accountId: l.accountId,
        debit: l.debit && parseFloat(l.debit) > 0 ? l.debit : "",
        credit: l.credit && parseFloat(l.credit) > 0 ? l.credit : "",
        narration: l.narration || "",
      })),
    });
    setShowForm(true);
    setActiveTab("entries");
  }

  function closeForm() {
    setShowForm(false);
    setEditEntryId(null);
    setForm({ ...EMPTY_FORM });
  }

  function updateLine(index: number, field: keyof JournalLine, value: string) {
    setForm((f) => ({
      ...f,
      lines: f.lines.map((l, i) => (i === index ? { ...l, [field]: value } : l)),
    }));
  }

  function addLine() {
    setForm((f) => ({ ...f, lines: [...f.lines, { ...EMPTY_LINE }] }));
  }

  function removeLine(index: number) {
    setForm((f) => ({
      ...f,
      lines: f.lines.filter((_, i) => i !== index),
    }));
  }

  // ── Totals & validation ────────────────────────────────────

  const totalDebit = form.lines.reduce(
    (sum, l) => sum + (parseFloat(l.debit) || 0),
    0
  );
  const totalCredit = form.lines.reduce(
    (sum, l) => sum + (parseFloat(l.credit) || 0),
    0
  );
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;
  const hasEnoughLines = form.lines.filter((l) => l.accountId).length >= 2;
  const hasTotals = totalDebit > 0 || totalCredit > 0;
  const canSubmit = isBalanced && hasEnoughLines && hasTotals;

  function handleSubmit() {
    if (!canSubmit) return;

    const lines = form.lines
      .filter((l) => l.accountId)
      .map((l) => ({
        accountId: l.accountId,
        debit: parseFloat(l.debit || "0").toFixed(2),
        credit: parseFloat(l.credit || "0").toFixed(2),
        narration: l.narration || undefined,
      }));

    const entryDateISO = toISOString(form.entryDate);
    if (!entryDateISO) return;
    if (editEntryId) {
      updateMutation.mutate({
        id: editEntryId,
        entryDate: entryDateISO,
        narration: form.narration.trim() || undefined,
        lines,
      });
    } else {
      createMutation.mutate({
        entryDate: entryDateISO,
        narration: form.narration.trim() || undefined,
        lines,
      });
    }
  }

  function handleSaveAsTemplate(entry: any) {
    setSaveAsTemplateEntry(entry);
    setSaveAsTemplateName("");
    setShowSaveAsTemplate(true);
  }

  function submitSaveAsTemplate() {
    if (!saveAsTemplateEntry || !saveAsTemplateName.trim()) return;
    if (!expandedEntry) return;

    templateCreateMutation.mutate({
      name: saveAsTemplateName.trim(),
      narration: saveAsTemplateEntry.narration || undefined,
      lines: expandedEntry.lines.map((l: any) => ({
        accountId: l.accountId,
        accountCode: l.accountCode,
        accountName: l.accountName,
        debit: l.debit,
        credit: l.credit,
        narration: l.narration || undefined,
      })),
    });
  }

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  // ── Render ─────────────────────────────────────────────────

  return (
    <div>
      <PageHeader
        title="Journal Entries"
        description="Double-entry journal for manual accounting adjustments"
        actions={
          <button className="btn-primary" onClick={openCreate}>
            + New Entry
          </button>
        }
      />

      {/* Tab switcher */}
      <div className="mb-5">
        <SegmentedControl
          tabs={PAGE_TABS}
          value={activeTab}
          onChange={setActiveTab}
        />
      </div>

      {activeTab === "entries" ? (
        <EntriesTab
          entries={entries}
          isLoading={isLoading}
          dateRange={dateRange}
          expandedEntryId={expandedEntryId}
          expandedEntry={expandedEntry}
          isFetchingDetail={isFetchingDetail}
          onToggleExpand={(id) =>
            setExpandedEntryId((prev) => (prev === id ? null : id))
          }
          onEdit={openEdit}
          onVoid={(id) => setVoidEntryId(id)}
          onSaveAsTemplate={handleSaveAsTemplate}
          onNew={openCreate}
        />
      ) : (
        <TemplatesTab
          templates={templates}
          onUse={openFromTemplate}
          onDelete={(id, name) => deleteTemplateConfirm.requestDelete(id, name)}
        />
      )}

      {/* Create / Edit SlideOver */}
      <SlideOver
        open={showForm}
        onClose={closeForm}
        title={editEntryId ? "Edit Journal Entry" : "New Journal Entry"}
        description={
          editEntryId
            ? "Update entry details and line items"
            : "Record a manual double-entry journal entry"
        }
        footer={
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm">
              {hasTotals && (
                isBalanced ? (
                  <span className="flex items-center gap-1 text-emerald-600">
                    <Icon icon={Tick02Icon} size={16} />
                    Balanced
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-red-500">
                    <Icon icon={AlertCircleIcon} size={16} />
                    Unbalanced ({formatCurrency(Math.abs(totalDebit - totalCredit))})
                  </span>
                )
              )}
            </div>
            <div className="flex items-center gap-3">
              <button
                className="btn-secondary"
                onClick={closeForm}
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                className={cn("btn-primary", tick.saved && "!bg-emerald-600 disabled:!opacity-100")}
                onClick={handleSubmit}
                disabled={!canSubmit || isSubmitting || tick.saved}
              >
                {tick.saved ? <SavedTick label={editEntryId ? "Saved" : "Created"} /> : isSubmitting
                  ? editEntryId
                    ? "Saving…"
                    : "Creating…"
                  : editEntryId
                    ? "Save Changes"
                    : "Create Entry"}
              </button>
            </div>
          </div>
        }
      >
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <InputField
              label="Date"
              type="date"
              value={form.entryDate}
              onChange={(e) =>
                setForm((f) => ({ ...f, entryDate: e.target.value }))
              }
              required
              autoFocus
            />
            <div className="col-span-2">
              <TextareaField
                label="Narration"
                placeholder="Purpose of this journal entry…"
                value={form.narration}
                onChange={(e) =>
                  setForm((f) => ({ ...f, narration: e.target.value }))
                }
                rows={2}
              />
            </div>
          </div>

          {/* Line items */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="label mb-0">Line Items</label>
              <button
                type="button"
                className="text-xs text-brand-600 hover:text-brand-700 font-medium"
                onClick={addLine}
              >
                + Add Row
              </button>
            </div>

            <div className="space-y-3">
              {form.lines.map((line, idx) => (
                <div
                  key={idx}
                  className="rounded-lg border border-border-light p-3 space-y-3 bg-surface-1/50"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <Combobox
                        value={line.accountId}
                        onChange={(val) => updateLine(idx, "accountId", val)}
                        options={accountOptions}
                        placeholder="Search account…"
                        label="Account"
                        required
                      />
                    </div>
                    {form.lines.length > 2 && (
                      <button
                        type="button"
                        onClick={() => removeLine(idx)}
                        className="mt-6 p-1.5 rounded-lg text-text-tertiary hover:text-red-500 hover:bg-red-600/[0.08] transition-colors shrink-0"
                        aria-label="Remove line"
                      >
                        <Icon icon={Delete02Icon} size={14} />
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <InputField
                      label="Debit"
                      placeholder="0.00"
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.debit}
                      onChange={(e) => {
                        updateLine(idx, "debit", e.target.value);
                        if (e.target.value && parseFloat(e.target.value) > 0) {
                          updateLine(idx, "credit", "");
                        }
                      }}
                    />
                    <InputField
                      label="Credit"
                      placeholder="0.00"
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.credit}
                      onChange={(e) => {
                        updateLine(idx, "credit", e.target.value);
                        if (e.target.value && parseFloat(e.target.value) > 0) {
                          updateLine(idx, "debit", "");
                        }
                      }}
                    />
                    <InputField
                      label="Note"
                      placeholder="Optional"
                      value={line.narration}
                      onChange={(e) =>
                        updateLine(idx, "narration", e.target.value)
                      }
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Totals bar */}
            <div className="mt-4 rounded-lg border border-border-light bg-surface-1 px-4 py-3">
              <div className="grid grid-cols-3 gap-3 text-sm font-medium">
                <div>
                  <span className="text-text-tertiary text-xs">
                    Total Debit
                  </span>
                  <p className="tabular-nums text-text-primary">
                    {formatCurrency(totalDebit)}
                  </p>
                </div>
                <div>
                  <span className="text-text-tertiary text-xs">
                    Total Credit
                  </span>
                  <p className="tabular-nums text-text-primary">
                    {formatCurrency(totalCredit)}
                  </p>
                </div>
                <div>
                  <span className="text-text-tertiary text-xs">Difference</span>
                  <p
                    className={cn(
                      "tabular-nums",
                      isBalanced
                        ? "text-emerald-600"
                        : "text-red-500 font-semibold"
                    )}
                  >
                    {formatCurrency(Math.abs(totalDebit - totalCredit))}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </SlideOver>

      {/* Void confirmation */}
      <ConfirmDialog
        open={!!voidEntryId}
        onCancel={() => setVoidEntryId(null)}
        onConfirm={() => voidEntryId && voidMutation.mutate({ id: voidEntryId })}
        title="Void Journal Entry"
        description="This will create a reversing entry that cancels out this journal entry. This action cannot be undone."
        confirmLabel="Confirm Void"
        variant="danger"
        loading={voidMutation.isPending}
      />

      {/* Save as template dialog with name input */}
      {showSaveAsTemplate && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/40"
            onClick={() => {
              setShowSaveAsTemplate(false);
              setSaveAsTemplateName("");
              setSaveAsTemplateEntry(null);
            }}
          />
          <div className="relative z-10 w-full max-w-sm rounded-xl shadow-modal bg-surface-0 p-6">
            <p className="text-sm font-semibold text-text-primary mb-1">
              Save as Template
            </p>
            <p className="text-sm text-text-secondary mb-4">
              Give this template a name so you can quickly re-use it.
            </p>
            <InputField
              label="Template Name"
              placeholder="e.g. Monthly rent adjustment"
              value={saveAsTemplateName}
              onChange={(e) => setSaveAsTemplateName(e.target.value)}
              required
              autoFocus
            />
            <div className="flex items-center justify-end gap-2 mt-4 pt-4 border-t border-border-light">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  setShowSaveAsTemplate(false);
                  setSaveAsTemplateName("");
                  setSaveAsTemplateEntry(null);
                }}
                disabled={templateCreateMutation.isPending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={submitSaveAsTemplate}
                disabled={
                  !saveAsTemplateName.trim() ||
                  templateCreateMutation.isPending
                }
              >
                {templateCreateMutation.isPending
                  ? "Saving…"
                  : "Save Template"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete template confirmation */}
      <DeleteConfirmDialog
        target={deleteTemplateConfirm.deleteTarget}
        entityName="Template"
        loading={templateDeleteMutation.isPending}
        onConfirm={() =>
          deleteTemplateConfirm.deleteTarget &&
          templateDeleteMutation.mutate({ id: deleteTemplateConfirm.deleteTarget.id })
        }
        onCancel={deleteTemplateConfirm.cancelDelete}
      />
    </div>
  );
}

// ── Entries Tab ─────────────────────────────────────────────────

type EntrySortKey = "date" | "number" | "amount";
const SORT_OPTIONS: SortOption<EntrySortKey>[] = [
  { key: "date", dir: "desc", label: "Newest first" },
  { key: "date", dir: "asc", label: "Oldest first" },
  { key: "amount", dir: "desc", label: "Amount: high to low" },
  { key: "amount", dir: "asc", label: "Amount: low to high" },
  { key: "number", dir: "asc", label: "Entry #: low to high" },
];

function EntriesTab({
  entries,
  isLoading,
  dateRange,
  expandedEntryId,
  expandedEntry,
  isFetchingDetail,
  onToggleExpand,
  onEdit,
  onVoid,
  onSaveAsTemplate,
  onNew,
}: {
  entries: any;
  isLoading: boolean;
  dateRange: ReturnType<typeof useDateRange>;
  expandedEntryId: string | null;
  expandedEntry: any;
  isFetchingDetail: boolean;
  onToggleExpand: (id: string) => void;
  onEdit: (entry: any) => void;
  onVoid: (id: string) => void;
  onSaveAsTemplate: (entry: any) => void;
  onNew: () => void;
}) {
  const [search] = usePageSearch("Search entry # or narration…");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState<SortState<EntrySortKey>>({ key: "date", dir: "desc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize("journal-entries", 25);
  const tableRef = useRef<HTMLDivElement>(null);
  // A new search, filter, sort or rows-per-page choice starts from the first page.
  useEffect(() => setPage(1), [search, status, sort, pageSize, dateRange.preset]);
  // A new page starts at its first row.
  useEffect(() => { tableRef.current?.scrollTo({ top: 0 }); }, [page]);

  const all: any[] = entries ?? [];
  const matching = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? all.filter((e) => `${e.entryNumber} ${e.narration ?? ""}`.toLowerCase().includes(q)) : all;
  }, [all, search]);
  const voidedCount = matching.filter((e) => e.isVoided).length;
  const statusTabs = [
    { value: "all", label: "All", count: matching.length },
    { value: "active", label: "Active", count: matching.length - voidedCount },
    { value: "voided", label: "Voided", count: voidedCount },
  ];
  const rows = useMemo(() => {
    const list = matching.filter((e) => status === "all" || (status === "voided") === !!e.isVoided);
    const dir = sort.dir === "asc" ? 1 : -1;
    const val = (e: any) =>
      sort.key === "amount" ? parseFloat(e.totalAmount) : sort.key === "number" ? e.entryNumber : new Date(e.entryDate).getTime();
    // Ties keep the newest entry first.
    return [...list].sort((x, y) => {
      const a = val(x), b = val(y);
      const c = typeof a === "string" ? a.localeCompare(b as string, undefined, { numeric: true }) : (a as number) - (b as number);
      return c * dir || y.entryNumber.localeCompare(x.entryNumber, undefined, { numeric: true });
    });
  }, [matching, status, sort]);
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  // The last page emptied out (or rows per page grew): step back.
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);
  const filtered = !!search.trim() || status !== "all";

  return (
    <div className="mb-5 rounded-2xl border border-border-light bg-surface-0 overflow-clip">
      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap border-b border-border-light px-4 py-2">
        <DateRangeBar
          preset={dateRange.preset}
          onPresetChange={dateRange.setPreset}
          customFrom={dateRange.customFrom}
          customTo={dateRange.customTo}
          onCustomChange={dateRange.setCustomRange}
        />
        <div className="min-w-0 max-w-full overflow-x-auto sm:ml-auto">
          <PillTabs tabs={statusTabs} value={status} onChange={setStatus} />
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <JournalTableSkeleton />
      ) : !total ? (
        filtered ? (
          <EmptyState
            title="No matching entries"
            description={search.trim() ? `No ${status === "all" ? "" : status + " "}entries match "${search.trim()}".` : `No ${status} entries in this period.`}
          />
        ) : (
          <EmptyState
            title="No journal entries"
            description="Create your first journal entry to record manual accounting adjustments"
            action={<button className="btn-primary" onClick={onNew}>+ New Entry</button>}
          />
        )
      ) : (
        <>
          <Pagination placement="top" page={page} totalPages={totalPages} onPageChange={setPage} total={total} pageSize={pageSize}>
            <SortMenu options={SORT_OPTIONS} sort={sort} onSort={setSort} />
          </Pagination>
          <TableScroll ref={tableRef}>
            <table className="data-table w-full">
              <thead>
                <tr>
                  <th className="w-8"><span className="sr-only">Expand</span></th>
                  <SortableTh sortKey="number" sort={sort} onSort={setSort}>Entry #</SortableTh>
                  <SortableTh sortKey="date" sort={sort} onSort={setSort} firstDir="desc">Date</SortableTh>
                  <th>Narration</th>
                  <SortableTh sortKey="amount" sort={sort} onSort={setSort} firstDir="desc" align="right">Amount</SortableTh>
                  <th>Source</th>
                  <th>Status</th>
                  <th className="text-right"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((entry: any) => (
                  <EntryRow
                    key={entry.id}
                    entry={entry}
                    isExpanded={expandedEntryId === entry.id}
                    isVoided={entry.isVoided}
                    isManual={entry.source === "manual"}
                    expandedEntry={expandedEntry}
                    isFetchingDetail={isFetchingDetail}
                    onToggleExpand={() => onToggleExpand(entry.id)}
                    onEdit={() => onEdit(entry)}
                    onVoid={() => onVoid(entry.id)}
                    onSaveAsTemplate={() => onSaveAsTemplate(entry)}
                  />
                ))}
              </tbody>
            </table>
          </TableScroll>
          <Pagination
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
            total={total}
            pageSize={pageSize}
            onPageSizeChange={setPageSize}
          />
        </>
      )}
    </div>
  );
}

// ── Entry Row (with expandable detail) ─────────────────────────

function EntryRow({
  entry,
  isExpanded,
  isVoided,
  isManual,
  expandedEntry,
  isFetchingDetail,
  onToggleExpand,
  onEdit,
  onVoid,
  onSaveAsTemplate,
}: {
  entry: any;
  isExpanded: boolean;
  isVoided: boolean;
  isManual: boolean;
  expandedEntry: any;
  isFetchingDetail: boolean;
  onToggleExpand: () => void;
  onEdit: () => void;
  onVoid: () => void;
  onSaveAsTemplate: () => void;
}) {
  return (
    <>
      <tr
        className={cn(
          "cursor-pointer",
          isVoided && "opacity-60",
          isExpanded && "bg-surface-1"
        )}
        onClick={onToggleExpand}
      >
        {/* Expand chevron */}
        <td className="w-8 text-center">
          <Icon icon={ArrowRight01Icon} size={14} className={cn("text-text-tertiary transition-transform inline-block", isExpanded && "rotate-90")} />
        </td>

        {/* Entry number */}
        <td
          className={cn(
            "font-mono text-xs whitespace-nowrap",
            isVoided ? "line-through text-text-tertiary" : "text-text-primary"
          )}
        >
          {entry.entryNumber}
        </td>

        {/* Date */}
        <td className="text-text-secondary whitespace-nowrap">
          {formatDate(entry.entryDate)}
        </td>

        {/* Narration */}
        <td
          className={cn(
            "max-w-[250px] truncate",
            isVoided
              ? "line-through text-text-tertiary"
              : "text-text-primary"
          )}
        >
          {entry.narration || "--"}
        </td>

        {/* Amount */}
        <td className="text-right tabular-nums font-semibold whitespace-nowrap text-text-primary">
          {formatCurrency(entry.totalAmount)}
        </td>

        {/* Source badge */}
        <td>
          <Badge color={isManual ? "bg-blue-600/[0.08] text-blue-700 dark:text-blue-400" : "bg-surface-2 text-text-secondary"}>
            {isManual ? "Manual" : "System"}
          </Badge>
        </td>

        {/* Status */}
        <td>
          {isVoided ? (
            <Badge color="bg-red-600/[0.08] text-red-600 dark:text-red-400">Voided</Badge>
          ) : (
            <Badge color="bg-emerald-600/[0.08] text-emerald-700 dark:text-emerald-400">Active</Badge>
          )}
        </td>

        {/* Actions */}
        <td className="text-right" onClick={(e) => e.stopPropagation()}>
          <RowActions
            label={entry.entryNumber}
            items={tidyMenu([
              { label: isExpanded ? "Hide lines" : "Show lines", onSelect: onToggleExpand },
              isManual && !isVoided && { label: "Edit entry", onSelect: onEdit },
              isManual && !isVoided && { label: "Save as template", onSelect: onSaveAsTemplate },
              { kind: "separator" },
              isManual && !isVoided && { label: "Void entry", danger: true, onSelect: onVoid },
            ])}
          />
        </td>
      </tr>

      {/* Expanded detail rows */}
      {isExpanded && (
        <tr>
          <td colSpan={8} className="p-0">
            <div className="bg-surface-1/50 border-y border-border-light px-6 py-4 animate-rise-in">
              {isFetchingDetail ? (
                <div role="status" aria-label="Loading lines" className="grid gap-3 py-1">
                  {[0, 1].map((i) => (
                    <div key={i} aria-hidden className="flex items-center justify-between gap-6">
                      <Bone className={i ? "w-40" : "w-48"} />
                      <Bone className="w-24" />
                      <Bone className="w-24" />
                    </div>
                  ))}
                </div>
              ) : expandedEntry ? (
                <div>
                  <div className="flex items-center gap-4 mb-3">
                    <p className="text-xs font-medium text-text-secondary">
                      {expandedEntry.lines?.length ?? 0} line items
                    </p>
                    {entry.createdByName && (
                      <p className="text-xs text-text-tertiary">
                        Created by {entry.createdByName}
                      </p>
                    )}
                    {entry.voidedByEntryId && (
                      <p className="text-xs text-red-500">
                        Voided by entry #{entry.voidedByEntryId}
                      </p>
                    )}
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-text-tertiary">
                        <th className="text-left pb-2 font-medium">Account</th>
                        <th className="text-right pb-2 font-medium">Debit</th>
                        <th className="text-right pb-2 font-medium">Credit</th>
                        <th className="text-left pb-2 font-medium pl-4">
                          Note
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {expandedEntry.lines?.map((line: any) => (
                        <tr
                          key={line.id}
                          className="border-t border-border-light/50"
                        >
                          <td className="py-2 text-text-primary">
                            <span className="font-mono text-xs text-text-tertiary mr-2">
                              {line.accountCode}
                            </span>
                            {line.accountName}
                          </td>
                          <td className="py-2 text-right tabular-nums text-text-primary">
                            {parseFloat(line.debit) > 0
                              ? formatCurrency(line.debit)
                              : "--"}
                          </td>
                          <td className="py-2 text-right tabular-nums text-text-primary">
                            {parseFloat(line.credit) > 0
                              ? formatCurrency(line.credit)
                              : "--"}
                          </td>
                          <td className="py-2 pl-4 text-text-tertiary text-xs">
                            {line.narration || "--"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Templates Tab ──────────────────────────────────────────────

function TemplatesTab({
  templates,
  onUse,
  onDelete,
}: {
  templates: any;
  onUse: (template: any) => void;
  onDelete: (id: string, name: string) => void;
}) {
  if (!templates) {
    return (
      <div className="rounded-2xl border border-border-light bg-surface-0 overflow-clip">
        <TableSkeleton rows={4} columns={[{ label: "Name" }, { label: "Narration" }, { label: "Lines" }, { align: "right", kind: "button" }]} />
      </div>
    );
  }

  if (!templates.length) {
    return (
      <div className="card">
        <EmptyState
          title="No templates"
          description='Save frequently used journal entries as templates. Use "Save as Template" from any manual entry.'
        />
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border-light bg-surface-0 overflow-clip">
      <table className="data-table w-full">
        <thead>
          <tr>
            <th>Name</th>
            <th>Narration</th>
            <th>Lines</th>
            <th className="text-right"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {templates.map((tpl: any) => (
            <tr key={tpl.id}>
              <td className="font-medium text-text-primary">{tpl.name}</td>
              <td className="text-text-secondary max-w-[250px] truncate">
                {tpl.narration || "--"}
              </td>
              <td className="text-text-tertiary text-xs">
                {tpl.lines?.length ?? 0} lines
              </td>
              <td className="text-right">
                <RowActions
                  label={tpl.name}
                  items={[
                    { label: "Use template", onSelect: () => onUse(tpl) },
                    { kind: "separator" },
                    { label: "Delete template", danger: true, onSelect: () => onDelete(tpl.id, tpl.name) },
                  ]}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Skeleton ────────────────────────────────────────────────────

function JournalTableSkeleton() {
  return (
    <TableSkeleton
      columns={[{}, { label: "Entry #", kind: "mono" }, { label: "Date" }, { label: "Narration" }, { label: "Amount", align: "right" }, { label: "Source", kind: "badge" }, { label: "Status", kind: "badge" }, { align: "right", kind: "button" }]}
    />
  );
}
