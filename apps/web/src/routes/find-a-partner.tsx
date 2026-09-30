import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { partnerBadges, partnerTypeInfo, type PartnerType } from "@fintranzact/shared";
import { Globe02Icon, Location01Icon, Search01Icon, UserGroupIcon } from "@hugeicons/core-free-icons";
import { MarketingLayout, PageHero } from "@/components/marketing/MarketingLayout";
import { Icon, IconCircle } from "@/components/ui/Icon";
import { PartnerBadge } from "@/components/ui/PartnerBadge";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { trpc } from "@/lib/trpc";

export const Route = createFileRoute("/find-a-partner")({
  component: FindAPartnerPage,
});

const BADGE_RANK = Object.fromEntries(partnerBadges.map((b, i) => [b.id, i])) as Record<string, number>;

const SELECT_CLASS =
  "h-12 rounded-xl border border-border-light bg-surface-0 px-3 text-[15px] text-text-primary outline-none focus:border-brand-500";

/** Public list of every approved Fintranzact partner who agreed to be listed. */
function FindAPartnerPage() {
  const { data, isLoading } = trpc.partner.directory.useQuery();
  const [query, setQuery] = useState("");
  const [type, setType] = useState<PartnerType | "all">("all");
  const [badge, setBadge] = useState("all");
  const [state, setState] = useState("all");

  const states = useMemo(
    () => [...new Set((data ?? []).map((p) => p.state).filter((s): s is string => !!s))].sort(),
    [data],
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data ?? [])
      .filter(
        (p) =>
          (type === "all" || p.partnerType === type) &&
          (badge === "all" || p.badge === badge) &&
          (state === "all" || p.state === state) &&
          (!q || [p.companyName, p.city, p.state].some((v) => v?.toLowerCase().includes(q))),
      )
      // Higher badges first, then alphabetical.
      .sort((a, b) => (BADGE_RANK[b.badge] ?? 0) - (BADGE_RANK[a.badge] ?? 0) || a.companyName.localeCompare(b.companyName));
  }, [data, query, type, badge, state]);

  const filtered = query.trim() !== "" || type !== "all" || badge !== "all" || state !== "all";

  return (
    <MarketingLayout title="Find a partner">
      <PageHero
        eyebrow="Partners"
        title="Find a Fintranzact partner"
        subtitle="Accountants, resellers and technology partners who help businesses across India set up and run Fintranzact."
      >
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link
            to="/partners"
            hash="apply"
            className="inline-flex h-[52px] items-center rounded-xl bg-brand-600 px-6 text-base font-bold text-white shadow-[0_12px_28px_-10px_rgba(59,94,170,.7)] transition hover:bg-brand-700"
          >
            Become a partner
          </Link>
          {data?.length ? (
            <span className="text-[15px] text-text-tertiary">
              {data.length} {data.length === 1 ? "partner" : "partners"} listed
            </span>
          ) : null}
        </div>
      </PageHero>

      <section className="bg-surface-1">
        <div className="mx-auto max-w-6xl px-4 py-14 md:px-6">
          <div className="grid gap-3 md:grid-cols-[1fr_auto_auto_auto]">
            <label className="flex h-12 items-center gap-2 rounded-xl border border-border-light bg-surface-0 px-4 focus-within:border-brand-500">
              <Icon icon={Search01Icon} size={18} className="text-text-tertiary" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name or city"
                aria-label="Search partners"
                className="w-full bg-transparent text-[15px] text-text-primary outline-none placeholder:text-text-tertiary"
              />
            </label>
            <select value={type} onChange={(e) => setType(e.target.value as PartnerType | "all")} aria-label="Programme" className={SELECT_CLASS}>
              <option value="all">All programmes</option>
              {Object.entries(partnerTypeInfo).map(([id, info]) => (
                <option key={id} value={id}>{info.label}</option>
              ))}
            </select>
            <select value={badge} onChange={(e) => setBadge(e.target.value)} aria-label="Badge" className={SELECT_CLASS}>
              <option value="all">All badges</option>
              {partnerBadges.map((b) => (
                <option key={b.id} value={b.id}>{b.label}</option>
              ))}
            </select>
            <select value={state} onChange={(e) => setState(e.target.value)} aria-label="State" className={SELECT_CLASS}>
              <option value="all">All states</option>
              {states.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {isLoading ? (
            <div className="mt-8">
              <SkeletonRows count={4} height="h-32" />
            </div>
          ) : shown.length === 0 ? (
            <div className="mt-8 flex flex-col items-center gap-3 rounded-[22px] border border-border-light bg-surface-0 px-6 py-16 text-center">
              <IconCircle icon={UserGroupIcon} size="lg" />
              <p className="text-lg font-bold text-text-primary">
                {filtered ? "No partners match that search" : "Our partner list is growing"}
              </p>
              <p className="max-w-md text-[15px] text-text-tertiary">
                {filtered
                  ? "Try another city or programme, or clear the filters."
                  : "Be one of the first Fintranzact partners in your city."}
              </p>
              {filtered ? (
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    setType("all");
                    setBadge("all");
                    setState("all");
                  }}
                  className="mt-2 text-sm font-semibold text-brand-600 hover:underline dark:text-brand-300"
                >
                  Clear filters
                </button>
              ) : (
                <Link to="/partners" hash="apply" className="mt-2 text-sm font-semibold text-brand-600 hover:underline dark:text-brand-300">
                  Become a partner
                </Link>
              )}
            </div>
          ) : (
            <>
              {filtered ? (
                <p className="mt-6 text-sm text-text-tertiary">
                  Showing {shown.length} of {data?.length ?? 0}
                </p>
              ) : null}
              <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {shown.map((p) => (
                  <article key={p.id} className="flex flex-col rounded-2xl border border-border-light bg-surface-0 p-6">
                    <div className="flex flex-wrap items-center gap-2">
                      <PartnerBadge badge={p.badge} />
                      <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700 dark:bg-brand-950 dark:text-brand-300">
                        {partnerTypeInfo[p.partnerType as PartnerType]?.label ?? p.partnerType}
                      </span>
                    </div>
                    <h2 className="mt-4 text-lg font-bold text-text-primary">{p.companyName}</h2>
                    <p className="mt-1 text-sm text-text-tertiary">
                      {partnerTypeInfo[p.partnerType as PartnerType]?.description}
                    </p>
                    <div className="mt-auto space-y-1.5 pt-4">
                      <p className="flex items-center gap-1.5 text-sm text-text-secondary">
                        <Icon icon={Location01Icon} size={15} />
                        {[p.city, p.state].filter(Boolean).join(", ")}
                      </p>
                      {p.website ? (
                        <a
                          href={p.website.startsWith("http") ? p.website : `https://${p.website}`}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          className="flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:underline dark:text-brand-300"
                        >
                          <Icon icon={Globe02Icon} size={15} />
                          {p.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                        </a>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-6xl px-4 py-16 md:px-6">
          <div className="flex flex-col items-start gap-5 rounded-[22px] border border-border-light bg-surface-0 p-8 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-xl font-bold text-text-primary">Want to be listed here?</h2>
              <p className="mt-1.5 max-w-xl text-[15px] text-text-tertiary">
                Apply to the partner programme. Approved partners get a referral code, a badge that grows with their paying
                clients, and commission on every plan they bring in.
              </p>
            </div>
            <Link
              to="/partners"
              className="inline-flex h-12 shrink-0 items-center rounded-xl border border-border-medium px-5 text-[15px] font-semibold text-text-primary transition hover:border-brand-500"
            >
              About the programme
            </Link>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
