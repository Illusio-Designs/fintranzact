/**
 * Platform admin → Subscriptions: every organisation's plan and add-on
 * subscriptions, with MRR and the plan / add-on mix at the top.
 */
import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { cn, formatCurrency } from "@/lib/utils";
import { PAGE_TITLE_CLASS } from "@/components/ui/PageHeader";
import { PLAN_NAMES, SUBSCRIPTION_STATUSES, SUBSCRIPTION_STATUS_LABELS, addonById, type SubscriptionStatus } from "@fintranzact/shared";

const PAGE_SIZE = 25;

const PLAN_LABELS: Record<string, string> = PLAN_NAMES;

const STATUS_STYLES: Record<SubscriptionStatus, string> = {
  created: "bg-surface-2 text-text-secondary",
  active: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  past_due: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  halted: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
  cancelled: "bg-surface-2 text-text-tertiary",
};

const rupees = (paise: number) => formatCurrency(paise / 100);

function itemLabel(sub: { kind: string; plan: string | null; addon: string | null }): string {
  if (sub.kind === "plan") return `${PLAN_LABELS[sub.plan ?? ""] ?? sub.plan} plan`;
  return `${addonById(sub.addon ?? "")?.name ?? sub.addon} add-on`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso));
}

export function SubscriptionsView() {
  const [status, setStatus] = useState<SubscriptionStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  const { data: summary } = trpc.platform.billingSummary.useQuery();
  const { data, isLoading } = trpc.platform.subscriptions.useQuery({
    status: status === "all" ? undefined : status,
    search: debounced || undefined,
    page,
    limit: PAGE_SIZE,
  });

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const stats = [
    { label: "MRR", value: summary ? rupees(summary.mrrPaise) : undefined },
    { label: "Live subscriptions", value: summary?.liveCount },
    { label: "Payment failing", value: summary?.byStatus.find((s) => s.status === "past_due")?.count ?? 0 },
    { label: "Failed charges (30 days)", value: summary?.failedPayments30d },
  ];

  return (
    <>
      <div>
        <h1 className={PAGE_TITLE_CLASS}>Subscriptions</h1>
        <p className="mt-1 text-sm text-text-tertiary">
          What every organisation pays for — plan and add-on subscriptions, renewals and failed payments. Amounts are ex-GST.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-2xl border border-border-light bg-surface-0 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">{s.label}</p>
            <p className="mt-1.5 font-display text-2xl font-extrabold tabular-nums text-text-primary">{s.value ?? "—"}</p>
          </div>
        ))}
      </div>

      {summary && summary.mix.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-text-tertiary">Mix:</span>
          {summary.mix.map((m) => (
            <span
              key={`${m.kind}:${m.label}`}
              className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700 dark:bg-brand-950 dark:text-brand-300"
            >
              {m.kind === "plan" ? (PLAN_LABELS[m.label] ?? m.label) : (addonById(m.label)?.name ?? m.label)} · {m.count} · {rupees(m.mrrPaise)}/mo
            </span>
          ))}
        </div>
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-border-light bg-surface-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-border-light px-4 py-3">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search organisations…"
            className="input h-9 w-full max-w-xs text-sm"
          />
          <div className="flex-1" />
          <div className="flex flex-wrap gap-1">
            {(["all", ...SUBSCRIPTION_STATUSES] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setStatus(s as SubscriptionStatus | "all");
                  setPage(1);
                }}
                className={cn(
                  "rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors",
                  status === s ? "bg-brand-600 text-white" : "text-text-secondary hover:bg-surface-2",
                )}
              >
                {s === "all" ? "All" : SUBSCRIPTION_STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="skeleton h-10 rounded-lg" />
            ))}
          </div>
        ) : !data?.subscriptions.length ? (
          <p className="px-4 py-10 text-center text-sm text-text-tertiary">
            {debounced || status !== "all" ? "No subscriptions match." : "No subscriptions yet — nobody has bought a plan or add-on."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-light text-left text-xs font-semibold uppercase tracking-wide text-text-tertiary">
                  <th className="px-4 py-2.5">Organisation</th>
                  <th className="px-4 py-2.5">Subscription</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5 text-right">Price</th>
                  <th className="px-4 py-2.5">Next renewal</th>
                  <th className="px-4 py-2.5 text-right">Failed (30d)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-light">
                {data.subscriptions.map((sub) => (
                  <tr key={sub.id} className="hover:bg-surface-1">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-text-primary">{sub.tenantName}</p>
                      <p className="text-xs text-text-tertiary">via {sub.provider}</p>
                    </td>
                    <td className="px-4 py-3 text-text-secondary">
                      {itemLabel(sub)}
                      <span className="text-text-tertiary"> · {sub.cycle}</span>
                      {sub.cancelAtPeriodEnd ? <p className="text-xs text-amber-600">Cancels at period end</p> : null}
                      {sub.scheduledPlan ? (
                        <p className="text-xs text-text-tertiary">Moves to {PLAN_LABELS[sub.scheduledPlan] ?? sub.scheduledPlan} at period end</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-semibold", STATUS_STYLES[sub.status as SubscriptionStatus])}>
                        {SUBSCRIPTION_STATUS_LABELS[sub.status as SubscriptionStatus] ?? sub.status}
                      </span>
                      {sub.status === "past_due" && sub.graceUntil ? (
                        <p className="mt-1 text-xs text-amber-600">Grace till {formatDate(sub.graceUntil)}</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-text-primary">
                      {rupees(sub.basePaise)}
                      <span className="text-xs text-text-tertiary">/{sub.cycle === "yearly" ? "yr" : "mo"}</span>
                    </td>
                    <td className="px-4 py-3 text-text-secondary">{formatDate(sub.currentPeriodEnd)}</td>
                    <td className={cn("px-4 py-3 text-right tabular-nums", sub.failedPayments30d > 0 ? "font-semibold text-red-600" : "text-text-tertiary")}>
                      {sub.failedPayments30d || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && pages > 1 ? (
          <div className="flex items-center justify-between border-t border-border-light px-4 py-3 text-sm">
            <button type="button" className="btn-ghost text-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </button>
            <span className="text-text-tertiary">
              Page {page} of {pages}
            </span>
            <button type="button" className="btn-ghost text-sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
              Next
            </button>
          </div>
        ) : null}
      </section>
    </>
  );
}
