import { useState } from "react";
import { selfLeaveApplySchema } from "@fintranzact/shared";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { formatDate, todayISODate } from "@/lib/utils";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { InputField, SelectField, TextareaField } from "@/components/ui/FormField";

const STATUS_COLOR: Record<string, string> = {
  pending: "bg-amber-600/[0.1] text-amber-700 dark:text-amber-400",
  approved: "bg-emerald-600/[0.08] text-emerald-700 dark:text-emerald-400",
  rejected: "bg-red-600/[0.08] text-red-700 dark:text-red-400",
  cancelled: "bg-surface-2 text-text-secondary",
};

function messageOf(e: unknown): string {
  return (e as { message?: string } | null)?.message || "Something went wrong. Please try again.";
}

/** My leave balances and applications; HR (or an owner or admin) approves. */
export function MyLeave() {
  const utils = trpc.useUtils();
  const q = trpc.payrollSelf.leaveOverview.useQuery();
  const [open, setOpen] = useState(false);
  const refresh = () => {
    void utils.payrollSelf.leaveOverview.invalidate();
    void utils.payrollSelf.attendance.invalidate();
  };
  const cancel = trpc.payrollSelf.leaveCancel.useMutation({
    onSuccess: () => {
      toast({ title: "Application cancelled", variant: "success" });
      refresh();
    },
    onError: (e) => toast({ title: "Could not cancel", description: messageOf(e), variant: "error" }),
  });
  const data = q.data;
  return (
    <section className="space-y-5" aria-label="My leave">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-text-primary">Leave balance</h2>
        <button className="btn-primary" onClick={() => setOpen(true)} disabled={!data}>Apply for leave</button>
      </div>
      {!data ? (
        <p className="text-sm text-text-tertiary">{q.isLoading ? "Loading..." : "Could not load your leave."}</p>
      ) : (
        <>
          <ul className="grid gap-3 sm:grid-cols-3" aria-label="Balances">
            {data.types.map((t) => (
              <li key={t.id} className="rounded-xl border border-border-light bg-surface-0 px-4 py-3">
                <p className="text-xs text-text-tertiary">{t.name}{t.isPaid ? "" : " (unpaid)"}</p>
                <p className="text-xl font-semibold tabular-nums text-text-primary">{t.balance}</p>
              </li>
            ))}
          </ul>
          <div>
            <h3 className="mb-2 text-sm font-semibold text-text-primary">My applications</h3>
            {data.applications.length === 0 ? (
              <p className="rounded-lg border border-border-light px-4 py-3 text-sm text-text-secondary">You have not applied for leave yet.</p>
            ) : (
              <ul className="divide-y divide-border-light rounded-xl border border-border-light bg-surface-0">
                {data.applications.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-text-primary">{a.leaveName}, {Number(a.days)} day(s)</p>
                      <p className="text-xs text-text-tertiary">{a.fromDate === a.toDate ? formatDate(a.fromDate) : `${formatDate(a.fromDate)} to ${formatDate(a.toDate)}`}{a.decisionNote ? ` - ${a.decisionNote}` : ""}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge color={STATUS_COLOR[a.status]}>{a.status[0]!.toUpperCase() + a.status.slice(1)}</Badge>
                      {a.status === "pending" && <button className="btn-secondary btn-sm" onClick={() => cancel.mutate({ id: a.id })} disabled={cancel.isPending}>Cancel</button>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
      {open && data && <ApplyDialog types={data.types} onClose={() => setOpen(false)} onSaved={refresh} />}
    </section>
  );
}

function ApplyDialog({ types, onClose, onSaved }: { types: Array<{ id: string; name: string; balance: number }>; onClose: () => void; onSaved: () => void }) {
  const [leaveTypeId, setType] = useState("");
  const [fromDate, setFrom] = useState(todayISODate());
  const [toDate, setTo] = useState(todayISODate());
  const [halfDayStart, setHalfStart] = useState(false);
  const [halfDayEnd, setHalfEnd] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const apply = trpc.payrollSelf.leaveApply.useMutation({
    onSuccess: () => {
      toast({ title: "Leave request sent to HR", variant: "success" });
      onSaved();
      onClose();
    },
    onError: (e) => setError(messageOf(e)),
  });
  function save() {
    const parsed = selfLeaveApplySchema.safeParse({ leaveTypeId, fromDate, toDate, halfDayStart, halfDayEnd, reason });
    if (!parsed.success) return setError(parsed.error.issues[0]!.message.includes("Invalid uuid") ? "Choose the leave type." : parsed.error.issues[0]!.message);
    setError(null);
    apply.mutate(parsed.data);
  }
  return (
    <Modal open onClose={onClose} title="Apply for leave" className="max-w-lg">
      <div className="space-y-3">
        <SelectField label="Leave type" required value={leaveTypeId} onChange={(e) => setType(e.target.value)}>
          <option value="">Choose...</option>
          {types.map((t) => <option key={t.id} value={t.id}>{t.name} (balance {t.balance})</option>)}
        </SelectField>
        <div className="grid gap-3 sm:grid-cols-2">
          <InputField label="From" type="date" required value={fromDate} onChange={(e) => setFrom(e.target.value)} />
          <InputField label="To" type="date" required value={toDate} onChange={(e) => setTo(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={halfDayStart} onChange={(e) => setHalfStart(e.target.checked)} /> First day is a half day</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={halfDayEnd} onChange={(e) => setHalfEnd(e.target.checked)} /> Last day is a half day</label>
        <TextareaField label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Close</button>
          <button className="btn-primary" onClick={save} disabled={apply.isPending}>Send request</button>
        </div>
      </div>
    </Modal>
  );
}
