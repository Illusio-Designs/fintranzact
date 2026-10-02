import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import { z } from "zod";
import { usePageSearch } from "@/lib/page-search";
import { trpc, getBusinessId } from "@/lib/trpc";
import { cn, formatCurrency, formatDate, downloadCSV } from "@/lib/utils";
import { toast } from "@/hooks/useToast";
import { useHotkeys } from "@/hooks/useHotkeys";
import { useDebounce } from "@/hooks/useDebounce";
import { useDateRange } from "@/hooks/useDateRange";
import { usePageSize } from "@/hooks/usePageSize";
import { useDeleteConfirmation } from "@/hooks/useDeleteConfirmation";
import { PageHeader } from "@/components/ui/PageHeader";
import { SlideOver } from "@/components/ui/SlideOver";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { DeleteConfirmDialog } from "@/components/ui/DeleteConfirmDialog";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { DetailField } from "@/components/ui/DetailField";
import { KbdShortcut } from "@/components/ui/KbdShortcut";
import { DateRangeBar } from "@/components/ui/DateRangeBar";
import { RecordPaymentPanel } from "@/components/RecordPaymentPanel";
import { Icon } from "@/components/ui/Icon";
import { Pagination } from "@/components/ui/Pagination";
import { RowActions, tidyMenu } from "@/components/ui/Menu";
import { SortableTh, SortMenu, TableScroll, type SortOption, type SortState } from "@/components/ui/Table";
import { Cancel01Icon, StarIcon } from "@hugeicons/core-free-icons";
import { paymentModeLabel } from "@/lib/payment-modes";

const paymentsSearchSchema = z.object({
  id: z.string().uuid().optional(),
});

export const Route = createFileRoute("/payments")({
  validateSearch: (search) => paymentsSearchSchema.parse(search),
  component: PaymentsPage,
});

// ── Smart auto-assignment banner ──────────────────────────────────────────────

const SECONDS_PER_MANUAL_ASSIGN = 75;

function getAutoAssignKey(businessId: string) {
  return `fintranzact_autoassign_shown_${businessId}`;
}

function formatTimeSaved(assignedCount: number): string {
  const totalSeconds = assignedCount * SECONDS_PER_MANUAL_ASSIGN;
  const minutes = Math.round(totalSeconds / 60);
  if (minutes < 60) return `~${minutes} minute${minutes !== 1 ? "s" : ""}`;
  const hours = Math.round(minutes / 60);
  return `~${hours} hour${hours !== 1 ? "s" : ""}`;
}

// Maximum payment amount auto-assigned without confirmation (safety guardrail)
const AUTO_ASSIGN_AMOUNT_LIMIT = "50000.00";

type AssignmentMap = {
  mode: "cash" | "upi" | "bank";
  bankAccountId: string;
  accountName: string;
  paymentIds: string[];
};

function SmartAssignBanner({ onAssigned }: { onAssigned: () => void }) {
  const businessId = getBusinessId() ?? "";
  const bannerKey = getAutoAssignKey(businessId);

  // One-time check: has this banner already been shown for this business?
  const alreadyShown = businessId ? !!localStorage.getItem(bannerKey) : true;

  const [bannerState, setBannerState] = useState<
    | { status: "idle" }
    | { status: "assigning" }
    | { status: "done"; assignedCount: number }
    | { status: "dismissed" }
  >({ status: "idle" });

  // Prevent the effect from firing more than once per mount
  const didRunRef = useRef(false);

  const { data: untrackedData, isSuccess: untrackedReady } =
    trpc.payment.untrackedPayments.useQuery(
      { page: 1, limit: 100 },
      { enabled: !alreadyShown && bannerState.status === "idle" }
    );

  const { data: accounts, isSuccess: accountsReady } =
    trpc.bankAccount.list.useQuery(undefined, {
      enabled: !alreadyShown && bannerState.status === "idle",
    });

  const utils = trpc.useUtils();

  const assignMutation = trpc.payment.assignAccount.useMutation({
    onError: (err) => toast.error(err.message),
  });

  useEffect(() => {
    if (alreadyShown) return;
    if (!untrackedReady || !accountsReady) return;
    if (didRunRef.current) return;
    if (bannerState.status !== "idle") return;

    const payments = untrackedData?.data ?? [];
    const totalUntracked = untrackedData?.total ?? 0;
    if (totalUntracked === 0 || payments.length === 0) return;

    // Build mode-to-account mapping — only for unambiguous (single-account) cases
    const cashAccounts = (accounts ?? []).filter((a) => a.accountType === "cash");
    const upiAccounts = (accounts ?? []).filter((a) => a.accountType === "upi");
    const bankAccounts = (accounts ?? []).filter(
      (a) => a.accountType === "savings" || a.accountType === "current"
    );

    const modeAccountMap: Partial<Record<"cash" | "upi" | "bank", string>> = {};
    if (cashAccounts.length === 1) modeAccountMap.cash = cashAccounts[0].id;
    if (upiAccounts.length === 1) modeAccountMap.upi = upiAccounts[0].id;
    if (bankAccounts.length === 1) modeAccountMap.bank = bankAccounts[0].id;

    if (Object.keys(modeAccountMap).length === 0) return;

    // Group payments by mode, filter to mappable + within amount guardrail
    const groups: AssignmentMap[] = [];
    for (const [mode, accountId] of Object.entries(modeAccountMap) as [
      "cash" | "upi" | "bank",
      string
    ][]) {
      const matchingPayments = payments.filter(
        (p) =>
          p.mode === mode &&
          parseFloat(p.amount) <= parseFloat(AUTO_ASSIGN_AMOUNT_LIMIT)
      );
      if (matchingPayments.length === 0) continue;

      const accountName =
        (accounts ?? []).find((a) => a.id === accountId)?.accountName ?? accountId;

      groups.push({
        mode,
        bankAccountId: accountId,
        accountName,
        paymentIds: matchingPayments.map((p) => p.id),
      });
    }

    if (groups.length === 0) return;

    didRunRef.current = true;

    // Run all assignments in parallel
    setBannerState({ status: "assigning" });

    Promise.all(
      groups.map((g) =>
        assignMutation.mutateAsync({
          paymentIds: g.paymentIds,
          bankAccountId: g.bankAccountId,
        })
      )
    )
      .then((results) => {
        const totalAssigned = results.reduce((sum, r) => sum + r.assigned, 0);
        if (totalAssigned > 0) {
          utils.payment.list.invalidate();
          utils.payment.untrackedPayments.invalidate();
          utils.bankAccount.list.invalidate();
          utils.bankAccount.summary.invalidate();
          setBannerState({ status: "done", assignedCount: totalAssigned });
          onAssigned();
        } else {
          setBannerState({ status: "dismissed" });
        }
      })
      .catch(() => {
        setBannerState({ status: "dismissed" });
      });
  }, [alreadyShown, untrackedReady, accountsReady, untrackedData, accounts]);

  function dismiss() {
    if (businessId) localStorage.setItem(bannerKey, "1");
    setBannerState({ status: "dismissed" });
  }

  if (alreadyShown) return null;
  if (bannerState.status === "idle" || bannerState.status === "assigning") return null;
  if (bannerState.status === "dismissed") return null;
  if (bannerState.status !== "done") return null;

  const { assignedCount } = bannerState;
  const timeSaved = formatTimeSaved(assignedCount);

  return (
    <div className="mb-4 animate-milestone-enter" role="status" aria-live="polite">
      <div className="px-4 py-3.5 rounded-xl border border-brand-200 bg-brand-50 dark:bg-brand-950/20 dark:border-brand-800/50">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            {/* Star icon */}
            <Icon icon={StarIcon} size={16} className="text-brand-600 dark:text-brand-400 mt-0.5" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-brand-700 dark:text-brand-300 mb-0.5">
                Smart Assignment
              </p>
              <p className="text-sm text-brand-600 dark:text-brand-400 leading-snug">
                We auto-assigned{" "}
                <span className="font-semibold">{assignedCount}</span>{" "}
                {assignedCount === 1 ? "payment" : "payments"} to{" "}
                {assignedCount === 1 ? "its" : "their"} matching bank{" "}
                {assignedCount === 1 ? "account" : "accounts"} based on payment
                mode. That&apos;s{" "}
                <span className="font-semibold">{timeSaved}</span> of manual
                work saved.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={dismiss}
            className="shrink-0 p-1 rounded-lg text-brand-500 hover:text-brand-700 hover:bg-brand-100 dark:hover:bg-brand-900/40 transition-colors"
            aria-label="Dismiss smart assignment notification"
          >
            <Icon icon={Cancel01Icon} size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

type PaymentSortKey = "date" | "amount" | "party";

const SORT_OPTIONS: SortOption<PaymentSortKey>[] = [
  { key: "date", dir: "desc", label: "Newest first" },
  { key: "date", dir: "asc", label: "Oldest first" },
  { key: "amount", dir: "desc", label: "Amount: high to low" },
  { key: "amount", dir: "asc", label: "Amount: low to high" },
  { key: "party", dir: "asc", label: "Party: A to Z" },
];

function PaymentsPage() {
  const [showPanel, setShowPanel] = useState(false);
  const [editPaymentId, setEditPaymentId] = useState<string | null>(null);
  const [selectedPaymentId, setSelectedPaymentId] = useState<string | null>(null);
  const deleteConfirm = useDeleteConfirmation();
  const [sort, setSort] = useState<SortState<PaymentSortKey>>({ key: "date", dir: "desc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize("payments", 25);
  const tableRef = useRef<HTMLDivElement>(null);
  const [search] = usePageSearch("Search by party or payment #…");
  const [exporting, setExporting] = useState(false);
  const dateRange = useDateRange("payments", "this-month");

  // Open the payment detail panel when navigated here with ?id=<paymentId>
  const { id: idFromSearch } = useSearch({ from: "/payments" });
  useEffect(() => {
    if (idFromSearch) {
      setSelectedPaymentId(idFromSearch);
    }
  }, [idFromSearch]);

  const debouncedSearch = useDebounce(search, 300);

  // Back to page 1 whenever filters, sort or rows per page change
  useEffect(() => { setPage(1); }, [debouncedSearch, dateRange.fromDate, dateRange.toDate, sort.key, sort.dir, pageSize]);
  // A new page starts at its first row.
  useEffect(() => { tableRef.current?.scrollTo({ top: 0 }); }, [page]);

  const { data, isFetching, isLoading } = trpc.payment.list.useQuery({
    page,
    limit: pageSize,
    search: debouncedSearch || undefined,
    fromDate: dateRange.fromDate,
    toDate: dateRange.toDate,
    sortBy: sort.key,
    sortDir: sort.dir,
  }, {
    // Keep the current page on screen while the next one loads.
    placeholderData: (prev) => prev,
  });

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  // Deleting the last row of the last page: step back a page.
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  const utils = trpc.useUtils();

  const deleteMutation = trpc.payment.delete.useMutation({
    onSuccess: () => {
      utils.payment.list.invalidate();
      utils.dashboard.summary.invalidate();
      deleteConfirm.cancelDelete();
      toast.success("Payment deleted");
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  // Keyboard shortcut: N to open panel
  useHotkeys([
    {
      key: "n",
      handler: () => setShowPanel(true),
      description: "Record new payment",
      scope: "payments",
    },
  ]);

  async function exportPaymentsCSV() {
    setExporting(true);
    try {
      let allData: any[] = [];
      let pg = 1;
      let hasMore = true;
      while (hasMore) {
        const result = await utils.payment.list.fetch({
          page: pg,
          limit: 100,
          search: debouncedSearch || undefined,
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

      const headers = ["Payment #", "Date", "Party", "Mode", "Reference", "Amount"];
      const rows = allData.map((p: any) => [
        p.paymentNumber || "",
        formatDate(p.paymentDate),
        p.partyName,
        p.mode,
        p.referenceNumber || "",
        p.amount,
      ]);

      downloadCSV(`payments_${dateRange.preset}`, headers, rows);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Payments"
        description="Track money in and out"
        actions={
          <button
            className="btn-primary"
            onClick={() => setShowPanel(true)}
          >
            + Record Payment
            <KbdShortcut keys={["N"]} className="ml-2 opacity-70" />
          </button>
        }
      />

      {/* Smart auto-assign banner — one-time per business, shown only when assignments fire */}
      <SmartAssignBanner onAssigned={() => utils.payment.list.invalidate()} />

      <div className="rounded-2xl border border-border-light bg-surface-0 overflow-clip">
        {/* Filters */}
        <div className="border-b border-border-light px-4 py-2">
          <DateRangeBar
            preset={dateRange.preset}
            onPresetChange={dateRange.setPreset}
            customFrom={dateRange.customFrom}
            customTo={dateRange.customTo}
            onCustomChange={dateRange.setCustomRange}
            onExport={exportPaymentsCSV}
            exporting={exporting}
          />
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="p-4">
            <SkeletonRows count={5} height="h-12" />
          </div>
        ) : !rows.length && !isFetching ? (
          <EmptyState
            title="No payments recorded yet"
            description="Record your first payment to start tracking cash flow."
            encouragement="Once you start invoicing, payments will show here."
            action={
              <button className="btn-primary" onClick={() => setShowPanel(true)}>
                + Record Payment
              </button>
            }
          />
        ) : (
          <div className={cn("transition-opacity", isFetching && "opacity-60")}>
            <Pagination
              placement="top"
              page={page}
              totalPages={totalPages}
              onPageChange={setPage}
              total={total}
              pageSize={pageSize}
            >
              <SortMenu options={SORT_OPTIONS} sort={sort} onSort={setSort} />
            </Pagination>
            <TableScroll ref={tableRef}>
              <table className="data-table w-full">
                <thead>
                  <tr>
                    <th>Payment #</th>
                    <SortableTh sortKey="party" sort={sort} onSort={setSort}>Party</SortableTh>
                    <SortableTh sortKey="date" sort={sort} onSort={setSort} firstDir="desc">Date</SortableTh>
                    <th>Mode</th>
                    <th>Reference</th>
                    <SortableTh sortKey="amount" sort={sort} onSort={setSort} firstDir="desc" align="right">Amount</SortableTh>
                    <th className="text-right"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id} className="cursor-pointer" onClick={() => setSelectedPaymentId(p.id)}>
                      <td className="font-mono text-ui text-text-secondary">
                        {p.paymentNumber || "—"}
                      </td>
                      <td className="font-medium">{p.partyName}</td>
                      <td className="text-text-secondary">{formatDate(p.paymentDate)}</td>
                      <td className="text-text-secondary">
                        {paymentModeLabel(p.mode)}
                      </td>
                      <td className="text-text-secondary text-xs">
                        {p.referenceNumber || "—"}
                      </td>
                      <td className="text-right tabular-nums font-semibold text-emerald-600">
                        {formatCurrency(p.amount)}
                      </td>
                      <td className="text-right" onClick={(e) => e.stopPropagation()}>
                        <RowActions
                          label={p.paymentNumber || p.partyName}
                          items={tidyMenu([
                            { label: "Open", hint: "Enter", onSelect: () => setSelectedPaymentId(p.id) },
                            { label: "Edit payment", onSelect: () => setEditPaymentId(p.id) },
                            { kind: "separator" },
                            {
                              label: "Delete payment",
                              danger: true,
                              onSelect: () => deleteConfirm.requestDelete(p.id, p.paymentNumber || p.partyName),
                            },
                          ])}
                        />
                      </td>
                    </tr>
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
          </div>
        )}
      </div>

      {/* Record Payment SlideOver (create) */}
      <RecordPaymentPanel
        open={showPanel}
        onClose={() => setShowPanel(false)}
      />

      {/* Edit Payment SlideOver */}
      <RecordPaymentPanel
        open={editPaymentId !== null}
        onClose={() => setEditPaymentId(null)}
        editPaymentId={editPaymentId ?? undefined}
      />

      {/* Payment Detail */}
      {selectedPaymentId && (
        <PaymentDetailPanel
          paymentId={selectedPaymentId}
          onClose={() => setSelectedPaymentId(null)}
          onEdit={(id) => {
            setSelectedPaymentId(null);
            setEditPaymentId(id);
          }}
        />
      )}

      {/* Delete Confirmation */}
      <DeleteConfirmDialog
        target={deleteConfirm.deleteTarget}
        entityName="Payment"
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteConfirm.deleteTarget) deleteMutation.mutate({ id: deleteConfirm.deleteTarget.id });
        }}
        onCancel={deleteConfirm.cancelDelete}
      />
    </div>
  );
}

// ── Payment Detail Panel ──────────────────────────────────────────

function PaymentDetailPanel({
  paymentId,
  onClose,
  onEdit,
}: {
  paymentId: string;
  onClose: () => void;
  onEdit: (id: string) => void;
}) {
  const navigate = useNavigate();
  const { data: payment, isLoading } = trpc.payment.getById.useQuery(
    { id: paymentId },
  );

  return (
    <SlideOver
      open={true}
      onClose={onClose}
      title={isLoading ? "Loading…" : payment ? `Payment ${payment.paymentNumber || ""}` : "Payment"}
      description={payment ? `${payment.partyName} — ${formatDate(payment.paymentDate)}` : undefined}
      footer={
        payment ? (
          <div className="flex justify-end gap-2">
            <button
              onClick={() => onEdit(payment.id)}
              className="text-xs px-3 py-1.5 rounded-lg font-medium text-text-secondary hover:bg-surface-2 border border-border-light transition-colors"
            >
              Edit Payment
            </button>
          </div>
        ) : null
      }
    >
      {isLoading ? (
        <SkeletonRows count={4} height="h-8" className="space-y-3 animate-pulse" />
      ) : !payment ? (
        <p className="text-text-tertiary text-sm">Payment not found.</p>
      ) : (
        <div className="space-y-5">
          {/* Payment details */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-3">
              <DetailField label="Party">
                <p className="font-semibold text-text-primary">{payment.partyName}</p>
              </DetailField>
              <DetailField label="Amount">
                <p className="text-lg font-bold tabular-nums text-emerald-600">{formatCurrency(payment.amount)}</p>
              </DetailField>
              {payment.discount && parseFloat(payment.discount) > 0 && (
                <DetailField label="Discount">
                  <p className="tabular-nums">{formatCurrency(payment.discount)}</p>
                </DetailField>
              )}
            </div>
            <div className="space-y-3">
              <DetailField label="Date">
                <p>{formatDate(payment.paymentDate)}</p>
              </DetailField>
              <DetailField label="Mode">
                <p className="capitalize">{payment.mode}</p>
              </DetailField>
              {payment.referenceNumber && (
                <DetailField label="Reference">
                  <p className="font-mono text-text-secondary">{payment.referenceNumber}</p>
                </DetailField>
              )}
            </div>
          </div>

          {payment.notes && (
            <DetailField label="Notes">
              <p className="text-xs text-text-secondary whitespace-pre-wrap">{payment.notes}</p>
            </DetailField>
          )}

          {/* Linked invoices */}
          {payment.linkedInvoices.length > 0 && (
            <div>
              <p className="text-2xs font-medium text-text-tertiary uppercase tracking-wide mb-2">
                Applied to Invoice{payment.linkedInvoices.length > 1 ? "s" : ""}
              </p>
              <div className="card overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-surface-1 border-b border-border-light">
                      <th className="px-3 py-2 text-left font-medium text-text-tertiary">Invoice</th>
                      <th className="px-3 py-2 text-left font-medium text-text-tertiary">Date</th>
                      <th className="px-3 py-2 text-left font-medium text-text-tertiary">Status</th>
                      <th className="px-3 py-2 text-right font-medium text-text-tertiary">Invoice Total</th>
                      <th className="px-3 py-2 text-right font-medium text-text-tertiary">This Payment</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-light">
                    {payment.linkedInvoices.map((inv) => (
                      <tr
                        key={inv.invoiceId}
                        className="cursor-pointer hover:bg-surface-1 transition-colors"
                        onClick={() => {
                          onClose();
                          navigate({ to: "/invoices", search: { id: inv.invoiceId } });
                        }}
                      >
                        <td className="px-3 py-2.5">
                          <span className="font-mono text-xs font-medium text-brand-600 hover:underline">
                            {inv.invoiceNumber}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-text-secondary">
                          {formatDate(inv.invoiceDate)}
                        </td>
                        <td className="px-3 py-2.5">
                          <StatusBadge status={inv.status} size="sm" />
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-text-primary">
                          {formatCurrency(inv.totalAmount)}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-emerald-600">
                          {formatCurrency(inv.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {payment.linkedInvoices.length === 0 && (
            <div className="text-center py-4">
              <p className="text-xs text-text-tertiary">This payment is not linked to any invoice</p>
            </div>
          )}
        </div>
      )}
    </SlideOver>
  );
}
