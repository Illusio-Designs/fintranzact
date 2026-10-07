import { useEffect, useState } from "react";
import { TRIAL_MAX_DAYS, TRIAL_MIN_DAYS, trialSettingsSchema } from "@fintranzact/shared";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { InputField } from "@/components/ui/FormField";

/**
 * Trial length (standard and partner referral) and the add-on caps during the
 * trial. Applies to organisations that sign up from now on; running trials
 * keep their dates. Saved in system_config and audited.
 */
export function TrialSettingsCard() {
  const utils = trpc.useUtils();
  const { data } = trpc.platform.trialSettings.useQuery();
  const [days, setDays] = useState("");
  const [partnerDays, setPartnerDays] = useState("");
  const [ai, setAi] = useState("");
  const [payroll, setPayroll] = useState("");

  useEffect(() => {
    if (!data) return;
    setDays(String(data.days));
    setPartnerDays(String(data.partnerDays));
    setAi(String(data.caps.aiQuestions));
    setPayroll(String(data.caps.payrollEmployees));
  }, [data]);

  const save = trpc.platform.saveTrialSettings.useMutation({
    onSuccess: async () => {
      toast.success("Trial settings saved", "They apply to organisations that sign up from now on.");
      await utils.platform.trialSettings.invalidate();
    },
    onError: (err) => toast.error("Could not save", err.message),
  });

  const parsed = trialSettingsSchema.safeParse({
    days: Number(days),
    partnerDays: Number(partnerDays),
    caps: { aiQuestions: Number(ai), payrollEmployees: Number(payroll) },
  });
  const changed =
    !!data && (Number(days) !== data.days || Number(partnerDays) !== data.partnerDays || Number(ai) !== data.caps.aiQuestions || Number(payroll) !== data.caps.payrollEmployees);
  const dayHint = `Whole days, ${TRIAL_MIN_DAYS} to ${TRIAL_MAX_DAYS}`;
  // No error toast while the saved figures are still loading (the fields start empty).
  const bad = (v: string, min: number, max: number) => !!data && !(Number.isInteger(Number(v)) && v.trim() !== "" && Number(v) >= min && Number(v) <= max);

  return (
    <section className="rounded-2xl border border-border-light bg-surface-0 p-4" aria-labelledby="trial-settings-heading">
      <h2 id="trial-settings-heading" className="text-[15px] font-bold text-text-primary">Free trial settings</h2>
      <p className="mt-1 text-sm text-text-tertiary">
        Every new organisation starts a Full Access Trial: the Business plan and every add-on, no card. These apply to sign-ups from now on.
      </p>
      <form
        className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (parsed.success) save.mutate(parsed.data);
        }}
      >
        <InputField label="Trial length (days)" type="number" inputMode="numeric" min={TRIAL_MIN_DAYS} max={TRIAL_MAX_DAYS} value={days} onChange={(e) => setDays(e.target.value)} error={bad(days, TRIAL_MIN_DAYS, TRIAL_MAX_DAYS) ? dayHint : undefined} />
        <InputField label="Partner referral trial (days)" type="number" inputMode="numeric" min={TRIAL_MIN_DAYS} max={TRIAL_MAX_DAYS} value={partnerDays} onChange={(e) => setPartnerDays(e.target.value)} error={bad(partnerDays, TRIAL_MIN_DAYS, TRIAL_MAX_DAYS) ? dayHint : undefined} />
        <InputField label="AI questions in the trial" type="number" inputMode="numeric" min={0} max={10000} value={ai} onChange={(e) => setAi(e.target.value)} error={bad(ai, 0, 10000) ? "Whole number, 0 to 10000" : undefined} />
        <InputField label="Payroll employees in the trial" type="number" inputMode="numeric" min={0} max={1000} value={payroll} onChange={(e) => setPayroll(e.target.value)} error={bad(payroll, 0, 1000) ? "Whole number, 0 to 1000" : undefined} />
        <div className="sm:col-span-2 lg:col-span-4">
          <button type="submit" className="btn-primary" disabled={!parsed.success || !changed || save.isPending}>
            {save.isPending ? "Saving…" : "Save trial settings"}
          </button>
        </div>
      </form>
    </section>
  );
}
