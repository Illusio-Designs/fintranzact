import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { Icon } from "./Icon";

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  total: number;
  pageSize: number;
}

export function Pagination({ page, totalPages, onPageChange, total, pageSize }: PaginationProps) {
  if (totalPages <= 1) return null;

  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <div className="flex items-center justify-between px-4 py-2.5 border-t border-border-light bg-surface-1 text-xs">
      <span className="text-text-tertiary">
        Showing {start}–{end} of {total}
      </span>
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="inline-flex items-center gap-1 pl-1.5 pr-3 py-1 rounded-full font-medium text-text-secondary hover:bg-surface-2 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <Icon icon={ArrowLeft01Icon} size={14} />
          Prev
        </button>
        <span className="px-2 py-1 text-text-tertiary tabular-nums">
          {page} / {totalPages}
        </span>
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="inline-flex items-center gap-1 pl-3 pr-1.5 py-1 rounded-full font-medium text-text-secondary hover:bg-surface-2 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          Next
          <Icon icon={ArrowRight01Icon} size={14} />
        </button>
      </div>
    </div>
  );
}
