/**
 * Government filing usage (inside Settings → Billing, owner only): documents
 * successfully filed through the government portals, charged per document
 * after the month ends, plus the statements already raised for past months.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatCurrency } from "@/lib/utils";
import { Select } from "@/components/ui/Select";

const rupees = (paise: number) => formatCurrency(paise / 100);

/** "2026-09" -> "September 2026". */
export function formatPeriod(period: string): string {
  const [y, m] = period.split("-").map(Number);
  if (!y || !m) return period;
  return new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
}

export function GovUsageSection() {
  const [period, setPeriod] = useState<string | undefined>(undefined);
  const { data, isLoading } = trpc.govUsage.summary.useQuery(period ? { period } : undefined);
  const { data: statements } = trpc.govUsage.statements.useQuery();

  if (isLoading || !data) {
    return <div className="skeleton h-48 rounded-xl" />;
  }

  const { summary, periods } = data;
  // The current month may have no documents yet, so it is not in `periods`.
  const options = periods.includes(summary.period) ? periods : [summary.period, ...periods];

  return (
    <>
      <section className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">Government filing usage</h3>
            <p className="mt-1 text-xs text-text-tertiary">
              Billed after month end, no advance. Only successfully filed documents are charged.
            </p>
          </div>
          <Select
            aria-label="Usage month"
            value={summary.period}
            onChange={(e) => setPeriod(e.target.value)}
            className="w-44"
          >
            {options.map((p) => (
              <option key={p} value={p}>{formatPeriod(p)}</option>
            ))}
          </Select>
        </div>

        {summary.lines.length === 0 ? (
          <p className="mt-4 rounded-xl bg-surface-1 px-4 py-6 text-center text-sm text-text-tertiary">
            No documents filed in {formatPeriod(summary.period)}.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-text-tertiary">
                  <th className="py-2.5 pr-4">Document</th>
                  <th className="px-4 py-2.5 text-right">Count</th>
                  <th className="px-4 py-2.5 text-right">Rate</th>
                  <th className="py-2.5 pl-4 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-light">
                {summary.lines.map((l) => (
                  <tr key={l.kind}>
                    <td className="py-3 pr-4 text-text-primary">{l.label}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-text-secondary">{l.count}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-text-secondary">{rupees(l.ratePaise)}</td>
                    <td className="py-3 pl-4 text-right tabular-nums text-text-primary">{rupees(l.amountPaise)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="text-sm">
                <tr className="border-t border-border-light">
                  <td className="py-2.5 pr-4 text-text-secondary" colSpan={3}>Subtotal ({summary.documents} documents)</td>
                  <td className="py-2.5 pl-4 text-right tabular-nums text-text-primary">{rupees(summary.basePaise)}</td>
                </tr>
                <tr>
                  <td className="py-2.5 pr-4 text-text-secondary" colSpan={3}>GST</td>
                  <td className="py-2.5 pl-4 text-right tabular-nums text-text-primary">{rupees(summary.gstPaise)}</td>
                </tr>
                <tr className="font-semibold">
                  <td className="py-2.5 pr-4 text-text-primary" colSpan={3}>
                    Total{summary.closed ? "" : " so far"}
                  </td>
                  <td className="py-2.5 pl-4 text-right tabular-nums text-text-primary">{rupees(summary.totalPaise)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      <section className="card overflow-hidden p-0">
        <h3 className="border-b border-border-light px-5 py-4 text-sm font-semibold text-text-primary">
          Government filing statements
        </h3>
        {!statements || statements.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-text-tertiary">No statements yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-text-tertiary">
                  <th className="px-5 py-2.5">Month</th>
                  <th className="px-5 py-2.5 text-right">Documents</th>
                  <th className="px-5 py-2.5 text-right">Total</th>
                  <th className="px-5 py-2.5">Billed</th>
                  <th className="px-5 py-2.5">Invoice</th>
                  <th className="px-5 py-2.5">Payment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-light">
                {statements.map((s) => (
                  <tr key={s.period}>
                    <td className="whitespace-nowrap px-5 py-3 font-medium text-text-primary">{formatPeriod(s.period)}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-text-secondary">{s.documents}</td>
                    <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums text-text-primary">{rupees(s.totalPaise)}</td>
                    <td className="px-5 py-3 text-text-secondary">{s.billed ? "Yes" : s.closed ? "Pending" : "Month in progress"}</td>
                    <td className="whitespace-nowrap px-5 py-3 text-text-secondary">{s.invoiceNumber ?? "—"}</td>
                    <td className="px-5 py-3">
                      {s.paymentStatus === "due" ? (
                        <span className="text-xs font-medium text-amber-600">Payment due</span>
                      ) : s.paymentStatus === "failed" ? (
                        <span className="text-xs font-medium text-red-600">Payment failed</span>
                      ) : s.paymentStatus ? (
                        <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">Paid</span>
                      ) : (
                        <span className="text-text-tertiary">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
