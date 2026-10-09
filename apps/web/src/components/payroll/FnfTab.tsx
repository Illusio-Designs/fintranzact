import { useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@fintranzact/api";
import { FNF_FLOW_STATUSES, FNF_REVERSAL_REASON_MIN, FNF_STATUS_LABELS, LEAVE_ENCASHMENT_BASES, LEAVE_ENCASHMENT_BASIS_LABELS, type LeaveEncashmentBasis } from "@fintranzact/shared";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { InputField, SelectField } from "@/components/ui/FormField";
import { EmptyState } from "@/components/ui/EmptyState";
import { Panel, TABLE, downloadBase64, errorMessage, onError } from "./payroll-ui";
import { VerifyWithCa } from "./statutory-ui";
import { BankPaymentDialog, FnfStatusBadge, Notice, Steps } from "./phase4-ui";
import { LetterPanel } from "./LetterPanel";

/**
 * Full and final settlement when an employee leaves: leave encashment, gratuity, bonus due and other amounts due, less
 * the notice-period recovery, a manual TDS amount, other recoveries and the balance of any loan or advance. The last
 * month's salary is NOT here: the payroll run of the exit month pays it (the settlement waits for that run to be approved),
 * so it can never be paid twice. TDS on the settlement is not calculated.
 */
export function FnfTab() {
  const [selected, setSelected] = useState<string | null>(null);
  if (selected) return <FnfDetail id={selected} onBack={() => setSelected(null)} />;
  return <FnfList onOpen={setSelected} />;
}

function FnfList({ onOpen }: { onOpen: (id: string) => void }) {
  const utils = trpc.useUtils();
  const list = trpc.payrollFnf.list.useQuery();
  const [starting, setStarting] = useState(false);
  const rows = list.data ?? [];
  return (
    <div className="space-y-4">
      <VerifyWithCa note="Leave encashment rate, gratuity, notice recovery and the tax on the settlement are for your CA to confirm. TDS on the settlement is not calculated." />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-text-secondary">Record the employee's exit on the Employees tab first, approve the payroll run of the exit month, then settle here.</p>
        <button className="btn-primary" onClick={() => setStarting(true)}>+ New settlement</button>
      </div>
      <Panel>
        {list.isLoading ? (
          <p className="p-6 text-sm text-text-tertiary">Loading settlements...</p>
        ) : rows.length === 0 ? (
          <EmptyState title="No settlements yet" description="When an employee leaves, prepare their full and final settlement here." action={<button className="btn-primary" onClick={() => setStarting(true)}>+ New settlement</button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className={TABLE}>
              <thead><tr><th>Settlement</th><th>Employee</th><th>Last working day</th><th>Status</th><th className="text-right">Net payable</th><th className="text-right"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id}>
                    <td className="font-medium text-text-primary">{s.number}</td>
                    <td>{s.employeeName} <span className="text-xs text-text-tertiary">{s.employeeCode}</span></td>
                    <td className="whitespace-nowrap">{formatDate(s.lastWorkingDay)}</td>
                    <td><FnfStatusBadge status={s.status} /></td>
                    <td className="text-right font-medium tabular-nums text-text-primary">{formatCurrency(s.netPayable)}</td>
                    <td className="text-right"><button className="btn-secondary btn-sm" onClick={() => onOpen(s.id)}>Open</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <LetterPanel />
      {starting && (
        <StartDialog
          settledEmployeeIds={new Set(rows.filter((r) => r.status !== "reversed").map((r) => r.employeeId))}
          onClose={() => setStarting(false)}
          onCreated={(id) => {
            void utils.payrollFnf.list.invalidate();
            setStarting(false);
            onOpen(id);
          }}
        />
      )}
    </div>
  );
}

function StartDialog({ settledEmployeeIds, onClose, onCreated }: { settledEmployeeIds: Set<string>; onClose: () => void; onCreated: (id: string) => void }) {
  const exited = trpc.payrollEmployee.list.useQuery({ status: "exited", page: 1, limit: 200 });
  const [employeeId, setEmployeeId] = useState("");
  const [basis, setBasis] = useState<LeaveEncashmentBasis>("basic_da_26");
  const create = trpc.payrollFnf.create.useMutation({ onSuccess: (r) => onCreated(r.id), onError: onError("Could not start the settlement") });
  const options = (exited.data?.data ?? []).filter((e) => !settledEmployeeIds.has(e.id));
  return (
    <Modal open onClose={onClose} title="New full and final settlement">
      <div className="space-y-3">
        <SelectField label="Employee who has left" required value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
          <option value="">Choose...</option>
          {options.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.employeeCode})</option>)}
        </SelectField>
        {exited.data && options.length === 0 && <p className="text-sm text-text-tertiary">Nobody is waiting for a settlement. Record an employee's exit on the Employees tab first.</p>}
        <SelectField label="Leave encashment rate" value={basis} onChange={(e) => setBasis(e.target.value as LeaveEncashmentBasis)}>
          {LEAVE_ENCASHMENT_BASES.map((b) => <option key={b} value={b}>{LEAVE_ENCASHMENT_BASIS_LABELS[b]}</option>)}
        </SelectField>
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!employeeId || create.isPending} onClick={() => create.mutate({ employeeId, encashmentBasis: basis })}>Start</button>
        </div>
      </div>
    </Modal>
  );
}

interface ManualLine {
  name: string;
  amount: string;
  kind?: "arrears" | "other_earning";
}

function FnfDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.payrollFnf.get.useQuery({ id });
  const [paying, setPaying] = useState(false);
  const [reversing, setReversing] = useState<null | "settlement" | "payment">(null);
  const [confirm, setConfirm] = useState<null | { title: string; description: string; label: string; run: () => void }>(null);
  const refresh = () => {
    void utils.payrollFnf.get.invalidate({ id });
    void utils.payrollFnf.list.invalidate();
  };
  const ok = (title: string) => () => {
    toast({ title, variant: "success" });
    refresh();
  };
  const calculate = trpc.payrollFnf.calculate.useMutation({ onSuccess: ok("Settlement calculated"), onError: onError("Could not calculate") });
  const submit = trpc.payrollFnf.submit.useMutation({ onSuccess: ok("Sent for approval"), onError: onError("Could not submit") });
  const approve = trpc.payrollFnf.approve.useMutation({ onSuccess: ok("Settlement approved"), onError: onError("Could not approve") });
  const reopen = trpc.payrollFnf.reopen.useMutation({ onSuccess: ok("Reopened as a draft"), onError: onError("Could not reopen") });
  const post = trpc.payrollFnf.post.useMutation({ onSuccess: ok("Posted to the books"), onError: onError("Could not post to the books") });
  const markPaid = trpc.payrollFnf.markPaid.useMutation({
    onSuccess: () => {
      toast({ title: "Settlement marked as paid", variant: "success" });
      setPaying(false);
      refresh();
    },
    onError: onError("Could not record the payment"),
  });
  const reverse = trpc.payrollFnf.reverse.useMutation({
    onSuccess: () => {
      toast({ title: "Settlement reversed", variant: "success" });
      setReversing(null);
      refresh();
    },
    onError: onError("Could not reverse the settlement"),
  });
  const reversePayment = trpc.payrollFnf.reversePayment.useMutation({
    onSuccess: () => {
      toast({ title: "Payment reversed", variant: "success" });
      setReversing(null);
      refresh();
    },
    onError: onError("Could not reverse the payment"),
  });
  const del = trpc.payrollFnf.delete.useMutation({
    onSuccess: () => {
      toast({ title: "Settlement deleted", variant: "success" });
      void utils.payrollFnf.list.invalidate();
      onBack();
    },
    onError: onError("Could not delete"),
  });

  if (isLoading || !data) return <p className="p-6 text-sm text-text-tertiary">Loading the settlement...</p>;
  const { settlement: s, lines, salary, approval, employee } = data;
  const status = s.status;
  const busy = calculate.isPending || submit.isPending || approve.isPending || reopen.isPending || post.isPending;
  const warnings = (s.warnings ?? []) as Array<{ code: string; message: string }>;
  const earnings = lines.filter((l) => l.side === "earning");
  const deductions = lines.filter((l) => l.side === "deduction");

  async function statement() {
    try {
      const r = await utils.payrollFnf.statementPdf.fetch({ id }, { staleTime: 0 });
      downloadBase64(r.filename, r.contentType, r.base64);
    } catch (e) {
      toast({ title: "Could not make the statement", description: errorMessage(e), variant: "error" });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button className="btn-secondary btn-sm" onClick={onBack}>‹ All settlements</button>
          <h2 className="text-lg font-semibold text-text-primary">{s.number} for {employee?.name}</h2>
          <FnfStatusBadge status={status} />
        </div>
        <div className="flex flex-wrap gap-2" data-testid="fnf-actions">
          {status === "draft" && <button className="btn-secondary" disabled={busy} onClick={() => calculate.mutate({ id })}>Recalculate</button>}
          {status === "draft" && <button className="btn-primary" disabled={busy} onClick={() => submit.mutate({ id })}>Submit for approval</button>}
          {status === "pending_approval" && approval.canApprove && (
            <button className="btn-primary" disabled={busy} onClick={() => setConfirm({ title: "Approve this settlement?", description: "Approving records the leave encashed and the loan balances recovered, and freezes the figures.", label: "Approve", run: () => approve.mutate({ id }) })}>Approve</button>
          )}
          {status === "pending_approval" && <button className="btn-secondary" disabled={busy} onClick={() => reopen.mutate({ id })}>Back to draft</button>}
          {status === "approved" && <button className="btn-primary" disabled={busy} onClick={() => post.mutate({ id })}>Post to books</button>}
          {status === "posted" && <button className="btn-primary" disabled={busy} onClick={() => setPaying(true)}>Mark as paid</button>}
          {status === "posted" && <button className="btn-secondary" disabled={busy} onClick={() => setReversing("settlement")}>Reverse settlement</button>}
          {status === "paid" && <button className="btn-secondary" disabled={busy} onClick={() => setReversing("payment")}>Reverse payment</button>}
          <button className="btn-secondary" onClick={() => void statement()}>Statement (PDF)</button>
          {status === "draft" && <button className="btn-secondary" disabled={del.isPending} onClick={() => setConfirm({ title: "Delete this draft settlement?", description: "Nothing has been approved or posted yet.", label: "Delete", run: () => del.mutate({ id }) })}>Delete</button>}
        </div>
      </div>
      {status === "reversed" ? (
        <Notice testId="fnf-reversed">
          This settlement was reversed{s.reversedAt ? ` on ${formatDate(s.reversedAt)}` : ""}{s.reversedByName ? ` by ${s.reversedByName}` : ""}. Reason: {s.reversalReason}. The entry in the books, the loan recoveries and the leave encashment were undone; the employee is still shown as having left. Start a new settlement from the list if one is still needed.
        </Notice>
      ) : (
        <Steps steps={FNF_FLOW_STATUSES} labels={FNF_STATUS_LABELS} current={status} />
      )}
      {s.paymentReversedAt && status === "posted" && <Notice testId="fnf-payment-reversed">The payment was reversed on {formatDate(s.paymentReversedAt)}. Reason: {s.paymentReversalReason}.</Notice>}
      {status === "pending_approval" && !approval.canApprove && approval.reason && <Notice>{approval.reason}</Notice>}
      <Notice testId="fnf-salary">{salary.message}</Notice>
      <Notice testId="fnf-tds">{data.tdsWarning}</Notice>
      {warnings.filter((w) => w.code !== "tds_not_computed").length > 0 && (
        <Panel title="Things to check">
          <ul className="list-disc space-y-1 px-8 py-3 text-sm text-text-secondary">
            {warnings.filter((w) => w.code !== "tds_not_computed").map((w, i) => <li key={i}>{w.message}</li>)}
          </ul>
        </Panel>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        {[["Amounts due", formatCurrency(s.grossTotal)], ["Recoveries", formatCurrency(s.deductionsTotal)], ["Net payable", formatCurrency(s.netPayable)]].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-border-light bg-surface-0 px-4 py-3">
            <p className="text-xs text-text-tertiary">{k}</p>
            <p className="text-lg font-semibold tabular-nums text-text-primary">{v}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <LineTable title="Amounts due" rows={earnings} />
        <LineTable title="Recoveries" rows={deductions} />
      </div>
      {status === "draft" && <InputsForm key={`${s.id}-${s.updatedAt}`} data={data} />}
      {paying && (
        <BankPaymentDialog
          title="Mark the settlement as paid"
          description={`Records ${formatCurrency(s.netPayable)} going out of the account and clears Full and Final Settlements Payable. Make the transfer first.`}
          confirmLabel="Mark as paid"
          accountLabel="Paid from"
          dateLabel="Paid on"
          pending={markPaid.isPending}
          onClose={() => setPaying(false)}
          onSubmit={(v) => markPaid.mutate({ id, bankAccountId: v.bankAccountId, paidOn: v.date, reference: v.reference })}
        />
      )}
      {reversing && (
        <ReversalDialog
          kind={reversing}
          pending={reverse.isPending || reversePayment.isPending}
          net={formatCurrency(s.netPayable)}
          onClose={() => setReversing(null)}
          onSubmit={(reason) => (reversing === "payment" ? reversePayment.mutate({ id, reason }) : reverse.mutate({ id, reason }))}
        />
      )}
      <ConfirmDialog open={!!confirm} title={confirm?.title ?? ""} description={confirm?.description} confirmLabel={confirm?.label} onCancel={() => setConfirm(null)} onConfirm={() => { confirm?.run(); setConfirm(null); }} />
    </div>
  );
}

/** Asks for the reason (mandatory) before a reversal, and says plainly what it does. */
function ReversalDialog({ kind, net, pending, onClose, onSubmit }: { kind: "settlement" | "payment"; net: string; pending?: boolean; onClose: () => void; onSubmit: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const isPayment = kind === "payment";
  function confirm() {
    const r = reason.trim();
    if (r.length < FNF_REVERSAL_REASON_MIN) return setError("Give the reason for the reversal.");
    setError(null);
    onSubmit(r);
  }
  return (
    <Modal open onClose={onClose} title={isPayment ? "Reverse the payment?" : "Reverse this settlement?"}>
      <div className="space-y-3">
        <p className="text-sm text-text-secondary">
          {isPayment
            ? `This puts ${net} back into the account it was paid from and the settlement returns to "Posted to books". Use it when the payment was recorded wrongly. You can mark it as paid again afterwards.`
            : "This reverses the entry in the books exactly, puts the loan balances it recovered back on the loans, gives the encashed leave back and frees the bonus. It cannot be undone. The employee is not brought back; start a new settlement if one is still needed."}
        </p>
        <InputField label="Reason" required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is it being reversed?" />
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={pending} onClick={confirm}>{isPayment ? "Reverse payment" : "Reverse settlement"}</button>
        </div>
      </div>
    </Modal>
  );
}

function LineTable({ title, rows }: { title: string; rows: Array<{ id: string; label: string; amount: string; detail: string | null }> }) {
  return (
    <Panel title={title}>
      {rows.length === 0 ? (
        <p className="p-4 text-sm text-text-tertiary">None</p>
      ) : (
        <table className={TABLE} aria-label={title}>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <span className="text-text-primary">{r.label}</span>
                  {r.detail && <span className="block text-2xs text-text-tertiary">{r.detail}</span>}
                </td>
                <td className="text-right tabular-nums font-medium text-text-primary">{formatCurrency(r.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

type Detail = inferRouterOutputs<AppRouter>["payrollFnf"]["get"];

function InputsForm({ data }: { data: Detail }) {
  const utils = trpc.useUtils();
  const s = data.settlement;
  const inputs = (s.inputs ?? {}) as { noticeShortfallDays?: number; tdsAmount?: number; includeBonus?: boolean; encashDays?: Record<string, number>; earnings?: Array<{ name: string; amount: number; kind?: "arrears" | "other_earning" }>; deductions?: Array<{ name: string; amount: number }> };
  const [basis, setBasis] = useState<LeaveEncashmentBasis>(s.encashmentBasis as LeaveEncashmentBasis);
  const [notice, setNotice] = useState(String(inputs.noticeShortfallDays ?? ""));
  const [tds, setTds] = useState(String(inputs.tdsAmount ?? ""));
  const [bonus, setBonus] = useState(!!inputs.includeBonus);
  const [days, setDays] = useState<Record<string, string>>(Object.fromEntries(Object.entries(inputs.encashDays ?? {}).map(([k, v]) => [k, String(v)])));
  const [earn, setEarn] = useState<ManualLine[]>((inputs.earnings ?? []).map((e) => ({ name: e.name, amount: String(e.amount), kind: e.kind })));
  const [ded, setDed] = useState<ManualLine[]>((inputs.deductions ?? []).map((e) => ({ name: e.name, amount: String(e.amount) })));
  const save = trpc.payrollFnf.update.useMutation({
    onSuccess: () => {
      toast({ title: "Saved and recalculated", variant: "success" });
      void utils.payrollFnf.get.invalidate({ id: s.id });
      void utils.payrollFnf.list.invalidate();
    },
    onError: onError("Could not save"),
  });
  const valid = (l: ManualLine) => l.name.trim() && Number(l.amount) > 0;
  function submit() {
    const encashDays: Record<string, number> = {};
    for (const [k, v] of Object.entries(days)) if (v.trim() !== "" && Number(v) >= 0) encashDays[k] = Number(v);
    save.mutate({
      id: s.id,
      encashmentBasis: basis,
      noticeShortfallDays: Number(notice) || 0,
      tdsAmount: Number(tds) || 0,
      includeBonus: bonus,
      encashDays,
      earnings: earn.filter(valid).map((l) => ({ name: l.name.trim(), amount: Number(l.amount), kind: l.kind ?? "other_earning" })),
      deductions: ded.filter(valid).map((l) => ({ name: l.name.trim(), amount: Number(l.amount) })),
    });
  }
  return (
    <Panel title="What goes into the settlement">
      <div className="space-y-4 p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <SelectField label="Leave encashment rate" value={basis} onChange={(e) => setBasis(e.target.value as LeaveEncashmentBasis)}>
            {LEAVE_ENCASHMENT_BASES.map((b) => <option key={b} value={b}>{LEAVE_ENCASHMENT_BASIS_LABELS[b]}</option>)}
          </SelectField>
          <InputField label="Notice period shortfall (days)" inputMode="decimal" value={notice} onChange={(e) => setNotice(e.target.value)} />
          <InputField label="TDS on the settlement (you work it out)" inputMode="decimal" value={tds} onChange={(e) => setTds(e.target.value)} />
        </div>
        {data.encashable.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-3">
            {data.encashable.map((t) => (
              <InputField key={t.leaveTypeId} label={`${t.name}: days to encash (balance ${t.balance}, up to ${t.maxDays})`} inputMode="decimal" placeholder={String(t.maxDays)} value={days[t.leaveTypeId] ?? ""} onChange={(e) => setDays({ ...days, [t.leaveTypeId]: e.target.value })} />
            ))}
          </div>
        )}
        <label className="flex items-start gap-2 text-sm text-text-primary">
          <input type="checkbox" className="mt-0.5" checked={bonus} onChange={(e) => setBonus(e.target.checked)} />
          <span>Add the bonus due for this financial year<span className="block text-xs text-text-tertiary">A suggestion at the minimum percentage, from the approved payroll so far. Left out when a bonus run already pays it.</span></span>
        </label>
        <ManualLines title="Arrears and other amounts due" lines={earn} setLines={setEarn} withKind />
        <ManualLines title="Other recoveries" lines={ded} setLines={setDed} />
        <div className="flex justify-end">
          <button className="btn-primary" disabled={save.isPending} onClick={submit}>Save and recalculate</button>
        </div>
      </div>
    </Panel>
  );
}

function ManualLines({ title, lines, setLines, withKind }: { title: string; lines: ManualLine[]; setLines: (l: ManualLine[]) => void; withKind?: boolean }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-text-primary">{title}</legend>
      {lines.map((l, i) => (
        <div key={i} className="grid items-end gap-2 sm:grid-cols-[1fr_9rem_9rem_auto]">
          <InputField label="Name" value={l.name} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
          <InputField label="Amount" inputMode="decimal" value={l.amount} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
          {withKind ? (
            <SelectField label="Kind" value={l.kind ?? "other_earning"} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, kind: e.target.value as ManualLine["kind"] } : x)))}>
              <option value="other_earning">Other</option>
              <option value="arrears">Arrears</option>
            </SelectField>
          ) : <span />}
          <button className="btn-secondary btn-sm" onClick={() => setLines(lines.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      <button className="btn-secondary btn-sm" onClick={() => setLines([...lines, { name: "", amount: "", kind: withKind ? "other_earning" : undefined }])}>+ Add a line</button>
    </fieldset>
  );
}
