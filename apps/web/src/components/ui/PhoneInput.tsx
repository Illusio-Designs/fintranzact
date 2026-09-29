import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { ArrowDown01Icon, Search01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { useAnchoredPopover } from "@/hooks/useAnchoredPopover";
import { Icon } from "./Icon";

export interface Country {
  /** ISO 3166-1 alpha-2 code, shown as a small badge. */
  code: string;
  name: string;
  /** Dial code including the plus sign, e.g. "+91". */
  dial: string;
  /** Longest national number allowed for this country. */
  maxDigits: number;
  /** Exact national length, when the country has a single fixed length. */
  exactDigits?: number;
}

/** India first, then common trading partners and neighbours, A–Z. */
export const COUNTRIES: Country[] = [
  { code: "IN", name: "India", dial: "+91", maxDigits: 10, exactDigits: 10 },
  { code: "AE", name: "United Arab Emirates", dial: "+971", maxDigits: 9 },
  { code: "AU", name: "Australia", dial: "+61", maxDigits: 9, exactDigits: 9 },
  { code: "BD", name: "Bangladesh", dial: "+880", maxDigits: 10 },
  { code: "BH", name: "Bahrain", dial: "+973", maxDigits: 8, exactDigits: 8 },
  { code: "BT", name: "Bhutan", dial: "+975", maxDigits: 8 },
  { code: "CA", name: "Canada", dial: "+1", maxDigits: 10, exactDigits: 10 },
  { code: "DE", name: "Germany", dial: "+49", maxDigits: 11 },
  { code: "FR", name: "France", dial: "+33", maxDigits: 9, exactDigits: 9 },
  { code: "GB", name: "United Kingdom", dial: "+44", maxDigits: 10, exactDigits: 10 },
  { code: "HK", name: "Hong Kong", dial: "+852", maxDigits: 8, exactDigits: 8 },
  { code: "ID", name: "Indonesia", dial: "+62", maxDigits: 12 },
  { code: "IT", name: "Italy", dial: "+39", maxDigits: 11 },
  { code: "JP", name: "Japan", dial: "+81", maxDigits: 10 },
  { code: "KE", name: "Kenya", dial: "+254", maxDigits: 9, exactDigits: 9 },
  { code: "KW", name: "Kuwait", dial: "+965", maxDigits: 8, exactDigits: 8 },
  { code: "LK", name: "Sri Lanka", dial: "+94", maxDigits: 9, exactDigits: 9 },
  { code: "MV", name: "Maldives", dial: "+960", maxDigits: 7, exactDigits: 7 },
  { code: "MY", name: "Malaysia", dial: "+60", maxDigits: 10 },
  { code: "NG", name: "Nigeria", dial: "+234", maxDigits: 10 },
  { code: "NL", name: "Netherlands", dial: "+31", maxDigits: 9, exactDigits: 9 },
  { code: "NP", name: "Nepal", dial: "+977", maxDigits: 10 },
  { code: "NZ", name: "New Zealand", dial: "+64", maxDigits: 10 },
  { code: "OM", name: "Oman", dial: "+968", maxDigits: 8, exactDigits: 8 },
  { code: "QA", name: "Qatar", dial: "+974", maxDigits: 8, exactDigits: 8 },
  { code: "SA", name: "Saudi Arabia", dial: "+966", maxDigits: 9, exactDigits: 9 },
  { code: "SG", name: "Singapore", dial: "+65", maxDigits: 8, exactDigits: 8 },
  { code: "TH", name: "Thailand", dial: "+66", maxDigits: 9 },
  { code: "US", name: "United States", dial: "+1", maxDigits: 10, exactDigits: 10 },
  { code: "ZA", name: "South Africa", dial: "+27", maxDigits: 9, exactDigits: 9 },
];

const DEFAULT_COUNTRY = COUNTRIES[0];

/**
 * Split a stored phone value into country + national digits.
 * Values without a leading "+" (older records) are treated as Indian numbers.
 */
export function parsePhone(value: string, preferred?: Country): { country: Country; digits: string } {
  const trimmed = (value || "").trim();
  if (!trimmed.startsWith("+")) {
    return { country: preferred ?? DEFAULT_COUNTRY, digits: trimmed.replace(/\D/g, "") };
  }
  const compact = "+" + trimmed.slice(1).replace(/\D/g, "");
  // Keep the currently selected country when its code still matches (+1 is shared by US and Canada).
  if (preferred && compact.startsWith(preferred.dial)) {
    return { country: preferred, digits: compact.slice(preferred.dial.length) };
  }
  const match = [...COUNTRIES]
    .sort((a, b) => b.dial.length - a.dial.length)
    .find((c) => compact.startsWith(c.dial));
  if (!match) return { country: preferred ?? DEFAULT_COUNTRY, digits: compact.slice(1) };
  return { country: match, digits: compact.slice(match.dial.length) };
}

/** Stored values stay within 15 characters (E.164), dial code included. */
const maxDigitsFor = (c: Country) => Math.min(c.maxDigits, 15 - c.dial.length);

export interface PhoneInputProps {
  /** Stored value: "+<dial><number>", e.g. "+919876543210", or "" when empty. */
  value: string;
  onChange: (value: string) => void;
  label?: string;
  required?: boolean;
  error?: string;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
  "aria-label"?: string;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
}

/**
 * Phone number field with a searchable country-code dropdown.
 * India (+91) is the default; the value is stored as "+<dial><digits>".
 */
export function PhoneInput({
  value,
  onChange,
  label,
  required,
  error,
  id,
  placeholder,
  disabled,
  autoFocus,
  className,
  "aria-label": ariaLabel,
  onKeyDown,
}: PhoneInputProps) {
  const [selected, setSelected] = useState<Country | undefined>(undefined);
  const { country, digits } = parsePhone(value, selected);
  const autoId = useId();
  const inputId = id ?? `phone-${autoId}`;
  const listId = `phone-countries-${autoId}`;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const popStyle = useAnchoredPopover(triggerRef, open, { width: 300, estimatedHeight: 320 });

  const results = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^\+/, "");
    if (!q) return COUNTRIES;
    return COUNTRIES.filter(
      (c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase() === q || c.dial.slice(1).startsWith(q),
    );
  }, [query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(Math.max(0, COUNTRIES.indexOf(country)));
    const t = setTimeout(() => searchRef.current?.focus(), 0);
    const onDown = (e: MouseEvent) => {
      const n = e.target as Node;
      if (!triggerRef.current?.contains(n) && !popRef.current?.contains(n)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", onDown);
    };
    // Runs only when the list opens.
  }, [open]);

  useEffect(() => {
    if (!open) return;
    popRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [open, active]);

  const emit = (c: Country, d: string) => onChange(d ? `${c.dial}${d}` : "");

  const pick = (c: Country) => {
    setSelected(c);
    setOpen(false);
    emit(c, digits.slice(0, maxDigitsFor(c)));
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[active]) pick(results[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    }
  };

  const tooShort =
    digits.length > 0 &&
    (country.exactDigits ? digits.length < country.exactDigits : digits.length < Math.min(7, country.maxDigits));
  const hint = tooShort
    ? country.exactDigits
      ? `Enter a ${country.exactDigits}-digit number for ${country.name}`
      : "Number looks too short"
    : null;

  return (
    <div className={className}>
      {label && (
        <label htmlFor={inputId} className="label">
          {label}
          {required && <span className="ml-0.5 text-red-500">*</span>}
        </label>
      )}
      <div
        className={cn(
          "flex items-stretch rounded-lg border bg-surface-0 transition-colors focus-within:border-brand-600 focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--brand-600)_20%,transparent)]",
          error ? "border-red-500" : "border-[var(--border-color)]",
          disabled && "opacity-50",
        )}
      >
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-label={`Country code: ${country.name} ${country.dial}`}
          className="flex shrink-0 items-center gap-1.5 rounded-l-lg border-r border-[var(--border-color)] bg-surface-1 pl-2.5 pr-2 text-sm text-text-primary outline-none hover:bg-surface-2 focus-visible:bg-surface-2"
        >
          <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-brand-700 dark:bg-brand-900/50 dark:text-brand-200">
            {country.code}
          </span>
          <span className="font-medium tabular-nums">{country.dial}</span>
          <Icon
            icon={ArrowDown01Icon}
            size={14}
            className={cn("text-text-tertiary transition-transform", open && "rotate-180")}
          />
        </button>
        <input
          ref={inputRef}
          id={inputId}
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          autoFocus={autoFocus}
          disabled={disabled}
          required={required}
          aria-label={label ? undefined : (ariaLabel ?? "Phone number")}
          aria-invalid={error ? true : undefined}
          value={digits}
          maxLength={maxDigitsFor(country)}
          placeholder={placeholder ?? (country.code === "IN" ? "98765 43210" : "Phone number")}
          onKeyDown={onKeyDown}
          onChange={(e) => emit(country, e.target.value.replace(/\D/g, "").slice(0, maxDigitsFor(country)))}
          className="min-w-0 flex-1 rounded-r-lg bg-transparent px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-tertiary"
        />
      </div>
      {error ? (
        <p className="mt-1 text-xs text-red-500">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-text-tertiary">{hint}</p>
      ) : null}

      {open &&
        createPortal(
          <div
            ref={popRef}
            style={popStyle}
            className="z-[80] overflow-hidden rounded-xl border border-border bg-surface-0 shadow-dropdown animate-scale-in"
          >
            <div className="relative border-b border-border-light p-2">
              <Icon
                icon={Search01Icon}
                size={16}
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-text-tertiary"
              />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onSearchKey}
                placeholder="Search country or code"
                aria-label="Search countries"
                aria-controls={listId}
                aria-activedescendant={results[active] ? `${listId}-${results[active].code}` : undefined}
                className="input h-9 pl-8"
              />
            </div>
            <ul id={listId} role="listbox" aria-label="Countries" className="max-h-64 overflow-y-auto p-1.5">
              {results.map((c, i) => {
                const isSel = c.code === country.code;
                return (
                  <li
                    key={c.code}
                    id={`${listId}-${c.code}`}
                    data-index={i}
                    role="option"
                    aria-selected={isSel}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pick(c);
                    }}
                    className={cn(
                      "flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-text-primary",
                      i === active && "bg-surface-2",
                    )}
                  >
                    <span className="w-7 shrink-0 rounded bg-surface-2 px-1 py-0.5 text-center text-[10px] font-bold text-text-secondary">
                      {c.code}
                    </span>
                    <span className={cn("flex-1 truncate", isSel && "font-semibold")}>{c.name}</span>
                    <span className="tabular-nums text-text-tertiary">{c.dial}</span>
                    {isSel && <Icon icon={Tick02Icon} size={16} className="text-brand-600 dark:text-brand-300" />}
                  </li>
                );
              })}
              {results.length === 0 && (
                <li className="px-2.5 py-3 text-sm text-text-tertiary">No country matches “{query}”</li>
              )}
            </ul>
          </div>,
          document.body,
        )}
    </div>
  );
}
