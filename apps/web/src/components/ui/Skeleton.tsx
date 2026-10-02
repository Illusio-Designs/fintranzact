/**
 * Loading placeholders shaped like what's coming: a table with its real
 * column headings, a report's statement lines, the dashboard's cards. They
 * shimmer (see `.skeleton` in globals.css) and are hidden from screen readers,
 * which get one "Loading" announcement instead.
 */
import { cn } from "@/lib/utils";

/** One shimmering block. */
export function Bone({ className }: { className?: string }) {
  return <span aria-hidden className={cn("skeleton block h-3 rounded-md", className)} />;
}

/** Varied widths so rows read like text, not identical bars. */
const WIDTHS = ["w-24", "w-32", "w-20", "w-28", "w-16", "w-36"];
const w = (row: number, col: number) => WIDTHS[(row * 3 + col * 5) % WIDTHS.length];

export interface SkeletonColumn {
  /** The real heading, so the table's shape is visible while it loads. */
  label?: string;
  align?: "left" | "right" | "center";
  /** "badge" for status pills, "button" for an Actions button, "pair" for a name with a line under it. */
  kind?: "text" | "badge" | "button" | "pair" | "mono";
}

/**
 * A data table with its headings and shimmering cells. Built from a grid, not
 * <table>, so nothing that reads the real table's rows mistakes these for data.
 */
export function TableSkeleton({ columns, rows = 8, label = "Loading", className }: { columns: SkeletonColumn[]; rows?: number; label?: string; className?: string }) {
  const grid = { gridTemplateColumns: columns.map((c) => (c.kind === "button" || c.kind === "badge" ? "minmax(0,0.7fr)" : "minmax(0,1fr)")).join(" ") };
  const align = (c: SkeletonColumn) => (c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left");
  return (
    <div role="status" aria-label={label} className={cn("w-full overflow-hidden text-sm", className)}>
      <div aria-hidden className="grid border-b border-border-light bg-surface-1" style={grid}>
        {columns.map((c, i) => (
          <div key={i} className={cn("truncate px-4 py-2.5 text-xs font-medium text-text-tertiary", align(c))}>
            {c.label ?? "\u00a0"}
          </div>
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} aria-hidden className="grid items-center border-b border-border-light last:border-0" style={grid}>
          {columns.map((c, i) => (
            <div key={i} className={cn("px-4 py-3.5", align(c))}>
              <Cell kind={c.kind} width={w(r, i)} align={c.align} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Cell({ kind = "text", width, align }: { kind?: SkeletonColumn["kind"]; width: string; align?: SkeletonColumn["align"] }) {
  const end = align === "right" ? "ml-auto" : align === "center" ? "mx-auto" : "";
  if (kind === "badge") return <Bone className={cn("h-5 w-16 rounded-full", end)} />;
  if (kind === "button") return <Bone className={cn("h-7 w-20 rounded-lg", end || "ml-auto")} />;
  if (kind === "mono") return <Bone className={cn("h-3 w-20", end)} />;
  if (kind === "pair")
    return (
      <span className="grid gap-1.5">
        <Bone className={cn("h-3", width)} />
        <Bone className="h-2.5 w-16 opacity-70" />
      </span>
    );
  return <Bone className={cn(width, end)} />;
}

/** A report statement (P&L, Balance Sheet): headed sections of label and amount lines. */
export function StatementSkeleton({ sections = [4, 3, 2], label = "Loading report" }: { sections?: number[]; label?: string }) {
  return (
    <div role="status" aria-label={label} className="grid gap-5 p-5">
      {sections.map((lines, s) => (
        <div key={s} className="grid gap-3" aria-hidden>
          <Bone className="h-2.5 w-28 opacity-80" />
          {Array.from({ length: lines }).map((_, i) => (
            <div key={i} className="flex items-center justify-between gap-6 pl-4">
              <Bone className={w(s, i)} />
              <Bone className="w-20" />
            </div>
          ))}
          <div className="flex items-center justify-between gap-6 border-t border-border-light pt-3">
            <Bone className="h-3.5 w-32" />
            <Bone className="h-3.5 w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** A row of figure cards (dashboard, report summaries). */
export function KpiSkeleton({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div aria-hidden className={cn("grid grid-cols-2 gap-3 lg:grid-cols-4", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-border-light bg-surface-0 p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <Bone className="w-20" />
            <Bone className="h-9 w-9 rounded-xl" />
          </div>
          <Bone className="mt-3 h-6 w-32" />
          <Bone className="mt-2 h-2.5 w-24 opacity-70" />
        </div>
      ))}
    </div>
  );
}

/** A bar chart's outline: axis lines and bars of different heights. */
export function ChartSkeleton({ bars = 8, height = 200, className }: { bars?: number; height?: number; className?: string }) {
  const heights = [40, 65, 30, 80, 55, 70, 45, 90, 35, 60, 75, 50];
  return (
    <div aria-hidden className={cn("flex items-end gap-3 border-b border-l border-border-light px-3 pb-0", className)} style={{ height }}>
      {Array.from({ length: bars }).map((_, i) => (
        <span key={i} className="skeleton flex-1 rounded-t-md" style={{ height: `${heights[i % heights.length]}%` }} />
      ))}
    </div>
  );
}

/** A detail panel: heading, label/value pairs, then a small table. */
export function DetailSkeleton({ fields = 6, lines = 3, label = "Loading details" }: { fields?: number; lines?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} className="grid gap-6">
      <div aria-hidden className="flex items-start justify-between gap-4">
        <div className="grid gap-2">
          <Bone className="h-5 w-40" />
          <Bone className="w-28 opacity-70" />
        </div>
        <Bone className="h-6 w-20 rounded-full" />
      </div>
      <div aria-hidden className="grid grid-cols-2 gap-x-8 gap-y-4">
        {Array.from({ length: fields }).map((_, i) => (
          <div key={i} className="grid gap-1.5">
            <Bone className="h-2.5 w-16 opacity-70" />
            <Bone className={w(i, 1)} />
          </div>
        ))}
      </div>
      {lines > 0 && (
        <div aria-hidden className="grid gap-3 rounded-xl border border-border-light p-4">
          {Array.from({ length: lines }).map((_, i) => (
            <div key={i} className="flex items-center justify-between gap-6">
              <Bone className={w(i, 2)} />
              <Bone className="w-20" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Cards in a grid (warehouses, roadmap, partners). */
export function CardGridSkeleton({ count = 3, className }: { count?: number; className?: string }) {
  return (
    <div role="status" aria-label="Loading" className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-3", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} aria-hidden className="grid gap-3 rounded-2xl border border-border-light bg-surface-0 p-5">
          <div className="flex items-center gap-3">
            <Bone className="h-9 w-9 rounded-xl" />
            <div className="grid flex-1 gap-1.5">
              <Bone className={w(i, 0)} />
              <Bone className="h-2.5 w-20 opacity-70" />
            </div>
          </div>
          <Bone className="w-full" />
          <Bone className={w(i, 3)} />
        </div>
      ))}
    </div>
  );
}
