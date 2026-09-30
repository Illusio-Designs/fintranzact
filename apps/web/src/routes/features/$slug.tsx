import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  BookOpen01Icon,
  CheckmarkCircle02Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { Icon, IconCircle } from "@/components/ui/Icon";
import { CtaBand, MarketingLayout } from "@/components/marketing/MarketingLayout";
import { EYEBROW, FaqAccordion, HEADING } from "@/components/marketing/sections";
import { featurePage, type FeaturePage } from "@/lib/feature-pages";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/features/$slug")({
  component: FeatureRoute,
});

function FeatureRoute() {
  const { slug } = Route.useParams();
  const page = featurePage(slug);
  return page ? <FeaturePageView page={page} /> : <FeatureNotFound />;
}

const PRIMARY_BUTTON =
  "inline-flex h-[52px] items-center gap-2 rounded-xl bg-brand-600 px-6 text-base font-bold text-white shadow-[0_12px_28px_-10px_rgba(59,94,170,.7)] transition hover:bg-brand-700";
const SECONDARY_BUTTON =
  "inline-flex h-[52px] items-center rounded-xl border border-[#cfd8ea] bg-white px-6 text-base font-semibold text-[#0f1b3d] transition hover:border-brand-300 dark:border-white/15 dark:bg-white/5 dark:text-white";
const CARD_HOVER =
  "transition duration-200 hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-[0_18px_40px_-18px_rgba(15,27,61,.28)] dark:hover:border-brand-800";

/** "/help/invoicing/create-invoice" → the help centre's splat param. */
function helpSplat(helpPath: string) {
  return helpPath.replace(/^\/help\/?/, "");
}

function FeaturePageView({ page }: { page: FeaturePage }) {
  const related = page.related.map((slug) => featurePage(slug)).filter((p): p is FeaturePage => Boolean(p));

  return (
    <MarketingLayout title={page.title} description={page.summary}>
      {/* ── Hero ──────────────────────────────────────────────── */}
      <section className="landing-dots border-b border-border-light bg-[#f4f7fd] dark:bg-[#0d1530]">
        <div className="mx-auto max-w-6xl px-4 py-16 md:px-6 md:py-24">
          <nav aria-label="Breadcrumb" className="text-sm font-semibold text-slate-500 dark:text-slate-400">
            <Link to="/features" className="text-brand-600 hover:underline dark:text-brand-300">
              Features
            </Link>
            <span className="mx-2" aria-hidden="true">
              /
            </span>
            <span>{page.navLabel}</span>
          </nav>
          <div className="mt-6 flex items-center gap-4">
            <IconCircle icon={page.icon} size="xl" tone="solid" />
          </div>
          <h1 className="mt-5 max-w-3xl font-display text-4xl font-extrabold leading-[1.1] tracking-[-0.025em] text-[#0f1b3d] md:text-5xl dark:text-white">
            {page.title}
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-slate-600 dark:text-slate-300">{page.tagline}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/register" className={PRIMARY_BUTTON}>
              Start free — no card needed
              <Icon icon={ArrowRight01Icon} size={18} strokeWidth={2} />
            </Link>
            <Link to="/pricing" className={SECONDARY_BUTTON}>
              See pricing
            </Link>
          </div>
        </div>
      </section>

      {/* ── Highlights ────────────────────────────────────────── */}
      <section>
        <div className="mx-auto max-w-6xl px-4 py-24 md:px-6">
          <p className={cn(EYEBROW, "text-center")}>What you get</p>
          <h2 className={cn(HEADING, "mx-auto mt-3 max-w-3xl text-center text-3xl leading-tight md:text-[40px]")}>
            {page.navLabel} in Fintranzact
          </h2>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {page.highlights.map((h) => (
              <div key={h.title} className="rounded-2xl border border-border-light bg-surface-0 p-6">
                <IconCircle icon={h.icon} size="md" />
                <h3 className="mt-4 text-base font-bold text-text-primary">{h.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-text-tertiary">{h.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ──────────────────────────────────────── */}
      <section className="bg-surface-1">
        <div className="mx-auto max-w-6xl px-4 py-24 md:px-6">
          <p className={cn(EYEBROW, "text-center")}>How it works</p>
          <h2 className={cn(HEADING, "mt-3 text-center text-3xl md:text-[40px]")}>
            {page.steps.length === 1 ? "One step" : `${numberWord(page.steps.length)} simple steps`}
          </h2>
          <ol
            className={cn(
              "mt-12 grid gap-6 sm:grid-cols-2",
              page.steps.length === 3 && "lg:grid-cols-3",
              page.steps.length === 4 && "lg:grid-cols-4",
              page.steps.length >= 5 && "lg:grid-cols-5",
            )}
          >
            {page.steps.map((step, i) => (
              <li key={step.title} className="rounded-2xl border border-border-light bg-surface-0 p-7">
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

      {/* ── Details ───────────────────────────────────────────── */}
      <section>
        <div className="mx-auto max-w-6xl px-4 py-24 md:px-6">
          <p className={cn(EYEBROW, "text-center")}>In detail</p>
          <h2 className={cn(HEADING, "mt-3 text-center text-3xl md:text-[40px]")}>Everything it covers</h2>
          <div className="mt-12 grid gap-6 md:grid-cols-2">
            {page.details.map((d) => (
              <div key={d.heading} className="rounded-2xl border border-border-light bg-surface-0 p-7">
                <h3 className="text-[17px] font-bold text-text-primary">{d.heading}</h3>
                <ul className="mt-4 space-y-3">
                  {d.points.map((point) => (
                    <li key={point} className="flex gap-2.5 text-[15px] leading-relaxed text-text-secondary">
                      <Icon
                        icon={CheckmarkCircle02Icon}
                        size={20}
                        className="mt-0.5 shrink-0 text-brand-600 dark:text-brand-300"
                      />
                      <span className="min-w-0">{point}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {page.helpPath && (
            <div className="mt-10 flex flex-col items-start gap-4 rounded-2xl border border-border-light bg-surface-1 p-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <IconCircle icon={BookOpen01Icon} size="md" />
                <div>
                  <p className="text-base font-bold text-text-primary">Step-by-step guide</p>
                  <p className="mt-1 text-sm leading-relaxed text-text-tertiary">
                    Every screen, field and option for {page.navLabel.toLowerCase()}, in the help centre.
                  </p>
                </div>
              </div>
              <Link
                to="/help/$"
                params={{ _splat: helpSplat(page.helpPath) }}
                className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-brand-600 hover:underline dark:text-brand-300"
              >
                Read the guide
                <Icon icon={ArrowRight01Icon} size={15} />
              </Link>
            </div>
          )}
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
          <div className="min-w-0 lg:col-span-2">
            <FaqAccordion key={page.slug} items={page.faqs} idPrefix={`faq-${page.slug}`} />
          </div>
        </div>
      </section>

      {/* ── Related features ──────────────────────────────────── */}
      {related.length > 0 && (
        <section>
          <div className="mx-auto max-w-6xl px-4 pt-24 md:px-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <h2 className={cn(HEADING, "text-2xl md:text-3xl")}>Works well with</h2>
              <Link to="/features" className="text-sm font-semibold text-brand-600 hover:underline dark:text-brand-300">
                See all features →
              </Link>
            </div>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {related.map((r) => (
                <Link
                  key={r.slug}
                  to="/features/$slug"
                  params={{ slug: r.slug }}
                  className={cn("group flex flex-col rounded-2xl border border-border-light bg-surface-0 p-6", CARD_HOVER)}
                >
                  <IconCircle icon={r.icon} size="md" />
                  <h3 className="mt-4 text-base font-bold text-text-primary">{r.navLabel}</h3>
                  <p className="mt-1.5 flex-1 text-sm leading-relaxed text-text-tertiary">{r.tagline}</p>
                  <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-600 dark:text-brand-300">
                    Learn more
                    <Icon icon={ArrowRight01Icon} size={15} className="transition group-hover:translate-x-0.5" />
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      <CtaBand title={`Try ${page.navLabel.toLowerCase()} in Fintranzact`} />
    </MarketingLayout>
  );
}

function numberWord(n: number) {
  return ["Zero", "One", "Two", "Three", "Four", "Five", "Six"][n] ?? String(n);
}

function FeatureNotFound() {
  return (
    <MarketingLayout title="Feature not found">
      <section className="landing-dots border-b border-border-light bg-[#f4f7fd] dark:bg-[#0d1530]">
        <div className="mx-auto flex max-w-3xl flex-col items-center px-4 py-24 text-center md:px-6 md:py-32">
          <IconCircle icon={Search01Icon} size="lg" />
          <h1 className={cn(HEADING, "mt-6 text-4xl leading-[1.1] md:text-5xl")}>We could not find that page</h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-slate-600 dark:text-slate-300">
            There is no feature page at this address. Browse every Fintranzact feature instead.
          </p>
          <Link to="/features" className={cn(PRIMARY_BUTTON, "mt-8")}>
            <Icon icon={ArrowLeft01Icon} size={18} strokeWidth={2} />
            All features
          </Link>
        </div>
      </section>
    </MarketingLayout>
  );
}
