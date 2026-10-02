import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import { usePageSearch } from "@/lib/page-search";
import { trpc } from "@/lib/trpc";
import { formatCurrency, formatDate, downloadCSV, todayISODate, toISOString, formatDateInput, cn } from "@/lib/utils";
import { useSaveTick } from "@/hooks/useSaveTick";
import { SavedTick } from "@/components/ui/SavedTick";
import { useFlashRows } from "@/hooks/useFlashRows";
import { badgeColor, badgeColorFallback } from "@/lib/badge-colors";
import { Badge } from "@/components/ui/Badge";
import { toast } from "@/hooks/useToast";
import { useDebounce } from "@/hooks/useDebounce";
import { useHotkeys } from "@/hooks/useHotkeys";
import { useDateRange } from "@/hooks/useDateRange";
import { PageHeader } from "@/components/ui/PageHeader";
import { SlideOver } from "@/components/ui/SlideOver";
import { InputField } from "@/components/ui/FormField";
import { Listbox } from "@/components/ui/Listbox";
import { ListCard, FilterField } from "@/components/ui/ListCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { DeleteConfirmDialog } from "@/components/ui/DeleteConfirmDialog";
import { DateRangeBar } from "@/components/ui/DateRangeBar";
import { useDeleteConfirmation } from "@/hooks/useDeleteConfirmation";
import { usePageSize } from "@/hooks/usePageSize";
import { SortableTh, type SortOption, type SortState } from "@/components/ui/Table";
import { RowActions, tidyMenu } from "@/components/ui/Menu";

export const Route = createFileRoute("/expenses")({
  component: ExpensesPage,
});

type ExpenseSortKey = "date" | "amount" | "category";

const SORT_OPTIONS: SortOption<ExpenseSortKey>[] = [
  { key: "date", dir: "desc", label: "Newest first" },
  { key: "date", dir: "asc", label: "Oldest first" },
  { key: "amount", dir: "desc", label: "Amount: high to low" },
  { key: "amount", dir: "asc", label: "Amount: low to high" },
  { key: "category", dir: "asc", label: "Category: A to Z" },
];

const MODE_OPTIONS = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "bank", label: "Bank Transfer" },
  { value: "cheque", label: "Cheque" },
  { value: "other", label: "Other" },
];

function modeColor(mode: string) {
  switch (mode) {
    case "upi":
      return badgeColor("brand");
    case "cash":
      return badgeColor("emerald");
    case "bank":
      return badgeColor("blue");
    case "cheque":
      return badgeColor("amber");
    default:
      return badgeColorFallback;
  }
}

const TODAY_ISO = todayISODate();

type ExpenseFormState = {
  category: string;
  description: string;
  amount: string;
  mode: string;
  expenseDate: string;
  referenceNumber: string;
};

const EMPTY_FORM: ExpenseFormState = {
  category: "",
  description: "",
  amount: "",
  mode: "cash",
  expenseDate: TODAY_ISO,
  referenceNumber: "",
};

function ExpensesPage() {
  const [search] = usePageSearch("Search category or description…");
  const [categoryFilter, setCategoryFilter] = useState("");
  const dateRange = useDateRange("expenses", "this-month");
  const [sort, setSort] = useState<SortState<ExpenseSortKey>>({ key: "date", dir: "desc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize("expenses", 25);
  const tableRef = useRef<HTMLDivElement>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editExpenseId, setEditExpenseId] = useState<string | null>(null);
  const deleteConfirm = useDeleteConfirmation();
  const [form, setForm] = useState<ExpenseFormState>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<Partial<Record<keyof ExpenseFormState, string>>>({});
  const [exporting, setExporting] = useState(false);

  const debouncedSearch = useDebounce(search, 300);

  // Back to page 1 whenever filters, sort or rows per page change
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, categoryFilter, dateRange.fromDate, dateRange.toDate, sort.key, sort.dir, pageSize]);
  // A new page starts at its first row.
  useEffect(() => { tableRef.current?.scrollTo({ top: 0 }); }, [page]);

  useHotkeys([
    {
      key: "n",
      handler: () => {
        setEditExpenseId(null);
        setForm({ ...EMPTY_FORM, expenseDate: todayISODate() });
        setFormErrors({});
        setShowAddModal(true);
      },
      description: "New expense",
      scope: "expenses",
    },
  ]);

  const listInput = {
    page,
    limit: pageSize,
    search: debouncedSearch || undefined,
    category: categoryFilter || undefined,
    fromDate: dateRange.fromDate,
    toDate: dateRange.toDate,
    sortBy: sort.key,
    sortDir: sort.dir,
  };
  const { data, isFetching, isLoading, isPlaceholderData } = trpc.expense.list.useQuery(listInput, {
    // Keep the current page on screen while the next one loads.
    placeholderData: (prev) => prev,
  });
  // Rows just added or saved glow green for a moment.
  const flash = useFlashRows(isPlaceholderData ? undefined : data?.data, JSON.stringify(listInput));

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  // Deleting the last row of the last page: step back a page.
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  const { data: categories } = trpc.expense.categories.useQuery();

  const utils = trpc.useUtils();

  // The save button shows a tick before the panel closes.
  const tick = useSaveTick();
  const createMutation = trpc.expense.create.useMutation({
    onSuccess: () => {
      utils.expense.list.invalidate();
      utils.expense.categories.invalidate();
      utils.expense.summary.invalidate();
      utils.dashboard.summary.invalidate();
      // The expense's withdrawal moved a bank or cash balance, and a
      // statement line reconciled against it may have reopened.
      utils.bankAccount.invalidate();
      utils.bankRecon.invalidate();
      toast.success("Expense added");
      tick.finish(() => setShowAddModal(false));
      setForm({ ...EMPTY_FORM, expenseDate: todayISODate() });
    },
    onError: (err) => toast.error(err.message),
  });

  const updateMutation = trpc.expense.update.useMutation({
    onSuccess: () => {
      utils.expense.list.invalidate();
      utils.expense.categories.invalidate();
      utils.expense.summary.invalidate();
      utils.dashboard.summary.invalidate();
      // The expense's withdrawal moved a bank or cash balance, and a
      // statement line reconciled against it may have reopened.
      utils.bankAccount.invalidate();
      utils.bankRecon.invalidate();
      toast.success("Expense updated");
      tick.finish(() => setShowAddModal(false));
      setEditExpenseId(null);
      setForm({ ...EMPTY_FORM, expenseDate: todayISODate() });
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = trpc.expense.delete.useMutation({
    onSuccess: () => {
      utils.expense.list.invalidate();
      utils.expense.categories.invalidate();
      utils.expense.summary.invalidate();
      utils.dashboard.summary.invalidate();
      // The expense's withdrawal moved a bank or cash balance, and a
      // statement line reconciled against it may have reopened.
      utils.bankAccount.invalidate();
      utils.bankRecon.invalidate();
      toast.success("Expense deleted");
      deleteConfirm.cancelDelete();
    },
    onError: (err) => toast.error(err.message),
  });

  function openAdd() {
    setEditExpenseId(null);
    setForm({ ...EMPTY_FORM, expenseDate: todayISODate() });
    setFormErrors({});
    setShowAddModal(true);
  }

  function openEdit(exp: any) {
    setEditExpenseId(exp.id);
    setForm({
      category: exp.category,
      description: exp.description || "",
      amount: exp.amount,
      mode: exp.mode,
      expenseDate: formatDateInput(exp.expenseDate),
      referenceNumber: exp.referenceNumber || "",
    });
    setFormErrors({});
    setShowAddModal(true);
  }

  function validateForm(): boolean {
    const errs: Partial<Record<keyof ExpenseFormState, string>> = {};
    if (!form.category.trim()) errs.category = "Category is required";
    if (!form.amount || isNaN(parseFloat(form.amount)) || parseFloat(form.amount) <= 0)
      errs.amount = "Valid amount required";
    if (!form.mode) errs.mode = "Payment mode is required";
    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleSubmit() {
    if (!validateForm()) return;
    const payload = {
      category: form.category.trim(),
      description: form.description.trim() || undefined,
      amount: parseFloat(form.amount).toFixed(2),
      mode: form.mode as any,
      expenseDate: toISOString(form.expenseDate),
      referenceNumber: form.referenceNumber.trim() || undefined,
    };
    if (editExpenseId) {
      updateMutation.mutate({ id: editExpenseId, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  async function exportExpensesCSV() {
    setExporting(true);
    try {
      let allData: any[] = [];
      let pg = 1;
      let hasMore = true;
      while (hasMore) {
        const result = await utils.expense.list.fetch({
          page: pg,
          limit: 100,
          search: debouncedSearch || undefined,
          category: categoryFilter || undefined,
          fromDate: dateRange.fromDate,
          toDate: dateRange.toDate,
          // The file matches what's on screen: same filters, same order.
          sortBy: sort.key,
          sortDir: sort.dir,
        });
        allData = [...allData, ...result.data];
        hasMore = allData.length < result.total;
        pg++;
      }

      const headers = ["Date", "Category", "Description", "Mode", "Reference", "Amount"];
      const rows = allData.map((exp: any) => [
        formatDate(exp.expenseDate),
        exp.category || "",
        exp.description || "",
        exp.mode,
        exp.referenceNumber || "",
        exp.amount,
      ]);

      downloadCSV(`expenses_${dateRange.preset}`, headers, rows);
    } finally {
      setExporting(false);
    }
  }

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  return (
    <div>
      <PageHeader
        title="Expenses"
        description="Track business expenses and outflows"
        actions={
          <button className="btn-primary" onClick={openAdd}>
            + New Expense
          </button>
        }
      />

      <ListCard
        className="mb-5"
        filters={
          <>
            <DateRangeBar
              preset={dateRange.preset}
              onPresetChange={dateRange.setPreset}
              customFrom={dateRange.customFrom}
              customTo={dateRange.customTo}
              onCustomChange={dateRange.setCustomRange}
              onExport={exportExpensesCSV}
              exporting={exporting}
            />
            {!!categories?.length && (
              <FilterField label="Category" value={categoryFilter} onChange={setCategoryFilter}>
                <option value="">All categories</option>
                {categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </FilterField>
            )}
          </>
        }
        sort={{ options: SORT_OPTIONS, value: sort, onChange: setSort }}
        onClearFilters={categoryFilter ? () => setCategoryFilter("") : undefined}
        pagination={{ page, totalPages, onPageChange: setPage, total, pageSize, onPageSizeChange: setPageSize }}
        loading={isLoading}
        fetching={isFetching}
        tableRef={tableRef}
        empty={
          !rows.length && !isFetching ? (
            <EmptyState
              title="No expenses"
              description={
                search || categoryFilter
                  ? "No expenses match your filters"
                  : "Add your first expense to get started"
              }
            />
          ) : undefined
        }
      >
        <table className="data-table w-full">
                <thead>
                  <tr>
                    <SortableTh sortKey="date" sort={sort} onSort={setSort} firstDir="desc">Date</SortableTh>
                    <SortableTh sortKey="category" sort={sort} onSort={setSort}>Category</SortableTh>
                    <th>Description</th>
                    <th>Mode</th>
                    <th>Reference</th>
                    <SortableTh sortKey="amount" sort={sort} onSort={setSort} firstDir="desc" align="right">Amount</SortableTh>
                    <th className="text-right"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((exp) => (
                    <tr key={exp.id} className={cn(flash.has(exp.id) && "animate-row-flash")}>
                      <td className="text-text-secondary whitespace-nowrap">
                        {formatDate(exp.expenseDate)}
                      </td>
                      <td>
                        <Badge size="md" color="bg-surface-2 text-text-secondary">
                          {exp.category}
                        </Badge>
                      </td>
                      <td className="text-text-primary max-w-[200px] truncate">
                        {exp.description || "—"}
                      </td>
                      <td>
                        <Badge size="sm" color={modeColor(exp.mode)} className="uppercase">
                          {exp.mode}
                        </Badge>
                      </td>
                      <td className="text-text-tertiary font-mono text-xs">
                        {exp.referenceNumber || "—"}
                      </td>
                      <td className="text-right tabular-nums font-semibold text-red-600 whitespace-nowrap">
                        {formatCurrency(exp.amount)}
                      </td>
                      <td className="text-right" onClick={(e) => e.stopPropagation()}>
                        {/* Rows don't open on click, so Edit is the way in. */}
                        <RowActions
                          label={exp.description || exp.category}
                          items={tidyMenu([
                            { label: "Edit", onSelect: () => openEdit(exp) },
                            { kind: "separator" },
                            {
                              label: "Delete expense",
                              danger: true,
                              onSelect: () => deleteConfirm.requestDelete(exp.id, exp.description || exp.category),
                            },
                          ])}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
      </ListCard>

      {/* Add / Edit SlideOver */}
      <SlideOver
        open={showAddModal}
        onClose={() => {
          setShowAddModal(false);
          setEditExpenseId(null);
        }}
        title={editExpenseId ? "Edit Expense" : "Add Expense"}
        description={editExpenseId ? "Update expense details" : "Record a new business expense"}
        footer={
          <div className="flex justify-end gap-3">
            <button
              className="btn-secondary"
              onClick={() => {
                setShowAddModal(false);
                setEditExpenseId(null);
              }}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              className={cn("btn-primary", tick.saved && "!bg-emerald-600 disabled:!opacity-100")}
              onClick={handleSubmit}
              disabled={isSubmitting || tick.saved}
            >
              {tick.saved ? <SavedTick label={editExpenseId ? "Saved" : "Added"} /> : isSubmitting
                ? editExpenseId
                  ? "Saving…"
                  : "Adding…"
                : editExpenseId
                  ? "Save Changes"
                  : "Add Expense"}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <InputField
                label="Category"
                placeholder="e.g. Rent, Utilities, Travel"
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                error={formErrors.category}
                required
                autoFocus
              />
            </div>
            <InputField
              label="Amount"
              placeholder="0.00"
              type="number"
              min="0"
              step="0.01"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              error={formErrors.amount}
              required
            />
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">
                Payment Mode
              </label>
              <Listbox
                ariaLabel="Payment Mode"
                value={form.mode}
                onChange={(val) => setForm((f) => ({ ...f, mode: val }))}
                options={MODE_OPTIONS}
              />
              {formErrors.mode && (
                <p className="mt-1 text-xs text-red-500">{formErrors.mode}</p>
              )}
            </div>
            <InputField
              label="Date"
              type="date"
              value={form.expenseDate}
              onChange={(e) => setForm((f) => ({ ...f, expenseDate: e.target.value }))}
            />
            <InputField
              label="Reference # (optional)"
              placeholder="e.g. invoice/receipt #"
              value={form.referenceNumber}
              onChange={(e) => setForm((f) => ({ ...f, referenceNumber: e.target.value }))}
            />
            <div className="col-span-2">
              <InputField
                label="Description (optional)"
                placeholder="Brief note about this expense"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
          </div>
        </div>
      </SlideOver>

      <DeleteConfirmDialog
        target={deleteConfirm.deleteTarget}
        entityName="Expense"
        loading={deleteMutation.isPending}
        onConfirm={() => deleteConfirm.deleteTarget && deleteMutation.mutate({ id: deleteConfirm.deleteTarget.id })}
        onCancel={deleteConfirm.cancelDelete}
      />
    </div>
  );
}

