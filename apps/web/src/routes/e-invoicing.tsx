import { DetailSkeleton } from "@/components/ui/Skeleton";
import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import { usePageSearch } from "@/lib/page-search";
import { trpc } from "@/lib/trpc";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { badgeColor, badgeColorFallback } from "@/lib/badge-colors";
import { Badge } from "@/components/ui/Badge";
import { toast } from "@/hooks/useToast";
import { PageHeader } from "@/components/ui/PageHeader";
import { PillTabs } from "@/components/ui/Tabs";
import { EmptyState } from "@/components/ui/EmptyState";
import { InputField } from "@/components/ui/FormField";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { Select } from "@/components/ui/Select";
import { ListCard } from "@/components/ui/ListCard";
import { RowActions, tidyMenu } from "@/components/ui/Menu";
import { usePageSize } from "@/hooks/usePageSize";

import { Alert02Icon, CancelCircleIcon, CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import { Icon } from "@/components/ui/Icon";
export const Route = createFileRoute("/e-invoicing")({
  component: EInvoicingPage,
});

// ── Types ─────────────────────────────────────────────────────

type EInvoiceTab = "dashboard" | "settings";

const CANCEL_REASONS = [
  { value: "1", label: "Duplicate" },
  { value: "2", label: "Data entry mistake" },
  { value: "3", label: "Order cancelled" },
  { value: "4", label: "Others" },
] as const;

type CancelReason = (typeof CANCEL_REASONS)[number]["value"];

// ── Helpers ───────────────────────────────────────────────────

function statusColor(status: string | null | undefined): string {
  switch (status) {
    case "generated":
      return badgeColor("emerald");
    case "pending":
      return badgeColor("amber");
    case "failed":
      return badgeColor("red");
    case "cancelled":
      return "bg-surface-2 text-text-tertiary";
    default:
      return badgeColorFallback;
  }
}

function statusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

// ── Dashboard tab ─────────────────────────────────────────────

function DashboardTab() {
  const [tab, setTab] = useState("");
  const [search] = usePageSearch("Search invoice # or party…");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize("e-invoices", 25);
  const tableRef = useRef<HTMLDivElement>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState<CancelReason>("1");
  const [cancelRemarks, setCancelRemarks] = useState("");

  // Back to page 1 whenever the status tab, search or rows per page change.
  useEffect(() => {
    setPage(1);
  }, [tab, search, pageSize]);
  // A new page starts at its first row.
  useEffect(() => { tableRef.current?.scrollTo({ top: 0 }); }, [page]);

  const { data, isLoading, isFetching } = trpc.eInvoice.dashboard.useQuery({
    status: (tab as "pending" | "generated" | "failed" | "cancelled") || undefined,
    search: search || undefined,
    page,
    limit: pageSize,
  }, {
    // Keep the current page on screen while the next one loads.
    placeholderData: (prev) => prev,
  });

  const utils = trpc.useUtils();

  const generateMutation = trpc.eInvoice.generate.useMutation({
    onSuccess: () => {
      toast.success("IRN generated successfully");
      utils.eInvoice.dashboard.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const cancelMutation = trpc.eInvoice.cancel.useMutation({
    onSuccess: () => {
      toast.success("IRN cancelled");
      setCancelId(null);
      utils.eInvoice.dashboard.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const bulkRetryMutation = trpc.eInvoice.bulkRetry.useMutation({
    onSuccess: (result) => {
      toast.success(`Retry complete: ${result.succeeded} succeeded, ${result.failed} failed`);
      utils.eInvoice.dashboard.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const counts = data?.counts ?? { generated: 0, pending: 0, failed: 0, cancelled: 0 };
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  // The last row of the last page left (e.g. a filter shrank the list): step back a page.
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  const statusTabs = [
    { value: "", label: "All", count: Object.values(counts).reduce((a, b) => a + b, 0) },
    { value: "generated", label: "Generated", count: counts.generated },
    { value: "pending", label: "Pending", count: counts.pending },
    { value: "failed", label: "Failed", count: counts.failed },
    { value: "cancelled", label: "Cancelled", count: counts.cancelled },
  ];

  const hasFailed = (counts.failed + counts.pending) > 0;

  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Generated", value: counts.generated, color: "text-emerald-600 dark:text-emerald-400" },
          { label: "Pending", value: counts.pending, color: "text-amber-600 dark:text-amber-400" },
          { label: "Failed", value: counts.failed, color: "text-red-600 dark:text-red-400" },
          { label: "Cancelled", value: counts.cancelled, color: "text-text-secondary" },
        ].map((card) => (
          <div key={card.label} className="card p-4">
            <div className={cn("text-2xl font-bold tabular-nums", card.color)}>{card.value}</div>
            <div className="text-xs text-text-tertiary mt-0.5">{card.label}</div>
          </div>
        ))}
      </div>

      {/* Status tabs + bulk retry + table */}
      <ListCard
        tabs={{ tabs: statusTabs, value: tab, onChange: setTab, label: "E-invoice status" }}
        actions={
          hasFailed ? (
            <button
              onClick={() => bulkRetryMutation.mutate()}
              disabled={bulkRetryMutation.isPending}
              className="btn-secondary text-sm flex items-center gap-1.5"
            >
              {bulkRetryMutation.isPending && <Spinner size="sm" />}
              Retry All Failed
            </button>
          ) : undefined
        }
        loading={isLoading}
        fetching={isFetching}
        tableRef={tableRef}
        pagination={{ page, totalPages, onPageChange: setPage, total, pageSize, onPageSizeChange: setPageSize }}
        empty={
          !data?.data.length ? (
            <EmptyState
              title="No e-invoices"
              description={
                tab || search
                  ? "No invoices match your filters"
                  : "E-invoice status will appear here once invoices are submitted to IRP"
              }
            />
          ) : undefined
        }
      >
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Invoice #</th>
                    <th>Date</th>
                    <th>Party</th>
                    <th className="text-right">Amount</th>
                    <th>IRN</th>
                    <th>Ack Date</th>
                    <th>Status</th>
                    <th className="text-right"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {data?.data.map((inv) => (
                    <tr key={inv.id}>
                      <td className="font-mono text-xs text-text-primary">{inv.invoiceNumber}</td>
                      <td className="text-text-secondary whitespace-nowrap">{formatDate(inv.invoiceDate)}</td>
                      <td className="text-text-primary max-w-[180px] truncate">{inv.partyName}</td>
                      <td className="text-right tabular-nums font-semibold">{formatCurrency(inv.totalAmount)}</td>
                      <td className="font-mono text-2xs text-text-tertiary max-w-[140px] truncate">
                        {inv.irn ?? "—"}
                      </td>
                      <td className="text-text-secondary whitespace-nowrap text-xs">
                        {inv.irnAckDate ? formatDate(inv.irnAckDate) : "—"}
                      </td>
                      <td>
                        <Badge size="sm" color={statusColor(inv.eInvoiceStatus)} className="uppercase">
                          {statusLabel(inv.eInvoiceStatus)}
                        </Badge>
                        {inv.eInvoiceError && (
                          <span className="ml-1.5 inline-flex align-middle text-red-500" title={inv.eInvoiceError} aria-label={inv.eInvoiceError}>
                            <Icon icon={Alert02Icon} size={12} />
                          </span>
                        )}
                      </td>
                      <td className="text-right" onClick={(e) => e.stopPropagation()}>
                        {/* Generate/Retry live in the menu too: IRNs are normally made
                            automatically when an invoice is saved, and "Retry All Failed"
                            above covers the bulk case, so a per-row button isn't the main task here. */}
                        <RowActions
                          label={inv.invoiceNumber}
                          items={tidyMenu([
                            (inv.eInvoiceStatus === "failed" || inv.eInvoiceStatus === "pending") && {
                              label: "Retry IRN",
                              disabled: generateMutation.isPending,
                              onSelect: () => generateMutation.mutate({ invoiceId: inv.id }),
                            },
                            inv.eInvoiceStatus === null && {
                              label: "Generate IRN",
                              disabled: generateMutation.isPending,
                              onSelect: () => generateMutation.mutate({ invoiceId: inv.id }),
                            },
                            { kind: "separator" },
                            inv.eInvoiceStatus === "generated" && !!inv.irn && {
                              label: "Cancel IRN",
                              danger: true,
                              onSelect: () => {
                                setCancelId(inv.id);
                                setCancelReason("1");
                                setCancelRemarks("");
                              },
                            },
                          ])}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
      </ListCard>

      {/* Cancel IRN modal */}
      <Modal open={cancelId !== null} onClose={() => setCancelId(null)} className="max-w-md">
        <p className="text-sm font-semibold text-text-primary">Cancel IRN</p>
        <p className="text-sm text-text-secondary mt-2">
          This will cancel the IRN on the NIC portal. Cancellation is only allowed within 24 hours
          of generation. This action cannot be undone.
        </p>
        <div className="mt-4 space-y-3">
          <div>
            <label className="text-xs font-medium text-text-secondary block mb-1">
              Cancel Reason
            </label>
            <Select
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value as CancelReason)}
              className="input w-full text-sm"
            >
              {CANCEL_REASONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </Select>
          </div>
          <InputField
            label="Remarks (optional)"
            value={cancelRemarks}
            onChange={(e) => setCancelRemarks(e.target.value)}
            maxLength={100}
            placeholder="Additional details…"
          />
        </div>
        <div className="flex items-center justify-end gap-2 pt-4 mt-4 border-t border-border-light">
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setCancelId(null)}
            disabled={cancelMutation.isPending}
          >
            Close
          </button>
          <button
            type="button"
            className="btn-danger flex items-center gap-1.5"
            onClick={() => {
              if (!cancelId) return;
              cancelMutation.mutate({
                invoiceId: cancelId,
                cancelReason: cancelReason,
                cancelRemarks: cancelRemarks || undefined,
              });
            }}
            disabled={cancelMutation.isPending}
          >
            {cancelMutation.isPending && <Spinner size="sm" />}
            Cancel IRN
          </button>
        </div>
      </Modal>
    </div>
  );
}

// ── Settings tab ──────────────────────────────────────────────

type ConfigForm = {
  gstin: string;
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  isSandbox: boolean;
  isEnabled: boolean;
  thresholdCrore: string;
};

const EMPTY_CONFIG: ConfigForm = {
  gstin: "",
  clientId: "",
  clientSecret: "",
  username: "",
  password: "",
  isSandbox: true,
  isEnabled: false,
  thresholdCrore: "5",
};

function SettingsTab() {
  const [form, setForm] = useState<ConfigForm>(EMPTY_CONFIG);
  const [loaded, setLoaded] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const { isLoading, data: configData } = trpc.eInvoice.getConfig.useQuery(undefined);

  useEffect(() => {
    if (configData && !loaded) {
      setForm({
        gstin: configData.gstin,
        clientId: configData.clientId ?? "", // null when supplied from server env
        clientSecret: "", // Don't pre-fill masked values
        username: configData.username,
        password: "", // Don't pre-fill masked values
        isSandbox: configData.isSandbox,
        isEnabled: configData.isEnabled,
        thresholdCrore: String(configData.thresholdCrore ?? "5"),
      });
      setLoaded(true);
    }
  }, [configData, loaded]);

  const utils = trpc.useUtils();

  const saveMutation = trpc.eInvoice.configure.useMutation({
    onSuccess: () => {
      toast.success("E-invoice settings saved");
      utils.eInvoice.getConfig.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const testMutation = trpc.eInvoice.testConnection.useMutation({
    onSuccess: (result) => {
      setTestResult(result);
    },
    onError: (err) => {
      setTestResult({ success: false, message: err.message });
    },
  });

  function setField<K extends keyof ConfigForm>(key: K, value: ConfigForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSave() {
    saveMutation.mutate({
      gstin: form.gstin.trim().toUpperCase(),
      clientId: form.clientId.trim(),
      clientSecret: form.clientSecret.trim(),
      username: form.username.trim(),
      password: form.password,
      isSandbox: form.isSandbox,
      isEnabled: form.isEnabled,
      thresholdCrore: form.thresholdCrore,
    });
  }

  if (isLoading) {
    return (
      <div className="card p-6"><DetailSkeleton fields={6} lines={0} label="Loading e-invoicing settings" /></div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="card p-6 space-y-5">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">IRP Credentials</h3>
          <p className="text-xs text-text-tertiary mt-0.5">
            Credentials issued by NIC (National Informatics Centre) for the Invoice Registration Portal.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <InputField
            label="GSTIN"
            value={form.gstin}
            onChange={(e) => setField("gstin", e.target.value.toUpperCase())}
            placeholder="27AABCM1234R1ZM"
            maxLength={15}
          />
          <div>
            <label htmlFor="einvoice-threshold" className="text-xs font-medium text-text-secondary block mb-1">
              Threshold (crore)
            </label>
            <input
              id="einvoice-threshold"
              type="number"
              min="0"
              step="0.01"
              value={form.thresholdCrore}
              onChange={(e) => setField("thresholdCrore", e.target.value)}
              className="input w-full"
            />
            <p className="text-2xs text-text-tertiary mt-1">
              Annual turnover threshold for mandatory e-invoicing
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <InputField
            label="Client ID"
            value={form.clientId}
            onChange={(e) => setField("clientId", e.target.value)}
            placeholder="Your IRP client ID"
          />
          <InputField
            label="Client Secret"
            value={form.clientSecret}
            onChange={(e) => setField("clientSecret", e.target.value)}
            type="password"
            placeholder="Enter to update secret"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <InputField
            label="Username"
            value={form.username}
            onChange={(e) => setField("username", e.target.value)}
            placeholder="Your IRP username"
          />
          <InputField
            label="Password"
            value={form.password}
            onChange={(e) => setField("password", e.target.value)}
            type="password"
            placeholder="Enter to update password"
          />
        </div>

        {/* Toggle options */}
        <div className="flex flex-col gap-3 pt-1">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              role="switch"
              checked={form.isSandbox}
              onChange={(e) => setField("isSandbox", e.target.checked)}
              className="switch"
            />
            <div>
              <span className="text-sm font-medium text-text-primary">Use Sandbox (Testing)</span>
              <p className="text-xs text-text-tertiary">
                Connect to NIC sandbox for testing. Disable for production use.
              </p>
            </div>
          </label>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              role="switch"
              checked={form.isEnabled}
              onChange={(e) => setField("isEnabled", e.target.checked)}
              className="switch"
            />
            <div>
              <span className="text-sm font-medium text-text-primary">Enable E-Invoicing</span>
              <p className="text-xs text-text-tertiary">
                Automatically submit eligible B2B invoices to IRP on creation.
              </p>
            </div>
          </label>
        </div>

        {/* Test connection result */}
        {testResult && (
          <div className={cn(
            "rounded-lg px-4 py-3 text-sm flex items-start gap-2",
            testResult.success
              ? "bg-emerald-600/[0.08] text-emerald-700 dark:text-emerald-400"
              : "bg-red-600/[0.08] text-red-700 dark:text-red-400",
          )}>
            <Icon icon={testResult.success ? CheckmarkCircle02Icon : CancelCircleIcon} size={16} />
            <span>{testResult.message}</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={handleSave}
            disabled={saveMutation.isPending}
            className="btn-primary flex items-center gap-1.5"
          >
            {saveMutation.isPending && <Spinner size="sm" />}
            Save Settings
          </button>
          <button
            onClick={() => { setTestResult(null); testMutation.mutate(); }}
            disabled={testMutation.isPending}
            className="btn-secondary flex items-center gap-1.5"
          >
            {testMutation.isPending && <Spinner size="sm" />}
            Test Connection
          </button>
        </div>
      </div>

      {/* Info box */}
      <div className="card p-5 bg-brand-50 dark:bg-brand-950/20 border-brand-200 dark:border-brand-800/40">
        <h4 className="text-sm font-semibold text-brand-800 dark:text-brand-300 mb-2">
          About E-Invoicing
        </h4>
        <ul className="text-xs text-brand-700 dark:text-brand-400 space-y-1 list-disc list-inside">
          <li>Mandatory for businesses with annual turnover above threshold</li>
          <li>B2B invoices (buyer has GSTIN) are eligible for e-invoicing</li>
          <li>IRN can only be cancelled within 24 hours of generation</li>
          <li>Sandbox mode uses NIC test environment (safe for testing)</li>
        </ul>
      </div>
    </div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────

// ── Main page ─────────────────────────────────────────────────

const MAIN_TABS: Array<{ value: EInvoiceTab; label: string }> = [
  { value: "dashboard", label: "Dashboard" },
  { value: "settings", label: "Settings" },
];

export function EInvoicingPage() {
  const [activeTab, setActiveTab] = useState<EInvoiceTab>("dashboard");

  return (
    <div>
      <PageHeader
        title="E-Invoicing"
        description="Submit invoices to NIC IRP and manage IRN lifecycle"
      />

      <div className="mb-5">
        <PillTabs
          tabs={MAIN_TABS}
          value={activeTab}
          onChange={(v) => setActiveTab(v as EInvoiceTab)}
        />
      </div>

      {activeTab === "dashboard" && <DashboardTab />}
      {activeTab === "settings" && <SettingsTab />}
    </div>
  );
}
