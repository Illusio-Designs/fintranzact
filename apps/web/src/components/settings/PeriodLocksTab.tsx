import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Modal } from "@/components/ui/Modal";
import { DateInput } from "@/components/ui/DateInput";
import { Listbox } from "@/components/ui/Listbox";
import { Icon } from "@/components/ui/Icon";
import { Spinner } from "@/components/ui/Spinner";
import { SquareLock02Icon } from "@hugeicons/core-free-icons";
import { toast } from "@/hooks/useToast";
import { formatCurrency, formatDate } from "@/lib/utils";

// ── Helpers ────────────────────────────────────────────────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-03-31" → "31 Mar 2026". */
export function lockDateLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]} ${y}`;
}

/** "2026-08" → "Aug 2026". */
export function returnMonthLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${y}`;
}

/** The last few financial years that have ended, newest first: "2025-26", "2024-25"… (April start). */
export function finishedYears(today: string, count = 5): string[] {
  const [y, m] = today.split("-").map(Number);
  const currentStart = (m ?? 1) >= 4 ? y! : y! - 1;
  return Array.from({ length: count }, (_, i) => {
    const start = currentStart - 1 - i;
    return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
  });
}

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="card px-6 py-5">
      <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
      <p className="text-sm text-text-tertiary mt-0.5 mb-4">{description}</p>
      {children}
    </div>
  );
}

// ── Owner-only reason dialog ───────────────────────────────────

function ReasonDialog({
  open,
  title,
  description,
  confirmLabel,
  loading,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  loading: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const valid = reason.trim().length >= 10;
  return (
    <Modal open={open} onClose={onClose} title={title} className="max-w-md">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onConfirm(reason.trim());
        }}
      >
        <p className="text-sm text-text-secondary">{description}</p>
        <div>
          <label className="label" htmlFor="unlock-reason">Reason</label>
          <textarea
            id="unlock-reason"
            className="input min-h-[80px]"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why does this need to change? (at least 10 characters)"
            maxLength={500}
          />
          <p className="text-xs text-text-tertiary mt-1">This is recorded in the audit log with your name.</p>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={!valid || loading}>
            {loading ? <Spinner size="sm" /> : confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ── Books lock ─────────────────────────────────────────────────

function BooksLockSection() {
  const utils = trpc.useUtils();
  const { data: status } = trpc.period.status.useQuery();
  const [through, setThrough] = useState("");
  const [note, setNote] = useState("");
  const [unlockOpen, setUnlockOpen] = useState(false);

  const refresh = () => {
    utils.period.status.invalidate();
    utils.period.closes.invalidate();
  };
  const lock = trpc.period.lockBooks.useMutation({
    onSuccess: (r) => {
      toast.success("Books locked", `Entries up to ${lockDateLabel(r.lockedThrough)} can no longer be changed.`);
      setThrough("");
      setNote("");
      refresh();
    },
    onError: (err) => toast.error("Couldn't lock the books", err.message),
  });
  const unlock = trpc.period.unlockBooks.useMutation({
    onSuccess: () => {
      toast.success("Books unlocked");
      setUnlockOpen(false);
      refresh();
    },
    onError: (err) => toast.error("Couldn't unlock", err.message),
  });

  if (!status) return null;
  const locked = status.booksLockedThrough;

  return (
    <Section
      title="Lock the books"
      description="Nothing dated on or before the lock date can be added, edited or deleted, on the web, mobile, the API and imports."
    >
      {locked ? (
        <div className="flex items-start justify-between gap-4 rounded-lg bg-surface-2 px-4 py-3 mb-4">
          <div>
            <p className="text-sm font-medium text-text-primary">Locked through {lockDateLabel(locked)}</p>
            {status.booksLock && (
              <p className="text-xs text-text-tertiary mt-0.5">
                Set {status.booksLock.by ? `by ${status.booksLock.by} ` : ""}on {formatDate(status.booksLock.at)}
                {status.booksLock.note ? ` — ${status.booksLock.note}` : ""}
              </p>
            )}
          </div>
          {status.canUnlock && (
            <button className="btn-secondary shrink-0" onClick={() => setUnlockOpen(true)}>Unlock…</button>
          )}
        </div>
      ) : (
        <p className="text-sm text-text-tertiary mb-4">The books are open: any date can be edited.</p>
      )}

      {status.canLock ? (
        <form
          className="grid gap-3 sm:grid-cols-[200px_1fr_auto] items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (through) lock.mutate({ through, note: note.trim() || undefined });
          }}
        >
          <div>
            <label className="label" htmlFor="lock-through">Lock through</label>
            <DateInput
              id="lock-through"
              value={through}
              onChange={(e) => setThrough(e.target.value)}
              min={locked ? locked : undefined}
              max={status.latestLockableDate}
            />
          </div>
          <div>
            <label className="label" htmlFor="lock-note">Note (optional)</label>
            <input id="lock-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="e.g. Filed with the CA" />
          </div>
          <button type="submit" className="btn-primary" disabled={!through || lock.isPending}>
            {lock.isPending ? <Spinner size="sm" /> : locked ? "Extend lock" : "Lock books"}
          </button>
        </form>
      ) : (
        <p className="text-xs text-text-tertiary">Only owners, admins and accountants can lock periods.</p>
      )}
      {!status.canUnlock && locked && (
        <p className="text-xs text-text-tertiary mt-3">Only the business owner can unlock a period.</p>
      )}

      <ReasonDialog
        open={unlockOpen}
        title="Unlock the books"
        description="Choose to remove the lock entirely. Entries in the unlocked period can be changed again, and this is recorded in the audit log."
        confirmLabel="Unlock books"
        loading={unlock.isPending}
        onClose={() => setUnlockOpen(false)}
        onConfirm={(reason) => unlock.mutate({ through: null, reason })}
      />
    </Section>
  );
}

// ── GST months ─────────────────────────────────────────────────

function GstMonthsSection() {
  const utils = trpc.useUtils();
  const { data: status } = trpc.period.status.useQuery();
  const [month, setMonth] = useState("");
  const [unlocking, setUnlocking] = useState<string | null>(null);

  const refresh = () => utils.period.status.invalidate();
  const lock = trpc.period.lockGstMonth.useMutation({
    onSuccess: (r) => {
      toast.success("Month locked", `${returnMonthLabel(r.returnPeriod)} is marked as filed.`);
      setMonth("");
      refresh();
    },
    onError: (err) => toast.error("Couldn't lock the month", err.message),
  });
  const unlock = trpc.period.unlockGstMonth.useMutation({
    onSuccess: () => {
      toast.success("Month unlocked");
      setUnlocking(null);
      refresh();
    },
    onError: (err) => toast.error("Couldn't unlock the month", err.message),
  });

  if (!status) return null;

  return (
    <Section
      title="GST months marked as filed"
      description="Once a month's GST returns are filed, lock it so its invoices, payments and input tax credit stay as filed."
    >
      {status.canMarkGstFiled && (
        <form
          className="flex flex-wrap items-end gap-3 mb-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (month) lock.mutate({ returnPeriod: month });
          }}
        >
          <div>
            <label className="label" htmlFor="gst-month">Return month</label>
            <input id="gst-month" type="month" className="input" value={month} onChange={(e) => setMonth(e.target.value)} max={status.today.slice(0, 7)} />
          </div>
          <button type="submit" className="btn-primary" disabled={!month || lock.isPending}>
            {lock.isPending ? <Spinner size="sm" /> : "Mark as filed"}
          </button>
        </form>
      )}

      {status.gstMonths.length === 0 ? (
        <p className="text-sm text-text-tertiary">No months are marked as filed.</p>
      ) : (
        <ul className="divide-y divide-border-subtle">
          {status.gstMonths.map((m) => (
            <li key={m.returnPeriod} className="flex items-center justify-between gap-3 py-2">
              <div>
                <span className="text-sm font-medium text-text-primary">{returnMonthLabel(m.returnPeriod)}</span>
                <span className="text-xs text-text-tertiary ml-2">
                  {m.by ? `by ${m.by} · ` : ""}{formatDate(m.at)}
                </span>
              </div>
              {status.canUnlock && (
                <button className="btn-secondary" onClick={() => setUnlocking(m.returnPeriod)}>Unlock…</button>
              )}
            </li>
          ))}
        </ul>
      )}

      <ReasonDialog
        open={unlocking !== null}
        title={unlocking ? `Unlock ${returnMonthLabel(unlocking)}` : "Unlock month"}
        description="Entries dated in this month can be changed again. This is recorded in the audit log."
        confirmLabel="Unlock month"
        loading={unlock.isPending}
        onClose={() => setUnlocking(null)}
        onConfirm={(reason) => unlocking && unlock.mutate({ returnPeriod: unlocking, reason })}
      />
    </Section>
  );
}

// ── Year-end close ─────────────────────────────────────────────

function YearCloseSection() {
  const utils = trpc.useUtils();
  const { data: status } = trpc.period.status.useQuery();
  const { data: closes } = trpc.period.closes.useQuery();
  const years = useMemo(() => (status ? finishedYears(status.today) : []), [status]);
  const [year, setYear] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [reopening, setReopening] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const selected = year || years[0] || "";
  const preview = trpc.period.closeYearPreview.useQuery({ financialYear: selected }, { enabled: !!selected && !!status?.canLock });

  const refresh = () => {
    utils.period.status.invalidate();
    utils.period.closes.invalidate();
    utils.period.closeYearPreview.invalidate();
  };
  const close = trpc.period.closeYear.useMutation({
    onSuccess: (r) => {
      toast.success(`Year ${r.financialYear} closed`, `Books are locked through ${lockDateLabel(r.lockedThrough)}.`);
      setConfirming(false);
      setNote("");
      refresh();
    },
    onError: (err) => toast.error("Couldn't close the year", err.message),
  });
  const reopen = trpc.period.reopenYear.useMutation({
    onSuccess: (r) => {
      toast.success(`Year ${r.financialYear} reopened`);
      setReopening(null);
      refresh();
    },
    onError: (err) => toast.error("Couldn't reopen the year", err.message),
  });

  if (!status) return null;
  const p = preview.data;
  const hasWarnings = (p?.warnings.length ?? 0) > 0;

  return (
    <Section
      title="Close a financial year"
      description="Freezes the year's closing balances (ledgers, stock and what is owed), carries them into the next year as opening balances, and locks the books through the year's last day."
    >
      {status.canLock && (
        <>
          <div className="max-w-xs mb-4">
            <Listbox
              label="Financial year"
              value={selected}
              onChange={setYear}
              options={years.map((y) => ({ value: y, label: y }))}
            />
          </div>
          {preview.isLoading && <Spinner size="sm" />}
          {preview.error && <p className="text-sm text-red-600">{preview.error.message}</p>}
          {p && (
            <div className="space-y-3 mb-4">
              {p.alreadyClosed ? (
                <p className="text-sm text-text-secondary">{p.financialYear} is already closed.</p>
              ) : (
                <>
                  <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                    <div><dt className="text-text-tertiary">Year profit</dt><dd className="font-medium">{formatCurrency(p.snapshot.ledger.yearProfit)}</dd></div>
                    <div><dt className="text-text-tertiary">Stock value</dt><dd className="font-medium">{formatCurrency(p.snapshot.stock.totalValue)}</dd></div>
                    <div><dt className="text-text-tertiary">Customers owe</dt><dd className="font-medium">{formatCurrency(p.snapshot.outstanding.receivable)}</dd></div>
                    <div><dt className="text-text-tertiary">You owe</dt><dd className="font-medium">{formatCurrency(p.snapshot.outstanding.payable)}</dd></div>
                  </dl>
                  {hasWarnings && (
                    <ul className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-800 dark:text-amber-300 space-y-1">
                      {p.warnings.map((w) => (<li key={w}>{w}</li>))}
                    </ul>
                  )}
                  <button className="btn-primary" disabled={!p.ended} onClick={() => setConfirming(true)}>
                    Close {p.financialYear}…
                  </button>
                  {!p.ended && <p className="text-xs text-text-tertiary">This year isn't over yet.</p>}
                </>
              )}
            </div>
          )}
        </>
      )}

      <h4 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary mb-2">Closed years</h4>
      {!closes || closes.length === 0 ? (
        <p className="text-sm text-text-tertiary">No years closed yet.</p>
      ) : (
        <ul className="divide-y divide-border-subtle">
          {closes.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 py-2">
              <div>
                <span className="text-sm font-medium text-text-primary">{c.financialYear}</span>
                <span className="text-xs text-text-tertiary ml-2">
                  closed {formatDate(c.closedAt)}{c.closedByName ? ` by ${c.closedByName}` : ""} · profit {formatCurrency(c.yearProfit)}
                </span>
              </div>
              {status.canUnlock && (
                <button className="btn-secondary" onClick={() => setReopening(c.financialYear)}>Reopen…</button>
              )}
            </li>
          ))}
        </ul>
      )}

      <Modal open={confirming} onClose={() => setConfirming(false)} title={`Close ${selected}`} className="max-w-md">
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            Books will be locked through the last day of {selected}. Only the business owner can reopen the year.
          </p>
          {hasWarnings && <p className="text-sm text-amber-700">There are warnings above. Closing anyway will leave those drafts in a locked period.</p>}
          <div>
            <label className="label" htmlFor="close-note">Note (optional)</label>
            <input id="close-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
          </div>
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setConfirming(false)}>Cancel</button>
            <button
              className="btn-primary"
              disabled={close.isPending}
              onClick={() => close.mutate({ financialYear: selected, note: note.trim() || undefined, force: hasWarnings })}
            >
              {close.isPending ? <Spinner size="sm" /> : "Close year"}
            </button>
          </div>
        </div>
      </Modal>

      <ReasonDialog
        open={reopening !== null}
        title={reopening ? `Reopen ${reopening}` : "Reopen year"}
        description="The year's frozen balances are removed and its dates can be edited again. This is recorded in the audit log."
        confirmLabel="Reopen year"
        loading={reopen.isPending}
        onClose={() => setReopening(null)}
        onConfirm={(reason) => reopening && reopen.mutate({ financialYear: reopening, reason })}
      />
    </Section>
  );
}

// ── Tab ────────────────────────────────────────────────────────

export function PeriodLocksTab() {
  const { isLoading } = trpc.period.status.useQuery();
  if (isLoading) return <div className="py-12 flex justify-center"><Spinner /></div>;
  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-2 text-text-secondary">
        <Icon icon={SquareLock02Icon} size={18} />
        <p className="text-sm">Locked periods can't be edited by anyone. Only the owner can unlock, and every unlock is recorded.</p>
      </div>
      <BooksLockSection />
      <GstMonthsSection />
      <YearCloseSection />
    </div>
  );
}
