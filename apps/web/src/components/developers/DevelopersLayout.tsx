import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { ArrowLeft01Icon, ArrowRight01Icon, Cancel01Icon, Menu01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { Icon, IconCircle } from "@/components/ui/Icon";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { HEADING } from "@/components/marketing/sections";
import { cn } from "@/lib/utils";
import { DeveloperSidebar } from "./Sidebar";

/**
 * The API reference shell: the public site's header and footer, a docs
 * sidebar on wide screens, and the same sidebar in a slide-in drawer on
 * phones and tablets.
 */
export function DevelopersLayout({
  title,
  description,
  mobileLabel,
  children,
}: {
  /** Page title (the layout appends "— Fintranzact"). */
  title: string;
  /** Meta description (aim for 120-160 characters). */
  description: string;
  /** Short name of this page for the phone-width menu bar. */
  mobileLabel?: string;
  children: ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => setDrawerOpen(false), [pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawerOpen(false);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, [drawerOpen]);

  return (
    <MarketingLayout title={title} description={description}>
      <div className="mx-auto flex w-full max-w-[1600px]">
        {/* Wide screens: sticky sidebar under the site header */}
        <aside className="sticky top-[72px] hidden h-[calc(100vh-72px)] w-[284px] shrink-0 border-r border-border-light bg-surface-1/60 lg:block">
          <DeveloperSidebar />
        </aside>

        <div className="min-w-0 flex-1">
          {/* Phones and tablets: a bar that opens the sidebar as a drawer */}
          <div className="sticky top-[72px] z-10 flex items-center gap-3 border-b border-border-light bg-surface-0/95 px-4 py-2.5 backdrop-blur lg:hidden">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-expanded={drawerOpen}
              aria-controls="developers-drawer"
              className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-border-light px-3 text-sm font-semibold text-text-primary transition hover:border-brand-300"
            >
              <Icon icon={Menu01Icon} size={17} />
              API menu
            </button>
            <span className="min-w-0 truncate text-sm text-text-tertiary">{mobileLabel ?? title}</span>
          </div>

          {children}
        </div>
      </div>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" id="developers-drawer" role="dialog" aria-modal="true" aria-label="API reference menu">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 h-full w-full cursor-default bg-[#0b1530]/60"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-[88vw] max-w-[340px] flex-col bg-surface-0 shadow-2xl">
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-border-light pl-5 pr-2">
              <span className="font-display text-base font-extrabold text-text-primary">API reference</span>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close menu"
                className="flex h-10 w-10 items-center justify-center rounded-lg text-text-tertiary hover:bg-surface-2 hover:text-text-primary"
              >
                <Icon icon={Cancel01Icon} size={18} />
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <DeveloperSidebar onNavigate={() => setDrawerOpen(false)} />
            </div>
          </div>
        </div>
      )}
    </MarketingLayout>
  );
}

/** Content column with comfortable reading width and padding. */
export function DocContent({ wide = false, children }: { wide?: boolean; children: ReactNode }) {
  return (
    <div className={cn("mx-auto w-full px-4 py-10 md:px-8 md:py-14 lg:px-10", wide ? "max-w-[1180px]" : "max-w-[820px]")}>
      {children}
    </div>
  );
}

/** Page heading block shared by the reference pages. */
export function DocHeader({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <header>
      {eyebrow && (
        <p className="text-ui font-bold uppercase tracking-[0.14em] text-brand-600 dark:text-brand-300">{eyebrow}</p>
      )}
      <h1 className={cn(HEADING, "mt-2 text-3xl leading-tight md:text-[42px]")}>{title}</h1>
      {children && <div className="mt-4 max-w-2xl text-[17px] leading-relaxed text-text-secondary">{children}</div>}
    </header>
  );
}

/** Previous / next links at the foot of a page. */
export function PagerLinks({
  prev,
  next,
}: {
  prev?: { label: string; to: string; params?: Record<string, string> };
  next?: { label: string; to: string; params?: Record<string, string> };
}) {
  if (!prev && !next) return null;
  return (
    <nav aria-label="More pages" className="mt-16 grid grid-cols-1 gap-3 border-t border-border-light pt-8 sm:grid-cols-2">
      {prev ? (
        <Link
          to={prev.to}
          params={prev.params}
          className="group flex items-center gap-3 rounded-2xl border border-border-light p-4 transition hover:border-brand-200 dark:hover:border-brand-800"
        >
          <Icon icon={ArrowLeft01Icon} size={18} className="text-text-tertiary transition group-hover:-translate-x-0.5" />
          <span className="min-w-0">
            <span className="block text-xs text-text-tertiary">Previous</span>
            <span className="block truncate text-[15px] font-bold text-text-primary">{prev.label}</span>
          </span>
        </Link>
      ) : (
        <span className="hidden sm:block" />
      )}
      {next && (
        <Link
          to={next.to}
          params={next.params}
          className="group flex items-center justify-end gap-3 rounded-2xl border border-border-light p-4 text-right transition hover:border-brand-200 dark:hover:border-brand-800"
        >
          <span className="min-w-0">
            <span className="block text-xs text-text-tertiary">Next</span>
            <span className="block truncate text-[15px] font-bold text-text-primary">{next.label}</span>
          </span>
          <Icon icon={ArrowRight01Icon} size={18} className="text-text-tertiary transition group-hover:translate-x-0.5" />
        </Link>
      )}
    </nav>
  );
}

/** Shown for an unknown page or endpoint under /developers. */
export function DeveloperNotFound({ what = "page" }: { what?: string }) {
  return (
    <DevelopersLayout
      title="API page not found"
      description="There is no Fintranzact API reference page at this address. Browse the overview and endpoint groups instead."
    >
      <div className="mx-auto flex max-w-2xl flex-col items-center px-4 py-24 text-center md:px-6">
        <IconCircle icon={Search01Icon} size="lg" />
        <h1 className={cn(HEADING, "mt-6 text-3xl leading-tight md:text-4xl")}>We could not find that {what}</h1>
        <p className="mt-4 text-lg leading-relaxed text-text-secondary">
          It may have moved. Use the menu or search to find an endpoint, or start from the overview.
        </p>
        <Link
          to="/developers"
          className="mt-8 inline-flex h-[52px] items-center gap-2 rounded-xl bg-brand-600 px-6 text-base font-bold text-white shadow-[0_12px_28px_-10px_rgba(59,94,170,.7)] transition hover:bg-brand-700"
        >
          <Icon icon={ArrowLeft01Icon} size={18} strokeWidth={2} />
          API overview
        </Link>
      </div>
    </DevelopersLayout>
  );
}
