import {
  Children,
  Fragment,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ArrowDown01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { useAnchoredPopover } from "@/hooks/useAnchoredPopover";
import { Icon } from "./Icon";

/** The subset of a change event that callers of a native <select> read. */
export interface SelectChangeEvent {
  target: { value: string; name: string };
  currentTarget: { value: string; name: string };
}

export interface SelectProps {
  value?: string | number | readonly string[];
  defaultValue?: string | number;
  onChange?: (e: SelectChangeEvent) => void;
  /** `<option>` and `<optgroup>` elements, exactly as for a native `<select>`. */
  children: ReactNode;
  id?: string;
  name?: string;
  className?: string;
  disabled?: boolean;
  required?: boolean;
  title?: string;
  placeholder?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
  "data-testid"?: string;
}

interface ParsedOption {
  value: string;
  label: string;
  disabled: boolean;
  group?: string;
}

function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

function parseOptions(children: ReactNode, group?: string, out: ParsedOption[] = []): ParsedOption[] {
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const el = child as ReactElement<{
      value?: string | number;
      children?: ReactNode;
      disabled?: boolean;
      label?: string;
      hidden?: boolean;
    }>;
    if (el.type === Fragment) {
      parseOptions(el.props.children, group, out);
    } else if (el.type === "optgroup") {
      parseOptions(el.props.children, el.props.label, out);
    } else if (el.type === "option") {
      if (el.props.hidden) return;
      const label = textOf(el.props.children);
      out.push({
        value: el.props.value !== undefined ? String(el.props.value) : label,
        label,
        disabled: !!el.props.disabled,
        group,
      });
    }
  });
  return out;
}

/**
 * Custom-styled drop-in replacement for a native `<select>`.
 *
 * Accepts the same `<option>` / `<optgroup>` children and calls `onChange`
 * with an event-like object whose `target.value` is the chosen value, so
 * existing `onChange={(e) => set(e.target.value)}` handlers keep working.
 * The list is rendered in a portal so it is never clipped by tables or
 * modal bodies, and supports full keyboard navigation and typeahead.
 */
export function Select({
  value,
  defaultValue,
  onChange,
  children,
  id,
  name = "",
  className,
  disabled,
  required,
  title,
  placeholder = "Select…",
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  "data-testid": testId,
}: SelectProps) {
  const options = useMemo(() => parseOptions(children), [children]);
  const isControlled = value !== undefined;
  const [inner, setInner] = useState<string>(
    defaultValue !== undefined ? String(defaultValue) : (options[0]?.value ?? ""),
  );
  const current = isControlled ? String(value) : inner;

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const uid = useId();
  const listId = `select-list-${uid}`;
  const popoverStyle = useAnchoredPopover(triggerRef, open, {
    estimatedHeight: Math.min(280, options.length * 38 + 12),
  });

  const selected = options.find((o) => o.value === current) ?? null;
  const typeahead = useRef({ q: "", timer: 0 as unknown as ReturnType<typeof setTimeout> });

  const nextEnabled = useCallback(
    (from: number, step: 1 | -1) => {
      for (let i = from + step; i >= 0 && i < options.length; i += step) {
        if (!options[i].disabled) return i;
      }
      return from;
    },
    [options],
  );

  const openList = useCallback(() => {
    if (disabled) return;
    const idx = options.findIndex((o) => o.value === current);
    setActiveIndex(idx >= 0 ? idx : nextEnabled(-1, 1));
    setOpen(true);
  }, [disabled, options, current, nextEnabled]);

  const closeList = useCallback((refocus = true) => {
    setOpen(false);
    setActiveIndex(-1);
    if (refocus) triggerRef.current?.focus();
  }, []);

  const choose = useCallback(
    (index: number) => {
      const opt = options[index];
      if (opt && !opt.disabled) {
        if (!isControlled) setInner(opt.value);
        if (opt.value !== current) {
          const target = { value: opt.value, name };
          onChange?.({ target, currentTarget: target });
        }
      }
      closeList();
    },
    [options, isControlled, current, name, onChange, closeList],
  );

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!triggerRef.current?.contains(t) && !listRef.current?.contains(t)) closeList(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, closeList]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [open, activeIndex]);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    switch (e.key) {
      case "Enter":
      case " ":
        e.preventDefault();
        if (open) choose(activeIndex);
        else openList();
        break;
      case "ArrowDown":
        e.preventDefault();
        if (!open) openList();
        else setActiveIndex((i) => nextEnabled(i, 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        if (!open) openList();
        else setActiveIndex((i) => nextEnabled(i, -1));
        break;
      case "Home":
        if (open) {
          e.preventDefault();
          setActiveIndex(nextEnabled(-1, 1));
        }
        break;
      case "End":
        if (open) {
          e.preventDefault();
          setActiveIndex(nextEnabled(options.length, -1));
        }
        break;
      case "Escape":
        if (open) {
          e.preventDefault();
          e.stopPropagation();
          closeList();
        }
        break;
      case "Tab":
        if (open) closeList(false);
        break;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          if (!open) openList();
          const ta = typeahead.current;
          clearTimeout(ta.timer);
          ta.q += e.key.toLowerCase();
          const idx = options.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(ta.q));
          if (idx >= 0) setActiveIndex(idx);
          ta.timer = setTimeout(() => (ta.q = ""), 500);
        }
    }
  };

  const invalid = ariaInvalid === true || ariaInvalid === "true";

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        aria-required={required || undefined}
        data-testid={testId}
        data-value={current}
        title={title}
        disabled={disabled}
        onClick={() => (open ? closeList() : openList())}
        onKeyDown={onKeyDown}
        className={cn(
          "input flex items-center justify-between gap-2 text-left cursor-pointer select-none",
          open && "input-open",
          invalid && "border-red-500",
          className,
        )}
      >
        <span className={cn("min-w-0 flex-1 truncate", !selected && "text-text-tertiary")}>
          {selected ? selected.label : placeholder}
        </span>
        <Icon
          icon={ArrowDown01Icon}
          size={16}
          className={cn("text-text-tertiary transition-transform duration-150", open && "rotate-180")}
        />
      </button>
      {name && <input type="hidden" name={name} value={current} />}
      {open &&
        createPortal(
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={ariaLabel}
            aria-labelledby={ariaLabel ? undefined : ariaLabelledBy}
            style={{ ...popoverStyle, minWidth: 160 }}
            className="z-[80] max-h-72 overflow-y-auto rounded-xl border border-border bg-surface-0 p-1.5 shadow-dropdown animate-scale-in"
          >
            {options.map((o, i) => {
              const isSelected = o.value === current;
              const showGroup = o.group && o.group !== options[i - 1]?.group;
              return (
                <Fragment key={`${o.value}-${i}`}>
                  {showGroup && (
                    <li role="presentation" className="px-2.5 pb-1 pt-2 text-2xs font-semibold uppercase tracking-wide text-text-tertiary">
                      {o.group}
                    </li>
                  )}
                  <li
                    id={`${listId}-${i}`}
                    data-index={i}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={o.disabled || undefined}
                    onMouseEnter={() => !o.disabled && setActiveIndex(i)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      if (!o.disabled) choose(i);
                    }}
                    className={cn(
                      "flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-sm text-text-primary",
                      i === activeIndex && "bg-surface-2",
                      isSelected && "font-semibold text-brand-700 dark:text-brand-300",
                      o.disabled && "cursor-not-allowed opacity-45",
                    )}
                  >
                    <span className={cn("min-w-0 flex-1 truncate", !o.value && !isSelected && "text-text-tertiary")}>
                      {o.label || " "}
                    </span>
                    {isSelected && <Icon icon={Tick02Icon} size={16} className="text-brand-600 dark:text-brand-300" />}
                  </li>
                </Fragment>
              );
            })}
          </ul>,
          document.body,
        )}
    </>
  );
}
