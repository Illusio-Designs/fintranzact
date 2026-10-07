import { useState } from "react";
import { LEAVE_ACCRUAL_TYPES, leaveApplySchema, leaveEncashSchema, leaveTypeSchema } from "@fintranzact/shared";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { formatCurrency, formatDate, todayISODate } from "@/lib/utils";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { InputField, SelectField, TextareaField } from "@/components/ui/FormField";
import { EmptyState } from "@/components/ui/EmptyState";
import { PillTabs } from "@/components/ui/Tabs";
import { Badge } from "@/components/ui/Badge";
import { CheckRow, Panel, TABLE, currentMonth, onError } from "./payroll-ui";

type View = "applications" | "balances" | "types";

export function LeaveTab() {
  const [view, setView] = useState<View>("applications");
  return (
    <div className="space-y-4">
      <PillTabs value={view} onChange={(v) => setView(v as View)} tabs={[{ value: "applications", label: "Applications" }, { value: "balances", label: "Balances" }, { value: "types", label: "Leave types" }]} />
      {view === "applications" && <Applications />}
      {view === "balances" && <Balances />}
      {view === "types" && <Types />}
    </div>
  );
}

const STATUS_COLOR: Record<string, string> = {
  pending: "bg-amber-600/[0.1] text-amber-700 dark:text-amber-400",
  approved: "bg-emerald-600/[0.08] text-emerald-700 dark:text-emerald-400",
  rejected: "bg-red-600/[0.08] text-red-700 dark:text-red-400",
  cancelled: "bg-surface-2 text-text-secondary",
};

function Applications() {
  const utils = trpc.useUtils();
  const [status, setStatus] = useState<"pending" | "approved" | "rejected" | "cancelled" | "all">("pending");
  const [open, setOpen] = useState(false);
  const apps = trpc.payrollLeave.applications.useQuery({ status, limit: 100 });
  const refresh = () => {
    void utils.payrollLeave.applications.invalidate();
    void utils.payrollLeave.balances.invalidate();
    void utils.payrollAttendance.month.invalidate();
  };
  const decide = trpc.payrollLeave.decide.useMutation({
    onSuccess: (r) => {
      toast({ title: r.status === "approved" ? "Leave approved" : "Leave rejected", description: r.status === "approved" && Number(r.lopDays) > 0 ? `${Number(r.lopDays)} day(s) go beyond the balance and are loss of pay.` : undefined, variant: "success" });
      refresh();
    },
    onError: onError("Could not decide the application"),
  });
  const cancel = trpc.payrollLeave.cancel.useMutation({ onSuccess: refresh, onError: onError("Could not cancel the application") });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PillTabs size="sm" value={status} onChange={(v) => setStatus(v as typeof status)} tabs={[{ value: "pending", label: "Pending" }, { value: "approved", label: "Approved" }, { value: "rejected", label: "Rejected" }, { value: "cancelled", label: "Cancelled" }, { value: "all", label: "All" }]} />
        <button className="btn-primary" onClick={() => setOpen(true)}>+ Leave application</button>
      </div>
      <Panel>
        {(apps.data ?? []).length === 0 ? (
          <EmptyState title="No applications here" description="Record an employee's leave to check it against their balance and write it into attendance." />
        ) : (
          <div className="overflow-x-auto">
            <table className={TABLE}>
              <thead><tr><th>Employee</th><th>Leave</th><th>Dates</th><th className="text-right">Days</th><th>Status</th><th className="text-right"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {(apps.data ?? []).map((a) => (
                  <tr key={a.id}>
                    <td className="font-medium text-text-primary">{a.employeeName} <span className="text-xs font-normal text-text-tertiary">{a.employeeCode}</span></td>
                    <td className="text-text-secondary">{a.leaveName} ({a.leaveCode})</td>
                    <td className="whitespace-nowrap text-text-secondary">{a.fromDate === a.toDate ? formatDate(a.fromDate) : `${formatDate(a.fromDate)} to ${formatDate(a.toDate)}`}</td>
                    <td className="text-right tabular-nums">
                      {Number(a.days)}
                      {a.status === "approved" && Number(a.lopDays) > 0 && <span className="block text-xs text-red-600">{Number(a.lopDays)} LOP</span>}
                    </td>
                    <td><Badge color={STATUS_COLOR[a.status]}>{a.status[0]!.toUpperCase() + a.status.slice(1)}</Badge></td>
                    <td className="whitespace-nowrap text-right">
                      {a.status === "pending" && (
                        <>
                          <button className="btn-primary btn-sm mr-2" onClick={() => decide.mutate({ id: a.id, decision: "approve" })} disabled={decide.isPending}>Approve</button>
                          <button className="btn-secondary btn-sm mr-2" onClick={() => decide.mutate({ id: a.id, decision: "reject" })} disabled={decide.isPending}>Reject</button>
                        </>
                      )}
                      {(a.status === "pending" || a.status === "approved") && <button className="btn-secondary btn-sm" onClick={() => cancel.mutate({ id: a.id })} disabled={cancel.isPending}>Cancel</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {open && <ApplicationDialog onClose={() => setOpen(false)} onSaved={refresh} />}
    </div>
  );
}

function ApplicationDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const emps = trpc.payrollEmployee.list.useQuery({ status: "active", page: 1, limit: 200 });
  const types = trpc.payrollLeave.typeList.useQuery();
  const [employeeId, setEmployeeId] = useState("");
  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [fromDate, setFrom] = useState(todayISODate());
  const [toDate, setTo] = useState(todayISODate());
  const [halfDayStart, setHalfStart] = useState(false);
  const [halfDayEnd, setHalfEnd] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const create = trpc.payrollLeave.request.useMutation({
    onSuccess: () => {
      toast({ title: "Leave application recorded", variant: "success" });
      onSaved();
      onClose();
    },
    onError: onError("Could not record the leave"),
  });
  function save() {
    const parsed = leaveApplySchema.safeParse({ employeeId, leaveTypeId, fromDate, toDate, halfDayStart, halfDayEnd, reason });
    if (!parsed.success) return setError(parsed.error.issues[0]!.message.includes("Invalid uuid") ? "Choose the employee and the leave type." : parsed.error.issues[0]!.message);
    setError(null);
    create.mutate(parsed.data);
  }
  return (
    <Modal open onClose={onClose} title="Leave application" className="max-w-lg">
      <div className="space-y-3">
        <SelectField label="Employee" required value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
          <option value="">Choose...</option>
          {(emps.data?.data ?? []).map((e) => <option key={e.id} value={e.id}>{e.name} ({e.employeeCode})</option>)}
        </SelectField>
        <SelectField label="Leave type" required value={leaveTypeId} onChange={(e) => setLeaveTypeId(e.target.value)}>
          <option value="">Choose...</option>
          {(types.data ?? []).filter((t) => t.isActive).map((t) => <option key={t.id} value={t.id}>{t.name} ({t.code}){t.isPaid ? "" : ", unpaid"}</option>)}
        </SelectField>
        <div className="grid gap-3 sm:grid-cols-2">
          <InputField label="From" type="date" required value={fromDate} onChange={(e) => setFrom(e.target.value)} />
          <InputField label="To" type="date" required value={toDate} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-4">
          <CheckRow label="First day is a half day" checked={halfDayStart} onChange={setHalfStart} />
          <CheckRow label="Last day is a half day" checked={halfDayEnd} onChange={setHalfEnd} />
        </div>
        <TextareaField label="Reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        <p className="text-xs text-text-tertiary">Weekly offs and holidays inside the dates do not use leave. Approving uses the balance first; days beyond it become loss of pay.</p>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={create.isPending}>Record</button>
        </div>
      </div>
    </Modal>
  );
}

function Balances() {
  const utils = trpc.useUtils();
  const bal = trpc.payrollLeave.balances.useQuery();
  const [encash, setEncash] = useState<{ employeeId: string; name: string } | null>(null);
  const [closing, setClosing] = useState(false);
  const accrue = trpc.payrollLeave.accrue.useMutation({
    onSuccess: (r) => {
      toast({ title: r.created ? `Granted leave to ${r.created} balance${r.created === 1 ? "" : "s"}` : "Nothing new to grant for this month", variant: "success" });
      void utils.payrollLeave.balances.invalidate();
    },
    onError: onError("Could not grant leave"),
  });
  const close = trpc.payrollLeave.closeYear.useMutation({
    onSuccess: (r) => {
      toast({ title: "Leave year closed", description: `${r.carried} day(s) carried forward, ${r.lapsed} lapsed.`, variant: "success" });
      void utils.payrollLeave.balances.invalidate();
    },
    onError: onError("Could not close the leave year"),
  });
  const data = bal.data;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text-secondary">{data ? `Leave year starting ${formatDate(data.yearStart)}` : "Balances"}</p>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" onClick={() => accrue.mutate({ month: currentMonth() })} disabled={accrue.isPending}>Grant this month's leave</button>
          <button className="btn-secondary" onClick={() => setClosing(true)} disabled={close.isPending || !data}>Close leave year</button>
        </div>
      </div>
      <Panel>
        {!data || data.types.length === 0 ? (
          <EmptyState title="No leave types yet" description="Add the standard types (casual, sick, earned and loss of pay) on the Leave types tab first." />
        ) : data.employees.length === 0 ? (
          <EmptyState title="No active employees" />
        ) : (
          <div className="overflow-x-auto">
            <table className={TABLE}>
              <thead><tr><th>Employee</th>{data.types.filter((t) => t.isPaid).map((t) => <th key={t.id} className="text-right">{t.code}</th>)}<th className="text-right"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {data.employees.map((e) => (
                  <tr key={e.id}>
                    <td className="font-medium text-text-primary">{e.name} <span className="text-xs font-normal text-text-tertiary">{e.employeeCode}</span></td>
                    {data.types.filter((t) => t.isPaid).map((t) => <td key={t.id} className="text-right tabular-nums">{e.balances[t.id] ?? 0}</td>)}
                    <td className="text-right"><button className="btn-secondary btn-sm" onClick={() => setEncash({ employeeId: e.id, name: e.name })}>Encash</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <ConfirmDialog
        open={closing}
        title={`Close the leave year ${data?.leaveYear ?? ""}?`}
        description="Balances are carried forward up to each leave type's maximum and the rest lapses. Closing again changes nothing."
        confirmLabel="Close the year"
        onCancel={() => setClosing(false)}
        onConfirm={() => {
          setClosing(false);
          if (data) close.mutate({ leaveYear: data.leaveYear });
        }}
      />
      {encash && <EncashDialog target={encash} onClose={() => setEncash(null)} onSaved={() => void utils.payrollLeave.balances.invalidate()} />}
    </div>
  );
}

function EncashDialog({ target, onClose, onSaved }: { target: { employeeId: string; name: string }; onClose: () => void; onSaved: () => void }) {
  const types = trpc.payrollLeave.typeList.useQuery();
  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [days, setDays] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const encash = trpc.payrollLeave.encash.useMutation({
    onSuccess: () => {
      toast({ title: "Encashment recorded", description: `${formatCurrency(amount)} will be added to ${target.name}'s next payroll run.`, variant: "success" });
      onSaved();
      onClose();
    },
    onError: onError("Could not encash the leave"),
  });
  function save() {
    const parsed = leaveEncashSchema.safeParse({ employeeId: target.employeeId, leaveTypeId, days: Number(days), amount: Number(amount) });
    if (!parsed.success) return setError(parsed.error.issues[0]!.message.includes("Invalid uuid") ? "Choose a leave type." : parsed.error.issues[0]!.message);
    setError(null);
    encash.mutate(parsed.data);
  }
  return (
    <Modal open onClose={onClose} title={`Encash leave: ${target.name}`}>
      <div className="space-y-3">
        <SelectField label="Leave type" required value={leaveTypeId} onChange={(e) => setLeaveTypeId(e.target.value)}>
          <option value="">Choose...</option>
          {(types.data ?? []).filter((t) => t.isActive && t.encashable).map((t) => <option key={t.id} value={t.id}>{t.name} ({t.code})</option>)}
        </SelectField>
        <div className="grid gap-3 sm:grid-cols-2">
          <InputField label="Days" required inputMode="decimal" value={days} onChange={(e) => setDays(e.target.value)} />
          <InputField label="Amount to pay" required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <p className="text-xs text-text-tertiary">The days leave the balance. The amount is added as an earning to this employee's next payroll run.</p>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={encash.isPending}>Encash</button>
        </div>
      </div>
    </Modal>
  );
}

function Types() {
  const utils = trpc.useUtils();
  const types = trpc.payrollLeave.typeList.useQuery();
  const [open, setOpen] = useState(false);
  const seed = trpc.payrollLeave.typeSeedDefaults.useMutation({
    onSuccess: (r) => {
      toast({ title: r.added ? `Added ${r.added} leave types` : "The standard leave types are already there", variant: "success" });
      void utils.payrollLeave.typeList.invalidate();
    },
    onError: onError("Could not add the leave types"),
  });
  const rows = types.data ?? [];
  return (
    <Panel
      title="Leave types"
      actions={
        <>
          <button className="btn-secondary btn-sm" onClick={() => seed.mutate()} disabled={seed.isPending}>Add CL, SL, EL and LOP</button>
          <button className="btn-primary btn-sm" onClick={() => setOpen(true)}>+ Leave type</button>
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState title="No leave types yet" description="Casual (CL), sick (SL), earned or privilege (EL) and loss of pay (LOP) are the usual ones." action={<button className="btn-primary" onClick={() => seed.mutate()}>Add the standard types</button>} />
      ) : (
        <div className="overflow-x-auto">
          <table className={TABLE}>
            <thead><tr><th>Code</th><th>Name</th><th>Paid</th><th>Grant</th><th>Carry forward</th><th>Encashment</th></tr></thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id}>
                  <td className="font-medium text-text-primary">{t.code}</td>
                  <td>{t.name}</td>
                  <td>{t.isPaid ? "Paid" : "Unpaid"}</td>
                  <td className="text-text-secondary">{t.accrualType === "none" ? "No grant" : `${Number(t.accrualDays)} per ${t.accrualType === "monthly" ? "month" : "year"}`}</td>
                  <td className="text-text-secondary">{t.carryForward ? `Up to ${Number(t.carryForwardMax)}` : "No"}</td>
                  <td className="text-text-secondary">{t.encashable ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && <TypeDialog onClose={() => setOpen(false)} onSaved={() => void utils.payrollLeave.typeList.invalidate()} />}
    </Panel>
  );
}

function TypeDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [isPaid, setPaid] = useState(true);
  const [accrualType, setAccrualType] = useState<(typeof LEAVE_ACCRUAL_TYPES)[number]>("annual");
  const [accrualDays, setDays] = useState("12");
  const [carry, setCarry] = useState(false);
  const [carryMax, setCarryMax] = useState("0");
  const [encashable, setEncashable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = trpc.payrollLeave.typeCreate.useMutation({
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: onError("Could not add the leave type"),
  });
  function save() {
    const parsed = leaveTypeSchema.safeParse({ code, name, isPaid, accrualType, accrualDays: Number(accrualDays) || 0, carryForward: carry, carryForwardMax: Number(carryMax) || 0, encashable });
    if (!parsed.success) return setError(parsed.error.issues[0]!.message);
    setError(null);
    create.mutate(parsed.data);
  }
  return (
    <Modal open onClose={onClose} title="Add leave type">
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <InputField label="Code" required value={code} onChange={(e) => setCode(e.target.value)} placeholder="CL" />
          <InputField label="Name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Casual leave" />
          <SelectField label="Granted" value={accrualType} onChange={(e) => setAccrualType(e.target.value as typeof accrualType)}>
            <option value="none">Not granted automatically</option>
            <option value="annual">Once a year</option>
            <option value="monthly">Every month</option>
          </SelectField>
          <InputField label={accrualType === "monthly" ? "Days per month" : "Days per year"} inputMode="decimal" value={accrualDays} onChange={(e) => setDays(e.target.value)} disabled={accrualType === "none"} />
        </div>
        <CheckRow label="Paid leave" checked={isPaid} onChange={setPaid} hint="Unpaid leave is loss of pay." />
        <CheckRow label="Unused days carry forward" checked={carry} onChange={setCarry} />
        {carry && <InputField label="Carry forward at most (days)" inputMode="decimal" value={carryMax} onChange={(e) => setCarryMax(e.target.value)} />}
        <CheckRow label="Can be encashed" checked={encashable} onChange={setEncashable} />
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={create.isPending}>Add</button>
        </div>
      </div>
    </Modal>
  );
}
