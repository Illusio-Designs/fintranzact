import { cn } from "@/lib/utils";

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
  return (
    <div className={cn("flex items-center gap-0.5", isSmall && "bg-surface-1 rounded-md p-0.5", className)}>
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          aria-pressed={tab.value === value}
          onClick={() => tab.value !== value && onChange(tab.value)}
          className={cn(
            "font-medium transition-colors inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap",
            isSmall ? "px-2 py-0.5 text-2xs rounded-md" : "h-8 px-3 text-ui rounded-full border",
            tab.value === value
              ? isSmall
                ? "bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-400 shadow-sm"
                : "border-transparent bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300"
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
  return (
    <div
      className="inline-flex rounded-lg p-0.5 bg-surface-1 border border-border-light"
    >
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          onClick={() => tab.value !== value && onChange(tab.value)}
          className={cn(
            "px-3 py-1.5 rounded-md text-sm font-medium transition",
            tab.value === value
              ? "bg-surface-0 shadow-sm text-text-primary"
              : "text-text-tertiary hover:text-text-secondary"
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
