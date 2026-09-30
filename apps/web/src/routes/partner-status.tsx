import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useRef, useState, type FormEvent } from "react";
import { partnerBadges, partnerStatusLookupSchema, partnerTypeInfo, type PartnerType } from "@fintranzact/shared";
import type { RouterOutputs } from "@fintranzact/api";
import { MarketingLayout, PageHero } from "@/components/marketing/MarketingLayout";
import { InputField } from "@/components/ui/FormField";
import { TurnstileModal } from "@/components/ui/TurnstileModal";
import { PartnerBadge } from "@/components/ui/PartnerBadge";
import { trpc } from "@/lib/trpc";
import { formatCurrency, formatDate, cn } from "@/lib/utils";

export const Route = createFileRoute("/partner-status")({
  component: PartnerStatusPage,
});

type Result = RouterOutputs["partner"]["checkStatus"];

const APPLICATION_TEXT: Record<string, { title: string; body: string; tone: string }> = {
  pending: {
    title: "Your application is being reviewed",
    body: "Our partner team usually replies within two business days.",
    tone: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  },
  approved: {
    title: "You're an approved partner",
    body: "Enter your referral code instead of your phone number to see your referrals, badge and payouts. It was sent to you when you were approved.",
    tone: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  },
  rejected: {
    title: "Your application was not approved",
    body: "If your situation has changed, write to us and we'll take another look.",
    tone: "bg-surface-2 text-text-secondary",
  },
};

/** Public page where a partner checks their application or their referrals and payouts. */
function PartnerStatusPage() {
  const [email, setEmail] = useState("");
  const [secret, setSecret] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const check = trpc.partner.checkStatus.useMutation({
    onSuccess: setResult,
    onError: (err) => setFormError(err.message),
  });

  const [showTurnstile, setShowTurnstile] = useState(false);
  const pendingRef = useRef<((token: string) => void) | null>(null);
  const onVerified = useCallback((token: string) => {
    setShowTurnstile(false);
    pendingRef.current?.(token);
    pendingRef.current = null;
  }, []);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = partnerStatusLookupSchema.safeParse({ email, secret });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? "Check your details");
      return;
    }
    setFormError(null);
    setResult(null);
    pendingRef.current = (turnstileToken) => check.mutate({ ...parsed.data, turnstileToken });
    setShowTurnstile(true);
  }

  return (
    <MarketingLayout title="Check partner status">
      <PageHero
        eyebrow="Partners"
        title="Check your partner status"
        subtitle="See your application, or your referrals, badge and payouts if you're an approved partner."
      />

      <section className="bg-surface-1">
        <div className="mx-auto max-w-5xl space-y-8 px-4 py-16 md:px-6">
          {result?.kind === "partner" ? (
            <PartnerDashboard data={result} onSignOut={() => setResult(null)} />
          ) : (
            <form
              onSubmit={handleSubmit}
              noValidate
              className="mx-auto max-w-xl rounded-[22px] border border-border-light bg-surface-0 p-7 shadow-[0_24px_60px_-34px_rgba(15,27,61,.35)] md:p-9"
            >
              <div className="space-y-5">
                <InputField
                  label="Email you applied with"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  placeholder="you@yourfirm.com"
                />
                <InputField
                  label="Referral code or phone number"
                  required
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder="FTZ-7K2M9Q or 98765 43210"
                />
                <p className="text-xs text-text-tertiary">
                  Approved partners: use your referral code to see referrals and payouts. Still waiting to hear from us? Use the phone
                  number from your application.
                </p>
              </div>
              {formError ? (
                <p role="alert" className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
                  {formError}
                </p>
              ) : null}
              {result?.kind === "application" ? (
                <div className={cn("mt-5 rounded-xl px-4 py-3 text-sm", APPLICATION_TEXT[result.status]?.tone)}>
                  <p className="font-semibold">{APPLICATION_TEXT[result.status]?.title}</p>
                  <p className="mt-1">
                    {result.companyName} · applied {formatDate(result.appliedAt)}. {APPLICATION_TEXT[result.status]?.body}
                  </p>
                </div>
              ) : null}
              <button
                type="submit"
                disabled={check.isPending}
                className="mt-7 inline-flex h-[52px] w-full items-center justify-center rounded-xl bg-brand-600 px-6 text-base font-bold text-white shadow-[0_12px_28px_-10px_rgba(59,94,170,.7)] transition hover:bg-brand-700 disabled:opacity-60"
              >
                {check.isPending ? "Checking…" : "Check status"}
              </button>
              <p className="mt-4 text-center text-sm text-text-tertiary">
                Not a partner yet?{" "}
                <Link to="/partners" hash="apply" className="font-semibold text-brand-600 hover:underline dark:text-brand-300">
                  Apply here
                </Link>
              </p>
            </form>
          )}
        </div>
      </section>

      <TurnstileModal
        open={showTurnstile}
        onVerified={onVerified}
        onClose={() => {
          setShowTurnstile(false);
          pendingRef.current = null;
        }}
      />
    </MarketingLayout>
  );
}

function PartnerDashboard({ data, onSignOut }: { data: Extract<Result, { kind: "partner" }>; onSignOut: () => void }) {
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
        <button type="button" onClick={onSignOut} className="text-sm font-semibold text-text-tertiary hover:text-text-primary">
          Check another partner
        </button>
      </div>

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
