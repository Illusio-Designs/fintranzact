import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { formatCurrency, formatDate, todayISODate } from "@/lib/utils";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { InputField } from "@/components/ui/FormField";
import { EmptyState } from "@/components/ui/EmptyState";
import { Panel, TABLE, onError } from "./payroll-ui";
import { VerifyWithCa } from "./statutory-ui";
import { Notice } from "./phase4-ui";

const RULE_LABEL: Record<string, string> = { standard: "5 years", fixed_term: "Fixed-term", exempt: "Death or disablement" };

/**
 * Gratuity: what each employee would be paid if they left on a date (15 days of Basic + DA for 26 working days for every
 * completed year, a part year of more than six months counted as a year, the minimum service and the limit from
 * Statutory settings), the total liability, and an optional "Post provision" that books the increase in the liability.
 * Gratuity is paid in the full and final settlement. Tax on gratuity is not calculated.
 */
export function GratuityTab() {
  const utils = trpc.useUtils();
  const [asOf, setAsOf] = useState(todayISODate());
  const q = trpc.payrollGratuity.estimate.useQuery({ asOf });
  const history = trpc.payrollGratuity.provisionHistory.useQuery();
  const [confirm, setConfirm] = useState(false);
  const post = trpc.payrollGratuity.postProvision.useMutation({
    onSuccess: () => {
      toast({ title: "Gratuity provision posted", variant: "success" });
      setConfirm(false);
      void utils.payrollGratuity.estimate.invalidate();
      void utils.payrollGratuity.provisionHistory.invalidate();
    },
    onError: (e) => {
      setConfirm(false);
      onError("Could not post the provision")(e);
    },
  });
  const d = q.data;
  const toProvide = Number(d?.toProvide ?? 0);

  return (
    <div className="space-y-4">
      <VerifyWithCa note="The formula, the minimum years (5 for ordinary staff, 1 for fixed-term), the limit and the provision policy are for your CA to confirm. Tax on gratuity is not calculated." />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <InputField label="As on" type="date" value={asOf} onChange={(e) => e.target.value && setAsOf(e.target.value)} />
        <button className="btn-primary" disabled={!d || toProvide === 0 || post.isPending} onClick={() => setConfirm(true)}>Post provision</button>
      </div>
      {d && (
        <div className="grid gap-3 sm:grid-cols-4">
          {[["Liability today", formatCurrency(d.liability)], ["Provision in the books", formatCurrency(d.provisionInBooks)], ["To provide", formatCurrency(d.toProvide)], ["Eligible employees", String(d.eligibleCount)]].map(([k, v]) => (
            <div key={k} className="rounded-xl border border-border-light bg-surface-0 px-4 py-3" data-testid={`gratuity-${k.toLowerCase().replace(/\W+/g, "-")}`}>
              <p className="text-xs text-text-tertiary">{k}</p>
              <p className="text-lg font-semibold tabular-nums text-text-primary">{v}</p>
            </div>
          ))}
        </div>
      )}
      {d && d.rows.some((r) => !r.hasSalary) && <Notice>Some employees have no salary structure, so their gratuity shows 0 until one is assigned.</Notice>}
      <Panel title="Employees">
        {q.isLoading ? (
          <p className="p-6 text-sm text-text-tertiary">Working out gratuity...</p>
        ) : !d || d.rows.length === 0 ? (
          <EmptyState title="No employees yet" description="Add employees with a joining date and a salary structure." />
        ) : (
          <div className="overflow-x-auto">
            <table className={TABLE}>
              <thead><tr><th>Employee</th><th>Joined</th><th className="text-right">Completed years</th><th className="text-right">Years used</th><th className="text-right">Basic + DA</th><th>Rule</th><th className="text-right">Payable today</th><th className="text-right">If eligible</th></tr></thead>
              <tbody>
                {d.rows.map((r) => (
                  <tr key={r.employeeId}>
                    <td><span className="font-medium text-text-primary">{r.name}</span> <span className="text-xs text-text-tertiary">{r.employeeCode}</span></td>
                    <td className="whitespace-nowrap">{formatDate(r.joinedOn)}</td>
                    <td className="text-right tabular-nums">{r.completedYears}</td>
                    <td className="text-right tabular-nums">{r.yearsUsed}</td>
                    <td className="text-right tabular-nums">{formatCurrency(r.lastDrawnWages)}</td>
                    <td className="text-xs">{RULE_LABEL[r.rule] ?? r.rule}{!r.eligible && <span className="ml-1 text-amber-700 dark:text-amber-400">(needs {r.minYearsRequired} years)</span>}{r.capped && <span className="ml-1 text-text-tertiary">(limit applied)</span>}</td>
                    <td className="text-right font-semibold tabular-nums text-text-primary">{formatCurrency(r.amount)}</td>
                    <td className="text-right tabular-nums text-text-tertiary">{formatCurrency(r.ifEligible)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel title="Provisions posted">
        {(history.data ?? []).length === 0 ? (
          <p className="p-4 text-sm text-text-tertiary">Nothing posted yet. Posting a provision is optional; the report above works without it.</p>
        ) : (
          <table className={TABLE}>
            <thead><tr><th>As on</th><th className="text-right">Liability</th><th className="text-right">Before</th><th className="text-right">Posted</th></tr></thead>
            <tbody>
              {(history.data ?? []).map((p) => (
                <tr key={p.id}><td>{formatDate(p.asOf)}</td><td className="text-right tabular-nums">{formatCurrency(p.liability)}</td><td className="text-right tabular-nums">{formatCurrency(p.previousBalance)}</td><td className="text-right font-medium tabular-nums text-text-primary">{formatCurrency(p.amount)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      <ConfirmDialog
        open={confirm}
        title="Post the gratuity provision?"
        description={`Books ${formatCurrency(Math.abs(toProvide))} ${toProvide < 0 ? "back (the liability fell)" : "as an expense"} so that the Gratuity Provision account equals the liability on ${formatDate(asOf)}. Check the policy with your CA.`}
        confirmLabel="Post provision"
        loading={post.isPending}
        onCancel={() => setConfirm(false)}
        onConfirm={() => post.mutate({ asOf })}
      />
    </div>
  );
}
