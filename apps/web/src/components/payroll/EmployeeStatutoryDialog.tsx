import { useState } from "react";
import { fyLabel } from "@fintranzact/shared";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { Modal } from "@/components/ui/Modal";
import { InputField } from "@/components/ui/FormField";
import { CheckRow, onError } from "./payroll-ui";
import { NumField, currentFinancialYear, useStatutoryRegistrations, type StatutoryOut } from "./statutory-ui";

type Settings = StatutoryOut["employeeSettings"];

/**
 * An employee's statutory settings: PF, EPS, VPF and ESI (only for the schemes
 * the business is registered for) and the tax declarations used under the old
 * regime. With PF off nothing about PF or EPS is shown.
 */
export function EmployeeStatutoryDialog({ employeeId, name, onClose }: { employeeId: string; name: string; onClose: () => void }) {
  const { reg } = useStatutoryRegistrations();
  const fy = currentFinancialYear();
  const q = trpc.payrollStatutory.employeeSettings.useQuery({ employeeId, financialYear: fy });
  return (
    <Modal open onClose={onClose} title={`${name}: statutory settings`} className="max-w-2xl">
      {q.isLoading || !q.data ? <p className="text-sm text-text-tertiary">Loading...</p> : <Form s={q.data} reg={reg} fy={fy} onClose={onClose} />}
    </Modal>
  );
}

function Form({ s, reg, fy, onClose }: { s: Settings; reg: ReturnType<typeof useStatutoryRegistrations>["reg"]; fy: number; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [v, setV] = useState({
    pfApplicable: s.pfApplicable,
    pfExcluded: s.pfExcluded,
    epsEligible: s.epsEligible,
    pfOnActualWages: s.pfOnActualWages,
    vpfPercent: s.vpfPercent,
    internationalWorker: s.internationalWorker,
    pfJoinDate: s.pfJoinDate ?? "",
    esiApplicable: s.esiApplicable,
  });
  const [d, setD] = useState(s.declaration);
  const update = trpc.payrollStatutory.employeeUpdate.useMutation({ onError: onError("Could not save the statutory settings") });
  const declare = trpc.payrollStatutory.saveDeclaration.useMutation({ onError: onError("Could not save the declaration") });
  const busy = update.isPending || declare.isPending;
  const suggestion = s.epsSuggestion;

  async function save() {
    try {
      const { esiApplicable, ...pf } = v;
      if (reg.pf || reg.esi) await update.mutateAsync({ employeeId: s.employeeId, ...(reg.pf ? pf : {}), ...(reg.esi ? { esiApplicable } : {}) });
      if (reg.tds) await declare.mutateAsync({ employeeId: s.employeeId, financialYear: fy, amounts: d });
      toast({ title: "Statutory settings saved. Calculate the payroll run again to apply them.", variant: "success" });
      void utils.payrollStatutory.employeeSettings.invalidate();
      onClose();
    } catch {
      /* the mutation's onError already showed the message */
    }
  }

  if (!reg.pf && !reg.esi && !reg.tds) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-text-secondary">This business has no statutory registration turned on, so there is nothing to set here. Turn a registration on in Statutory settings first.</p>
        <div className="flex justify-end"><button className="btn-secondary" onClick={onClose}>Close</button></div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {reg.pf && (
        <fieldset className="space-y-3">
          <legend className="mb-1 text-sm font-semibold text-text-primary">Provident fund</legend>
          <CheckRow label="PF applies to this employee" checked={v.pfApplicable} onChange={(c) => setV((x) => ({ ...x, pfApplicable: c }))} />
          {v.pfApplicable && (
            <>
              <CheckRow label="Excluded employee (opted out: wages above the ceiling and never a PF member)" checked={v.pfExcluded} onChange={(c) => setV((x) => ({ ...x, pfExcluded: c }))} />
              {!v.pfExcluded && (
                <>
                  <CheckRow label="EPS eligible (employer's 8.33% goes to the pension scheme)" checked={v.epsEligible} onChange={(c) => setV((x) => ({ ...x, epsEligible: c }))} />
                  <p data-testid="eps-suggestion" className="rounded-lg bg-surface-1 px-3 py-2 text-xs text-text-secondary">
                    Suggestion: {suggestion.status === "eligible" ? "EPS eligible" : suggestion.status === "not_eligible" ? "not EPS eligible" : "check with your CA"}.
                    {" "}{suggestion.reasons.join(" ")}
                    {suggestion.status !== "review" && (suggestion.status === "eligible") !== v.epsEligible && (
                      <button type="button" className="ml-2 text-brand-700 underline dark:text-brand-300" onClick={() => setV((x) => ({ ...x, epsEligible: suggestion.status === "eligible" }))}>Use the suggestion</button>
                    )}
                  </p>
                  <CheckRow label="Contribute on actual wages (not capped at the ceiling)" checked={v.pfOnActualWages} onChange={(c) => setV((x) => ({ ...x, pfOnActualWages: c }))} />
                  <CheckRow label="International worker (a special case: no wage ceiling; confirm EPS with your CA)" checked={v.internationalWorker} onChange={(c) => setV((x) => ({ ...x, internationalWorker: c }))} />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <NumField label="Voluntary PF (VPF)" suffix="% of wages" value={v.vpfPercent} onChange={(n) => setV((x) => ({ ...x, vpfPercent: n ?? 0 }))} />
                    <InputField label="Joined PF on (if not the joining date)" type="date" value={v.pfJoinDate} onChange={(e) => setV((x) => ({ ...x, pfJoinDate: e.target.value }))} />
                  </div>
                </>
              )}
            </>
          )}
        </fieldset>
      )}

      {reg.esi && (
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-semibold text-text-primary">ESI</legend>
          <CheckRow label="ESI applies to this employee" checked={v.esiApplicable} onChange={(c) => setV((x) => ({ ...x, esiApplicable: c }))} hint="Switched off automatically while wages are above the ceiling, subject to the contribution-period rule." />
        </fieldset>
      )}

      {reg.tds && (
        <fieldset className="space-y-3">
          <legend className="mb-1 text-sm font-semibold text-text-primary">Tax declarations for {fyLabel(fy)}</legend>
          <p className="text-xs text-text-tertiary">Used only for an employee on the old regime (set it on the employee's page). Amounts in rupees for the whole year. Limits are set in Statutory settings.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <NumField label="Section 80C" value={d.sec80C} onChange={(n) => setD((x) => ({ ...x, sec80C: n ?? 0 }))} />
            <NumField label="Section 80D" value={d.sec80D} onChange={(n) => setD((x) => ({ ...x, sec80D: n ?? 0 }))} />
            <NumField label="HRA exemption" value={d.hraExemption} onChange={(n) => setD((x) => ({ ...x, hraExemption: n ?? 0 }))} />
            <NumField label="Home-loan interest" value={d.homeLoanInterest} onChange={(n) => setD((x) => ({ ...x, homeLoanInterest: n ?? 0 }))} />
            <NumField label="Other deductions" value={d.otherDeductions} onChange={(n) => setD((x) => ({ ...x, otherDeductions: n ?? 0 }))} />
            <NumField label="Income from a previous employer this year" value={d.previousEmployerIncome} onChange={(n) => setD((x) => ({ ...x, previousEmployerIncome: n ?? 0 }))} />
            <NumField label="Tax deducted by the previous employer" value={d.previousEmployerTds} onChange={(n) => setD((x) => ({ ...x, previousEmployerTds: n ?? 0 }))} />
          </div>
        </fieldset>
      )}

      <div className="flex justify-end gap-2">
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={busy} onClick={() => void save()}>{busy ? "Saving..." : "Save"}</button>
      </div>
    </div>
  );
}
