/**
 * Pagination — the bar above and below a table.
 *
 * Bottom (default): "Rows per page [25]   1–25 of 200   ‹ 1 2 3 … 8 ›".
 * Top: the Sort menu and a compact "‹ Page [1] of 8 ›" so long lists can be
 * paged without scrolling to the end. Both read the same page state, so they
 * always agree.
 */
import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Icon } from "./Icon";
import { Select } from "./Select";

export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  total: number;
  pageSize: number;
  /** Shows the "Rows per page" choice when given. */
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
  placement?: "top" | "bottom";
  /** Extra controls on the top bar's left, e.g. the Sort menu. */
  children?: ReactNode;
  className?: string;
}

/** Page numbers to show: always the first, last and the two around the current one. */
export function pageList(page: number, totalPages: number): (number | "…")[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const out: (number | "…")[] = [1];
  const from = Math.max(2, Math.min(page - 1, totalPages - 4));
  const to = Math.min(totalPages - 1, Math.max(page + 1, 5));
  if (from > 2) out.push("…");
  for (let p = from; p <= to; p++) out.push(p);
  if (to < totalPages - 1) out.push("…");
  out.push(totalPages);
  return out;
}

const arrowBtn =
  "inline-flex h-7 w-7 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent";

export function Pagination({
  page,
  totalPages,
  onPageChange,
  total,
  pageSize,
  onPageSizeChange,
  pageSizeOptions = PAGE_SIZE_OPTIONS,
  placement = "bottom",
  children,
  className,
}: PaginationProps) {
  const canResize = !!onPageSizeChange && total > Math.min(...pageSizeOptions);
  if (total === 0 || (totalPages <= 1 && !canResize && !children)) return null;

  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  const range = (
    <span className="tabular-nums text-text-tertiary">
      {start.toLocaleString("en-IN")}–{end.toLocaleString("en-IN")} of {total.toLocaleString("en-IN")}
    </span>
  );
  const prev = (
    <button type="button" className={arrowBtn} onClick={() => onPageChange(page - 1)} disabled={page <= 1} aria-label="Previous page">
      <Icon icon={ArrowLeft01Icon} size={14} />
    </button>
  );
  const next = (
    <button type="button" className={arrowBtn} onClick={() => onPageChange(page + 1)} disabled={page >= totalPages} aria-label="Next page">
      <Icon icon={ArrowRight01Icon} size={14} />
    </button>
  );

  if (placement === "top") {
    return (
      <nav
        aria-label="Pages, top"
        className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border-light bg-surface-1 px-4 py-2 text-xs", className)}
      >
        {children}
        {/* The "1–25 of 200" count sits in the bottom bar only, so it isn't shown twice. */}
        {totalPages > 1 && (
          <div className="ml-auto flex items-center gap-1">
            {prev}
            <span className="text-text-tertiary">Page</span>
            <Select
              aria-label="Go to page"
              className="h-7 w-[68px] py-0 text-xs"
              value={String(page)}
              onChange={(e) => onPageChange(Number(e.target.value))}
            >
              {Array.from({ length: totalPages }, (_, i) => (
                <option key={i + 1} value={String(i + 1)}>{i + 1}</option>
              ))}
            </Select>
            <span className="text-text-tertiary">of {totalPages}</span>
            {next}
          </div>
        )}
      </nav>
    );
  }

  return (
    <nav
      aria-label="Pages"
      className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border-light bg-surface-1 px-4 py-2.5 text-xs", className)}
    >
      {canResize && (
        <label className="flex items-center gap-2 text-text-tertiary">
          Rows per page
          <Select
            aria-label="Rows per page"
            className="h-7 w-[72px] py-0 text-xs"
            value={String(pageSize)}
            onChange={(e) => onPageSizeChange?.(Number(e.target.value))}
          >
            {pageSizeOptions.map((n) => (
              <option key={n} value={String(n)}>{n}</option>
            ))}
          </Select>
        </label>
      )}
      {range}
      {totalPages > 1 && (
        <div className="ml-auto flex items-center gap-1">
          {prev}
          {pageList(page, totalPages).map((p, i) =>
            p === "…" ? (
              <span key={`gap-${i}`} className="w-6 text-center text-text-tertiary" aria-hidden="true">…</span>
            ) : (
              <button
                key={p}
                type="button"
                onClick={() => onPageChange(p)}
                aria-current={p === page ? "page" : undefined}
                aria-label={`Page ${p}`}
                className={cn(
                  "h-7 min-w-7 rounded-lg px-1.5 tabular-nums transition-colors",
                  p === page
                    ? "bg-brand-50 font-semibold text-brand-700 dark:bg-brand-950/40 dark:text-brand-300"
                    : "text-text-secondary hover:bg-surface-2 hover:text-text-primary",
                )}
              >
                {p}
              </button>
            ),
          )}
          {next}
        </div>
      )}
    </nav>
  );
}
