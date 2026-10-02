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


export function ReportSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="card px-4 py-3">
            <div className="skeleton h-3 w-20 mb-2" />
            <div className="skeleton h-6 w-24" />
          </div>
        ))}
      </div>
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-border-light">
          <div className="skeleton h-4 w-32" />
        </div>
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex gap-4 px-4 py-3 border-b border-border-light last:border-0">
            <div className="skeleton h-4 w-24" />
            <div className="skeleton h-4 flex-1" />
            <div className="skeleton h-4 w-20" />
            <div className="skeleton h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

