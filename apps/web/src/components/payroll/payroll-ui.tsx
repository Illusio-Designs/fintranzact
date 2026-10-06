import { PAYROLL_RUN_STATUS_LABELS, formatPayrollMonth, type PayrollRunStatus } from "@fintranzact/shared";
import { Badge } from "@/components/ui/Badge";
import { toast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";

/** The message of a failed call, as the person should read it. */
export function errorMessage(e: unknown): string {
  return (e as { message?: string } | null)?.message || "Something went wrong. Please try again.";
}

export function onError(title: string) {
  return (e: unknown) => toast({ title, description: errorMessage(e), variant: "error" });
}

const RUN_STATUS_COLOR: Record<PayrollRunStatus, string> = {
  draft: "bg-surface-2 text-text-secondary",
  attendance_locked: "bg-blue-600/[0.08] text-blue-700 dark:text-blue-400",
  calculated: "bg-blue-600/[0.08] text-blue-700 dark:text-blue-400",
  pending_approval: "bg-amber-600/[0.1] text-amber-700 dark:text-amber-400",
  approved: "bg-emerald-600/[0.08] text-emerald-700 dark:text-emerald-400",
  posted: "bg-emerald-600/[0.08] text-emerald-700 dark:text-emerald-400",
  paid: "bg-emerald-600/[0.14] text-emerald-800 dark:text-emerald-300",
};

export function RunStatusBadge({ status }: { status: string }) {
  const s = status as PayrollRunStatus;
  return <Badge color={RUN_STATUS_COLOR[s] ?? "bg-surface-2 text-text-secondary"}>{PAYROLL_RUN_STATUS_LABELS[s] ?? status}</Badge>;
}

/** "2026-10" -> "October 2026". */
export const monthLabel = formatPayrollMonth;

/** The current month as "YYYY-MM" (local time). */
export function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Download a base64 file (a payslip PDF) through the browser. */
export function downloadBase64(filename: string, contentType: string, base64: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  saveBlob(filename, new Blob([bytes], { type: contentType }));
}

/** Download text (the bank payment CSV) through the browser. */
export function downloadText(filename: string, contentType: string, text: string) {
  saveBlob(filename, new Blob([text], { type: contentType }));
}

function saveBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A switch-like checkbox row used by several payroll forms. */
export function CheckRow({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex items-start gap-2 text-sm text-text-primary">
      <input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}
        {hint && <span className="block text-xs text-text-tertiary">{hint}</span>}
      </span>
    </label>
  );
}

/** A bordered panel with a title: the payroll pages' basic block. */
export function Panel({ title, actions, children, className }: { title?: string; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-xl border border-border-light bg-surface-0", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border-light px-4 py-3">
          {title && <h2 className="text-sm font-semibold text-text-primary">{title}</h2>}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

/** Table styles shared by the payroll tables. */
export const TABLE = "data-table w-full";
