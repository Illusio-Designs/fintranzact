import { useState, useRef, useEffect, useCallback, KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { Add01Icon, Tick02Icon, UnfoldMoreIcon } from "@hugeicons/core-free-icons";
import { Icon } from "./Icon";

interface BusinessSwitcherProps {
  businesses: Array<{ id: string; name: string }>;
  activeBusinessId: string;
  onSwitch: (id: string) => void;
  onCreateNew?: () => void;
  /** "sidebar": a card on the navy sidebar, with a second line (e.g. GSTIN). */
  variant?: "default" | "sidebar";
  subtitle?: string;
  /** Sidebar collapsed to an icon rail: show only the initial tile. */
  collapsed?: boolean;
}

export function BusinessSwitcher({
  businesses,
  activeBusinessId,
  onSwitch,
  onCreateNew,
  variant = "default",
  subtitle,
  collapsed = false,
}: BusinessSwitcherProps) {
  const sidebar = variant === "sidebar";
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const activeBusiness = businesses.find((b) => b.id === activeBusinessId) ?? businesses[0];

  const close = useCallback(() => {
    setOpen(false);
    setFocusedIndex(-1);
  }, []);

  const toggle = useCallback(() => {
    setOpen((prev) => {
      if (!prev) {
        const idx = businesses.findIndex((b) => b.id === activeBusinessId);
        setFocusedIndex(idx >= 0 ? idx : 0);
      } else {
        setFocusedIndex(-1);
      }
      return !prev;
    });
  }, [businesses, activeBusinessId]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        close();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, close]);

  // Scroll focused option into view
  useEffect(() => {
    if (!open || focusedIndex < 0) return;
    const el = menuRef.current?.querySelector(
      `[data-index="${focusedIndex}"]`
    ) as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest" });
  }, [focusedIndex, open]);

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    switch (e.key) {
      case "Enter":
      case " ":
        e.preventDefault();
        if (!open) {
          toggle();
        } else if (focusedIndex >= 0 && focusedIndex < businesses.length) {
          onSwitch(businesses[focusedIndex].id);
          close();
          triggerRef.current?.focus();
        }
        break;
      case "ArrowDown":
        e.preventDefault();
        if (!open) {
          toggle();
        } else {
          setFocusedIndex((i) => Math.min(i + 1, businesses.length - 1));
        }
        break;
      case "ArrowUp":
        e.preventDefault();
        if (open) {
          setFocusedIndex((i) => Math.max(i - 1, 0));
        }
        break;
      case "Escape":
        e.preventDefault();
        close();
        triggerRef.current?.focus();
        break;
      case "Tab":
        if (open) close();
        break;
    }
  };

  if (!activeBusiness) return null;

  const activeInitial = activeBusiness.name.charAt(0).toUpperCase();

  return (
    <div ref={containerRef} className={cn("relative shrink-0", sidebar && "w-full")}>
      {/* Trigger */}
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
        onKeyDown={handleKeyDown}
        aria-label={`Business: ${activeBusiness.name}. Switch business`}
        className={cn(
          "w-full flex items-center gap-2.5 transition-colors cursor-pointer select-none",
          sidebar
            ? cn(
                "rounded-xl text-white",
                collapsed
                  ? "justify-center p-0 hover:opacity-90"
                  : "border border-white/10 bg-white/[.05] px-2.5 py-2 hover:bg-white/10",
              )
            : "px-3 py-2 rounded-lg text-text-secondary hover:bg-surface-1 hover:text-text-primary",
        )}
      >
        {/* Avatar */}
        <span
          className={cn(
            "rounded-lg bg-brand-600 text-white flex items-center justify-center font-semibold shrink-0",
            sidebar ? "w-8 h-8 text-[13px] font-extrabold rounded-[9px]" : "w-7 h-7 text-xs",
          )}
        >
          {sidebar ? businessInitials(activeBusiness.name) : activeInitial}
        </span>

        {/* Business name */}
        {!(sidebar && collapsed) && (
          <span className="flex-1 min-w-0 text-left">
            <span
              className={cn(
                "block truncate text-[13px]",
                sidebar ? "font-bold text-white" : "font-medium text-text-primary",
              )}
            >
              {activeBusiness.name}
            </span>
            {sidebar && subtitle && (
              <span className="block truncate text-[11px] text-[#9fb0d6]">{subtitle}</span>
            )}
          </span>
        )}

        {/* Chevron up-down */}
        {!(sidebar && collapsed) &&
          (sidebar ? (
            <Icon icon={UnfoldMoreIcon} size={14} className="shrink-0 text-[#9fb0d6]" />
          ) : (
            <ChevronUpDownIcon />
          ))}
      </button>

      {/* Popover — opens downward */}
      {open && (
        <div
          ref={menuRef}
          role="menu"
          className={cn(
            "absolute top-full mt-1 z-50 min-w-[220px] rounded-lg border border-border-light bg-surface-0 shadow-dropdown animate-scale-in overflow-hidden",
            sidebar ? (collapsed ? "left-0 w-60" : "left-0 right-0") : "right-0",
          )}
        >
          {/* Business list */}
          <div className="max-h-48 overflow-y-auto py-1">
            {businesses.map((business, index) => {
              const isActive = business.id === activeBusinessId;
              const isFocused = index === focusedIndex;
              const initial = business.name.charAt(0).toUpperCase();
              return (
                <button
                  key={business.id}
                  type="button"
                  role="menuitem"
                  data-index={index}
                  onMouseEnter={() => setFocusedIndex(index)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onSwitch(business.id);
                    close();
                    triggerRef.current?.focus();
                  }}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-3 py-2 text-[13px] transition-colors text-left",
                    isFocused ? "bg-surface-1" : "hover:bg-surface-1",
                    isActive ? "font-medium text-brand-700" : "text-text-secondary"
                  )}
                >
                  {/* Avatar */}
                  <span
                    className={cn(
                      "w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-semibold shrink-0",
                      isActive
                        ? "bg-brand-600 text-white"
                        : "bg-brand-100 text-brand-700"
                    )}
                  >
                    {initial}
                  </span>

                  {/* Name */}
                  <span className="flex-1 min-w-0 truncate">{business.name}</span>

                  {/* Active checkmark */}
                  {isActive && <CheckIcon />}
                </button>
              );
            })}
          </div>

          {onCreateNew && (
            <>
              {/* Divider */}
              <div className="h-px bg-border-light mx-0" aria-hidden="true" />

              {/* Create New Business */}
              <div className="py-1">
                <button
                  type="button"
                  role="menuitem"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    close();
                    onCreateNew();
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-text-secondary hover:bg-surface-1 hover:text-text-primary transition-colors text-left"
                >
                  <span className="w-5 h-5 rounded-md border border-dashed border-border flex items-center justify-center shrink-0">
                    <PlusIcon />
                  </span>
                  <span>Create New Business</span>
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function businessInitials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter((w) => /[A-Za-z0-9]/.test(w[0] ?? ""))
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || name.charAt(0).toUpperCase()
  );
}

// ── Icons ──────────────────────────────────────────────────────

function ChevronUpDownIcon() {
  return (
    <Icon icon={UnfoldMoreIcon} size={14} className="text-text-tertiary" />
  );
}

function CheckIcon() {
  return (
    <Icon icon={Tick02Icon} size={14} className="text-brand-600" />
  );
}

function PlusIcon() {
  return (
    <Icon icon={Add01Icon} size={10} strokeWidth={2.5} />
  );
}
