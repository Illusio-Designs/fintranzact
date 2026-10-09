import { useState } from "react";
import { SELF_LOAN_STATUS_LABELS, formatPayrollMonth } from "@fintranzact/shared";
import { trpc } from "@/lib/trpc";
import { formatCurrency, formatDate } from "@/lib/utils";

const statusLabel = (s: string) => (SELF_LOAN_STATUS_LABELS as Record<string, string>)[s] ?? s;
const monthLabel = (m: string) => (/^\d{4}-\d{2}$/.test(m) ? formatPayrollMonth(m) : m);

/**
 * My loans and advances (read only): the status, the amount lent, what is still to be repaid, the instalment and the next one,
 * and a statement of what was paid to me and recovered. Shown only when I have one; HR manages loans, I can only look. The
 * server finds my loans from my login and refuses anyone else's id.
 */
export function MyLoans() {
  const loans = trpc.payrollSelf.loans.useQuery();
  const [open, setOpen] = useState<string | null>(null);
  const list = loans.data ?? [];
  if (loans.isLoading) return null;
  if (loans.error) {
    return (
      <section aria-label="My loans and advances">
        <h2 className="mb-2 text-base font-semibold text-text-primary">Loans and advances</h2>
        <p className="rounded-lg border border-border-light px-4 py-3 text-sm text-text-secondary">Could not load your loans. Please try again later.</p>
      </section>
    );
  }
  if (list.length === 0) return null;
  return (
    <section aria-label="My loans and advances">
      <h2 className="mb-2 text-base font-semibold text-text-primary">Loans and advances</h2>
      <ul className="space-y-3">
        {list.map((l) => (
          <li key={l.id} className="rounded-xl border border-border-light bg-surface-0 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-text-primary">{l.kind === "advance" ? "Advance" : "Loan"} {l.number}</p>
                <p className="text-xs text-text-tertiary">{statusLabel(l.status)}{l.purpose ? `, ${l.purpose}` : ""}</p>
              </div>
              <button className="btn-secondary btn-sm" onClick={() => setOpen(open === l.id ? null : l.id)} aria-expanded={open === l.id} aria-label={`${open === l.id ? "Hide" : "Show"} statement for ${l.number}`}>
                {open === l.id ? "Hide statement" : "Statement"}
              </button>
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
              <div><dt className="text-xs text-text-tertiary">Amount</dt><dd className="tabular-nums text-text-primary">{formatCurrency(l.principal)}</dd></div>
              <div><dt className="text-xs text-text-tertiary">Still to repay</dt><dd className="tabular-nums text-text-primary">{formatCurrency(l.outstanding)}</dd></div>
              <div><dt className="text-xs text-text-tertiary">Instalment (EMI)</dt><dd className="tabular-nums text-text-primary">{formatCurrency(l.emi)}</dd></div>
              <div><dt className="text-xs text-text-tertiary">Instalments left</dt><dd className="tabular-nums text-text-primary">{l.remainingInstalments}</dd></div>
            </dl>
            {l.nextInstalmentMonth && (
              <p className="mt-2 text-xs text-text-secondary" data-testid={`next-${l.number}`}>
                Next instalment: {formatCurrency(l.nextInstalmentAmount ?? "0")} from your {monthLabel(l.nextInstalmentMonth)} salary.
              </p>
            )}
            {l.status === "approved" && <p className="mt-2 text-xs text-text-secondary">This is approved and will start once it has been paid out to you.</p>}
            {open === l.id && <LoanStatement id={l.id} />}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-text-tertiary">Instalments are taken from your salary by payroll. For any change or a question, speak to HR.</p>
    </section>
  );
}

function LoanStatement({ id }: { id: string }) {
  const q = trpc.payrollSelf.loanStatement.useQuery({ id });
  if (q.isLoading) return <p className="mt-3 text-sm text-text-tertiary">Loading the statement...</p>;
  if (q.error || !q.data) return <p className="mt-3 text-sm text-text-secondary">Could not load this statement. Please try again later.</p>;
  const { schedule, events } = q.data;
  return (
    <div className="mt-3 space-y-3 border-t border-border-light pt-3" data-testid="loan-statement">
      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-tertiary">Repayment schedule</h3>
        {schedule.length === 0 ? (
          <p className="text-sm text-text-tertiary">No instalments are due.</p>
        ) : (
          <table className="w-full text-sm" aria-label="Repayment schedule">
            <thead>
              <tr className="text-left text-xs text-text-tertiary"><th className="py-1 font-medium">Month</th><th className="py-1 text-right font-medium">Principal</th><th className="py-1 text-right font-medium">Interest</th><th className="py-1 text-right font-medium">Recovered</th><th className="py-1 text-right font-medium">Status</th></tr>
            </thead>
            <tbody>
              {schedule.map((s) => (
                <tr key={s.seq}>
                  <td className="py-1 text-text-primary">{monthLabel(s.dueMonth)}</td>
                  <td className="py-1 text-right tabular-nums">{formatCurrency(s.principal)}</td>
                  <td className="py-1 text-right tabular-nums">{formatCurrency(s.interest)}</td>
                  <td className="py-1 text-right tabular-nums">{formatCurrency(s.recovered)}</td>
                  <td className="py-1 text-right capitalize text-text-secondary">{s.status === "open" ? "To come" : s.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-tertiary">What has happened</h3>
        {events.length === 0 ? (
          <p className="text-sm text-text-tertiary">Nothing yet.</p>
        ) : (
          <table className="w-full text-sm" aria-label="Loan statement">
            <thead>
              <tr className="text-left text-xs text-text-tertiary"><th className="py-1 font-medium">Date</th><th className="py-1 font-medium">What</th><th className="py-1 text-right font-medium">Principal</th><th className="py-1 text-right font-medium">Interest</th><th className="py-1 text-right font-medium">Balance</th></tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="py-1 text-text-primary">{formatDate(e.date)}</td>
                  <td className="py-1 text-text-secondary">{e.description}</td>
                  <td className="py-1 text-right tabular-nums">{Number(e.principal) ? formatCurrency(e.principal) : ""}</td>
                  <td className="py-1 text-right tabular-nums">{Number(e.interest) ? formatCurrency(e.interest) : ""}</td>
                  <td className="py-1 text-right tabular-nums">{formatCurrency(e.balanceAfter)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
