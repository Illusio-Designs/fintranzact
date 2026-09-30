import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { partnerBadges, partnerTypeInfo, type PartnerType } from "@fintranzact/shared";
import type { RouterOutputs } from "@fintranzact/api";
import { ArrowLeft01Icon, Award01Icon, Logout01Icon, UserShield01Icon } from "@hugeicons/core-free-icons";
import { Logo } from "@/components/ui/Logo";
import { Icon } from "@/components/ui/Icon";
import { Spinner } from "@/components/ui/Spinner";
import { PartnerBadge } from "@/components/ui/PartnerBadge";
import { trpc, setBusinessId } from "@/lib/trpc";
import { clearDesktopToken } from "@/lib/desktop-session";
import { formatCurrency, formatDate, cn } from "@/lib/utils";

export const Route = createFileRoute("/partner-portal")({
  component: PartnerPortalPage,
});

type Portal = RouterOutputs["partner"]["portal"];

const APPLICATION_TEXT: Record<string, { title: string; body: string; tone: string }> = {
  pending: {
    title: "Your application is being reviewed",
    body: "Our partner team usually replies within two business days. Once you're approved, your referral code and dashboard appear here.",
    tone: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  },
  approved: {
    title: "You're an approved partner",
    body: "Your dashboard is being set up. Refresh this page in a moment.",
    tone: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  },
  rejected: {
    title: "Your application was not approved",
    body: "If your situation has changed, get in touch with us and we'll take another look.",
    tone: "bg-surface-2 text-text-secondary",
  },
};

/**
 * Partner portal. Partners sign in like everyone else, with the email they
 * applied with; this page shows their own referrals, badge and payouts.
 */
function PartnerPortalPage() {
  const { data: session } = trpc.auth.me.useQuery();
  const { data: portal, isLoading } = trpc.partner.portal.useQuery(undefined, { enabled: !!session?.user });

  return (
    <PortalShell email={session?.user?.email} hasOrganisation={!!session?.tenantId}>
      {isLoading || !portal ? (
        <div className="flex justify-center py-24">
          <Spinner size="md" className="text-brand-600" />
        </div>
      ) : portal.kind === "partner" ? (
        <PartnerDashboard data={portal} />
      ) : portal.kind === "application" ? (
        <div className="mx-auto max-w-xl space-y-4">
          <h1 className="font-display text-3xl font-extrabold tracking-tight text-text-primary">Partner portal</h1>
          <div className={cn("rounded-2xl px-5 py-4 text-[15px]", APPLICATION_TEXT[portal.status]?.tone)}>
            <p className="font-semibold">{APPLICATION_TEXT[portal.status]?.title}</p>
            <p className="mt-1">
              {portal.companyName} · applied {formatDate(portal.appliedAt)}. {APPLICATION_TEXT[portal.status]?.body}
            </p>
          </div>
        </div>
      ) : (
        <div className="mx-auto max-w-xl space-y-4 text-center">
          <h1 className="font-display text-3xl font-extrabold tracking-tight text-text-primary">Partner portal</h1>
          {portal.emailVerified ? (
            <p className="text-[15px] text-text-tertiary">
              There's no partner account for <strong className="text-text-primary">{portal.email}</strong>. Sign in with the
              email you applied with, or apply to become a partner.
            </p>
          ) : (
            <p className="text-[15px] text-text-tertiary">
              Your email <strong className="text-text-primary">{portal.email}</strong> isn't verified yet. Sign out and sign in
              again with an email link to open your partner portal.
            </p>
          )}
          <Link to="/partners" hash="apply" className="btn-primary inline-flex">
            Become a partner
          </Link>
        </div>
      )}
    </PortalShell>
  );
}

/** Navy header with the partner's email, links to their other roles, and sign-out. */
function PortalShell({ email, hasOrganisation, children }: { email?: string; hasOrganisation: boolean; children: ReactNode }) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const { data: platformMe } = trpc.platform.me.useQuery();
  const logout = trpc.auth.logout.useMutation({
    onSuccess: async () => {
      await clearDesktopToken();
      sessionStorage.removeItem("selectedBusinessId");
      setBusinessId(null);
      utils.invalidate();
      navigate({ to: "/login" });
    },
  });

  return (
    <div className="min-h-screen bg-surface-1">
      <header className="bg-[#0f1b3d] text-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Logo className="h-8 w-8" variant="light" />
          <span className="hidden font-display text-lg font-extrabold tracking-[-0.02em] sm:inline">Fintranzact</span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold">
            <Icon icon={Award01Icon} size={14} />
            Partner portal
          </span>
          <div className="flex-1" />
          <span className="hidden truncate text-sm text-[#b3bfdd] md:block">{email}</span>
          {platformMe?.isPlatformAdmin ? (
            <Link to="/platform" className="hidden items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-semibold hover:bg-white/10 sm:inline-flex">
              <Icon icon={UserShield01Icon} size={14} />
              Admin
            </Link>
          ) : null}
          {hasOrganisation ? (
            <Link to="/" className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 px-3 py-1.5 text-sm font-semibold hover:bg-white/10">
              <Icon icon={ArrowLeft01Icon} size={14} />
              <span className="hidden sm:inline">Open Fintranzact</span>
              <span className="sm:hidden">App</span>
            </Link>
          ) : null}
          <button
            type="button"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
            className="inline-flex items-center gap-1.5 rounded-xl px-2 py-1.5 text-sm font-semibold text-[#c3cee6] hover:bg-white/10 hover:text-white"
            aria-label="Sign out"
          >
            <Icon icon={Logout01Icon} size={16} />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">{children}</main>
    </div>
  );
}

function PartnerDashboard({ data }: { data: Extract<Portal, { kind: "partner" }> }) {
  const { stats } = data;
  const link = `${window.location.origin}/register?ref=${data.referralCode}`;
  const next = stats.next ? partnerBadges.find((b) => b.id === stats.next!.badge) : null;
  const current = partnerBadges.find((b) => b.id === stats.badge) ?? partnerBadges[0];
  const progress = next
    ? Math.min(100, Math.round(((stats.paidReferrals - current.minPaidReferrals) / (next.minPaidReferrals - current.minPaidReferrals)) * 100))
    : 100;
  const [copied, setCopied] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-[22px] border border-border-light bg-surface-0 p-6">
        <div className="min-w-0">
          <p className="text-sm text-text-tertiary">
            {partnerTypeInfo[data.partnerType as PartnerType]?.label ?? data.partnerType} · {data.contactName}
          </p>
          <h2 className="mt-1 font-display text-2xl font-extrabold text-text-primary">{data.companyName}</h2>
          <div className="mt-3">
            <PartnerBadge badge={stats.badge} size="md" />
          </div>
        </div>
      </div>

      <YourDetails data={data} />

      <div className="rounded-[22px] border border-brand-100 bg-brand-50 p-6 dark:border-brand-900 dark:bg-brand-950">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">Your referral code</p>
        <p className="mt-1 font-mono text-3xl font-bold tracking-wider text-text-primary">{data.referralCode}</p>
        <p className="mt-3 text-sm text-text-secondary">
          Businesses that sign up with this code, or with your link, count as your referrals.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="min-w-0 max-w-full truncate rounded-lg bg-surface-0 px-3 py-2 font-mono text-xs text-text-secondary">{link}</span>
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(link);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
            className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-bold text-white hover:bg-brand-700"
          >
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Businesses referred", String(stats.referred)],
          ["On a paid plan", String(stats.paidReferrals)],
          [`Commission / month (${stats.commissionPercent}%)`, formatCurrency(stats.monthlyCommission)],
          ["Paid to you so far", formatCurrency(stats.paidOut)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-border-light bg-surface-0 p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">{label}</p>
            <p className="mt-1.5 font-display text-2xl font-extrabold tabular-nums text-text-primary">{value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-border-light bg-surface-0 p-5">
        {next ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-semibold text-text-primary">
                {stats.next!.needed} more paying {stats.next!.needed === 1 ? "business" : "businesses"} to reach {next.label} ({next.commissionPercent}%)
              </span>
              <span className="text-text-tertiary">
                {stats.paidReferrals} / {next.minPaidReferrals}
              </span>
            </div>
            <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full rounded-full bg-brand-600" style={{ width: `${progress}%` }} />
            </div>
          </>
        ) : (
          <p className="text-sm font-semibold text-text-primary">You've reached the top badge. Thank you for everything you bring us.</p>
        )}
        {stats.pendingPayout !== "0.00" ? (
          <p className="mt-3 text-sm text-text-secondary">{formatCurrency(stats.pendingPayout)} is on its way to you.</p>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="overflow-hidden rounded-2xl border border-border-light bg-surface-0">
          <h3 className="border-b border-border-light px-5 py-3 text-[15px] font-bold text-text-primary">Your referrals</h3>
          {data.referred.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-text-tertiary">Nobody has signed up with your code yet.</p>
          ) : (
            <div className="divide-y divide-border-light">
              {data.referred.map((r, i) => (
                <div key={i} className="flex items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-text-primary">{r.name}</p>
                    <p className="text-xs text-text-tertiary">Joined {formatDate(r.joinedAt)}</p>
                  </div>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-semibold",
                      r.paid ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : "bg-surface-2 text-text-secondary",
                    )}
                  >
                    {r.planName}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="overflow-hidden rounded-2xl border border-border-light bg-surface-0">
          <h3 className="border-b border-border-light px-5 py-3 text-[15px] font-bold text-text-primary">Payouts</h3>
          {data.payouts.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-text-tertiary">No payouts yet.</p>
          ) : (
            <div className="divide-y divide-border-light">
              {data.payouts.map((p) => (
                <div key={p.period} className="flex items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold tabular-nums text-text-primary">{formatCurrency(p.amount)}</p>
                    <p className="truncate text-xs text-text-tertiary">
                      For {p.period}
                      {p.status === "paid" && p.paidAt ? ` · paid ${formatDate(p.paidAt)}` : ""}
                      {p.reference ? ` · ${p.reference}` : ""}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-semibold",
                      p.status === "paid"
                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                        : "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
                    )}
                  >
                    {p.status === "paid" ? "Paid" : "On its way"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/** What we have on file for the partner. Changes go through the Fintranzact team. */
function YourDetails({ data }: { data: Extract<Portal, { kind: "partner" }> }) {
  const website = data.website ? (data.website.startsWith("http") ? data.website : `https://${data.website}`) : null;
  return (
    <details className="group rounded-2xl border border-border-light bg-surface-0">
      <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3 text-[15px] font-bold text-text-primary">
        Your details
        <span className="text-sm font-semibold text-brand-600 group-open:hidden dark:text-brand-300">Show</span>
        <span className="hidden text-sm font-semibold text-brand-600 group-open:inline dark:text-brand-300">Hide</span>
      </summary>
      <dl className="divide-y divide-border-light border-t border-border-light text-sm">
        {[
          ["Company", data.companyName],
          ["Contact", data.contactName],
          ["Email", data.email],
          ["Phone", data.phone],
          ["Location", [data.city, data.state].filter(Boolean).join(", ")],
          ["Website", website ? <a key="w" href={website} target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline dark:text-brand-300">{data.website}</a> : "—"],
          ["Programme", partnerTypeInfo[data.partnerType as PartnerType]?.label ?? data.partnerType],
          ["Partner since", data.approvedAt ? formatDate(data.approvedAt) : "—"],
          ["Partner list", data.listPublicly ? "Shown on Find a partner" : "Not shown"],
        ].map(([label, value]) => (
          <div key={label as string} className="flex gap-3 px-5 py-2.5">
            <dt className="w-32 shrink-0 text-text-tertiary">{label}</dt>
            <dd className="min-w-0 break-words text-text-primary">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="border-t border-border-light px-5 py-3 text-xs text-text-tertiary">
        Need to change something, or your bank / UPI details for payouts? Contact the Fintranzact team.
      </p>
    </details>
  );
}
