import { useEffect, type ReactNode } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { Logo } from "@/components/ui/Logo";
import { absoluteUrl, resolveSiteUrl } from "@/lib/seo";

import { API_DOCS_URL, CONTACT_EMAIL, DOCS_URL, SiteHeader } from "./SiteHeader";

/**
 * Shared chrome (header, footer, page title) for the public marketing pages.
 * These pages render for everyone — signed in or not — and need no session,
 * so they stay fast and crawlable.
 */

export { API_DOCS_URL, CONTACT_EMAIL, DOCS_URL, SECURITY_EMAIL } from "./SiteHeader";

export { MARKETING_PATHS, isMarketingPath } from "@/lib/public-paths";

const FOOTER_COLUMNS: Array<{
  title: string;
  links: Array<{ label: string; to?: string; href?: string }>;
}> = [
  {
    title: "Product",
    links: [
      { label: "Features", to: "/features" },
      { label: "Pricing", to: "/pricing" },
      { label: "Solutions", to: "/solutions" },
      { label: "Widget gallery", to: "/widgets" },
      { label: "Help & docs", to: DOCS_URL },
      { label: "API docs", to: API_DOCS_URL },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About us", to: "/about" },
      { label: "Contact", to: "/contact" },
      { label: "Partner with us", to: "/partners" },
      { label: "Find a partner", to: "/find-a-partner" },
      { label: "Partner login", to: "/partner-portal" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy policy", to: "/privacy" },
      { label: "Terms of service", to: "/terms" },
      { label: "Refund policy", to: "/refund-policy" },
      { label: "Security", to: "/security" },
    ],
  },
];

const DEFAULT_TITLE = "Fintranzact — Professional Billing for Indian Businesses";
const DEFAULT_DESCRIPTION =
  "GST billing, inventory and accounting for Indian businesses. Invoices, e-invoicing, e-way bills, stock and reports in one place.";

const SITE_URL = resolveSiteUrl(import.meta.env.VITE_SITE_URL as string | undefined);

/** Set (or create) a <meta>/<link> attribute and return a function that puts the old value back. */
function setHeadTag(selector: string, create: () => HTMLElement, attr: string, value: string): () => void {
  let el = document.head.querySelector<HTMLElement>(selector);
  const created = !el;
  if (!el) {
    el = create();
    document.head.appendChild(el);
  }
  const previous = el.getAttribute(attr);
  el.setAttribute(attr, value);
  return () => {
    if (created) el.remove();
    else if (previous !== null) el.setAttribute(attr, previous);
  };
}

function metaTag(key: "name" | "property", name: string) {
  return () => {
    const el = document.createElement("meta");
    el.setAttribute(key, name);
    return el;
  };
}

/**
 * Title, description, canonical URL and the matching Open Graph / Twitter
 * tags for a marketing page. The canonical URL always uses the configured
 * site URL (VITE_SITE_URL), so previews and search results point at one host.
 */
export function usePageMeta({ title, description }: { title?: string; description?: string }) {
  const { pathname } = useLocation();
  useEffect(() => {
    const fullTitle = title ? `${title} — Fintranzact` : DEFAULT_TITLE;
    const desc = description ?? DEFAULT_DESCRIPTION;
    const url = absoluteUrl(SITE_URL, pathname);
    const previousTitle = document.title;
    document.title = fullTitle;
    const restore = [
      setHeadTag('meta[name="description"]', metaTag("name", "description"), "content", desc),
      setHeadTag(
        'link[rel="canonical"]',
        () => {
          const el = document.createElement("link");
          el.setAttribute("rel", "canonical");
          return el;
        },
        "href",
        url,
      ),
      setHeadTag('meta[property="og:url"]', metaTag("property", "og:url"), "content", url),
      setHeadTag('meta[property="og:title"]', metaTag("property", "og:title"), "content", fullTitle),
      setHeadTag('meta[property="og:description"]', metaTag("property", "og:description"), "content", desc),
      setHeadTag('meta[name="twitter:title"]', metaTag("name", "twitter:title"), "content", fullTitle),
      setHeadTag('meta[name="twitter:description"]', metaTag("name", "twitter:description"), "content", desc),
    ];
    return () => {
      document.title = previousTitle;
      restore.reverse().forEach((undo) => undo());
    };
  }, [title, description, pathname]);
}

export function MarketingLayout({
  title,
  description,
  announcement,
  children,
}: {
  title?: string;
  /** Meta description for search results and link previews. */
  description?: string;
  /**
   * Follow the time of day in India (light by day, dark at night). Pages with
   * their own theme controls, like the widget gallery, turn this off.
   */
  /** Optional slim strip above the header (used by the home page). */
  announcement?: ReactNode;
  children: ReactNode;
}) {
  usePageMeta({ title, description });
  // Theme follows the time of day in India, locked once by the root route
  // for every surface at once — nothing to do per-layout.
  const { pathname, hash } = useLocation();
  const year = new Date().getFullYear();

  // New page: start at the top, or at the linked section (e.g. /features#gst-compliance).
  useEffect(() => {
    const target = hash ? document.getElementById(hash) : null;
    if (target) target.scrollIntoView({ block: "start" });
    else window.scrollTo(0, 0);
  }, [pathname, hash]);

  return (
    <div className="flex min-h-screen flex-col bg-surface-0 text-text-primary">
      {announcement && (
        <div className="bg-[#0b1530] px-4 py-2.5 text-center text-[13px] text-slate-300">{announcement}</div>
      )}

      <SiteHeader />

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
            to="/register"
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
  description,
  children,
}: {
  title: string;
  updated: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <MarketingLayout
      title={title}
      description={
        description ?? `${title} for Fintranzact, the GST billing, inventory and accounting software for Indian businesses.`
      }
    >
      <PageHero eyebrow="Legal" title={title} subtitle={`Last updated: ${updated}`} />
      <article className="legal-prose mx-auto max-w-3xl px-4 py-12 text-sm leading-relaxed text-text-secondary md:px-6 md:text-base [&_a]:text-brand-600 dark:[&_a]:text-brand-300 [&_a]:underline [&_h2]:mb-3 [&_h2]:mt-10 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-text-primary [&_li]:mt-1.5 [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5">
        {children}
      </article>
    </MarketingLayout>
  );
}
