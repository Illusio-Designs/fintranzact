import { createFileRoute } from "@tanstack/react-router";
import { PAGE_TITLE_CLASS } from "@/components/ui/PageHeader";
import { Fragment, useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { formatCurrency, formatDate, downloadCSV, cn, formatDateInput, todayISODate } from "@/lib/utils";
import { StatCard } from "@/components/ui/StatCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { DateRangeBar } from "@/components/ui/DateRangeBar";
import { PartyCombobox } from "@/components/ui/PartyCombobox";
import { Select } from "@/components/ui/Select";
import { useDateRange } from "@/hooks/useDateRange";
import { Icon } from "@/components/ui/Icon";
import { Alert02Icon, Analytics01Icon, ArrowRight01Icon, Cash01Icon, Download04Icon, FileEmpty01Icon, InformationCircleIcon, Invoice01Icon, Menu01Icon, MoneySend01Icon, UserGroupIcon } from "@hugeicons/core-free-icons";

import { Spinner } from "@/components/ui/Spinner";
import {
  BatchStockReport,
  DeadStockReport,
  GodownSummaryReport,
  MovementSummaryReport,
  ReorderStatusReport,
  StockAgeingReport,
  StockLedgerReport,
  StockGroupSummaryReport,
} from "@/components/reports/InventoryReports";
import {
  PendingDeliveryChallansReport,
  PendingGrnReport,
  PendingPurchaseOrdersReport,
  PendingSalesOrdersReport,
} from "@/components/reports/OrderReports";
import { StockGroupFilter } from "@/components/inventory/StockGroups";
import { PriceListReport } from "@/components/reports/PriceListReport";
import { paymentModeLabel } from "@/lib/payment-modes";
export const Route = createFileRoute("/reports")({
  component: ReportsPage,
});

// ── Report catalogue ─────────────────────────────────────────────

type ReportId =
  | "daybook"
  | "sales-register"
  | "purchase-register"
  | "outstanding"
  | "msme-payables"
  | "party-statement"
  | "stock-summary"
  | "stock-ledger"
  | "stock-movement"
  | "godown-summary"
  | "batch-stock"
  | "expiring-batches"
  | "expired-stock"
  | "stock-group-summary"
  | "stock-ageing"
  | "reorder-status"
  | "dead-stock"
  | "pending-sales-orders"
  | "pending-purchase-orders"
  | "pending-grns"
  | "pending-delivery-challans"
  | "price-list"
  | "item-wise-sales"
  | "payment-summary"
  | "tax-summary"
  | "collection-metrics"
  | "cash-flow";

interface ReportDef {
  id: ReportId;
  label: string;
  description: string;
  tabular: boolean; // true = table + CSV download, false = card/summary layout
}

const REPORT_GROUPS: Array<{ label: string; reports: ReportDef[] }> = [
  {
    label: "Financial",
    reports: [
      { id: "daybook", label: "Daybook", description: "Chronological record of all transactions", tabular: true },
      { id: "sales-register", label: "Sales Register", description: "All sales invoices in a period", tabular: true },
      { id: "purchase-register", label: "Purchase Register", description: "All purchase invoices in a period", tabular: true },
    ],
  },
  {
    label: "Receivables & Payables",
    reports: [
      { id: "outstanding", label: "Outstanding Report", description: "Unpaid balances by party", tabular: true },
      { id: "msme-payables", label: "MSME Payables", description: "Unpaid MSME supplier bills and their 45-day pay-by dates", tabular: true },
      { id: "party-statement", label: "Party Statement", description: "Full ledger for a selected party", tabular: true },
    ],
  },
  {
    label: "Inventory",
    reports: [
      { id: "stock-summary", label: "Stock Summary", description: "Current stock levels by item", tabular: true },
      { id: "stock-ledger", label: "Stock Ledger", description: "Every movement of an item with its running balance", tabular: true },
      { id: "stock-movement", label: "Movement Summary", description: "Opening, inward, outward and closing stock per item", tabular: true },
      { id: "stock-group-summary", label: "Stock Group Summary", description: "Stock quantity and value per stock group, with drill-down to items", tabular: true },
      { id: "godown-summary", label: "Godown Summary", description: "Stock held and its value in each warehouse", tabular: true },
      { id: "batch-stock", label: "Batch-wise Stock", description: "Stock per batch and warehouse, with expiry dates", tabular: true },
      { id: "expiring-batches", label: "Expiring Soon", description: "Batches that expire in the next N days", tabular: true },
      { id: "expired-stock", label: "Expired Stock", description: "Batches past their expiry that are still in stock", tabular: true },
      { id: "stock-ageing", label: "Stock Ageing", description: "How long current stock has been held", tabular: true },
      { id: "reorder-status", label: "Reorder Status", description: "Items at or below their reorder level, with a suggested order", tabular: true },
      { id: "dead-stock", label: "Dead Stock", description: "Stock that hasn't sold in a while", tabular: true },
      { id: "price-list", label: "Price List", description: "Each item's price on every price level, with MRP", tabular: true },
      { id: "item-wise-sales", label: "Item-wise Sales", description: "Sales quantity and value per item", tabular: true },
    ],
  },
  {
    label: "Orders",
    reports: [
      { id: "pending-sales-orders", label: "Pending Sales Orders", description: "Ordered by customers and not yet delivered", tabular: true },
      { id: "pending-purchase-orders", label: "Pending Purchase Orders", description: "Ordered from suppliers and not yet received", tabular: true },
      { id: "pending-grns", label: "Pending GRNs", description: "Goods received and not yet billed", tabular: true },
      { id: "pending-delivery-challans", label: "Pending Delivery Challans", description: "Goods delivered and not yet billed", tabular: true },
    ],
  },
  {
    label: "Payments & Tax",
    reports: [
      { id: "payment-summary", label: "Payment Summary", description: "All payments received and made", tabular: true },
      { id: "tax-summary", label: "Tax Summary", description: "Tax collected and paid summary", tabular: true },
      { id: "collection-metrics", label: "Collection Efficiency", description: "Payment collection performance", tabular: false },
      { id: "cash-flow", label: "Cash Flow Statement", description: "Cash flows from operating, investing, and financing activities", tabular: false },
    ],
  },
];

const ALL_REPORTS = REPORT_GROUPS.flatMap((g) => g.reports);

// ── Type shapes for API responses ────────────────────────────────

// Daybook — matches router's actual return shape
interface DaybookEntry {
  id: string;
  time: Date; // SuperJSON deserialises DB Date back to Date on the client
  entryType: "invoice" | "payment" | "expense";
  number: string | null;
  partyOrCategory: string;
  debit: string;
  credit: string;
  mode: string | null;
  status: string | null;
  meta: Record<string, string | null>;
}

// Outstanding — matches router's actual return shape
interface OutstandingPartyRow {
  partyId: string;
  partyName: string;
  partyPhone: string | null;
  current: string;
  days31_60: string;
  days61_90: string;
  days90Plus: string;
  total: string;
  invoices: unknown[];
}

interface AgingBucket {
  parties: OutstandingPartyRow[];
  summary: {
    current: string;
    days31_60: string;
    days61_90: string;
    days90Plus: string;
    total: string;
  };
}

// ── Daybook report ───────────────────────────────────────────────

function EntryTypeIcon({ entryType }: { entryType: DaybookEntry["entryType"] }) {
  if (entryType === "invoice") {
    return (
      <div className="w-7 h-7 rounded-lg bg-blue-50 dark:bg-blue-950 flex items-center justify-center shrink-0">
        <Icon icon={Invoice01Icon} size={14} className="text-blue-600 dark:text-blue-400" />
      </div>
    );
  }
  if (entryType === "payment") {
    return (
      <div className="w-7 h-7 rounded-lg bg-emerald-50 dark:bg-emerald-950 flex items-center justify-center shrink-0">
        <Icon icon={Cash01Icon} size={14} className="text-emerald-600 dark:text-emerald-400" />
      </div>
    );
  }
  // expense
  return (
    <div className="w-7 h-7 rounded-lg bg-amber-50 dark:bg-amber-950 flex items-center justify-center shrink-0">
      <Icon icon={MoneySend01Icon} size={14} className="text-amber-600 dark:text-amber-400" />
    </div>
  );
}

// Group flat entries array by calendar date (YYYY-MM-DD) for display
function groupEntriesByDate(entries: DaybookEntry[]): Map<string, DaybookEntry[]> {
  const map = new Map<string, DaybookEntry[]>();
  for (const entry of entries) {
    const dateKey = formatDateInput(entry.time);
    const group = map.get(dateKey) ?? [];
    group.push(entry);
    map.set(dateKey, group);
  }
  return map;
}

type DaybookTypeFilter = "all" | "invoices" | "payments" | "expenses";

function DaybookReport({
  fromDate,
  toDate,
}: {
  fromDate?: string;
  toDate?: string;
}) {
  const [typeFilter, setTypeFilter] = useState<DaybookTypeFilter>("all");

  // Extract date-only strings (YYYY-MM-DD) — daybookInputSchema uses z.string().date()
  const fromDateOnly = fromDate ? formatDateInput(fromDate) : undefined;
  const toDateOnly = toDate ? formatDateInput(toDate) : undefined;

  const { data, isLoading, error } = trpc.reports.daybook.useQuery(
    {
      fromDate: fromDateOnly ?? todayISODate(),
      toDate: toDateOnly ?? todayISODate(),
      typeFilter,
    },
    { enabled: !!(fromDateOnly && toDateOnly) }
  );

  function handleExport() {
    if (!data) return;
    const headers = ["Date", "Time", "Type", "Ref #", "Party / Category", "Debit", "Credit", "Mode", "Status"];
    const rows: (string | number)[][] = data.entries.map((entry) => [
      formatDateInput(entry.time),
      new Date(entry.time).toLocaleTimeString(),
      entry.entryType,
      entry.number ?? "",
      entry.partyOrCategory,
      entry.debit,
      entry.credit,
      entry.mode ?? "",
      entry.status ?? "",
    ]);
    downloadCSV("daybook", headers, rows);
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner size="md" className="text-brand-600" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <EmptyState
        icon={
          <Icon icon={Alert02Icon} size={20} className="text-text-tertiary" />
        }
        title="Could not load daybook"
        description="The reports router may not be available yet. It will appear here once the backend is ready."
      />
    );
  }

  if (data.entries.length === 0) {
    return (
      <>
        {/* Type filter tabs */}
        <DaybookTypeTabs value={typeFilter} onChange={setTypeFilter} />
        <EmptyState
          icon={
            <Icon icon={FileEmpty01Icon} size={20} className="text-text-tertiary" />
          }
          title="No transactions in this period"
          description="Try selecting a wider date range or a different filter."
        />
      </>
    );
  }

  const { summary } = data;
  const groupedByDate = groupEntriesByDate(data.entries);
  const sortedDates = [...groupedByDate.keys()].sort();

  return (
    <div>
      {/* Summary bar — uses actual router summary fields */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
        <SummaryCard label="Sales Invoiced" value={formatCurrency(summary.totalSalesInvoiced)} accent="blue" />
        <SummaryCard label="Payments Received" value={formatCurrency(summary.totalPaymentsReceived)} accent="green" />
        <SummaryCard label="Payments Made" value={formatCurrency(summary.totalPaymentsMade)} accent="red" />
        <SummaryCard label="Purchase Invoiced" value={formatCurrency(summary.totalPurchaseInvoiced)} />
        <SummaryCard label="Expenses" value={formatCurrency(summary.totalExpenses)} accent="red" />
        <SummaryCard
          label="Net Cash Movement"
          value={formatCurrency(summary.netCashMovement)}
          accent={parseFloat(summary.netCashMovement) >= 0 ? "green" : "red"}
        />
      </div>

      {/* Type filter + Export row */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <DaybookTypeTabs value={typeFilter} onChange={setTypeFilter} />
        <ExportButton onClick={handleExport} />
      </div>

      {/* Table grouped by day */}
      <div className="bg-surface rounded-2xl border border-border overflow-hidden">
        <div className="max-h-[calc(100vh-280px)] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-border bg-surface-2 backdrop-blur-sm">
              <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary w-7" />
              <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Description</th>
              <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary hidden md:table-cell">Ref #</th>
              <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary hidden lg:table-cell">Mode</th>
              <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Debit</th>
              <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Credit</th>
            </tr>
          </thead>
          <tbody>
            {sortedDates.map((dateKey) => {
              const dayEntries = groupedByDate.get(dateKey)!;
              const dayDebit = dayEntries.reduce((s, e) => s + parseFloat(e.debit), 0).toFixed(2);
              const dayCredit = dayEntries.reduce((s, e) => s + parseFloat(e.credit), 0).toFixed(2);
              return (
                <Fragment key={dateKey}>
                  {/* Date header row */}
                  <tr key={`day-${dateKey}`} className="bg-surface-2/30 border-b border-border/50">
                    <td colSpan={6} className="px-4 py-2 text-[12px] font-semibold text-text-secondary">
                      {formatDate(dateKey)}
                    </td>
                  </tr>

                  {/* Transaction rows */}
                  {dayEntries.map((entry, i) => (
                    <tr
                      key={`${dateKey}-${i}`}
                      className="border-b border-border/40 hover:bg-surface-2/40 transition-colors"
                    >
                      <td className="pl-4 py-2.5 pr-2">
                        <EntryTypeIcon entryType={entry.entryType} />
                      </td>
                      <td className="px-2 py-2.5">
                        <p className="text-text-primary text-[13px]">{entry.partyOrCategory}</p>
                        {entry.meta.description && (
                          <p className="text-text-tertiary text-[11px] mt-0.5">{entry.meta.description}</p>
                        )}
                      </td>
                      <td className="px-4 py-2.5 hidden md:table-cell">
                        <span className="text-text-tertiary text-[12px] font-mono">{entry.number ?? "—"}</span>
                      </td>
                      <td className="px-4 py-2.5 hidden lg:table-cell">
                        <span className="text-text-secondary text-[12px] capitalize">{entry.mode ?? "—"}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {parseFloat(entry.debit) > 0 ? (
                          <span className="text-red-600 dark:text-red-400 text-[13px] font-medium tabular-nums">
                            {formatCurrency(entry.debit)}
                          </span>
                        ) : (
                          <span className="text-text-tertiary text-[13px]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {parseFloat(entry.credit) > 0 ? (
                          <span className="text-emerald-600 dark:text-emerald-400 text-[13px] font-medium tabular-nums">
                            {formatCurrency(entry.credit)}
                          </span>
                        ) : (
                          <span className="text-text-tertiary text-[13px]">—</span>
                        )}
                      </td>
                    </tr>
                  ))}

                  {/* Daily totals row */}
                  <tr key={`total-${dateKey}`} className="border-b border-border bg-surface-2/20">
                    <td colSpan={4} className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary text-right hidden md:table-cell">
                      Day Total
                    </td>
                    <td colSpan={2} className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary md:hidden">
                      Day Total
                    </td>
                    <td className="px-4 py-2 text-right">
                      <span className="text-red-600 dark:text-red-400 text-[12px] font-semibold tabular-nums">
                        {formatCurrency(dayDebit)}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <span className="text-emerald-600 dark:text-emerald-400 text-[12px] font-semibold tabular-nums">
                        {formatCurrency(dayCredit)}
                      </span>
                    </td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}

function DaybookTypeTabs({
  value,
  onChange,
}: {
  value: DaybookTypeFilter;
  onChange: (v: DaybookTypeFilter) => void;
}) {
  const tabs: { id: DaybookTypeFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "invoices", label: "Invoices" },
    { id: "payments", label: "Payments" },
    { id: "expenses", label: "Expenses" },
  ];
  return (
    <div className="flex items-center gap-1">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
            value === tab.id
              ? "bg-brand-600/[0.1] text-brand-700 dark:text-brand-400"
              : "text-text-tertiary hover:text-text-secondary hover:bg-surface-2"
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

// ── Outstanding Report ───────────────────────────────────────────

function AgingTable({
  label,
  bucket,
}: {
  label: string;
  bucket: AgingBucket;
}) {
  if (bucket.parties.length === 0) return null;
  return (
    <div className="mb-6">
      <h3 className="text-[12px] font-semibold uppercase tracking-wider text-text-tertiary mb-2 px-1">{label}</h3>
      <div className="bg-surface rounded-2xl border border-border overflow-hidden">
        <div className="max-h-[calc(100vh-280px)] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-border bg-surface-2 backdrop-blur-sm">
              <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Party</th>
              <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary hidden md:table-cell">Current</th>
              <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary hidden lg:table-cell">31-60 days</th>
              <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary hidden lg:table-cell">61-90 days</th>
              <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary hidden md:table-cell">90+ days</th>
              <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Total</th>
            </tr>
          </thead>
          <tbody>
            {bucket.parties.map((party) => (
              <tr key={party.partyId} className="border-b border-border/40 hover:bg-surface-2/40 transition-colors">
                <td className="px-4 py-3">
                  <p className="text-text-primary text-[13px] font-medium">{party.partyName}</p>
                  {party.partyPhone && (
                    <p className="text-text-tertiary text-[11px] mt-0.5">{party.partyPhone}</p>
                  )}
                </td>
                <td className="px-4 py-3 text-right hidden md:table-cell">
                  <span className="text-text-secondary text-[13px] tabular-nums">{formatCurrency(party.current)}</span>
                </td>
                <td className="px-4 py-3 text-right hidden lg:table-cell">
                  {parseFloat(party.days31_60) > 0 ? (
                    <span className="text-amber-600 dark:text-amber-400 text-[13px] tabular-nums">{formatCurrency(party.days31_60)}</span>
                  ) : (
                    <span className="text-text-tertiary text-[13px]">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right hidden lg:table-cell">
                  {parseFloat(party.days61_90) > 0 ? (
                    <span className="text-orange-600 dark:text-orange-400 text-[13px] tabular-nums">{formatCurrency(party.days61_90)}</span>
                  ) : (
                    <span className="text-text-tertiary text-[13px]">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right hidden md:table-cell">
                  {parseFloat(party.days90Plus) > 0 ? (
                    <span className="text-red-600 dark:text-red-400 text-[13px] tabular-nums">{formatCurrency(party.days90Plus)}</span>
                  ) : (
                    <span className="text-text-tertiary text-[13px]">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="text-text-primary text-[13px] font-semibold tabular-nums">{formatCurrency(party.total)}</span>
                </td>
              </tr>
            ))}
            {/* Summary footer row */}
            <tr className="bg-surface-2/30 border-t border-border">
              <td className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Total</td>
              <td className="px-4 py-2.5 text-right hidden md:table-cell">
                <span className="text-text-secondary text-[12px] font-semibold tabular-nums">{formatCurrency(bucket.summary.current)}</span>
              </td>
              <td className="px-4 py-2.5 text-right hidden lg:table-cell">
                <span className="text-amber-600 dark:text-amber-400 text-[12px] font-semibold tabular-nums">{formatCurrency(bucket.summary.days31_60)}</span>
              </td>
              <td className="px-4 py-2.5 text-right hidden lg:table-cell">
                <span className="text-orange-600 dark:text-orange-400 text-[12px] font-semibold tabular-nums">{formatCurrency(bucket.summary.days61_90)}</span>
              </td>
              <td className="px-4 py-2.5 text-right hidden md:table-cell">
                <span className="text-red-600 dark:text-red-400 text-[12px] font-semibold tabular-nums">{formatCurrency(bucket.summary.days90Plus)}</span>
              </td>
              <td className="px-4 py-2.5 text-right">
                <span className="text-text-primary text-[12px] font-bold tabular-nums">{formatCurrency(bucket.summary.total)}</span>
              </td>
            </tr>
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}

function OutstandingReport({
  toDate,
}: {
  fromDate?: string;
  toDate?: string;
}) {
  const [partyType, setPartyType] = useState<"all" | "customer" | "supplier">("all");

  // Map UI partyType → router `type` field
  const routerType =
    partyType === "customer" ? "receivable" :
    partyType === "supplier" ? "payable" :
    "both";

  const { data, isLoading, error } = trpc.reports.outstanding.useQuery(
    {
      type: routerType,
      // asOfDate accepts datetime string — use toDate if provided, otherwise omit (router defaults to now)
      asOfDate: toDate ?? undefined,
    },
    { enabled: true }
  );

  function handleExport() {
    if (!data) return;
    const headers = ["Party", "Phone", "Current", "31-60 days", "61-90 days", "90+ days", "Total", "Section"];
    const rows: (string | number)[][] = [];
    if (data.receivables) {
      for (const p of data.receivables.parties) {
        rows.push([p.partyName, p.partyPhone ?? "", p.current, p.days31_60, p.days61_90, p.days90Plus, p.total, "Receivable"]);
      }
    }
    if (data.payables) {
      for (const p of data.payables.parties) {
        rows.push([p.partyName, p.partyPhone ?? "", p.current, p.days31_60, p.days61_90, p.days90Plus, p.total, "Payable"]);
      }
    }
    downloadCSV("outstanding-report", headers, rows);
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner size="md" className="text-brand-600" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <EmptyState
        icon={
          <Icon icon={Alert02Icon} size={20} className="text-text-tertiary" />
        }
        title="Could not load outstanding report"
        description="The reports router may not be available yet. It will appear here once the backend is ready."
      />
    );
  }

  const totalReceivable = data.receivables?.summary.total ?? "0";
  const totalPayable = data.payables?.summary.total ?? "0";
  const hasAny =
    (data.receivables?.parties.length ?? 0) > 0 ||
    (data.payables?.parties.length ?? 0) > 0;

  return (
    <div>
      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
        <SummaryCard label="Total Receivable" value={formatCurrency(totalReceivable)} accent="green" />
        <SummaryCard label="Total Payable" value={formatCurrency(totalPayable)} accent="red" />
      </div>

      {/* Filters + Export */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {(["all", "customer", "supplier"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setPartyType(t)}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize",
              partyType === t
                ? "bg-brand-600/[0.1] text-brand-700 dark:text-brand-400"
                : "text-text-tertiary hover:text-text-secondary hover:bg-surface-2"
            )}
          >
            {t === "all" ? "All Parties" : t === "customer" ? "Customers" : "Suppliers"}
          </button>
        ))}
        <ExportButton onClick={handleExport} />
      </div>

      {!hasAny ? (
        <EmptyState title="No outstanding balances" description="All parties are settled as of this date." />
      ) : (
        <>
          {data.receivables && data.receivables.parties.length > 0 && (
            <AgingTable label="Receivables (Customers)" bucket={data.receivables} />
          )}
          {data.payables && data.payables.parties.length > 0 && (
            <AgingTable label="Payables (Suppliers)" bucket={data.payables} />
          )}
        </>
      )}
    </div>
  );
}

// ── MSME payables (Section 43B(h)) ─────────────────────────────

function MsmePayablesReport() {
  const { data, isLoading, error } = trpc.reports.msmePayables.useQuery();

  function handleExport() {
    if (!data) return;
    const headers = ["Supplier", "Udyam", "Category", "Bill", "Bill date", "Outstanding", "Pay by", "Days left"];
    const rows = data.bills.map((b) => [
      b.partyName,
      b.udyamNumber ?? "",
      b.msmeCategory ?? "",
      b.invoiceNumber,
      formatDate(b.invoiceDate),
      b.outstanding,
      formatDate(b.payBy),
      b.daysLeft,
    ]);
    downloadCSV("msme-payables", headers, rows);
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner size="md" className="text-brand-600" />
      </div>
    );
  }
  if (error || !data) {
    return <EmptyState title="Could not load MSME payables" description={error?.message ?? "Please try again."} />;
  }

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
        <SummaryCard label="Owed to MSME suppliers" value={formatCurrency(data.totalOutstanding)} accent="red" />
        <SummaryCard label="Past pay-by date" value={formatCurrency(data.overdueOutstanding)} accent="red" />
        <SummaryCard label="Overdue bills" value={String(data.overdueCount)} accent="red" />
      </div>
      <p className="text-xs text-text-tertiary mb-4">
        Micro and small suppliers must be paid within their agreed credit period, capped at 45 days, or within 15 days
        if none is agreed (Section 43B(h)). Late payments can only be deducted in the year they are paid.
        Mark suppliers as MSME on the Parties page.
      </p>
      <div className="flex justify-end mb-3">
        <ExportButton onClick={handleExport} />
      </div>
      {data.bills.length === 0 ? (
        <EmptyState title="No unpaid MSME bills" description="Nothing owed to micro or small suppliers right now." />
      ) : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Supplier</th>
                <th>Bill</th>
                <th>Bill date</th>
                <th className="text-right">Outstanding</th>
                <th>Pay by</th>
                <th className="text-right">Days left</th>
              </tr>
            </thead>
            <tbody>
              {data.bills.map((b) => (
                <tr key={b.invoiceId}>
                  <td>
                    <div className="font-medium">{b.partyName}</div>
                    {b.udyamNumber && <div className="text-xs text-text-tertiary">{b.udyamNumber}</div>}
                  </td>
                  <td>{b.invoiceNumber}</td>
                  <td>{formatDate(b.invoiceDate)}</td>
                  <td className="text-right tabular-nums">{formatCurrency(b.outstanding)}</td>
                  <td>{formatDate(b.payBy)}</td>
                  <td className={cn("text-right tabular-nums font-medium", b.daysLeft < 0 ? "text-red-600" : b.daysLeft <= 7 ? "text-amber-600" : "")}>
                    {b.daysLeft < 0 ? `${-b.daysLeft} overdue` : b.daysLeft}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Register report types ────────────────────────────────────────

interface TaxBreakdownItem {
  taxPercent: string;
  taxableAmount: string;
  taxAmount: string;
}

interface SaleRegisterRow {
  id: string;
  invoiceDate: Date | string;
  invoiceNumber: string;
  documentType: string;
  customerName: string;
  customerGstin: string | null;
  customerState: string | null;
  subtotal: string;
  discountAmount: string;
  taxAmount: string;
  totalAmount: string;
  amountPaid: string;
  status: string;
  taxBreakdown: TaxBreakdownItem[];
  /** Free goods ("10 + 1") on the bill, summed over its lines. */
  freeQuantity?: number;
}

interface PurchaseRegisterRow {
  id: string;
  invoiceDate: Date | string;
  invoiceNumber: string;
  supplierName: string;
  supplierGstin: string | null;
  subtotal: string;
  discountAmount: string;
  taxAmount: string;
  totalAmount: string;
  amountPaid: string;
  status: string;
  taxBreakdown: TaxBreakdownItem[];
  /** Free goods ("10 + 1") on the bill, summed over its lines. */
  freeQuantity?: number;
}

interface RegisterSummary {
  totalSubtotal: string;
  totalTax: string;
  totalAmount: string;
  count: number;
  totalFreeQuantity?: number;
}

interface SaleRegisterData {
  rows: SaleRegisterRow[];
  summary: RegisterSummary;
}

interface PurchaseRegisterData {
  rows: PurchaseRegisterRow[];
  summary: RegisterSummary;
}

// ── Status badge ─────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    paid: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400",
    partially_paid: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400",
    unpaid: "bg-surface-2 text-text-secondary",
    overdue: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400",
    draft: "bg-surface-2 text-text-tertiary",
    cancelled: "bg-surface-2 text-text-tertiary",
  };
  const label: Record<string, string> = {
    paid: "Paid",
    partially_paid: "Partial",
    unpaid: "Unpaid",
    overdue: "Overdue",
    draft: "Draft",
    cancelled: "Cancelled",
  };
  return (
    <span
      className={cn(
        "text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap",
        styles[status] ?? "bg-surface-2 text-text-secondary",
      )}
    >
      {label[status] ?? status}
    </span>
  );
}

// ── Shared Register Report component ────────────────────────────

function RegisterReport({
  type,
  fromDate,
  toDate,
}: {
  type: "sale" | "purchase";
  fromDate?: string;
  toDate?: string;
}) {
  const isSale = type === "sale";
  const queryFn = isSale
    ? (trpc as any).reports.salesRegister
    : (trpc as any).reports.purchaseRegister;

  const { data, isLoading, error } = queryFn.useQuery(
    { fromDate, toDate },
    { enabled: true },
  ) as {
    data: SaleRegisterData | PurchaseRegisterData | undefined;
    isLoading: boolean;
    error: unknown;
  };

  function handleExport() {
    if (!data) return;
    if (isSale) {
      const saleData = data as SaleRegisterData;
      const headers = [
        "Date",
        "Invoice #",
        "Doc Type",
        "Customer",
        "GSTIN",
        "State",
        "Free Qty",
        "Subtotal",
        "Discount",
        "Tax",
        "Total",
        "Paid",
        "Status",
      ];
      const csvRows: (string | number)[][] = saleData.rows.map((r) => [
        formatDate(String(r.invoiceDate)),
        r.invoiceNumber,
        r.documentType,
        r.customerName,
        r.customerGstin ?? "",
        r.customerState ?? "",
        r.freeQuantity ?? 0,
        r.subtotal,
        r.discountAmount,
        r.taxAmount,
        r.totalAmount,
        r.amountPaid,
        r.status,
      ]);
      downloadCSV("sales-register", headers, csvRows);
    } else {
      const purchaseData = data as PurchaseRegisterData;
      const headers = [
        "Date",
        "Invoice #",
        "Supplier",
        "GSTIN",
        "Free Qty",
        "Subtotal",
        "Discount",
        "Tax",
        "Total",
        "Paid",
        "Status",
      ];
      const csvRows: (string | number)[][] = purchaseData.rows.map((r) => [
        formatDate(String(r.invoiceDate)),
        r.invoiceNumber,
        r.supplierName,
        r.supplierGstin ?? "",
        r.freeQuantity ?? 0,
        r.subtotal,
        r.discountAmount,
        r.taxAmount,
        r.totalAmount,
        r.amountPaid,
        r.status,
      ]);
      downloadCSV("purchase-register", headers, csvRows);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner size="md" className="text-brand-600" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <EmptyState
        icon={
          <Icon icon={Alert02Icon} size={20} className="text-text-tertiary" />
        }
        title={`Could not load ${isSale ? "sales" : "purchase"} register`}
        description="The reports router may not be available yet. It will appear here once the backend is ready."
      />
    );
  }

  if (data.rows.length === 0) {
    return (
      <EmptyState
        icon={
          <Icon icon={FileEmpty01Icon} size={20} className="text-text-tertiary" />
        }
        title={`No ${isSale ? "sales" : "purchase"} invoices in this period`}
        description="Try selecting a wider date range."
      />
    );
  }

  const { summary } = data;
  // Free goods are not priced, so the column only shows when there are some.
  const showFree = (summary.totalFreeQuantity ?? 0) > 0;
  const freeHeader = showFree && (
    <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary hidden lg:table-cell" title="Given or received free on top of the billed quantity; not part of the taxable value">
      Free Qty
    </th>
  );
  const freeCell = (q?: number) => showFree && (
    <td className="px-4 py-3 text-right hidden lg:table-cell">
      <span className="text-text-secondary text-[13px] tabular-nums">{q ? q : "—"}</span>
    </td>
  );

  return (
    <div>
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <SummaryCard label="Subtotal" value={formatCurrency(summary.totalSubtotal)} />
        <SummaryCard label="Total Tax" value={formatCurrency(summary.totalTax)} accent="blue" />
        <SummaryCard
          label="Total Amount"
          value={formatCurrency(summary.totalAmount)}
          accent="green"
        />
        <SummaryCard label={isSale ? "Invoices" : "Bills"} value={String(summary.count)} />
      </div>

      {/* Export */}
      <div className="flex justify-end mb-3">
        <ExportButton onClick={handleExport} />
      </div>

      {/* Table */}
      <div className="bg-surface rounded-2xl border border-border overflow-hidden">
        <div className="max-h-[calc(100vh-280px)] overflow-auto">
          {isSale ? (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-border bg-surface-2 backdrop-blur-sm">
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary whitespace-nowrap">
                    Date
                  </th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary whitespace-nowrap">
                    Invoice #
                  </th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary hidden lg:table-cell">
                    Doc Type
                  </th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                    Customer
                  </th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary hidden md:table-cell">
                    GSTIN
                  </th>
                  {freeHeader}
                  <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary hidden lg:table-cell">
                    Subtotal
                  </th>
                  <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary hidden lg:table-cell">
                    Discount
                  </th>
                  <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary hidden md:table-cell">
                    Tax
                  </th>
                  <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                    Total
                  </th>
                  <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary hidden md:table-cell">
                    Paid
                  </th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {(data as SaleRegisterData).rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-border/40 hover:bg-surface-2/40 transition-colors"
                  >
                    <td className="px-4 py-3 text-[12px] text-text-secondary whitespace-nowrap">
                      {formatDate(String(row.invoiceDate))}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-text-primary text-[13px] font-medium font-mono">
                        {row.invoiceNumber}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-surface-2 text-text-secondary capitalize">
                        {row.documentType.replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-text-primary text-[13px]">{row.customerName}</p>
                      {row.customerState && (
                        <p className="text-text-tertiary text-[11px] mt-0.5">{row.customerState}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className="text-text-tertiary text-[12px] font-mono">
                        {row.customerGstin ?? "—"}
                      </span>
                    </td>
                    {freeCell(row.freeQuantity)}
                    <td className="px-4 py-3 text-right hidden lg:table-cell">
                      <span className="text-text-secondary text-[13px] tabular-nums">
                        {formatCurrency(row.subtotal)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right hidden lg:table-cell">
                      {parseFloat(row.discountAmount) > 0 ? (
                        <span className="text-amber-600 dark:text-amber-400 text-[13px] tabular-nums">
                          -{formatCurrency(row.discountAmount)}
                        </span>
                      ) : (
                        <span className="text-text-tertiary text-[13px]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right hidden md:table-cell">
                      <span className="text-text-secondary text-[13px] tabular-nums">
                        {formatCurrency(row.taxAmount)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-text-primary text-[13px] font-semibold tabular-nums">
                        {formatCurrency(row.totalAmount)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right hidden md:table-cell">
                      <span className="text-emerald-600 dark:text-emerald-400 text-[13px] tabular-nums">
                        {formatCurrency(row.amountPaid)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={row.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-border bg-surface-2 backdrop-blur-sm">
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary whitespace-nowrap">
                    Date
                  </th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary whitespace-nowrap">
                    Invoice #
                  </th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                    Supplier
                  </th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary hidden md:table-cell">
                    GSTIN
                  </th>
                  {freeHeader}
                  <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary hidden lg:table-cell">
                    Subtotal
                  </th>
                  <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary hidden lg:table-cell">
                    Discount
                  </th>
                  <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary hidden md:table-cell">
                    Tax
                  </th>
                  <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                    Total
                  </th>
                  <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary hidden md:table-cell">
                    Paid
                  </th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {(data as PurchaseRegisterData).rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-border/40 hover:bg-surface-2/40 transition-colors"
                  >
                    <td className="px-4 py-3 text-[12px] text-text-secondary whitespace-nowrap">
                      {formatDate(String(row.invoiceDate))}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-text-primary text-[13px] font-medium font-mono">
                        {row.invoiceNumber}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-text-primary text-[13px]">{row.supplierName}</p>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className="text-text-tertiary text-[12px] font-mono">
                        {row.supplierGstin ?? "—"}
                      </span>
                    </td>
                    {freeCell(row.freeQuantity)}
                    <td className="px-4 py-3 text-right hidden lg:table-cell">
                      <span className="text-text-secondary text-[13px] tabular-nums">
                        {formatCurrency(row.subtotal)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right hidden lg:table-cell">
                      {parseFloat(row.discountAmount) > 0 ? (
                        <span className="text-amber-600 dark:text-amber-400 text-[13px] tabular-nums">
                          -{formatCurrency(row.discountAmount)}
                        </span>
                      ) : (
                        <span className="text-text-tertiary text-[13px]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right hidden md:table-cell">
                      <span className="text-text-secondary text-[13px] tabular-nums">
                        {formatCurrency(row.taxAmount)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-text-primary text-[13px] font-semibold tabular-nums">
                        {formatCurrency(row.totalAmount)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right hidden md:table-cell">
                      <span className="text-emerald-600 dark:text-emerald-400 text-[13px] tabular-nums">
                        {formatCurrency(row.amountPaid)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={row.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sales / Purchase Register thin wrappers ──────────────────────

function SalesRegisterReport({ fromDate, toDate }: { fromDate?: string; toDate?: string }) {
  return <RegisterReport type="sale" fromDate={fromDate} toDate={toDate} />;
}

function PurchaseRegisterReport({ fromDate, toDate }: { fromDate?: string; toDate?: string }) {
  return <RegisterReport type="purchase" fromDate={fromDate} toDate={toDate} />;
}

// ── Party Statement ──────────────────────────────────────────────

interface PartyStatementEntry {
  date: Date | string;
  type: "invoice" | "payment";
  number: string;
  description: string;
  debit: string;
  credit: string;
  status: string | null;
  documentId: string;
  runningBalance: string;
}

interface PartyStatementParty {
  id: string;
  name: string;
  type: "customer" | "supplier";
  openingBalance: string;
  gstin: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  billingAddress: string | null;
}

interface PartyStatementData {
  party: PartyStatementParty;
  entries: PartyStatementEntry[];
  summary: {
    totalDebit: string;
    totalCredit: string;
    closingBalance: string;
    isDebit: boolean;
  };
}

function PartyStatementReport({
  partyId,
  fromDate,
  toDate,
}: {
  partyId: string | null;
  fromDate?: string;
  toDate?: string;
}) {
  const { data, isLoading, error } = (trpc as any).reports.partyStatement.useQuery(
    { partyId: partyId ?? "", fromDate, toDate },
    { enabled: !!partyId }
  ) as { data: PartyStatementData | null | undefined; isLoading: boolean; error: unknown };

  function handleExport() {
    if (!data) return;
    const headers = ["Date", "Type", "Ref #", "Description", "Debit", "Credit", "Running Balance", "Status"];
    const rows: (string | number)[][] = data.entries.map((e) => [
      formatDate(e.date),
      e.type,
      e.number,
      e.description,
      e.debit,
      e.credit,
      e.runningBalance,
      e.status ?? "",
    ]);
    downloadCSV(`party-statement-${data.party.name}`, headers, rows);
  }

  if (!partyId) {
    return (
      <EmptyState
        icon={
          <Icon icon={UserGroupIcon} size={20} className="text-text-tertiary" />
        }
        title="Select a party to view statement"
        description="Use the Party selector in the toolbar above to choose a customer or supplier."
      />
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner size="md" className="text-brand-600" />
      </div>
    );
  }

  if (error || data === undefined) {
    return (
      <EmptyState
        icon={
          <Icon icon={Alert02Icon} size={20} className="text-text-tertiary" />
        }
        title="Could not load party statement"
        description="The reports router may not be available yet. It will appear here once the backend is ready."
      />
    );
  }

  if (data === null) {
    return (
      <EmptyState
        title="Party not found"
        description="The selected party could not be found. It may have been deleted."
      />
    );
  }

  return (
    <div>
      {/* Party header */}
      <div className="bg-surface rounded-xl border border-border px-5 py-4 mb-4">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-lg font-semibold text-text-primary">{data.party.name}</h2>
          <span className={cn(
            "text-[11px] font-medium px-2 py-0.5 rounded-full capitalize shrink-0",
            data.party.type === "customer"
              ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400"
              : "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400"
          )}>
            {data.party.type}
          </span>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
          {data.party.gstin && (
            <span className="text-[12px] text-text-tertiary font-mono">GSTIN: {data.party.gstin}</span>
          )}
          {data.party.phone && (
            <span className="text-[12px] text-text-tertiary">{data.party.phone}</span>
          )}
          {data.party.city && (
            <span className="text-[12px] text-text-tertiary">
              {data.party.city}{data.party.state ? `, ${data.party.state}` : ""}
            </span>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
        <SummaryCard label="Total Debit" value={formatCurrency(data.summary.totalDebit)} accent="red" />
        <SummaryCard label="Total Credit" value={formatCurrency(data.summary.totalCredit)} accent="green" />
        <div className="bg-surface rounded-xl border border-border px-4 py-3 col-span-2 md:col-span-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Closing Balance</p>
          <div className="flex items-baseline gap-2 mt-1">
            <p className={cn(
              "text-xl font-semibold tabular-nums",
              data.summary.isDebit ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"
            )}>
              {formatCurrency(data.summary.closingBalance)}
            </p>
            <span className={cn(
              "text-[10px] font-semibold uppercase tracking-wider",
              data.summary.isDebit ? "text-red-500" : "text-emerald-500"
            )}>
              {data.summary.isDebit ? "Dr" : "Cr"}
            </span>
          </div>
        </div>
      </div>

      {/* Export */}
      <div className="flex justify-end mb-3">
        <ExportButton onClick={handleExport} />
      </div>

      {data.entries.length === 0 ? (
        <EmptyState title="No transactions in this period" description="Try selecting a wider date range." />
      ) : (
        <div className="bg-surface rounded-2xl border border-border overflow-hidden">
          <div className="max-h-[calc(100vh-280px)] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-border bg-surface-2 backdrop-blur-sm">
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Date</th>
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary hidden md:table-cell">Type</th>
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary hidden lg:table-cell">Ref #</th>
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Description</th>
                <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Debit</th>
                <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Credit</th>
                <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary hidden md:table-cell">Balance</th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((entry, i) => {
                const balance = parseFloat(entry.runningBalance);
                return (
                  <tr key={i} className="border-b border-border/40 hover:bg-surface-2/40 transition-colors">
                    <td className="px-4 py-2.5">
                      <span className="text-text-secondary text-[12px]">{formatDate(entry.date)}</span>
                    </td>
                    <td className="px-4 py-2.5 hidden md:table-cell">
                      <span className={cn(
                        "text-[11px] font-medium px-2 py-0.5 rounded-full capitalize",
                        entry.type === "invoice"
                          ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400"
                          : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                      )}>
                        {entry.type}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 hidden lg:table-cell">
                      <span className="text-text-tertiary text-[12px] font-mono">{entry.number || "—"}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <p className="text-text-primary text-[13px]">{entry.description}</p>
                      {entry.status && (
                        <span className="text-[10px] text-text-tertiary capitalize">{entry.status}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {parseFloat(entry.debit) > 0 ? (
                        <span className="text-red-600 dark:text-red-400 text-[13px] font-medium tabular-nums">
                          {formatCurrency(entry.debit)}
                        </span>
                      ) : (
                        <span className="text-text-tertiary text-[13px]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {parseFloat(entry.credit) > 0 ? (
                        <span className="text-emerald-600 dark:text-emerald-400 text-[13px] font-medium tabular-nums">
                          {formatCurrency(entry.credit)}
                        </span>
                      ) : (
                        <span className="text-text-tertiary text-[13px]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right hidden md:table-cell">
                      <span className={cn(
                        "text-[13px] font-medium tabular-nums",
                        balance >= 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"
                      )}>
                        {formatCurrency(entry.runningBalance)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Stock Summary ─────────────────────────────────────────────────

interface StockSimpleItem {
  itemId: string;
  itemName: string;
  category: string | null;
  hsn: string | null;
  unit: string | null;
  currentStock: string;
  purchasePrice: string | null;
  salePrice: string | null;
  stockValue: string;
  stockValueAtSale: string;
  lowStockAlert: string | null;
  isLowStock: boolean;
}

interface StockVariantDetail {
  sku: string | null;
  attributes: Record<string, string> | null;
  stock: string;
  purchasePrice: string | null;
  salePrice: string | null;
  lowStockAlert: string | null;
  isLowStock: boolean;
  value: string;
}

interface StockVariantItem {
  itemId: string;
  itemName: string;
  category: string | null;
  hsn: string | null;
  unit: string | null;
  totalStock: string;
  totalValue: string;
  totalValueAtSale: string;
  variantDetails: StockVariantDetail[];
}

interface StockSummaryData {
  simpleItems: StockSimpleItem[];
  variantItems: StockVariantItem[];
  summary: {
    totalCostValue: string;
    totalSaleValue: string;
    totalSkuCount: number;
    lowStockCount: number;
  };
}

function StockSummaryReport() {
  const [showZeroStock, setShowZeroStock] = useState(false);
  const [groupFilter, setGroupFilter] = useState("");
  const [expandedVariants, setExpandedVariants] = useState<Set<string>>(new Set());

  const { data, isLoading, error } = (trpc as any).reports.stockSummary.useQuery(
    { showZeroStock, stockGroupId: groupFilter || undefined }
  ) as { data: StockSummaryData | undefined; isLoading: boolean; error: unknown };

  function toggleVariant(itemId: string) {
    setExpandedVariants((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }

  function formatAttributes(attrs: Record<string, string> | null): string {
    if (!attrs) return "—";
    return Object.values(attrs).join(" / ");
  }

  function handleExport() {
    if (!data) return;
    const headers = ["Name", "Category", "HSN", "Unit", "SKU / Variant", "Stock Qty", "Purchase Price", "Sale Price", "Stock Cost Value", "Low Stock"];
    const rows: (string | number)[][] = [];

    for (const item of data.simpleItems) {
      rows.push([
        item.itemName,
        item.category ?? "",
        item.hsn ?? "",
        item.unit ?? "",
        "",
        item.currentStock,
        item.purchasePrice ?? "",
        item.salePrice ?? "",
        item.stockValue,
        item.isLowStock ? "Yes" : "No",
      ]);
    }

    for (const item of data.variantItems) {
      for (const v of item.variantDetails) {
        rows.push([
          item.itemName,
          item.category ?? "",
          item.hsn ?? "",
          item.unit ?? "",
          v.sku ?? formatAttributes(v.attributes),
          v.stock,
          v.purchasePrice ?? "",
          v.salePrice ?? "",
          v.value,
          v.isLowStock ? "Yes" : "No",
        ]);
      }
    }

    downloadCSV("stock-summary", headers, rows);
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner size="md" className="text-brand-600" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <EmptyState
        icon={
          <Icon icon={Alert02Icon} size={20} className="text-text-tertiary" />
        }
        title="Could not load stock summary"
        description="The reports router may not be available yet. It will appear here once the backend is ready."
      />
    );
  }

  const totalItems = data.simpleItems.length + data.variantItems.length;

  return (
    <div>
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <SummaryCard label="Total Cost Value" value={formatCurrency(data.summary.totalCostValue)} accent="blue" />
        <SummaryCard label="Total Sale Value" value={formatCurrency(data.summary.totalSaleValue)} accent="green" />
        <SummaryCard label="SKU Count" value={data.summary.totalSkuCount.toString()} />
        <div className="bg-surface rounded-xl border border-border px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Low Stock</p>
          <p className={cn(
            "text-xl font-semibold tabular-nums mt-1",
            data.summary.lowStockCount > 0 ? "text-amber-600 dark:text-amber-400" : "text-text-primary"
          )}>
            {data.summary.lowStockCount}
          </p>
        </div>
      </div>

      {/* Filters + Export */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <StockGroupFilter value={groupFilter} onChange={setGroupFilter} className="w-48" />
        <button
          onClick={() => setShowZeroStock((v) => !v)}
          className={cn(
            "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
            showZeroStock
              ? "bg-brand-600/[0.1] text-brand-700 dark:text-brand-400"
              : "text-text-tertiary hover:text-text-secondary hover:bg-surface-2"
          )}
        >
          Show Zero Stock
        </button>
        <ExportButton onClick={handleExport} />
      </div>

      {totalItems === 0 ? (
        <EmptyState title="No items in stock" description="Add items with stock tracking enabled to see them here." />
      ) : (
        <div className="bg-surface rounded-2xl border border-border overflow-hidden">
          <div className="max-h-[calc(100vh-280px)] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-border bg-surface-2 backdrop-blur-sm">
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Item</th>
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary hidden md:table-cell">Category</th>
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary hidden lg:table-cell">HSN / Unit</th>
                <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Stock</th>
                <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary hidden md:table-cell">Purchase Price</th>
                <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary hidden md:table-cell">Sale Price</th>
                <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Stock Value</th>
              </tr>
            </thead>
            <tbody>
              {/* Simple (non-variant) items */}
              {data.simpleItems.map((item) => (
                <tr
                  key={item.itemId}
                  className={cn(
                    "border-b border-border/40 hover:bg-surface-2/40 transition-colors",
                    item.isLowStock && "bg-amber-50/40 dark:bg-amber-950/20"
                  )}
                >
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <p className="text-text-primary text-[13px] font-medium">{item.itemName}</p>
                      {item.isLowStock && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300 shrink-0">
                          Low
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 hidden md:table-cell">
                    <span className="text-text-secondary text-[12px]">{item.category ?? "—"}</span>
                  </td>
                  <td className="px-4 py-2.5 hidden lg:table-cell">
                    <span className="text-text-tertiary text-[12px] font-mono">{item.hsn ?? "—"}</span>
                    {item.unit && <span className="text-text-tertiary text-[11px] ml-1">/ {item.unit}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <span className={cn(
                      "text-[13px] font-medium tabular-nums",
                      item.isLowStock ? "text-amber-600 dark:text-amber-400" : "text-text-primary"
                    )}>
                      {item.currentStock}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right hidden md:table-cell">
                    <span className="text-text-secondary text-[13px] tabular-nums">
                      {item.purchasePrice ? formatCurrency(item.purchasePrice) : "—"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right hidden md:table-cell">
                    <span className="text-text-secondary text-[13px] tabular-nums">
                      {item.salePrice ? formatCurrency(item.salePrice) : "—"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <span className="text-text-primary text-[13px] font-medium tabular-nums">
                      {formatCurrency(item.stockValue)}
                    </span>
                  </td>
                </tr>
              ))}

              {/* Variant items — collapsible parent + child rows */}
              {data.variantItems.map((item) => {
                const isExpanded = expandedVariants.has(item.itemId);
                const hasLowStock = item.variantDetails.some((v) => v.isLowStock);
                return (
                  <Fragment key={item.itemId}>
                    {/* Parent summary row */}
                    <tr
                      key={item.itemId}
                      onClick={() => toggleVariant(item.itemId)}
                      className={cn(
                        "border-b border-border/40 hover:bg-surface-2/40 transition-colors cursor-pointer select-none",
                        hasLowStock && "bg-amber-50/40 dark:bg-amber-950/20"
                      )}
                    >
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <Icon
                            icon={ArrowRight01Icon}
                            size={14}
                            className={cn("text-text-tertiary transition-transform", isExpanded && "rotate-90")}
                          />
                          <p className="text-text-primary text-[13px] font-medium">{item.itemName}</p>
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-surface-2 text-text-tertiary shrink-0">
                            {item.variantDetails.length} variants
                          </span>
                          {hasLowStock && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300 shrink-0">
                              Low
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 hidden md:table-cell">
                        <span className="text-text-secondary text-[12px]">{item.category ?? "—"}</span>
                      </td>
                      <td className="px-4 py-2.5 hidden lg:table-cell">
                        <span className="text-text-tertiary text-[12px] font-mono">{item.hsn ?? "—"}</span>
                        {item.unit && <span className="text-text-tertiary text-[11px] ml-1">/ {item.unit}</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <span className={cn(
                          "text-[13px] font-medium tabular-nums",
                          hasLowStock ? "text-amber-600 dark:text-amber-400" : "text-text-primary"
                        )}>
                          {item.totalStock}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right hidden md:table-cell">
                        <span className="text-text-tertiary text-[12px]">—</span>
                      </td>
                      <td className="px-4 py-2.5 text-right hidden md:table-cell">
                        <span className="text-text-tertiary text-[12px]">—</span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <span className="text-text-primary text-[13px] font-medium tabular-nums">
                          {formatCurrency(item.totalValue)}
                        </span>
                      </td>
                    </tr>

                    {/* Variant child rows, visible when expanded */}
                    {isExpanded && item.variantDetails.map((variant, vi) => (
                      <tr
                        key={`${item.itemId}-v${vi}`}
                        className={cn(
                          "border-b border-border/30 transition-colors",
                          variant.isLowStock
                            ? "bg-amber-50/60 dark:bg-amber-950/30 hover:bg-amber-50/80"
                            : "bg-surface-2/20 hover:bg-surface-2/50"
                        )}
                      >
                        <td className="pl-10 pr-4 py-2">
                          <div className="flex items-center gap-2">
                            {variant.sku ? (
                              <span className="text-text-secondary text-[12px] font-mono">{variant.sku}</span>
                            ) : (
                              <span className="text-text-secondary text-[12px]">{formatAttributes(variant.attributes)}</span>
                            )}
                            {variant.sku && variant.attributes && (
                              <span className="text-text-tertiary text-[11px]">{formatAttributes(variant.attributes)}</span>
                            )}
                            {variant.isLowStock && (
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300 shrink-0">
                                Low
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2 hidden md:table-cell" />
                        <td className="px-4 py-2 hidden lg:table-cell" />
                        <td className="px-4 py-2 text-right">
                          <span className={cn(
                            "text-[12px] tabular-nums",
                            variant.isLowStock ? "text-amber-600 dark:text-amber-400 font-medium" : "text-text-secondary"
                          )}>
                            {variant.stock}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right hidden md:table-cell">
                          <span className="text-text-tertiary text-[12px] tabular-nums">
                            {variant.purchasePrice ? formatCurrency(variant.purchasePrice) : "—"}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right hidden md:table-cell">
                          <span className="text-text-tertiary text-[12px] tabular-nums">
                            {variant.salePrice ? formatCurrency(variant.salePrice) : "—"}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right">
                          <span className="text-text-secondary text-[12px] tabular-nums">
                            {formatCurrency(variant.value)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Type shapes for payment summary ─────────────────────────────

interface PaymentByMode {
  mode: string;
  bankAccountId: string | null;
  bankAccountName: string | null;
  count: number;
  totalAmount: string;
  customerPayments: string;
  supplierPayments: string;
}

interface ExpenseByMode {
  mode: string;
  count: number;
  totalAmount: string;
}

interface RecentPayment {
  id: string;
  paymentNumber: string | null;
  date: string;
  partyName: string;
  partyType: string;
  amount: string;
  mode: string;
}

interface PaymentSummaryData {
  byMode: PaymentByMode[];
  expenses: ExpenseByMode[];
  recentPayments: RecentPayment[];
  summary: {
    totalReceived: string;
    totalMade: string;
    totalExpenses: string;
    netCashMovement: string;
  };
}

// ── Type shapes for tax summary ──────────────────────────────────

interface TaxBreakdownRow {
  invoiceType: string;
  taxPercent: string;
  invoiceCount: number;
  taxableAmount: string;
  taxAmount: string;
  grossAmount: string;
}

interface TaxSummaryData {
  salesBreakdown: TaxBreakdownRow[];
  purchaseBreakdown: TaxBreakdownRow[];
  summary: {
    totalTaxCollected: string;
    totalTaxPaid: string;
    netTaxLiability: string;
  };
}

// ── Type shapes for item-wise sales ─────────────────────────────

interface ItemSalesRow {
  itemId: string | null;
  itemName: string;
  category: string | null;
  unit: string | null;
  soldQty: string;
  /** Given free on top of what was sold ("10 + 1"), in base units. */
  freeQty?: string | null;
  totalRevenue: string;
  avgUnitPrice: string | null;
  invoiceCount: number;
  uniqueCustomers: number;
  estimatedCost: string;
  grossMarginPct: string | null;
  previous: ItemSalesRow | null;
  revenueChange: string | null;
}

interface ItemSalesData {
  rows: ItemSalesRow[];
  totalRevenue: string;
  count: number;
}

// ── Shared loading / error / export helpers ───────────────────────

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <Spinner size="md" className="text-brand-600" />
    </div>
  );
}

function ReportError({ title }: { title: string }) {
  return (
    <EmptyState
      icon={
        <Icon icon={Alert02Icon} size={20} className="text-text-tertiary" />
      }
      title={title}
      description="The report could not be loaded. Try again or check the backend."
    />
  );
}

function ExportButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="btn-secondary text-xs px-3 py-1.5 inline-flex items-center gap-1.5 ml-auto shrink-0"
    >
      <Icon icon={Download04Icon} size={14} />
      Download CSV
    </button>
  );
}

function FilterTabs<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
            value === opt.value
              ? "bg-brand-600/[0.1] text-brand-700 dark:text-brand-400"
              : "text-text-tertiary hover:text-text-secondary hover:bg-surface-2"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ── Payment Summary Report ───────────────────────────────────────

function PaymentSummaryReport({
  fromDate,
  toDate,
}: {
  fromDate?: string;
  toDate?: string;
}) {
  const [type, setType] = useState<"both" | "received" | "made">("both");

  const { data, isLoading, error } = (trpc as any).reports.paymentSummary.useQuery(
    { fromDate: fromDate || new Date().toISOString(), toDate: toDate || new Date().toISOString(), type },
    { enabled: true }
  ) as { data: PaymentSummaryData | undefined; isLoading: boolean; error: unknown };

  function handleExport() {
    if (!data) return;
    const headers = ["Date", "Payment #", "Party", "Type", "Amount", "Mode"];
    const rows: (string | number)[][] = data.recentPayments.map((p) => [
      formatDate(p.date),
      p.paymentNumber ?? "",
      p.partyName,
      p.partyType === "customer" ? "Received" : "Made",
      p.amount,
      p.mode,
    ]);
    downloadCSV("payment-summary", headers, rows);
  }

  if (isLoading) return <LoadingSpinner />;
  if (error || !data) return <ReportError title="Could not load payment summary" />;

  const netPositive = parseFloat(data.summary.netCashMovement) >= 0;

  return (
    <div>
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <SummaryCard label="Total Received" value={formatCurrency(data.summary.totalReceived)} accent="green" />
        <SummaryCard label="Total Made" value={formatCurrency(data.summary.totalMade)} accent="red" />
        <SummaryCard label="Total Expenses" value={formatCurrency(data.summary.totalExpenses)} />
        <SummaryCard
          label="Net Cash Movement"
          value={formatCurrency(data.summary.netCashMovement)}
          accent={netPositive ? "green" : "red"}
        />
      </div>

      {/* By Payment Mode mini-table */}
      {data.byMode.length > 0 && (
        <div className="mb-5">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary mb-2">
            By Payment Mode
          </h3>
          <div className="bg-surface rounded-xl border border-border overflow-hidden">
            <div className="max-h-[calc(100vh-280px)] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-border bg-surface-2 backdrop-blur-sm">
                  <th className="text-left px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Mode</th>
                  <th className="text-left px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary hidden md:table-cell">Account</th>
                  <th className="text-right px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Count</th>
                  <th className="text-right px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.byMode.map((row, i) => (
                  <tr key={i} className="border-b border-border/40 last:border-0 hover:bg-surface-2/40 transition-colors">
                    <td className="px-4 py-2.5">
                      <span className="text-text-primary text-[13px]">{paymentModeLabel(row.mode)}</span>
                    </td>
                    <td className="px-4 py-2.5 hidden md:table-cell">
                      <span className="text-text-tertiary text-[12px]">{row.bankAccountName ?? "—"}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className="text-text-secondary text-[13px] tabular-nums">{row.count}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className="text-text-primary text-[13px] font-medium tabular-nums">{formatCurrency(row.totalAmount)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        </div>
      )}

      {/* Filters + Export */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <FilterTabs
          options={[
            { value: "both" as const, label: "All" },
            { value: "received" as const, label: "Received" },
            { value: "made" as const, label: "Made" },
          ]}
          value={type}
          onChange={setType}
        />
        <ExportButton onClick={handleExport} />
      </div>

      {/* Recent payments table */}
      {data.recentPayments.length === 0 ? (
        <EmptyState title="No payments in this period" description="Try selecting a wider date range." />
      ) : (
        <div className="bg-surface rounded-2xl border border-border overflow-hidden">
          <div className="max-h-[calc(100vh-280px)] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-border bg-surface-2 backdrop-blur-sm">
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Date</th>
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary hidden md:table-cell">Payment #</th>
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Party</th>
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary hidden lg:table-cell">Type</th>
                <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Amount</th>
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary hidden md:table-cell">Mode</th>
              </tr>
            </thead>
            <tbody>
              {data.recentPayments.map((pmt) => (
                <tr key={pmt.id} className="border-b border-border/40 hover:bg-surface-2/40 transition-colors">
                  <td className="px-4 py-2.5">
                    <span className="text-text-secondary text-[12px]">{formatDate(pmt.date)}</span>
                  </td>
                  <td className="px-4 py-2.5 hidden md:table-cell">
                    <span className="text-text-tertiary text-[12px] font-mono">{pmt.paymentNumber ?? "—"}</span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="text-text-primary text-[13px]">{pmt.partyName}</span>
                  </td>
                  <td className="px-4 py-2.5 hidden lg:table-cell">
                    <span
                      className={cn(
                        "text-[11px] font-medium px-2 py-0.5 rounded-full",
                        pmt.partyType === "customer"
                          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                          : "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400",
                      )}
                    >
                      {pmt.partyType === "customer" ? "Received" : "Made"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <span
                      className={cn(
                        "text-[13px] font-semibold tabular-nums",
                        pmt.partyType === "customer"
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-red-600 dark:text-red-400",
                      )}
                    >
                      {formatCurrency(pmt.amount)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 hidden md:table-cell">
                    <span className="text-text-tertiary text-[12px] capitalize">{pmt.mode}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tax Summary Report ───────────────────────────────────────────

function TaxSummaryReport({
  fromDate,
  toDate,
}: {
  fromDate?: string;
  toDate?: string;
}) {
  const [type, setType] = useState<"both" | "sales" | "purchases">("both");

  const { data, isLoading, error } = (trpc as any).reports.taxSummary.useQuery(
    { fromDate: fromDate || new Date().toISOString(), toDate: toDate || new Date().toISOString(), type },
    { enabled: true }
  ) as { data: TaxSummaryData | undefined; isLoading: boolean; error: unknown };

  function handleExport() {
    if (!data) return;
    const headers = ["Section", "Tax %", "Invoice Count", "Taxable Amount", "Tax Amount", "Gross Amount"];
    const rows: (string | number)[][] = [
      ...data.salesBreakdown.map((r) => [
        "Sales",
        r.taxPercent,
        r.invoiceCount,
        r.taxableAmount,
        r.taxAmount,
        r.grossAmount,
      ]),
      ...data.purchaseBreakdown.map((r) => [
        "Purchases",
        r.taxPercent,
        r.invoiceCount,
        r.taxableAmount,
        r.taxAmount,
        r.grossAmount,
      ]),
    ];
    downloadCSV("tax-summary", headers, rows);
  }

  if (isLoading) return <LoadingSpinner />;
  if (error || !data) return <ReportError title="Could not load tax summary" />;

  const netLiability = parseFloat(data.summary.netTaxLiability);

  function TaxTable({ rows, title }: { rows: TaxBreakdownRow[]; title: string }) {
    if (rows.length === 0) return null;
    return (
      <div className="mb-5">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary mb-2">{title}</h3>
        <div className="bg-surface rounded-xl border border-border overflow-hidden">
          <div className="max-h-[calc(100vh-280px)] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-border bg-surface-2 backdrop-blur-sm">
                <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Tax %</th>
                <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary hidden md:table-cell">Invoices</th>
                <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Taxable Amt</th>
                <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Tax Amt</th>
                <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary hidden lg:table-cell">Gross Amt</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-b border-border/40 last:border-0 hover:bg-surface-2/40 transition-colors">
                  <td className="px-4 py-2.5 text-right">
                    <span className="text-text-primary text-[13px] font-medium tabular-nums">{row.taxPercent}%</span>
                  </td>
                  <td className="px-4 py-2.5 text-right hidden md:table-cell">
                    <span className="text-text-secondary text-[13px] tabular-nums">{row.invoiceCount}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <span className="text-text-secondary text-[13px] tabular-nums">{formatCurrency(row.taxableAmount)}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <span className="text-text-primary text-[13px] font-semibold tabular-nums">{formatCurrency(row.taxAmount)}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right hidden lg:table-cell">
                    <span className="text-text-secondary text-[13px] tabular-nums">{formatCurrency(row.grossAmount)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      </div>
    );
  }

  const noData =
    (type === "sales" && data.salesBreakdown.length === 0) ||
    (type === "purchases" && data.purchaseBreakdown.length === 0) ||
    (type === "both" && data.salesBreakdown.length === 0 && data.purchaseBreakdown.length === 0);

  return (
    <div>
      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
        <SummaryCard
          label="Tax Collected (Output)"
          value={formatCurrency(data.summary.totalTaxCollected)}
          accent="red"
        />
        <SummaryCard label="Tax Paid (Input)" value={formatCurrency(data.summary.totalTaxPaid)} accent="green" />
        <SummaryCard
          label="Net Tax Liability"
          value={formatCurrency(data.summary.netTaxLiability)}
          accent={netLiability <= 0 ? "green" : "red"}
        />
      </div>

      {/* Filters + Export */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <FilterTabs
          options={[
            { value: "both" as const, label: "Both" },
            { value: "sales" as const, label: "Sales" },
            { value: "purchases" as const, label: "Purchases" },
          ]}
          value={type}
          onChange={setType}
        />
        <ExportButton onClick={handleExport} />
      </div>

      {noData ? (
        <EmptyState title="No tax data in this period" description="Try selecting a wider date range." />
      ) : (
        <>
          {(type === "both" || type === "sales") && (
            <TaxTable rows={data.salesBreakdown} title="Sales Tax Breakdown" />
          )}
          {(type === "both" || type === "purchases") && (
            <TaxTable rows={data.purchaseBreakdown} title="Purchase Tax Breakdown" />
          )}
        </>
      )}
    </div>
  );
}

// ── Item-wise Sales Report ───────────────────────────────────────

function ItemSalesReport({
  fromDate,
  toDate,
}: {
  fromDate?: string;
  toDate?: string;
}) {
  const [sortBy, setSortBy] = useState<"revenue" | "quantity" | "invoices" | "margin">("revenue");
  const [compareToPrevious, setCompareToPrevious] = useState(false);

  const { data, isLoading, error } = (trpc as any).reports.itemSales.useQuery(
    { fromDate: fromDate || new Date().toISOString(), toDate: toDate || new Date().toISOString(), sortBy, compareToPrevious },
    { enabled: true }
  ) as { data: ItemSalesData | undefined; isLoading: boolean; error: unknown };

  function handleExport() {
    if (!data) return;
    const headers = [
      "Item",
      "Category",
      "Unit",
      "Qty Sold",
      "Free Qty",
      "Revenue",
      "Avg Price",
      "Invoices",
      "Customers",
      "Margin %",
      ...(compareToPrevious ? ["Revenue Change %"] : []),
    ];
    const rows: (string | number)[][] = data.rows.map((r) => [
      r.itemName,
      r.category ?? "",
      r.unit ?? "",
      r.soldQty,
      r.freeQty ?? "0",
      r.totalRevenue,
      r.avgUnitPrice ?? "",
      r.invoiceCount,
      r.uniqueCustomers,
      r.grossMarginPct ?? "",
      ...(compareToPrevious ? [r.revenueChange ?? ""] : []),
    ]);
    downloadCSV("item-wise-sales", headers, rows);
  }

  if (isLoading) return <LoadingSpinner />;
  if (error || !data) return <ReportError title="Could not load item-wise sales" />;

  return (
    <div>
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
        <SummaryCard label="Total Revenue" value={formatCurrency(data.totalRevenue)} accent="green" />
        <SummaryCard label="Items" value={String(data.count)} />
        {compareToPrevious && <SummaryCard label="Comparison Period" value="Enabled" accent="blue" />}
      </div>

      {/* Controls + Export */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-text-tertiary font-medium uppercase tracking-wider shrink-0">Sort by</span>
          <Select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="text-xs text-text-primary bg-surface-2 border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            <option value="revenue">Revenue</option>
            <option value="quantity">Quantity</option>
            <option value="invoices">Invoices</option>
            <option value="margin">Margin</option>
          </Select>
        </div>
        <button
          onClick={() => setCompareToPrevious((v) => !v)}
          className={cn(
            "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
            compareToPrevious
              ? "bg-brand-600/[0.1] text-brand-700 dark:text-brand-400"
              : "text-text-tertiary hover:text-text-secondary hover:bg-surface-2",
          )}
        >
          Compare to previous period
        </button>
        <ExportButton onClick={handleExport} />
      </div>

      {data.rows.length === 0 ? (
        <EmptyState title="No sales data in this period" description="Try selecting a wider date range." />
      ) : (
        <div className="bg-surface rounded-2xl border border-border overflow-hidden">
          <div className="max-h-[calc(100vh-280px)] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-border bg-surface-2 backdrop-blur-sm">
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Item</th>
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary hidden md:table-cell">Category</th>
                <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Qty Sold</th>
                <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Revenue</th>
                <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary hidden lg:table-cell">Avg Price</th>
                <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary hidden md:table-cell">Invoices</th>
                <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary hidden lg:table-cell">Customers</th>
                <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Margin %</th>
                {compareToPrevious && (
                  <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Change</th>
                )}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => {
                const change = row.revenueChange !== null ? parseFloat(row.revenueChange) : null;
                const margin = row.grossMarginPct !== null ? parseFloat(row.grossMarginPct) : null;
                return (
                  <tr
                    key={row.itemId ?? row.itemName}
                    className="border-b border-border/40 hover:bg-surface-2/40 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <p className="text-text-primary text-[13px] font-medium">{row.itemName}</p>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className="text-text-tertiary text-[12px]">{row.category ?? "—"}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-text-secondary text-[13px] tabular-nums">
                        {parseFloat(parseFloat(row.soldQty).toFixed(2))}
                        {row.unit ? ` ${row.unit}` : ""}
                      </span>
                      {parseFloat(row.freeQty ?? "0") > 0 && (
                        <span className="block text-[11px] text-text-tertiary tabular-nums">
                          + {parseFloat(parseFloat(row.freeQty!).toFixed(2))} free
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-text-primary text-[13px] font-semibold tabular-nums">
                        {formatCurrency(row.totalRevenue)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right hidden lg:table-cell">
                      <span className="text-text-secondary text-[13px] tabular-nums">
                        {row.avgUnitPrice ? formatCurrency(row.avgUnitPrice) : "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right hidden md:table-cell">
                      <span className="text-text-secondary text-[13px] tabular-nums">{row.invoiceCount}</span>
                    </td>
                    <td className="px-4 py-3 text-right hidden lg:table-cell">
                      <span className="text-text-secondary text-[13px] tabular-nums">{row.uniqueCustomers}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {margin !== null ? (
                        <span
                          className={cn(
                            "text-[13px] font-medium tabular-nums",
                            margin >= 30
                              ? "text-emerald-600 dark:text-emerald-400"
                              : margin >= 10
                                ? "text-text-primary"
                                : "text-red-600 dark:text-red-400",
                          )}
                        >
                          {margin.toFixed(1)}%
                        </span>
                      ) : (
                        <span className="text-text-tertiary text-[13px]">—</span>
                      )}
                    </td>
                    {compareToPrevious && (
                      <td className="px-4 py-3 text-right">
                        {change !== null ? (
                          <span
                            className={cn(
                              "inline-flex items-center gap-0.5 text-[11px] font-semibold px-1.5 py-0.5 rounded-full tabular-nums",
                              change >= 0
                                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                                : "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400",
                            )}
                          >
                            {change >= 0 ? "+" : ""}
                            {change.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-text-tertiary text-[12px]">—</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Placeholder for unimplemented reports ────────────────────────

function PlaceholderReport({ report }: { report: ReportDef }) {
  return (
    <EmptyState
      icon={
        <Icon icon={Analytics01Icon} size={20} className="text-text-tertiary" />
      }
      title={`${report.label} — Coming Soon`}
      description={report.description}
      encouragement="This report will be available once the backend router is deployed."
    />
  );
}

// ── Summary card ─────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "red" | "green" | "blue";
}) {
  const valueColor =
    accent === "red" ? "text-red-600 dark:text-red-400" :
    accent === "green" ? "text-emerald-600 dark:text-emerald-400" :
    accent === "blue" ? "text-brand-700 dark:text-brand-400" :
    undefined;
  return <StatCard size="lg" label={label} value={value} valueColor={valueColor} />;
}

// ── Collection Efficiency Report ────────────────────────────────

interface CollectionEfficiencyData {
  collectionEfficiency: {
    totalInvoices: number;
    paidOnTime: number;
    paidLate: number;
    onTimeRate: string;
  };
  dso: {
    dsoDays: string | null;
    totalSales: string;
    avgReceivable: string;
    daysInPeriod: number;
    isHealthy: boolean | null;
    isWarning: boolean | null;
  };
}

function CollectionEfficiencyReport({
  fromDate,
  toDate,
}: {
  fromDate?: string;
  toDate?: string;
}) {
  const { data, isLoading, error } = (trpc as any).reports.collectionEfficiency.useQuery(
    { fromDate, toDate },
    { enabled: true }
  ) as { data: CollectionEfficiencyData | undefined; isLoading: boolean; error: unknown };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner size="md" className="text-brand-600" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <EmptyState
        icon={
          <Icon icon={Alert02Icon} size={20} className="text-text-tertiary" />
        }
        title="Could not load collection efficiency"
        description="The reports router may not be available yet. It will appear here once the backend is ready."
      />
    );
  }

  const { collectionEfficiency: eff, dso } = data;
  const onTimeRateNum = parseFloat(eff.onTimeRate);

  const onTimeRateColor = cn(
    "text-4xl font-bold tabular-nums",
    onTimeRateNum >= 80
      ? "text-emerald-600 dark:text-emerald-400"
      : onTimeRateNum >= 60
        ? "text-amber-600 dark:text-amber-400"
        : "text-red-600 dark:text-red-400"
  );

  const dsoDaysNum = dso.dsoDays !== null ? parseFloat(dso.dsoDays) : null;
  const dsoColor = cn(
    "text-4xl font-bold tabular-nums",
    dso.isHealthy
      ? "text-emerald-600 dark:text-emerald-400"
      : dso.isWarning
        ? "text-amber-600 dark:text-amber-400"
        : "text-red-600 dark:text-red-400"
  );

  return (
    <div className="space-y-4">
      {/* Top row: two large metric cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* On-Time Collection Rate */}
        <div className="bg-surface rounded-xl border border-border px-5 py-5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary mb-3">
            On-Time Collection Rate
          </p>
          <p className={onTimeRateColor}>
            {eff.totalInvoices === 0 ? "—" : `${onTimeRateNum.toFixed(1)}%`}
          </p>
          <p className="text-sm text-text-secondary mt-2">
            {eff.paidOnTime} of {eff.totalInvoices} invoices paid on time
          </p>
        </div>

        {/* Days Sales Outstanding */}
        <div className="bg-surface rounded-xl border border-border px-5 py-5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary mb-3">
            Days Sales Outstanding (DSO)
          </p>
          <div className="flex items-baseline gap-2">
            <p className={dsoColor}>
              {dsoDaysNum !== null ? Math.round(dsoDaysNum) : "—"}
            </p>
            {dsoDaysNum !== null && (
              <span className="text-base font-medium text-text-secondary">days</span>
            )}
          </div>
          <p className="text-sm text-text-secondary mt-2">
            Based on {formatCurrency(dso.totalSales)} sales and {formatCurrency(dso.avgReceivable)} avg receivable
          </p>
        </div>
      </div>

      {/* Second row: three stat cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-surface rounded-xl border border-border px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Total Invoices</p>
          <p className="text-xl font-semibold tabular-nums mt-1 text-text-primary">{eff.totalInvoices}</p>
        </div>
        <div className="bg-surface rounded-xl border border-border px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Paid On Time</p>
          <p className="text-xl font-semibold tabular-nums mt-1 text-emerald-600 dark:text-emerald-400">{eff.paidOnTime}</p>
        </div>
        <div className="bg-surface rounded-xl border border-border px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Paid Late</p>
          <p className="text-xl font-semibold tabular-nums mt-1 text-red-600 dark:text-red-400">{eff.paidLate}</p>
        </div>
      </div>

      {/* Third row: DSO details card */}
      <div className="bg-surface rounded-xl border border-border px-5 py-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary mb-3">DSO Details</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-text-tertiary">Period</p>
            <p className="text-sm font-medium text-text-primary mt-0.5">{dso.daysInPeriod} days</p>
          </div>
          <div>
            <p className="text-xs text-text-tertiary">Total Sales</p>
            <p className="text-sm font-medium text-text-primary mt-0.5 tabular-nums">{formatCurrency(dso.totalSales)}</p>
          </div>
          <div>
            <p className="text-xs text-text-tertiary">Avg Receivable</p>
            <p className="text-sm font-medium text-text-primary mt-0.5 tabular-nums">{formatCurrency(dso.avgReceivable)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Cash Flow Statement Report ───────────────────────────────────

interface CashFlowStatementData {
  operating: {
    netIncome: string;
    adjustments: Array<{ description: string; amount: string }>;
    workingCapitalChanges: Array<{ description: string; amount: string }>;
    totalOperating: string;
  };
  investing: {
    items: Array<{ description: string; amount: string }>;
    totalInvesting: string;
  };
  financing: {
    items: Array<{ description: string; amount: string }>;
    totalFinancing: string;
  };
  netCashFlow: string;
  openingCashBalance: string;
  closingCashBalance: string;
}

function cashFlowAmountColor(value: string): string {
  const n = parseFloat(value);
  if (n > 0) return "text-emerald-600 dark:text-emerald-400";
  if (n < 0) return "text-red-600 dark:text-red-400";
  return "text-text-secondary";
}

function CashFlowLineItem({ description, amount }: { description: string; amount: string }) {
  return (
    <div className="flex items-center justify-between px-5 py-2.5 border-b border-border/40 last:border-b-0 hover:bg-surface-2/30 transition-colors">
      <span className="text-[13px] text-text-secondary">{description}</span>
      <span className={cn("text-[13px] font-medium tabular-nums", cashFlowAmountColor(amount))}>
        {formatCurrency(amount)}
      </span>
    </div>
  );
}

function CashFlowSectionTotal({
  label,
  amount,
  highlight,
}: {
  label: string;
  amount: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between px-5 py-3",
        highlight ? "bg-surface-2/60" : "bg-surface-2/40",
      )}
    >
      <span className={cn("text-[13px] font-semibold", highlight ? "text-text-primary" : "text-text-secondary")}>
        {label}
      </span>
      <span className={cn("text-[13px] font-bold tabular-nums", cashFlowAmountColor(amount))}>
        {formatCurrency(amount)}
      </span>
    </div>
  );
}

function CashFlowSection({
  title,
  children,
  total,
  totalLabel,
}: {
  title: string;
  children: React.ReactNode;
  total: string;
  totalLabel: string;
}) {
  return (
    <div className="bg-surface rounded-xl border border-border overflow-hidden">
      <div className="px-5 py-3 border-b border-border bg-surface-2/20">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">{title}</p>
      </div>
      {children}
      <CashFlowSectionTotal label={totalLabel} amount={total} />
    </div>
  );
}

function CashFlowReport({
  fromDate,
  toDate,
}: {
  fromDate?: string;
  toDate?: string;
}) {
  const { data, isLoading, error } = (trpc as any).reports.cashFlowStatement.useQuery(
    { fromDate, toDate },
    { enabled: !!(fromDate && toDate) }
  ) as { data: CashFlowStatementData | undefined; isLoading: boolean; error: unknown };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner size="md" className="text-brand-600" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <EmptyState
        icon={
          <Icon icon={Alert02Icon} size={20} className="text-text-tertiary" />
        }
        title="Could not load cash flow statement"
        description="No transactions found for the selected period, or the backend is not yet available."
      />
    );
  }

  const { operating, investing, financing, netCashFlow, openingCashBalance, closingCashBalance } = data;
  const netCashNum = parseFloat(netCashFlow);

  return (
    <div className="space-y-4">
      {/* Opening / Closing balance summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-surface rounded-xl border border-border px-5 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary mb-2">Opening Balance</p>
          <p className="text-2xl font-bold tabular-nums text-text-primary">{formatCurrency(openingCashBalance)}</p>
          <p className="text-xs text-text-tertiary mt-1">Cash + Bank at period start</p>
        </div>

        <div className={cn(
          "rounded-xl border px-5 py-4",
          netCashNum > 0
            ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800"
            : netCashNum < 0
              ? "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800"
              : "bg-surface border-border"
        )}>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary mb-2">Net Cash Flow</p>
          <p className={cn("text-2xl font-bold tabular-nums", cashFlowAmountColor(netCashFlow))}>
            {formatCurrency(netCashFlow)}
          </p>
          <p className="text-xs text-text-tertiary mt-1">For the selected period</p>
        </div>

        <div className="bg-surface rounded-xl border border-border px-5 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary mb-2">Closing Balance</p>
          <p className="text-2xl font-bold tabular-nums text-text-primary">{formatCurrency(closingCashBalance)}</p>
          <p className="text-xs text-text-tertiary mt-1">Cash + Bank at period end</p>
        </div>
      </div>

      {/* A. Operating Activities */}
      <CashFlowSection
        title="A. Operating Activities"
        total={operating.totalOperating}
        totalLabel="Net Cash from Operating Activities"
      >
        <CashFlowLineItem description="Net Income" amount={operating.netIncome} />
        {operating.adjustments.map((item) => (
          <CashFlowLineItem key={item.description} description={item.description} amount={item.amount} />
        ))}
        {operating.workingCapitalChanges.length > 0 && (
          <div className="px-5 pt-2 pb-0.5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Working Capital Changes</p>
          </div>
        )}
        {operating.workingCapitalChanges.map((item) => (
          <CashFlowLineItem key={item.description} description={item.description} amount={item.amount} />
        ))}
        {operating.adjustments.length === 0 && operating.workingCapitalChanges.length === 0 && (
          <p className="px-5 py-3 text-[13px] text-text-tertiary">No adjustments in this period.</p>
        )}
      </CashFlowSection>

      {/* B. Investing Activities */}
      <CashFlowSection
        title="B. Investing Activities"
        total={investing.totalInvesting}
        totalLabel="Net Cash from Investing Activities"
      >
        {investing.items.length === 0 ? (
          <p className="px-5 py-3 text-[13px] text-text-tertiary">No investing activities in this period.</p>
        ) : (
          investing.items.map((item) => (
            <CashFlowLineItem key={item.description} description={item.description} amount={item.amount} />
          ))
        )}
      </CashFlowSection>

      {/* C. Financing Activities */}
      <CashFlowSection
        title="C. Financing Activities"
        total={financing.totalFinancing}
        totalLabel="Net Cash from Financing Activities"
      >
        {financing.items.length === 0 ? (
          <p className="px-5 py-3 text-[13px] text-text-tertiary">No financing activities in this period.</p>
        ) : (
          financing.items.map((item) => (
            <CashFlowLineItem key={item.description} description={item.description} amount={item.amount} />
          ))
        )}
      </CashFlowSection>

      {/* Net Cash Flow reconciliation */}
      <div className="bg-surface rounded-xl border border-border overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-surface-2/20">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Reconciliation</p>
        </div>
        <CashFlowLineItem description="Opening Cash Balance" amount={openingCashBalance} />
        <CashFlowLineItem description="Net Cash from Operating Activities" amount={operating.totalOperating} />
        <CashFlowLineItem description="Net Cash from Investing Activities" amount={investing.totalInvesting} />
        <CashFlowLineItem description="Net Cash from Financing Activities" amount={financing.totalFinancing} />
        <CashFlowSectionTotal label="Closing Cash Balance" amount={closingCashBalance} highlight />
      </div>
    </div>
  );
}

// ── Sticky-period hint (shows once per session on first tab switch) ──

const HINT_SESSION_KEY = "fintranzact_reports_sticky_hint_shown";

function StickyPeriodHint({ visible }: { visible: boolean }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setShow(true);
    const timer = setTimeout(() => setShow(false), 3500);
    return () => clearTimeout(timer);
  }, [visible]);

  if (!show) return null;

  return (
    <div className="animate-hint-lifecycle text-[11px] text-text-tertiary py-1 flex items-center gap-1.5">
      <Icon icon={InformationCircleIcon} size={12} className="text-brand-600 dark:text-brand-400" />
      <span>Tip: Your date range stays the same across all reports</span>
    </div>
  );
}

// ── Main Reports Page ────────────────────────────────────────────

function ReportsPage() {
  const [activeReport, setActiveReport] = useState<ReportId>(
    () => (localStorage.getItem("fintranzact_reports_tab") as ReportId) || "daybook"
  );
  const [showStickyHint, setShowStickyHint] = useState(false);
  const hasInteracted = useRef(false);

  const selectReport = (id: ReportId) => {
    setActiveReport(id);
    localStorage.setItem("fintranzact_reports_tab", id);

    // Show sticky-period hint on first tab switch (once per session)
    if (!hasInteracted.current && !sessionStorage.getItem(HINT_SESSION_KEY)) {
      hasInteracted.current = true;
      sessionStorage.setItem(HINT_SESSION_KEY, "1");
      setShowStickyHint(true);
    }
  };
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Party statement filter — server-side search so all parties are accessible
  const [partyStatementPartyId, setPartyStatementPartyId] = useState("");

  const { preset, setPreset, customFrom, customTo, setCustomRange, fromDate, toDate } =
    useDateRange("reports", "this-month");


  const currentReport = ALL_REPORTS.find((r) => r.id === activeReport)!;

  function renderReport() {
    switch (activeReport) {
      case "daybook":
        return <DaybookReport fromDate={fromDate} toDate={toDate} />;
      case "sales-register":
        return <SalesRegisterReport fromDate={fromDate} toDate={toDate} />;
      case "purchase-register":
        return <PurchaseRegisterReport fromDate={fromDate} toDate={toDate} />;
      case "outstanding":
        return <OutstandingReport fromDate={fromDate} toDate={toDate} />;
      case "msme-payables":
        return <MsmePayablesReport />;
      case "party-statement":
        return <PartyStatementReport partyId={partyStatementPartyId || null} fromDate={fromDate} toDate={toDate} />;
      case "stock-summary":
        return <StockSummaryReport />;
      case "stock-ledger":
        return <StockLedgerReport fromDate={fromDate} toDate={toDate} />;
      case "stock-movement":
        return <MovementSummaryReport fromDate={fromDate} toDate={toDate} />;
      case "stock-group-summary":
        return <StockGroupSummaryReport toDate={toDate} />;
      case "godown-summary":
        return <GodownSummaryReport />;
      case "batch-stock":
        return <BatchStockReport status="all" />;
      case "expiring-batches":
        return <BatchStockReport status="expiring" />;
      case "expired-stock":
        return <BatchStockReport status="expired" />;
      case "stock-ageing":
        return <StockAgeingReport />;
      case "reorder-status":
        return <ReorderStatusReport />;
      case "dead-stock":
        return <DeadStockReport />;
      case "pending-sales-orders":
        return <PendingSalesOrdersReport />;
      case "pending-purchase-orders":
        return <PendingPurchaseOrdersReport />;
      case "pending-grns":
        return <PendingGrnReport />;
      case "pending-delivery-challans":
        return <PendingDeliveryChallansReport />;
      case "price-list":
        return <PriceListReport asOf={toDate} />;
      case "payment-summary":
        return <PaymentSummaryReport fromDate={fromDate} toDate={toDate} />;
      case "tax-summary":
        return <TaxSummaryReport fromDate={fromDate} toDate={toDate} />;
      case "item-wise-sales":
        return <ItemSalesReport fromDate={fromDate} toDate={toDate} />;
      case "collection-metrics":
        return <CollectionEfficiencyReport fromDate={fromDate} toDate={toDate} />;
      case "cash-flow":
        return <CashFlowReport fromDate={fromDate} toDate={toDate} />;
      default:
        return <PlaceholderReport report={currentReport} />;
    }
  }


  return (
    <div className="flex gap-0 -mx-6 -my-6 min-h-[calc(100vh-56px)]">
      {/* Sidebar overlay (mobile) */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Report navigation sidebar */}
      <aside
        className={cn(
          "w-56 shrink-0 border-r border-border bg-surface-0 flex flex-col overflow-y-auto",
          "fixed inset-y-0 left-0 z-40 transition-transform duration-200 lg:relative lg:translate-x-0 lg:inset-auto lg:z-auto",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="px-4 py-4 border-b border-border shrink-0">
          <h2 className="text-[13px] font-semibold text-text-primary">Reports</h2>
          <p className="text-[11px] text-text-tertiary mt-0.5">Select a report to view</p>
        </div>

        <nav className="flex-1 py-2">
          {REPORT_GROUPS.map((group) => (
            <div key={group.label} className="mb-1">
              <p className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
                {group.label}
              </p>
              {group.reports.map((report) => (
                <button
                  key={report.id}
                  onClick={() => {
                    selectReport(report.id);
                    setSidebarOpen(false);
                  }}
                  className={cn(
                    "w-full text-left flex items-center gap-2 mx-2 px-3 py-[7px] rounded-lg text-[13px] transition-colors",
                    activeReport === report.id
                      ? "bg-brand-600/10 text-brand-700 dark:text-brand-400 font-medium"
                      : "text-text-secondary hover:bg-surface-2 hover:text-text-primary"
                  )}
                  style={{ width: "calc(100% - 1rem)" }}
                >
                  {report.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        {/* Top bar: title + date filters */}
        <div className="sticky top-0 z-20 bg-surface-1 border-b border-border px-6 py-4 shrink-0">
          <div className="flex items-start gap-3 mb-3">
            {/* Mobile: hamburger to open report sidebar */}
            <button
              className="lg:hidden flex items-center justify-center w-8 h-8 rounded-lg text-text-secondary hover:bg-surface-2 transition-colors border border-border shrink-0 mt-0.5"
              onClick={() => setSidebarOpen(true)}
              aria-label="Select report"
            >
              <Icon icon={Menu01Icon} size={16} />
            </button>

            <div className="flex-1 min-w-0">
              <h1 className={PAGE_TITLE_CLASS}>{currentReport.label}</h1>
              <p className="text-sm text-text-tertiary mt-0.5">{currentReport.description}</p>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <DateRangeBar
              preset={preset}
              onPresetChange={setPreset}
              customFrom={customFrom}
              customTo={customTo}
              onCustomChange={setCustomRange}
            />

            <StickyPeriodHint visible={showStickyHint} />

            {/* Party selector for Party Statement */}
            {activeReport === "party-statement" && (
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-text-tertiary shrink-0">Party:</span>
                <div className="w-64">
                  <PartyCombobox
                    value={partyStatementPartyId}
                    onChange={setPartyStatementPartyId}
                    label=""
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Report content */}
        <div className="flex-1 px-6 py-6">
          {renderReport()}
        </div>
      </div>
    </div>
  );
}
