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
  UserGroupIcon,
  UserShield01Icon,
} from "@hugeicons/core-free-icons";
import {
  formatPlanPrice,
  partnerBadges,
  partnerTypeInfo,
  planSettingsSchema,
  type PartnerType,
  type PlanSettings,
  type StoredPlanLimits,
} from "@fintranzact/shared";
import type { RouterOutputs } from "@fintranzact/api";
import { PartnerBadge } from "@/components/ui/PartnerBadge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { InputField, TextareaField } from "@/components/ui/FormField";
import { PillTabs } from "@/components/ui/Tabs";
import { trpc, setBusinessId } from "@/lib/trpc";
import { clearDesktopToken } from "@/lib/desktop-session";
import { toast } from "@/hooks/useToast";
import { Select } from "@/components/ui/Select";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { Logo } from "@/components/ui/Logo";
import { Icon } from "@/components/ui/Icon";
import { SlideOver } from "@/components/ui/SlideOver";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { Pagination } from "@/components/ui/Pagination";
import { Spinner } from "@/components/ui/Spinner";
import { PAGE_TITLE_CLASS } from "@/components/ui/PageHeader";

type View = "overview" | "organisations" | "plans" | "partners";
const VIEWS: View[] = ["overview", "organisations", "plans", "partners"];

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
  { view: "partners", label: "Partners", icon: UserGroupIcon },
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
      {view === "partners" ? <PartnersView /> : null}
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

type AdminPlan = RouterOutputs["platform"]["plans"][number];
type Partner = RouterOutputs["platform"]["partners"]["data"][number];

const LIMIT_FIELDS: { key: keyof StoredPlanLimits; label: string; unit?: string }[] = [
  { key: "maxBusinesses", label: "Businesses per organisation" },
  { key: "maxTeamMembers", label: "Team members" },
  { key: "maxOwnedOrgs", label: "Organisations an owner can create" },
  { key: "maxConcurrentSessions", label: "Signed-in devices per user" },
  { key: "maxApiKeys", label: "API keys" },
  { key: "recurringRunsPerMonth", label: "Recurring invoices per month" },
  { key: "auditRetentionDays", label: "Audit log kept for", unit: "days" },
];
const FEATURE_FLAGS: { key: "dataExport" | "onlineStore" | "pdfBranding"; label: string }[] = [
  { key: "dataExport", label: "Data export" },
  { key: "onlineStore", label: "Online store" },
  { key: "pdfBranding", label: "“Powered by Fintranzact” on PDFs" },
];

/** Every plan: what it costs, what it includes, and its limits. Each can be edited. */
function PlansView() {
  const { data: plans, isLoading } = trpc.platform.plans.useQuery();
  const [editing, setEditing] = useState<AdminPlan | null>(null);

  return (
    <>
      <div>
        <h1 className={PAGE_TITLE_CLASS}>Plans</h1>
        <p className="mt-1 max-w-2xl text-sm text-text-tertiary">
          Edit what each plan costs, what it includes and its limits. Changes show on the pricing page and apply to every
          organisation on the plan straight away. Owners can pick a plan themselves only when it is free and shown.
        </p>
      </div>

      {isLoading ? (
        <SkeletonRows count={4} height="h-24" />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(plans ?? []).map((plan) => (
            <div key={plan.id} className="flex flex-col rounded-2xl border border-border-light bg-surface-0 p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-lg font-bold text-text-primary">{plan.name}</p>
                  <p className="truncate text-sm text-text-tertiary">{plan.tagline || "—"}</p>
                </div>
                <span className="shrink-0 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700 dark:bg-brand-950 dark:text-brand-300">
                  {plan.orgCount} {plan.orgCount === 1 ? "org" : "orgs"}
                </span>
              </div>
              <p className="mt-4 font-display text-3xl font-extrabold tracking-tight text-text-primary">
                {formatPlanPrice(plan)}
                {plan.monthlyPriceInr ? <span className="text-sm font-semibold text-text-tertiary"> /month</span> : null}
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Chip tone={plan.visible ? "green" : "grey"}>{plan.visible ? "On pricing page" : "Hidden"}</Chip>
                {plan.highlight ? <Chip tone="blue">Recommended</Chip> : null}
                {plan.edited ? <Chip tone="amber">Edited</Chip> : null}
              </div>
              <dl className="mt-4 space-y-1.5 text-sm">
                <Limit label="Businesses" value={plan.limits.maxBusinesses} />
                <Limit label="Team members" value={plan.limits.maxTeamMembers} />
                <Limit label="API keys" value={plan.limits.maxApiKeys} />
                <Limit label="Online store" value={plan.limits.onlineStore} />
                <Limit label="Data export" value={plan.limits.dataExport} />
              </dl>
              <div className="mt-4 flex items-center justify-between border-t border-border-light pt-3">
                <p className="text-xs text-text-tertiary">
                  {plan.monthlyPriceInr === 0 && plan.visible ? "Owners can pick this themselves" : "Set up by a platform admin"}
                </p>
                <button type="button" className="btn-secondary" onClick={() => setEditing(plan)}>
                  Edit plan
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <PlanEditor plan={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function Chip({ tone, children }: { tone: "green" | "grey" | "blue" | "amber" | "red"; children: ReactNode }) {
  const tones = {
    green: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
    grey: "bg-surface-2 text-text-secondary",
    blue: "bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300",
    amber: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
    red: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
  };
  return <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", tones[tone])}>{children}</span>;
}

function Limit({ label, value }: { label: string; value: number | boolean | null }) {
  const shown = typeof value === "boolean" ? (value ? "Yes" : "No") : value === null || value === Infinity ? "Unlimited" : String(value);
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-text-tertiary">{label}</dt>
      <dd className="font-semibold text-text-primary">{shown}</dd>
    </div>
  );
}

/** Side panel for editing one plan. */
function PlanEditor({ plan, onClose }: { plan: AdminPlan | null; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState<PlanSettings | null>(null);
  const [featuresText, setFeaturesText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    if (!plan) return;
    setForm({
      name: plan.name,
      tagline: plan.tagline,
      monthlyPriceInr: plan.monthlyPriceInr,
      features: plan.features,
      highlight: plan.highlight,
      visible: plan.visible,
      limits: { ...plan.limits },
    });
    setFeaturesText(plan.features.join("\n"));
    setError(null);
  }, [plan]);

  const refresh = () => Promise.all([utils.platform.plans.invalidate(), utils.plan.list.invalidate(), utils.platform.overview.invalidate()]);
  const save = trpc.platform.savePlan.useMutation({
    onSuccess: async () => {
      toast.success("Plan saved", `${form?.name} is updated everywhere.`);
      await refresh();
      onClose();
    },
    onError: (err) => setError(err.message),
  });
  const reset = trpc.platform.resetPlan.useMutation({
    onSuccess: async (r) => {
      toast.success("Plan reset", `${r.name} is back to its original settings.`);
      setConfirmReset(false);
      await refresh();
      onClose();
    },
    onError: (err) => toast.error("Could not reset the plan", err.message),
  });

  if (!plan || !form) return <SlideOver open={false} onClose={onClose} title="" children={null} />;

  const set = <K extends keyof PlanSettings>(key: K, value: PlanSettings[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));
  const setLimit = (key: keyof StoredPlanLimits, value: number | boolean | null) =>
    setForm((f) => (f ? { ...f, limits: { ...f.limits, [key]: value } } : f));

  function handleSave() {
    if (!form || !plan) return;
    const settings = { ...form, features: featuresText.split("\n").map((l) => l.trim()).filter(Boolean) };
    const parsed = planSettingsSchema.safeParse(settings);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setError(`${issue?.path.join(" › ") || "Plan"}: ${issue?.message}`);
      return;
    }
    setError(null);
    save.mutate({ plan: plan.id, settings: parsed.data });
  }

  const priceOnRequest = form.monthlyPriceInr === null;

  return (
    <>
      <SlideOver
        open={!!plan}
        onClose={onClose}
        title={`Edit ${plan.name}`}
        description={`${plan.orgCount} ${plan.orgCount === 1 ? "organisation is" : "organisations are"} on this plan`}
        footer={
          <div className="flex w-full items-center gap-2">
            {plan.edited ? (
              <button type="button" className="btn-ghost" onClick={() => setConfirmReset(true)}>
                Reset to original
              </button>
            ) : null}
            <div className="flex-1" />
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="button" className="btn-primary" onClick={handleSave} disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save plan"}
            </button>
          </div>
        }
      >
        <div className="space-y-6">
          <section className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wide text-text-tertiary">Shown to customers</h3>
            <InputField label="Plan name" required value={form.name} onChange={(e) => set("name", e.target.value)} />
            <InputField label="Tagline" value={form.tagline} onChange={(e) => set("tagline", e.target.value)} placeholder="Best for growing teams" />
            <div>
              <InputField
                label="Monthly price (₹)"
                type="number"
                min={0}
                disabled={priceOnRequest}
                value={priceOnRequest ? "" : String(form.monthlyPriceInr)}
                onChange={(e) => set("monthlyPriceInr", e.target.value === "" ? 0 : Math.max(0, Math.round(Number(e.target.value))))}
                placeholder={priceOnRequest ? "Custom" : "0"}
              />
              <Check
                label="Price on request (shows “Custom”)"
                checked={priceOnRequest}
                onChange={(v) => set("monthlyPriceInr", v ? null : 0)}
              />
            </div>
            <TextareaField
              label="Features (one per line)"
              className="min-h-28"
              value={featuresText}
              onChange={(e) => setFeaturesText(e.target.value)}
            />
            <Check label="Show on the pricing page and sign-up plan picker" checked={form.visible} onChange={(v) => set("visible", v)} />
            <Check label="Mark as recommended" checked={form.highlight} onChange={(v) => set("highlight", v)} />
          </section>

          <section className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wide text-text-tertiary">Limits</h3>
            {LIMIT_FIELDS.map((field) => {
              const value = form.limits[field.key] as number | null;
              const unlimited = value === null;
              return (
                <div key={field.key} className="flex flex-wrap items-center gap-3 rounded-xl border border-border-light px-3 py-2.5">
                  <label htmlFor={`limit-${field.key}`} className="min-w-[170px] flex-1 text-sm text-text-primary">
                    {field.label}
                  </label>
                  <input
                    id={`limit-${field.key}`}
                    type="number"
                    min={0}
                    disabled={unlimited}
                    value={unlimited ? "" : String(value)}
                    placeholder="∞"
                    onChange={(e) => setLimit(field.key, e.target.value === "" ? 0 : Math.max(0, Math.round(Number(e.target.value))))}
                    className="h-9 w-24 rounded-lg border border-border-light bg-surface-0 px-2 text-right text-sm tabular-nums text-text-primary disabled:bg-surface-2"
                  />
                  {field.unit ? <span className="text-xs text-text-tertiary">{field.unit}</span> : null}
                  <label className="flex items-center gap-1.5 text-xs text-text-secondary">
                    <input
                      type="checkbox"
                      checked={unlimited}
                      onChange={(e) => setLimit(field.key, e.target.checked ? null : field.key === "maxConcurrentSessions" ? 1 : 0)}
                      className="h-4 w-4 accent-brand-600"
                    />
                    Unlimited
                  </label>
                </div>
              );
            })}
            <div className="space-y-1 rounded-xl border border-border-light px-3 py-2">
              {FEATURE_FLAGS.map((flag) => (
                <Check key={flag.key} label={flag.label} checked={form.limits[flag.key] as boolean} onChange={(v) => setLimit(flag.key, v)} />
              ))}
            </div>
          </section>

          {error ? (
            <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
              {error}
            </p>
          ) : null}
        </div>
      </SlideOver>
      <ConfirmDialog
        open={confirmReset}
        title={`Reset ${plan.name}?`}
        description="Its name, price, features and limits go back to the original settings. Organisations stay on the plan."
        confirmLabel="Reset plan"
        loading={reset.isPending}
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => reset.mutate({ plan: plan.id })}
      />
    </>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2.5 py-1.5 text-sm text-text-secondary">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-brand-600" />
      {label}
    </label>
  );
}

// ── Partners ─────────────────────────────────────────────────────────────

const PARTNER_STATUS_TONE: Record<string, "amber" | "green" | "red"> = { pending: "amber", approved: "green", rejected: "red" };
const PARTNER_STATUS_LABEL: Record<string, string> = { pending: "Pending", approved: "Approved", rejected: "Rejected" };

/** Partner applications from the public "Become a partner" form. */
function PartnersView() {
  const [status, setStatus] = useState<"pending" | "approved" | "rejected" | "all">("pending");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Partner | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading } = trpc.platform.partners.useQuery(
    { status: status === "all" ? undefined : status, search: debounced || undefined, page, limit: PAGE_SIZE },
    { placeholderData: keepPreviousData },
  );
  const counts = data?.counts;

  return (
    <>
      <div>
        <h1 className={PAGE_TITLE_CLASS}>Partners</h1>
        <p className="mt-1 max-w-2xl text-sm text-text-tertiary">
          Applications from the “Become a partner” page. Approve a partner to add them to the programme; approved partners who agreed
          are listed in the public partner directory.
        </p>
      </div>

      <section className="overflow-hidden rounded-2xl border border-border-light bg-surface-0">
        <div className="flex flex-wrap items-center gap-3 border-b border-border-light px-4 py-3">
          <PillTabs
            size="sm"
            value={status}
            onChange={(v) => {
              setStatus(v as typeof status);
              setPage(1);
            }}
            tabs={[
              { value: "pending", label: "Pending", count: counts?.pending },
              { value: "approved", label: "Approved", count: counts?.approved },
              { value: "rejected", label: "Rejected", count: counts?.rejected },
              { value: "all", label: "All" },
            ]}
          />
          <div className="flex-1" />
          <label className="flex h-10 w-full items-center gap-2 rounded-xl border border-border-light bg-surface-0 px-3 sm:w-72">
            <Icon icon={Search01Icon} size={16} className="text-text-tertiary" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search company, name, email or city"
              aria-label="Search partners"
              className="w-full bg-transparent text-sm text-text-primary outline-none placeholder:text-text-tertiary"
            />
          </label>
        </div>

        {isLoading ? (
          <div className="p-4"><SkeletonRows count={5} height="h-12" /></div>
        ) : !data?.data.length ? (
          <div className="flex flex-col items-center gap-2 px-4 py-14 text-center">
            <Icon icon={UserGroupIcon} size={26} className="text-text-tertiary" />
            <p className="text-sm font-semibold text-text-primary">No partners here yet</p>
            <p className="text-sm text-text-tertiary">
              {debounced ? `Nothing matches "${debounced}".` : "Applications from the Become a partner page show up here."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Contact</th>
                  <th>Programme</th>
                  <th>City</th>
                  <th>Status</th>
                  <th>Badge</th>
                  <th className="text-right">Referrals</th>
                  <th>Applied</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((p) => (
                  <tr key={p.id} className="cursor-pointer" onClick={() => setSelected(p)}>
                    <td>
                      <button type="button" className="text-left font-semibold text-text-primary hover:text-brand-600" onClick={() => setSelected(p)}>
                        {p.companyName}
                      </button>
                    </td>
                    <td>
                      <p className="text-text-primary">{p.contactName}</p>
                      <p className="text-xs text-text-tertiary">{p.email}</p>
                    </td>
                    <td>{partnerTypeInfo[p.partnerType as PartnerType]?.label ?? p.partnerType}</td>
                    <td className="text-text-secondary">{p.city}</td>
                    <td><Chip tone={PARTNER_STATUS_TONE[p.status] ?? "grey"}>{PARTNER_STATUS_LABEL[p.status] ?? p.status}</Chip></td>
                    <td>{p.status === "approved" ? <PartnerBadge badge={p.badge} /> : <span className="text-text-tertiary">—</span>}</td>
                    <td className="text-right tabular-nums">
                      {p.referred}
                      {p.paidReferrals ? <span className="text-text-tertiary"> · {p.paidReferrals} paid</span> : null}
                    </td>
                    <td className="text-text-secondary">{formatDate(p.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && data.total > PAGE_SIZE ? (
          <div className="border-t border-border-light px-4 py-3">
            <Pagination page={page} total={data.total} pageSize={PAGE_SIZE} totalPages={Math.ceil(data.total / PAGE_SIZE)} onPageChange={setPage} />
          </div>
        ) : null}
      </section>

      <PartnerPanel id={selected?.id ?? null} onClose={() => setSelected(null)} />
    </>
  );
}

/** One partner: the application, their referral code, badge, referrals, commission and payouts. */
function PartnerPanel({ id, onClose }: { id: string | null; onClose: () => void }) {
  const utils = trpc.useUtils();
  const { data: partner, isLoading } = trpc.platform.partner.useQuery({ id: id! }, { enabled: !!id });
  const [notes, setNotes] = useState("");
  const [type, setType] = useState<PartnerType>("accountant");
  const [listed, setListed] = useState(false);
  const [commission, setCommission] = useState("");

  useEffect(() => {
    if (!partner) return;
    setNotes(partner.adminNotes ?? "");
    setType(partner.partnerType as PartnerType);
    setListed(partner.listPublicly);
    setCommission(partner.commissionPercent === null ? "" : String(partner.commissionPercent));
  }, [partner]);

  const refresh = () => Promise.all([utils.platform.partners.invalidate(), utils.platform.partner.invalidate()]);
  const update = trpc.platform.updatePartner.useMutation({
    onSuccess: async (row, vars) => {
      if (vars.status === "approved" && row.referralCode) {
        toast.success(
          "Partner approved",
          row.emailed
            ? `We emailed ${row.companyName} their referral code ${row.referralCode}.`
            : `Referral code ${row.referralCode}. Share it with them; it is shown in this panel.`,
        );
      } else {
        toast.success(vars.status === "rejected" ? "Application rejected" : "Partner saved", row.companyName);
      }
      await refresh();
      if (vars.status !== "approved") onClose();
    },
    onError: (err) => toast.error("Could not update the partner", err.message),
  });

  if (!id) return <SlideOver open={false} onClose={onClose} title="" children={null} />;

  const commissionValue = commission.trim() === "" ? null : Math.min(100, Math.max(0, Math.round(Number(commission))));
  const changes = partner
    ? { id: partner.id, adminNotes: notes, partnerType: type, listPublicly: listed, commissionPercent: commissionValue }
    : null;
  const website = partner?.website ? (partner.website.startsWith("http") ? partner.website : `https://${partner.website}`) : null;
  const stats = partner?.stats;

  return (
    <SlideOver
      open={!!id}
      onClose={onClose}
      title={partner?.companyName ?? "Partner"}
      description={
        partner
          ? `Applied ${formatDate(partner.createdAt)}${partner.reviewedAt ? ` · reviewed ${formatDate(partner.reviewedAt)}` : ""}`
          : undefined
      }
      footer={
        partner && changes ? (
          <div className="flex w-full flex-wrap items-center gap-2">
            <button type="button" className="btn-secondary" disabled={update.isPending} onClick={() => update.mutate(changes)}>
              Save
            </button>
            <div className="flex-1" />
            {partner.status !== "rejected" ? (
              <button type="button" className="btn-ghost text-red-600" disabled={update.isPending} onClick={() => update.mutate({ ...changes, status: "rejected" })}>
                Reject
              </button>
            ) : null}
            {partner.status !== "approved" ? (
              <button type="button" className="btn-primary" disabled={update.isPending} onClick={() => update.mutate({ ...changes, status: "approved" })}>
                Approve
              </button>
            ) : null}
          </div>
        ) : undefined
      }
    >
      {isLoading || !partner || !stats ? (
        <SkeletonRows count={6} height="h-10" />
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={PARTNER_STATUS_TONE[partner.status] ?? "grey"}>{PARTNER_STATUS_LABEL[partner.status] ?? partner.status}</Chip>
            {partner.status === "approved" ? <PartnerBadge badge={stats.badge} /> : null}
          </div>

          {partner.status === "approved" && partner.referralCode ? (
            <ReferralCodeBox code={partner.referralCode} />
          ) : partner.status === "pending" ? (
            <p className="rounded-2xl bg-surface-1 px-4 py-3 text-sm text-text-secondary">
              Approve this partner to give them a referral code. Organisations that sign up with it count towards their badge and commission.
            </p>
          ) : null}

          {partner.status === "approved" ? (
            <>
              <section className="space-y-2">
                <h3 className="text-xs font-bold uppercase tracking-wide text-text-tertiary">Referrals & commission</h3>
                <div className="grid grid-cols-2 gap-2">
                  <Stat label="Organisations referred" value={String(stats.referred)} />
                  <Stat label="On a paid plan" value={String(stats.paidReferrals)} />
                  <Stat label="Monthly plan value" value={formatCurrency(stats.monthlyValue)} />
                  <Stat label={`Commission (${stats.commissionPercent}%) / month`} value={formatCurrency(stats.monthlyCommission)} />
                  <Stat label="Paid out" value={formatCurrency(stats.paidOut)} />
                  <Stat label="Waiting to be paid" value={formatCurrency(stats.pendingPayout)} />
                </div>
                {stats.next ? (
                  <p className="text-xs text-text-tertiary">
                    {stats.next.needed} more paid {stats.next.needed === 1 ? "referral" : "referrals"} to reach{" "}
                    {partnerBadges.find((b) => b.id === stats.next!.badge)?.label}.
                  </p>
                ) : (
                  <p className="text-xs text-text-tertiary">Top badge reached.</p>
                )}
                {stats.customPriced ? (
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    {stats.customPriced} referred {stats.customPriced === 1 ? "organisation is" : "organisations are"} on a plan priced on
                    request, which is not in the monthly value. Add its commission to the payout yourself.
                  </p>
                ) : null}
              </section>

              <section className="space-y-2">
                <h3 className="text-xs font-bold uppercase tracking-wide text-text-tertiary">Referred organisations · {partner.referred.length}</h3>
                {partner.referred.length === 0 ? (
                  <p className="text-sm text-text-tertiary">Nobody has signed up with this code yet.</p>
                ) : (
                  <div className="divide-y divide-border-light overflow-hidden rounded-2xl border border-border-light">
                    {partner.referred.map((t) => (
                      <div key={t.id} className="flex items-center gap-3 px-4 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-text-primary">{t.name}</p>
                          <p className="text-xs text-text-tertiary">Joined {formatDate(t.createdAt)}{t.status !== "active" ? ` · ${t.status}` : ""}</p>
                        </div>
                        <Chip tone={t.monthlyPriceInr === 0 ? "grey" : "green"}>{t.planName}</Chip>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <PayoutsSection partnerId={partner.id} payouts={partner.payouts} suggested={stats.monthlyCommission} />
            </>
          ) : null}

          <dl className="divide-y divide-border-light overflow-hidden rounded-2xl border border-border-light text-sm">
            {[
              ["Contact", partner.contactName],
              ["Email", <a key="e" href={`mailto:${partner.email}`} className="text-brand-600 hover:underline">{partner.email}</a>],
              ["Phone", <a key="p" href={`tel:${partner.phone}`} className="text-brand-600 hover:underline">{partner.phone}</a>],
              ["Location", [partner.city, partner.state].filter(Boolean).join(", ")],
              ["Website", website ? <a key="w" href={website} target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline">{partner.website}</a> : "—"],
              ["Clients", partner.clientCount ?? "—"],
            ].map(([label, value]) => (
              <div key={label as string} className="flex gap-3 px-4 py-2.5">
                <dt className="w-24 shrink-0 text-text-tertiary">{label}</dt>
                <dd className="min-w-0 break-words text-text-primary">{value}</dd>
              </div>
            ))}
          </dl>
          {partner.message ? (
            <section className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wide text-text-tertiary">About their work</h3>
              <p className="whitespace-pre-line rounded-2xl bg-surface-1 px-4 py-3 text-sm text-text-secondary">{partner.message}</p>
            </section>
          ) : null}
          <section className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wide text-text-tertiary">Your review</h3>
            <Select value={type} onChange={(e) => setType(e.target.value as PartnerType)} aria-label="Programme">
              {Object.entries(partnerTypeInfo).map(([key, info]) => (
                <option key={key} value={key}>{info.label}</option>
              ))}
            </Select>
            <InputField
              label="Commission % (leave empty to use the badge's rate)"
              type="number"
              min={0}
              max={100}
              value={commission}
              onChange={(e) => setCommission(e.target.value)}
              placeholder={`${partnerBadges.find((b) => b.id === stats.badge)?.commissionPercent ?? 10}`}
            />
            <Check label="List in the public partner directory" checked={listed} onChange={setListed} />
            <TextareaField label="Notes (only admins see these)" className="min-h-24" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </section>
        </div>
      )}
    </SlideOver>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border-light px-3 py-2.5">
      <p className="text-xs text-text-tertiary">{label}</p>
      <p className="mt-0.5 font-display text-lg font-extrabold tabular-nums text-text-primary">{value}</p>
    </div>
  );
}

/** The partner's referral code and sign-up link, ready to copy. */
function ReferralCodeBox({ code }: { code: string }) {
  const link = `${window.location.origin}/register?ref=${code}`;
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copied`);
    } catch {
      toast.error("Could not copy", text);
    }
  };
  return (
    <div className="rounded-2xl border border-brand-100 bg-brand-50 p-4 dark:border-brand-900 dark:bg-brand-950">
      <p className="text-xs font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">Referral code</p>
      <div className="mt-1 flex items-center gap-2">
        <span className="font-mono text-xl font-bold tracking-wider text-text-primary">{code}</span>
        <button type="button" className="btn-ghost text-xs" onClick={() => copy(code, "Code")}>Copy</button>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs text-text-secondary">{link}</span>
        <button type="button" className="btn-ghost shrink-0 text-xs" onClick={() => copy(link, "Sign-up link")}>Copy link</button>
      </div>
    </div>
  );
}

type Payout = RouterOutputs["platform"]["partner"]["payouts"][number];

function currentPeriod() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Payouts: record what a partner is owed for a month, then mark it paid. */
function PayoutsSection({ partnerId, payouts, suggested }: { partnerId: string; payouts: Payout[]; suggested: string }) {
  const utils = trpc.useUtils();
  const [period, setPeriod] = useState(currentPeriod());
  const [amount, setAmount] = useState(suggested === "0.00" ? "" : suggested);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [reference, setReference] = useState("");
  const refresh = () => Promise.all([utils.platform.partner.invalidate(), utils.platform.partners.invalidate()]);

  const record = trpc.platform.recordPayout.useMutation({
    onSuccess: async (p) => {
      toast.success("Payout recorded", `${formatCurrency(p.amount)} for ${p.period}`);
      await refresh();
    },
    onError: (err) => toast.error("Could not record the payout", err.message),
  });
  const updatePayout = trpc.platform.updatePayout.useMutation({
    onSuccess: async (p) => {
      toast.success(p.status === "paid" ? "Marked as paid" : "Marked as pending", `${formatCurrency(p.amount)} for ${p.period}`);
      setPayingId(null);
      setReference("");
      await refresh();
    },
    onError: (err) => toast.error("Could not update the payout", err.message),
  });
  const remove = trpc.platform.deletePayout.useMutation({
    onSuccess: refresh,
    onError: (err) => toast.error("Could not remove the payout", err.message),
  });

  return (
    <section className="space-y-2">
      <h3 className="text-xs font-bold uppercase tracking-wide text-text-tertiary">Payouts</h3>
      <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-border-light p-3">
        <label className="flex flex-col gap-1 text-xs text-text-tertiary">
          Month
          <input
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="h-9 rounded-lg border border-border-light bg-surface-0 px-2 text-sm text-text-primary"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-text-tertiary">
          Amount (₹)
          <input
            type="number"
            min={0}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="h-9 w-32 rounded-lg border border-border-light bg-surface-0 px-2 text-right text-sm tabular-nums text-text-primary"
          />
        </label>
        <button
          type="button"
          className="btn-secondary h-9"
          disabled={!period || !amount || record.isPending}
          onClick={() => record.mutate({ partnerId, period, amount: Number(amount).toFixed(2) })}
        >
          Record payout
        </button>
      </div>
      {payouts.length === 0 ? (
        <p className="text-sm text-text-tertiary">No payouts yet.</p>
      ) : (
        <div className="divide-y divide-border-light overflow-hidden rounded-2xl border border-border-light">
          {payouts.map((p) => (
            <div key={p.id} className="px-4 py-2.5">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold tabular-nums text-text-primary">
                    {formatCurrency(p.amount)} <span className="font-normal text-text-tertiary">· {p.period}</span>
                  </p>
                  <p className="truncate text-xs text-text-tertiary">
                    {p.status === "paid" ? `Paid ${p.paidAt ? formatDate(p.paidAt) : ""}${p.reference ? ` · ${p.reference}` : ""}` : "Not paid yet"}
                  </p>
                </div>
                <Chip tone={p.status === "paid" ? "green" : "amber"}>{p.status === "paid" ? "Paid" : "Pending"}</Chip>
                {p.status === "pending" ? (
                  <>
                    <button type="button" className="btn-ghost text-xs" onClick={() => setPayingId(p.id)}>Mark paid</button>
                    <button type="button" className="btn-ghost text-xs text-red-600" onClick={() => remove.mutate({ id: p.id })}>Remove</button>
                  </>
                ) : null}
              </div>
              {payingId === p.id ? (
                <div className="mt-2 flex gap-2">
                  <input
                    autoFocus
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder="Bank or UPI reference"
                    aria-label="Payment reference"
                    className="h-9 flex-1 rounded-lg border border-border-light bg-surface-0 px-2 text-sm text-text-primary"
                  />
                  <button
                    type="button"
                    className="btn-primary h-9"
                    disabled={updatePayout.isPending}
                    onClick={() => updatePayout.mutate({ id: p.id, status: "paid", reference })}
                  >
                    Paid
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
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

          {detail.referredBy ? (
            <p className="rounded-xl bg-brand-50 px-3 py-2 text-sm text-brand-700 dark:bg-brand-950 dark:text-brand-300">
              Referred by <strong>{detail.referredBy.companyName}</strong>
              {detail.referredBy.referralCode ? <span className="font-mono"> · {detail.referredBy.referralCode}</span> : null}
            </p>
          ) : null}

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
