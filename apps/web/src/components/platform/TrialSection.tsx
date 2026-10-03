import { useState } from "react";
import { TRIAL_ADMIN_MAX_DAYS } from "@fintranzact/shared";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import { InputField } from "@/components/ui/FormField";

export interface TrialDetail {
  id: string;
  accessGrandfathered: boolean;
  accessState: string;
  trialSource: string | null;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  trial: { active: boolean; ended: boolean; daysLeft: number; source: string | null; totalDays: number | null };
}

const SOURCE_LABELS: Record<string, string> = {
  signup: "Self sign-up",
  partner: "Partner referral",
  admin: "Granted by an admin",
  none: "None (a trial was already used)",
};

/** One line for the organisation list: "9 days left", "Ended", "No trial", "Grandfathered". */
export function trialListLabel(t: {
  accessGrandfathered: boolean;
  trialEndsAt: string | null;
  trialSource: string | null;
  trialDaysLeft: number;
}): { text: string; tone: "green" | "grey" | "amber" | "red" } {
  if (t.accessGrandfathered) return { text: "Grandfathered", tone: "grey" };
  if (!t.trialEndsAt) return { text: "No trial", tone: "grey" };
  if (t.trialDaysLeft > 0) return { text: `${t.trialDaysLeft} day${t.trialDaysLeft === 1 ? "" : "s"} left`, tone: t.trialDaysLeft <= 3 ? "amber" : "green" };
  return { text: t.trialSource === "none" ? "No trial" : "Ended", tone: "red" };
}

type Action = "extend" | "grant" | "end";

/** Trial facts for one organisation, and the admin actions: extend, custom trial, end now. All are audited with the reason. */
export function TrialSection({ detail }: { detail: TrialDetail }) {
  const utils = trpc.useUtils();
  const [action, setAction] = useState<Action | null>(null);
  const [days, setDays] = useState("7");
  const [reason, setReason] = useState("");

  const refresh = async () => {
    setAction(null);
    setReason("");
    await Promise.all([utils.platform.tenant.invalidate(), utils.platform.tenants.invalidate()]);
  };
  const onError = (err: { message: string }) => toast.error("Could not change the trial", err.message);
  const extend = trpc.platform.extendTrial.useMutation({ onSuccess: async () => { toast.success("Trial extended"); await refresh(); }, onError });
  const grant = trpc.platform.grantTrial.useMutation({ onSuccess: async () => { toast.success("Custom trial started"); await refresh(); }, onError });
  const end = trpc.platform.endTrial.useMutation({ onSuccess: async () => { toast.success("Trial ended"); await refresh(); }, onError });
  const busy = extend.isPending || grant.isPending || end.isPending;

  const dayCount = Number(days);
  const daysOk = Number.isInteger(dayCount) && dayCount >= 1 && dayCount <= TRIAL_ADMIN_MAX_DAYS;
  const reasonOk = reason.trim().length >= 3;

  const submit = () => {
    if (!reasonOk || (action !== "end" && !daysOk)) return;
    if (action === "extend") extend.mutate({ tenantId: detail.id, days: dayCount, reason: reason.trim() });
    if (action === "grant") grant.mutate({ tenantId: detail.id, days: dayCount, reason: reason.trim() });
    if (action === "end") end.mutate({ tenantId: detail.id, reason: reason.trim() });
  };

  const facts: Array<[string, string]> = [
    ["State", detail.accessGrandfathered ? "Grandfathered (no trial)" : detail.trial.active ? "Trial running" : detail.trial.ended ? "Trial ended" : detail.accessState],
    ["Source", detail.trialSource ? (SOURCE_LABELS[detail.trialSource] ?? detail.trialSource) : "—"],
    ["Started", detail.trialStartedAt ? formatDate(detail.trialStartedAt) : "—"],
    ["Ends", detail.trialEndsAt ? formatDate(detail.trialEndsAt) : "—"],
    ["Days left", detail.trial.active ? String(detail.trial.daysLeft) : "0"],
  ];

  return (
    <section className="space-y-2" aria-labelledby="trial-heading">
      <h3 id="trial-heading" className="text-xs font-bold uppercase tracking-wide text-text-tertiary">Free trial</h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-2xl border border-border-light p-3 text-sm sm:grid-cols-3">
        {facts.map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs text-text-tertiary">{k}</dt>
            <dd className="font-semibold text-text-primary">{v}</dd>
          </div>
        ))}
      </dl>

      {detail.accessGrandfathered ? (
        <p className="text-xs text-text-tertiary">Grandfathered organisations have permanent full access; a trial does not apply.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary" onClick={() => setAction("extend")} aria-pressed={action === "extend"}>Extend trial</button>
            <button type="button" className="btn-secondary" onClick={() => setAction("grant")} aria-pressed={action === "grant"}>Grant custom trial</button>
            {detail.trial.active ? (
              <button type="button" className="btn-secondary" onClick={() => setAction("end")} aria-pressed={action === "end"}>End trial now</button>
            ) : null}
          </div>
          {action ? (
            <form
              className="space-y-3 rounded-2xl border border-border-light p-3"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <p className="text-sm font-semibold text-text-primary">
                {action === "extend" ? "Extend the trial" : action === "grant" ? "Grant a custom trial, starting now" : "End the trial now"}
              </p>
              {action !== "end" ? (
                <InputField
                  label="Days"
                  type="number"
                  min={1}
                  max={TRIAL_ADMIN_MAX_DAYS}
                  inputMode="numeric"
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                  error={daysOk ? undefined : `Whole days, 1 to ${TRIAL_ADMIN_MAX_DAYS}`}
                />
              ) : null}
              <InputField
                label="Reason (kept in the audit log)"
                value={reason}
                maxLength={500}
                onChange={(e) => setReason(e.target.value)}
              />
              <div className="flex gap-2">
                <button type="submit" className="btn-primary" disabled={busy || !reasonOk || (action !== "end" && !daysOk)}>
                  {busy ? "Saving…" : action === "end" ? "End trial" : action === "grant" ? "Grant trial" : "Extend trial"}
                </button>
                <button type="button" className="btn-secondary" onClick={() => setAction(null)}>Cancel</button>
              </div>
              {action === "grant" ? (
                <p className="text-xs text-text-tertiary">A custom trial is allowed even when a trial was already used for this email or GSTIN.</p>
              ) : null}
            </form>
          ) : null}
        </>
      )}
    </section>
  );
}
