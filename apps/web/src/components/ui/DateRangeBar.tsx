import { cn } from "@/lib/utils";
import { DATE_PRESETS, type DatePreset } from "@/hooks/useDateRange";
import { Download04Icon } from "@hugeicons/core-free-icons";
import { Icon } from "./Icon";
import { DateInput } from "./DateInput";

import { Spinner } from "./Spinner";
interface DateRangeBarProps {
  preset: DatePreset;
  onPresetChange: (preset: DatePreset) => void;
  customFrom?: string;
  customTo?: string;
  onCustomChange?: (from: string, to: string) => void;
  onExport?: () => void;
  exporting?: boolean;
  className?: string;
  /** "segmented": the presets sit in one bordered control (dashboard header). */
  variant?: "pills" | "segmented";
}

export function DateRangeBar({
  preset,
  onPresetChange,
  customFrom,
  customTo,
  onCustomChange,
  onExport,
  exporting,
  className,
  variant = "pills",
}: DateRangeBarProps) {
  const segmented = variant === "segmented";
  const presetButtons = DATE_PRESETS.map((p) => (
        <button
          key={p.value}
          type="button"
          onClick={() => onPresetChange(p.value)}
          aria-pressed={preset === p.value}
          className={cn(
            "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap",
            segmented
              ? preset === p.value
                ? "bg-brand-600 text-white shadow-sm"
                : "text-text-secondary hover:text-text-primary hover:bg-surface-2"
              : preset === p.value
                ? "bg-brand-600/[0.1] text-brand-700 dark:text-brand-400"
                : "text-text-tertiary hover:text-text-secondary hover:bg-surface-2"
          )}
        >
          {p.label}
        </button>
      ));
  return (
    <div className={cn("flex items-center gap-2 flex-wrap", className)}>
      {segmented ? (
        <div className="flex max-w-full flex-wrap gap-0.5 rounded-xl border border-border-light bg-surface-0 p-1">
          {presetButtons}
        </div>
      ) : (
        presetButtons
      )}

      {preset === "custom" && onCustomChange && (
        <div className="flex items-center gap-2 ml-1">
          <DateInput
            value={customFrom || ""}
            onChange={(e) => onCustomChange(e.target.value, customTo || "")}
            aria-label="From date"
            className="input py-1 text-xs w-36"
          />
          <span className="text-text-tertiary text-xs">to</span>
          <DateInput
            value={customTo || ""}
            onChange={(e) => onCustomChange(customFrom || "", e.target.value)}
            aria-label="To date"
            className="input py-1 text-xs w-36"
          />
        </div>
      )}

      {onExport && (
        <button
          onClick={onExport}
          disabled={exporting}
          className="btn-secondary text-xs px-3 py-1.5 ml-auto shrink-0 inline-flex items-center gap-1.5"
        >
          {exporting ? (
            <>
              <Spinner size="xs" />
              Preparing…
            </>
          ) : (
            <>
              <Icon icon={Download04Icon} size={14} />
              Export CSV
            </>
          )}
        </button>
      )}
    </div>
  );
}
