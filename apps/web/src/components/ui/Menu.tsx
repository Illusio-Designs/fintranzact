/**
 * Menu — a button that opens a list of actions or choices.
 *
 * Used for a table row's "Actions ▾", the "Sort ▾" button above a table and
 * any other small dropdown. The list is rendered in a portal with fixed
 * positioning so a scrolling table never clips it. Arrow keys move, Enter
 * picks, Esc closes and returns focus to the button.
 */
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ArrowDown01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { useAnchoredPopover } from "@/hooks/useAnchoredPopover";
import { usePresence } from "@/hooks/usePresence";
import { Icon } from "./Icon";

export type MenuEntry =
  | {
      kind?: "item";
      label: string;
      onSelect: () => void;
      /** Short text on the right, e.g. a keyboard shortcut. */
      hint?: string;
      danger?: boolean;
      disabled?: boolean;
    }
  | { kind: "radio"; label: string; checked: boolean; onSelect: () => void }
  | { kind: "label"; label: string }
  | { kind: "separator" };

interface MenuProps {
  /** What the button shows. */
  children: ReactNode;
  items: MenuEntry[];
  /** Name read by screen readers for the button, e.g. "Actions for INV-001". */
  "aria-label"?: string;
  /** Name of the list itself, e.g. "Sort by". */
  menuLabel?: string;
  buttonClassName?: string;
  /** Line the list up with the button's left edge or right edge. */
  align?: "start" | "end";
  width?: number;
  /** Hide the ▾ arrow. */
  noChevron?: boolean;
  "data-testid"?: string;
}

export function Menu({
  children,
  items,
  "aria-label": ariaLabel,
  menuLabel,
  buttonClassName,
  align = "start",
  width = 220,
  noChevron,
  "data-testid": testId,
}: MenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const { mounted, closing } = usePresence(open, 100);
  const style = useAnchoredPopover(triggerRef, mounted, {
    width,
    align,
    estimatedHeight: Math.min(420, items.length * 36 + 8),
  });

  const focusable = () =>
    Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("[role^=menuitem]:not(:disabled)") ?? []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!listRef.current?.contains(t) && !triggerRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    // Start on the ticked choice, else the first item.
    const all = focusable();
    (all.find((b) => b.getAttribute("aria-checked") === "true") ?? all[0])?.focus();
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const all = focusable();
    const i = all.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") { e.preventDefault(); all[(i + 1) % all.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); all[(i - 1 + all.length) % all.length]?.focus(); }
    else if (e.key === "Home") { e.preventDefault(); all[0]?.focus(); }
    else if (e.key === "End") { e.preventDefault(); all[all.length - 1]?.focus(); }
    else if (e.key === "Escape") { e.preventDefault(); close(true); }
    else if (e.key === "Tab") close(false);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={ariaLabel}
        data-testid={testId}
        onClick={(e) => {
          // Rows open their detail panel on click; the menu button must not.
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className={cn("btn-secondary gap-1.5", buttonClassName)}
      >
        {children}
        {!noChevron && (
          <Icon
            icon={ArrowDown01Icon}
            size={14}
            className={cn("transition-transform duration-150", open && "rotate-180")}
          />
        )}
      </button>
      {mounted &&
        createPortal(
          <div
            ref={listRef}
            id={menuId}
            role="menu"
            aria-label={menuLabel ?? ariaLabel}
            aria-hidden={closing || undefined}
            onKeyDown={onKey}
            onClick={(e) => e.stopPropagation()}
            // Grows out of the button's corner, and fades out on close.
            style={{ ...style, transformOrigin: `${"bottom" in style ? "bottom" : "top"} ${align === "end" ? "right" : "left"}` }}
            className={cn(
              "z-50 max-h-[420px] overflow-y-auto rounded-xl border border-border-light bg-surface-0 p-1 shadow-dropdown",
              closing ? "pointer-events-none animate-fade-out [animation-duration:100ms]" : "animate-pop-in",
            )}
          >
            {items.map((it, i) => {
              if (it.kind === "separator") {
                return <div key={i} role="separator" className="my-1 h-px bg-border-light" />;
              }
              if (it.kind === "label") {
                return (
                  <div key={i} role="presentation" className="px-3 pb-1 pt-2 text-2xs font-medium text-text-tertiary">
                    {it.label}
                  </div>
                );
              }
              if (it.kind === "radio") {
                return (
                  <button
                    key={i}
                    type="button"
                    role="menuitemradio"
                    aria-checked={it.checked}
                    onClick={() => { close(true); if (!it.checked) it.onSelect(); }}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-ui transition-colors focus-visible:outline-none",
                      it.checked
                        ? "font-semibold text-brand-700 dark:text-brand-400"
                        : "text-text-secondary hover:bg-surface-2 hover:text-text-primary focus-visible:bg-surface-2",
                    )}
                  >
                    {it.label}
                    {it.checked && <Icon icon={Tick02Icon} size={14} />}
                  </button>
                );
              }
              return (
                <button
                  key={i}
                  type="button"
                  role="menuitem"
                  disabled={it.disabled}
                  onClick={() => { close(true); it.onSelect(); }}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-ui transition-colors focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40",
                    it.danger
                      ? "text-red-600 hover:bg-red-600/[0.08] focus-visible:bg-red-600/[0.08] dark:text-red-400"
                      : "text-text-primary hover:bg-surface-2 focus-visible:bg-surface-2",
                  )}
                >
                  {it.label}
                  {it.hint && <span className="text-2xs text-text-tertiary">{it.hint}</span>}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}

/** The "Actions ▾" button at the end of a table row. */
export function RowActions({ items, label }: { items: MenuEntry[]; label: string }) {
  if (!items.some((i) => i.kind === undefined || i.kind === "item")) return null;
  return (
    <Menu
      items={items}
      aria-label={`Actions for ${label}`}
      menuLabel="Actions"
      align="end"
      buttonClassName="h-7 px-2.5 text-xs font-medium"
    >
      Actions
    </Menu>
  );
}

/** Drops separators that would sit at the start, the end, or next to another. */
export function tidyMenu(items: (MenuEntry | false | null | undefined)[]): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const it of items) {
    if (!it) continue;
    if (it.kind === "separator" && (out.length === 0 || out[out.length - 1].kind === "separator")) continue;
    out.push(it);
  }
  while (out.length && out[out.length - 1].kind === "separator") out.pop();
  return out;
}
