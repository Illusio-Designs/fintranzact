import { cn } from "@/lib/utils";
import { DATE_PRESETS, type DatePreset } from "@/hooks/useDateRange";
import { Download04Icon } from "@hugeicons/core-free-icons";
import { Icon } from "./Icon";
import { DateInput } from "./DateInput";

interface DateRangeBarProps {
  preset: DatePreset;
  onPresetChange: (preset: DatePreset) => void;
  customFrom?: string;
  customTo?: string;
  onCustomChange?: (from: string, to: string) => void;
  onExport?: () => void;
  exporting?: boolean;
  className?: string;
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
}: DateRangeBarProps) {
  return (
    <div className={cn("flex items-center gap-2 flex-wrap", className)}>
      {DATE_PRESETS.map((p) => (
        <button
          key={p.value}
          type="button"
          onClick={() => onPresetChange(p.value)}
          className={cn(
            "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
            preset === p.value
              ? "bg-brand-600/[0.1] text-brand-700 dark:text-brand-400"
              : "text-text-tertiary hover:text-text-secondary hover:bg-surface-2"
          )}
        >
          {p.label}
        </button>
      ))}

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
              <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
              Preparing...
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
