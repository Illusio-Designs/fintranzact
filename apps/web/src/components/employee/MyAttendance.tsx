import { useState } from "react";
import { ATTENDANCE_STATUS_LABELS, SELF_ATTENDANCE_FLAG_LABELS, formatPayrollMonth, type AttendanceStatus } from "@fintranzact/shared";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { currentMonth, shiftMonth } from "@/components/payroll/payroll-ui";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const TONE: Record<string, string> = {
  present: "bg-emerald-600/[0.1] text-emerald-800 dark:text-emerald-300",
  half_day: "bg-amber-600/[0.12] text-amber-800 dark:text-amber-300",
  absent: "bg-red-600/[0.1] text-red-700 dark:text-red-400",
  leave: "bg-blue-600/[0.1] text-blue-700 dark:text-blue-400",
};

/** A month of my own days: status, times, week offs and holidays, my punches and my leave. */
export function MyAttendance() {
  const [month, setMonth] = useState(currentMonth());
  const q = trpc.payrollSelf.attendance.useQuery({ month });
  const data = q.data;
  const firstWeekday = new Date(`${month}-01T00:00:00Z`).getUTCDay();
  return (
    <section className="space-y-4" aria-label="My attendance">
      <div className="flex items-center justify-between">
        <button className="btn-secondary btn-sm" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">Previous</button>
        <h2 className="text-base font-semibold text-text-primary">{formatPayrollMonth(month)}</h2>
        <button className="btn-secondary btn-sm" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month" disabled={month >= currentMonth()}>Next</button>
      </div>
      {!data ? (
        <p className="text-sm text-text-tertiary">{q.isLoading ? "Loading..." : "Could not load your attendance."}</p>
      ) : (
        <>
          <p className="text-sm text-text-secondary" data-testid="attendance-summary">
            Present {data.summary.present}, half days {data.summary.halfDay}, absent {data.summary.absent}, on leave {data.summary.leave}.
          </p>
          <div className="grid grid-cols-7 gap-1 text-center text-xs" role="grid" aria-label="Calendar">
            {WEEKDAYS.map((d) => <div key={d} className="py-1 font-medium text-text-tertiary">{d}</div>)}
            {Array.from({ length: firstWeekday }, (_, i) => <div key={`blank-${i}`} />)}
            {data.days.map((d) => {
              const label = d.status ? ATTENDANCE_STATUS_LABELS[d.status as AttendanceStatus] ?? d.status : d.holiday ?? (d.weekOff ? "Week off" : "");
              return (
                <div key={d.date} className={cn("min-h-[3.5rem] rounded-md border border-border-light p-1", d.status ? TONE[d.status] : d.holiday || d.weekOff ? "bg-surface-2 text-text-tertiary" : "bg-surface-0 text-text-secondary", !d.employed && "opacity-40")} title={label}>
                  <div className="font-semibold">{Number(d.date.slice(8))}</div>
                  <div className="truncate leading-tight">{label}</div>
                  {d.checkIn && <div className="leading-tight tabular-nums">{d.checkIn}{d.checkOut ? `-${d.checkOut}` : ""}</div>}
                </div>
              );
            })}
          </div>
          {data.punches.length > 0 && (
            <div>
              <h3 className="mb-1 text-sm font-semibold text-text-primary">My punches</h3>
              <ul className="divide-y divide-border-light rounded-lg border border-border-light text-sm">
                {[...data.punches].reverse().map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                    <span>{p.date.slice(8)}/{p.date.slice(5, 7)} {p.kind === "in" ? "In" : "Out"} {p.time}</span>
                    <span className="text-xs text-text-tertiary">
                      {p.flags.map((f) => SELF_ATTENDANCE_FLAG_LABELS[f] ?? f).join(", ")}
                      {p.review === "rejected" ? " Not counted" : p.review === "pending" ? " With HR" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
