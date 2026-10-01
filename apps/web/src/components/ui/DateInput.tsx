import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Calendar03Icon,
} from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { useAnchoredPopover } from "@/hooks/useAnchoredPopover";
import { Icon } from "./Icon";

/** The subset of a change event that callers of a native date input read. */
export interface DateChangeEvent {
  target: { value: string; name: string };
  currentTarget: { value: string; name: string };
}

export interface DateInputProps {
  /** ISO date `YYYY-MM-DD`, or "" for empty — same as a native date input. */
  value?: string | null;
  defaultValue?: string;
  onChange?: (e: DateChangeEvent) => void;
  onBlur?: () => void;
  min?: string;
  max?: string;
  id?: string;
  name?: string;
  className?: string;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
  "data-testid"?: string;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

const pad = (n: number) => String(n).padStart(2, "0");
const toIso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const todayIso = () => {
  const d = new Date();
  return toIso(d.getFullYear(), d.getMonth(), d.getDate());
};
function parseIso(v: string | null | undefined): { y: number; m: number; d: number } | null {
  const match = v ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(v) : null;
  return match ? { y: +match[1], m: +match[2] - 1, d: +match[3] } : null;
}
function addDays(iso: string, days: number): string {
  const p = parseIso(iso)!;
  const d = new Date(p.y, p.m, p.d + days);
  return toIso(d.getFullYear(), d.getMonth(), d.getDate());
}
/** Display format used across the app, e.g. "29 Sep 2026". */
export function formatDisplayDate(iso: string): string {
  const p = parseIso(iso);
  return p ? `${p.d} ${MONTHS[p.m].slice(0, 3)} ${p.y}` : "";
}

/**
 * Custom-styled drop-in replacement for `<input type="date">` with a calendar
 * popover. Values stay ISO `YYYY-MM-DD` strings and `onChange` receives an
 * event-like object, so existing `e.target.value` handlers keep working.
 *
 * Keyboard: Enter/Space/ArrowDown opens; arrows move by day/week; PageUp/Down
 * by month; Enter picks; Escape closes; Delete/Backspace clears (when not required).
 */
export function DateInput({
  value,
  defaultValue,
  onChange,
  onBlur,
  min,
  max,
  id,
  name = "",
  className,
  disabled,
  required,
  placeholder = "Select date",
  autoFocus,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  "data-testid": testId,
}: DateInputProps) {
  const isControlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue ?? "");
  const current = (isControlled ? value : inner) ?? "";

  const [open, setOpen] = useState(false);
  const [focusIso, setFocusIso] = useState(current || todayIso());
  const [view, setView] = useState(() => {
    const p = parseIso(current) ?? parseIso(todayIso())!;
    return { y: p.y, m: p.m };
  });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const uid = useId();
  const popId = `date-pop-${uid}`;
  const popoverStyle = useAnchoredPopover(triggerRef, open, { width: 296, estimatedHeight: 340 });

  const outOfRange = useCallback(
    (iso: string) => (!!min && iso < min) || (!!max && iso > max),
    [min, max],
  );

  const emit = useCallback(
    (iso: string) => {
      if (!isControlled) setInner(iso);
      if (iso !== current) {
        const target = { value: iso, name };
        onChange?.({ target, currentTarget: target });
      }
    },
    [isControlled, current, name, onChange],
  );

  const openCal = useCallback(() => {
    if (disabled) return;
    const start = current || todayIso();
    const p = parseIso(start)!;
    setFocusIso(start);
    setView({ y: p.y, m: p.m });
    setOpen(true);
  }, [disabled, current]);

  const closeCal = useCallback(
    (refocus = true) => {
      setOpen(false);
      if (refocus) triggerRef.current?.focus();
      onBlur?.();
    },
    [onBlur],
  );

  const pick = useCallback(
    (iso: string) => {
      if (outOfRange(iso)) return;
      emit(iso);
      closeCal();
    },
    [outOfRange, emit, closeCal],
  );

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!triggerRef.current?.contains(t) && !popRef.current?.contains(t)) closeCal(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, closeCal]);

  const moveFocus = (iso: string) => {
    setFocusIso(iso);
    const p = parseIso(iso)!;
    setView({ y: p.y, m: p.m });
  };
  const shiftMonth = (k: number) => {
    const d = new Date(view.y, view.m + k, 1);
    setView({ y: d.getFullYear(), m: d.getMonth() });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        openCal();
      } else if ((e.key === "Delete" || e.key === "Backspace") && !required && current) {
        e.preventDefault();
        emit("");
      }
      return;
    }
    const map: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key in map) {
      e.preventDefault();
      moveFocus(addDays(focusIso, map[e.key]));
    } else if (e.key === "PageUp" || e.key === "PageDown") {
      e.preventDefault();
      const p = parseIso(focusIso)!;
      const d = new Date(p.y, p.m + (e.key === "PageUp" ? -1 : 1), Math.min(p.d, 28));
      moveFocus(toIso(d.getFullYear(), d.getMonth(), d.getDate()));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pick(focusIso);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeCal();
    } else if (e.key === "Tab") {
      closeCal(false);
    }
  };

  const cells = useMemo(() => {
    const lead = (new Date(view.y, view.m, 1).getDay() + 6) % 7;
    const days = new Date(view.y, view.m + 1, 0).getDate();
    const out: Array<string | null> = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= days; d++) out.push(toIso(view.y, view.m, d));
    return out;
  }, [view]);

  const today = todayIso();
  const invalid = ariaInvalid === true || ariaInvalid === "true";

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        aria-required={required || undefined}
        data-testid={testId}
        data-value={current}
        disabled={disabled}
        autoFocus={autoFocus}
        onClick={() => (open ? closeCal() : openCal())}
        onKeyDown={onKeyDown}
        className={cn(
          "input flex items-center gap-2 text-left cursor-pointer select-none",
          open && "input-open",
          invalid && "border-red-500",
          className,
        )}
      >
        <Icon icon={Calendar03Icon} size={16} className="text-text-tertiary" />
        <span className={cn("min-w-0 flex-1 truncate", !current && "text-text-tertiary")}>
          {current ? formatDisplayDate(current) : placeholder}
        </span>
      </button>
      {name && <input type="hidden" name={name} value={current} />}
      {open &&
        createPortal(
          <div
            ref={popRef}
            id={popId}
            role="dialog"
            aria-label="Choose date"
            style={popoverStyle}
            onMouseDown={(e) => e.preventDefault()}
            className="z-[80] rounded-2xl border border-border bg-surface-0 p-3 shadow-dropdown animate-scale-in"
          >
            <div className="mb-2 flex items-center justify-between">
              <button
                type="button"
                tabIndex={-1}
                onClick={() => shiftMonth(-1)}
                aria-label="Previous month"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-surface-2 text-text-secondary hover:text-text-primary"
              >
                <Icon icon={ArrowLeft01Icon} size={16} />
              </button>
              <span className="text-sm font-semibold text-text-primary" aria-live="polite">
                {MONTHS[view.m]} {view.y}
              </span>
              <button
                type="button"
                tabIndex={-1}
                onClick={() => shiftMonth(1)}
                aria-label="Next month"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-surface-2 text-text-secondary hover:text-text-primary"
              >
                <Icon icon={ArrowRight01Icon} size={16} />
              </button>
            </div>
            <div role="grid" className="grid grid-cols-7 gap-0.5 text-center">
              {WEEKDAYS.map((w) => (
                <span key={w} role="columnheader" className="py-1 text-2xs font-semibold text-text-tertiary">
                  {w}
                </span>
              ))}
              {cells.map((iso, i) =>
                iso === null ? (
                  <span key={`e${i}`} />
                ) : (
                  <button
                    key={iso}
                    type="button"
                    role="gridcell"
                    tabIndex={-1}
                    aria-selected={iso === current}
                    aria-label={formatDisplayDate(iso)}
                    disabled={outOfRange(iso)}
                    onClick={() => pick(iso)}
                    className={cn(
                      "h-9 rounded-full text-ui tabular-nums text-text-primary transition-colors",
                      "hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent",
                      iso === today && iso !== current && "font-bold ring-1 ring-inset ring-brand-500",
                      iso === focusIso && iso !== current && "bg-surface-2",
                      iso === current && "bg-brand-600 font-bold text-white hover:bg-brand-700",
                    )}
                  >
                    {Number(iso.slice(8))}
                  </button>
                ),
              )}
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-border-light pt-2">
              <button
                type="button"
                tabIndex={-1}
                disabled={outOfRange(today)}
                onClick={() => pick(today)}
                className="rounded-md px-2 py-1 text-xs font-semibold text-brand-600 hover:bg-surface-2 disabled:opacity-40 dark:text-brand-300"
              >
                Today
              </button>
              {!required && current && (
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => {
                    emit("");
                    closeCal();
                  }}
                  className="rounded-md px-2 py-1 text-xs font-semibold text-text-tertiary hover:bg-surface-2"
                >
                  Clear
                </button>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
