import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AiBrain01Icon,
  Analytics01Icon,
  ArrowRight01Icon,
  Database01Icon,
  File01Icon,
  HelpCircleIcon,
  Invoice01Icon,
  Rocket01Icon,
  Settings01Icon,
} from "@hugeicons/core-free-icons";
import { Icon, IconCircle, type IconSvgElement } from "@/components/ui/Icon";
import { CtaBand } from "@/components/marketing/MarketingLayout";
import { EYEBROW, HEADING } from "@/components/marketing/sections";
import { HelpLayout, HelpSearch } from "@/components/help/HelpLayout";
import { HELP_MDX_COMPONENTS } from "@/components/help/mdx";
import { loadHelpArticle } from "@/lib/help-content";
import { HELP_NAV, helpPath, type HelpNavLink } from "@/lib/help-paths";
import { cn } from "@/lib/utils";

/** The help centre home page: search, every section, and the quick start (content/help/index.mdx). */
export const Route = createFileRoute("/help/")({
  loader: () => loadHelpArticle(""),
  component: HelpHome,
});

const SECTION_ICONS: Record<string, IconSvgElement> = {
  "Getting Started": Rocket01Icon,
  Invoicing: Invoice01Icon,
  "Other Documents": File01Icon,
  "Business Data": Database01Icon,
  "Reports & GST": Analytics01Icon,
  "Settings & Team": Settings01Icon,
  Advanced: AiBrain01Icon,
  FAQ: HelpCircleIcon,
};

function TopicLink({ link }: { link: HelpNavLink }) {
  return (
    <Link
      to={helpPath(link.slug)}
      className="text-text-secondary hover:text-brand-700 hover:underline dark:hover:text-brand-200"
    >
      {link.label}
    </Link>
  );
}

function HelpHome() {
  const article = Route.useLoaderData();
  const fm = article?.frontmatter;
  const actions = fm?.hero?.actions ?? [];

  return (
    <HelpLayout slug="" title="Help centre" description={fm?.description} wide>
      {/* ── Hero with search ─────────────────────────────── */}
      <section className="landing-dots border-b border-border-light bg-[#f4f7fd] dark:bg-[#0d1530]">
        <div className="mx-auto max-w-3xl px-4 py-14 text-center md:px-6 md:py-20">
          <p className={EYEBROW}>Help centre</p>
          <h1 className={cn(HEADING, "mt-3 text-4xl leading-[1.1] md:text-5xl")}>How can we help?</h1>
          {fm?.hero?.tagline && (
            <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-slate-600 dark:text-slate-300">{fm.hero.tagline}</p>
          )}
          <HelpSearch className="mx-auto mt-8 max-w-xl text-left" large />
          {actions.length > 0 && (
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              {actions.map((a) => (
                <Link
                  key={a.link}
                  to={a.link}
                  className={cn(
                    "inline-flex h-11 items-center gap-2 rounded-xl px-5 text-sm font-bold transition",
                    a.variant === "primary"
                      ? "bg-brand-600 text-white hover:bg-brand-700"
                      : "border border-[#cfd8ea] bg-white text-[#0f1b3d] hover:border-brand-300 dark:border-white/15 dark:bg-white/5 dark:text-white",
                  )}
                >
                  {a.text}
                  <Icon icon={ArrowRight01Icon} size={16} />
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── Every section ───────────────────────────────── */}
      <section>
        <div className="mx-auto max-w-6xl px-4 py-16 md:px-6 md:py-20">
          <h2 className={cn(HEADING, "text-2xl md:text-3xl")}>Browse by topic</h2>
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {HELP_NAV.map((section) => (
              <div key={section.label} className="flex flex-col rounded-2xl border border-border-light bg-surface-0 p-6">
                <div className="flex items-center gap-3">
                  <IconCircle icon={SECTION_ICONS[section.label] ?? HelpCircleIcon} size="md" />
                  <h3 className="text-lg font-bold text-text-primary">{section.label}</h3>
                </div>
                <ul className="mt-4 space-y-1.5 text-[15px]">
                  {section.items.map((item) =>
                    "items" in item ? (
                      <li key={item.label} className="pt-2">
                        <p className="text-xs font-bold uppercase tracking-[0.08em] text-text-tertiary">{item.label}</p>
                        <ul className="mt-1.5 space-y-1.5">
                          {item.items.map((l) => (
                            <li key={l.slug}>
                              <TopicLink link={l} />
                            </li>
                          ))}
                        </ul>
                      </li>
                    ) : (
                      <li key={item.slug}>
                        <TopicLink link={item} />
                      </li>
                    ),
                  )}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Quick start (content/help/index.mdx) ─────────── */}
      {article && (
        <section className="bg-surface-1">
          <div className="mx-auto max-w-3xl px-4 py-16 md:px-6 md:py-20">
            <h2 className={cn(HEADING, "text-2xl md:text-3xl")}>{article.frontmatter.title}</h2>
            {article.frontmatter.description && (
              <p className="mt-3 text-lg leading-relaxed text-text-secondary">{article.frontmatter.description}</p>
            )}
            <div className="help-prose mt-8">
              <article.Content components={HELP_MDX_COMPONENTS} />
            </div>
          </div>
        </section>
      )}

      <CtaBand />
    </HelpLayout>
  );
}
