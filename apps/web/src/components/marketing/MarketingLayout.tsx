import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { Logo } from "@/components/ui/Logo";
import { cn } from "@/lib/utils";

import { Cancel01Icon, Menu01Icon } from "@hugeicons/core-free-icons";
import { Icon } from "@/components/ui/Icon";
import { useIndiaTimeTheme } from "@/hooks/useTheme";
/**
 * Shared chrome (header, footer, page title) for the public marketing pages.
 * These pages render for everyone — signed in or not — and never touch the
 * API, so they stay fast and crawlable.
 */

export const CONTACT_EMAIL = "support@fintranzact.com";
export const SECURITY_EMAIL = "security@fintranzact.com";
export const DOCS_URL = "https://docs.fintranzact.com";

/** Paths served by the marketing layout instead of the app shell. */
export const MARKETING_PATHS = [
  "/features",
  "/pricing",
  "/about",
  "/contact",
  "/privacy",
  "/terms",
  "/refund-policy",
  "/widgets",
];

export function isMarketingPath(pathname: string) {
  const path = pathname.replace(/\/+$/, "") || "/";
  return MARKETING_PATHS.includes(path);
}

const NAV_LINKS = [
  { to: "/features", label: "Features" },
  { to: "/pricing", label: "Pricing" },
  { to: "/about", label: "About" },
  { to: "/contact", label: "Contact" },
] as const;

const FOOTER_COLUMNS: Array<{
  title: string;
  links: Array<{ label: string; to?: string; href?: string }>;
}> = [
  {
    title: "Product",
    links: [
      { label: "Features", to: "/features" },
      { label: "Pricing", to: "/pricing" },
      { label: "Help & docs", href: DOCS_URL },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About us", to: "/about" },
      { label: "Contact", to: "/contact" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy policy", to: "/privacy" },
      { label: "Terms of service", to: "/terms" },
      { label: "Refund policy", to: "/refund-policy" },
    ],
  },
];

const DEFAULT_TITLE = "Fintranzact — Professional Billing for Indian Businesses";

export function usePageTitle(title?: string) {
  useEffect(() => {
    document.title = title ? `${title} — Fintranzact` : DEFAULT_TITLE;
    return () => {
      document.title = DEFAULT_TITLE;
    };
  }, [title]);
}

export function MarketingLayout({
  title,
  announcement,
  autoTheme = true,
  children,
}: {
  title?: string;
  /**
   * Follow the time of day in India (light by day, dark at night). Pages with
   * their own theme controls, like the widget gallery, turn this off.
   */
  autoTheme?: boolean;
  /** Optional slim strip above the header (used by the home page). */
  announcement?: ReactNode;
  children: ReactNode;
}) {
  usePageTitle(title);
  useIndiaTimeTheme(autoTheme);
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const year = new Date().getFullYear();

  useEffect(() => {
    setMenuOpen(false);
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="flex min-h-screen flex-col bg-surface-0 text-text-primary">
      {announcement && (
        <div className="bg-[#0b1530] px-4 py-2.5 text-center text-[13px] text-slate-300">{announcement}</div>
      )}

      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 border-b border-border-light bg-surface-0/90 backdrop-blur">
        <div className="mx-auto flex h-[72px] max-w-6xl items-center justify-between gap-4 px-4 md:px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <Logo className="h-[34px] w-[34px]" />
            <span className="font-display text-[19px] font-extrabold tracking-tight text-[#0f1b3d] dark:text-white">
              Fintranzact
            </span>
          </Link>

          <nav className="hidden items-center gap-1 lg:flex" aria-label="Main">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className={cn(
                  "rounded-md px-3.5 py-2.5 text-[15px] font-medium transition hover:text-text-primary",
                  pathname === link.to ? "text-text-primary" : "text-text-secondary",
                )}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <Link
              to="/login"
              search={{ mode: "login" }}
              className="hidden h-11 items-center px-4 text-[15px] font-semibold text-text-secondary hover:text-text-primary sm:inline-flex"
            >
              Log in
            </Link>
            <Link
              to="/login"
              search={{ mode: "register" }}
              className="inline-flex h-11 items-center rounded-[10px] bg-brand-600 px-5 text-[15px] font-semibold text-white shadow-[0_6px_16px_-6px_rgba(59,94,170,.6)] transition hover:bg-brand-700"
            >
              Start free
            </Link>
            <button
              type="button"
              className="btn-ghost lg:hidden"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <Icon icon={menuOpen ? Cancel01Icon : Menu01Icon} size={20} />
            </button>
          </div>
        </div>

        {menuOpen && (
          <nav className="border-t border-border-light px-4 py-3 lg:hidden" aria-label="Mobile">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className="block rounded-md px-2 py-3 text-[15px] font-medium text-text-secondary hover:bg-surface-1"
              >
                {link.label}
              </Link>
            ))}
            <Link
              to="/login"
              search={{ mode: "login" }}
              className="block rounded-md px-2 py-3 text-[15px] font-medium text-text-secondary hover:bg-surface-1"
            >
              Log in
            </Link>
          </nav>
        )}
      </header>

      <main className="flex-1">{children}</main>

      {/* ── Footer ─────────────────────────────────────────────── */}
      <footer className="bg-[#0b1530] text-slate-300">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-14 sm:grid-cols-2 md:grid-cols-5 md:px-6">
          <div className="md:col-span-2">
            <Link to="/" className="flex items-center gap-2.5">
              <Logo className="h-8 w-8" />
              <span className="font-display text-lg font-extrabold text-white">Fintranzact</span>
            </Link>
            <p className="mt-3.5 max-w-xs text-sm leading-relaxed text-[#93a3c4]">
              GST billing, inventory and accounting for Indian businesses.
            </p>
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="mt-4 inline-block text-sm font-semibold text-white hover:text-brand-200"
            >
              {CONTACT_EMAIL}
            </a>
          </div>

          {FOOTER_COLUMNS.map((column) => (
            <div key={column.title}>
              <h3 className="text-xs font-bold uppercase tracking-[0.1em] text-[#7f90b5]">{column.title}</h3>
              <ul className="mt-4 space-y-2.5 text-sm">
                {column.links.map((link) => (
                  <li key={link.label}>
                    {link.to ? (
                      <Link to={link.to} className="text-slate-300 hover:text-white">
                        {link.label}
                      </Link>
                    ) : (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-slate-300 hover:text-white"
                      >
                        {link.label}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="border-t border-white/10">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-5 text-[13px] text-[#7f90b5] md:flex-row md:items-center md:justify-between md:px-6">
            <span>© {year} Fintranzact. All rights reserved.</span>
            <span>Made in India for Indian businesses</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

/** Page-top banner used by every marketing page except the home page. */
export function PageHero({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  /** Optional extras under the subtitle, such as call-to-action buttons. */
  children?: ReactNode;
}) {
  return (
    <section className="landing-dots border-b border-border-light bg-[#f4f7fd] dark:bg-[#0d1530]">
      <div className="mx-auto max-w-6xl px-4 py-16 md:px-6 md:py-24">
        {eyebrow && (
          <p className="text-[13px] font-bold uppercase tracking-[0.14em] text-brand-600 dark:text-brand-300">
            {eyebrow}
          </p>
        )}
        <h1 className="mt-3 max-w-3xl font-display text-4xl font-extrabold leading-[1.1] tracking-[-0.025em] text-[#0f1b3d] md:text-5xl dark:text-white">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-slate-600 dark:text-slate-300">{subtitle}</p>
        )}
        {children}
      </div>
    </section>
  );
}

/** Closing sign-up band shared across pages. */
export function CtaBand({
  title = "Ready to set up your business?",
  body = "Sign up, pick a plan and add your business details in a few minutes.",
}: {
  title?: string;
  body?: string;
}) {
  return (
    <section>
      <div className="mx-auto max-w-6xl px-4 py-20 md:px-6">
        <div className="landing-dots-dark flex flex-col items-start gap-6 rounded-[28px] bg-brand-600 px-8 py-12 text-white md:flex-row md:items-center md:justify-between md:px-12">
          <div>
            <h2 className="font-display text-2xl font-extrabold tracking-[-0.02em] md:text-3xl">{title}</h2>
            <p className="mt-2 text-base text-[#dbe4f5]">{body}</p>
          </div>
          <Link
            to="/login"
            search={{ mode: "register" }}
            className="inline-flex h-[52px] shrink-0 items-center rounded-xl bg-white px-6 text-base font-bold text-brand-900 transition hover:bg-brand-50"
          >
            Get started free
          </Link>
        </div>
      </div>
    </section>
  );
}

/** Long-form prose wrapper for the legal pages. */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <MarketingLayout title={title}>
      <PageHero eyebrow="Legal" title={title} subtitle={`Last updated: ${updated}`} />
      <article className="legal-prose mx-auto max-w-3xl px-4 py-12 text-sm leading-relaxed text-text-secondary md:px-6 md:text-base [&_a]:text-brand-600 dark:[&_a]:text-brand-300 [&_a]:underline [&_h2]:mb-3 [&_h2]:mt-10 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-text-primary [&_li]:mt-1.5 [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5">
        {children}
      </article>
    </MarketingLayout>
  );
}
