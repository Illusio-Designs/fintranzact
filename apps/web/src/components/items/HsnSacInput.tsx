import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { useDebounce } from "@/hooks/useDebounce";

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
  const check = trpc.hsn.validate.useQuery({ hsn: code }, { enabled: checkable, staleTime: 5 * 60_000 });

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
  let note: { tone: "ok" | "warn" | "error"; title: string; body?: string } | null = null;
  if (trimmed && !/^\d+$/.test(trimmed)) {
    if (!open) note = { tone: "error", title: "Use digits only", body: "Pick a code from the list or type the number, e.g. 3004." };
  } else if (trimmed && ![4, 6, 8].includes(trimmed.length)) {
    if (!open) note = { tone: "error", title: "HSN / SAC codes are 4, 6 or 8 digits long" };
  } else if (checkable && code === trimmed && check.data) {
    if (!check.data.valid) {
      note = { tone: "error", title: `${trimmed} is not in the GST HSN / SAC list`, body: "Check the code before saving." };
    } else {
      const d = check.data.details;
      const kind = d.type === "services" ? "Service (SAC)" : "Goods (HSN)";
      const mismatch =
        (itemType === "service" && d.type === "goods") || (itemType === "product" && d.type === "services");
      note = {
        tone: mismatch ? "warn" : "ok",
        title: `${d.code} · ${kind}${d.match === "heading" ? ` · heading of ${d.subCodes} codes` : ""}`,
        body: mismatch
          ? `${d.description}. This item is a ${itemType === "service" ? "service" : "product"}; ${itemType === "service" ? "services use SAC codes starting with 99" : "products use HSN codes, not SAC (99…)"}.`
          : d.description,
      };
    }
  }

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
          aria-describedby={note ? detailsId : undefined}
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
      {note && (
        <div
          id={detailsId}
          role={note.tone === "error" ? "alert" : undefined}
          className={cn(
            "rounded-lg border px-3 py-2 text-xs",
            note.tone === "ok" && "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
            note.tone === "warn" && "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
            note.tone === "error" && "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200",
          )}
        >
          <p className="font-semibold">{note.title}</p>
          {note.body && <p className="mt-0.5 line-clamp-3">{note.body}</p>}
        </div>
      )}
    </div>
  );
}
