import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Briefcase01Icon,
  Calculator01Icon,
  Cancel01Icon,
  ComputerIcon,
  Menu01Icon,
  Search01Icon,
  SmartPhone01Icon,
} from "@hugeicons/core-free-icons";
import { Icon, type IconSvgElement } from "@/components/ui/Icon";
import { MarketingLayout } from "@/components/marketing/MarketingLayout";
import { HELP_ENTRIES, HELP_NAV, helpPath, type HelpNavGroup, type HelpNavLink } from "@/lib/help-paths";
import { searchHelp, type HelpSearchEntry } from "@/lib/help-content";
import { cn } from "@/lib/utils";
import "./help.css";

/**
 * The help centre's chrome inside the public site: a bar with search and the
 * device / role switchers, a sidebar of every article (a drawer on phones),
 * breadcrumbs, and previous / next links. Navigation never uses #hash links:
 * every entry is its own page, and "On this page" scrolls with buttons.
 */

// ── Reader preferences (device and role) ───────────────────────

type Platform = "desktop" | "mobile";
type Persona = "all" | "ca" | "business";

const PLATFORM_KEY = "fintranzact-docs-platform";
const PERSONA_KEY = "fintranzact-docs-persona";

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode: the choice lasts for this visit only.
  }
}

function initialPlatform(): Platform {
  const stored = readStorage(PLATFORM_KEY);
  if (stored === "desktop" || stored === "mobile") return stored;
  if (typeof window === "undefined") return "desktop";
  const phone = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth < 768;
  return phone ? "mobile" : "desktop";
}

function initialPersona(): Persona {
  const stored = readStorage(PERSONA_KEY);
  return stored === "ca" || stored === "business" ? stored : "all";
}

function useHelpPrefs() {
  const [platform, setPlatformState] = useState<Platform>(initialPlatform);
  const [persona, setPersonaState] = useState<Persona>(initialPersona);
  return {
    platform,
    persona,
    setPlatform: (p: Platform) => {
      setPlatformState(p);
      writeStorage(PLATFORM_KEY, p);
    },
    /** Picking the active role again goes back to showing both. */
    togglePersona: (p: Exclude<Persona, "all">) => {
      const next = persona === p ? "all" : p;
      setPersonaState(next);
      writeStorage(PERSONA_KEY, next);
    },
  };
}

type HelpPrefs = ReturnType<typeof useHelpPrefs>;

function Segmented<T extends string>({
  label,
  options,
  value,
  onSelect,
  className,
}: {
  label: string;
  options: Array<{ value: T; label: string; icon: IconSvgElement; title: string }>;
  value: T;
  onSelect: (v: T) => void;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn("flex rounded-lg border border-border-light bg-surface-1 p-0.5", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          aria-pressed={value === o.value}
          onClick={() => onSelect(o.value)}
          className={cn(
            "flex h-8 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-ui font-semibold",
            value === o.value
              ? "bg-surface-0 text-brand-700 shadow-sm dark:bg-surface-3 dark:text-white"
              : "text-text-tertiary hover:text-text-primary",
          )}
        >
          <Icon icon={o.icon} size={15} />
          {o.label}
        </button>
      ))}
    </div>
  );
}

function PrefSwitchers({ prefs, className }: { prefs: HelpPrefs; className?: string }) {
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      <Segmented
        label="Show instructions for"
        value={prefs.platform}
        onSelect={prefs.setPlatform}
        options={[
          { value: "desktop", label: "Desktop", icon: ComputerIcon, title: "Web and desktop app instructions" },
          { value: "mobile", label: "Mobile", icon: SmartPhone01Icon, title: "Mobile app instructions" },
        ]}
      />
      <Segmented
        label="I am a"
        value={prefs.persona}
        onSelect={(p) => p !== "all" && prefs.togglePersona(p)}
        options={[
          { value: "ca", label: "CA", icon: Calculator01Icon, title: "I'm a CA or accountant (click again to show everything)" },
          { value: "business", label: "Business", icon: Briefcase01Icon, title: "I run a business (click again to show everything)" },
        ]}
      />
    </div>
  );
}

// ── Search ─────────────────────────────────────────────────────

export function HelpSearch({ className, large = false }: { className?: string; large?: boolean }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const navigate = useNavigate();
  const listId = useId();
  const box = useRef<HTMLDivElement>(null);
  const results = useMemo(() => searchHelp(query), [query]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const go = (entry: HelpSearchEntry) => {
    setOpen(false);
    setQuery("");
    navigate({ to: helpPath(entry.slug) });
  };

  const showList = open && query.trim().length > 0;

  return (
    <div ref={box} className={cn("relative", className)}>
      <label className="sr-only" htmlFor={`${listId}-input`}>
        Search help articles
      </label>
      <Icon
        icon={Search01Icon}
        size={large ? 20 : 17}
        className={cn("pointer-events-none absolute top-1/2 -translate-y-1/2 text-text-tertiary", large ? "left-4" : "left-3")}
      />
      <input
        id={`${listId}-input`}
        type="search"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        placeholder="Search help articles"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && results[active]) {
            e.preventDefault();
            go(results[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        className={cn(
          "w-full rounded-xl border border-border-light bg-surface-0 text-text-primary placeholder:text-text-tertiary focus:border-brand-400 focus:outline-none",
          large ? "h-14 pl-12 pr-4 text-base shadow-[0_12px_30px_-18px_rgba(15,27,61,.35)]" : "h-10 pl-9 pr-3 text-sm",
        )}
      />
      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Matching articles"
          className="absolute left-0 right-0 top-full z-30 mt-2 max-h-[70vh] overflow-y-auto rounded-xl border border-border-light bg-surface-0 p-1.5 shadow-[0_24px_48px_-24px_rgba(15,27,61,.45)]"
        >
          {results.length === 0 ? (
            <li className="px-3 py-3 text-sm text-text-tertiary">No articles match “{query.trim()}”.</li>
          ) : (
            results.map((r, i) => (
              <li key={r.slug} role="option" aria-selected={i === active}>
                <Link
                  to={helpPath(r.slug)}
                  onClick={() => {
                    setOpen(false);
                    setQuery("");
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={cn("block rounded-lg px-3 py-2.5", i === active && "bg-brand-50 dark:bg-white/5")}
                >
                  <span className="block text-sm font-bold text-text-primary">{r.title}</span>
                  {r.trail.length > 0 && (
                    <span className="block text-xs font-semibold text-brand-600 dark:text-brand-300">{r.trail.join(" › ")}</span>
                  )}
                  {r.description && <span className="mt-0.5 line-clamp-2 block text-xs text-text-tertiary">{r.description}</span>}
                </Link>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

// ── Sidebar ────────────────────────────────────────────────────

function isGroup(item: HelpNavLink | HelpNavGroup): item is HelpNavGroup {
  return "items" in item;
}

function SidebarLink({ link, current }: { link: HelpNavLink; current: string }) {
  const active = link.slug === current;
  return (
    <Link
      to={helpPath(link.slug)}
      aria-current={active ? "page" : undefined}
      className={cn(
        "block rounded-md px-2.5 py-1.5 text-sm leading-snug",
        active
          ? "bg-brand-50 font-semibold text-brand-700 dark:bg-brand-900/40 dark:text-brand-100"
          : "text-text-secondary hover:bg-surface-1 hover:text-text-primary",
      )}
    >
      {link.label}
    </Link>
  );
}

function HelpSidebar({ current }: { current: string }) {
  return (
    <nav aria-label="Help articles" className="space-y-6 text-sm">
      <SidebarLink link={{ label: "Help centre home", slug: "" }} current={current} />
      {HELP_NAV.map((section) => (
        <div key={section.label}>
          <p className="px-2.5 text-xs font-bold uppercase tracking-[0.1em] text-text-tertiary">{section.label}</p>
          <ul className="mt-2 space-y-0.5">
            {section.items.map((item) =>
              isGroup(item) ? (
                <li key={item.label} className="pt-1.5">
                  <p className="px-2.5 pb-1 text-ui font-bold text-text-primary">{item.label}</p>
                  <ul className="ml-2.5 space-y-0.5 border-l border-border-light pl-1.5">
                    {item.items.map((link) => (
                      <li key={link.slug}>
                        <SidebarLink link={link} current={current} />
                      </li>
                    ))}
                  </ul>
                </li>
              ) : (
                <li key={item.slug}>
                  <SidebarLink link={item} current={current} />
                </li>
              ),
            )}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function MobileDrawer({ open, onClose, current, prefs }: { open: boolean; onClose: () => void; current: string; prefs: HelpPrefs }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Help articles">
      <button type="button" aria-label="Close menu" onClick={onClose} className="absolute inset-0 bg-[#0b1530]/50" />
      <div className="absolute inset-y-0 left-0 flex w-[88vw] max-w-sm flex-col bg-surface-0 shadow-2xl">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border-light px-4">
          <span className="font-display text-base font-extrabold text-text-primary">Help centre</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-1"
          >
            <Icon icon={Cancel01Icon} size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-4">
          <PrefSwitchers prefs={prefs} className="mb-6 px-1 [&>*]:w-full" />
          <HelpSidebar current={current} />
        </div>
      </div>
    </div>
  );
}

// ── On this page ───────────────────────────────────────────────

/** Visible h2s of the article, re-read when the device or role changes what is shown. */
function useHeadings(container: RefObject<HTMLElement | null>, deps: unknown[]) {
  const [headings, setHeadings] = useState<Array<{ id: string; text: string }>>([]);
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const read = () =>
      setHeadings(
        Array.from(el.querySelectorAll<HTMLHeadingElement>("h2[id]"))
          .filter((h) => h.offsetParent !== null || h.getClientRects().length > 0)
          .map((h) => ({ id: h.id, text: h.textContent ?? "" })),
      );
    read();
    const observer = new MutationObserver(read);
    observer.observe(el, { childList: true, subtree: true });
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return headings;
}

function OnThisPage({ headings }: { headings: Array<{ id: string; text: string }> }) {
  if (headings.length < 2) return null;
  return (
    <nav aria-label="On this page" className="text-sm">
      <p className="text-xs font-bold uppercase tracking-[0.1em] text-text-tertiary">On this page</p>
      <ul className="mt-3 space-y-1 border-l border-border-light">
        {headings.map((h) => (
          <li key={h.id}>
            <button
              type="button"
              onClick={() => document.getElementById(h.id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
              className="-ml-px block border-l border-transparent py-1 pl-3 text-left leading-snug text-text-tertiary hover:border-brand-400 hover:text-text-primary"
            >
              {h.text}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// ── Layout ─────────────────────────────────────────────────────

function neighbours(slug: string) {
  const i = HELP_ENTRIES.findIndex((e) => e.slug === slug);
  if (i < 0) return { prev: undefined, next: undefined };
  return { prev: HELP_ENTRIES[i - 1], next: HELP_ENTRIES[i + 1] };
}

export function HelpLayout({
  slug,
  title,
  description,
  children,
  wide = false,
}: {
  /** Current article slug ("" for the home page). */
  slug: string;
  title: string;
  description?: string;
  children: ReactNode;
  /** The home page: no sidebar, breadcrumbs or prev / next. */
  wide?: boolean;
}) {
  const prefs = useHelpPrefs();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { pathname } = useLocation();
  const article = useRef<HTMLDivElement>(null);
  const headings = useHeadings(article, [pathname, prefs.platform, prefs.persona]);
  const entry = HELP_ENTRIES.find((e) => e.slug === slug);
  const { prev, next } = neighbours(slug);

  useEffect(() => setDrawerOpen(false), [pathname]);

  return (
    <MarketingLayout title={slug ? `${title} · Help` : title} description={description}>
      <div data-help-platform={prefs.platform} data-help-persona={prefs.persona}>
        {/* ── Help bar ─────────────────────────────────────── */}
        <div className="sticky top-[73px] z-10 border-b border-border-light bg-surface-0/95 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 md:px-6">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="flex h-10 shrink-0 items-center gap-2 rounded-lg border border-border-light px-3 text-sm font-semibold text-text-primary lg:hidden"
            >
              <Icon icon={Menu01Icon} size={18} />
              <span className="hidden sm:inline">Articles</span>
              <span className="sr-only sm:hidden">Open help menu</span>
            </button>
            <Link to="/help" className="hidden shrink-0 font-display text-[15px] font-extrabold text-text-primary lg:block">
              Help centre
            </Link>
            <HelpSearch className="min-w-0 flex-1 lg:ml-6 lg:max-w-md" />
            <PrefSwitchers prefs={prefs} className="ml-auto hidden shrink-0 flex-nowrap md:flex" />
          </div>
        </div>

        <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} current={slug} prefs={prefs} />

        {wide ? (
          <div ref={article}>{children}</div>
        ) : (
          <div className="mx-auto flex max-w-7xl gap-10 px-4 md:px-6">
            <aside className="hidden w-64 shrink-0 lg:block">
              <div className="sticky top-[129px] max-h-[calc(100vh-129px)] overflow-y-auto py-8 pr-2">
                <HelpSidebar current={slug} />
              </div>
            </aside>

            <div className="min-w-0 flex-1 py-8 md:py-10">
              {/* Breadcrumbs */}
              <nav aria-label="Breadcrumb" className="text-ui text-text-tertiary">
                <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                  <li>
                    <Link to="/help" className="font-semibold text-brand-600 hover:underline dark:text-brand-300">
                      Help centre
                    </Link>
                  </li>
                  {entry?.trail.map((crumb) => (
                    <li key={crumb} className="flex items-center gap-1.5">
                      <span aria-hidden="true">›</span>
                      {crumb}
                    </li>
                  ))}
                  <li className="flex items-center gap-1.5">
                    <span aria-hidden="true">›</span>
                    <span aria-current="page" className="text-text-secondary">
                      {entry?.label ?? title}
                    </span>
                  </li>
                </ol>
              </nav>

              <div className="xl:flex xl:gap-10">
                <article className="min-w-0 max-w-3xl flex-1">
                  <h1 className="mt-4 font-display text-3xl font-extrabold leading-tight tracking-[-0.025em] text-[#0f1b3d] md:text-4xl dark:text-white">
                    {title}
                  </h1>
                  {description && <p className="mt-3 text-lg leading-relaxed text-text-secondary">{description}</p>}

                  {/* Device / role switchers for phones (the bar shows them on wider screens). */}
                  <PrefSwitchers prefs={prefs} className="mt-5 md:hidden" />

                  <div ref={article} className="help-prose mt-8">
                    {children}
                  </div>

                  {/* Previous / next */}
                  <nav aria-label="More articles" className="mt-14 grid gap-3 border-t border-border-light pt-8 sm:grid-cols-2">
                    {prev ? (
                      <Link
                        to={helpPath(prev.slug)}
                        className="group flex flex-col rounded-xl border border-border-light p-4 transition hover:border-brand-300"
                      >
                        <span className="flex items-center gap-1 text-xs font-semibold text-text-tertiary">
                          <Icon icon={ArrowLeft01Icon} size={14} />
                          Previous
                        </span>
                        <span className="mt-1 font-bold text-text-primary group-hover:text-brand-700 dark:group-hover:text-brand-200">
                          {prev.label}
                        </span>
                      </Link>
                    ) : (
                      <span className="hidden sm:block" />
                    )}
                    {next && (
                      <Link
                        to={helpPath(next.slug)}
                        className="group flex flex-col items-end rounded-xl border border-border-light p-4 text-right transition hover:border-brand-300"
                      >
                        <span className="flex items-center gap-1 text-xs font-semibold text-text-tertiary">
                          Next
                          <Icon icon={ArrowRight01Icon} size={14} />
                        </span>
                        <span className="mt-1 font-bold text-text-primary group-hover:text-brand-700 dark:group-hover:text-brand-200">
                          {next.label}
                        </span>
                      </Link>
                    )}
                  </nav>

                  <p className="mt-10 rounded-xl bg-surface-1 px-5 py-4 text-[15px] text-text-secondary">
                    Still stuck?{" "}
                    <Link to="/contact" className="font-semibold text-brand-600 hover:underline dark:text-brand-300">
                      Contact our support team
                    </Link>{" "}
                    and we will help you out.
                  </p>
                </article>

                <aside className="hidden w-56 shrink-0 xl:block">
                  <div className="sticky top-[153px] max-h-[calc(100vh-170px)] overflow-y-auto">
                    <OnThisPage headings={headings} />
                  </div>
                </aside>
              </div>
            </div>
          </div>
        )}
      </div>
    </MarketingLayout>
  );
}
