import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import {
  ArrowLeft01Icon,
  Building03Icon,
  CreditCardIcon,
  DashboardSquare01Icon,
  Logout01Icon,
  Menu01Icon,
  Search01Icon,
  UserShield01Icon,
} from "@hugeicons/core-free-icons";
import { trpc, setBusinessId } from "@/lib/trpc";
import { clearDesktopToken } from "@/lib/desktop-session";
import { toast } from "@/hooks/useToast";
import { Select } from "@/components/ui/Select";
import { formatDate, cn } from "@/lib/utils";
import { Logo } from "@/components/ui/Logo";
import { Icon } from "@/components/ui/Icon";
import { SlideOver } from "@/components/ui/SlideOver";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { Pagination } from "@/components/ui/Pagination";
import { Spinner } from "@/components/ui/Spinner";
import { PAGE_TITLE_CLASS } from "@/components/ui/PageHeader";

type View = "overview" | "organisations" | "plans";
const VIEWS: View[] = ["overview", "organisations", "plans"];

export const Route = createFileRoute("/platform")({
  validateSearch: (search: Record<string, unknown>): { view?: View } => ({
    view: VIEWS.includes(search.view as View) ? (search.view as View) : undefined,
  }),
  component: PlatformAdminPage,
});

const NAV: { view: View; label: string; icon: typeof Building03Icon }[] = [
  { view: "overview", label: "Overview", icon: DashboardSquare01Icon },
  { view: "organisations", label: "Organisations", icon: Building03Icon },
  { view: "plans", label: "Plans", icon: CreditCardIcon },
];

const PLAN_ORDER = ["forever_free", "free", "pro", "business", "enterprise"] as const;
type PlanId = (typeof PLAN_ORDER)[number];

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
  const isAdmin = !!me?.isPlatformAdmin;
  const view = Route.useSearch().view ?? "overview";
  const [selectedId, setSelectedId] = useState<string | null>(null);

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

  return (
    <AdminShell view={view}>
      {view === "overview" ? <OverviewView onOpen={setSelectedId} /> : null}
      {view === "organisations" ? <OrganisationsView onOpen={setSelectedId} /> : null}
      {view === "plans" ? <PlansView /> : null}
      <OrganisationPanel id={selectedId} onClose={() => setSelectedId(null)} />
    </AdminShell>
  );
}

/** Navy side menu, like the main app's, with the admin sections. */
function AdminShell({ view, children }: { view: View; children: ReactNode }) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const { data: session } = trpc.auth.me.useQuery();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const logout = trpc.auth.logout.useMutation({
    onSuccess: async () => {
      await clearDesktopToken();
      sessionStorage.removeItem("selectedBusinessId");
      setBusinessId(null);
      utils.invalidate();
      navigate({ to: "/login" });
    },
  });
  const current = NAV.find((n) => n.view === view) ?? NAV[0];

  return (
    <div className="flex h-screen overflow-hidden bg-surface-1">
      {drawerOpen ? (
        <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
      ) : null}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-60 shrink-0 flex-col bg-[#0f1b3d] text-[#c3cee6] transition-transform duration-200 md:relative md:translate-x-0",
          drawerOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center gap-2.5 px-4 py-4">
          <Logo variant="light" className="h-8 w-8 shrink-0" />
          <span className="truncate font-display text-[17px] font-extrabold tracking-tight text-white">Fintranzact</span>
        </div>
        <div className="px-4 pb-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold text-white">
            <Icon icon={UserShield01Icon} size={14} />
            Platform admin
          </span>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-2" aria-label="Platform admin">
          {NAV.map((item) => (
            <Link
              key={item.view}
              to="/platform"
              search={{ view: item.view }}
              onClick={() => setDrawerOpen(false)}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors",
                item.view === view
                  ? "bg-brand-600 font-semibold text-white shadow-[0_4px_12px_-6px_rgba(59,94,170,.9)]"
                  : "text-[#c3cee6] hover:bg-white/[.07] hover:text-white",
              )}
              aria-current={item.view === view ? "page" : undefined}
            >
              <Icon icon={item.icon} size={18} />
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="space-y-1 border-t border-white/10 px-3 py-3">
          <p className="truncate px-3 pb-1 text-xs text-[#9fb0d6]" title={session?.user?.email}>{session?.user?.email}</p>
          {session?.tenantId ? (
            <Link to="/" className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-[#c3cee6] hover:bg-white/[.07] hover:text-white">
              <Icon icon={ArrowLeft01Icon} size={16} />
              Back to app
            </Link>
          ) : null}
          <button
            type="button"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-[#c3cee6] hover:bg-white/[.07] hover:text-white"
          >
            <Icon icon={Logout01Icon} size={16} />
            {logout.isPending ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border-light bg-surface-0 px-4 md:hidden">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="grid h-10 w-10 place-items-center rounded-xl text-text-secondary hover:bg-surface-2"
            aria-label="Open menu"
          >
            <Icon icon={Menu01Icon} size={20} />
          </button>
          <span className="font-semibold text-text-primary">{current.label}</span>
        </header>
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">{children}</div>
        </main>
      </div>
    </div>
  );
}

function useOverview() {
  return trpc.platform.overview.useQuery();
}

function OverviewView({ onOpen }: { onOpen: (id: string) => void }) {
  const { data: overview } = useOverview();
  const { data: newest, isLoading } = trpc.platform.tenants.useQuery({ page: 1, limit: 5 });

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
    <>
      <div>
        <h1 className={PAGE_TITLE_CLASS}>Platform overview</h1>
        <p className="mt-1 text-sm text-text-tertiary">
          Every organisation on this server. Business books (invoices, payments, stock) are never shown here.
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

      <section className="overflow-hidden rounded-2xl border border-border-light bg-surface-0">
        <div className="flex items-center gap-3 border-b border-border-light px-4 py-3">
          <h2 className="text-[15px] font-bold text-text-primary">Newest organisations</h2>
          <div className="flex-1" />
          <Link to="/platform" search={{ view: "organisations" }} className="text-sm font-semibold text-brand-600 hover:text-brand-700">
            See all
          </Link>
        </div>
        {isLoading ? (
          <div className="p-4"><SkeletonRows count={5} height="h-10" /></div>
        ) : !newest?.data.length ? (
          <p className="px-4 py-10 text-center text-sm text-text-tertiary">Nobody has signed up yet.</p>
        ) : (
          <div className="divide-y divide-border-light">
            {newest.data.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onOpen(t.id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-1"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-text-primary">{t.name}</p>
                  <p className="truncate text-xs text-text-tertiary">{t.owner?.email ?? "No owner"}</p>
                </div>
                <span className="hidden text-sm text-text-secondary sm:block">{PLAN_LABELS[t.plan] ?? t.plan}</span>
                <span className="w-28 text-right text-sm text-text-tertiary">{formatDate(t.createdAt)}</span>
              </button>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function OrganisationsView({ onOpen }: { onOpen: (id: string) => void }) {
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

  const { data: list, isLoading } = trpc.platform.tenants.useQuery(
    { search: debounced || undefined, page, limit: PAGE_SIZE },
    { placeholderData: keepPreviousData },
  );

  return (
    <>
      <div>
        <h1 className={PAGE_TITLE_CLASS}>Organisations</h1>
        <p className="mt-1 text-sm text-text-tertiary">Open one to see its members and businesses, or to change its plan.</p>
      </div>

      <section className="overflow-hidden rounded-2xl border border-border-light bg-surface-0">
        <div className="flex flex-wrap items-center gap-3 border-b border-border-light px-4 py-3">
          <h2 className="text-[15px] font-bold text-text-primary">
            {list ? `${list.total} ${list.total === 1 ? "organisation" : "organisations"}` : "Organisations"}
          </h2>
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

        {isLoading ? (
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
                  <tr key={t.id} className="cursor-pointer" onClick={() => onOpen(t.id)}>
                    <td>
                      <button type="button" className="text-left font-semibold text-text-primary hover:text-brand-600" onClick={() => onOpen(t.id)}>
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
    </>
  );
}

/** The plan catalogue, how many organisations are on each, and who sets them. */
function PlansView() {
  const { data: overview } = useOverview();
  const { data: catalogue } = trpc.plan.list.useQuery();
  const countFor = (plan: string) => overview?.byPlan.find((p) => p.plan === plan)?.count ?? 0;
  const listed = new Set((catalogue ?? []).map((p) => p.id));
  const others = PLAN_ORDER.filter((id) => !listed.has(id) && countFor(id) > 0);

  return (
    <>
      <div>
        <h1 className={PAGE_TITLE_CLASS}>Plans</h1>
        <p className="mt-1 max-w-2xl text-sm text-text-tertiary">
          Owners can choose a free plan themselves. Paid plans are set up by you: open an organisation and change its plan.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {(catalogue ?? []).map((plan) => (
          <div key={plan.id} className="flex flex-col rounded-2xl border border-border-light bg-surface-0 p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-lg font-bold text-text-primary">{plan.name}</p>
                <p className="text-sm text-text-tertiary">{plan.tagline}</p>
              </div>
              <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700 dark:bg-brand-950 dark:text-brand-300">
                {countFor(plan.id)} {countFor(plan.id) === 1 ? "org" : "orgs"}
              </span>
            </div>
            <p className="mt-4 font-display text-3xl font-extrabold tracking-tight text-text-primary">{plan.price}</p>
            <dl className="mt-4 space-y-1.5 text-sm">
              <Limit label="Businesses" value={plan.limits.maxBusinesses} />
              <Limit label="Team members" value={plan.limits.maxTeamMembers} />
              <Limit label="API keys" value={plan.limits.maxApiKeys} />
              <Limit label="Online store" value={plan.limits.onlineStore} />
              <Limit label="Data export" value={plan.limits.dataExport} />
            </dl>
            <p className="mt-4 border-t border-border-light pt-3 text-xs text-text-tertiary">
              {plan.id === "forever_free" || plan.id === "free" ? "Owners can pick this themselves" : "Set up by a platform admin"}
            </p>
          </div>
        ))}
      </div>

      {others.length ? (
        <p className="text-sm text-text-tertiary">
          Also in use: {others.map((id) => `${PLAN_LABELS[id]} · ${countFor(id)}`).join(", ")}
        </p>
      ) : null}
    </>
  );
}

function Limit({ label, value }: { label: string; value: number | boolean }) {
  const shown = typeof value === "boolean" ? (value ? "Yes" : "No") : value === Infinity ? "Unlimited" : String(value);
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-text-tertiary">{label}</dt>
      <dd className="font-semibold text-text-primary">{shown}</dd>
    </div>
  );
}

/** One organisation: plan, members and businesses. */
function OrganisationPanel({ id, onClose }: { id: string | null; onClose: () => void }) {
  const utils = trpc.useUtils();
  const { data: detail, isLoading } = trpc.platform.tenant.useQuery({ id: id! }, { enabled: !!id });
  const [plan, setPlan] = useState<PlanId | "">("");

  useEffect(() => {
    setPlan((detail?.plan as PlanId | undefined) ?? "");
  }, [detail?.id, detail?.plan]);

  const setPlanMutation = trpc.platform.setPlan.useMutation({
    onSuccess: async (row) => {
      toast.success("Plan updated", `${detail?.name ?? "Organisation"} is now on ${PLAN_LABELS[row.plan] ?? row.plan}.`);
      await Promise.all([utils.platform.tenant.invalidate(), utils.platform.tenants.invalidate(), utils.platform.overview.invalidate()]);
    },
    onError: (err) => toast.error("Could not change the plan", err.message),
  });

  return (
    <SlideOver
      open={!!id}
      onClose={onClose}
      title={detail?.name ?? "Organisation"}
      description={detail ? `${PLAN_LABELS[detail.plan] ?? detail.plan} plan · signed up ${formatDate(detail.createdAt)}` : undefined}
    >
      {isLoading || !detail ? (
        <SkeletonRows count={5} height="h-10" />
      ) : (
        <div className="space-y-6">
          <div className="flex items-center gap-2">
            <StatusPill status={detail.status} />
            <span className="font-mono text-xs text-text-tertiary">{detail.slug}</span>
          </div>

          <section className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-text-tertiary">Plan</h3>
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border-light p-3">
              <div className="min-w-[180px] flex-1">
                <Select value={plan} onChange={(e) => setPlan(e.target.value as PlanId)} aria-label="Plan">
                  {PLAN_ORDER.map((p) => (
                    <option key={p} value={p}>{PLAN_LABELS[p]}</option>
                  ))}
                </Select>
              </div>
              <button
                type="button"
                className="btn-primary"
                disabled={!plan || plan === detail.plan || setPlanMutation.isPending}
                onClick={() => plan && setPlanMutation.mutate({ tenantId: detail.id, plan })}
              >
                {setPlanMutation.isPending ? "Saving…" : "Save plan"}
              </button>
            </div>
            <p className="text-xs text-text-tertiary">The new plan's limits apply straight away.</p>
          </section>

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
  );
}
