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
} from "recharts";
import { trpc, getBusinessId } from "@/lib/trpc";
import { canAccess } from "@/lib/permissions";
import { formatCurrency, cn, formatDateShort, formatMonthYearShort } from "@/lib/utils";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { PillTabs } from "@/components/ui/Tabs";
import { DateRangeBar } from "@/components/ui/DateRangeBar";
import { useDateRange, getGranularity } from "@/hooks/useDateRange";
import { Icon, IconCircle, type IconSvgElement } from "@/components/ui/Icon";
import { Alert02Icon, ArrowDownLeft01Icon, ArrowUpRight01Icon, ReceiptDollarIcon, Analytics01Icon, ArrowDown01Icon, ArrowUp01Icon, Award01Icon, Cancel01Icon, ChartBarLineIcon, ChartDecreaseIcon, ChartIncreaseIcon, ChartLineData01Icon, Coins01Icon, CreditCardIcon, FireIcon, Invoice01Icon, Invoice03Icon, PackageIcon, PieChartIcon, SproutIcon, Rocket01Icon, ShoppingCart01Icon, StarIcon, Target02Icon, UserGroupIcon, Wallet01Icon } from "@hugeicons/core-free-icons";

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
  return `fintranzact_milestone_${businessId}_${type}_${value}`;
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
        <span className="text-2xs tabular-nums text-text-tertiary">
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
        <span className="text-2xs text-text-tertiary">
          {daysLeft === 0 ? "Last day" : `${daysLeft} day${daysLeft === 1 ? "" : "s"} remaining`}
        </span>
        <span className={cn("inline-flex items-center gap-1 text-2xs font-medium", msgColor)}>
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
  sent: "var(--chart-1)",
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


// Recharts ResponsiveContainer types are incompatible with React 19's stricter ReactNode
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderResponsive(children: React.ReactElement, width: string, height: string) {
  return <ResponsiveContainer width={width as any} height={height as any}>{children as any}</ResponsiveContainer>;
}

// ─── Panel primitives ─────────────────────────────────────────────────────────

/** Card surface used by every dashboard section. */
const TONE = {
  brand: "bg-brand-50 text-brand-600 dark:bg-brand-950 dark:text-brand-300",
  in: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400",
  out: "bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400",
};
const PANEL = "rounded-2xl border border-border-light bg-surface-0";

function PanelHeader({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: IconSvgElement;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 pt-4">
      <h2 className="flex items-center gap-2 text-[15px] font-bold text-text-primary">
        {icon && <Icon icon={icon} size={17} className="text-brand-600 dark:text-brand-300" />}
        {title}
      </h2>
      {children}
    </div>
  );
}

/** Colour swatch + label, for chart legends. */
function LegendKey({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-text-secondary">
      <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: color }} />
      {label}
    </span>
  );
}

// ─── Chart card wrapper ───────────────────────────────────────────────────────

function ChartCard({
  title,
  icon,
  height = 260,
  children,
  responsive = true,
  legend,
}: {
  title: string;
  icon: IconSvgElement;
  height?: number;
  children: React.ReactElement;
  responsive?: boolean;
  legend?: React.ReactNode;
}) {
  return (
    <div className={cn(PANEL, "overflow-hidden")}>
      <PanelHeader title={title} icon={icon}>{legend}</PanelHeader>
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
      <ChartCard title="Sales & collections" icon={ChartBarLineIcon} responsive={false}>
        <ChartEmpty />
      </ChartCard>
    );
  }

  return (
    <ChartCard
      title="Sales & collections"
      icon={ChartBarLineIcon}
      legend={
        <div className="flex gap-4">
          <LegendKey color="var(--chart-1)" label="Invoiced" />
          <LegendKey color="var(--chart-2)" label="Collected" />
        </div>
      }
    >
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
        <Bar dataKey="invoiced" name="Invoiced" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={26} />
        <Bar dataKey="collected" name="Collected" fill="var(--chart-2)" radius={[4, 4, 0, 0]} maxBarSize={26} />
      </BarChart>
    </ChartCard>
  );
}

/**
 * A share-of-total breakdown: one segmented bar plus a labelled row per part,
 * so identity never rests on colour alone.
 */
function Breakdown({
  items,
}: {
  items: Array<{ key: string; label: string; color: string; value: number; amount: string; detail: string }>;
}) {
  const total = items.reduce((sum, i) => sum + i.value, 0);
  return (
    <div className="px-5 pb-5 pt-4">
      <div className="flex h-3 gap-[2px] overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
        {items.map((i) =>
          i.value > 0 ? (
            <span key={i.key} style={{ width: `${(i.value / total) * 100}%`, background: i.color }} />
          ) : null,
        )}
      </div>
      <ul className="mt-4 space-y-3">
        {items.map((i) => (
          <li key={i.key} className="flex items-center gap-3 text-sm">
            <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: i.color }} />
            <span className="flex-1 truncate text-text-secondary">{i.label}</span>
            <span className="font-semibold tabular-nums text-text-primary">{i.amount}</span>
            <span className="w-16 text-right text-xs tabular-nums text-text-tertiary">{i.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function InvoiceStatusChart({ fromDate, toDate }: { fromDate?: string; toDate?: string }) {
  const { data } = trpc.dashboard.invoiceStatusBreakdown.useQuery({
    fromDate,
    toDate,
  }, { placeholderData: keepPreviousData });

  if (!data || data.length === 0) {
    return (
      <ChartCard title="Invoice status" icon={Invoice03Icon} responsive={false}>
        <ChartEmpty />
      </ChartCard>
    );
  }

  const total = data.reduce((sum, d) => sum + d.count, 0);

  return (
    <div className={cn(PANEL, "flex flex-col overflow-hidden")} data-testid="dashboard-invoice-status">
      <PanelHeader title="Invoice status" icon={Invoice03Icon}>
        <span className="text-xs tabular-nums text-text-tertiary">{total} invoices</span>
      </PanelHeader>
      <Breakdown
        items={data.map((d) => ({
          key: d.status,
          label: INVOICE_STATUS_LABELS[d.status] || d.status,
          color: INVOICE_STATUS_COLORS[d.status] ?? "#94a3b8",
          value: d.count,
          amount: formatCurrency(d.total),
          detail: `${d.count} inv.`,
        }))}
      />
      <Link
        to="/invoices"
        className="mt-auto border-t border-border-light px-5 py-3 text-ui font-semibold text-brand-700 hover:bg-surface-1 dark:text-brand-300"
      >
        View all invoices →
      </Link>
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
      <div className={cn(PANEL, "overflow-hidden")}>
        <PanelHeader title="Top Selling" icon={PackageIcon}>
          <PillTabs tabs={TOP_SELLING_TABS} value={itemType} onChange={setItemType} size="sm" />
        </PanelHeader>
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
  const barColor = "var(--chart-1)";

  return (
    <div className={cn(PANEL, "overflow-hidden")}>
      <PanelHeader title="Top Selling" icon={PackageIcon}>
        <PillTabs tabs={TOP_SELLING_TABS} value={itemType} onChange={setItemType} size="sm" />
      </PanelHeader>
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
            <Bar dataKey="amount" name="Revenue" fill={barColor} radius={[0, 4, 4, 0]} maxBarSize={18} label={{ position: "right", fontSize: 10, fill: "var(--text-tertiary)", formatter: (v: any) => v >= 100000 ? `${(Number(v) / 100000).toFixed(1)}L` : `${(Number(v) / 1000).toFixed(0)}K` }} />
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
        <Bar dataKey="revenue" name="Revenue" fill="var(--chart-1)" radius={[0, 4, 4, 0]} maxBarSize={18} label={{ position: "right", fontSize: 10, fill: "var(--text-tertiary)", formatter: (v: any) => v >= 100000 ? `${(Number(v) / 100000).toFixed(1)}L` : `${(Number(v) / 1000).toFixed(0)}K` }} />
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
  bank: "var(--chart-1)",
  upi: "var(--chart-2)",
  cash: "var(--chart-3)",
  cheque: "var(--chart-4)",
  other: "var(--chart-5)",
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
      <ChartCard title="Payment modes" icon={CreditCardIcon} responsive={false}>
        <ChartEmpty />
      </ChartCard>
    );
  }

  const grandTotal = data.reduce((s, d) => s + parseFloat(d.total), 0);

  return (
    <div className={cn(PANEL, "overflow-hidden")} data-testid="dashboard-payment-modes">
      <PanelHeader title="Payment modes" icon={CreditCardIcon}>
        <span className="text-xs tabular-nums text-text-tertiary">{formatCurrency(String(grandTotal))} received</span>
      </PanelHeader>
      <Breakdown
        items={data.map((d) => {
          const value = parseFloat(d.total);
          return {
            key: d.mode,
            label: PAYMENT_MODE_LABELS[d.mode] ?? d.mode,
            color: PAYMENT_MODE_COLORS[d.mode] ?? "var(--chart-5)",
            value,
            amount: formatCurrency(d.total),
            detail: grandTotal > 0 ? `${Math.round((value / grandTotal) * 100)}%` : "0%",
          };
        })}
      />
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
      <div className={cn(PANEL, "px-5 py-4")}>
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
    <div className={cn(PANEL, "px-5 py-4 flex flex-col gap-3")}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <IconCircle icon={Coins01Icon} tone="success" size="sm" />
          <p className="text-sm font-semibold text-text-primary">Collection Efficiency</p>
        </div>
        {delta !== null && (
          <span className={cn(
            "flex items-center gap-0.5 text-2xs font-medium tabular-nums shrink-0",
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
          className={cn("h-full rounded-full transition-[width] duration-500", barColor)}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <div className="flex justify-between text-2xs text-text-tertiary">
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
    <div className={cn(PANEL, "overflow-hidden")}>
      <PanelHeader title="Expenses by Category" icon={PieChartIcon}>
        <span className="text-2xs text-text-tertiary tabular-nums">{formatCurrency(data.grandTotal)} total</span>
      </PanelHeader>
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
              fill="var(--chart-1)"
              radius={[0, 4, 4, 0]}
              maxBarSize={18}
              label={{ position: "right", fontSize: 10, fill: "var(--text-tertiary)", formatter: (v: any) => v >= 100000 ? `${(Number(v) / 100000).toFixed(1)}L` : `${(Number(v) / 1000).toFixed(0)}K` }}
            />
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
    if (pct === null) return <span className="text-2xs text-text-tertiary">—</span>;
    const isUp = pct >= 0;
    return (
      <span className={cn(
        "flex items-center gap-0.5 text-2xs font-semibold tabular-nums",
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
    <div className={cn(PANEL, "overflow-hidden")} data-testid="dashboard-month-on-month">
      <PanelHeader title="Month on Month" icon={Analytics01Icon} />
      <div className="px-4 py-3">
        {/* Header row */}
        <div className="grid grid-cols-4 gap-2 mb-2 text-2xs font-medium text-text-tertiary">
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
    grossProfit: string;
    netProfit: string;
    fyStart: string;
  };
  periodLabel: string;
}) {
  // Worked out by the API as the P&L report does (taxable value, net of
  // credit notes, cost of goods sold from stock)
  const grossProfit = parseFloat(data.grossProfit);
  const netProfit = parseFloat(data.netProfit);

  // Each figure opens the report behind it. Money coming in is green, going out amber, so the two
  // "today" cards read apart at a glance.
  const hero: Array<{ label: string; value: string; note: string; icon: IconSvgElement; report: string; tone: string }> = [
    { label: "Sales", value: data.totalSales, note: periodLabel, icon: ChartLineData01Icon, report: "sales-register", tone: TONE.brand },
    { label: "Purchases", value: data.totalPurchases, note: periodLabel, icon: ShoppingCart01Icon, report: "purchase-register", tone: TONE.brand },
    { label: "To collect", value: data.receivable, note: "Receivable today", icon: ArrowDownLeft01Icon, report: "outstanding", tone: TONE.in },
    { label: "To pay", value: data.payable, note: "Payable today", icon: ArrowUpRight01Icon, report: "outstanding", tone: TONE.out },
  ];
  const secondary: Array<{ label: string; value: number; icon: IconSvgElement; signed?: boolean }> = [
    { label: "Cash position", value: parseFloat(data.cashInHand), icon: Wallet01Icon },
    { label: "Expenses", value: parseFloat(data.totalExpenses), icon: ReceiptDollarIcon },
    { label: "Gross profit", value: grossProfit, icon: grossProfit >= 0 ? ChartIncreaseIcon : ChartDecreaseIcon, signed: true },
    { label: "Net profit", value: netProfit, icon: netProfit >= 0 ? ChartIncreaseIcon : ChartDecreaseIcon, signed: true },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {hero.map((c) => (
          <Link
            key={c.label}
            to="/reports"
            search={{ report: c.report }}
            aria-label={`${c.label}: ${formatCurrency(c.value)}. Open the report`}
            className={cn(
              PANEL,
              "group block p-4 transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md focus-visible:-translate-y-0.5 motion-reduce:transform-none sm:p-5 dark:hover:border-brand-700",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-ui font-semibold text-text-tertiary">{c.label}</span>
              <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl transition-transform duration-150 group-hover:scale-105", c.tone)}>
                <Icon icon={c.icon} size={18} />
              </span>
            </div>
            <p
              data-testid={`dashboard-${c.label.toLowerCase().replace(/\s+/g, "-")}`}
              className="mt-2.5 font-display text-[17px] font-extrabold leading-tight tracking-[-0.02em] tabular-nums text-text-primary sm:text-[22px] xl:text-[26px]"
            >
              {formatCurrency(c.value)}
            </p>
            <p className="mt-1 truncate text-xs text-text-tertiary">{c.note}</p>
          </Link>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {secondary.map((c) => (
          <div key={c.label} className={cn(PANEL, "flex items-center gap-3 px-4 py-3")}>
            <Icon
              icon={c.icon}
              size={18}
              className={cn(
                "shrink-0",
                c.signed
                  ? c.value >= 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-red-600 dark:text-red-400"
                  : "text-text-tertiary",
              )}
            />
            <div className="min-w-0">
              <p className="text-2xs font-medium text-text-tertiary">{c.label}</p>
              <p
                data-testid={`dashboard-${c.label.toLowerCase().replace(/\s+/g, "-")}`}
                className={cn(
                  "truncate text-ui font-bold tabular-nums sm:text-[15px]",
                  c.signed
                    ? c.value >= 0
                      ? "text-emerald-700 dark:text-emerald-400"
                      : "text-red-600 dark:text-red-400"
                    : "text-text-primary",
                )}
              >
                {formatCurrency(String(c.value))}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Recent invoices ──────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, string> = {
  paid: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  partial: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  sent: "bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300",
  overdue: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
};

function RecentInvoices() {
  const { data, isError } = trpc.invoice.list.useQuery(
    { type: "sale", page: 1, limit: 6, sortBy: "date", sortDir: "desc" },
    { placeholderData: keepPreviousData, retry: false },
  );
  // Roles without invoice access simply don't get this panel.
  if (isError) return null;
  const rows = data?.data ?? [];

  return (
    <div className={cn(PANEL, "overflow-hidden")}>
      <PanelHeader title="Recent invoices" icon={Invoice01Icon}>
        <Link to="/invoices" className="text-ui font-semibold text-brand-700 hover:underline dark:text-brand-300">
          See all
        </Link>
      </PanelHeader>
      {rows.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-text-tertiary">No sales invoices yet</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="bg-surface-1 text-left text-2xs font-semibold uppercase tracking-[0.06em] text-text-tertiary">
                <th scope="col" className="px-5 py-2 font-semibold">Invoice</th>
                <th scope="col" className="px-3 py-2 font-semibold">Party</th>
                <th scope="col" className="px-3 py-2 font-semibold">Date</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Amount</th>
                <th scope="col" className="px-5 py-2 text-right font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((inv) => (
                <tr key={inv.id} className="border-t border-border-light hover:bg-surface-1">
                  <td className="px-5 py-3">
                    <Link
                      to="/invoices"
                      search={{ id: inv.id }}
                      className="font-semibold text-brand-700 hover:underline dark:text-brand-300"
                    >
                      {inv.invoiceNumber}
                    </Link>
                  </td>
                  <td className="max-w-[220px] truncate px-3 py-3 font-medium text-text-primary">{inv.partyName ?? "—"}</td>
                  <td className="px-3 py-3 text-text-secondary">{formatDateShort(new Date(inv.invoiceDate))}</td>
                  <td className="px-3 py-3 text-right font-semibold tabular-nums text-text-primary">{formatCurrency(inv.totalAmount)}</td>
                  <td className="px-5 py-3 text-right">
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-xs font-semibold",
                        STATUS_BADGE[inv.status] ?? "bg-surface-2 text-text-secondary",
                      )}
                    >
                      {INVOICE_STATUS_LABELS[inv.status] ?? inv.status}
                    </span>
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

// ─── GST this month ───────────────────────────────────────────────────────────

/** Current month's GSTR-3B position: output tax, eligible ITC, net payable. */
function GstThisMonth() {
  const now = new Date();
  const { data, isError } = trpc.gst.gstr3b.useQuery(
    { year: now.getFullYear(), month: now.getMonth() + 1 },
    { staleTime: 5 * 60 * 1000, retry: false },
  );
  if (isError || !data) return null;
  const output = data.taxPayable.igst + data.taxPayable.cgst + data.taxPayable.sgst;
  // GSTR-3B for this month is due on the 20th of next month.
  const due = new Date(now.getFullYear(), now.getMonth() + 1, 20);

  return (
    <div className="rounded-2xl bg-[#0f1b3d] p-5 text-white dark:bg-[#111c3a] dark:ring-1 dark:ring-[#2a3a63]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-bold">GST this month</h2>
        <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-semibold">
          3B due {formatDateShort(due)}
        </span>
      </div>
      <dl className="mt-3 space-y-2 text-ui text-[#c3cee6]">
        <div className="flex justify-between">
          <dt>Output GST</dt>
          <dd className="font-semibold tabular-nums text-white">{formatCurrency(String(output))}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Input tax credit</dt>
          <dd className="font-semibold tabular-nums text-white">− {formatCurrency(String(data.itc.total))}</dd>
        </div>
        <div className="flex justify-between border-t border-white/15 pt-2">
          <dt>Net payable</dt>
          <dd className="text-base font-bold tabular-nums text-white">{formatCurrency(String(Math.max(0, data.netTax.total)))}</dd>
        </div>
      </dl>
      <Link
        to="/gst"
        className="mt-4 flex h-10 items-center justify-center rounded-xl bg-white text-sm font-bold text-[#0f1b3d] transition hover:bg-brand-50"
      >
        Open GST returns
      </Link>
    </div>
  );
}

function greeting(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
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
  const canCreateInvoice = canAccess(session?.role, "Invoice", "create");

  // Sales targets — only fetched for sellers and seller managers.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: myTargetsRaw } = (trpc as any).target.myTargets.useQuery(
    undefined,
    { enabled: isSellerRole, staleTime: 2 * 60 * 1000 }
  );

  const myTargets: TargetProgress[] = myTargetsRaw ?? [];

  // Current business, for the greeting and the GST panel (cached by the shell).
  // Only with an organisation: a platform admin or partner without one passes
  // through this page on sign-in, and the list is refused (400) without it.
  const { data: businesses } = trpc.business.list.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    enabled: !!session?.tenantId,
  });
  const activeBusiness = businesses?.find((b) => b.id === getBusinessId()) ?? businesses?.[0];
  const isGstRegistered =
    !!activeBusiness && (activeBusiness.gstRegistrationType !== "unregistered" || !!activeBusiness.gstin);

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
            canCreateInvoice ? (
              <Link to="/invoices" search={{ create: "1" }} className="btn-primary">
                + New Invoice
              </Link>
            ) : undefined
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

  // Find overdue invoices from status breakdown
  const overdueEntry = statusBreakdown?.find((s) => s.status === "overdue");
  const overdueCount = overdueEntry?.count ?? 0;
  const overdueAmount = overdueEntry?.total ?? "0";

  const firstName = session?.user?.name?.trim().split(/\s+/)[0];
  const businessName = businesses?.find((b) => b.id === getBusinessId())?.name ?? businesses?.[0]?.name;

  return (
    <div className="min-w-0 space-y-5">
      {/* Greeting + period + primary action */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-[#0f1b3d] dark:text-white sm:text-[28px]">
            {greeting(new Date().getHours())}
            {firstName ? `, ${firstName}` : ""}
          </h1>
          <p className="mt-1 text-sm text-text-tertiary">
            {businessName ? `${businessName} · ` : ""}
            {periodLabel}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <DateRangeBar
            variant="segmented"
            preset={preset}
            onPresetChange={handlePresetChange}
            customFrom={customFrom}
            customTo={customTo}
            onCustomChange={setCustomRange}
          />
        </div>
      </div>

      {showJoinBanner && joinedOrg && (
        <div className="px-4 py-3 rounded-xl bg-brand-600/[0.06] border border-brand-600/20 flex items-center justify-between">
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

      <div
        className="space-y-5"
        style={{ opacity: isPending ? 0.6 : 1, transition: "opacity 0.15s ease" }}
      >
        {milestone && (
          <MilestoneBanner message={milestone.message} milestoneKey={milestone.key} />
        )}

        {/* Sales target widget — only visible to sellers and seller managers */}
        {isSellerRole && myTargets.length > 0 && (
          <TargetsWidget targets={myTargets} />
        )}

        {/* Overdue invoices alert */}
        {overdueCount > 0 && (
          <div
            role="status"
            className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 dark:border-red-900 dark:bg-red-950/40"
          >
            <Icon icon={Alert02Icon} size={19} className="shrink-0 text-red-600 dark:text-red-400" />
            <p className="flex-1 text-sm text-red-800 dark:text-red-300">
              <span className="font-semibold">
                {overdueCount} overdue invoice{overdueCount > 1 ? "s" : ""}
              </span>{" "}
              — {formatCurrency(overdueAmount)} past the due date.
            </p>
            <Link
              to="/invoices"
              className="shrink-0 text-sm font-semibold text-red-700 hover:underline dark:text-red-300"
            >
              Review →
            </Link>
          </div>
        )}

        <SummaryCards data={data} periodLabel={periodLabel} />

        {/* Trend + status */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <div className="min-w-0 xl:col-span-2">
            <SalesTrendChart fromDate={from} toDate={to} granularity={granularity} />
          </div>
          <InvoiceStatusChart fromDate={from} toDate={to} />
        </div>

        {/* Recent activity + money position */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <div className="min-w-0 xl:col-span-2">
            <RecentInvoices />
          </div>
          <div className="min-w-0 space-y-4">
            {isGstRegistered && <GstThisMonth />}
            <CollectionEfficiencyWidget fromDate={from} toDate={to} />
          </div>
        </div>

        {/* Who and what */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <TopSellingChart fromDate={from} toDate={to} />
          <TopCustomersChart fromDate={from} toDate={to} />
        </div>

        {/* Money in and out */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <PaymentModeWidget fromDate={from} toDate={to} />
          <ExpenseCategoryWidget fromDate={from} toDate={to} />
          <MonthlyComparisonWidget />
        </div>
      </div>
    </div>
  );
}
