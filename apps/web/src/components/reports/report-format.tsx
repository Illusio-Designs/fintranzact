import { KpiSkeleton, StatementSkeleton, TableSkeleton, type SkeletonColumn } from "@/components/ui/Skeleton";
/**
 * Formatting and loading pieces shared by the GST returns page and the
 * accounting reports (P&L, trial balance, balance sheet and the rest).
 */
import { formatCurrency } from "@/lib/utils";

// ── FY date helpers (lib/fy-bounds) ─────────────────────────────
export function fyLabel(year: number): string {
  return `FY ${year}-${String(year + 1).slice(-2)}`;
}



export function fmt(n: number): string {
  return formatCurrency(n);
}

// Alias used by GSTR-9 components (number input, same as fmt)
export const fmtN = fmt;

export function fmtStr(s: string): string {
  return formatCurrency(parseFloat(s) || 0);
}


/**
 * A report loading: its summary cards, then either its table (with the real
 * column headings) or, for statements like P&L, headed sections of lines.
 */
export function ReportSkeleton({
  summary = 4,
  columns = [{ label: "Name" }, { label: "Details" }, { align: "right" }, { align: "right" }],
  statement,
  rows = 8,
}: {
  summary?: number;
  columns?: SkeletonColumn[];
  statement?: number[];
  rows?: number;
}) {
  return (
    <div role="status" aria-label="Loading report" className="space-y-4">
      {summary > 0 && <KpiSkeleton count={summary} />}
      <div className="card overflow-hidden">
        {statement ? <StatementSkeleton sections={statement} /> : <TableSkeleton columns={columns} rows={rows} />}
      </div>
    </div>
  );
}

