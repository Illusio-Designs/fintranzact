import { useState } from "react";
import { BONUS_RUN_STATUSES, BONUS_RUN_STATUS_LABELS, fyLabel } from "@fintranzact/shared";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { InputField, SelectField, TextareaField } from "@/components/ui/FormField";
import { EmptyState } from "@/components/ui/EmptyState";
import { Panel, TABLE, downloadBase64, downloadText, errorMessage, onError } from "./payroll-ui";
import { FyPicker, VerifyWithCa, currentFinancialYear, financialYearOptions } from "./statutory-ui";
import { BankPaymentDialog, BonusStatusBadge, Notice, Steps } from "./phase4-ui";

/**
 * Bonus runs (Payment of Bonus Act), one per financial year: choose the percentage, calculate from the approved payroll,
 * mark anyone not eligible by hand, send for approval (a second person approves), post to the books and pay. The ceilings
 * and percentages come from Statutory settings (they ship empty) and must be verified with your CA. Set-on and set-off of
 * allocable surplus are not calculated.
 */
export function BonusTab() {
  const [selected, setSelected] = useState<string | null>(null);
  if (selected) return <BonusDetail id={selected} onBack={() => setSelected(null)} />;
  return <BonusList onOpen={setSelected} />;
}

function BonusList({ onOpen }: { onOpen: (id: string) => void }) {
  const utils = trpc.useUtils();
  const [fy, setFy] = useState(currentFinancialYear());
  const rules = trpc.payrollBonus.rules.useQuery({ financialYear: fy });
  const runs = trpc.payrollBonus.list.useQuery();
  const [starting, setStarting] = useState(false);
  const rows = runs.data ?? [];
  const gaps = rules.data?.gaps ?? [];
  return (
    <div className="space-y-4">
      <VerifyWithCa note="The eligibility and calculation ceilings, the minimum wage and the percentage are your figures for the year (Statutory settings, Bonus). Confirm them, and how bonus is worked out, with your CA." />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <FyPicker value={fy} onChange={setFy} label="Bonus settings for" />
        <button className="btn-primary" onClick={() => setStarting(true)}>+ New bonus run</button>
      </div>
      {rules.data && gaps.length > 0 && (
        <Notice testId="bonus-gaps">
          {gaps.join(" ")} A bonus run cannot be calculated until they are set.
        </Notice>
      )}
      {rules.data && gaps.length === 0 && (
        <p className="text-sm text-text-secondary" data-testid="bonus-rules">
          For {rules.data.label}: eligible up to {formatCurrency(rules.data.rules.eligibilityCeilingRupees)} a month; bonus wages capped at the higher of {formatCurrency(rules.data.rules.wageCeilingRupees)} and the minimum wage ({formatCurrency(rules.data.rules.minimumWageRupees)}); between {rules.data.rules.minPercent}% and {rules.data.rules.maxPercent}%; at least {rules.data.rules.minWorkingDays} days worked.
          {rules.data.verifiedNote ? ` Last verified: ${rules.data.verifiedNote}.` : " Not yet marked as verified."}
        </p>
      )}
      <Panel>
        {runs.isLoading ? (
          <p className="p-6 text-sm text-text-tertiary">Loading bonus runs...</p>
        ) : rows.length === 0 ? (
          <EmptyState title="No bonus runs yet" description="Approve the payroll runs of a financial year, set the bonus figures, then start a bonus run for the year." action={<button className="btn-primary" onClick={() => setStarting(true)}>+ New bonus run</button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className={TABLE}>
              <thead><tr><th>Financial year</th><th>Status</th><th className="text-right">Bonus %</th><th className="text-right">Eligible</th><th className="text-right">Total bonus</th><th className="text-right"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="font-medium text-text-primary">{fyLabel(r.financialYear)} <span className="text-xs text-text-tertiary">{r.number}</span></td>
                    <td><BonusStatusBadge status={r.status} /></td>
                    <td className="text-right tabular-nums">{Number(r.percent)}%</td>
                    <td className="text-right tabular-nums">{r.eligibleCount} of {r.employeeCount}</td>
                    <td className="text-right font-medium tabular-nums text-text-primary">{formatCurrency(r.totalBonus)}</td>
                    <td className="text-right"><button className="btn-secondary btn-sm" onClick={() => onOpen(r.id)}>Open</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {starting && (
        <StartDialog
          onClose={() => setStarting(false)}
          onCreated={(id) => {
            void utils.payrollBonus.list.invalidate();
            setStarting(false);
            onOpen(id);
          }}
        />
      )}
    </div>
  );
}

function StartDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [fy, setFy] = useState(currentFinancialYear() - 1);
  const [percent, setPercent] = useState("8.33");
  const [error, setError] = useState<string | null>(null);
  const create = trpc.payrollBonus.create.useMutation({ onSuccess: (r) => onCreated(r.id), onError: onError("Could not start the bonus run") });
  function save() {
    const p = Number(percent);
    if (!(p > 0)) return setError("Enter the bonus percentage.");
    setError(null);
    create.mutate({ financialYear: fy, percent: p });
  }
  return (
    <Modal open onClose={onClose} title="New bonus run">
      <div className="space-y-3">
        <SelectField label="Financial year" value={String(fy)} onChange={(e) => setFy(Number(e.target.value))}>
          {financialYearOptions().filter((y) => y <= currentFinancialYear()).map((y) => <option key={y} value={y}>{fyLabel(y)}</option>)}
        </SelectField>
        <InputField label="Bonus percentage" required inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} />
        <p className="text-xs text-text-tertiary">The Act allows 8.33% to 20% of the bonus wages. Confirm the percentage with your CA.</p>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={create.isPending} onClick={save}>Start</button>
        </div>
      </div>
    </Modal>
  );
}

function BonusDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.payrollBonus.get.useQuery({ id });
  const [paying, setPaying] = useState(false);
  const [excluding, setExcluding] = useState<{ employeeId: string; name: string } | null>(null);
  const [confirm, setConfirm] = useState<null | { title: string; description: string; label: string; run: () => void }>(null);
  const refresh = () => {
    void utils.payrollBonus.get.invalidate({ id });
    void utils.payrollBonus.list.invalidate();
  };
  const ok = (title: string) => () => {
    toast({ title, variant: "success" });
    refresh();
  };
  const calculate = trpc.payrollBonus.calculate.useMutation({ onSuccess: ok("Bonus calculated"), onError: onError("Could not calculate") });
  const submit = trpc.payrollBonus.submit.useMutation({ onSuccess: ok("Sent for approval"), onError: onError("Could not submit") });
  const approve = trpc.payrollBonus.approve.useMutation({ onSuccess: ok("Bonus run approved"), onError: onError("Could not approve") });
  const reopen = trpc.payrollBonus.reopen.useMutation({ onSuccess: ok("Reopened as a draft"), onError: onError("Could not reopen") });
  const post = trpc.payrollBonus.post.useMutation({ onSuccess: ok("Posted to the books"), onError: onError("Could not post to the books") });
  const markPaid = trpc.payrollBonus.markPaid.useMutation({
    onSuccess: () => {
      toast({ title: "Bonus marked as paid", variant: "success" });
      setPaying(false);
      refresh();
    },
    onError: onError("Could not record the payment"),
  });
  const del = trpc.payrollBonus.delete.useMutation({
    onSuccess: () => {
      toast({ title: "Bonus run deleted", variant: "success" });
      void utils.payrollBonus.list.invalidate();
      onBack();
    },
    onError: onError("Could not delete the run"),
  });
  const exclude = trpc.payrollBonus.setExclusion.useMutation({
    onSuccess: () => {
      toast({ title: "Saved. Calculate again to apply it.", variant: "success" });
      setExcluding(null);
      refresh();
    },
    onError: onError("Could not save"),
  });

  if (isLoading || !data) return <p className="p-6 text-sm text-text-tertiary">Loading the bonus run...</p>;
  const { run, lines, approval } = data;
  const status = run.status;
  const editable = ["draft", "calculated", "pending_approval"].includes(status);
  const busy = calculate.isPending || submit.isPending || approve.isPending || reopen.isPending || post.isPending;
  const warnings = (run.warnings ?? []) as Array<{ code: string; message: string }>;
  const label = fyLabel(run.financialYear);

  async function fetchFile(kind: "csv" | "pdf" | "bank") {
    try {
      if (kind === "csv") {
        const r = await utils.payrollBonus.statementCsv.fetch({ id }, { staleTime: 0 });
        downloadText(r.filename, r.contentType, r.csv);
      } else if (kind === "pdf") {
        const r = await utils.payrollBonus.statementPdf.fetch({ id }, { staleTime: 0 });
        downloadBase64(r.filename, r.contentType, r.base64);
      } else {
        const r = await utils.payrollBonus.bankFile.fetch({ id }, { staleTime: 0 });
        downloadText(r.filename, r.contentType, r.csv);
        toast({ title: `Bank file ready: ${r.count} payment${r.count === 1 ? "" : "s"}, ${formatCurrency(r.total)}`, description: r.skipped.length ? `Left out for missing bank details: ${r.skipped.join(", ")}.` : "A generic NEFT/RTGS-style CSV, not any one bank's own format.", variant: r.skipped.length ? "warning" : "success" });
      }
    } catch (e) {
      toast({ title: "Could not make the file", description: errorMessage(e), variant: "error" });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button className="btn-secondary btn-sm" onClick={onBack}>‹ All bonus runs</button>
          <h2 className="text-lg font-semibold text-text-primary">Bonus for {label}</h2>
          <BonusStatusBadge status={status} />
        </div>
        <div className="flex flex-wrap gap-2" data-testid="bonus-actions">
          {status === "draft" && <button className="btn-primary" disabled={busy} onClick={() => calculate.mutate({ id })}>Calculate bonus</button>}
          {(status === "calculated" || status === "pending_approval") && <button className="btn-secondary" disabled={busy} onClick={() => calculate.mutate({ id })}>Recalculate</button>}
          {status === "calculated" && <button className="btn-primary" disabled={busy} onClick={() => submit.mutate({ id })}>Submit for approval</button>}
          {status === "pending_approval" && approval.canApprove && (
            <button className="btn-primary" disabled={busy} onClick={() => setConfirm({ title: "Approve this bonus run?", description: "Approving freezes the figures. An approved run cannot be changed or reopened.", label: "Approve", run: () => approve.mutate({ id }) })}>Approve</button>
          )}
          {status === "approved" && <button className="btn-primary" disabled={busy} onClick={() => post.mutate({ id })}>Post to books</button>}
          {status === "posted" && <button className="btn-primary" disabled={busy} onClick={() => setPaying(true)}>Mark as paid</button>}
          {status !== "draft" && <button className="btn-secondary" onClick={() => void fetchFile("csv")}>Statement (CSV)</button>}
          {status !== "draft" && <button className="btn-secondary" onClick={() => void fetchFile("pdf")}>Statement (PDF)</button>}
          {["approved", "posted", "paid"].includes(status) && <button className="btn-secondary" onClick={() => void fetchFile("bank")}>Bank payment file</button>}
          {["calculated", "pending_approval"].includes(status) && <button className="btn-secondary" disabled={busy} onClick={() => setConfirm({ title: "Reopen as a draft?", description: "The calculated figures are discarded. Hand exclusions are kept.", label: "Reopen", run: () => reopen.mutate({ id }) })}>Reopen</button>}
          {status === "draft" && <button className="btn-secondary" disabled={del.isPending} onClick={() => setConfirm({ title: "Delete this draft bonus run?", description: "Nothing has been calculated or posted yet.", label: "Delete", run: () => del.mutate({ id }) })}>Delete</button>}
        </div>
      </div>
      <Steps steps={BONUS_RUN_STATUSES} labels={BONUS_RUN_STATUS_LABELS} current={status} />
      <VerifyWithCa note="Check the percentage, the ceilings and who is excluded with your CA before approving. Set-on and set-off of allocable surplus are not calculated." />
      {status === "pending_approval" && !approval.canApprove && approval.reason && <Notice>{approval.reason}</Notice>}
      {status === "paid" && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">Paid on {formatDate(run.paidOn)}{run.paidReference ? ` (${run.paidReference})` : ""}.</p>}
      {warnings.length > 0 && (
        <Panel title={`${warnings.length} thing${warnings.length === 1 ? "" : "s"} to check`}>
          <ul className="list-disc space-y-1 px-8 py-3 text-sm text-text-secondary">{warnings.map((w, i) => <li key={i}>{w.message}</li>)}</ul>
        </Panel>
      )}
      <div className="grid gap-3 sm:grid-cols-4">
        {[["Bonus percentage", `${Number(run.percent)}%`], ["Employees", String(run.employeeCount)], ["Eligible", String(run.eligibleCount)], ["Total bonus", formatCurrency(run.totalBonus)]].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-border-light bg-surface-0 px-4 py-3">
            <p className="text-xs text-text-tertiary">{k}</p>
            <p className="text-lg font-semibold tabular-nums text-text-primary">{v}</p>
          </div>
        ))}
      </div>
      <Panel title="Employees">
        {lines.length === 0 ? (
          <EmptyState title="Nothing calculated yet" description="Calculate the bonus from the approved payroll of the year." />
        ) : (
          <div className="overflow-x-auto">
            <table className={TABLE}>
              <thead><tr><th>Employee</th><th className="text-right">Months</th><th className="text-right">Basic + DA</th><th className="text-right">Bonus wages</th><th className="text-right">Bonus</th><th>Note</th><th className="text-right"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td><span className="font-medium text-text-primary">{l.employeeName}</span> <span className="text-xs text-text-tertiary">{l.employeeCode}</span></td>
                    <td className="text-right tabular-nums">{l.monthsPaid}</td>
                    <td className="text-right tabular-nums">{formatCurrency(l.wages)}</td>
                    <td className="text-right tabular-nums">{formatCurrency(l.calculationWages)}</td>
                    <td className="text-right font-semibold tabular-nums text-text-primary">{formatCurrency(l.bonus)}</td>
                    <td className={l.eligible ? "text-xs text-text-tertiary" : "text-xs text-amber-700 dark:text-amber-400"}>{l.eligible ? "" : l.reasonText}</td>
                    <td className="whitespace-nowrap text-right">
                      {editable && (l.reason === "manual" && run.exclusions?.[l.employeeId]
                        ? <button className="btn-secondary btn-sm" disabled={exclude.isPending} onClick={() => exclude.mutate({ runId: id, employeeId: l.employeeId, reason: "" })}>Make eligible</button>
                        : l.eligible && <button className="btn-secondary btn-sm" onClick={() => setExcluding({ employeeId: l.employeeId, name: l.employeeName })}>Not eligible</button>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {excluding && <ExcludeDialog name={excluding.name} pending={exclude.isPending} onClose={() => setExcluding(null)} onSave={(reason) => exclude.mutate({ runId: id, employeeId: excluding.employeeId, reason })} />}
      {paying && (
        <BankPaymentDialog
          title="Mark bonus as paid"
          description={`Records ${formatCurrency(run.totalBonus)} going out of the account and clears Bonus Payable. Make the transfers first.`}
          confirmLabel="Mark as paid"
          accountLabel="Paid from"
          dateLabel="Paid on"
          pending={markPaid.isPending}
          onClose={() => setPaying(false)}
          onSubmit={(v) => markPaid.mutate({ runId: id, bankAccountId: v.bankAccountId, paidOn: v.date, reference: v.reference })}
        />
      )}
      <ConfirmDialog open={!!confirm} title={confirm?.title ?? ""} description={confirm?.description} confirmLabel={confirm?.label} onCancel={() => setConfirm(null)} onConfirm={() => { confirm?.run(); setConfirm(null); }} />
    </div>
  );
}

function ExcludeDialog({ name, pending, onClose, onSave }: { name: string; pending: boolean; onClose: () => void; onSave: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <Modal open onClose={onClose} title={`${name}: not eligible`}>
      <div className="space-y-3">
        <p className="text-sm text-text-secondary">For example dismissal for misconduct. The reason is kept on the bonus statement.</p>
        <TextareaField label="Reason" required rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={pending || reason.trim().length < 3} onClick={() => onSave(reason.trim())}>Save</button>
        </div>
      </div>
    </Modal>
  );
}
