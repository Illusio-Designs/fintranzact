import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import { ArrowLeft01Icon, Building03Icon, Search01Icon, UserShield01Icon } from "@hugeicons/core-free-icons";
import { trpc } from "@/lib/trpc";
import { formatDate, cn } from "@/lib/utils";
import { Logo } from "@/components/ui/Logo";
import { Icon } from "@/components/ui/Icon";
import { SlideOver } from "@/components/ui/SlideOver";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { Pagination } from "@/components/ui/Pagination";
import { Spinner } from "@/components/ui/Spinner";
import { PAGE_TITLE_CLASS } from "@/components/ui/PageHeader";

export const Route = createFileRoute("/platform")({
  component: PlatformAdminPage,
});

const PAGE_SIZE = 25;

const PLAN_LABELS: Record<string, string> = {
  forever_free: "Forever free",
  free: "Free",
  pro: "Pro",
  business: "Business",
  enterprise: "Enterprise",
};

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  superadmin: "Owner",
  admin: "Admin",
  member: "Seller",
  seller: "Seller",
  seller_manager: "Seller manager",
  viewer: "Accountant",
  accountant: "Accountant",
};

function StatusPill({ status }: { status: string }) {
  const active = status === "active";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold",
        active ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-emerald-500" : "bg-amber-500")} />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function PlatformAdminPage() {
  const { data: me, isLoading: meLoading } = trpc.platform.me.useQuery();
  const { data: session } = trpc.auth.me.useQuery();
  const isAdmin = !!me?.isPlatformAdmin;

  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  const { data: overview } = trpc.platform.overview.useQuery(undefined, { enabled: isAdmin });
  const { data: list, isLoading: listLoading } = trpc.platform.tenants.useQuery(
    { search: debounced || undefined, page, limit: PAGE_SIZE },
    { enabled: isAdmin, placeholderData: keepPreviousData },
  );
  const { data: detail, isLoading: detailLoading } = trpc.platform.tenant.useQuery(
    { id: selectedId! },
    { enabled: isAdmin && !!selectedId },
  );

  if (meLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-0">
        <Spinner size="md" className="text-brand-600" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-0 px-4">
        <div className="flex max-w-sm flex-col items-center gap-3 text-center">
          <Logo className="h-10 w-10" />
          <p className="text-base font-semibold text-text-primary">Platform admin access only</p>
          <p className="text-sm text-text-tertiary">
            This page is for Fintranzact operators. Sign in with a platform admin account to open it.
          </p>
          <Link to="/" className="btn-primary mt-2">Back to the app</Link>
        </div>
      </div>
    );
  }

  const paidPlans = (overview?.byPlan ?? [])
    .filter((p) => p.plan !== "free" && p.plan !== "forever_free")
    .reduce((sum, p) => sum + p.count, 0);
  const suspended = (overview?.byStatus ?? [])
    .filter((s) => s.status !== "active")
    .reduce((sum, s) => sum + s.count, 0);

  const stats = [
    { label: "Organisations", value: overview?.tenants },
    { label: "Users", value: overview?.users },
    { label: "New in last 30 days", value: overview?.tenantsLast30Days },
    { label: "On a paid plan", value: overview ? paidPlans : undefined },
  ];

  return (
    <div className="min-h-screen bg-surface-1">
      {/* Top bar */}
      <header className="bg-[#0f1b3d] text-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Logo className="h-8 w-8" variant="light" />
          <span className="font-display text-lg font-extrabold tracking-[-0.02em]">Fintranzact</span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold">
            <Icon icon={UserShield01Icon} size={14} />
            Platform admin
          </span>
          <div className="flex-1" />
          <span className="hidden truncate text-sm text-[#b3bfdd] sm:block">{session?.user?.email}</span>
          {session?.tenantId ? (
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 px-3 py-1.5 text-sm font-semibold hover:bg-white/10"
            >
              <Icon icon={ArrowLeft01Icon} size={14} />
              Back to app
            </Link>
          ) : null}
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
        <div>
          <h1 className={PAGE_TITLE_CLASS}>Platform overview</h1>
          <p className="mt-1 text-sm text-text-tertiary">
            Every organisation on this server. Read-only: business books (invoices, payments, stock) are not shown.
          </p>
        </div>

        {/* Headline numbers */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="rounded-2xl border border-border-light bg-surface-0 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">{s.label}</p>
              <p className="mt-1.5 font-display text-2xl font-extrabold tabular-nums text-text-primary">
                {s.value ?? "—"}
              </p>
            </div>
          ))}
        </div>

        {overview ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-text-tertiary">By plan:</span>
            {overview.byPlan.map((p) => (
              <span key={p.plan} className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700 dark:bg-brand-950 dark:text-brand-300">
                {PLAN_LABELS[p.plan] ?? p.plan} · {p.count}
              </span>
            ))}
            {suspended > 0 ? (
              <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                Not active · {suspended}
              </span>
            ) : null}
          </div>
        ) : null}

        {/* Organisations */}
        <section className="overflow-hidden rounded-2xl border border-border-light bg-surface-0">
          <div className="flex flex-wrap items-center gap-3 border-b border-border-light px-4 py-3">
            <h2 className="text-[15px] font-bold text-text-primary">Organisations</h2>
            <div className="flex-1" />
            <label className="flex h-10 w-full items-center gap-2 rounded-xl border border-border-light bg-surface-0 px-3 sm:w-80">
              <Icon icon={Search01Icon} size={16} className="text-text-tertiary" />
              <input
                id="platform-search"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search organisation, owner or email"
                className="w-full bg-transparent text-sm text-text-primary outline-none placeholder:text-text-tertiary"
              />
            </label>
          </div>

          {listLoading ? (
            <div className="p-4"><SkeletonRows count={6} height="h-12" /></div>
          ) : !list?.data.length ? (
            <div className="flex flex-col items-center gap-2 px-4 py-14 text-center">
              <Icon icon={Building03Icon} size={26} className="text-text-tertiary" />
              <p className="text-sm font-semibold text-text-primary">No organisations found</p>
              <p className="text-sm text-text-tertiary">{debounced ? `Nothing matches "${debounced}".` : "Nobody has signed up yet."}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Organisation</th>
                    <th>Owner</th>
                    <th>Plan</th>
                    <th>Status</th>
                    <th className="text-right">Members</th>
                    <th>Signed up</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.map((t) => (
                    <tr key={t.id} className="cursor-pointer" onClick={() => setSelectedId(t.id)}>
                      <td>
                        <button type="button" className="text-left font-semibold text-text-primary hover:text-brand-600" onClick={() => setSelectedId(t.id)}>
                          {t.name}
                        </button>
                        <p className="font-mono text-xs text-text-tertiary">{t.slug}</p>
                      </td>
                      <td>
                        {t.owner ? (
                          <>
                            <p className="text-text-primary">{t.owner.name ?? "—"}</p>
                            <p className="text-xs text-text-tertiary">{t.owner.email}</p>
                          </>
                        ) : (
                          <span className="text-text-tertiary">No owner</span>
                        )}
                      </td>
                      <td>{PLAN_LABELS[t.plan] ?? t.plan}</td>
                      <td><StatusPill status={t.status} /></td>
                      <td className="text-right tabular-nums">{t.memberCount}</td>
                      <td className="text-text-secondary">{formatDate(t.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {list && list.total > PAGE_SIZE ? (
            <div className="border-t border-border-light px-4 py-3">
              <Pagination
                page={page}
                total={list.total}
                pageSize={PAGE_SIZE}
                totalPages={Math.ceil(list.total / PAGE_SIZE)}
                onPageChange={setPage}
              />
            </div>
          ) : null}
        </section>
      </main>

      {/* One organisation */}
      <SlideOver
        open={!!selectedId}
        onClose={() => setSelectedId(null)}
        title={detail?.name ?? "Organisation"}
        description={detail ? `${PLAN_LABELS[detail.plan] ?? detail.plan} plan · signed up ${formatDate(detail.createdAt)}` : undefined}
      >
        {detailLoading || !detail ? (
          <SkeletonRows count={5} height="h-10" />
        ) : (
          <div className="space-y-6">
            <div className="flex items-center gap-2">
              <StatusPill status={detail.status} />
              <span className="font-mono text-xs text-text-tertiary">{detail.slug}</span>
            </div>

            <section className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wide text-text-tertiary">Members · {detail.members.length}</h3>
              <div className="divide-y divide-border-light overflow-hidden rounded-2xl border border-border-light">
                {detail.members.map((m) => (
                  <div key={m.userId} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-text-primary">{m.name ?? "—"}</p>
                      <p className="truncate text-xs text-text-tertiary">
                        {m.email}
                        {!m.emailVerified ? " · email not verified" : ""}
                      </p>
                    </div>
                    <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-text-secondary">
                      {ROLE_LABELS[m.role] ?? m.role}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wide text-text-tertiary">Businesses · {detail.businesses.length}</h3>
              {detail.businesses.length === 0 ? (
                <p className="text-sm text-text-tertiary">No business set up yet.</p>
              ) : (
                <div className="divide-y divide-border-light overflow-hidden rounded-2xl border border-border-light">
                  {detail.businesses.map((b) => (
                    <div key={b.id} className="px-4 py-3">
                      <p className="text-sm font-semibold text-text-primary">{b.name}</p>
                      <p className="text-xs text-text-tertiary">
                        {[b.gstin ? `GSTIN ${b.gstin}` : "No GSTIN", b.city, `created ${formatDate(b.createdAt)}`].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </SlideOver>
    </div>
  );
}
