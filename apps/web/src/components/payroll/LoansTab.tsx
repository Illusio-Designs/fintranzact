import { useState } from "react";
import { loanCreateSchema, LOAN_KINDS } from "@fintranzact/shared";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { useCan } from "@/lib/permissions";
import { formatCurrency, formatDate, todayISODate } from "@/lib/utils";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { InputField, SelectField, TextareaField } from "@/components/ui/FormField";
import { EmptyState } from "@/components/ui/EmptyState";
import { Panel, TABLE, currentMonth, downloadText, errorMessage, monthLabel, onError, shiftMonth } from "./payroll-ui";
import { BankPaymentDialog, LoanStatusBadge, Notice } from "./phase4-ui";

/**
 * Loans and advances to employees. Issue (with the EMI schedule shown first), approval by a second person, disbursement from
 * a bank or cash account, EMI recovery in each payroll run (a deduction line on the payslip, at most the configured share
 * of net pay, the rest carried forward), part-payment, foreclosure, skipping or rescheduling an instalment, and the
 * statement. The balance of a loan is recovered in the full and final settlement. Interest is simple reducing-balance;
 * confirm how interest on staff loans is treated for tax with your CA.
 */
export function LoansTab() {
  const [selected, setSelected] = useState<string | null>(null);
  if (selected) return <LoanDetail id={selected} onBack={() => setSelected(null)} />;
  return <LoanList onOpen={setSelected} />;
}

function LoanList({ onOpen }: { onOpen: (id: string) => void }) {
  const utils = trpc.useUtils();
  const loans = trpc.payrollLoan.list.useQuery({});
  const settings = trpc.payrollLoan.settings.useQuery();
  const canManage = useCan("Payroll", "manage");
  const [issuing, setIssuing] = useState(false);
  const rows = loans.data ?? [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-text-secondary">Instalments are deducted automatically in each payroll run. A second person approves a loan before it is paid out.</p>
        <button className="btn-primary" onClick={() => setIssuing(true)}>+ Issue loan or advance</button>
      </div>
      {settings.data && <RecoveryLimit value={settings.data.maxDeductionPercent} canEdit={canManage} />}
      <Panel>
        {loans.isLoading ? (
          <p className="p-6 text-sm text-text-tertiary">Loading loans...</p>
        ) : rows.length === 0 ? (
          <EmptyState title="No loans or advances yet" description="Issue a loan or an advance to an employee and it is recovered through payroll." action={<button className="btn-primary" onClick={() => setIssuing(true)}>+ Issue loan or advance</button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className={TABLE}>
              <thead><tr><th>Loan</th><th>Employee</th><th>Status</th><th className="text-right">Amount</th><th className="text-right">Outstanding</th><th className="text-right">EMI</th><th>Next instalment</th><th className="text-right"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.loan.id}>
                    <td className="font-medium text-text-primary">{r.loan.number} <span className="text-xs text-text-tertiary">{r.loan.kind}</span></td>
                    <td>{r.employeeName} <span className="text-xs text-text-tertiary">{r.employeeCode}</span></td>
                    <td><LoanStatusBadge status={r.loan.status} /></td>
                    <td className="text-right tabular-nums">{formatCurrency(r.loan.principal)}</td>
                    <td className="text-right font-medium tabular-nums text-text-primary">{formatCurrency(r.outstanding)}</td>
                    <td className="text-right tabular-nums">{formatCurrency(r.loan.emi)}</td>
                    <td>{r.nextDueMonth ? monthLabel(r.nextDueMonth) : ""}</td>
                    <td className="text-right"><button className="btn-secondary btn-sm" onClick={() => onOpen(r.loan.id)}>Open</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {issuing && (
        <IssueDialog
          onClose={() => setIssuing(false)}
          onCreated={(id) => {
            void utils.payrollLoan.list.invalidate();
            setIssuing(false);
            onOpen(id);
          }}
        />
      )}
    </div>
  );
}

function RecoveryLimit({ value, canEdit }: { value: number; canEdit: boolean }) {
  const utils = trpc.useUtils();
  const [text, setText] = useState(String(value));
  const save = trpc.payrollLoan.updateSettings.useMutation({
    onSuccess: () => {
      toast({ title: "Recovery limit saved", variant: "success" });
      void utils.payrollLoan.settings.invalidate();
    },
    onError: onError("Could not save"),
  });
  const n = Number(text);
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border-light bg-surface-0 px-4 py-3">
      <InputField label="Most of net pay to recover for loans in a month (%)" inputMode="decimal" disabled={!canEdit} value={text} onChange={(e) => setText(e.target.value)} />
      {canEdit && <button className="btn-secondary" disabled={save.isPending || !(n >= 1 && n <= 100) || n === value} onClick={() => save.mutate({ maxDeductionPercent: n })}>Save</button>}
      <p className="max-w-md text-xs text-text-tertiary">If an instalment is more than this share of an employee's net pay, the rest is carried forward as arrears and the run shows a warning. Check any legal limit on deductions from wages with your CA.</p>
    </div>
  );
}

function IssueDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const employees = trpc.payrollEmployee.list.useQuery({ status: "active", page: 1, limit: 200 });
  const [employeeId, setEmployeeId] = useState("");
  const [kind, setKind] = useState<(typeof LOAN_KINDS)[number]>("loan");
  const [amount, setAmount] = useState("");
  const [rate, setRate] = useState("0");
  const [mode, setMode] = useState<"installments" | "emi">("installments");
  const [value, setValue] = useState("");
  const [startMonth, setStartMonth] = useState(shiftMonth(currentMonth(), 1));
  const [issueDate, setIssueDate] = useState(todayISODate());
  const [purpose, setPurpose] = useState("");
  const [error, setError] = useState<string | null>(null);

  const candidate = {
    employeeId,
    kind,
    amount: Number(amount),
    interestRate: Number(rate || 0),
    ...(mode === "installments" ? { installments: Number(value) } : { emi: Number(value) }),
    startMonth,
    issueDate,
    purpose,
  };
  const parsed = loanCreateSchema.safeParse(candidate);
  const previewReady = Number(amount) > 0 && Number(value) > 0 && Number(rate || 0) >= 0;
  const preview = trpc.payrollLoan.schedulePreview.useQuery(
    { amount: Number(amount), interestRate: Number(rate || 0), startMonth, ...(mode === "installments" ? { installments: Number(value) } : { emi: Number(value) }) },
    { enabled: previewReady, retry: false },
  );
  const create = trpc.payrollLoan.create.useMutation({ onSuccess: (r) => onCreated(r.id), onError: onError("Could not issue the loan") });
  function save() {
    if (!employeeId) return setError("Choose the employee.");
    if (!parsed.success) return setError(parsed.error.issues[0]!.message.includes("Invalid uuid") ? "Choose the employee." : parsed.error.issues[0]!.message);
    setError(null);
    create.mutate(parsed.data);
  }
  const p = preview.data;
  return (
    <Modal open onClose={onClose} title="Issue a loan or advance" className="max-w-2xl">
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField label="Employee" required value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">Choose...</option>
            {(employees.data?.data ?? []).map((e) => <option key={e.id} value={e.id}>{e.name} ({e.employeeCode})</option>)}
          </SelectField>
          <SelectField label="Type" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="loan">Loan</option>
            <option value="advance">Salary advance</option>
          </SelectField>
          <InputField label="Amount" required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <InputField label="Interest a year (%)" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
          <SelectField label="Fix" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
            <option value="installments">Number of instalments</option>
            <option value="emi">EMI amount</option>
          </SelectField>
          <InputField label={mode === "installments" ? "Instalments" : "EMI"} required inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
          <SelectField label="First instalment in" value={startMonth} onChange={(e) => setStartMonth(e.target.value)}>
            {Array.from({ length: 13 }, (_, i) => shiftMonth(currentMonth(), i)).map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </SelectField>
          <InputField label="Issue date" type="date" required value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
        </div>
        <InputField label="Purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} />
        {p && (
          <div className="rounded-lg bg-surface-1 px-3 py-2 text-sm" data-testid="loan-preview">
            <p>EMI <strong>{formatCurrency(p.emi)}</strong> for {p.count} month{p.count === 1 ? "" : "s"}; total interest {formatCurrency(p.totalInterest)}; total repaid {formatCurrency(p.totalPayable)}. The last instalment clears the balance exactly.</p>
            <p className="mt-1 text-xs text-text-tertiary">First: {monthLabel(p.rows[0]!.month)} {formatCurrency(p.rows[0]!.emi)} ({formatCurrency(p.rows[0]!.interest)} interest). Last: {monthLabel(p.rows[p.rows.length - 1]!.month)} {formatCurrency(p.rows[p.rows.length - 1]!.emi)}.</p>
          </div>
        )}
        {preview.isError && <p role="alert" className="text-sm text-red-600">{errorMessage(preview.error)}</p>}
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={create.isPending} onClick={save}>Issue for approval</button>
        </div>
      </div>
    </Modal>
  );
}

function LoanDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.payrollLoan.get.useQuery({ id });
  const canManage = useCan("Payroll", "manage");
  const [dialog, setDialog] = useState<null | "disburse" | "prepay" | "foreclose" | "skip" | "reschedule" | "reject">(null);
  const [confirm, setConfirm] = useState<null | { title: string; description: string; label: string; run: () => void }>(null);
  const refresh = () => {
    void utils.payrollLoan.get.invalidate({ id });
    void utils.payrollLoan.list.invalidate();
  };
  const done = (title: string) => () => {
    toast({ title, variant: "success" });
    setDialog(null);
    refresh();
  };
  const approve = trpc.payrollLoan.approve.useMutation({ onSuccess: done("Loan approved"), onError: onError("Could not approve") });
  const reject = trpc.payrollLoan.reject.useMutation({ onSuccess: done("Loan rejected"), onError: onError("Could not reject") });
  const cancel = trpc.payrollLoan.cancel.useMutation({ onSuccess: done("Loan cancelled"), onError: onError("Could not cancel") });
  const disburse = trpc.payrollLoan.disburse.useMutation({ onSuccess: done("Loan disbursed and posted to the books"), onError: onError("Could not disburse") });
  const prepay = trpc.payrollLoan.prepay.useMutation({ onSuccess: done("Payment recorded"), onError: onError("Could not record the payment") });
  const foreclose = trpc.payrollLoan.foreclose.useMutation({ onSuccess: done("Loan closed"), onError: onError("Could not close the loan") });
  const skip = trpc.payrollLoan.skip.useMutation({ onSuccess: done("Instalment skipped"), onError: onError("Could not skip") });
  const reschedule = trpc.payrollLoan.reschedule.useMutation({ onSuccess: done("Loan rescheduled"), onError: onError("Could not reschedule") });

  if (isLoading || !data) return <p className="p-6 text-sm text-text-tertiary">Loading the loan...</p>;
  const { loan, installments, events } = data;
  const status = loan.status;
  const busy = approve.isPending || cancel.isPending;
  const open = installments.filter((i) => i.status === "open");

  async function statement() {
    try {
      const r = await utils.payrollLoan.statementCsv.fetch({ id }, { staleTime: 0 });
      downloadText(r.filename, r.contentType, r.csv);
    } catch (e) {
      toast({ title: "Could not make the statement", description: errorMessage(e), variant: "error" });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button className="btn-secondary btn-sm" onClick={onBack}>‹ All loans</button>
          <h2 className="text-lg font-semibold text-text-primary">{loan.number} for {data.employeeName}</h2>
          <LoanStatusBadge status={status} />
        </div>
        <div className="flex flex-wrap gap-2" data-testid="loan-actions">
          {status === "pending_approval" && canManage && <button className="btn-primary" disabled={busy} onClick={() => setConfirm({ title: "Approve this loan?", description: "The person who requested it cannot approve it. Approval does not pay it out.", label: "Approve", run: () => approve.mutate({ id }) })}>Approve</button>}
          {status === "pending_approval" && canManage && <button className="btn-secondary" onClick={() => setDialog("reject")}>Reject</button>}
          {status === "approved" && <button className="btn-primary" onClick={() => setDialog("disburse")}>Disburse</button>}
          {(status === "pending_approval" || status === "approved") && <button className="btn-secondary" disabled={busy} onClick={() => setConfirm({ title: "Cancel this loan?", description: "It has not been paid out. Nothing is posted to the books.", label: "Cancel loan", run: () => cancel.mutate({ id }) })}>Cancel</button>}
          {status === "active" && <button className="btn-secondary" onClick={() => setDialog("prepay")}>Record part-payment</button>}
          {status === "active" && <button className="btn-secondary" onClick={() => setDialog("foreclose")}>Foreclose</button>}
          {status === "active" && open.length > 0 && <button className="btn-secondary" onClick={() => setDialog("skip")}>Skip an instalment</button>}
          {status === "active" && <button className="btn-secondary" onClick={() => setDialog("reschedule")}>Reschedule</button>}
          <button className="btn-secondary" onClick={() => void statement()}>Statement (CSV)</button>
        </div>
      </div>
      {status === "pending_approval" && !canManage && <Notice>An owner or admin approves loans, and not the person who requested it.</Notice>}
      <div className="grid gap-3 sm:grid-cols-4">
        {[["Amount", formatCurrency(loan.principal)], ["Outstanding", formatCurrency(data.outstanding)], ["EMI", formatCurrency(loan.emi)], ["Interest a year", `${Number(loan.interestRate)}%`]].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-border-light bg-surface-0 px-4 py-3">
            <p className="text-xs text-text-tertiary">{k}</p>
            <p className="text-lg font-semibold tabular-nums text-text-primary">{v}</p>
          </div>
        ))}
      </div>
      <Panel title="Repayment schedule">
        <div className="overflow-x-auto">
          <table className={TABLE}>
            <thead><tr><th>#</th><th>Month</th><th className="text-right">Principal</th><th className="text-right">Interest</th><th className="text-right">Recovered</th><th>Status</th></tr></thead>
            <tbody>
              {installments.filter((i) => i.status !== "superseded").map((i) => (
                <tr key={i.id}>
                  <td className="tabular-nums">{i.seq}</td>
                  <td>{monthLabel(i.dueMonth)}</td>
                  <td className="text-right tabular-nums">{formatCurrency(i.principal)}</td>
                  <td className="text-right tabular-nums">{formatCurrency(i.interest)}</td>
                  <td className="text-right tabular-nums">{formatCurrency(Number(i.paidPrincipal) + Number(i.paidInterest))}</td>
                  <td className="text-xs capitalize">{i.status}{i.note ? ` (${i.note})` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="Statement">
        <table className={TABLE}>
          <thead><tr><th>Date</th><th>Event</th><th className="text-right">Principal</th><th className="text-right">Interest</th><th className="text-right">Balance</th><th>Note</th></tr></thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}><td className="whitespace-nowrap">{formatDate(e.eventDate)}</td><td className="capitalize">{e.kind.replace(/_/g, " ")}</td><td className="text-right tabular-nums">{formatCurrency(e.principal)}</td><td className="text-right tabular-nums">{formatCurrency(e.interest)}</td><td className="text-right tabular-nums">{formatCurrency(e.balanceAfter)}</td><td className="text-xs text-text-tertiary">{e.note}</td></tr>
            ))}
          </tbody>
        </table>
      </Panel>

      {dialog === "disburse" && (
        <BankPaymentDialog title="Disburse the loan" description={`Pays ${formatCurrency(loan.principal)} out of the account to ${data.employeeName} and records it as a loan receivable.`} confirmLabel="Disburse" accountLabel="Paid from" dateLabel="Paid on" pending={disburse.isPending} onClose={() => setDialog(null)} onSubmit={(v) => disburse.mutate({ id, bankAccountId: v.bankAccountId, paidOn: v.date, reference: v.reference })} />
      )}
      {dialog === "prepay" && <ReceiveDialog loanId={id} outstanding={data.outstanding} pending={prepay.isPending} foreclose={false} onClose={() => setDialog(null)} onPrepay={(v) => prepay.mutate(v)} onForeclose={() => undefined} />}
      {dialog === "foreclose" && <ReceiveDialog loanId={id} outstanding={data.outstanding} pending={foreclose.isPending} foreclose onClose={() => setDialog(null)} onPrepay={() => undefined} onForeclose={(v) => foreclose.mutate(v)} />}
      {dialog === "skip" && <ReasonDialog title="Skip the next instalment" intro={`The next instalment (${open[0] ? monthLabel(open[0].dueMonth) : ""}) is not recovered and the rest move one month later. No interest is charged for the skipped month.`} confirmLabel="Skip" pending={skip.isPending} onClose={() => setDialog(null)} onSave={(reason) => skip.mutate({ id, reason })} />}
      {dialog === "reject" && <ReasonDialog title="Reject the loan" intro="Say why. The request is closed." confirmLabel="Reject" pending={reject.isPending} onClose={() => setDialog(null)} onSave={(note) => reject.mutate({ id, note })} />}
      {dialog === "reschedule" && <RescheduleDialog pending={reschedule.isPending} outstanding={data.outstanding} onClose={() => setDialog(null)} onSave={(v) => reschedule.mutate({ id, ...v })} />}
      <ConfirmDialog open={!!confirm} title={confirm?.title ?? ""} description={confirm?.description} confirmLabel={confirm?.label} onCancel={() => setConfirm(null)} onConfirm={() => { confirm?.run(); setConfirm(null); }} />
    </div>
  );
}

function ReceiveDialog({
  loanId, outstanding, foreclose, pending, onClose, onPrepay, onForeclose,
}: {
  loanId: string;
  outstanding: string;
  foreclose: boolean;
  pending: boolean;
  onClose: () => void;
  onPrepay: (v: { id: string; bankAccountId: string; receivedOn: string; amount: number; interest: number; reference: string }) => void;
  onForeclose: (v: { id: string; bankAccountId: string; receivedOn: string; interest: number; reference: string }) => void;
}) {
  const [amount, setAmount] = useState("");
  const [interest, setInterest] = useState("0");
  const amountOk = foreclose || (Number(amount) > 0 && Number(amount) <= Number(outstanding));
  return (
    <BankPaymentDialog
      title={foreclose ? "Foreclose the loan" : "Record a part-payment"}
      description={foreclose ? `The employee repays the whole balance of ${formatCurrency(outstanding)}. The loan is closed.` : `Outstanding: ${formatCurrency(outstanding)}. The rest of the loan is re-planned at the same EMI, so it ends sooner.`}
      confirmLabel={foreclose ? "Close the loan" : "Record"}
      accountLabel="Received into"
      dateLabel="Received on"
      pending={pending}
      extraValid={amountOk}
      onClose={onClose}
      onSubmit={(v) => (foreclose ? onForeclose({ id: loanId, bankAccountId: v.bankAccountId, receivedOn: v.date, interest: Number(interest) || 0, reference: v.reference }) : onPrepay({ id: loanId, bankAccountId: v.bankAccountId, receivedOn: v.date, amount: Number(amount), interest: Number(interest) || 0, reference: v.reference }))}
    >
      {!foreclose && <InputField label="Principal repaid" required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}
      <InputField label="Interest paid with it (optional)" inputMode="decimal" value={interest} onChange={(e) => setInterest(e.target.value)} />
    </BankPaymentDialog>
  );
}

function ReasonDialog({ title, intro, confirmLabel, pending, onClose, onSave }: { title: string; intro: string; confirmLabel: string; pending: boolean; onClose: () => void; onSave: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <Modal open onClose={onClose} title={title}>
      <div className="space-y-3">
        <p className="text-sm text-text-secondary">{intro}</p>
        <TextareaField label="Reason" required rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={pending || reason.trim().length < 3} onClick={() => onSave(reason.trim())}>{confirmLabel}</button>
        </div>
      </div>
    </Modal>
  );
}

function RescheduleDialog({ pending, outstanding, onClose, onSave }: { pending: boolean; outstanding: string; onClose: () => void; onSave: (v: { reason: string; firstMonth: string; installments?: number; emi?: number }) => void }) {
  const [mode, setMode] = useState<"installments" | "emi">("installments");
  const [value, setValue] = useState("");
  const [firstMonth, setFirstMonth] = useState(shiftMonth(currentMonth(), 1));
  const [reason, setReason] = useState("");
  const ok = Number(value) > 0 && reason.trim().length >= 3;
  return (
    <Modal open onClose={onClose} title="Reschedule the loan">
      <div className="space-y-3">
        <p className="text-sm text-text-secondary">Re-plans the {formatCurrency(outstanding)} still outstanding.</p>
        <SelectField label="Fix" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
          <option value="installments">Number of instalments</option>
          <option value="emi">EMI amount</option>
        </SelectField>
        <InputField label={mode === "installments" ? "Instalments" : "EMI"} required inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
        <SelectField label="First instalment in" value={firstMonth} onChange={(e) => setFirstMonth(e.target.value)}>
          {Array.from({ length: 13 }, (_, i) => shiftMonth(currentMonth(), i)).map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </SelectField>
        <TextareaField label="Reason" required rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={pending || !ok} onClick={() => onSave({ reason: reason.trim(), firstMonth, ...(mode === "installments" ? { installments: Number(value) } : { emi: Number(value) }) })}>Reschedule</button>
        </div>
      </div>
    </Modal>
  );
}
