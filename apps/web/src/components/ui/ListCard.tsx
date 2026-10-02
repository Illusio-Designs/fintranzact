/**
 * ListCard: the one layout every list page uses, so every table has the same
 * structure.
 *
 *   ┌ tabs (All · Customers · Suppliers, with counts)          ┐
 *   ├ filters (left)                      sort · actions (right)┤
 *   │ table                                                     │
 *   └ rows per page · 1–25 of 200 · ‹ 1 2 3 ›                  ┘
 *
 * Every part is optional except the table (the children). Loading and empty
 * states render inside the card, under the tabs and filters, so the page does
 * not jump around when a filter matches nothing.
 *
 * Use <FilterField> for a labelled dropdown in the filter row.
 */
import { type ReactNode, type Ref } from "react";
import { cn } from "@/lib/utils";
import { Pagination } from "./Pagination";
import { SortMenu, TableScroll, type SortOption, type SortState } from "./Table";
import { UnderlineTabs } from "./Tabs";
import { Select } from "./Select";

export interface ListCardTabs {
  tabs: Array<{ value: string; label: string; count?: number }>;
  value: string;
  onChange: (value: string) => void;
  /** Accessible name of the tab list, e.g. "Party type". */
  label?: string;
}

export interface ListCardPagination {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  total: number;
  pageSize: number;
  onPageSizeChange?: (size: number) => void;
  /** Rows-per-page choices, when the default 10 / 25 / 50 / 100 do not fit (e.g. the server caps a page at 50). */
  pageSizeOptions?: number[];
}

interface ListCardProps<K extends string> {
  /** A plain heading for a card that has no tabs, e.g. "Past counts". */
  title?: ReactNode;
  /** A number shown beside the title. */
  titleCount?: number;
  tabs?: ListCardTabs;
  /** Filters, on the left of the filter row. */
  filters?: ReactNode;
  /** Sorting, shown as a menu beside the filters. */
  sort?: { options: SortOption<K>[]; value: SortState<K>; onChange: (sort: SortState<K>) => void };
  /** Buttons on the right of the filter row (Export CSV and so on). */
  actions?: ReactNode;
  /** Shown as "Clear filters" when set. */
  onClearFilters?: () => void;
  pagination?: ListCardPagination;
  /** First load: rows are not here yet. */
  loading?: boolean;
  /** A reload is in progress (the current rows dim). */
  fetching?: boolean;
  /** Rendered instead of the table when there are no rows. */
  empty?: ReactNode;
  /** Ref to the scrolling table area, to reset its scroll on a new page. */
  tableRef?: Ref<HTMLDivElement>;
  className?: string;
  /** The <table className="data-table">. */
  children?: ReactNode;
}

export function ListCard<K extends string = string>({
  title,
  titleCount,
  tabs,
  filters,
  sort,
  actions,
  onClearFilters,
  pagination,
  loading = false,
  fetching = false,
  empty,
  tableRef,
  className,
  children,
}: ListCardProps<K>) {
  const hasToolbar = Boolean(filters || sort || actions || onClearFilters);
  return (
    <div className={cn("card overflow-clip border-border-color shadow-sm", className)}>
      {title && !tabs && (
        <div className="flex items-center gap-2 border-b border-border-light bg-surface-0 px-4 py-3">
          <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
          {titleCount !== undefined && (
            <span className="min-w-[22px] rounded-full bg-surface-2 px-1.5 py-0.5 text-center text-2xs font-semibold tabular-nums text-text-tertiary">
              {titleCount.toLocaleString("en-IN")}
            </span>
          )}
        </div>
      )}

      {tabs && (
        <div className="border-b border-border-light bg-surface-0 px-2">
          <UnderlineTabs tabs={tabs.tabs} value={tabs.value} onChange={tabs.onChange} label={tabs.label} />
        </div>
      )}

      {hasToolbar && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border-light bg-surface-0 px-4 py-3">
          {filters}
          {sort && <SortMenu options={sort.options} sort={sort.value} onSort={sort.onChange} />}
          {onClearFilters && (
            <button
              type="button"
              className="text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300"
              onClick={onClearFilters}
            >
              Clear filters
            </button>
          )}
          {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}

      {loading ? (
        <div className="space-y-2 p-4" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton h-12 rounded-lg" />
          ))}
        </div>
      ) : empty ? (
        empty
      ) : (
        <div className={cn("transition-opacity", fetching && "opacity-60")}>
          <TableScroll ref={tableRef}>{children}</TableScroll>
          {pagination && (
            <Pagination
              page={pagination.page}
              totalPages={pagination.totalPages}
              onPageChange={pagination.onPageChange}
              total={pagination.total}
              pageSize={pagination.pageSize}
              onPageSizeChange={pagination.onPageSizeChange}
              pageSizeOptions={pagination.pageSizeOptions}
              alwaysShow
            />
          )}
        </div>
      )}
    </div>
  );
}

/** A labelled dropdown for the filter row: "Balance [All balances ▾]". */
export function FilterField({
  label,
  value,
  onChange,
  children,
  className = "w-[170px]",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** <option> elements. */
  children: ReactNode;
  /** Width class for the dropdown. */
  className?: string;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-text-tertiary">
      {label}
      <Select
        aria-label={`Filter by ${label.toLowerCase()}`}
        className={cn("h-8 py-0 text-xs", className)}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {children}
      </Select>
    </label>
  );
}
