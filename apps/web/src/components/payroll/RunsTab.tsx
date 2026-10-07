import { Fragment, useState } from "react";
import { MAKER_CHECKER_MESSAGE, PAYROLL_RUN_STATUS_LABELS, markPaidSchema, type PayrollRunStatus } from "@fintranzact/shared";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { formatCurrency, formatDate, todayISODate } from "@/lib/utils";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { InputField, SelectField } from "@/components/ui/FormField";
import { EmptyState } from "@/components/ui/EmptyState";
import { Panel, RunStatusBadge, TABLE, currentMonth, downloadBase64, downloadText, errorMessage, monthLabel, onError, shiftMonth } from "./payroll-ui";

export function RunsTab() {
  const [selected, setSelected] = useState<string | null>(null);
  if (selected) return <RunDetail id={selected} onBack={() => setSelected(null)} />;
  return <RunList onOpen={setSelected} />;
}

function RunList({ onOpen }: { onOpen: (id: string) => void }) {
  const utils = trpc.useUtils();
  const runs = trpc.payrollRun.list.useQuery();
  const [starting, setStarting] = useState(false);
  const rows = runs.data ?? [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-text-secondary">
          Each month: lock attendance, calculate, review and approve (a second person approves), then post to the books and pay. Approved payslips are final.
        </p>
        <button className="btn-primary" onClick={() => setStarting(true)}>+ Start payroll</button>
      </div>
      <Panel>
        {runs.isLoading ? (
          <p className="p-6 text-sm text-text-tertiary">Loading payroll runs...</p>
        ) : rows.length === 0 ? (
          <EmptyState title="No payroll runs yet" description="Start a run for a month once employees have a salary and attendance." action={<button className="btn-primary" onClick={() => setStarting(true)}>+ Start payroll</button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className={TABLE}>
              <thead><tr><th>Month</th><th>Status</th><th className="text-right">Employees</th><th className="text-right">Gross</th><th className="text-right">Net pay</th><th className="text-right"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="font-medium text-text-primary">{monthLabel(r.month)}</td>
                    <td><RunStatusBadge status={r.status} /></td>
                    <td className="text-right tabular-nums">{r.employeeCount}</td>
                    <td className="text-right tabular-nums">{formatCurrency(r.grossTotal)}</td>
                    <td className="text-right tabular-nums font-medium text-text-primary">{formatCurrency(r.netTotal)}</td>
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
            void utils.payrollRun.list.invalidate();
            setStarting(false);
            onOpen(id);
          }}
        />
      )}
    </div>
  );
}

function StartDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [month, setMonth] = useState(currentMonth());
  const months = Array.from({ length: 18 }, (_, i) => shiftMonth(currentMonth(), -i));
  const create = trpc.payrollRun.create.useMutation({ onSuccess: (r) => onCreated(r.id), onError: onError("Could not start the run") });
  return (
    <Modal open onClose={onClose} title="Start payroll">
      <div className="space-y-3">
        <SelectField label="Month" value={month} onChange={(e) => setMonth(e.target.value)}>
          {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </SelectField>
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={create.isPending} onClick={() => create.mutate({ month })}>Start</button>
        </div>
      </div>
    </Modal>
  );
}

const STEPS: PayrollRunStatus[] = ["draft", "attendance_locked", "calculated", "pending_approval", "approved", "posted", "paid"];

function RunDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.payrollRun.get.useQuery({ id });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [fillDialog, setFillDialog] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [adjusting, setAdjusting] = useState<{ employeeId: string; name: string } | null>(null);
  const [confirm, setConfirm] = useState<null | { title: string; description: string; run: () => void; label: string }>(null);

  const refresh = () => {
    void utils.payrollRun.get.invalidate({ id });
    void utils.payrollRun.list.invalidate();
  };
  const ok = (title: string) => () => {
    toast({ title, variant: "success" });
    refresh();
  };
  const lock = trpc.payrollRun.lockAttendance.useMutation({
    onSuccess: (r) => {
      toast({ title: "Attendance locked", description: r.filled ? `${r.filled} missing day(s) were filled in.` : undefined, variant: "success" });
      setFillDialog(null);
      refresh();
    },
    onError: (e) => {
      // Missing working days: offer how to count them instead of failing.
      if (/with no attendance/.test(errorMessage(e))) setFillDialog(errorMessage(e));
      else onError("Could not lock attendance")(e);
    },
  });
  const calculate = trpc.payrollRun.calculate.useMutation({ onSuccess: ok("Payroll calculated"), onError: onError("Could not calculate") });
  const submit = trpc.payrollRun.submit.useMutation({ onSuccess: ok("Sent for approval"), onError: onError("Could not submit") });
  const approve = trpc.payrollRun.approve.useMutation({ onSuccess: ok("Payroll approved. Payslips are ready."), onError: onError("Could not approve") });
  const reopen = trpc.payrollRun.reopen.useMutation({ onSuccess: ok("Run reopened as a draft"), onError: onError("Could not reopen") });
  const post = trpc.payrollRun.post.useMutation({ onSuccess: ok("Posted to the books"), onError: onError("Could not post to the books") });
  const del = trpc.payrollRun.delete.useMutation({
    onSuccess: () => {
      toast({ title: "Run deleted", variant: "success" });
      void utils.payrollRun.list.invalidate();
      onBack();
    },
    onError: onError("Could not delete the run"),
  });
  const removeAdj = trpc.payrollRun.removeAdjustment.useMutation({ onSuccess: ok("Adjustment removed. Calculate again to apply it."), onError: onError("Could not remove the adjustment") });

  const email = trpc.payrollRun.payslipEmail.useMutation({
    onSuccess: (r) => {
      toast({ title: "Payslip emailed", description: `Sent to ${r.sentTo}.`, variant: "success" });
      refresh();
    },
    onError: onError("Could not email the payslip"),
  });

  if (isLoading || !data) return <p className="p-6 text-sm text-text-tertiary">Loading the run...</p>;
  const { run, lines, adjustments, approval } = data;
  const status = run.status as PayrollRunStatus;
  const editable = ["draft", "attendance_locked", "calculated", "pending_approval"].includes(status);
  const busy = lock.isPending || calculate.isPending || submit.isPending || approve.isPending || reopen.isPending || post.isPending;
  const warnings = (run.warnings ?? []) as Array<{ code: string; message: string }>;

  async function downloadPayslip(employeeId: string, name: string) {
    try {
      const r = await utils.payrollRun.payslipPdf.fetch({ runId: id, employeeId }, { staleTime: 0 });
      downloadBase64(r.filename, r.contentType, r.base64);
    } catch (e) {
      toast({ title: `Could not open ${name}'s payslip`, description: errorMessage(e), variant: "error" });
    }
  }

  async function downloadBankFile() {
    try {
      const r = await utils.payrollRun.bankFile.fetch({ id }, { staleTime: 0 });
      downloadText(r.filename, r.contentType, r.csv);
      toast({
        title: `Bank file ready: ${r.count} payment${r.count === 1 ? "" : "s"}, ${formatCurrency(r.total)}`,
        description: r.skipped.length ? `Left out for missing bank details: ${r.skipped.join(", ")}.` : "A generic NEFT/RTGS-style CSV, not any one bank's own format.",
        variant: r.skipped.length ? "warning" : "success",
      });
    } catch (e) {
      toast({ title: "Could not make the bank file", description: errorMessage(e), variant: "error" });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button className="btn-secondary btn-sm" onClick={onBack}>‹ All runs</button>
          <h2 className="text-lg font-semibold text-text-primary">Payroll for {monthLabel(run.month)}</h2>
          <RunStatusBadge status={run.status} />
        </div>
        <div className="flex flex-wrap gap-2" data-testid="run-actions">
          {status === "draft" && <button className="btn-primary" disabled={busy} onClick={() => lock.mutate({ id })}>Lock attendance</button>}
          {status === "attendance_locked" && <button className="btn-primary" disabled={busy} onClick={() => calculate.mutate({ id })}>Calculate payroll</button>}
          {(status === "calculated" || status === "pending_approval") && <button className="btn-secondary" disabled={busy} onClick={() => calculate.mutate({ id })}>Recalculate</button>}
          {status === "calculated" && <button className="btn-primary" disabled={busy} onClick={() => submit.mutate({ id })}>Submit for approval</button>}
          {status === "pending_approval" && approval.canApprove && (
            <button className="btn-primary" disabled={busy} onClick={() => setConfirm({ title: "Approve this payroll?", description: "Approving freezes the figures and creates the payslips. An approved run cannot be changed or reopened.", label: "Approve", run: () => approve.mutate({ id }) })}>Approve</button>
          )}
          {status === "approved" && <button className="btn-primary" disabled={busy} onClick={() => post.mutate({ id })}>Post to books</button>}
          {status === "posted" && <button className="btn-primary" disabled={busy} onClick={() => setPaying(true)}>Mark as paid</button>}
          {["approved", "posted", "paid"].includes(status) && <button className="btn-secondary" onClick={() => void downloadBankFile()}>Bank payment file</button>}
          {["attendance_locked", "calculated", "pending_approval"].includes(status) && <button className="btn-secondary" disabled={busy} onClick={() => setConfirm({ title: "Reopen as a draft?", description: "The calculated figures are discarded and attendance can be changed again. Adjustments are kept.", label: "Reopen", run: () => reopen.mutate({ id }) })}>Reopen</button>}
          {status === "draft" && <button className="btn-secondary" disabled={del.isPending} onClick={() => setConfirm({ title: "Delete this draft run?", description: "Nothing has been calculated or posted yet.", label: "Delete", run: () => del.mutate({ id }) })}>Delete</button>}
        </div>
      </div>

      <ol className="flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Payroll steps">
        {STEPS.map((s, i) => (
          <li key={s} className={STEPS.indexOf(status) >= i ? "font-semibold text-brand-700 dark:text-brand-300" : "text-text-tertiary"} aria-current={s === status ? "step" : undefined}>
            {i + 1}. {PAYROLL_RUN_STATUS_LABELS[s]}
          </li>
        ))}
      </ol>

      {status === "pending_approval" && !approval.canApprove && approval.reason && (
        <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          {approval.reason === MAKER_CHECKER_MESSAGE ? `${approval.reason}` : approval.reason}
        </p>
      )}
      {run.status === "paid" && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">Paid on {formatDate(run.paidOn)}{run.paidReference ? ` (${run.paidReference})` : ""}.</p>}
      {warnings.length > 0 && (
        <Panel title={`${warnings.length} thing${warnings.length === 1 ? "" : "s"} to check`}>
          <ul className="list-disc space-y-1 px-8 py-3 text-sm text-text-secondary">
            {warnings.map((w, i) => <li key={i}>{w.message}</li>)}
          </ul>
        </Panel>
      )}

      <div className="grid gap-3 sm:grid-cols-4">
        {[["Employees", String(run.employeeCount)], ["Gross earnings", formatCurrency(run.grossTotal)], ["Deductions", formatCurrency(run.deductionsTotal)], ["Net pay", formatCurrency(run.netTotal)]].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-border-light bg-surface-0 px-4 py-3">
            <p className="text-xs text-text-tertiary">{k}</p>
            <p className="text-lg font-semibold tabular-nums text-text-primary">{v}</p>
          </div>
        ))}
      </div>

      <Panel title="Employees">
        {lines.length === 0 ? (
          <EmptyState title="Nothing calculated yet" description={status === "draft" ? "Lock the month's attendance, then calculate." : "Calculate the payroll to see each employee's pay."} />
        ) : (
          <div className="overflow-x-auto">
            <table className={TABLE}>
              <thead><tr><th>Employee</th><th className="text-right">Paid days</th><th className="text-right">LOP</th><th className="text-right">Gross</th><th className="text-right">Deductions</th><th className="text-right">Net pay</th><th className="text-right"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {lines.map((l) => {
                  const open = expanded === l.id;
                  return (
                    <Fragment key={l.id}>
                      <tr>
                        <td>
                          <button className="text-left font-medium text-brand-700 hover:underline dark:text-brand-300" aria-expanded={open} onClick={() => setExpanded(open ? null : l.id)}>{l.employeeName}</button>
                          <span className="ml-2 text-xs text-text-tertiary">{l.employeeCode}</span>
                          {l.isFinalSettlement && <span className="ml-2 rounded bg-surface-2 px-1.5 py-0.5 text-2xs text-text-secondary">Final month</span>}
                          {!l.hasBankDetails && status !== "draft" && <span className="ml-2 text-2xs text-amber-700 dark:text-amber-400">No bank details</span>}
                        </td>
                        <td className="text-right tabular-nums">{Number(l.paidDays)}</td>
                        <td className="text-right tabular-nums">{Number(l.lopDays)}</td>
                        <td className="text-right tabular-nums">{formatCurrency(l.grossEarnings)}</td>
                        <td className="text-right tabular-nums">{formatCurrency(l.totalDeductions)}</td>
                        <td className={Number(l.netPay) < 0 ? "text-right tabular-nums font-semibold text-red-600" : "text-right tabular-nums font-semibold text-text-primary"}>{formatCurrency(l.netPay)}</td>
                        <td className="whitespace-nowrap text-right">
                          {editable && status !== "draft" && <button className="btn-secondary btn-sm mr-2" onClick={() => setAdjusting({ employeeId: l.employeeId, name: l.employeeName })}>Adjust</button>}
                          <button className="btn-secondary btn-sm mr-2" onClick={() => void downloadPayslip(l.employeeId, l.employeeName)}>Payslip</button>
                          {!editable && <button className="btn-secondary btn-sm" disabled={email.isPending} onClick={() => email.mutate({ runId: id, employeeId: l.employeeId })}>{l.payslipEmailedAt ? "Email again" : "Email"}</button>}
                        </td>
                      </tr>
                      {open && (
                        <tr>
                          <td colSpan={7} className="bg-surface-1">
                            <table className="w-full text-xs" aria-label={`${l.employeeName} pay breakdown`}>
                              <tbody>
                                {l.components.filter((c) => Number(c.amount) > 0 || Number(c.full) > 0).map((c, i) => (
                                  <tr key={`${c.code}-${i}`}>
                                    <td className="py-1 pl-4">{c.name}{c.type === "deduction" ? " (deduction)" : c.type === "employer_contribution" ? " (employer contribution)" : ""}</td>
                                    <td className="py-1 text-right text-text-tertiary">{c.source === "structure" && c.full !== c.amount ? `of ${formatCurrency(c.full)}` : ""}</td>
                                    <td className="py-1 pr-4 text-right tabular-nums">{formatCurrency(c.amount)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {adjustments.length > 0 && (
        <Panel title="Adjustments in this run">
          <table className={TABLE}>
            <thead><tr><th>Employee</th><th>Item</th><th className="text-right">Amount</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {adjustments.map((a) => (
                <tr key={a.id}>
                  <td>{lines.find((l) => l.employeeId === a.employeeId)?.employeeName ?? "Employee"}</td>
                  <td>{a.name} <span className="text-xs text-text-tertiary">({a.type === "earning" ? "earning" : "deduction"})</span></td>
                  <td className="text-right tabular-nums">{formatCurrency(a.amount)}</td>
                  <td className="text-right">{editable && <button className="btn-secondary btn-sm" onClick={() => removeAdj.mutate({ runId: id, adjustmentId: a.id })}>Remove</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {run.accrualJournalEntryId && (
        <p className="text-xs text-text-tertiary">
          Posted to the books on {formatDate(run.postedAt)} as one journal entry{run.paymentJournalEntryId ? ", and the payment as a second" : ""}. See Journal entries.
        </p>
      )}

      {fillDialog && (
        <Modal open onClose={() => setFillDialog(null)} title="Some days have no attendance">
          <div className="space-y-3">
            <p className="text-sm text-text-secondary">{fillDialog}</p>
            <div className="flex flex-wrap justify-end gap-2">
              <button className="btn-secondary" onClick={() => setFillDialog(null)}>Go back and mark them</button>
              <button className="btn-secondary" disabled={lock.isPending} onClick={() => lock.mutate({ id, fillUnmarked: "absent" })}>Count them as absent</button>
              <button className="btn-primary" disabled={lock.isPending} onClick={() => lock.mutate({ id, fillUnmarked: "present" })}>Count them as present</button>
            </div>
          </div>
        </Modal>
      )}
      {paying && <PayDialog runId={id} net={run.netTotal} onClose={() => setPaying(false)} onPaid={() => { setPaying(false); refresh(); }} />}
      {adjusting && <AdjustDialog runId={id} target={adjusting} onClose={() => setAdjusting(null)} onSaved={refresh} />}
      {confirm && (
        <ConfirmDialog
          open
          title={confirm.title}
          description={confirm.description}
          confirmLabel={confirm.label}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            confirm.run();
            setConfirm(null);
          }}
        />
      )}
    </div>
  );
}

function AdjustDialog({ runId, target, onClose, onSaved }: { runId: string; target: { employeeId: string; name: string }; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("Advance recovery");
  const [type, setType] = useState<"earning" | "deduction">("deduction");
  const [amount, setAmount] = useState("");
  const add = trpc.payrollRun.addAdjustment.useMutation({
    onSuccess: () => {
      toast({ title: "Adjustment added. Calculate again to apply it.", variant: "success" });
      onSaved();
      onClose();
    },
    onError: onError("Could not add the adjustment"),
  });
  return (
    <Modal open onClose={onClose} title={`Adjust ${target.name}'s pay`}>
      <div className="space-y-3">
        <SelectField label="Type" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
          <option value="deduction">Deduction (advance recovery, loan instalment, fine)</option>
          <option value="earning">Earning (incentive, arrears, reimbursement)</option>
        </SelectField>
        <InputField label="Name on the payslip" required value={name} onChange={(e) => setName(e.target.value)} />
        <InputField label="Amount" required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <p className="text-xs text-text-tertiary">PF, ESI, professional tax and income tax are not calculated yet: enter them here as deductions if you deduct them.</p>
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={add.isPending || !name.trim() || !(Number(amount) > 0)} onClick={() => add.mutate({ runId, employeeId: target.employeeId, name: name.trim(), type, amount: Number(amount) })}>Add</button>
        </div>
      </div>
    </Modal>
  );
}

function PayDialog({ runId, net, onClose, onPaid }: { runId: string; net: string; onClose: () => void; onPaid: () => void }) {
  const accounts = trpc.bankAccount.list.useQuery();
  const [bankAccountId, setBank] = useState("");
  const [paidOn, setPaidOn] = useState(todayISODate());
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const pay = trpc.payrollRun.markPaid.useMutation({
    onSuccess: () => {
      toast({ title: "Salaries marked as paid", variant: "success" });
      onPaid();
    },
    onError: onError("Could not record the payment"),
  });
  function save() {
    const parsed = markPaidSchema.safeParse({ runId, bankAccountId, paidOn, reference });
    if (!parsed.success) return setError(parsed.error.issues[0]!.message.includes("Invalid uuid") ? "Choose the bank or cash account the salaries were paid from." : parsed.error.issues[0]!.message);
    setError(null);
    pay.mutate(parsed.data);
  }
  return (
    <Modal open onClose={onClose} title="Mark salaries as paid">
      <div className="space-y-3">
        <p className="text-sm text-text-secondary">Records {formatCurrency(net)} going out of the account and clears Salaries Payable. Make the bank transfers first.</p>
        <SelectField label="Paid from" required value={bankAccountId} onChange={(e) => setBank(e.target.value)}>
          <option value="">Choose...</option>
          {(accounts.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.accountName}</option>)}
        </SelectField>
        <InputField label="Paid on" type="date" required value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
        <InputField label="Reference (batch or UTR)" value={reference} onChange={(e) => setReference(e.target.value)} />
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={pay.isPending}>Mark as paid</button>
        </div>
      </div>
    </Modal>
  );
}
