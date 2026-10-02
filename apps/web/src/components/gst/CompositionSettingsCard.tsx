import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useCan } from "@/lib/permissions";
import { toast } from "@/hooks/useToast";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";

/**
 * Composition category and rate for one financial year ("2026-27"). The rates
 * shown are defaults that the Government can change: the rate is editable and
 * every default carries a "confirm with your CA" note.
 */
export function CompositionSettingsCard({ financialYear }: { financialYear: string }) {
  const utils = trpc.useUtils();
  const canEdit = useCan("Business", "update");
  const { data, isLoading } = trpc.gst.compositionSettings.useQuery({ financialYear });
  const [category, setCategory] = useState<string>("");
  const [rate, setRate] = useState("");

  useEffect(() => {
    if (data) {
      setCategory(data.category);
      setRate(data.rate);
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

  if (isLoading || !data) return null;
  const selected = data.categories.find((c) => c.code === category) ?? data.categories[0]!;
  const rateValid = /^\d{1,3}(\.\d{1,3})?$/.test(rate) && parseFloat(rate) <= 100;

  function save() {
    if (!rateValid) return;
    // Sending nothing keeps following the category default.
    const isDefault = parseFloat(rate) === parseFloat(selected.rate);
    mutation.mutate({
      financialYear,
      category: selected.code,
      rate: isDefault ? null : rate,
    });
  }

  return (
    <div className="card px-4 py-4 space-y-3" data-testid="composition-settings">
      <div className="flex flex-wrap items-end gap-3">
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
              if (next) setRate(next.rate);
            }}
          >
            {data.categories.map((c) => (
              <option key={c.code} value={c.code}>{c.label}</option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="composition-rate" className="block text-xs text-text-tertiary mb-1 font-medium uppercase tracking-wide">
            Rate (% of turnover)
          </label>
          <input
            id="composition-rate"
            className="input w-28"
            inputMode="decimal"
            value={rate}
            disabled={!canEdit}
            onChange={(e) => setRate(e.target.value)}
            aria-invalid={!rateValid}
          />
        </div>
        {canEdit && (
          <button type="button" className="btn-secondary inline-flex items-center gap-2" onClick={save} disabled={!rateValid || mutation.isPending}>
            {mutation.isPending && <Spinner size="sm" />}
            Save
          </button>
        )}
      </div>
      <p className="text-xs text-text-tertiary">
        {selected.note}. {!data.configured && "No category saved yet for this year: the default is used. "}
        These are default rates; the Government can change them. Confirm the category and rate with your CA before filing.
      </p>
    </div>
  );
}
