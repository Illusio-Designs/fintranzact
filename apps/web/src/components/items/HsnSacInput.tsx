import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { useDebounce } from "@/hooks/useDebounce";

const dateText = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00` : iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
};

type Note = {
  tone: "ok" | "warn" | "error";
  title: string;
  body?: string;
  /** Where the answer comes from. */
  badge?: string;
  /** Rate and effective dates. */
  facts?: string;
  /** Muted source line. */
  source?: string;
  /** Muted live-check status. */
  status?: string;
  /** Amber advisory note from the server. */
  warning?: string;
};

export interface HsnSacInputProps {
  value: string;
  onChange: (code: string) => void;
  /** Goods should carry an HSN code, services a SAC code (99…). */
  itemType?: "product" | "service" | string;
  label?: string;
}

/**
 * HSN / SAC code field with suggestions from the GST HSN / SAC list. Type a
 * code ("3004") or words from the description ("paracetamol", "printing") and
 * pick a match; any code can still be typed in full. Below the field it shows
 * what the code stands for, or why it would be refused when saving.
 *
 * The details card says where the answer comes from: Sandbox (live, or its last
 * daily refresh) or the bundled official CBIC list, and shows any advisory
 * warning (withdrawn, not listed on Sandbox) in amber. Warnings never block.
 * The status region is polite-live and reserves its height while a code is
 * being checked, so the form does not jump.
 */
export function HsnSacInput({ value, onChange, itemType, label = "HSN / SAC Code" }: HsnSacInputProps) {
  const id = useId();
  const listId = `${id}-list`;
  const detailsId = `${id}-details`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  const query = useDebounce(value.trim(), 200);
  const searching = open && query.length >= 2;
  const search = trpc.hsn.search.useQuery({ query, limit: 20 }, { enabled: searching, staleTime: 5 * 60_000 });
  const matches = searching ? (search.data ?? []) : [];
  const showList = open && value.trim().length >= 2;

  const code = useDebounce(value.trim(), 300);
  const checkable = /^\d{4,8}$/.test(code);
  // The query key changes with the code, so a slower answer for an earlier code
  // is cancelled or ignored; the card only ever shows the code in the field.
  const check = trpc.hsn.validate.useQuery(
    { hsn: code },
    { enabled: checkable, staleTime: 5 * 60_000, retry: 1, refetchOnWindowFocus: false },
  );

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const choose = (picked: string) => {
    onChange(picked);
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!showList || matches.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % matches.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + matches.length) % matches.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(matches[Math.min(active, matches.length - 1)].hsn);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  };

  // What to say under the field about the current code.
  const trimmed = value.trim();
  let note: Note | null = null;
  const formatOk = /^\d+$/.test(trimmed) && [4, 6, 8].includes(trimmed.length);
  if (trimmed && !/^\d+$/.test(trimmed)) {
    if (!open) note = { tone: "error", title: "Use digits only", body: "Pick a code from the list or type the number, e.g. 3004." };
  } else if (trimmed && ![4, 6, 8].includes(trimmed.length)) {
    if (!open) note = { tone: "error", title: "HSN / SAC codes are 4, 6 or 8 digits long" };
  } else if (checkable && code === trimmed && check.data) {
    const data = check.data;
    if (!data.valid) {
      note = { tone: "error", title: `${trimmed} is not in the GST HSN / SAC list`, body: "Check the code before saving." };
    } else {
      const d = data.details;
      const sb = data.source === "bundled" ? null : data.sandbox;
      const kind = d.type === "services" ? "Service (SAC)" : "Goods (HSN)";
      const mismatch =
        (itemType === "service" && d.type === "goods") || (itemType === "product" && d.type === "services");
      const description = sb?.description || d.description;
      const from = dateText(sb?.effectiveFrom);
      const to = dateText(sb?.effectiveTo);
      const facts = [
        sb?.rate != null ? `GST ${sb.rate}%` : null,
        from ? `effective ${from}` : null,
        to ? `until ${to}` : null,
      ].filter(Boolean).join(" · ");
      const checked = dateText(data.checkedAt);
      note = {
        tone: mismatch || data.warning ? "warn" : "ok",
        title: `${d.code} · ${kind}${d.match === "heading" ? ` · heading of ${d.subCodes} codes` : ""}`,
        body: mismatch
          ? `${description}. This item is a ${itemType === "service" ? "service" : "product"}; ${itemType === "service" ? "services use SAC codes starting with 99" : "products use HSN codes, not SAC (99…)"}.`
          : description,
        badge: data.source === "bundled" ? undefined : "Verified with Sandbox",
        facts: facts || undefined,
        source: data.source === "bundled" ? "From the official CBIC list" : undefined,
        status:
          data.source === "refreshed"
            ? `Live check unavailable, showing Sandbox's answer${checked ? ` from ${checked}` : ""}`
            : data.source === "bundled" && data.sandboxStatus === "unavailable"
              ? "Live check unavailable, showing the bundled list"
              : undefined,
        warning: data.warning,
      };
    }
  }
  // A code is being checked (typing settled or the answer is on its way).
  const checking = !note && formatOk && (code !== trimmed || (checkable && check.isLoading));
  const reserve = formatOk && note?.tone !== "error";

  return (
    <div ref={wrapRef} className="flex flex-col gap-1.5">
      <label htmlFor={id} className="label">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          className={cn("input tabular-nums", note?.tone === "error" && "border-red-500")}
          value={value}
          autoComplete="off"
          role="combobox"
          aria-expanded={showList}
          aria-controls={showList ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={showList && matches[active] ? `${id}-opt-${active}` : undefined}
          aria-describedby={note || checking ? detailsId : undefined}
          aria-invalid={note?.tone === "error" || undefined}
          placeholder="Code or product, e.g. 3004"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            onChange(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
        />
        {showList && (
          <ul
            id={listId}
            role="listbox"
            aria-label="HSN / SAC suggestions"
            className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-xl border border-border bg-surface-0 p-1 shadow-dropdown"
          >
            {(search.isLoading || query !== value.trim()) && matches.length === 0 && (
              <li className="px-3 py-2 text-xs text-text-tertiary">Searching…</li>
            )}
            {search.isError && (
              <li className="px-3 py-2 text-xs text-text-tertiary">Couldn&apos;t search the list. You can still type the code.</li>
            )}
            {search.isSuccess && query === value.trim() && matches.length === 0 && (
              <li className="px-3 py-2 text-xs text-text-tertiary">No match in the GST HSN / SAC list.</li>
            )}
            {matches.map((m, i) => (
              <li
                key={m.hsn}
                id={`${id}-opt-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(m.hsn)}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  "flex cursor-pointer gap-2 rounded-lg px-3 py-2 text-left",
                  i === active ? "bg-surface-2" : "hover:bg-surface-1",
                )}
              >
                <span className="w-[4.75rem] shrink-0 font-mono text-xs font-semibold text-text-primary">{m.hsn}</span>
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-xs text-text-secondary">{m.description}</span>
                  <span className="text-2xs text-text-tertiary">{m.type === "services" ? "Service (SAC)" : "Goods (HSN)"}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div
        id={detailsId}
        aria-live="polite"
        aria-atomic="true"
        data-testid="hsn-details"
        className={cn(reserve && "min-h-[4.5rem]")}
      >
        {checking && <p className="px-1 py-2 text-xs text-text-tertiary">Checking the code…</p>}
        {note && (
          <div
            className={cn(
              "rounded-lg border px-3 py-2 text-xs",
              note.tone === "ok" && "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
              note.tone === "warn" && "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
              note.tone === "error" && "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200",
            )}
          >
            <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
              <p className="min-w-0 font-semibold">{note.title}</p>
              {note.badge && (
                <span className="shrink-0 whitespace-nowrap rounded-full border border-current/30 px-2 py-0.5 text-2xs font-semibold">
                  {note.badge}
                </span>
              )}
            </div>
            {note.body && <p className="mt-0.5 line-clamp-3">{note.body}</p>}
            {note.facts && <p className="mt-0.5 tabular-nums">{note.facts}</p>}
            {note.source && <p className="mt-0.5 opacity-80">{note.source}</p>}
            {note.status && <p className="mt-0.5 opacity-80">{note.status}</p>}
            {note.warning && (
              <p className="mt-1.5 rounded-md border border-amber-300 bg-amber-100 px-2 py-1 text-amber-950 dark:border-amber-800 dark:bg-amber-900/40 dark:text-amber-100">
                <span className="font-semibold">Note: </span>
                {note.warning}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
