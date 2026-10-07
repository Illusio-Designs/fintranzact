import { useEffect, useState } from "react";
import {
  ATTENDANCE_STATUS_LABELS,
  HOLIDAY_SCOPES,
  INDIAN_STATES,
  WEEKDAY_NAMES,
  dateRange,
  holidaySchema,
  weekdayOf,
  type AttendanceStatus,
} from "@fintranzact/shared";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { cn, formatDate, todayISODate } from "@/lib/utils";
import { Modal } from "@/components/ui/Modal";
import { InputField, SelectField } from "@/components/ui/FormField";
import { EmptyState } from "@/components/ui/EmptyState";
import { PillTabs } from "@/components/ui/Tabs";
import { CheckRow, Panel, TABLE, currentMonth, monthLabel, onError, shiftMonth } from "./payroll-ui";

type View = "grid" | "holidays" | "settings";

export function AttendanceTab() {
  const [view, setView] = useState<View>("grid");
  return (
    <div className="space-y-4">
      <PillTabs
        value={view}
        onChange={(v) => setView(v as View)}
        tabs={[{ value: "grid", label: "Monthly attendance" }, { value: "holidays", label: "Holiday calendar" }, { value: "settings", label: "Weekly offs and shifts" }]}
      />
      {view === "grid" && <AttendanceGrid />}
      {view === "holidays" && <HolidaysPanel />}
      {view === "settings" && <SettingsPanel />}
    </div>
  );
}

const CELL: Record<string, { label: string; className: string }> = {
  present: { label: "P", className: "bg-emerald-600/[0.12] text-emerald-800 dark:text-emerald-300" },
  absent: { label: "A", className: "bg-red-600/[0.12] text-red-700 dark:text-red-300" },
  half_day: { label: "H", className: "bg-amber-600/[0.14] text-amber-800 dark:text-amber-300" },
  week_off: { label: "WO", className: "bg-surface-2 text-text-tertiary" },
  holiday: { label: "HOL", className: "bg-blue-600/[0.1] text-blue-700 dark:text-blue-300" },
  leave: { label: "L", className: "bg-violet-600/[0.12] text-violet-700 dark:text-violet-300" },
};

function AttendanceGrid() {
  const utils = trpc.useUtils();
  const [month, setMonth] = useState(currentMonth());
  const [marking, setMarking] = useState<{ employeeId: string; name: string; date: string } | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const { data, isLoading } = trpc.payrollAttendance.month.useQuery({ month });
  const bulk = trpc.payrollAttendance.bulkMark.useMutation({
    onSuccess: (r) => {
      toast({ title: `Marked ${r.marked} day${r.marked === 1 ? "" : "s"} present`, description: r.skipped ? `${r.skipped} already marked or outside employment were left alone.` : undefined, variant: "success" });
      void utils.payrollAttendance.month.invalidate();
    },
    onError: onError("Could not mark attendance"),
  });
  const refresh = () => void utils.payrollAttendance.month.invalidate();

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button className="btn-secondary btn-sm" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
          <h2 className="min-w-36 text-center text-base font-semibold text-text-primary" aria-live="polite">{monthLabel(month)}</h2>
          <button className="btn-secondary btn-sm" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}>›</button>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="btn-secondary"
            disabled={!data || data.locked || data.employees.length === 0 || bulk.isPending}
            onClick={() => data && bulk.mutate({ employeeIds: data.employees.map((e) => e.id), dates: data.dates, status: "present" })}
          >
            Mark everyone present
          </button>
          <button className="btn-primary" disabled={!data || data.locked || data.employees.length === 0} onClick={() => setBulkOpen(true)}>Bulk mark</button>
        </div>
      </div>

      {data?.locked && (
        <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          This month's attendance is locked by its payroll run. Reopen the run (before approval) to change it.
        </p>
      )}

      <Panel>
        {isLoading ? (
          <p className="p-6 text-sm text-text-tertiary">Loading attendance...</p>
        ) : !data || data.employees.length === 0 ? (
          <EmptyState title="No employees this month" description="Employees appear here from their joining date until their last working day." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs" data-testid="attendance-grid">
              <thead>
                <tr>
                  <th scope="col" className="sticky left-0 z-10 min-w-40 bg-surface-0 px-3 py-2 text-left font-semibold text-text-secondary">Employee</th>
                  {data.dates.map((d) => (
                    <th key={d} scope="col" className={cn("w-8 min-w-8 px-0.5 py-1 text-center font-medium", weekdayOf(d) === 0 ? "text-red-600" : "text-text-tertiary")}>
                      <span className="block">{Number(d.slice(8))}</span>
                      <span className="block text-[10px] font-normal">{WEEKDAY_NAMES[weekdayOf(d)]!.slice(0, 1)}</span>
                    </th>
                  ))}
                  <th scope="col" className="px-2 py-2 text-right font-semibold text-text-secondary">Paid</th>
                  <th scope="col" className="px-2 py-2 text-right font-semibold text-text-secondary">LOP</th>
                </tr>
              </thead>
              <tbody>
                {data.employees.map((e) => (
                  <tr key={e.id} className="border-t border-border-light">
                    <th scope="row" className="sticky left-0 z-10 bg-surface-0 px-3 py-1.5 text-left font-medium text-text-primary">
                      {e.name}
                      <span className="block text-[10px] font-normal text-text-tertiary">{e.employeeCode}</span>
                    </th>
                    {data.dates.map((d) => {
                      const outside = d < e.dateOfJoining || (!!e.lastWorkingDay && d > e.lastWorkingDay);
                      const rec = e.days[d];
                      const derived: AttendanceStatus | null = !rec ? (e.weeklyOffDays.includes(weekdayOf(d)) ? "week_off" : e.holidayDates.includes(d) ? "holiday" : null) : null;
                      const status = (rec?.status as AttendanceStatus | undefined) ?? derived;
                      const cell = status ? CELL[status] : null;
                      if (outside) return <td key={d} className="px-0.5 py-1 text-center text-text-tertiary" aria-label="Not employed">·</td>;
                      return (
                        <td key={d} className="px-0.5 py-1 text-center">
                          <button
                            type="button"
                            disabled={data.locked}
                            aria-label={`${e.name}, ${formatDate(d)}: ${status ? ATTENDANCE_STATUS_LABELS[status] : "not marked"}`}
                            onClick={() => setMarking({ employeeId: e.id, name: e.name, date: d })}
                            className={cn(
                              "h-7 w-7 rounded text-[10px] font-semibold",
                              cell ? cell.className : "border border-dashed border-border-color text-text-tertiary",
                              derived && "opacity-70",
                              rec?.source === "leave" && "ring-1 ring-violet-400",
                            )}
                          >
                            {cell ? cell.label : ""}
                          </button>
                        </td>
                      );
                    })}
                    <td className="px-2 py-1 text-right tabular-nums text-text-primary">{e.summary.paidDays}</td>
                    <td className={cn("px-2 py-1 text-right tabular-nums", e.summary.lopDays > 0 ? "font-semibold text-red-600" : "text-text-secondary")}>{e.summary.lopDays}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <p className="text-xs text-text-tertiary">
        P present, A absent, H half day, L leave, WO weekly off, HOL holiday. Faded cells follow the calendar and need no marking. Weekly offs and holidays are paid; absent days and unpaid leave are loss of pay (LOP).
      </p>

      {marking && data && <MarkDialog target={marking} onClose={() => setMarking(null)} onSaved={refresh} />}
      {bulkOpen && data && (
        <BulkDialog
          month={month}
          employees={data.employees.map((e) => ({ id: e.id, name: e.name, code: e.employeeCode }))}
          onClose={() => setBulkOpen(false)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}

function MarkDialog({ target, onClose, onSaved }: { target: { employeeId: string; name: string; date: string }; onClose: () => void; onSaved: () => void }) {
  const [status, setStatus] = useState<AttendanceStatus>("present");
  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [overtime, setOvertime] = useState("0");
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const types = trpc.payrollLeave.typeList.useQuery();
  const mark = trpc.payrollAttendance.mark.useMutation({
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: onError("Could not mark the day"),
  });
  const worked = status === "present" || status === "half_day";
  return (
    <Modal open onClose={onClose} title={`${target.name}, ${formatDate(target.date)}`}>
      <div className="space-y-3">
        <fieldset>
          <legend className="label">Status</legend>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(ATTENDANCE_STATUS_LABELS) as AttendanceStatus[]).map((s) => (
              <label key={s} className={cn("cursor-pointer rounded-full border px-3 py-1 text-sm", status === s ? "border-brand-600 bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300" : "border-border-light text-text-secondary")}>
                <input type="radio" name="status" className="sr-only" checked={status === s} onChange={() => setStatus(s)} />
                {ATTENDANCE_STATUS_LABELS[s]}
              </label>
            ))}
          </div>
        </fieldset>
        {(status === "leave" || status === "half_day") && (
          <SelectField label={status === "leave" ? "Leave type" : "Leave type for the other half (optional)"} value={leaveTypeId} onChange={(e) => setLeaveTypeId(e.target.value)} required={status === "leave"}>
            <option value="">{status === "leave" ? "Choose..." : "None"}</option>
            {(types.data ?? []).filter((t) => t.isActive).map((t) => <option key={t.id} value={t.id}>{t.name} ({t.code}){t.isPaid ? "" : ", unpaid"}</option>)}
          </SelectField>
        )}
        {worked && (
          <div className="grid gap-3 sm:grid-cols-3">
            <InputField label="Check-in" type="time" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
            <InputField label="Check-out" type="time" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
            <InputField label="Overtime hours" inputMode="decimal" value={overtime} onChange={(e) => setOvertime(e.target.value)} />
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary"
            disabled={mark.isPending || (status === "leave" && !leaveTypeId)}
            onClick={() =>
              mark.mutate({
                employeeId: target.employeeId,
                date: target.date,
                status,
                leaveTypeId: leaveTypeId || null,
                checkIn: worked && checkIn ? checkIn : null,
                checkOut: worked && checkOut ? checkOut : null,
                overtimeHours: worked ? Number(overtime) || 0 : 0,
              })
            }
          >
            Save
          </button>
        </div>
      </div>
    </Modal>
  );
}

function BulkDialog({ month, employees, onClose, onSaved }: { month: string; employees: Array<{ id: string; name: string; code: string }>; onClose: () => void; onSaved: () => void }) {
  const [status, setStatus] = useState<"present" | "absent" | "half_day" | "week_off" | "holiday">("present");
  const [from, setFrom] = useState(`${month}-01`);
  const [to, setTo] = useState(`${month}-${String(new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate()).padStart(2, "0")}`);
  const [chosen, setChosen] = useState<Set<string>>(new Set(employees.map((e) => e.id)));
  const [overwrite, setOverwrite] = useState(false);
  const bulk = trpc.payrollAttendance.bulkMark.useMutation({
    onSuccess: (r) => {
      toast({ title: `Marked ${r.marked} day${r.marked === 1 ? "" : "s"}`, description: r.skipped ? `${r.skipped} skipped (already marked or outside employment).` : undefined, variant: "success" });
      onSaved();
      onClose();
    },
    onError: onError("Could not mark attendance"),
  });
  const dates = dateRange(from, to).filter((d) => d.startsWith(month));
  return (
    <Modal open onClose={onClose} title="Bulk mark attendance" className="max-w-xl">
      <div className="space-y-3">
        <SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          {(["present", "absent", "half_day", "week_off", "holiday"] as const).map((s) => <option key={s} value={s}>{ATTENDANCE_STATUS_LABELS[s]}</option>)}
        </SelectField>
        <div className="grid gap-3 sm:grid-cols-2">
          <InputField label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <InputField label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <fieldset>
          <legend className="label">Employees ({chosen.size} of {employees.length})</legend>
          <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-border-light p-2">
            <CheckRow label="Everyone" checked={chosen.size === employees.length} onChange={(v) => setChosen(new Set(v ? employees.map((e) => e.id) : []))} />
            {employees.map((e) => (
              <CheckRow key={e.id} label={`${e.name} (${e.code})`} checked={chosen.has(e.id)} onChange={(v) => setChosen((s) => { const n = new Set(s); if (v) n.add(e.id); else n.delete(e.id); return n; })} />
            ))}
          </div>
        </fieldset>
        <CheckRow label="Replace days that are already marked" checked={overwrite} onChange={setOverwrite} hint="Off: marked days are kept. Days written by approved leave are never replaced." />
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={bulk.isPending || chosen.size === 0 || dates.length === 0} onClick={() => bulk.mutate({ employeeIds: [...chosen], dates, status, overwrite })}>
            Mark {dates.length} day{dates.length === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function HolidaysPanel() {
  const utils = trpc.useUtils();
  const [year, setYear] = useState(new Date().getFullYear());
  const { data } = trpc.payrollAttendance.holidayList.useQuery({ year });
  const [date, setDate] = useState(todayISODate());
  const [name, setName] = useState("");
  const [scope, setScope] = useState<(typeof HOLIDAY_SCOPES)[number]>("national");
  const [stateCode, setStateCode] = useState("");
  const [branch, setBranch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const refresh = () => void utils.payrollAttendance.holidayList.invalidate();
  const create = trpc.payrollAttendance.holidayCreate.useMutation({
    onSuccess: () => {
      setName("");
      refresh();
    },
    onError: onError("Could not add the holiday"),
  });
  const del = trpc.payrollAttendance.holidayDelete.useMutation({ onSuccess: refresh, onError: onError("Could not delete the holiday") });
  const copy = trpc.payrollAttendance.holidayCopyYear.useMutation({
    onSuccess: (r) => {
      toast({ title: r.copied ? `Copied ${r.copied} holidays to ${year}` : "Nothing new to copy", variant: "success" });
      refresh();
    },
    onError: onError("Could not copy the holidays"),
  });

  function add() {
    const parsed = holidaySchema.safeParse({ date, name, scope, stateCode: scope === "state" ? stateCode || null : null, branch: scope === "branch" ? branch : "" });
    if (!parsed.success) return setError(parsed.error.issues[0]!.message);
    setError(null);
    create.mutate(parsed.data);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <Panel
        title={`Holidays in ${year}`}
        actions={
          <>
            <button className="btn-secondary btn-sm" aria-label="Previous year" onClick={() => setYear(year - 1)}>‹</button>
            <button className="btn-secondary btn-sm" aria-label="Next year" onClick={() => setYear(year + 1)}>›</button>
            <button className="btn-secondary btn-sm" onClick={() => copy.mutate({ fromYear: year - 1, toYear: year })} disabled={copy.isPending}>Copy from {year - 1}</button>
          </>
        }
      >
        {(data ?? []).length === 0 ? (
          <EmptyState title={`No holidays in ${year}`} description="National holidays apply to everyone. State and branch holidays apply to employees working there." />
        ) : (
          <table className={TABLE}>
            <thead><tr><th>Date</th><th>Holiday</th><th>Applies to</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {(data ?? []).map((h) => (
                <tr key={h.id}>
                  <td className="whitespace-nowrap">{formatDate(h.date)}</td>
                  <td className="font-medium text-text-primary">{h.name}</td>
                  <td className="text-text-secondary">{h.scope === "national" ? "Everyone" : h.scope === "state" ? INDIAN_STATES.find((s) => s.code === h.stateCode)?.name ?? h.stateCode : `Branch ${h.branch}`}</td>
                  <td className="text-right"><button className="btn-secondary btn-sm" onClick={() => del.mutate({ id: h.id })} aria-label={`Delete ${h.name}`}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      <Panel title="Add a holiday">
        <form className="space-y-3 p-4" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <InputField label="Date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          <InputField label="Name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Diwali" />
          <SelectField label="Applies to" value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
            <option value="national">Everyone (national)</option>
            <option value="state">One state</option>
            <option value="branch">One branch</option>
          </SelectField>
          {scope === "state" && (
            <SelectField label="State" required value={stateCode} onChange={(e) => setStateCode(e.target.value)}>
              <option value="">Choose...</option>
              {INDIAN_STATES.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
            </SelectField>
          )}
          {scope === "branch" && <InputField label="Branch" required value={branch} onChange={(e) => setBranch(e.target.value)} />}
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <button type="submit" className="btn-primary w-full" disabled={create.isPending}>Add holiday</button>
        </form>
      </Panel>
    </div>
  );
}

function SettingsPanel() {
  const utils = trpc.useUtils();
  const settings = trpc.payrollAttendance.settings.useQuery();
  const shifts = trpc.payrollEmployee.shiftList.useQuery();
  const [offs, setOffs] = useState<number[]>([0]);
  const [hours, setHours] = useState("8");
  const [multiplier, setMultiplier] = useState("2");
  const [leaveStart, setLeaveStart] = useState("4");
  const [shiftOpen, setShiftOpen] = useState(false);
  useEffect(() => {
    if (!settings.data) return;
    setOffs(settings.data.defaultWeeklyOffDays);
    setHours(String(settings.data.standardHoursPerDay));
    setMultiplier(String(settings.data.overtimeMultiplier));
    setLeaveStart(String(settings.data.leaveYearStartMonth));
  }, [settings.data]);
  const save = trpc.payrollAttendance.updateSettings.useMutation({
    onSuccess: () => {
      toast({ title: "Payroll settings saved", variant: "success" });
      void utils.payrollAttendance.settings.invalidate();
    },
    onError: onError("Could not save the settings"),
  });
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Weekly offs and overtime">
        <form className="space-y-3 p-4" onSubmit={(e) => { e.preventDefault(); save.mutate({ defaultWeeklyOffDays: offs, standardHoursPerDay: Number(hours), overtimeMultiplier: Number(multiplier), leaveYearStartMonth: Number(leaveStart) }); }}>
          <fieldset>
            <legend className="label">Weekly off days (everyone without a shift)</legend>
            <div className="flex flex-wrap gap-3">
              {WEEKDAY_NAMES.map((n, i) => <CheckRow key={n} label={n} checked={offs.includes(i)} onChange={(v) => setOffs((o) => (v ? [...new Set([...o, i])] : o.filter((x) => x !== i)))} />)}
            </div>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-3">
            <InputField label="Standard hours a day" inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} />
            <InputField label="Overtime rate (times)" inputMode="decimal" value={multiplier} onChange={(e) => setMultiplier(e.target.value)} />
            <SelectField label="Leave year starts in" value={leaveStart} onChange={(e) => setLeaveStart(e.target.value)}>
              {Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{new Date(2000, i, 1).toLocaleString("en-IN", { month: "long" })}</option>)}
            </SelectField>
          </div>
          <p className="text-xs text-text-tertiary">Overtime is paid at hours x the ordinary hourly wage x this rate. The ordinary hourly wage is the full-month Basic + DA + retaining allowance divided by the days in the month and the standard hours. The usual rate is twice the ordinary wage; confirm it with your CA each year.</p>
          <button type="submit" className="btn-primary" disabled={save.isPending || offs.length === 0}>Save settings</button>
        </form>
      </Panel>
      <Panel title="Shifts" actions={<button className="btn-primary btn-sm" onClick={() => setShiftOpen(true)}>+ Shift</button>}>
        {(shifts.data ?? []).length === 0 ? (
          <EmptyState title="No shifts" description="Without a shift, an employee follows the weekly offs on the left." />
        ) : (
          <table className={TABLE}>
            <thead><tr><th>Shift</th><th>Hours</th><th>Weekly offs</th></tr></thead>
            <tbody>
              {(shifts.data ?? []).map((s) => (
                <tr key={s.id}>
                  <td className="font-medium text-text-primary">{s.name}</td>
                  <td className="text-text-secondary">{s.startTime} to {s.endTime}</td>
                  <td className="text-text-secondary">{s.weeklyOffDays.map((d) => WEEKDAY_NAMES[d]!.slice(0, 3)).join(", ") || "None"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      {shiftOpen && <ShiftDialog onClose={() => setShiftOpen(false)} onSaved={() => void utils.payrollEmployee.shiftList.invalidate()} />}
    </div>
  );
}

function ShiftDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("18:00");
  const [offs, setOffs] = useState<number[]>([0]);
  const create = trpc.payrollEmployee.shiftCreate.useMutation({
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: onError("Could not add the shift"),
  });
  return (
    <Modal open onClose={onClose} title="Add shift">
      <div className="space-y-3">
        <InputField label="Name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="General" />
        <div className="grid gap-3 sm:grid-cols-2">
          <InputField label="Starts" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          <InputField label="Ends" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
        <fieldset>
          <legend className="label">Weekly offs</legend>
          <div className="flex flex-wrap gap-3">
            {WEEKDAY_NAMES.map((n, i) => <CheckRow key={n} label={n} checked={offs.includes(i)} onChange={(v) => setOffs((o) => (v ? [...new Set([...o, i])] : o.filter((x) => x !== i)))} />)}
          </div>
        </fieldset>
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={create.isPending || !name.trim()} onClick={() => create.mutate({ name, startTime: start, endTime: end, weeklyOffDays: offs, standardHours: 8 })}>Add</button>
        </div>
      </div>
    </Modal>
  );
}
