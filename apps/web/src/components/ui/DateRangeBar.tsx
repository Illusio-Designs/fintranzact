import { cn } from "@/lib/utils";
import { DATE_PRESETS, type DatePreset } from "@/hooks/useDateRange";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { ArrowDown01Icon, Calendar03Icon, Download04Icon, Tick02Icon } from "@hugeicons/core-free-icons";
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
  /** Kept for existing callers; both variants now render the same date menu. */
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
}: DateRangeBarProps) {
  // One "This Month ▾" button opens the ranges (was 7 buttons in a row).
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();
  const current = DATE_PRESETS.find((p) => p.value === preset) ?? DATE_PRESETS[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    const i = Math.max(0, DATE_PRESETS.findIndex((p) => p.value === preset));
    itemRefs.current[i]?.focus();
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, preset]);

  const choose = (value: DatePreset) => {
    setOpen(false);
    triggerRef.current?.focus();
    if (value !== preset) onPresetChange(value);
  };

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = itemRefs.current.filter(Boolean) as HTMLButtonElement[];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
    else if (e.key === "Home") { e.preventDefault(); items[0]?.focus(); }
    else if (e.key === "End") { e.preventDefault(); items[items.length - 1]?.focus(); }
    else if (e.key === "Escape" || e.key === "Tab") { setOpen(false); if (e.key === "Escape") triggerRef.current?.focus(); }
  };

  return (
    <div className={cn("flex items-center gap-2 flex-wrap", className)}>
      <div ref={wrapRef} className="relative">
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={menuId}
          aria-label={`Date range: ${current.label}`}
          onClick={() => setOpen((o) => !o)}
          className="btn-secondary text-xs px-3 py-1.5 gap-1.5"
        >
          <Icon icon={Calendar03Icon} size={14} />
          <span className="text-text-primary font-semibold">{current.label}</span>
          <Icon icon={ArrowDown01Icon} size={14} className={cn("transition-transform duration-150", open && "rotate-180")} />
        </button>
        {open && (
          <div
            id={menuId}
            role="menu"
            aria-label="Date range"
            onKeyDown={onMenuKey}
            className="absolute left-0 top-full z-30 mt-1.5 w-48 origin-top-left animate-scale-in rounded-xl border border-border-light bg-surface-0 p-1 shadow-dropdown"
          >
            {DATE_PRESETS.map((p, i) => (
              <button
                key={p.value}
                ref={(el) => { itemRefs.current[i] = el; }}
                type="button"
                role="menuitemradio"
                aria-checked={preset === p.value}
                onClick={() => choose(p.value)}
                className={cn(
                  "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-ui transition-colors",
                  preset === p.value
                    ? "font-semibold text-brand-700 dark:text-brand-400"
                    : "text-text-secondary hover:bg-surface-2 hover:text-text-primary focus-visible:bg-surface-2",
                )}
              >
                {p.label}
                {preset === p.value && <Icon icon={Tick02Icon} size={14} />}
              </button>
            ))}
          </div>
        )}
      </div>

      {preset === "custom" && onCustomChange && (
        <div className="flex items-center gap-2">
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
