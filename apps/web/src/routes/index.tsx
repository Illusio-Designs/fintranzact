import { useEffect, useState, useTransition } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { trpc, getBusinessId } from "@/lib/trpc";
import { formatCurrency, cn, formatDateShort, formatMonthYearShort } from "@/lib/utils";
import { StatCard } from "@/components/ui/StatCard";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { PillTabs } from "@/components/ui/Tabs";
import { DateRangeBar } from "@/components/ui/DateRangeBar";
import { useDateRange, getGranularity } from "@/hooks/useDateRange";
import { Icon, IconCircle, type IconCircleTone, type IconSvgElement } from "@/components/ui/Icon";
import { WidgetHeader } from "@/components/ui/WidgetHeader";
import { Alert02Icon, Analytics01Icon, ArrowDown01Icon, ArrowUp01Icon, Award01Icon, Cancel01Icon, ChartBarLineIcon, ChartDecreaseIcon, ChartIncreaseIcon, ChartLineData01Icon, Coins01Icon, CreditCardIcon, FireIcon, Invoice01Icon, Invoice03Icon, MoneyReceive01Icon, MoneySend01Icon, PackageIcon, PieChartIcon, SproutIcon, Rocket01Icon, ShoppingCart01Icon, StarIcon, Target02Icon, UserGroupIcon, Wallet01Icon } from "@hugeicons/core-free-icons";

// ─── Milestone banner ─────────────────────────────────────────────────────────

const MILESTONES: Array<{ count: number; message: string }> = [
  { count: 1, message: "Your first invoice — the beginning of something great." },
  { count: 10, message: "10 invoices created. You're in the rhythm now." },
  { count: 50, message: "50 invoices and counting. Solid momentum." },
  { count: 100, message: "100 invoices. Your business is moving." },
  { count: 250, message: "250 invoices. That's impressive consistency." },
  { count: 500, message: "500 invoices. You're running a real operation." },
];

const SALES_MILESTONES: Array<{ amount: number; message: string }> = [
  { amount: 100000, message: "First \u20b91 lakh in sales — well done." },
  { amount: 500000, message: "\u20b95 lakhs in sales. You're building something." },
  { amount: 1000000, message: "\u20b910 lakhs in sales. Keep going." },
  { amount: 5000000, message: "\u20b950 lakhs in sales. Remarkable progress." },
  { amount: 10000000, message: "\u20b91 crore in sales. That's a milestone worth marking." },
];

function getMilestoneKey(businessId: string, type: "invoices" | "sales", value: number) {
  return `hisaabo_milestone_${businessId}_${type}_${value}`;
}

function checkMilestone(
  businessId: string,
  totalInvoices: number,
  totalSales: number
): { message: string; key: string } | null {
  // Check invoice count milestones (highest crossed, not yet dismissed)
  for (let i = MILESTONES.length - 1; i >= 0; i--) {
    const m = MILESTONES[i];
    if (totalInvoices >= m.count) {
      const key = getMilestoneKey(businessId, "invoices", m.count);
      if (!localStorage.getItem(key)) {
        return { message: m.message, key };
      }
      break; // only show highest uncelebrated milestone
    }
  }

  // Check sales amount milestones
  for (let i = SALES_MILESTONES.length - 1; i >= 0; i--) {
    const m = SALES_MILESTONES[i];
    if (totalSales >= m.amount) {
      const key = getMilestoneKey(businessId, "sales", m.amount);
      if (!localStorage.getItem(key)) {
        return { message: m.message, key };
      }
      break;
    }
  }

  return null;
}

function MilestoneBanner({
  message,
  milestoneKey,
}: {
  message: string;
  milestoneKey: string;
}) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  function dismiss() {
    localStorage.setItem(milestoneKey, "1");
    setDismissed(true);
  }

  return (
    <div className="mb-4 animate-milestone-enter">
      <div className="px-4 py-3 rounded-xl border border-brand-200 bg-brand-50 dark:bg-brand-950/20 dark:border-brand-800/50 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <IconCircle icon={Award01Icon} tone="solid" size="sm" />
          <p className="text-sm text-brand-700 dark:text-brand-300">{message}</p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 p-1.5 rounded-full text-brand-500 hover:text-brand-700 hover:bg-brand-100 dark:hover:bg-brand-900/40 transition-colors"
          aria-label="Dismiss"
        >
          <Icon icon={Cancel01Icon} size={16} />
        </button>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/")({
  component: DashboardPage,
});

// ─── Sales target types (mirrors target.myTargets API shape) ─────────────────

interface TargetProgressData {
  current: number;
  target: number;
  percentage: number;
  remaining: number;
  unit: string;
  onTrack: boolean;
  daysTotal: number;
  daysElapsed: number;
  daysRemaining: number;
}

interface TargetProgress {
  id: string;
  targetType: string; // "order_count" | "order_value" | "item_quantity"
  targetValue: string;
  itemId?: string | null;
  periodEnd: string | Date;
  notes?: string | null;
  progress: TargetProgressData;
  // itemName is not yet returned by the API but will be present when available
  itemName?: string;
}

// ─── Target helpers ───────────────────────────────────────────────────────────

function getDaysRemaining(periodEnd: string | Date): number {
  const end = new Date(periodEnd);
  const now = new Date();
  const diff = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(0, diff);
}

function getTargetLabel(t: TargetProgress): string {
  if (t.targetType === "order_value") return "Sales Value";
  if (t.targetType === "order_count") return "Orders";
  return t.itemName ? `${t.itemName} (qty)` : "Item Quantity";
}

function formatTargetValue(t: TargetProgress, val: number): string {
  if (t.targetType === "order_value") {
    // Compact Indian number format
    if (val >= 10_00_000) return `\u20b9${(val / 10_00_000).toFixed(1)}Cr`;
    if (val >= 1_00_000) return `\u20b9${(val / 1_00_000).toFixed(1)}L`;
    if (val >= 1_000) return `\u20b9${(val / 1_000).toFixed(0)}K`;
    return `\u20b9${val.toFixed(0)}`;
  }
  return String(Math.round(val));
}

type TargetTier = "seed" | "growing" | "fire" | "close" | "near" | "achieved";

function getTier(pct: number): TargetTier {
  if (pct >= 100) return "achieved";
  if (pct >= 90) return "near";
  if (pct >= 75) return "close";
  if (pct >= 50) return "fire";
  if (pct >= 25) return "growing";
  return "seed";
}

const TIER_META: Record<TargetTier, { icon: IconSvgElement; message: string }> = {
  seed: { icon: SproutIcon, message: "Just getting started" },
  growing: { icon: ChartIncreaseIcon, message: "Building momentum" },
  fire: { icon: FireIcon, message: "On fire!" },
  close: { icon: StarIcon, message: "Almost there!" },
  near: { icon: Rocket01Icon, message: "So close!" },
  achieved: { icon: Award01Icon, message: "Target achieved!" },
};

function getBarFillClass(tier: TargetTier): string {
  if (tier === "achieved") return "target-progress-fill--achieved";
  if (tier === "near") return "target-progress-fill--near";
  return "target-progress-fill";
}

function getBarColor(tier: TargetTier): string {
  if (tier === "achieved" || tier === "near") return "bg-emerald-500";
  if (tier === "fire" || tier === "close") return "bg-amber-500";
  return "bg-brand-600";
}

function getMessageColor(tier: TargetTier): string {
  if (tier === "achieved") return "text-emerald-600 dark:text-emerald-400";
  if (tier === "near" || tier === "close") return "text-amber-600 dark:text-amber-400";
  return "text-text-tertiary";
}

function getAchievementKey(targetId: string): string {
  return `target_achieved_${targetId}`;
}

// ─── Achievement banner ───────────────────────────────────────────────────────

function TargetAchievementBanner({ target }: { target: TargetProgress }) {
  const key = getAchievementKey(target.id);
  const [dismissed, setDismissed] = useState(() => !!localStorage.getItem(key));

  if (dismissed) return null;

  function dismiss() {
    localStorage.setItem(key, "1");
    setDismissed(true);
  }

  const targetNum = parseFloat(target.targetValue);
  const formatted = formatTargetValue(target, targetNum);

  return (
    <div className="mb-3 target-achieve-banner">
      <div className="px-4 py-3 rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-800/50 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <IconCircle icon={Award01Icon} tone="success" size="sm" />
          <div>
            <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
              Target Achieved!
            </p>
            <p className="text-xs text-emerald-600/80 dark:text-emerald-400/70 mt-0.5">
              You hit your {getTargetLabel(target)} target of {formatted}. Great work!
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 p-1.5 rounded-full text-emerald-500 hover:text-emerald-700 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors"
          aria-label="Dismiss achievement notification"
        >
          <Icon icon={Cancel01Icon} size={16} />
        </button>
      </div>
    </div>
  );
}

// ─── Single target row ────────────────────────────────────────────────────────

function TargetRow({ target }: { target: TargetProgress }) {
  const { progress } = target;
  const pct = Math.min(progress.percentage, 100);
  const tier = getTier(progress.percentage);
  const meta = TIER_META[tier];
  const daysLeft = progress.daysRemaining ?? getDaysRemaining(target.periodEnd);
  const targetNum = parseFloat(target.targetValue);

  const currentFormatted = formatTargetValue(target, progress.current);
  const targetFormatted = formatTargetValue(target, targetNum);

  const barFillClass = getBarFillClass(tier);
  const barColor = getBarColor(tier);
  const msgColor = getMessageColor(tier);

  return (
    <div>
      {/* Label row */}
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium text-text-primary">
          {getTargetLabel(target)}
        </span>
        <span className="text-[11px] tabular-nums text-text-tertiary">
          {currentFormatted} / {targetFormatted}
        </span>
      </div>

      {/* Progress bar */}
      <div
        className="w-full h-1.5 rounded-full bg-surface-2 overflow-hidden"
        role="progressbar"
        aria-valuenow={Math.round(progress.percentage)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${getTargetLabel(target)}: ${Math.round(progress.percentage)}% complete`}
      >
        <div
          className={cn("h-full rounded-full", barColor, barFillClass)}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Status row */}
      <div className="flex items-center justify-between mt-1">
        <span className="text-[11px] text-text-tertiary">
          {daysLeft === 0 ? "Last day" : `${daysLeft} day${daysLeft === 1 ? "" : "s"} remaining`}
        </span>
        <span className={cn("inline-flex items-center gap-1 text-[11px] font-medium", msgColor)}>
          <Icon icon={meta.icon} size={12} />
          {meta.message}
        </span>
      </div>
    </div>
  );
}

// ─── Target widget ────────────────────────────────────────────────────────────

function TargetsWidget({ targets }: { targets: TargetProgress[] }) {
  if (targets.length === 0) return null;

  // Show achievement banners for newly completed targets (one-time per target)
  const newlyAchieved = targets.filter(
    (t) => t.progress.percentage >= 100 && !localStorage.getItem(getAchievementKey(t.id))
  );

  return (
    <div className="mb-4">
      {/* Achievement banners sit above the widget */}
      {newlyAchieved.map((t) => (
        <TargetAchievementBanner key={t.id} target={t} />
      ))}

      <div className="card px-4 py-4">
        {/* Widget header */}
        <div className="flex items-center gap-2.5 mb-4">
          <IconCircle icon={Target02Icon} size="sm" />
          <h3 className="text-sm font-semibold text-text-primary">Your Targets</h3>
        </div>

        {/* Target rows */}
        <div className="space-y-4">
          {targets.map((t) => (
            <TargetRow key={t.id} target={t} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Period helpers removed — now handled by useDateRange hook ───────────────

// ─── Tooltip style ────────────────────────────────────────────────────────────

const tooltipStyle = {
  contentStyle: {
    background: "var(--surface-0)",
    border: "1px solid var(--border-light)",
    borderRadius: "8px",
    fontSize: "12px",
  },
};

// ─── Colour palettes ──────────────────────────────────────────────────────────

const INVOICE_STATUS_COLORS: Record<string, string> = {
  paid: "#10b981",
  partial: "#f59e0b",
  sent: "#3b5eaa",
  overdue: "#ef4444",
  draft: "#94a3b8",
  cancelled: "#d1d5db",
};

const INVOICE_STATUS_LABELS: Record<string, string> = {
  paid: "Paid",
  partial: "Partial",
  sent: "Unpaid",
  overdue: "Overdue",
  draft: "Draft",
  cancelled: "Cancelled",
};

const EXPENSE_COLORS = [
  "#3b5eaa",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
];

// Recharts ResponsiveContainer types are incompatible with React 19's stricter ReactNode
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderResponsive(children: React.ReactElement, width: string, height: string) {
  return <ResponsiveContainer width={width as any} height={height as any}>{children as any}</ResponsiveContainer>;
}

// ─── Chart card wrapper ───────────────────────────────────────────────────────

function ChartCard({
  title,
  icon,
  height = 260,
  children,
  responsive = true,
}: {
  title: string;
  icon: IconSvgElement;
  height?: number;
  children: React.ReactElement;
  responsive?: boolean;
}) {
  return (
    <div className="card overflow-hidden">
      <WidgetHeader title={title} icon={icon} />
      <div className="px-4 py-4" style={{ height }}>
        {responsive
          ? renderResponsive(children, "100%", "100%")
          : children}
      </div>
    </div>
  );
}

// ─── Charts ───────────────────────────────────────────────────────────────────

function formatPeriodLabel(period: string, granularity: "week" | "month" | "fy"): string {
  if (granularity === "week") {
    const start = new Date(period);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return `${formatDateShort(start)}-${formatDateShort(end)}`;
  }
  if (granularity === "fy") {
    const year = parseInt(period);
    return `FY ${String(year).slice(-2)}-${String(year + 1).slice(-2)}`;
  }
  // month — show "Apr 24", "Mar 25" etc.
  return formatMonthYearShort(period);
}

function SalesTrendChart({
  fromDate,
  toDate,
  granularity,
}: {
  fromDate?: string;
  toDate?: string;
  granularity: "week" | "month" | "fy";
}) {
  const { data: raw } = trpc.dashboard.salesTrend.useQuery({
    fromDate,
    toDate,
    granularity,
  }, { placeholderData: keepPreviousData });

  const mapped = raw?.map((r) => ({
    label: formatPeriodLabel(r.period, granularity),
    invoiced: parseFloat(r.invoiced),
    collected: parseFloat(r.collected),
  }));

  // Show empty state when there are no rows OR all values are zero
  const hasData = mapped && mapped.some((d) => d.invoiced > 0 || d.collected > 0);

  if (!hasData) {
    return (
      <ChartCard title="Sales & Collections" icon={ChartBarLineIcon} responsive={false}>
        <ChartEmpty />
      </ChartCard>
    );
  }

  return (
    <ChartCard title="Sales & Collections" icon={ChartBarLineIcon}>
      <BarChart data={mapped} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: "var(--text-tertiary)" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tickFormatter={(v: number) => `${(v / 100000).toFixed(1)}L`}
          tick={{ fontSize: 11, fill: "var(--text-tertiary)" }}
          axisLine={false}
          tickLine={false}
          width={40}
        />
        <Tooltip
          {...tooltipStyle}
          formatter={(value: any) => formatCurrency(String(value))}
        />
        <Bar dataKey="invoiced" name="Invoiced" fill="#3b5eaa" radius={[3, 3, 0, 0]} maxBarSize={28} />
        <Bar dataKey="collected" name="Collected" fill="#10b981" radius={[3, 3, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ChartCard>
  );
}

function InvoiceStatusChart({ fromDate, toDate }: { fromDate?: string; toDate?: string }) {
  const { data } = trpc.dashboard.invoiceStatusBreakdown.useQuery({
    fromDate,
    toDate,
  }, { placeholderData: keepPreviousData });

  const total = data ? data.reduce((sum, d) => sum + d.count, 0) : 0;

  if (!data || data.length === 0) {
    return (
      <ChartCard title="Invoice Status" icon={Invoice03Icon} responsive={false}>
        <ChartEmpty />
      </ChartCard>
    );
  }

  return (
    <div className="card overflow-hidden">
      <WidgetHeader title="Invoice Status" icon={Invoice03Icon} />
      <div className="px-4 py-4" style={{ height: 260 }}>
        <div className="flex flex-col h-full">
          {/* Donut with center label */}
          <div className="relative flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data.map(d => ({ ...d, label: INVOICE_STATUS_LABELS[d.status] || d.status }))}
                  dataKey="count"
                  nameKey="label"
                  cx="50%"
                  cy="50%"
                  innerRadius={52}
                  outerRadius={76}
                  paddingAngle={2}
                >
                  {data.map((entry) => (
                    <Cell
                      key={entry.status}
                      fill={INVOICE_STATUS_COLORS[entry.status] ?? "#94a3b8"}
                    />
                  ))}
                </Pie>
                <Tooltip
                  {...tooltipStyle}
                  formatter={(value: any, name: any) => [value, name]}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center">
                <span className="block text-lg font-bold tabular-nums text-text-primary">{total}</span>
                <span className="block text-[10px] text-text-tertiary">invoices</span>
              </div>
            </div>
          </div>
          {/* Legend */}
          <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 pb-1">
            {data.map((entry) => (
              <span key={entry.status} className="flex items-center gap-1 text-[11px] text-text-secondary">
                <span
                  className="inline-block rounded-full"
                  style={{
                    width: 8,
                    height: 8,
                    background: INVOICE_STATUS_COLORS[entry.status] ?? "#94a3b8",
                  }}
                />
                {INVOICE_STATUS_LABELS[entry.status] || entry.status} ({entry.count})
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function TopSellingChart({ fromDate, toDate }: { fromDate?: string; toDate?: string }) {
  const [itemType, setItemType] = useState("all");
  const { data: raw } = trpc.dashboard.topSellingItems.useQuery({
    limit: 5,
    itemType: itemType === "all" ? undefined : itemType as "product" | "service",
    fromDate,
    toDate,
  }, { placeholderData: keepPreviousData });

  if (!raw || raw.length === 0) {
    return (
      <div className="card overflow-hidden">
        <WidgetHeader title="Top Selling" icon={PackageIcon}>
          <PillTabs tabs={TOP_SELLING_TABS} value={itemType} onChange={setItemType} size="sm" />
        </WidgetHeader>
        <div className="px-4 py-4" style={{ height: 260 }}>
          <ChartEmpty />
        </div>
      </div>
    );
  }

  const data = raw.map((r) => ({
    name: r.itemName,
    amount: parseFloat(r.totalAmount),
    qty: parseFloat(r.totalQty),
    unit: r.unit || "pcs",
    invoices: r.invoiceCount,
  }));

  const chartData = [...data].reverse(); // bottom-to-top for horizontal bar
  const barColor = itemType === "service" ? "#8b5cf6" : "#6366f1"; // purple for services, indigo for products/all

  return (
    <div className="card overflow-hidden">
      <WidgetHeader title="Top Selling" icon={PackageIcon}>
        <PillTabs tabs={TOP_SELLING_TABS} value={itemType} onChange={setItemType} size="sm" />
      </WidgetHeader>
      <div className="px-4 py-4" style={{ height: 260 }}>
        {renderResponsive(
          <BarChart
            layout="vertical"
            data={chartData}
            margin={{ top: 4, right: 60, left: 0, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" horizontal={false} />
            <XAxis
              type="number"
              tickFormatter={(v: number) => v >= 100000 ? `${(v / 100000).toFixed(1)}L` : v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v)}
              tick={{ fontSize: 11, fill: "var(--text-tertiary)" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fontSize: 11, fill: "var(--text-secondary)" }}
              tickFormatter={(v: string) => v.length > 14 ? v.slice(0, 12) + "…" : v}
              axisLine={false}
              tickLine={false}
              width={90}
            />
            <Tooltip
              {...tooltipStyle}
              formatter={(value: any, _name: any, props: any) => {
                const item = data.find((d) => d.name === props.payload.name);
                return [formatCurrency(String(value)) + (item ? ` (${item.qty.toLocaleString()} ${item.unit})` : ""), "Revenue"];
              }}
            />
            <Bar dataKey="amount" name="Revenue" fill={barColor} radius={[0, 3, 3, 0]} maxBarSize={18} label={{ position: "right", fontSize: 10, fill: "var(--text-tertiary)", formatter: (v: any) => v >= 100000 ? `${(Number(v) / 100000).toFixed(1)}L` : `${(Number(v) / 1000).toFixed(0)}K` }} />
          </BarChart>,
          "100%", "100%"
        )}
      </div>
    </div>
  );
}

const TOP_SELLING_TABS = [
  { value: "all", label: "All" },
  { value: "product", label: "Products" },
  { value: "service", label: "Services" },
];

function TopCustomersChart({ fromDate, toDate }: { fromDate?: string; toDate?: string }) {
  const { data: raw } = trpc.dashboard.topCustomers.useQuery(
    { limit: 5, fromDate, toDate },
    { placeholderData: keepPreviousData }
  );

  if (!raw || raw.length === 0) {
    return (
      <ChartCard title="Top Customers" icon={UserGroupIcon} responsive={false}>
        <ChartEmpty />
      </ChartCard>
    );
  }

  const data = raw.map((r) => ({
    name: r.partyName,
    revenue: parseFloat(r.totalAmount),
    invoices: r.invoiceCount,
  }));

  const chartData = [...data].reverse();

  return (
    <ChartCard title="Top Customers" icon={UserGroupIcon} height={260}>
      <BarChart
        layout="vertical"
        data={chartData}
        margin={{ top: 4, right: 60, left: 0, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" horizontal={false} />
        <XAxis
          type="number"
          tickFormatter={(v: number) => v >= 100000 ? `${(v / 100000).toFixed(1)}L` : v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v)}
          tick={{ fontSize: 11, fill: "var(--text-tertiary)" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="name"
          tick={{ fontSize: 11, fill: "var(--text-secondary)" }}
          axisLine={false}
          tickLine={false}
          width={90}
        />
        <Tooltip
          {...tooltipStyle}
          formatter={(value: any, _name: any, props: any) => {
            const customer = data.find((d) => d.name === props.payload.name);
            return [formatCurrency(String(value)) + (customer ? ` (${customer.invoices} invoices)` : ""), "Revenue"];
          }}
        />
        <Bar dataKey="revenue" name="Revenue" fill="#10b981" radius={[0, 3, 3, 0]} maxBarSize={18} label={{ position: "right", fontSize: 10, fill: "var(--text-tertiary)", formatter: (v: any) => v >= 100000 ? `${(Number(v) / 100000).toFixed(1)}L` : `${(Number(v) / 1000).toFixed(0)}K` }} />
      </BarChart>
    </ChartCard>
  );
}

function ChartEmpty() {
  return (
    <div className="flex items-center justify-center h-full text-sm text-text-tertiary">
      No data for this period
    </div>
  );
}

// ─── Payment mode breakdown ───────────────────────────────────────────────────

const PAYMENT_MODE_COLORS: Record<string, string> = {
  cash: "#10b981",
  bank: "#3b5eaa",
  upi: "#f59e0b",
  cheque: "#8b5cf6",
  other: "#94a3b8",
};
const PAYMENT_MODE_LABELS: Record<string, string> = {
  cash: "Cash",
  bank: "Bank Transfer",
  upi: "UPI",
  cheque: "Cheque",
  other: "Other",
};

function PaymentModeWidget({ fromDate, toDate }: { fromDate?: string; toDate?: string }) {
  const { data } = trpc.dashboard.paymentModeBreakdown.useQuery(
    { fromDate, toDate },
    { placeholderData: keepPreviousData }
  );

  if (!data || data.length === 0) {
    return (
      <ChartCard title="Payment Modes" icon={CreditCardIcon} responsive={false}>
        <ChartEmpty />
      </ChartCard>
    );
  }

  const grandTotal = data.reduce((s, d) => s + parseFloat(d.total), 0);

  return (
    <div className="card overflow-hidden">
      <WidgetHeader title="Payment Modes" icon={CreditCardIcon} />
      <div className="px-4 py-4" style={{ height: 260 }}>
        <div className="flex flex-col h-full">
          {/* Donut */}
          <div className="relative flex-1">
            {renderResponsive(
              <PieChart>
                <Pie
                  data={data.map((d) => ({
                    ...d,
                    name: PAYMENT_MODE_LABELS[d.mode] ?? d.mode,
                    value: parseFloat(d.total),
                  }))}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={76}
                  paddingAngle={2}
                >
                  {data.map((entry) => (
                    <Cell
                      key={entry.mode}
                      fill={PAYMENT_MODE_COLORS[entry.mode] ?? "#94a3b8"}
                    />
                  ))}
                </Pie>
                <Tooltip
                  {...tooltipStyle}
                  formatter={(value: any) => formatCurrency(String(value))}
                />
              </PieChart>,
              "100%", "100%"
            )}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center">
                <span className="block text-xs font-bold tabular-nums text-text-primary">{formatCurrency(String(grandTotal))}</span>
                <span className="block text-[10px] text-text-tertiary">total</span>
              </div>
            </div>
          </div>
          {/* Legend */}
          <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 pb-1">
            {data.map((entry) => {
              const pct = grandTotal > 0 ? Math.round((parseFloat(entry.total) / grandTotal) * 100) : 0;
              return (
                <span key={entry.mode} className="flex items-center gap-1 text-[11px] text-text-secondary">
                  <span
                    className="inline-block rounded-full shrink-0"
                    style={{ width: 8, height: 8, background: PAYMENT_MODE_COLORS[entry.mode] ?? "#94a3b8" }}
                  />
                  {PAYMENT_MODE_LABELS[entry.mode] ?? entry.mode} ({pct}%)
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Collection efficiency ────────────────────────────────────────────────────

function CollectionEfficiencyWidget({ fromDate, toDate }: { fromDate?: string; toDate?: string }) {
  const { data } = trpc.dashboard.collectionEfficiency.useQuery(
    { fromDate, toDate },
    { placeholderData: keepPreviousData }
  );

  if (!data || data.invoiceCount === 0) {
    return (
      <div className="card px-5 py-4">
        <div className="flex items-center gap-2.5">
          <IconCircle icon={Coins01Icon} tone="success" size="sm" />
          <p className="text-sm font-semibold text-text-primary">Collection Efficiency</p>
        </div>
        <p className="text-sm text-text-tertiary mt-3">No invoices for this period</p>
      </div>
    );
  }

  const pct = data.efficiencyPct;
  const prevPct = data.prevEfficiencyPct;
  const delta = prevPct !== null ? pct - prevPct : null;
  const isUp = delta !== null && delta >= 0;

  let barColor = "bg-emerald-500";
  if (pct < 50) barColor = "bg-red-500";
  else if (pct < 80) barColor = "bg-amber-500";

  return (
    <div className="card px-5 py-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <IconCircle icon={Coins01Icon} tone="success" size="sm" />
          <p className="text-sm font-semibold text-text-primary">Collection Efficiency</p>
        </div>
        {delta !== null && (
          <span className={cn(
            "flex items-center gap-0.5 text-[11px] font-medium tabular-nums shrink-0",
            isUp ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
          )}>
            <Icon icon={isUp ? ArrowUp01Icon : ArrowDown01Icon} size={12} strokeWidth={2.25} />
            {Math.abs(delta)}pp vs prev
          </span>
        )}
      </div>
      <div>
        <span className={cn(
          "text-3xl font-bold tabular-nums",
          pct >= 80 ? "text-emerald-600" : pct >= 50 ? "text-amber-600" : "text-red-600"
        )}>
          {pct}%
        </span>
        <span className="ml-1.5 text-xs text-text-tertiary">collected</span>
      </div>
      {/* Progress bar */}
      <div className="w-full h-2 rounded-full bg-surface-2 overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-500", barColor)}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <div className="flex justify-between text-[11px] text-text-tertiary">
        <span>{formatCurrency(data.totalCollected)} collected</span>
        <span>{formatCurrency(data.totalInvoiced)} invoiced</span>
      </div>
    </div>
  );
}

// ─── Expense category breakdown ───────────────────────────────────────────────

function ExpenseCategoryWidget({ fromDate, toDate }: { fromDate?: string; toDate?: string }) {
  const { data } = trpc.dashboard.expenseCategoryBreakdown.useQuery(
    { fromDate, toDate },
    { placeholderData: keepPreviousData }
  );

  if (!data || data.categories.length === 0) {
    return (
      <ChartCard title="Expenses by Category" icon={PieChartIcon} responsive={false}>
        <ChartEmpty />
      </ChartCard>
    );
  }

  const grandTotal = parseFloat(data.grandTotal);
  const chartData = [...data.categories].reverse(); // bottom-to-top for horizontal bar

  return (
    <div className="card overflow-hidden">
      <WidgetHeader title="Expenses by Category" icon={PieChartIcon}>
        <span className="text-[11px] text-text-tertiary tabular-nums">{formatCurrency(data.grandTotal)} total</span>
      </WidgetHeader>
      <div className="px-4 py-4" style={{ height: 260 }}>
        {renderResponsive(
          <BarChart
            layout="vertical"
            data={chartData.map((d) => ({
              name: d.category || "Uncategorised",
              amount: parseFloat(d.total),
              pct: grandTotal > 0 ? Math.round((parseFloat(d.total) / grandTotal) * 100) : 0,
            }))}
            margin={{ top: 4, right: 60, left: 0, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" horizontal={false} />
            <XAxis
              type="number"
              tickFormatter={(v: number) => v >= 100000 ? `${(v / 100000).toFixed(1)}L` : v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v)}
              tick={{ fontSize: 11, fill: "var(--text-tertiary)" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fontSize: 11, fill: "var(--text-secondary)" }}
              tickFormatter={(v: string) => v.length > 14 ? v.slice(0, 12) + "…" : v}
              axisLine={false}
              tickLine={false}
              width={90}
            />
            <Tooltip
              {...tooltipStyle}
              formatter={(value: any, _name: any, props: any) => [
                `${formatCurrency(String(value))} (${props.payload.pct}%)`,
                "Amount",
              ]}
            />
            <Bar
              dataKey="amount"
              name="Amount"
              radius={[0, 3, 3, 0]}
              maxBarSize={18}
              label={{ position: "right", fontSize: 10, fill: "var(--text-tertiary)", formatter: (v: any) => v >= 100000 ? `${(Number(v) / 100000).toFixed(1)}L` : `${(Number(v) / 1000).toFixed(0)}K` }}
            >
              {chartData.map((_, i) => (
                <Cell key={i} fill={EXPENSE_COLORS[i % EXPENSE_COLORS.length]} />
              ))}
            </Bar>
          </BarChart>,
          "100%", "100%"
        )}
      </div>
    </div>
  );
}

// ─── Monthly comparison ───────────────────────────────────────────────────────

function MonthlyComparisonWidget() {
  const { data } = trpc.dashboard.monthlyComparison.useQuery(
    undefined,
    { staleTime: 5 * 60 * 1000, placeholderData: keepPreviousData }
  );

  if (!data) return null;

  function DeltaBadge({ pct }: { pct: number | null }) {
    if (pct === null) return <span className="text-[11px] text-text-tertiary">—</span>;
    const isUp = pct >= 0;
    return (
      <span className={cn(
        "flex items-center gap-0.5 text-[11px] font-semibold tabular-nums",
        isUp ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
      )}>
        <Icon icon={isUp ? ArrowUp01Icon : ArrowDown01Icon} size={12} strokeWidth={2.25} />
        {Math.abs(pct)}%
      </span>
    );
  }

  const rows = [
    { label: "Sales", curr: data.sales.curr, prev: data.sales.prev, pct: data.sales.pctChange, color: "text-emerald-600" },
    { label: "Purchases", curr: data.purchases.curr, prev: data.purchases.prev, pct: data.purchases.pctChange, color: "text-blue-600" },
    { label: "Expenses", curr: data.expenses.curr, prev: data.expenses.prev, pct: data.expenses.pctChange, color: "text-text-primary" },
  ];

  return (
    <div className="card overflow-hidden">
      <WidgetHeader title="Month on Month" icon={Analytics01Icon} />
      <div className="px-4 py-3">
        {/* Header row */}
        <div className="grid grid-cols-4 gap-2 mb-2 text-[11px] font-medium text-text-tertiary">
          <span />
          <span className="text-right">{data.prevMonth}</span>
          <span className="text-right">{data.currMonth}</span>
          <span className="text-right">Change</span>
        </div>
        {/* Data rows */}
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.label} className="grid grid-cols-4 gap-2 items-center">
              <span className="text-xs font-medium text-text-secondary truncate">{row.label}</span>
              <span className="text-right text-xs tabular-nums text-text-tertiary">
                {formatCurrency(row.prev)}
              </span>
              <span className={cn("text-right text-xs font-semibold tabular-nums", row.color)}>
                {formatCurrency(row.curr)}
              </span>
              <div className="flex justify-end">
                <DeltaBadge pct={row.pct} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Summary cards ────────────────────────────────────────────────────────────

function SummaryCards({
  data,
  periodLabel,
}: {
  data: {
    totalSales: string;
    totalPurchases: string;
    receivable: string;
    payable: string;
    cashInHand: string;
    totalExpenses: string;
    fyStart: string;
  };
  periodLabel: string;
}) {
  const cards: Array<{ label: string; value: string; color: string; icon: IconSvgElement; tone: IconCircleTone }> = [
    { label: "Sales", value: data.totalSales, color: "text-emerald-600", icon: ChartLineData01Icon, tone: "success" },
    { label: "Purchases", value: data.totalPurchases, color: "text-blue-600", icon: ShoppingCart01Icon, tone: "info" },
    { label: "Receivable", value: data.receivable, color: "text-amber-600", icon: MoneyReceive01Icon, tone: "warning" },
    { label: "Payable", value: data.payable, color: "text-red-600", icon: MoneySend01Icon, tone: "danger" },
    { label: "Cash Position", value: data.cashInHand, color: "text-emerald-600", icon: Wallet01Icon, tone: "cyan" },
    { label: "Expenses", value: data.totalExpenses, color: "text-text-primary", icon: Invoice01Icon, tone: "purple" },
  ];

  return (
    <div className="mb-6">
      <p className="text-[11px] font-medium text-text-tertiary mb-2">{periodLabel} — Receivable & Payable are current totals</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {cards.map((c) => (
          <StatCard
            key={c.label}
            label={c.label}
            value={formatCurrency(c.value)}
            valueColor={c.color}
            icon={c.icon}
            iconTone={c.tone}
            className="truncate"
          />
        ))}
      </div>
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function PageSkeleton() {
  return (
    <div className="space-y-4">
      <div className="skeleton h-7 w-40" />
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton h-16 rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton h-[292px] rounded-xl" />
        ))}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const PRESET_LABELS: Record<string, string> = {
  "this-month": "This Month",
  "last-month": "Last Month",
  "last-30": "Last 30 Days",
  "this-fy": "This Financial Year",
  "last-fy": "Last Financial Year",
  "custom": "Custom Range",
  "all": "All Time",
};

function DashboardPage() {
  const joinedOrg = new URLSearchParams(window.location.search).get("joined");
  const [showJoinBanner, setShowJoinBanner] = useState(!!joinedOrg);

  useEffect(() => {
    if (joinedOrg) {
      window.history.replaceState({}, "", "/");
    }
  }, [joinedOrg]);

  const [isPending, startTransition] = useTransition();
  const {
    preset,
    setPreset,
    fromDate: from,
    toDate: to,
    customFrom,
    customTo,
    setCustomRange,
  } = useDateRange("dashboard", "this-fy");

  const granularity = getGranularity(preset);
  const periodLabel = PRESET_LABELS[preset] ?? "Custom Range";

  function handlePresetChange(p: Parameters<typeof setPreset>[0]) {
    startTransition(() => setPreset(p));
  }

  const { data, isLoading } = trpc.dashboard.summary.useQuery(
    from || to ? { fromDate: from, toDate: to } : undefined,
    { placeholderData: keepPreviousData }
  );

  const { data: statusBreakdown } = trpc.dashboard.invoiceStatusBreakdown.useQuery(
    from || to ? { fromDate: from, toDate: to } : {},
    { placeholderData: keepPreviousData }
  );

  // All-time stats for milestone checks — fetched once, independent of period
  const { data: allTimeBreakdown } = trpc.dashboard.invoiceStatusBreakdown.useQuery(
    {},
    { staleTime: 5 * 60 * 1000 }
  );
  const { data: allTimeSummary } = trpc.dashboard.summary.useQuery(
    undefined,
    { staleTime: 5 * 60 * 1000 }
  );

  // Session — needed to gate the targets widget to sellers only
  const { data: session } = trpc.auth.me.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
  });

  const isSellerRole =
    session?.role === "seller" || session?.role === "seller_manager";

  // Sales targets — only fetched for sellers and seller managers.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: myTargetsRaw } = (trpc as any).target.myTargets.useQuery(
    undefined,
    { enabled: isSellerRole, staleTime: 2 * 60 * 1000 }
  );

  const myTargets: TargetProgress[] = myTargetsRaw ?? [];

  const businessId = getBusinessId() ?? "default";
  const totalAllTimeInvoices = allTimeBreakdown
    ? allTimeBreakdown.reduce((sum, s) => sum + s.count, 0)
    : 0;
  const totalAllTimeSales = allTimeSummary ? parseFloat(allTimeSummary.totalSales) : 0;
  const milestone = allTimeBreakdown && allTimeSummary
    ? checkMilestone(businessId, totalAllTimeInvoices, totalAllTimeSales)
    : null;

  if (isLoading && !data) return <PageSkeleton />;

  if (!data) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Dashboard"
          actions={
            <Link to="/invoices" search={{ create: "1" }} className="btn-primary">
              + New Invoice
            </Link>
          }
        />
        <EmptyState
          title="No activity yet"
          description="Your business is ready. Create your first invoice or add your initial records to start tracking sales and payments."
          action={
            <Link to="/invoices" search={{ create: "1" }} className="btn-primary">
              Create Invoice
            </Link>
          }
        />
      </div>
    );
  }

  // Compute gross & net profit from summary data
  const grossProfit = parseFloat(data.totalSales) - parseFloat(data.totalPurchases);
  const netProfit = grossProfit - parseFloat(data.totalExpenses);

  // Find overdue invoices from status breakdown
  const overdueEntry = statusBreakdown?.find((s) => s.status === "overdue");
  const overdueCount = overdueEntry?.count ?? 0;
  const overdueAmount = overdueEntry?.total ?? "0";

  return (
    <div>
      <PageHeader
        title="Dashboard"
        actions={
          <div className="flex items-center gap-3">
            <DateRangeBar
              preset={preset}
              onPresetChange={handlePresetChange}
              customFrom={customFrom}
              customTo={customTo}
              onCustomChange={setCustomRange}
            />
            <Link to="/invoices" search={{ create: "1" }} className="btn-primary">
              + New Invoice
            </Link>
          </div>
        }
      />

      {showJoinBanner && joinedOrg && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-brand-600/[0.06] border border-brand-600/20 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-brand-700 dark:text-brand-400">
              You've joined {joinedOrg}!
            </p>
            <p className="text-xs text-text-tertiary mt-0.5">
              Switch between your organizations anytime using the sidebar.
            </p>
          </div>
          <button
            onClick={() => setShowJoinBanner(false)}
            className="btn-ghost text-xs px-2 py-1 shrink-0"
          >
            Got it
          </button>
        </div>
      )}

      <div style={{ opacity: isPending ? 0.6 : 1, transition: "opacity 0.15s ease" }}>
        {milestone && (
          <MilestoneBanner message={milestone.message} milestoneKey={milestone.key} />
        )}

        {/* Sales target widget — only visible to sellers and seller managers */}
        {isSellerRole && myTargets.length > 0 && (
          <TargetsWidget targets={myTargets} />
        )}

        <SummaryCards data={data} periodLabel={periodLabel} />

        {/* Profit indicator cards */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="card px-4 py-3 flex items-center gap-3">
            <IconCircle icon={grossProfit >= 0 ? ChartIncreaseIcon : ChartDecreaseIcon} tone={grossProfit >= 0 ? "success" : "danger"} />
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-text-tertiary mb-1">Gross Profit</p>
              <p className={cn(
                "text-lg font-bold tabular-nums",
                grossProfit >= 0 ? "text-emerald-600" : "text-red-600"
              )}>
                {formatCurrency(String(grossProfit))}
              </p>
            </div>
          </div>
          <div className="card px-4 py-3 flex items-center gap-3">
            <IconCircle icon={netProfit >= 0 ? ChartIncreaseIcon : ChartDecreaseIcon} tone={netProfit >= 0 ? "success" : "danger"} />
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-text-tertiary mb-1">Net Profit</p>
              <p className={cn(
                "text-lg font-bold tabular-nums",
                netProfit >= 0 ? "text-emerald-600" : "text-red-600"
              )}>
                {formatCurrency(String(netProfit))}
              </p>
            </div>
          </div>
        </div>

        {/* Overdue invoices alert */}
        {overdueCount > 0 && (
          <div className="mb-4 px-4 py-3 rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-800 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <IconCircle icon={Alert02Icon} tone="danger" size="md" />
              <div>
                <p className="text-sm font-medium text-red-700 dark:text-red-400">
                  {overdueCount} overdue invoice{overdueCount > 1 ? "s" : ""} totaling {formatCurrency(overdueAmount)}
                </p>
                <p className="text-xs text-red-600/70 dark:text-red-400/60">Past due date with outstanding balance</p>
              </div>
            </div>
            <Link to="/invoices" className="text-xs font-medium text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 shrink-0">
              View →
            </Link>
          </div>
        )}

        {/* Charts grid — all charts respect the selected period */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <SalesTrendChart fromDate={from} toDate={to} granularity={granularity} />
          <InvoiceStatusChart fromDate={from} toDate={to} />
          <TopSellingChart fromDate={from} toDate={to} />
          <TopCustomersChart fromDate={from} toDate={to} />
        </div>

        {/* Analytics widgets — period-scoped */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
          <PaymentModeWidget fromDate={from} toDate={to} />
          <ExpenseCategoryWidget fromDate={from} toDate={to} />
        </div>

        {/* Efficiency + comparison row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
          <CollectionEfficiencyWidget fromDate={from} toDate={to} />
          <MonthlyComparisonWidget />
        </div>
      </div>
    </div>
  );
}
