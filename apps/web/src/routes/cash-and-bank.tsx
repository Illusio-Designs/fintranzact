import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import { usePageSearch } from "@/lib/page-search";
import { trpc } from "@/lib/trpc";
import { cn, formatCurrency, formatDate, formatDateInput, toISOString, toISOStringEndOfDay, todayISODate } from "@/lib/utils";
import { Badge } from "@/components/ui/Badge";
import { StatCard } from "@/components/ui/StatCard";
import { PageHeader } from "@/components/ui/PageHeader";
import { SlideOver } from "@/components/ui/SlideOver";
import { InputField, SelectField } from "@/components/ui/FormField";
import { SegmentedControl } from "@/components/ui/Tabs";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Listbox } from "@/components/ui/Listbox";
import { DateInput } from "@/components/ui/DateInput";
import { Icon } from "@/components/ui/Icon";
import { Alert02Icon, Download04Icon, PencilEdit02Icon, StarIcon } from "@hugeicons/core-free-icons";
import { ListCard } from "@/components/ui/ListCard";
import { usePageSize } from "@/hooks/usePageSize";
import { useDebounce } from "@/hooks/useDebounce";
import { toast } from "@/hooks/useToast";
import { getDatePreset } from "@/hooks/useDateRange";
import type { GatewayChargeConfig } from "@fintranzact/shared";

import { Spinner } from "@/components/ui/Spinner";
export const Route = createFileRoute("/cash-and-bank")({
  component: CashAndBankPage,
});

function CashAndBankPage() {
  const navigate = useNavigate();
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [editAccountId, setEditAccountId] = useState<string | null>(null);
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [showAddTransaction, setShowAddTransaction] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [selectedUntracked, setSelectedUntracked] = useState<Set<string>>(new Set());
  const [selectAllMatching, setSelectAllMatching] = useState(false); // true = all across ALL pages
  const [assignAccountId, setAssignAccountId] = useState<string | null>(null);
  const [untrackedSearch] = usePageSearch("Search party or payment #…");
  const [untrackedMode, setUntrackedMode] = useState("");
  const [untrackedPage, setUntrackedPage] = useState(1);
  const [untrackedPageSize, setUntrackedPageSize] = usePageSize("bank_untracked", 25);
  const untrackedTableRef = useRef<HTMLDivElement>(null);
  const debouncedUntrackedSearch = useDebounce(untrackedSearch, 300);

  // Reset page and selection when filters or rows per page change
  useEffect(() => {
    setUntrackedPage(1);
    setSelectedUntracked(new Set());
    setSelectAllMatching(false);
  }, [debouncedUntrackedSearch, untrackedMode, untrackedPageSize]);
  const [datePreset, setDatePreset] = useState<string | null>(null); // null = no preset selected yet
  const [dateRange, setDateRange] = useState<{ fromDate: string; toDate: string }>({ fromDate: "", toDate: "" });
  const [exporting, setExporting] = useState(false);

  // Combine list + summary into parallel fetch (both are lightweight single-query endpoints)
  const { data: accounts, isLoading } = trpc.bankAccount.list.useQuery();
  const { data: summary } = trpc.bankAccount.summary.useQuery(undefined, {
    staleTime: 60_000, // cache for 1 min — summary changes slowly
  });
  // Transactions come a page at a time. Each row's running balance is worked
  // out on the server over the whole account, so it is right on any page.
  const [txnPage, setTxnPage] = useState(1);
  const [txnPageSize, setTxnPageSize] = usePageSize("bank_transactions", 25);
  const txnTableRef = useRef<HTMLDivElement>(null);

  const { data: transactions, isFetching: txnFetching } = trpc.bankAccount.listTransactions.useQuery(
    {
      bankAccountId: selectedAccountId!,
      page: txnPage,
      limit: txnPageSize,
      fromDate: dateRange.fromDate || undefined,
      toDate: dateRange.toDate || undefined,
    },
    {
      enabled: !!selectedAccountId && datePreset !== null,
      // Keep the current page on screen while the next one loads.
      placeholderData: (prev) => prev,
    }
  );
  const txns = transactions?.data ?? [];
  const txnTotal = transactions?.total ?? 0;
  const txnTotalPages = Math.max(1, Math.ceil(txnTotal / txnPageSize));

  // Back to page 1 when the account, period or rows per page change
  useEffect(() => {
    setTxnPage(1);
  }, [selectedAccountId, dateRange.fromDate, dateRange.toDate, txnPageSize]);
  // Fewer rows than before (e.g. a shorter period): step back to the last page.
  useEffect(() => { if (txnPage > txnTotalPages) setTxnPage(txnTotalPages); }, [txnPage, txnTotalPages]);
  // A new page starts at its first row.
  useEffect(() => { txnTableRef.current?.scrollTo({ top: 0 }); }, [txnPage]);

  // Lazy-load untracked payments — delay initial fetch to prioritize account list rendering
  const [untrackedEnabled, setUntrackedEnabled] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setUntrackedEnabled(true), 500);
    return () => clearTimeout(timer);
  }, []);
  const { data: untrackedData, isFetching: untrackedFetching } = trpc.payment.untrackedPayments.useQuery({
    page: untrackedPage,
    limit: untrackedPageSize,
    search: debouncedUntrackedSearch || undefined,
    mode: (untrackedMode || undefined) as any,
  }, {
    enabled: untrackedEnabled,
    // Keep the current page on screen while the next one loads.
    placeholderData: (prev) => prev,
  });
  const untrackedTotalPages = Math.max(1, Math.ceil((untrackedData?.total ?? 0) / untrackedPageSize));
  // Assigning the last rows of the last page: step back a page.
  useEffect(() => {
    if (untrackedPage > untrackedTotalPages) setUntrackedPage(untrackedTotalPages);
  }, [untrackedPage, untrackedTotalPages]);
  // A new page starts at its first row.
  useEffect(() => { untrackedTableRef.current?.scrollTo({ top: 0 }); }, [untrackedPage]);
  // Track if we've ever seen untracked payments — prevents section from vanishing on refetch
  // Only hide when there are truly 0 untracked (no filters applied, query finished, total is 0)
  const [hadUntracked, setHadUntracked] = useState(false);
  useEffect(() => {
    if (untrackedData && untrackedData.total > 0) setHadUntracked(true);
    // Only hide if no filters are active AND query returned 0
    const hasFilters = !!debouncedUntrackedSearch || !!untrackedMode;
    if (untrackedData && untrackedData.total === 0 && !untrackedFetching && !hasFilters) {
      setHadUntracked(false);
    }
  }, [untrackedData, untrackedFetching, debouncedUntrackedSearch, untrackedMode]);

  // Auto-pick best matching account when untracked selection changes
  useEffect(() => {
    if (selectedUntracked.size === 0 || !accounts?.length) return;

    // Count payment modes among selected items
    const modeCounts = new Map<string, number>();
    for (const id of selectedUntracked) {
      const pmt = untrackedData?.data?.find((p) => p.id === id);
      if (pmt?.mode) modeCounts.set(pmt.mode, (modeCounts.get(pmt.mode) || 0) + 1);
    }

    // Find dominant mode
    let dominantMode = "";
    let maxCount = 0;
    for (const [mode, count] of modeCounts) {
      if (count > maxCount) { dominantMode = mode; maxCount = count; }
    }

    // Match dominant mode to best account
    let bestAccount = accounts.find((a) => a.isDefault);
    if (dominantMode === "cash") {
      bestAccount = accounts.find((a) => a.accountType === "cash") || bestAccount;
    } else if (dominantMode === "upi") {
      bestAccount = accounts.find((a) => a.accountType === "upi") || bestAccount;
    } else if (dominantMode === "bank") {
      bestAccount = accounts.find((a) => a.accountType === "savings" || a.accountType === "current") || bestAccount;
    }

    if (bestAccount) setAssignAccountId(bestAccount.id);
  }, [selectedUntracked.size]); // re-run when selection size changes

  const utils = trpc.useUtils();

  async function exportTransactionsCSV() {
    if (!selectedAccountId || datePreset === null) return;
    const selectedAccount = accounts?.find((a) => a.id === selectedAccountId);
    setExporting(true);
    try {
      let allData: any[] = [];
      let page = 1;
      const limit = 100;
      let hasMore = true;
      while (hasMore) {
        const result = await utils.bankAccount.listTransactions.fetch({
          bankAccountId: selectedAccountId,
          page,
          limit,
          fromDate: dateRange.fromDate || undefined,
          toDate: dateRange.toDate || undefined,
        });
        allData = [...allData, ...result.data];
        hasMore = allData.length < result.total;
        page++;
      }

      const headers = ["Date", "Description", "Type", "Amount", "Balance After"];
      const rows = allData.map((txn: any) => [
        formatDate(txn.transactionDate),
        (txn.description || "").replace(/"/g, '""'),
        txn.type,
        txn.type === "deposit" ? txn.amount : `-${txn.amount}`,
        txn.balanceAfter,
      ]);

      const csv = [
        `Account,${selectedAccount?.accountName || ""}`,
        `Period,${datePreset}`,
        `Exported,${formatDate(new Date())}`,
        `Transactions,${allData.length}`,
        "",
        headers.join(","),
        ...rows.map((r) => r.map((cell: any) => `"${String(cell)}"`).join(",")),
      ].join("\n");

      const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${selectedAccount?.accountName || "transactions"}_${datePreset || "all"}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  const deleteAccountMutation = trpc.bankAccount.delete.useMutation({
    onSuccess: () => {
      toast.success("Account deleted");
      if (selectedAccountId === deleteConfirm) setSelectedAccountId(null);
      if (editAccountId === deleteConfirm) setEditAccountId(null);
      setDeleteConfirm(null);
      utils.bankAccount.list.invalidate();
      utils.bankAccount.summary.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const assignMutation = trpc.payment.assignAccount.useMutation({
    onSuccess: (result) => {
      utils.payment.untrackedPayments.invalidate();
      utils.bankAccount.list.invalidate();
      utils.bankAccount.summary.invalidate();
      setSelectedUntracked(new Set());
      setSelectAllMatching(false);
      toast.success(`${result.assigned} payment(s) assigned`);
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div>
      <PageHeader
        title="Cash & Bank"
        description="Manage your bank accounts and track transactions"
        actions={
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={() => setShowTransfer(true)}>
              Transfer
            </button>
            <button className="btn-primary" onClick={() => setShowAddAccount(true)}>
              + Add Account
            </button>
          </div>
        }
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <StatCard
          size="md"
          label="Total Balance"
          value={formatCurrency(summary?.totalBalance || "0")}
        />
        <StatCard
          size="md"
          label="Cash in Hand"
          value={formatCurrency(summary?.cashInHand || "0")}
          valueColor="text-emerald-600"
        />
        <StatCard
          size="md"
          label="Bank Balance"
          value={formatCurrency(summary?.bankBalance || "0")}
        />
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        {/* Left: Account list */}
        <div className="min-w-0 md:col-span-4">
          <div className="card overflow-clip">
            <div
              className="px-4 py-3 flex items-center justify-between border-b border-border-light"
            >
              <h3 className="text-sm font-semibold text-text-primary">Accounts</h3>
              <button
                className="btn-ghost text-xs"
                onClick={() => setShowAddAccount(true)}
              >
                + Add
              </button>
            </div>

            {isLoading ? (
              <AccountListSkeleton />
            ) : !accounts?.length ? (
              <EmptyState
                title="No accounts"
                description="Add a bank account to track transactions"
              />
            ) : (
              <div className="divide-y divide-border-light">
                {accounts.map((account) => (
                  <div key={account.id} className="relative">
                    <button
                      className={cn(
                        "w-full py-3 pl-4 pr-11 text-left transition-colors",
                        selectedAccountId === account.id
                          ? "bg-brand-600/[0.08] border-l-2 border-brand-600"
                          : "hover:bg-surface-1"
                      )}
                      onClick={() => setSelectedAccountId(account.id)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="min-w-0 pr-2">
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm font-medium text-text-primary truncate">
                              {account.accountName}
                            </p>
                            {account.accountType === "payment_gateway" && (
                              <Badge size="sm" color="bg-purple-600/[0.1] text-purple-700 dark:text-purple-400" className="font-semibold shrink-0">
                                Gateway
                              </Badge>
                            )}
                            {account.isDefault && (
                              <Icon icon={StarIcon} size={12} className="text-amber-500 shrink-0" />
                            )}
                          </div>
                          <p className="text-xs text-text-tertiary mt-0.5">
                            {account.bankName || account.accountType}
                          </p>
                        </div>
                        <p className="text-sm font-semibold tabular-nums text-text-primary flex-shrink-0">
                          {formatCurrency(account.currentBalance)}
                        </p>
                      </div>
                    </button>
                    {/* Edit button — always shown, so it can be found without hovering
                        (this is a picker list, not a table, so it keeps its icon). */}
                    <button
                      className="absolute top-1/2 right-2 -translate-y-1/2 p-1.5 rounded-lg text-text-tertiary hover:text-brand-600 hover:bg-brand-600/[0.08] transition"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditAccountId(account.id);
                      }}
                      aria-label={`Edit ${account.accountName}`}
                    >
                      <Icon icon={PencilEdit02Icon} size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Transactions */}
        <div className="min-w-0 md:col-span-8">
          {selectedAccountId ? (
            <ListCard
              filters={
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
            {[
              { value: "this-month", label: "This Month" },
              { value: "last-month", label: "Last Month" },
              { value: "last-30", label: "Last 30 Days" },
              { value: "this-fy", label: "This FY" },
              { value: "last-fy", label: "Last FY" },
              { value: "custom", label: "Custom" },
              { value: "all", label: "All" },
            ].map((p) => (
              <button
                key={p.value}
                onClick={() => {
                  setDatePreset(p.value);
                  if (p.value !== "custom") {
                    setDateRange(getDatePreset(p.value));
                  }
                }}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                  datePreset === p.value
                    ? "bg-brand-600/[0.1] text-brand-700 dark:text-brand-400"
                    : "text-text-tertiary hover:text-text-secondary hover:bg-surface-2"
                )}
              >
                {p.label}
              </button>
            ))}

            {datePreset === "custom" && (
              <div className="flex items-center gap-2 ml-2">
                <DateInput
                  value={formatDateInput(dateRange.fromDate)}
                  onChange={(e) =>
                    setDateRange((prev) => ({
                      ...prev,
                      fromDate: toISOString(e.target.value) ?? "",
                    }))
                  }
                  className="input py-1 text-xs w-32"
                />
                <span className="text-text-tertiary text-xs">to</span>
                <DateInput
                  value={formatDateInput(dateRange.toDate)}
                  onChange={(e) =>
                    setDateRange((prev) => ({
                      ...prev,
                      toDate: toISOStringEndOfDay(e.target.value) ?? "",
                    }))
                  }
                  className="input py-1 text-xs w-32"
                />
              </div>
            )}
          </div>
              }
              actions={
                <>
                  <button className="btn-ghost text-xs" onClick={() => setShowTransfer(true)}>
                    Transfer
                  </button>
                  {txns.length > 0 && (
                    <button
                      onClick={exportTransactionsCSV}
                      disabled={exporting}
                      className="btn-secondary flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-xs"
                    >
                      {exporting ? <Spinner size="xs" /> : <Icon icon={Download04Icon} size={14} />}
                      {exporting ? "Preparing…" : "Export CSV"}
                    </button>
                  )}
                  <button
                    className="btn-primary px-3 py-1.5 text-xs"
                    onClick={() => setShowAddTransaction(true)}
                  >
                    + Add Transaction
                  </button>
                </>
              }
              loading={datePreset !== null && txns.length === 0 && txnFetching}
              fetching={txnFetching}
              tableRef={txnTableRef}
              pagination={{ page: txnPage, totalPages: txnTotalPages, onPageChange: setTxnPage, total: txnTotal, pageSize: txnPageSize, onPageSizeChange: setTxnPageSize }}
              empty={
                datePreset === null ? (
                  <div className="py-10 text-center">
                    <p className="text-sm text-text-tertiary">Select a time period above to load transactions</p>
                  </div>
                ) : txns.length === 0 && !txnFetching ? (
                  <EmptyState
                    title="No transactions"
                    description="No transactions in this period"
                  />
                ) : undefined
              }
            >
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    <th>Type</th>
                    <th className="text-right">Amount</th>
                    <th className="text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {txns.map((txn: any) => (
                    <tr
                      key={txn.id}
                      className={txn.referenceType === "payment" ? "cursor-pointer hover:bg-surface-1" : ""}
                      onClick={() => {
                        if (txn.referenceType === "payment" && txn.referenceId) {
                          navigate({ to: "/payments", search: { q: txn.description?.match(/Payment (\S+)/)?.[1] || "" } as any });
                        }
                      }}
                    >
                      <td className="text-text-secondary">
                        {formatDate(txn.transactionDate)}
                      </td>
                      <td className={txn.referenceType === "payment" ? "text-brand-600 dark:text-brand-400 hover:underline" : "text-text-primary"}>
                        {txn.description || "—"}
                      </td>
                      <td>
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-2xs font-medium",
                            txn.type === "deposit"
                              ? "bg-emerald-600/[0.08] text-emerald-600 dark:text-emerald-400"
                              : txn.type === "withdrawal"
                                ? "bg-red-600/[0.08] text-red-600 dark:text-red-400"
                                : "bg-blue-600/[0.08] text-blue-600 dark:text-blue-400"
                          )}
                        >
                          {txn.type}
                        </span>
                      </td>
                      <td
                        className={`text-right tabular-nums font-medium ${txn.type === "deposit"
                          ? "text-emerald-600"
                          : "text-red-600"
                          }`}
                      >
                        {txn.type === "deposit" ? "+" : "-"}
                        {formatCurrency(txn.amount)}
                      </td>
                      <td className="text-right tabular-nums text-text-secondary">
                        {formatCurrency(txn.balanceAfter)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ListCard>
          ) : (
            <div className="card">
              <EmptyState
                title="Select an account"
                description="Choose a bank account from the left to view its transactions"
              />
            </div>
          )}
        </div>
      </div>

      {/* Untracked Payments — stays visible during refetch after assignment */}
      {(hadUntracked || (untrackedData && untrackedData.total > 0)) && (
        <div className="mt-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold text-text-primary">
                Untracked Payments
                <span className="ml-2 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-amber-600/[0.08] text-amber-700 dark:text-amber-400 text-2xs font-bold">
                  {untrackedData?.total ?? 0}
                </span>
              </h3>
              <p className="text-xs text-text-tertiary mt-0.5">
                Payments not assigned to any account — filter, select, and assign in bulk
              </p>
            </div>
          </div>


          {/* Bulk assign toolbar — appears when items are selected */}
          {(selectedUntracked.size > 0 || selectAllMatching) && accounts && accounts.length > 0 && (
            <div className="mb-3 rounded-xl border border-brand-200 dark:border-brand-800 bg-brand-600/[0.05]">
              {/* Selection info + "select all matching" upgrade */}
              <div className="px-4 py-2.5 flex items-center justify-between">
                <div className="text-xs">
                  {selectAllMatching ? (
                    <span className="font-medium text-brand-700 dark:text-brand-400">
                      All {untrackedData?.total.toLocaleString()} matching payments selected
                    </span>
                  ) : (
                    <span className="font-medium text-brand-700 dark:text-brand-400">
                      {selectedUntracked.size} payment{selectedUntracked.size !== 1 ? "s" : ""} on this page selected
                    </span>
                  )}
                  {/* Offer to select all matching if current page is fully selected but there are more */}
                  {!selectAllMatching &&
                    untrackedData &&
                    untrackedData.data.length > 0 &&
                    untrackedData.data.every((p) => selectedUntracked.has(p.id)) &&
                    untrackedData.total > untrackedData.data.length && (
                      <button
                        className="ml-2 text-brand-600 dark:text-brand-400 hover:underline font-medium"
                        onClick={() => setSelectAllMatching(true)}
                      >
                        Select all {untrackedData.total.toLocaleString()} matching
                      </button>
                    )}
                </div>
                <button
                  className="btn-ghost text-xs px-2 py-1"
                  onClick={() => { setSelectedUntracked(new Set()); setSelectAllMatching(false); }}
                >
                  Clear
                </button>
              </div>
              {/* Assign controls */}
              <div className="px-4 py-2.5 flex items-center gap-2 border-t border-brand-200/50 dark:border-brand-800/50">
                <span className="text-xs text-text-secondary shrink-0">Assign to:</span>
                <Listbox
                  value={assignAccountId || ""}
                  onChange={setAssignAccountId}
                  options={accounts.map((a) => ({
                    value: a.id,
                    label: `${a.accountName} (${a.accountType})`,
                  }))}
                  placeholder="Select account"
                  className="w-48"
                />
                <button
                  className="btn-primary text-xs px-3 py-1.5"
                  disabled={!assignAccountId || assignMutation.isPending}
                  onClick={() => {
                    if (!assignAccountId) return;
                    if (selectAllMatching) {
                      // Assign ALL matching via server-side filter
                      assignMutation.mutate({
                        allMatching: true,
                        search: debouncedUntrackedSearch || undefined,
                        mode: (untrackedMode || undefined) as any,
                        bankAccountId: assignAccountId,
                      });
                    } else {
                      // Assign selected IDs
                      assignMutation.mutate({
                        paymentIds: Array.from(selectedUntracked),
                        bankAccountId: assignAccountId,
                      });
                    }
                  }}
                >
                  {assignMutation.isPending
                    ? "Assigning…"
                    : selectAllMatching
                      ? `Assign all ${untrackedData?.total.toLocaleString()}`
                      : `Assign ${selectedUntracked.size}`}
                </button>
              </div>
            </div>
          )}

            <ListCard
              tabs={{
                tabs: [
                  { value: "cash", label: "Cash" },
                  { value: "upi", label: "UPI" },
                  { value: "bank", label: "Bank" },
                  { value: "cheque", label: "Cheque" },
                  { value: "other", label: "Other" },
                  { value: "", label: "All" },
                ],
                value: untrackedMode,
                onChange: setUntrackedMode,
                label: "Payment mode",
              }}
              loading={untrackedFetching && !untrackedData}
              fetching={untrackedFetching}
              tableRef={untrackedTableRef}
              pagination={untrackedData ? { page: untrackedPage, totalPages: untrackedTotalPages, onPageChange: setUntrackedPage, total: untrackedData.total, pageSize: untrackedPageSize, onPageSizeChange: setUntrackedPageSize } : undefined}
              empty={
                untrackedData && untrackedData.data.length === 0 ? (
                  <div className="px-4 py-8 text-center">
                    <p className="text-sm text-text-tertiary">
                      {untrackedMode || debouncedUntrackedSearch
                        ? "No untracked payments match this filter"
                        : "All payments are assigned to accounts"}
                    </p>
                  </div>
                ) : undefined
              }
            >
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10">
                      <input
                        type="checkbox"
                        checked={
                          (untrackedData?.data ?? []).length > 0 &&
                          (untrackedData?.data ?? []).every((p) => selectedUntracked.has(p.id))
                        }
                        onChange={(e) => {
                          const next = new Set(selectedUntracked);
                          if (e.target.checked) {
                            (untrackedData?.data ?? []).forEach((p) => next.add(p.id));
                          } else {
                            (untrackedData?.data ?? []).forEach((p) => next.delete(p.id));
                          }
                          setSelectedUntracked(next);
                        }}
                        className="w-4 h-4 rounded"
                      />
                    </th>
                    <th>Payment #</th>
                    <th>Party</th>
                    <th>Date</th>
                    <th>Mode</th>
                    <th className="text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {(untrackedData?.data ?? []).map((pmt) => (
                    <tr
                      key={pmt.id}
                      className="group cursor-pointer"
                      onClick={() => navigate({ to: "/payments", search: { q: pmt.paymentNumber || pmt.partyName } as any })}
                    >
                      <td onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedUntracked.has(pmt.id)}
                          onChange={(e) => {
                            const next = new Set(selectedUntracked);
                            if (e.target.checked) next.add(pmt.id);
                            else next.delete(pmt.id);
                            setSelectedUntracked(next);
                          }}
                          className="w-4 h-4 rounded"
                        />
                      </td>
                      <td className="font-mono text-ui text-brand-600 dark:text-brand-400 hover:underline">
                        {pmt.paymentNumber || "—"}
                      </td>
                      <td className="font-medium">{pmt.partyName}</td>
                      <td className="text-text-secondary">{formatDate(pmt.paymentDate)}</td>
                      <td>
                        <Badge
                          size="sm"
                          color={
                            pmt.mode === "upi" ? "bg-brand-600/[0.08] text-brand-700 dark:text-brand-400" :
                            pmt.mode === "cash" ? "bg-emerald-600/[0.08] text-emerald-700 dark:text-emerald-400" :
                            pmt.mode === "bank" ? "bg-blue-600/[0.08] text-blue-700 dark:text-blue-400" :
                            "bg-surface-2 text-text-secondary"
                          }
                        >
                          {pmt.mode.toUpperCase()}
                        </Badge>
                      </td>
                      <td className="text-right tabular-nums font-semibold text-emerald-600">
                        {formatCurrency(pmt.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ListCard>
        </div>
      )}

      {/* Add Account Modal */}
      {showAddAccount && (
        <AddAccountModal
          onClose={() => setShowAddAccount(false)}
        />
      )}

      {/* Edit Account SlideOver */}
      {editAccountId && (
        <EditAccountSlideOver
          accountId={editAccountId}
          onClose={() => setEditAccountId(null)}
          onDeleteRequest={(id) => setDeleteConfirm(id)}
        />
      )}

      {/* Add Transaction Modal */}
      {showAddTransaction && selectedAccountId && (
        <AddTransactionModal
          bankAccountId={selectedAccountId}
          onClose={() => setShowAddTransaction(false)}
        />
      )}

      {/* Transfer Modal */}
      {showTransfer && (
        <TransferModal
          accounts={accounts ?? []}
          defaultFromId={selectedAccountId}
          onClose={() => setShowTransfer(false)}
        />
      )}

      {/* Delete Confirm */}
      <ConfirmDialog
        open={!!deleteConfirm}
        title="Delete Account"
        description="This will permanently delete this bank account. Accounts with existing transactions cannot be deleted."
        confirmLabel="Delete"
        variant="danger"
        loading={deleteAccountMutation.isPending}
        onConfirm={() =>
          deleteConfirm && deleteAccountMutation.mutate({ id: deleteConfirm })
        }
        onCancel={() => setDeleteConfirm(null)}
      />
    </div>
  );
}

// ─── Edit Account SlideOver ───────────────────────────────────────────────────

function EditAccountSlideOver({
  accountId,
  onClose,
  onDeleteRequest,
}: {
  accountId: string;
  onClose: () => void;
  onDeleteRequest: (id: string) => void;
}) {
  const utils = trpc.useUtils();

  // Fetch the account details
  const { data: accountData, isLoading } = trpc.bankAccount.getById.useQuery(
    { id: accountId },
    { staleTime: 0 }
  );
  const account = accountData;

  const [accountName, setAccountName] = useState("");
  const [accountType, setAccountType] = useState("current");
  const [accountNumber, setAccountNumber] = useState("");
  const [ifsc, setIfsc] = useState("");
  const [bankName, setBankName] = useState("");
  const [openingBalance, setOpeningBalance] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // Gateway-specific state
  const isGateway = accountType === "payment_gateway";
  const [settlementAccountId, setSettlementAccountId] = useState("");
  const [chargeRates, setChargeRates] = useState<Record<string, string>>({
    credit_card: "",
    debit_card: "",
    upi: "",
    net_banking: "",
    wallet: "",
    default: "",
  });
  const [expenseCategory, setExpenseCategory] = useState("Payment Gateway Charges");
  const [autoSettle, setAutoSettle] = useState(true);
  const [gatewayInitialized, setGatewayInitialized] = useState(false);

  // Fetch gateway config if this is a gateway account
  const { data: gatewayConfig } = trpc.bankAccount.getGatewayConfig.useQuery(
    { bankAccountId: accountId },
    { enabled: isGateway && !!account, staleTime: 0 }
  );

  // Fetch non-gateway accounts for settlement dropdown
  const { data: allAccounts } = trpc.bankAccount.list.useQuery(undefined, {
    enabled: isGateway,
  });
  const nonGatewayAccounts = allAccounts?.filter(
    (a) => a.accountType !== "payment_gateway"
  ) ?? [];

  // Populate form when account data loads
  useEffect(() => {
    if (account && !initialized) {
      setAccountName(account.accountName);
      setAccountType(account.accountType);
      setAccountNumber(account.accountNumber ?? "");
      setIfsc(account.ifsc ?? "");
      setBankName(account.bankName ?? "");
      setOpeningBalance(account.openingBalance);
      setIsDefault(account.isDefault);
      setInitialized(true);
    }
  }, [account, initialized]);

  // Populate gateway config when it loads
  useEffect(() => {
    if (gatewayConfig && !gatewayInitialized) {
      setSettlementAccountId(gatewayConfig.settlementAccountId);
      setExpenseCategory(gatewayConfig.expenseCategory);
      setAutoSettle(gatewayConfig.autoSettle);
      const config = gatewayConfig.chargeConfig as GatewayChargeConfig | null;
      if (config) {
        const rates: Record<string, string> = {};
        for (const mode of GATEWAY_CHARGE_MODES) {
          rates[mode.key] = config[mode.key]?.value ?? "";
        }
        setChargeRates(rates);
      }
      setGatewayInitialized(true);
    }
  }, [gatewayConfig, gatewayInitialized]);

  const updateMutation = trpc.bankAccount.update.useMutation({
    onError: (err) => toast.error(err.message),
  });

  const upsertGatewayMutation = trpc.bankAccount.upsertGatewayConfig.useMutation({
    onError: (err) => toast.error(err.message),
  });

  async function handleSave() {
    if (!accountName.trim()) return;
    if (isGateway && !settlementAccountId) {
      toast.error("Please select a settlement bank account");
      return;
    }

    try {
      await updateMutation.mutateAsync({
        id: accountId,
        data: {
          accountName: accountName.trim(),
          accountType: accountType as any,
          accountNumber: isGateway ? undefined : (accountNumber || undefined),
          ifsc: isGateway ? undefined : (ifsc || undefined),
          bankName: isGateway ? undefined : (bankName || undefined),
          openingBalance: openingBalance || "0",
          isDefault,
        },
      });

      if (isGateway) {
        const chargeConfig: GatewayChargeConfig = {};
        for (const mode of GATEWAY_CHARGE_MODES) {
          const val = chargeRates[mode.key];
          if (val && parseFloat(val) > 0) {
            chargeConfig[mode.key] = { type: "percentage", value: parseFloat(val).toString() };
          }
        }

        await upsertGatewayMutation.mutateAsync({
          bankAccountId: accountId,
          settlementAccountId,
          chargeConfig,
          expenseCategory: expenseCategory || "Payment Gateway Charges",
          autoSettle,
        });
      }

      toast.success("Account updated");
      onClose();
      utils.bankAccount.list.invalidate();
      utils.bankAccount.summary.invalidate();
    } catch {
      // Error toast already shown by mutation onError
    }
  }

  const showAccountNumber = accountType === "savings" || accountType === "current" || accountType === "credit_card";
  const showUpiId = accountType === "upi";
  const showIfsc = accountType === "savings" || accountType === "current";
  const showBankName = accountType === "savings" || accountType === "current" || accountType === "credit_card";
  const accountNumberLabel = accountType === "credit_card" ? "Last 4 Digits" : "Account Number";

  const openingBalanceChanged =
    account && initialized && openingBalance !== account.openingBalance;

  const isPending = updateMutation.isPending || upsertGatewayMutation.isPending;

  return (
    <SlideOver
      open
      onClose={onClose}
      title="Edit Account"
      description={account?.accountName}
      footer={
        <div className="flex items-center justify-between">
          <button
            type="button"
            className="btn-ghost text-sm text-red-600 hover:text-red-700 hover:bg-red-600/[0.08] px-3 py-2"
            onClick={() => onDeleteRequest(accountId)}
          >
            Delete Account
          </button>
          <div className="flex gap-3">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={handleSave}
              disabled={isPending || !accountName.trim() || isLoading}
            >
              {isPending ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </div>
      }
    >
      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <div className="skeleton h-3.5 w-24 rounded" />
              <div className="skeleton h-9 w-full rounded-lg" />
            </div>
          ))}
        </div>
      ) : !account ? (
        <div className="py-8 text-center text-sm text-text-tertiary">Account not found</div>
      ) : (
        <div className="space-y-5">
          <div>
            <p className="label">Account Type</p>
            <Listbox
              ariaLabel="Account Type"
              value={accountType}
              onChange={(val) => setAccountType(val)}
              options={ACCOUNT_TYPE_OPTIONS}
              className="w-full"
            />
          </div>

          <InputField
            label="Account Name"
            required
            data-autofocus
            value={accountName}
            onChange={(e) => setAccountName(e.target.value)}
            placeholder="e.g. HDFC Current"
          />

          {!isGateway && showAccountNumber && showIfsc && (
            <div className="grid grid-cols-2 gap-4">
              <InputField
                label={accountNumberLabel}
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
                placeholder="Optional"
              />
              <InputField
                label="IFSC Code"
                value={ifsc}
                onChange={(e) => setIfsc(e.target.value)}
                placeholder="Optional"
              />
            </div>
          )}

          {!isGateway && showAccountNumber && !showIfsc && (
            <InputField
              label={accountNumberLabel}
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value)}
              placeholder="Optional"
            />
          )}

          {!isGateway && showUpiId && (
            <InputField
              label="UPI ID"
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value)}
              placeholder="e.g. business@upi"
            />
          )}

          {!isGateway && showBankName && (
            <InputField
              label="Bank Name"
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              placeholder="e.g. HDFC Bank"
            />
          )}

          {/* Gateway-specific fields */}
          {isGateway && (
            <>
              <div>
                <p className="label">Settlement Bank Account</p>
                {nonGatewayAccounts.length === 0 ? (
                  <p className="text-xs text-amber-600 mt-1">
                    Create a bank account first to use as a settlement account.
                  </p>
                ) : (
                  <Listbox
                    value={settlementAccountId}
                    onChange={setSettlementAccountId}
                    options={nonGatewayAccounts.map((a) => ({
                      value: a.id,
                      label: `${a.accountName} (${a.accountType})`,
                    }))}
                    placeholder="Select settlement account"
                    className="w-full"
                  />
                )}
              </div>

              <div>
                <p className="label mb-2">Charge Rates (%)</p>
                <div className="grid grid-cols-2 gap-3">
                  {GATEWAY_CHARGE_MODES.map((mode) => (
                    <div key={mode.key}>
                      <label className="text-xs text-text-secondary mb-1 block">
                        {mode.label}
                      </label>
                      <div className="relative">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          max="100"
                          value={chargeRates[mode.key] ?? ""}
                          onChange={(e) =>
                            setChargeRates((prev) => ({ ...prev, [mode.key]: e.target.value }))
                          }
                          className="input py-1.5 text-sm pr-7 w-full"
                          placeholder="0"
                        />
                        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-text-tertiary pointer-events-none">
                          %
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <InputField
                label="Expense Category"
                value={expenseCategory}
                onChange={(e) => setExpenseCategory(e.target.value)}
                placeholder="Payment Gateway Charges"
              />

              <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
                <input
                  type="checkbox"
                  role="switch"
                  checked={autoSettle}
                  onChange={(e) => setAutoSettle(e.target.checked)}
                  className="switch"
                />
                Auto-settle to bank
              </label>
            </>
          )}

          <div>
            <InputField
              label="Opening Balance (₹)"
              type="number"
              step="0.01"
              value={openingBalance}
              onChange={(e) => setOpeningBalance(e.target.value)}
              placeholder="0.00"
            />
            {openingBalanceChanged && (
              <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400 flex items-start gap-1.5">
                <Icon icon={Alert02Icon} size={14} className="mt-0.5 shrink-0" />
                Changing the opening balance will affect the calculated running balance for all transactions.
              </p>
            )}
          </div>

          <div className="pt-1 border-t border-border-light">
            <label className="flex items-center gap-3 cursor-pointer py-2">
              <input
                type="checkbox"
                role="switch"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
                className="switch"
              />
              <div>
                <p className="text-sm font-medium text-text-primary">Set as default account</p>
                <p className="text-xs text-text-tertiary mt-0.5">
                  The default account is auto-selected when recording payments
                </p>
              </div>
            </label>
          </div>

          {/* Current balance info */}
          <div className="rounded-xl bg-surface-1 px-4 py-3 flex items-center justify-between">
            <p className="text-xs text-text-tertiary">Current Balance</p>
            <p className="text-sm font-semibold tabular-nums text-text-primary">
              {formatCurrency(account.currentBalance)}
            </p>
          </div>
        </div>
      )}
    </SlideOver>
  );
}

// ─── Add Account Modal ────────────────────────────────────────────────────────

const ACCOUNT_TYPE_OPTIONS = [
  { value: "savings", label: "Savings Account" },
  { value: "current", label: "Current Account" },
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "credit_card", label: "Credit Card" },
  { value: "payment_gateway", label: "Payment Gateway" },
];

// Gateway charge mode labels for the config form
const GATEWAY_CHARGE_MODES = [
  { key: "credit_card", label: "Credit Card" },
  { key: "debit_card", label: "Debit Card" },
  { key: "upi", label: "UPI" },
  { key: "net_banking", label: "Net Banking" },
  { key: "wallet", label: "Wallet" },
  { key: "default", label: "Default" },
] as const;

function AddAccountModal({ onClose }: { onClose: () => void }) {
  const [accountName, setAccountName] = useState("");
  const [accountType, setAccountType] = useState("current");
  const [accountNumber, setAccountNumber] = useState("");
  const [ifsc, setIfsc] = useState("");
  const [bankName, setBankName] = useState("");
  const [openingBalance, setOpeningBalance] = useState("");
  const [isDefault, setIsDefault] = useState(false);

  // Gateway-specific state
  const [settlementAccountId, setSettlementAccountId] = useState("");
  const [chargeRates, setChargeRates] = useState<Record<string, string>>({
    credit_card: "",
    debit_card: "",
    upi: "",
    net_banking: "",
    wallet: "",
    default: "2",
  });
  const [expenseCategory, setExpenseCategory] = useState("Payment Gateway Charges");
  const [autoSettle, setAutoSettle] = useState(true);

  const isGateway = accountType === "payment_gateway";

  const utils = trpc.useUtils();

  // Fetch accounts for settlement dropdown (only for gateway type)
  const { data: allAccounts } = trpc.bankAccount.list.useQuery(undefined, {
    enabled: isGateway,
  });
  const nonGatewayAccounts = allAccounts?.filter(
    (a) => a.accountType !== "payment_gateway"
  ) ?? [];

  const createAccountMutation = trpc.bankAccount.create.useMutation({
    onError: (err) => toast.error(err.message),
  });

  const upsertGatewayMutation = trpc.bankAccount.upsertGatewayConfig.useMutation({
    onError: (err) => toast.error(err.message),
  });

  async function handleCreate() {
    if (!accountName.trim()) return;
    if (isGateway && !settlementAccountId) {
      toast.error("Please select a settlement bank account");
      return;
    }

    try {
      const account = await createAccountMutation.mutateAsync({
        accountName: accountName.trim(),
        accountType: accountType as any,
        accountNumber: isGateway ? undefined : (accountNumber || undefined),
        ifsc: isGateway ? undefined : (ifsc || undefined),
        bankName: isGateway ? undefined : (bankName || undefined),
        openingBalance: openingBalance || "0",
        isDefault,
      });

      if (isGateway) {
        // Build chargeConfig from rates
        const chargeConfig: GatewayChargeConfig = {};
        for (const mode of GATEWAY_CHARGE_MODES) {
          const val = chargeRates[mode.key];
          if (val && parseFloat(val) > 0) {
            chargeConfig[mode.key] = { type: "percentage", value: parseFloat(val).toString() };
          }
        }

        await upsertGatewayMutation.mutateAsync({
          bankAccountId: account.id,
          settlementAccountId,
          chargeConfig,
          expenseCategory: expenseCategory || "Payment Gateway Charges",
          autoSettle,
        });
      }

      toast.success("Account created");
      onClose();
      utils.bankAccount.list.invalidate();
      utils.bankAccount.summary.invalidate();
    } catch {
      // Error toast already shown by mutation onError
    }
  }

  const showAccountNumber = accountType === "savings" || accountType === "current" || accountType === "credit_card";
  const showUpiId = accountType === "upi";
  const showIfsc = accountType === "savings" || accountType === "current";
  const showBankName = accountType === "savings" || accountType === "current" || accountType === "credit_card";

  const accountNamePlaceholder =
    accountType === "cash" ? "e.g. Cash in Hand" :
    accountType === "upi" ? "e.g. PhonePe" :
    accountType === "credit_card" ? "e.g. HDFC Credit Card" :
    accountType === "payment_gateway" ? "e.g. Razorpay" :
    "e.g. HDFC Current";

  const accountNumberLabel = accountType === "credit_card" ? "Last 4 Digits" : "Account Number";
  const accountNumberPlaceholder = accountType === "credit_card" ? "1234" : "Optional";

  const isPending = createAccountMutation.isPending || upsertGatewayMutation.isPending;

  return (
    <SlideOver
      open
      onClose={onClose}
      title="Add Bank Account"
      footer={
        <div className="flex justify-end gap-3">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleCreate}
            disabled={isPending || !accountName.trim()}
          >
            {isPending ? "Creating…" : "Create Account"}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <p className="label">Account Type</p>
          <Listbox
            ariaLabel="Account Type"
            value={accountType}
            onChange={(val) => setAccountType(val)}
            options={ACCOUNT_TYPE_OPTIONS}
            className="w-full"
          />
        </div>
        <InputField
          label="Account Name"
          required
          autoFocus
          value={accountName}
          onChange={(e) => setAccountName(e.target.value)}
          placeholder={accountNamePlaceholder}
        />
        {!isGateway && showAccountNumber && showIfsc && (
          <div className="grid grid-cols-2 gap-4">
            <InputField
              label={accountNumberLabel}
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value)}
              placeholder={accountNumberPlaceholder}
            />
            <InputField
              label="IFSC Code"
              value={ifsc}
              onChange={(e) => setIfsc(e.target.value)}
              placeholder="Optional"
            />
          </div>
        )}
        {!isGateway && showAccountNumber && !showIfsc && (
          <InputField
            label={accountNumberLabel}
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
            placeholder={accountNumberPlaceholder}
          />
        )}
        {!isGateway && showUpiId && (
          <InputField
            label="UPI ID"
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
            placeholder="e.g. business@upi"
          />
        )}
        {!isGateway && showBankName && (
          <InputField
            label="Bank Name"
            value={bankName}
            onChange={(e) => setBankName(e.target.value)}
            placeholder="e.g. HDFC Bank"
          />
        )}

        {/* Gateway-specific fields */}
        {isGateway && (
          <>
            <div>
              <p className="label">Settlement Bank Account</p>
              {nonGatewayAccounts.length === 0 ? (
                <p className="text-xs text-amber-600 mt-1">
                  Create a bank account first to use as a settlement account.
                </p>
              ) : (
                <Listbox
                  value={settlementAccountId}
                  onChange={setSettlementAccountId}
                  options={nonGatewayAccounts.map((a) => ({
                    value: a.id,
                    label: `${a.accountName} (${a.accountType})`,
                  }))}
                  placeholder="Select settlement account"
                  className="w-full"
                />
              )}
            </div>

            <div>
              <p className="label mb-2">Charge Rates (%)</p>
              <div className="grid grid-cols-2 gap-3">
                {GATEWAY_CHARGE_MODES.map((mode) => (
                  <div key={mode.key}>
                    <label className="text-xs text-text-secondary mb-1 block">
                      {mode.label}
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        value={chargeRates[mode.key] ?? ""}
                        onChange={(e) =>
                          setChargeRates((prev) => ({ ...prev, [mode.key]: e.target.value }))
                        }
                        className="input py-1.5 text-sm pr-7 w-full"
                        placeholder="0"
                      />
                      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-text-tertiary pointer-events-none">
                        %
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <InputField
              label="Expense Category"
              value={expenseCategory}
              onChange={(e) => setExpenseCategory(e.target.value)}
              placeholder="Payment Gateway Charges"
            />

            <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
              <input
                type="checkbox"
                role="switch"
                checked={autoSettle}
                onChange={(e) => setAutoSettle(e.target.checked)}
                className="switch"
              />
              Auto-settle to bank
            </label>
          </>
        )}

        <InputField
          label="Opening Balance (₹)"
          type="number"
          step="0.01"
          min="0"
          value={openingBalance}
          onChange={(e) => setOpeningBalance(e.target.value)}
          placeholder="0.00"
        />
        <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
          <input
            type="checkbox"
            role="switch"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
            className="switch"
          />
          Set as default account
        </label>
      </div>
    </SlideOver>
  );
}

// ─── Add Transaction Modal ────────────────────────────────────────────────────

function AddTransactionModal({
  bankAccountId,
  onClose,
}: {
  bankAccountId: string;
  onClose: () => void;
}) {
  const [txnType, setTxnType] = useState("deposit");
  const [txnAmount, setTxnAmount] = useState("");
  const [txnDescription, setTxnDescription] = useState("");
  const [txnDate, setTxnDate] = useState(todayISODate);

  const utils = trpc.useUtils();

  const addTxnMutation = trpc.bankAccount.addTransaction.useMutation({
    onSuccess: () => {
      toast.success("Transaction recorded");
      onClose();
      utils.bankAccount.listTransactions.invalidate();
      utils.bankAccount.list.invalidate();
      utils.bankAccount.summary.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  function handleAdd() {
    if (!txnAmount) return;
    addTxnMutation.mutate({
      bankAccountId,
      type: txnType as "deposit" | "withdrawal",
      amount: txnAmount,
      description: txnDescription || undefined,
      transactionDate: toISOString(txnDate),
    });
  }

  return (
    <SlideOver
      open
      onClose={onClose}
      title="Add Transaction"
      footer={
        <div className="flex justify-end gap-3">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleAdd}
            disabled={addTxnMutation.isPending || !txnAmount}
          >
            {addTxnMutation.isPending ? "Adding…" : "Add Transaction"}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <p className="label">Transaction Type</p>
          <SegmentedControl
            tabs={[
              { value: "deposit", label: "Deposit" },
              { value: "withdrawal", label: "Withdrawal" },
            ]}
            value={txnType}
            onChange={setTxnType}
          />
        </div>
        <InputField
          label="Amount (₹)"
          type="number"
          step="0.01"
          min="0.01"
          required
          value={txnAmount}
          onChange={(e) => setTxnAmount(e.target.value)}
          placeholder="0.00"
        />
        <InputField
          label="Description"
          value={txnDescription}
          onChange={(e) => setTxnDescription(e.target.value)}
          placeholder="Optional note"
        />
        <InputField
          label="Date"
          type="date"
          value={txnDate}
          onChange={(e) => setTxnDate(e.target.value)}
        />
      </div>
    </SlideOver>
  );
}

// ─── Transfer Modal ───────────────────────────────────────────────────────────

interface BankAccountItem {
  id: string;
  accountName: string;
  currentBalance: string;
}

function TransferModal({
  accounts,
  defaultFromId,
  onClose,
}: {
  accounts: BankAccountItem[];
  defaultFromId: string | null;
  onClose: () => void;
}) {
  const [transferFrom, setTransferFrom] = useState(defaultFromId ?? "");
  const [transferTo, setTransferTo] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [transferDescription, setTransferDescription] = useState("");

  const utils = trpc.useUtils();

  const transferMutation = trpc.bankAccount.transfer.useMutation({
    onSuccess: () => {
      toast.success("Transfer completed");
      onClose();
      utils.bankAccount.list.invalidate();
      utils.bankAccount.listTransactions.invalidate();
      utils.bankAccount.summary.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  function handleTransfer() {
    if (!transferFrom || !transferTo || !transferAmount) return;
    transferMutation.mutate({
      fromAccountId: transferFrom,
      toAccountId: transferTo,
      amount: transferAmount,
      description: transferDescription || undefined,
    });
  }

  return (
    <SlideOver
      open
      onClose={onClose}
      title="Transfer Money"
      footer={
        <div className="flex justify-end gap-3">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleTransfer}
            disabled={
              transferMutation.isPending ||
              !transferFrom ||
              !transferTo ||
              !transferAmount
            }
          >
            {transferMutation.isPending ? "Transferring…" : "Transfer"}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <SelectField
          label="From Account"
          required
          value={transferFrom}
          onChange={(e) => setTransferFrom(e.target.value)}
        >
          <option value="">Select account</option>
          {accounts.map((acc) => (
            <option key={acc.id} value={acc.id}>
              {acc.accountName} ({formatCurrency(acc.currentBalance)})
            </option>
          ))}
        </SelectField>
        <SelectField
          label="To Account"
          required
          value={transferTo}
          onChange={(e) => setTransferTo(e.target.value)}
        >
          <option value="">Select account</option>
          {accounts
            .filter((a) => a.id !== transferFrom)
            .map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.accountName} ({formatCurrency(acc.currentBalance)})
              </option>
            ))}
        </SelectField>
        <InputField
          label="Amount (₹)"
          type="number"
          step="0.01"
          min="0.01"
          required
          value={transferAmount}
          onChange={(e) => setTransferAmount(e.target.value)}
          placeholder="0.00"
        />
        <InputField
          label="Description"
          value={transferDescription}
          onChange={(e) => setTransferDescription(e.target.value)}
          placeholder="e.g. Fund transfer"
        />
      </div>
    </SlideOver>
  );
}

// ─── Skeleton loaders ─────────────────────────────────────────────────────────

function AccountListSkeleton() {
  return (
    <div className="p-4 space-y-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-center justify-between">
          <div className="space-y-1.5 flex-1">
            <div className="skeleton h-3.5 w-32 rounded" />
            <div className="skeleton h-3 w-20 rounded" />
          </div>
          <div className="skeleton h-4 w-20 rounded" />
        </div>
      ))}
    </div>
  );
}

