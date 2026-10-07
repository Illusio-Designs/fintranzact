import { Fragment, useState } from "react";
import { statutoryPaymentSchema, type StatutoryPayableGroup } from "@fintranzact/shared";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { formatCurrency, formatDate, todayISODate } from "@/lib/utils";
import { Modal } from "@/components/ui/Modal";
import { InputField, SelectField } from "@/components/ui/FormField";
import { EmptyState } from "@/components/ui/EmptyState";
import { Panel, TABLE, onError } from "./payroll-ui";
import { FyPicker, VerifyWithCa, currentFinancialYear, type StatutoryOut } from "./statutory-ui";

type Due = StatutoryOut["dues"]["rows"][number];

/**
 * What each approved payroll run owes PF, ESI, professional tax, LWF and TDS,
 * what has been paid and when it is due. Recording a payment writes Dr the
 * payable account / Cr bank with the challan number and date. Fintranzact does
 * not pay anything: record what you paid through your bank or the portal.
 */
export function DuesTab() {
  const [fy, setFy] = useState(currentFinancialYear());
  const q = trpc.payrollStatutory.dues.useQuery({ financialYear: fy });
  const [paying, setPaying] = useState<Due | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const rows = q.data?.rows ?? [];
  const outstanding = rows.reduce((s, r) => s + Number(r.outstanding), 0);
  const today = todayISODate();

  return (
    <div className="space-y-4">
      <VerifyWithCa note="Due dates come from your Statutory settings. Check them, and any late fee or interest, with your CA." />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <FyPicker value={fy} onChange={setFy} />
        <p data-testid="dues-outstanding" className="text-sm text-text-secondary">Outstanding: <strong className="tabular-nums text-text-primary">{formatCurrency(outstanding)}</strong></p>
      </div>
      <Panel>
        {q.isLoading ? (
          <p className="p-6 text-sm text-text-tertiary">Loading statutory dues...</p>
        ) : rows.length === 0 ? (
          <EmptyState title="Nothing to pay yet" description="Statutory amounts appear here once a payroll run is approved." />
        ) : (
          <div className="overflow-x-auto">
            <table className={TABLE}>
              <thead>
                <tr><th>Wage month</th><th>Pay to</th><th className="text-right">Accrued</th><th className="text-right">Paid</th><th className="text-right">Outstanding</th><th>Due by</th><th className="text-right"><span className="sr-only">Actions</span></th></tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const key = `${r.runId}-${r.kind}`;
                  const late = Number(r.outstanding) > 0 && !!r.dueDate && r.dueDate < today;
                  return (
                    <Fragment key={key}>
                      <tr>
                        <td className="whitespace-nowrap font-medium text-text-primary">{r.monthLabel}</td>
                        <td>{r.label}</td>
                        <td className="text-right tabular-nums">{formatCurrency(r.accrued)}</td>
                        <td className="text-right tabular-nums">{formatCurrency(r.paid)}</td>
                        <td className="text-right font-medium tabular-nums text-text-primary">{formatCurrency(r.outstanding)}</td>
                        <td className="whitespace-nowrap">
                          {r.dueDate ? formatDate(r.dueDate) : <span className="text-text-tertiary">Not set</span>}
                          {late && <span className="ml-2 text-2xs text-red-600">Overdue</span>}
                        </td>
                        <td className="whitespace-nowrap text-right">
                          {r.payments.length > 0 && <button className="btn-secondary btn-sm mr-2" aria-expanded={open === key} onClick={() => setOpen(open === key ? null : key)}>Payments ({r.payments.length})</button>}
                          {Number(r.outstanding) > 0 && (
                            <button className="btn-primary btn-sm" disabled={!r.canPay} title={r.canPay ? undefined : "Post the payroll run to the books first."} onClick={() => setPaying(r)}>Record payment</button>
                          )}
                        </td>
                      </tr>
                      {open === key && (
                        <tr>
                          <td colSpan={7} className="bg-surface-1">
                            <ul className="space-y-1 px-4 py-2 text-xs text-text-secondary" aria-label={`${r.label} payments`}>
                              {r.payments.map((p) => (
                                <li key={p.id}>
                                  {formatCurrency(p.amount)} on {formatDate(p.paidOn)}
                                  {p.challanNumber ? `, challan ${p.challanNumber}` : ""}{p.challanDate ? ` dated ${formatDate(p.challanDate)}` : ""}{p.reference ? `, ${p.reference}` : ""}
                                </li>
                              ))}
                            </ul>
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
      {paying && <PayDialog due={paying} onClose={() => setPaying(null)} onDone={() => { setPaying(null); void q.refetch(); }} />}
    </div>
  );
}

function PayDialog({ due, onClose, onDone }: { due: Due; onClose: () => void; onDone: () => void }) {
  const accounts = trpc.bankAccount.list.useQuery();
  const [bankAccountId, setBank] = useState("");
  const [amount, setAmount] = useState(due.outstanding);
  const [paidOn, setPaidOn] = useState(todayISODate());
  const [challanNumber, setChallan] = useState("");
  const [challanDate, setChallanDate] = useState("");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const pay = trpc.payrollStatutory.recordPayment.useMutation({
    onSuccess: () => {
      toast({ title: `${due.label} payment recorded`, variant: "success" });
      onDone();
    },
    onError: onError("Could not record the payment"),
  });
  function save() {
    const parsed = statutoryPaymentSchema.safeParse({ runId: due.runId, kind: due.kind as StatutoryPayableGroup, amount: Number(amount), paidOn, bankAccountId, challanNumber, challanDate, reference });
    if (!parsed.success) return setError(parsed.error.issues[0]!.message.includes("Invalid uuid") ? "Choose the bank or cash account the payment was made from." : parsed.error.issues[0]!.message);
    setError(null);
    pay.mutate(parsed.data);
  }
  return (
    <Modal open onClose={onClose} title={`Record ${due.label} payment`}>
      <div className="space-y-3">
        <p className="text-sm text-text-secondary">For {due.monthLabel}. {formatCurrency(due.outstanding)} is outstanding. This records a payment you already made; it does not pay anything.</p>
        <InputField label="Amount paid" required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <InputField label="Paid on" type="date" required value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
        <SelectField label="Paid from" required value={bankAccountId} onChange={(e) => setBank(e.target.value)}>
          <option value="">Choose...</option>
          {(accounts.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.accountName}</option>)}
        </SelectField>
        <div className="grid gap-3 sm:grid-cols-2">
          <InputField label="Challan number" value={challanNumber} onChange={(e) => setChallan(e.target.value)} />
          <InputField label="Challan date" type="date" value={challanDate} onChange={(e) => setChallanDate(e.target.value)} />
        </div>
        <InputField label="Reference (BSR code, TRRN, UTR)" value={reference} onChange={(e) => setReference(e.target.value)} />
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={pay.isPending} onClick={save}>Record payment</button>
        </div>
      </div>
    </Modal>
  );
}
