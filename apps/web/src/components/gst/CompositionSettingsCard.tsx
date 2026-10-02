import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useCan } from "@/lib/permissions";
import { toast } from "@/hooks/useToast";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";

type FieldKey =
  | "rate" | "cmp08DueDay" | "gstr4DueDate" | "interestRatePercent"
  | "lateFeePerDay" | "lateFeeCap" | "lateFeeNilPerDay" | "lateFeeNilCap";

const FIELDS: { key: FieldKey; label: string; hint: string; kind: "percent" | "amount" | "day" | "date" }[] = [
  { key: "rate", label: "Rate (% of turnover)", hint: "Composition tax on turnover", kind: "percent" },
  { key: "cmp08DueDay", label: "CMP-08 due day", hint: "Day of the month after the quarter (Q4: April)", kind: "day" },
  { key: "gstr4DueDate", label: "GSTR-4 due date", hint: "Change it when the date is extended", kind: "date" },
  { key: "interestRatePercent", label: "Interest (% a year)", hint: "On tax paid late", kind: "percent" },
  { key: "lateFeePerDay", label: "GSTR-4 late fee per day", hint: "CGST + SGST together", kind: "amount" },
  { key: "lateFeeCap", label: "GSTR-4 late fee cap", hint: "Most it can reach", kind: "amount" },
  { key: "lateFeeNilPerDay", label: "Nil return late fee per day", hint: "No turnover, no tax", kind: "amount" },
  { key: "lateFeeNilCap", label: "Nil return late fee cap", hint: "Most it can reach", kind: "amount" },
];

const valid = (kind: "percent" | "amount" | "day" | "date", v: string): boolean => {
  if (kind === "percent") return /^\d{1,3}(\.\d{1,3})?$/.test(v) && parseFloat(v) <= 100;
  if (kind === "amount") return /^\d{1,10}(\.\d{1,2})?$/.test(v);
  if (kind === "day") return /^\d{1,2}$/.test(v) && Number(v) >= 1 && Number(v) <= 28;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
};

/** Same value, whatever the formatting ("5" vs "5.00"). */
const same = (kind: "percent" | "amount" | "day" | "date", a: string, b: string): boolean =>
  kind === "date" ? a === b : parseFloat(a) === parseFloat(b);

/**
 * Composition category and every compliance value for one financial year
 * ("2026-27"): the effective value, whether it is the built-in default or this
 * business's override, and a reset to the default. The defaults are researched
 * from secondary sources and change by notification: every one carries the
 * "confirm with your CA" note and the date they were last reviewed.
 */
export function CompositionSettingsCard({ financialYear }: { financialYear: string }) {
  const utils = trpc.useUtils();
  const canEdit = useCan("Business", "update");
  const { data, isLoading } = trpc.gst.compositionSettings.useQuery({ financialYear });
  const [category, setCategory] = useState<string>("");
  const [draft, setDraft] = useState<Record<FieldKey, string> | null>(null);

  useEffect(() => {
    if (data) {
      setCategory(data.category);
      setDraft({ ...data.effective, cmp08DueDay: String(data.effective.cmp08DueDay) });
    }
  }, [data]);

  const mutation = trpc.gst.updateCompositionSettings.useMutation({
    onSuccess: () => {
      toast.success("Composition settings saved");
      void utils.gst.compositionSettings.invalidate();
      void utils.gst.cmp08.invalidate();
      void utils.gst.cmp08Year.invalidate();
      void utils.gst.gstr4.invalidate();
      void utils.gst.gstr4Json.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading || !data || !draft) return null;
  const selected = data.categories.find((c) => c.code === category) ?? data.categories[0]!;
  // The default rate follows the category being picked.
  const defaultOf = (key: FieldKey): string =>
    key === "rate" ? selected.rate : String(data.defaults[key]);
  const allValid = FIELDS.every((f) => valid(f.kind, draft[f.key]));

  function setField(key: FieldKey, value: string) {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  }

  function save() {
    if (!allValid || !draft) return;
    // A value equal to the built-in default is saved as "no override" (null), so it follows the default again.
    const send = (f: (typeof FIELDS)[number]): string | null =>
      same(f.kind, draft[f.key], defaultOf(f.key)) ? null : draft[f.key];
    const f = Object.fromEntries(FIELDS.map((x) => [x.key, send(x)])) as Record<FieldKey, string | null>;
    mutation.mutate({
      financialYear,
      category: selected.code,
      rate: f.rate,
      cmp08DueDay: f.cmp08DueDay == null ? null : Number(f.cmp08DueDay),
      gstr4DueDate: f.gstr4DueDate,
      interestRate: f.interestRatePercent,
      lateFeePerDay: f.lateFeePerDay,
      lateFeeCap: f.lateFeeCap,
      lateFeeNilPerDay: f.lateFeeNilPerDay,
      lateFeeNilCap: f.lateFeeNilCap,
    });
  }

  return (
    <div className="card px-4 py-4 space-y-4" data-testid="composition-settings">
      <div>
        <label htmlFor="composition-category" className="block text-xs text-text-tertiary mb-1 font-medium uppercase tracking-wide">
          Composition category · FY {financialYear}
        </label>
        <Select
          id="composition-category"
          className="input w-72"
          value={category}
          disabled={!canEdit}
          onChange={(e) => {
            setCategory(e.target.value);
            const next = data.categories.find((c) => c.code === e.target.value);
            // Follow the new category's rate unless the rate was edited away from the old default.
            if (next && same("percent", draft.rate, selected.rate)) setField("rate", next.rate);
          }}
        >
          {data.categories.map((c) => (
            <option key={c.code} value={c.code}>{c.label}</option>
          ))}
        </Select>
        <p className="text-xs text-text-tertiary mt-1">{selected.note}.{!data.configured && " No category saved yet for this year: the default is used."}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {FIELDS.map((f) => {
          const def = defaultOf(f.key);
          const isDefault = same(f.kind, draft[f.key], def) && valid(f.kind, draft[f.key]);
          const ok = valid(f.kind, draft[f.key]);
          return (
            <div key={f.key} data-testid={`composition-field-${f.key}`}>
              <label htmlFor={`composition-${f.key}`} className="block text-xs text-text-tertiary mb-1 font-medium uppercase tracking-wide">
                {f.label}
              </label>
              <input
                id={`composition-${f.key}`}
                className="input w-full"
                inputMode={f.kind === "date" ? "numeric" : "decimal"}
                type={f.kind === "date" ? "date" : "text"}
                value={draft[f.key]}
                disabled={!canEdit}
                onChange={(e) => setField(f.key, e.target.value)}
                aria-invalid={!ok}
              />
              <p className="text-xs mt-1 flex flex-wrap items-center gap-x-2">
                <span className={isDefault ? "text-text-tertiary" : "text-amber-700 dark:text-amber-400 font-medium"}>
                  {isDefault ? "Default" : "Overridden"}
                </span>
                {!isDefault && <span className="text-text-tertiary">default {def}</span>}
                {canEdit && !isDefault && (
                  <button type="button" className="text-primary underline" onClick={() => setField(f.key, def)}>Reset</button>
                )}
              </p>
              <p className="text-xs text-text-tertiary">{f.hint}</p>
            </div>
          );
        })}
      </div>

      {canEdit && (
        <button type="button" className="btn-secondary inline-flex items-center gap-2" onClick={save} disabled={!allValid || mutation.isPending}>
          {mutation.isPending && <Spinner size="sm" />}
          Save
        </button>
      )}

      <div className="text-xs text-text-tertiary space-y-1">
        <p>
          Built-in defaults for FY {financialYear} (from FY {data.meta.effectiveFromFy}) were last reviewed on <strong>{data.meta.lastReviewed}</strong>.
          They come from secondary sources, not the official notifications, and the Government can change them. <strong>Confirm every value with your CA before filing.</strong>
          {" "}Changing a value here changes CMP-08 and GSTR-4 straight away; a value equal to the default follows the default again.
        </p>
        <details>
          <summary className="cursor-pointer">Where the defaults came from</summary>
          <ul className="list-disc pl-5 mt-1 space-y-0.5">
            {data.meta.sourceNotes.map((n) => <li key={n}>{n}</li>)}
          </ul>
        </details>
      </div>
    </div>
  );
}
