import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft01Icon, ArrowRight01Icon, CheckmarkCircle02Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { Icon, IconCircle } from "@/components/ui/Icon";
import { CtaBand, MarketingLayout, PageHero } from "@/components/marketing/MarketingLayout";
import { EYEBROW, FaqAccordion, HEADING } from "@/components/marketing/sections";
import { FEATURES, SOLUTIONS, getSolution, type Solution } from "@/lib/solutions-content";
import { cn } from "@/lib/utils";
import { SolutionCtas, useMetaDescription } from "@/components/marketing/solutions";

export const Route = createFileRoute("/solutions/$slug")({
  component: SolutionRoute,
});

function SolutionRoute() {
  const { slug } = Route.useParams();
  const solution = getSolution(slug);
  return solution ? <SolutionPage solution={solution} /> : <SolutionNotFound />;
}

function SolutionPage({ solution }: { solution: Solution }) {
  useMetaDescription(solution.description);
  const related = SOLUTIONS.filter((s) => s.group === solution.group && s.slug !== solution.slug).slice(0, 4);

  return (
    <MarketingLayout title={solution.name}>
      <PageHero eyebrow={`Solutions · ${solution.name}`} title={solution.title} subtitle={solution.subtitle}>
        <SolutionCtas />
      </PageHero>

      {/* ── Pain points → answers ─────────────────────────────── */}
      <section>
        <div className="mx-auto max-w-6xl px-4 py-24 md:px-6">
          <p className={cn(EYEBROW, "text-center")}>Sound familiar?</p>
          <h2 className={cn(HEADING, "mx-auto mt-3 max-w-3xl text-center text-3xl leading-tight md:text-[40px]")}>
            What gets in the way, and how Fintranzact handles it
          </h2>
          <div className="mt-12 grid gap-6 md:grid-cols-2">
            {solution.pains.map((p) => (
              <div key={p.pain} className="rounded-2xl border border-border-light bg-surface-0 p-7">
                <p className="text-[17px] font-bold text-text-primary">{p.pain}</p>
                <p className="mt-3 flex gap-2.5 text-[15px] leading-relaxed text-text-secondary">
                  <Icon icon={CheckmarkCircle02Icon} size={20} className="mt-0.5 shrink-0 text-brand-600 dark:text-brand-300" />
                  <span>{p.answer}</span>
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Relevant features ─────────────────────────────────── */}
      <section className="bg-surface-1">
        <div className="mx-auto max-w-6xl px-4 py-24 md:px-6">
          <p className={cn(EYEBROW, "text-center")}>Features you will use</p>
          <h2 className={cn(HEADING, "mt-3 text-center text-3xl md:text-[40px]")}>Built into Fintranzact today</h2>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {solution.features.map((id) => {
              const feature = FEATURES[id];
              // Each feature has its own page, served by routes/features/$slug.tsx.
              const featurePage: string = `/features/${feature.page}`;
              return (
                <Link
                  key={id}
                  to={featurePage}
                  className="group flex flex-col rounded-2xl border border-border-light bg-surface-0 p-6 transition duration-200 hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-[0_18px_40px_-18px_rgba(15,27,61,.28)] dark:hover:border-brand-800"
                >
                  <IconCircle icon={feature.icon} size="md" />
                  <h3 className="mt-4 text-base font-bold text-text-primary">{feature.name}</h3>
                  <p className="mt-1.5 flex-1 text-sm leading-relaxed text-text-tertiary">{feature.body}</p>
                  <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-600 dark:text-brand-300">
                    Learn more
                    <Icon icon={ArrowRight01Icon} size={15} className="transition group-hover:translate-x-0.5" />
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── How it works ──────────────────────────────────────── */}
      <section>
        <div className="mx-auto max-w-6xl px-4 py-24 md:px-6">
          <p className={cn(EYEBROW, "text-center")}>How it works for you</p>
          <h2 className={cn(HEADING, "mt-3 text-center text-3xl md:text-[40px]")}>Up and running in four steps</h2>
          <ol className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {solution.workflow.map((step, i) => (
              <li key={step.title} className="rounded-2xl border border-border-light p-7">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-600 font-display text-base font-extrabold text-white">
                  {i + 1}
                </span>
                <h3 className="mt-5 text-lg font-bold text-text-primary">{step.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-text-tertiary">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── FAQ ───────────────────────────────────────────────── */}
      <section className="bg-surface-1">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-24 md:px-6 lg:grid-cols-3">
          <div>
            <p className={EYEBROW}>FAQ</p>
            <h2 className={cn(HEADING, "mt-3 text-3xl leading-tight md:text-[40px]")}>Common questions</h2>
            <p className="mt-4 text-base leading-relaxed text-text-secondary">
              Something else on your mind?{" "}
              <Link to="/contact" className="font-semibold text-brand-600 hover:underline dark:text-brand-300">
                Talk to us
              </Link>
              .
            </p>
          </div>
          <div className="lg:col-span-2">
            <FaqAccordion key={solution.slug} items={solution.faqs} idPrefix={`faq-${solution.slug}`} />
          </div>
        </div>
      </section>

      {/* ── Related solutions ─────────────────────────────────── */}
      {related.length > 0 && (
        <section>
          <div className="mx-auto max-w-6xl px-4 pt-24 md:px-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <h2 className={cn(HEADING, "text-2xl md:text-3xl")}>More solutions</h2>
              <Link to="/solutions" className="text-sm font-semibold text-brand-600 hover:underline dark:text-brand-300">
                See all solutions →
              </Link>
            </div>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {related.map((s) => (
                <Link
                  key={s.slug}
                  to="/solutions/$slug"
                  params={{ slug: s.slug }}
                  className="flex items-center gap-3 rounded-2xl border border-border-light bg-surface-0 p-5 transition hover:border-brand-200 dark:hover:border-brand-800"
                >
                  <IconCircle icon={s.icon} size="md" />
                  <span className="text-[15px] font-bold text-text-primary">{s.name}</span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      <CtaBand title={`Try Fintranzact for ${solution.name.toLowerCase()}`} />
    </MarketingLayout>
  );
}

function SolutionNotFound() {
  return (
    <MarketingLayout title="Solution not found">
      <section className="landing-dots border-b border-border-light bg-[#f4f7fd] dark:bg-[#0d1530]">
        <div className="mx-auto flex max-w-3xl flex-col items-center px-4 py-24 text-center md:px-6 md:py-32">
          <IconCircle icon={Search01Icon} size="lg" />
          <h1 className={cn(HEADING, "mt-6 text-4xl leading-[1.1] md:text-5xl")}>We could not find that page</h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-slate-600 dark:text-slate-300">
            There is no solution page at this address. Browse all solutions by industry and business size instead.
          </p>
          <Link
            to="/solutions"
            className="mt-8 inline-flex h-[52px] items-center gap-2 rounded-xl bg-brand-600 px-6 text-base font-bold text-white shadow-[0_12px_28px_-10px_rgba(59,94,170,.7)] transition hover:bg-brand-700"
          >
            <Icon icon={ArrowLeft01Icon} size={18} strokeWidth={2} />
            All solutions
          </Link>
        </div>
      </section>
    </MarketingLayout>
  );
}
