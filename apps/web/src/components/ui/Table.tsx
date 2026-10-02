/**
 * Shared table pieces: a column header that sorts, the "Sort ▾" menu above
 * the table, and the scrolling box that keeps the header row in view.
 * Sorting by a column header and by the menu change the same state, so the
 * two always agree.
 */
import type { ReactNode, Ref } from "react";
import { ArrowDown01Icon, ArrowUp01Icon, ArrowUpDownIcon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { Icon } from "./Icon";
import { Menu } from "./Menu";

export type SortDir = "asc" | "desc";
export interface SortState<K extends string> {
  key: K;
  dir: SortDir;
}

/** One way to sort a list, e.g. { key: "date", dir: "desc", label: "Newest first" }. */
export interface SortOption<K extends string> extends SortState<K> {
  label: string;
}

interface SortableThProps<K extends string> {
  children: ReactNode;
  sortKey: K;
  sort: SortState<K>;
  onSort: (next: SortState<K>) => void;
  /** Direction used on the first click (dates and amounts start high-to-low). */
  firstDir?: SortDir;
  align?: "left" | "right";
  className?: string;
}

/** A column header that sorts on click: first click uses `firstDir`, the next flips it. */
export function SortableTh<K extends string>({
  children,
  sortKey,
  sort,
  onSort,
  firstDir = "asc",
  align = "left",
  className,
}: SortableThProps<K>) {
  const active = sort.key === sortKey;
  const ariaSort = active ? (sort.dir === "asc" ? "ascending" : "descending") : "none";
  return (
    <th aria-sort={ariaSort} className={cn("whitespace-nowrap", align === "right" && "text-right", className)}>
      <button
        type="button"
        onClick={() => onSort({ key: sortKey, dir: active ? (sort.dir === "asc" ? "desc" : "asc") : firstDir })}
        className={cn(
          "group/sort -mx-1 inline-flex items-center gap-1 rounded px-1 transition-colors hover:text-text-primary",
          align === "right" && "flex-row-reverse",
          active && "font-semibold text-text-primary",
        )}
      >
        {children}
        <Icon
          icon={active ? (sort.dir === "asc" ? ArrowUp01Icon : ArrowDown01Icon) : ArrowUpDownIcon}
          size={12}
          className={cn(active ? "text-brand-600 dark:text-brand-400" : "opacity-0 transition-opacity group-hover/sort:opacity-60")}
        />
      </button>
    </th>
  );
}

/** "⇅ Sort: Newest first ▾" — the same sorts as the column headers, plus ones without a column. */
export function SortMenu<K extends string>({
  options,
  sort,
  onSort,
}: {
  options: SortOption<K>[];
  sort: SortState<K>;
  onSort: (next: SortState<K>) => void;
}) {
  const current = options.find((o) => o.key === sort.key && o.dir === sort.dir);
  return (
    <Menu
      aria-label={`Sort by: ${current?.label ?? "custom"}`}
      menuLabel="Sort by"
      buttonClassName="h-7 px-2.5 text-xs"
      items={options.map((o) => ({
        kind: "radio" as const,
        label: o.label,
        checked: o === current,
        onSelect: () => onSort({ key: o.key, dir: o.dir }),
      }))}
    >
      <Icon icon={ArrowUpDownIcon} size={14} />
      <span className="text-text-tertiary">Sort:</span>
      <span className="font-semibold text-text-primary">{current?.label ?? "Custom"}</span>
    </Menu>
  );
}

/**
 * The box a list table scrolls in. The header row stays in view while the
 * rows scroll, and wide tables scroll sideways on small screens instead of
 * squeezing.
 */
export function TableScroll({
  children,
  className,
  ref,
}: {
  children: ReactNode;
  className?: string;
  ref?: Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={ref}
      className={cn("max-h-[max(320px,calc(100dvh-440px))] overflow-auto overscroll-contain", className)}
      // Keyboard users can scroll a wide table with the arrow keys.
      tabIndex={0}
      role="region"
      aria-label="Table"
    >
      {children}
    </div>
  );
}
