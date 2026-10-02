/**
 * ListFilters — the "+ Filter" button above a list and the chips showing
 * the filters in use.
 *
 * "+ Filter" opens a small panel: pick what to filter by (Party, Amount, Due
 * date, Source), then the values. Each filter in use shows as a chip such as
 * "Party: Laxmi Jewellers +1 ×"; × removes it, "Clear filters" removes all.
 * Status, date range and search keep their own controls, so nothing here
 * repeats them.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft01Icon, ArrowRight01Icon, Cancel01Icon, FilterIcon } from "@hugeicons/core-free-icons";
import { trpc } from "@/lib/trpc";
import { cn, formatCurrency } from "@/lib/utils";
import { useAnchoredPopover } from "@/hooks/useAnchoredPopover";
import { useDebounce } from "@/hooks/useDebounce";
import { Icon } from "./Icon";

export type DueFilter = "next7" | "next30" | "none";
export type SourceFilter = "manual" | "pos" | "online_store" | "webhook" | "import";

export interface DocFilters {
  parties?: { id: string; name: string }[];
  minAmount?: number;
  maxAmount?: number;
  due?: DueFilter;
  source?: SourceFilter[];
}

type FilterKind = "party" | "amount" | "due" | "source";

const KIND_LABEL: Record<FilterKind, string> = {
  party: "Party",
  amount: "Amount",
  due: "Due date",
  source: "Source",
};

const DUE_LABEL: Record<DueFilter, string> = {
  next7: "Due in the next 7 days",
  next30: "Due in the next 30 days",
  none: "No due date",
};

const SOURCE_LABEL: Record<SourceFilter, string> = {
  manual: "Typed in the app",
  pos: "POS",
  online_store: "Online store",
  webhook: "API",
  import: "Imported",
};

/** What the list query needs from the filters. */
export function filterParams(f: DocFilters) {
  return {
    partyIds: f.parties?.length ? f.parties.map((p) => p.id) : undefined,
    minAmount: f.minAmount,
    maxAmount: f.maxAmount,
    due: f.due,
    source: f.source?.length ? f.source : undefined,
  };
}

/** Number of filters in use. */
export function activeFilterCount(f: DocFilters) {
  return (
    (f.parties?.length ? 1 : 0) +
    (f.minAmount != null || f.maxAmount != null ? 1 : 0) +
    (f.due ? 1 : 0) +
    (f.source?.length ? 1 : 0)
  );
}

const amountText = (n: number) => formatCurrency(n).replace(/\.00$/, "");

function chipText(kind: FilterKind, f: DocFilters): string | null {
  switch (kind) {
    case "party": {
      const p = f.parties ?? [];
      if (!p.length) return null;
      return p.length === 1 ? p[0].name : `${p[0].name} +${p.length - 1}`;
    }
    case "amount":
      if (f.minAmount != null && f.maxAmount != null) return `${amountText(f.minAmount)} – ${amountText(f.maxAmount)}`;
      if (f.minAmount != null) return `${amountText(f.minAmount)} or more`;
      if (f.maxAmount != null) return `up to ${amountText(f.maxAmount)}`;
      return null;
    case "due":
      return f.due ? DUE_LABEL[f.due] : null;
    case "source": {
      const s = f.source ?? [];
      if (!s.length) return null;
      return s.length <= 2 ? s.map((x) => SOURCE_LABEL[x]).join(", ") : `${SOURCE_LABEL[s[0]]} +${s.length - 1}`;
    }
  }
}

function clearKind(kind: FilterKind, f: DocFilters): DocFilters {
  switch (kind) {
    case "party": return { ...f, parties: undefined };
    case "amount": return { ...f, minAmount: undefined, maxAmount: undefined };
    case "due": return { ...f, due: undefined };
    case "source": return { ...f, source: undefined };
  }
}

interface ListFiltersProps {
  value: DocFilters;
  onChange: (next: DocFilters) => void;
  /** Which filters this list offers. */
  kinds?: FilterKind[];
  /** Customers for sales lists, suppliers for purchase lists. */
  partyType?: "customer" | "supplier";
}

/** The "+ Filter" button. Put the chips (`FilterChips`) where they have room. */
export function FilterButton({ value, onChange, kinds = ["party", "amount", "due", "source"], partyType }: ListFiltersProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<FilterKind | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const style = useAnchoredPopover(triggerRef, open, { width: 300, estimatedHeight: 360 });
  const count = activeFilterCount(value);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panelRef.current?.contains(t) && !triggerRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Each step starts on its first field (the party search), else its first button.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    (panel?.querySelector<HTMLElement>("input") ?? panel?.querySelector<HTMLElement>("button"))?.focus();
  }, [open, step]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };
  // Esc steps back, then closes. Listened for on the page, so it works
  // wherever focus is.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (step) setStep(null);
      else close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, step]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => { setStep(null); setOpen((o) => !o); }}
        className={cn("btn-secondary h-7 gap-1.5 px-2.5 text-xs", count > 0 && "border-brand-300 text-brand-700 dark:border-brand-700 dark:text-brand-300")}
      >
        <Icon icon={FilterIcon} size={14} />
        Filter
        {count > 0 && (
          <span className="rounded-full bg-brand-600 px-1.5 text-2xs font-semibold leading-4 text-white">{count}</span>
        )}
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-label={step ? `Filter by ${KIND_LABEL[step].toLowerCase()}` : "Add a filter"}
            style={style}
            className="z-50 animate-scale-in rounded-xl border border-border-light bg-surface-0 p-1 shadow-dropdown"
          >
            {step === null ? (
              <div className="py-1">
                <div className="px-3 pb-1 pt-1 text-2xs font-medium text-text-tertiary">Filter by</div>
                {kinds.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setStep(k)}
                    className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-ui text-text-primary transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none"
                  >
                    <span>{KIND_LABEL[k]}</span>
                    <span className="flex items-center gap-1 text-2xs text-text-tertiary">
                      <span className="max-w-[140px] truncate">{chipText(k, value)}</span>
                      <Icon icon={ArrowRight01Icon} size={12} />
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div>
                <button
                  type="button"
                  onClick={() => setStep(null)}
                  className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-2 hover:text-text-primary"
                >
                  <Icon icon={ArrowLeft01Icon} size={12} />
                  {KIND_LABEL[step]}
                </button>
                <div className="px-2 pb-2 pt-1">
                  {step === "party" && <PartyStep value={value} onChange={onChange} partyType={partyType} />}
                  {step === "amount" && <AmountStep value={value} onChange={(f) => { onChange(f); close(); }} />}
                  {step === "due" && <DueStep value={value} onChange={(f) => { onChange(f); close(); }} />}
                  {step === "source" && <SourceStep value={value} onChange={onChange} />}
                </div>
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

/** Chips for the filters in use, each with ×, plus "Clear filters". Renders nothing when none are set. */
export function FilterChips({ value, onChange, kinds = ["party", "amount", "due", "source"] }: Omit<ListFiltersProps, "partyType">) {
  const chips = kinds.map((k) => [k, chipText(k, value)] as const).filter(([, t]) => t);
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Filters in use">
      {chips.map(([k, t]) => (
        <span
          key={k}
          className="inline-flex h-7 items-center gap-1 rounded-full border border-brand-200 bg-brand-50 pl-2.5 pr-1 text-xs text-brand-800 dark:border-brand-800 dark:bg-brand-950/40 dark:text-brand-200"
        >
          <span className="text-brand-600 dark:text-brand-400">{KIND_LABEL[k]}:</span>
          <span className="max-w-[200px] truncate font-medium">{t}</span>
          <button
            type="button"
            onClick={() => onChange(clearKind(k, value))}
            aria-label={`Remove ${KIND_LABEL[k].toLowerCase()} filter`}
            className="inline-flex h-5 w-5 items-center justify-center rounded-full hover:bg-brand-100 dark:hover:bg-brand-900"
          >
            <Icon icon={Cancel01Icon} size={11} />
          </button>
        </span>
      ))}
      {chips.length > 1 && (
        <button type="button" onClick={() => onChange({})} className="px-1.5 text-xs font-medium text-text-tertiary hover:text-text-primary">
          Clear filters
        </button>
      )}
    </div>
  );
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: () => void; children: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-ui text-text-primary hover:bg-surface-2">
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span className="min-w-0 truncate">{children}</span>
    </label>
  );
}

function PartyStep({ value, onChange, partyType }: { value: DocFilters; onChange: (f: DocFilters) => void; partyType?: "customer" | "supplier" }) {
  const [search, setSearch] = useState("");
  const q = useDebounce(search, 250);
  const { data, isFetching } = trpc.party.list.useQuery({ type: partyType, search: q || undefined, page: 1, limit: 20 });
  const chosen = value.parties ?? [];
  const toggle = (p: { id: string; name: string }) => {
    const on = chosen.some((c) => c.id === p.id);
    const next = on ? chosen.filter((c) => c.id !== p.id) : [...chosen, p];
    onChange({ ...value, parties: next.length ? next : undefined });
  };
  // Picked parties stay at the top even when the search doesn't match them.
  const rest = (data?.data ?? []).filter((p: { id: string }) => !chosen.some((c) => c.id === p.id));
  return (
    <div className="space-y-1">
      <input
        className="input h-8 py-0 text-ui"
        placeholder="Search parties…"
        aria-label="Search parties"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="max-h-56 overflow-y-auto">
        {/* One list with stable keys, so a ticked party keeps focus as it moves to the top. */}
        {[...chosen, ...rest.map((p: { id: string; name: string }) => ({ id: p.id, name: p.name }))].map((p) => (
          <Check key={p.id} checked={chosen.some((c) => c.id === p.id)} onChange={() => toggle(p)}>
            {p.name}
          </Check>
        ))}
        {!isFetching && !chosen.length && !rest.length && (
          <p className="px-2 py-3 text-center text-xs text-text-tertiary">No parties match "{search}"</p>
        )}
      </div>
    </div>
  );
}

function AmountStep({ value, onChange }: { value: DocFilters; onChange: (f: DocFilters) => void }) {
  const [min, setMin] = useState(value.minAmount?.toString() ?? "");
  const [max, setMax] = useState(value.maxAmount?.toString() ?? "");
  const num = (s: string) => (s.trim() === "" || isNaN(Number(s)) ? undefined : Math.max(0, Number(s)));
  let lo = num(min);
  let hi = num(max);
  if (lo != null && hi != null && lo > hi) [lo, hi] = [hi, lo];
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => { e.preventDefault(); onChange({ ...value, minAmount: lo, maxAmount: hi }); }}
    >
      <div className="grid grid-cols-2 gap-2">
        <label className="text-2xs font-medium text-text-tertiary">
          From ₹
          <input className="input mt-1 h-8 py-0 text-ui" inputMode="decimal" placeholder="0" value={min} onChange={(e) => setMin(e.target.value)} />
        </label>
        <label className="text-2xs font-medium text-text-tertiary">
          To ₹
          <input className="input mt-1 h-8 py-0 text-ui" inputMode="decimal" placeholder="Any" value={max} onChange={(e) => setMax(e.target.value)} />
        </label>
      </div>
      <button type="submit" className="btn-primary h-8 w-full text-xs">
        Apply
      </button>
    </form>
  );
}

function DueStep({ value, onChange }: { value: DocFilters; onChange: (f: DocFilters) => void }) {
  return (
    <div role="radiogroup" aria-label="Due date" className="space-y-0.5">
      {(Object.keys(DUE_LABEL) as DueFilter[]).map((d) => (
        <label key={d} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-ui text-text-primary hover:bg-surface-2">
          <input type="radio" name="due" checked={value.due === d} onChange={() => onChange({ ...value, due: d })} />
          {DUE_LABEL[d]}
        </label>
      ))}
      <p className="px-2 pt-1 text-2xs text-text-tertiary">Overdue invoices: use the Overdue chip.</p>
    </div>
  );
}

function SourceStep({ value, onChange }: { value: DocFilters; onChange: (f: DocFilters) => void }) {
  const chosen = value.source ?? [];
  return (
    <div className="space-y-0.5">
      {(Object.keys(SOURCE_LABEL) as SourceFilter[]).map((s) => (
        <Check
          key={s}
          checked={chosen.includes(s)}
          onChange={() => {
            const next = chosen.includes(s) ? chosen.filter((x) => x !== s) : [...chosen, s];
            onChange({ ...value, source: next.length ? next : undefined });
          }}
        >
          {SOURCE_LABEL[s]}
        </Check>
      ))}
    </div>
  );
}
