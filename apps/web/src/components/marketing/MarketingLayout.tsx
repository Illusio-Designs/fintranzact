import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { Logo } from "@/components/ui/Logo";
import { cn } from "@/lib/utils";

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
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  usePageTitle(title);
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const year = new Date().getFullYear();

  useEffect(() => {
    setMenuOpen(false);
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="flex min-h-screen flex-col bg-surface-0 text-text-primary">
      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 border-b border-border-light bg-surface-0/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 md:px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <Logo className="h-8 w-8" />
            <span className="text-base font-semibold tracking-tight">Fintranzact</span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className={cn(
                  "rounded-md px-3 py-2 text-sm font-medium transition hover:text-text-primary",
                  pathname === link.to ? "text-text-primary" : "text-text-tertiary",
                )}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <Link to="/login" search={{ mode: "login" }} className="btn-ghost hidden sm:inline-flex">
              Log in
            </Link>
            <Link to="/login" search={{ mode: "register" }} className="btn-primary">
              Get started
            </Link>
            <button
              type="button"
              className="btn-ghost md:hidden"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                {menuOpen ? (
                  <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
                ) : (
                  <path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />
                )}
              </svg>
            </button>
          </div>
        </div>

        {menuOpen && (
          <nav className="border-t border-border-light px-4 py-3 md:hidden" aria-label="Mobile">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className="block rounded-md px-2 py-2 text-sm font-medium text-text-secondary hover:bg-surface-1"
              >
                {link.label}
              </Link>
            ))}
            <Link
              to="/login"
              search={{ mode: "login" }}
              className="block rounded-md px-2 py-2 text-sm font-medium text-text-secondary hover:bg-surface-1"
            >
              Log in
            </Link>
          </nav>
        )}
      </header>

      <main className="flex-1">{children}</main>

      {/* ── Footer ─────────────────────────────────────────────── */}
      <footer className="border-t border-border-light bg-surface-1">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 md:grid-cols-4 md:px-6">
          <div>
            <Link to="/" className="flex items-center gap-2.5">
              <Logo className="h-7 w-7" />
              <span className="text-sm font-semibold">Fintranzact</span>
            </Link>
            <p className="mt-3 text-sm text-text-tertiary">
              GST billing, inventory and accounting for Indian businesses.
            </p>
          </div>

          {FOOTER_COLUMNS.map((column) => (
            <div key={column.title}>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                {column.title}
              </h3>
              <ul className="mt-3 space-y-2 text-sm">
                {column.links.map((link) => (
                  <li key={link.label}>
                    {link.to ? (
                      <Link to={link.to} className="text-text-secondary hover:text-text-primary">
                        {link.label}
                      </Link>
                    ) : (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-text-secondary hover:text-text-primary"
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
        <div className="border-t border-border-light">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-5 text-xs text-text-tertiary md:flex-row md:items-center md:justify-between md:px-6">
            <span>© {year} Fintranzact. All rights reserved.</span>
            <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-text-primary">
              {CONTACT_EMAIL}
            </a>
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
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <section className="border-b border-border-light bg-surface-1">
      <div className="mx-auto max-w-6xl px-4 py-14 md:px-6 md:py-20">
        {eyebrow && (
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-600">
            {eyebrow}
          </p>
        )}
        <h1 className="mt-3 max-w-3xl text-3xl font-semibold leading-tight md:text-4xl">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-4 max-w-2xl text-base text-text-tertiary md:text-lg">{subtitle}</p>
        )}
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
    <section className="border-t border-border-light">
      <div className="mx-auto flex max-w-6xl flex-col items-start gap-5 px-4 py-14 md:flex-row md:items-center md:justify-between md:px-6">
        <div>
          <h2 className="text-xl font-semibold md:text-2xl">{title}</h2>
          <p className="mt-1 text-sm text-text-tertiary">{body}</p>
        </div>
        <Link to="/login" search={{ mode: "register" }} className="btn-primary">
          Get started free
        </Link>
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
      <article className="legal-prose mx-auto max-w-3xl px-4 py-12 text-sm leading-relaxed text-text-secondary md:px-6 md:text-base [&_a]:text-brand-600 [&_a]:underline [&_h2]:mb-3 [&_h2]:mt-10 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-text-primary [&_li]:mt-1.5 [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5">
        {children}
      </article>
    </MarketingLayout>
  );
}
