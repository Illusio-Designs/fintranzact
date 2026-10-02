import type { KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { useSlidingIndicator } from "@/hooks/useSlidingIndicator";

interface Tab {
  value: string;
  label: string;
  count?: number;
}

interface PillTabsProps {
  tabs: Tab[];
  value: string;
  onChange: (v: string) => void;
  size?: "sm" | "md";
  className?: string;
}

export function PillTabs({ tabs, value, onChange, size = "md", className }: PillTabsProps) {
  const isSmall = size === "sm";
  // The selected pill's background glides between tabs.
  const ind = useSlidingIndicator<HTMLDivElement>(value);
  return (
    <div ref={ind.ref} className={cn("relative flex items-center gap-0.5", isSmall && "bg-surface-1 rounded-md p-0.5", className)}>
      <span
        aria-hidden
        style={ind.style}
        className={cn(
          "pointer-events-none absolute duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
          isSmall ? "rounded-md bg-brand-50 shadow-sm dark:bg-brand-950" : "rounded-full bg-brand-50 dark:bg-brand-950",
        )}
      />
      {tabs.map((tab) => (
        <button
          key={tab.value}
          data-value={tab.value}
          type="button"
          aria-pressed={tab.value === value}
          onClick={() => tab.value !== value && onChange(tab.value)}
          className={cn(
            "relative font-medium transition-colors inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap",
            isSmall ? "px-2 py-0.5 text-2xs rounded-md" : "h-8 px-3 text-ui rounded-full border",
            tab.value === value
              ? cn(
                  isSmall ? "text-brand-700 dark:text-brand-400" : "border-transparent text-brand-700 dark:text-brand-300",
                  !ind.ready && (isSmall ? "bg-brand-50 shadow-sm dark:bg-brand-950" : "bg-brand-50 dark:bg-brand-950"),
                )
              : isSmall
                ? "text-text-tertiary hover:text-text-secondary hover:bg-surface-2"
                : "border-border-light text-text-secondary hover:text-text-primary hover:bg-surface-2"
          )}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span
              className={cn(
                "inline-flex items-center justify-center font-medium tabular-nums text-2xs",
                isSmall && "rounded-full min-w-[18px] px-1",
                tab.value === value
                  ? isSmall
                    ? "bg-brand-100 text-brand-700 dark:bg-brand-900 dark:text-brand-400"
                    : "text-brand-700/80 dark:text-brand-300/80"
                  : isSmall ? "bg-surface-3 text-text-tertiary" : "text-text-tertiary"
              )}
            >
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

interface SegmentedTab {
  value: string;
  label: string;
}

interface SegmentedControlProps {
  tabs: SegmentedTab[];
  value: string;
  onChange: (v: string) => void;
}

export function SegmentedControl({ tabs, value, onChange }: SegmentedControlProps) {
  // The white "selected" card slides to the tab you pick instead of jumping.
  const ind = useSlidingIndicator<HTMLDivElement>(value);
  return (
    <div
      ref={ind.ref}
      className="relative inline-flex rounded-lg p-0.5 bg-surface-1 border border-border-light"
    >
      <span
        aria-hidden
        style={ind.style}
        className="pointer-events-none absolute rounded-md bg-surface-0 shadow-sm duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none"
      />
      {tabs.map((tab) => (
        <button
          key={tab.value}
          data-value={tab.value}
          type="button"
          onClick={() => tab.value !== value && onChange(tab.value)}
          className={cn(
            "relative px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
            tab.value === value
              ? cn("text-text-primary", !ind.ready && "bg-surface-0 shadow-sm")
              : "text-text-tertiary hover:text-text-secondary"
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/**
 * UnderlineTabs: the main way to switch between views of one list (All,
 * Customers, Suppliers). The current tab has a brand-coloured underline and
 * bold label; each can show a count. Arrow keys move between tabs.
 */
export function UnderlineTabs({ tabs, value, onChange, label = "View", className }: {
  tabs: Tab[];
  value: string;
  onChange: (v: string) => void;
  label?: string;
  className?: string;
}) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const index = tabs.findIndex((tab) => tab.value === value);
    const next = tabs[(index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    if (next) {
      onChange(next.value);
      (event.currentTarget.querySelector(`[data-tab="${next.value}"]`) as HTMLElement | null)?.focus();
    }
  }
  return (
    <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className={cn("flex items-end gap-1 overflow-y-hidden overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", className)}>
      {tabs.map((tab) => {
        const selected = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            data-tab={tab.value}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => !selected && onChange(tab.value)}
            className={cn(
              "relative inline-flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-sm transition-colors",
              selected
                ? "border-brand-600 font-semibold text-brand-700 dark:border-brand-400 dark:text-brand-300"
                : "border-transparent font-medium text-text-secondary hover:border-border-color hover:text-text-primary",
            )}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span
                className={cn(
                  "min-w-[22px] rounded-full px-1.5 py-0.5 text-center text-2xs font-semibold tabular-nums",
                  selected
                    ? "bg-brand-100 text-brand-700 dark:bg-brand-900 dark:text-brand-200"
                    : "bg-surface-2 text-text-tertiary",
                )}
              >
                {tab.count.toLocaleString("en-IN")}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
