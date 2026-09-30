import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { Icon, IconCircle } from "@/components/ui/Icon";
import { CtaBand, MarketingLayout, PageHero } from "@/components/marketing/MarketingLayout";
import { EYEBROW, HEADING } from "@/components/marketing/sections";
import { SolutionCtas, useMetaDescription } from "@/components/marketing/solutions";
import { SOLUTIONS, SOLUTION_GROUPS } from "@/lib/solutions-content";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/solutions/")({
  component: SolutionsIndexPage,
});

function SolutionsIndexPage() {
  useMetaDescription(
    "Fintranzact for your kind of business: retail, wholesale, manufacturing, services, pharmacy, restaurants, electronics, apparel, multi-GSTIN businesses and accountants.",
  );
  return (
    <MarketingLayout title="Solutions">
      <PageHero
        eyebrow="Solutions"
        title="Fintranzact for the way your business works"
        subtitle="See how GST billing, inventory and accounting fit your trade and your size, with the features you will actually use."
      >
        <SolutionCtas />
      </PageHero>

      {SOLUTION_GROUPS.map((group, gi) => (
        <section key={group.id} className={cn(gi % 2 === 1 && "bg-surface-1")}>
          <div className="mx-auto max-w-6xl px-4 py-20 md:px-6 lg:py-24">
            <p className={EYEBROW}>{group.title}</p>
            <h2 className={cn(HEADING, "mt-3 text-3xl leading-tight md:text-[40px]")}>{group.intro}</h2>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {SOLUTIONS.filter((s) => s.group === group.id).map((s) => (
                <Link
                  key={s.slug}
                  to="/solutions/$slug"
                  params={{ slug: s.slug }}
                  className="group flex flex-col rounded-2xl border border-border-light bg-surface-0 p-6 transition duration-200 hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-[0_18px_40px_-18px_rgba(15,27,61,.28)] dark:hover:border-brand-800"
                >
                  <IconCircle icon={s.icon} size="md" />
                  <h3 className="mt-4 text-base font-bold text-text-primary">{s.name}</h3>
                  <p className="mt-1.5 flex-1 text-sm leading-relaxed text-text-tertiary">{s.summary}</p>
                  <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-600 dark:text-brand-300">
                    Explore
                    <Icon icon={ArrowRight01Icon} size={15} className="transition group-hover:translate-x-0.5" />
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      ))}

      <CtaBand />
    </MarketingLayout>
  );
}
