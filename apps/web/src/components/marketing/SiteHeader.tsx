import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { IN } from "country-flag-icons/react/3x2";
import {
  Analytics01Icon,
  ApiIcon,
  ArrowDown01Icon,
  ArrowRight02Icon,
  BankIcon,
  BookOpen01Icon,
  Briefcase01Icon,
  Building03Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  ComputerIcon,
  DeliveryTruck01Icon,
  DocumentValidationIcon,
  Factory01Icon,
  FileValidationIcon,
  HeadphonesIcon,
  Invoice01Icon,
  Legal01Icon,
  Mail01Icon,
  Medicine02Icon,
  Menu01Icon,
  Money03Icon,
  Note01Icon,
  PackageIcon,
  QrCodeIcon,
  QuoteDownIcon,
  RepeatIcon,
  Restaurant01Icon,
  Route01Icon,
  Shield01Icon,
  ShoppingBasket01Icon,
  ShoppingCart01Icon,
  SmartPhone01Icon,
  Store01Icon,
  TaxesIcon,
  TShirtIcon,
  TvSmartIcon,
  UserGroupIcon,
  Wallet01Icon,
} from "@hugeicons/core-free-icons";
import { Logo } from "@/components/ui/Logo";
import { Icon, type IconSvgElement } from "@/components/ui/Icon";
import { cn } from "@/lib/utils";

/**
 * Public-site header in the style of Zoho Books: logo on the left, the main
 * navigation on the right with mega menus for Features, Solutions and
 * Resources, a region pill, and the sign-in / sign-up actions.
 */

export const CONTACT_EMAIL = "support@fintranzact.com";
export const SECURITY_EMAIL = "security@fintranzact.com";
export const DOCS_URL = "https://docs.fintranzact.com";

type MenuLink = {
  label: string;
  icon: IconSvgElement;
  /** Internal route, optionally with a hash (section on that page). */
  to?: string;
  hash?: string;
  /** External link or mailto. */
  href?: string;
};

type MenuColumn = { title: string; links: MenuLink[] };

type MegaMenu = {
  id: "features" | "solutions" | "resources";
  label: string;
  columns: MenuColumn[];
  /** Full-width link under the columns. */
  footer?: { label: string; to: string };
  promo?: "devices" | "talk";
};

const f = (label: string, icon: IconSvgElement, hash: string): MenuLink => ({ label, icon, to: "/features", hash });

const MENUS: MegaMenu[] = [
  {
    id: "features",
    label: "Features",
    columns: [
      {
        title: "Core features",
        links: [
          f("Invoicing", Invoice01Icon, "sales-billing"),
          f("Quotations & proforma", QuoteDownIcon, "sales-billing"),
          f("Delivery challans", DeliveryTruck01Icon, "sales-billing"),
          f("Credit notes & returns", Note01Icon, "sales-billing"),
          f("Point of sale", ShoppingCart01Icon, "sales-billing"),
          f("Payments", Money03Icon, "accounting-banking"),
          f("Expenses", Wallet01Icon, "accounting-banking"),
          f("Banking", BankIcon, "accounting-banking"),
          f("Inventory", PackageIcon, "inventory-fulfilment"),
          f("Online store", Store01Icon, "inventory-fulfilment"),
          f("Reporting", Analytics01Icon, "accounting-banking"),
        ],
      },
      {
        title: "GST & compliance",
        links: [
          f("GST filing", TaxesIcon, "gst-compliance"),
          f("e-Invoicing", QrCodeIcon, "gst-compliance"),
          f("e-Way bills", Route01Icon, "gst-compliance"),
          f("GSTR-2B & ITC", DocumentValidationIcon, "gst-compliance"),
        ],
      },
      {
        title: "Effortless accounting",
        links: [
          f("Mobile & desktop apps", SmartPhone01Icon, "teams-platform"),
          f("Recurring invoices", RepeatIcon, "sales-billing"),
          f("Team roles & access", UserGroupIcon, "teams-platform"),
          f("API & integrations", ApiIcon, "teams-platform"),
        ],
      },
    ],
    footer: { label: "See all features", to: "/features" },
    promo: "devices",
  },
  {
    id: "solutions",
    label: "Solutions",
    columns: [
      {
        title: "By industry",
        links: [
          { label: "Retail & kirana", icon: ShoppingBasket01Icon, to: "/solutions/retail" },
          { label: "Wholesale & distribution", icon: DeliveryTruck01Icon, to: "/solutions/wholesale" },
          { label: "Manufacturing", icon: Factory01Icon, to: "/solutions/manufacturing" },
          { label: "Services & agencies", icon: Briefcase01Icon, to: "/solutions/services" },
          { label: "Pharmacy", icon: Medicine02Icon, to: "/solutions/pharmacy" },
          { label: "Restaurants & cafés", icon: Restaurant01Icon, to: "/solutions/restaurants" },
          { label: "Electronics", icon: TvSmartIcon, to: "/solutions/electronics" },
          { label: "Apparel & textiles", icon: TShirtIcon, to: "/solutions/apparel" },
        ],
      },
      {
        title: "By business size",
        links: [
          { label: "Freelancers & small shops", icon: Store01Icon, to: "/solutions/freelancers" },
          { label: "Growing businesses", icon: Analytics01Icon, to: "/solutions/growing-businesses" },
          { label: "Multi-branch & multi-GSTIN", icon: Building03Icon, to: "/solutions/multi-branch" },
          { label: "Accountants & CAs", icon: FileValidationIcon, to: "/solutions/accountants" },
        ],
      },
    ],
    footer: { label: "See all solutions", to: "/solutions" },
    promo: "talk",
  },
  {
    id: "resources",
    label: "Resources",
    columns: [
      {
        title: "Learn",
        links: [
          { label: "Help & docs", icon: BookOpen01Icon, href: DOCS_URL },
          { label: "About Fintranzact", icon: Building03Icon, to: "/about" },
          { label: "Contact us", icon: HeadphonesIcon, to: "/contact" },
          { label: "Partner with us", icon: UserGroupIcon, to: "/partners" },
          { label: "Email us", icon: Mail01Icon, href: `mailto:${CONTACT_EMAIL}` },
        ],
      },
      {
        title: "Trust & legal",
        links: [
          { label: "Security", icon: Shield01Icon, href: `mailto:${SECURITY_EMAIL}` },
          { label: "Privacy policy", icon: Legal01Icon, to: "/privacy" },
          { label: "Terms of service", icon: Legal01Icon, to: "/terms" },
          { label: "Refund policy", icon: Legal01Icon, to: "/refund-policy" },
        ],
      },
    ],
  },
];

type NavItem = { kind: "menu"; menu: MegaMenu } | { kind: "link"; label: string; to: string };

const NAV: NavItem[] = [
  { kind: "menu", menu: MENUS[0] },
  { kind: "link", label: "Pricing", to: "/pricing" },
  { kind: "menu", menu: MENUS[1] },
  { kind: "link", label: "About", to: "/about" },
  { kind: "link", label: "Partner with us", to: "/partners" },
  { kind: "menu", menu: MENUS[2] },
];

const LINK_ROW =
  "flex items-center gap-3 rounded-lg px-2 py-2 text-[15px] text-text-secondary transition hover:bg-brand-50 hover:text-brand-700 dark:hover:bg-white/5 dark:hover:text-white";

function MenuItemLink({ link, onNavigate }: { link: MenuLink; onNavigate: () => void }) {
  const content = (
    <>
      <Icon icon={link.icon} size={19} className="shrink-0 text-text-tertiary" />
      <span>{link.label}</span>
    </>
  );
  if (link.href) {
    const external = link.href.startsWith("http");
    return (
      <a
        href={link.href}
        className={LINK_ROW}
        onClick={onNavigate}
        {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      >
        {content}
      </a>
    );
  }
  return (
    <Link to={link.to!} hash={link.hash} className={LINK_ROW} onClick={onNavigate}>
      {content}
    </Link>
  );
}

function DevicesPromo() {
  return (
    <div>
      {/* A small product preview, drawn with the brand palette. */}
      <div className="rounded-2xl bg-gradient-to-br from-brand-100 to-brand-200 p-4 dark:from-[#1b2a52] dark:to-[#223463]">
        <div className="overflow-hidden rounded-lg bg-white shadow-[0_12px_30px_-12px_rgba(15,27,61,.45)] dark:bg-[#0f1b3d]">
          <div className="flex items-center gap-1.5 border-b border-slate-100 px-3 py-2 dark:border-white/10">
            <span className="h-2 w-2 rounded-full bg-brand-600" />
            <span className="h-1.5 w-16 rounded bg-slate-200 dark:bg-white/15" />
          </div>
          <div className="grid grid-cols-[52px_1fr] gap-3 p-3">
            <div className="space-y-1.5">
              {[0, 1, 2, 3, 4].map((i) => (
                <span key={i} className={cn("block h-1.5 rounded", i === 0 ? "bg-brand-500" : "bg-slate-200 dark:bg-white/15")} />
              ))}
            </div>
            <div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md bg-brand-50 p-2 dark:bg-white/5">
                  <span className="block h-1 w-8 rounded bg-slate-300 dark:bg-white/20" />
                  <span className="mt-1.5 block text-[11px] font-bold text-[#0f1b3d] dark:text-white">₹4,82,300</span>
                </div>
                <div className="rounded-md bg-brand-50 p-2 dark:bg-white/5">
                  <span className="block h-1 w-8 rounded bg-slate-300 dark:bg-white/20" />
                  <span className="mt-1.5 block text-[11px] font-bold text-[#0f1b3d] dark:text-white">₹1,26,940</span>
                </div>
              </div>
              <svg viewBox="0 0 120 36" className="mt-2 h-9 w-full" aria-hidden="true">
                <path d="M0 30 L20 26 L40 27 L60 16 L80 12 L100 8 L120 6 L120 36 L0 36 Z" className="fill-brand-100 dark:fill-brand-900/60" />
                <path d="M0 30 L20 26 L40 27 L60 16 L80 12 L100 8 L120 6" fill="none" strokeWidth="2" className="stroke-brand-600 dark:stroke-brand-300" />
              </svg>
            </div>
          </div>
        </div>
      </div>
      <p className="mt-6 text-base font-bold text-text-primary">Accounting across devices</p>
      <p className="mt-1.5 text-sm leading-relaxed text-text-secondary">
        Bill from the browser, the desktop app or your phone. Your books stay in sync everywhere, anytime.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {[
          [ComputerIcon, "Web"],
          [ComputerIcon, "Desktop"],
          [SmartPhone01Icon, "Mobile"],
        ].map(([icon, label]) => (
          <span
            key={label as string}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#0f1b3d] px-3 py-1.5 text-xs font-semibold text-white dark:bg-white dark:text-[#0f1b3d]"
          >
            <Icon icon={icon as IconSvgElement} size={15} />
            {label as string}
          </span>
        ))}
      </div>
    </div>
  );
}

function TalkPromo({ onNavigate }: { onNavigate: () => void }) {
  return (
    <div>
      <p className="text-base font-bold text-text-primary">Not sure where to start?</p>
      <p className="mt-1.5 text-sm leading-relaxed text-text-secondary">
        Tell us how your business runs and we will help you set up invoicing, GST and stock the right way.
      </p>
      <ul className="mt-4 space-y-2 text-sm text-text-secondary">
        {["Free setup help", "Import from spreadsheets", "Talk to a real person"].map((t) => (
          <li key={t} className="flex items-center gap-2">
            <Icon icon={CheckmarkCircle02Icon} size={17} className="text-brand-600 dark:text-brand-300" />
            {t}
          </li>
        ))}
      </ul>
      <Link
        to="/contact"
        onClick={onNavigate}
        className="mt-5 inline-flex h-10 items-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white transition hover:bg-brand-700"
      >
        Talk to us
        <Icon icon={ArrowRight02Icon} size={16} />
      </Link>
    </div>
  );
}

function MegaPanel({ menu, onNavigate }: { menu: MegaMenu; onNavigate: () => void }) {
  const hasPromo = Boolean(menu.promo);
  const [first, ...rest] = menu.columns;
  return (
    <div className="mx-auto max-w-7xl px-4 md:px-6">
      <div
        className={cn(
          "overflow-hidden rounded-b-2xl border border-t-0 border-border-light bg-surface-0 shadow-[0_30px_60px_-30px_rgba(15,27,61,.35)]",
          hasPromo ? "grid lg:grid-cols-[1fr_340px]" : "",
        )}
      >
        <div className="p-8">
          <div className={cn("grid gap-x-10 gap-y-8", hasPromo ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:max-w-2xl")}>
            <MenuColumnBlock column={first} onNavigate={onNavigate} />
            {/* Remaining columns stack in the second column, like Zoho's
                "Compliance" over "Effortless Accounting". */}
            {rest.length > 0 && (
              <div className="space-y-8">
                {rest.map((column) => (
                  <MenuColumnBlock key={column.title} column={column} onNavigate={onNavigate} />
                ))}
              </div>
            )}
          </div>
          {menu.footer && (
            <Link
              to={menu.footer.to}
              onClick={onNavigate}
              className="mt-8 flex h-12 items-center justify-center gap-2 rounded-xl bg-brand-50 text-[15px] font-semibold text-brand-700 transition hover:bg-brand-100 dark:bg-white/5 dark:text-brand-200 dark:hover:bg-white/10"
            >
              {menu.footer.label}
              <span className="grid h-5 w-5 place-items-center rounded-full bg-brand-600 text-white">
                <Icon icon={ArrowRight02Icon} size={13} />
              </span>
            </Link>
          )}
        </div>
        {menu.promo && (
          <div className="hidden border-l border-border-light bg-brand-50/70 p-8 dark:bg-[#111c3a] lg:block">
            {menu.promo === "devices" ? <DevicesPromo /> : <TalkPromo onNavigate={onNavigate} />}
          </div>
        )}
      </div>
    </div>
  );
}

function MenuColumnBlock({ column, onNavigate }: { column: MenuColumn; onNavigate: () => void }) {
  return (
    <div>
      <p className="border-b border-border-light pb-3 text-[17px] font-bold text-text-primary">{column.title}</p>
      <ul className="mt-3 space-y-0.5">
        {column.links.map((link) => (
          <li key={link.label}>
            <MenuItemLink link={link} onNavigate={onNavigate} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function RegionPill() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative hidden xl:block">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="Region: India, English"
        onClick={() => setOpen((o) => !o)}
        className="flex h-10 items-center gap-2 whitespace-nowrap rounded-full border border-border-light px-3 text-[13px] font-bold text-text-primary transition hover:border-border-medium"
      >
        <IN className="h-[18px] w-[18px] rounded-full object-cover shadow-[0_0_0_1px_rgba(0,0,0,0.08)] [clip-path:circle(50%)]" aria-hidden="true" />
        IN-EN
        <Icon icon={ArrowDown01Icon} size={15} className={cn("transition", open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 w-60 rounded-xl border border-border-light bg-surface-0 p-2 shadow-[0_20px_40px_-20px_rgba(15,27,61,.4)]">
          <div className="flex items-center gap-2.5 rounded-lg bg-brand-50 px-3 py-2.5 text-sm font-semibold text-text-primary dark:bg-white/5">
            <IN className="h-3.5 w-[21px] rounded-[3px]" aria-hidden="true" />
            India · English
            <Icon icon={CheckmarkCircle02Icon} size={17} className="ml-auto text-brand-600 dark:text-brand-300" />
          </div>
          <p className="px-3 pb-1 pt-2.5 text-xs text-text-tertiary">Prices in ₹ with Indian GST. More regions coming soon.</p>
        </div>
      )}
    </div>
  );
}

function NavTrigger({
  label,
  open,
  onToggle,
  onHover,
  controls,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  onHover: () => void;
  controls: string;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
      onMouseEnter={onHover}
      className={cn(
        "flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-2.5 text-[14px] font-medium transition hover:text-text-primary xl:px-3 xl:text-[15px]",
        open ? "text-brand-700 dark:text-white" : "text-text-secondary",
      )}
    >
      {label}
      <Icon icon={ArrowDown01Icon} size={16} className={cn("transition", open && "rotate-180")} />
    </button>
  );
}

export function SiteHeader() {
  const { pathname } = useLocation();
  const [openMenu, setOpenMenu] = useState<MegaMenu["id"] | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileSection, setMobileSection] = useState<MegaMenu["id"] | null>(null);
  const headerRef = useRef<HTMLElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);

  const close = () => {
    window.clearTimeout(closeTimer.current);
    setOpenMenu(null);
    setMobileOpen(false);
  };

  useEffect(close, [pathname]);

  useEffect(() => {
    if (!openMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenMenu(null);
    };
    const onDown = (e: MouseEvent) => {
      if (!headerRef.current?.contains(e.target as Node)) setOpenMenu(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [openMenu]);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  const hoverOpen = (id: MegaMenu["id"] | null) => {
    window.clearTimeout(closeTimer.current);
    setOpenMenu(id);
  };
  const scheduleClose = () => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpenMenu(null), 180);
  };

  const active = MENUS.find((m) => m.id === openMenu);

  return (
    <header
      ref={headerRef}
      className="sticky top-0 z-20 border-b border-border-light bg-surface-0/95 backdrop-blur"
      onMouseLeave={scheduleClose}
    >
      <div className="mx-auto flex h-[72px] max-w-7xl items-center gap-4 px-4 md:px-6">
        <Link to="/" className="flex shrink-0 items-center gap-2.5" onMouseEnter={() => hoverOpen(null)}>
          <Logo className="h-[34px] w-[34px]" />
          <span className="font-display text-[19px] font-extrabold tracking-tight text-[#0f1b3d] dark:text-white">
            Fintranzact
          </span>
        </Link>

        <nav className="ml-auto hidden items-center lg:flex" aria-label="Main">
          {NAV.map((item) =>
            item.kind === "menu" ? (
              <NavTrigger
                key={item.menu.id}
                label={item.menu.label}
                open={openMenu === item.menu.id}
                controls={`mega-${item.menu.id}`}
                onHover={() => hoverOpen(item.menu.id)}
                onToggle={() => setOpenMenu((cur) => (cur === item.menu.id ? null : item.menu.id))}
              />
            ) : (
              <Link
                key={item.to}
                to={item.to}
                onMouseEnter={() => hoverOpen(null)}
                className={cn(
                  "whitespace-nowrap rounded-md px-2 py-2.5 text-[14px] font-medium transition hover:text-text-primary xl:px-3 xl:text-[15px]",
                  pathname === item.to ? "text-text-primary" : "text-text-secondary",
                )}
              >
                {item.label}
              </Link>
            ),
          )}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2 lg:ml-2">
          <RegionPill />
          <Link
            to="/login"
            className="hidden h-11 items-center whitespace-nowrap px-3 text-[15px] font-semibold text-text-secondary hover:text-text-primary sm:inline-flex"
          >
            Log in
          </Link>
          <Link
            to="/register"
            className="inline-flex h-11 items-center whitespace-nowrap rounded-[10px] bg-brand-600 px-5 text-[15px] font-semibold text-white shadow-[0_6px_16px_-6px_rgba(59,94,170,.6)] transition hover:bg-brand-700"
          >
            Start free
          </Link>
          <button
            type="button"
            className="btn-ghost lg:hidden"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((o) => !o)}
          >
            <Icon icon={mobileOpen ? Cancel01Icon : Menu01Icon} size={20} />
          </button>
        </div>
      </div>

      {/* Desktop mega menu */}
      {active && (
        <div
          id={`mega-${active.id}`}
          className="absolute inset-x-0 top-full hidden lg:block"
          onMouseEnter={() => hoverOpen(active.id)}
        >
          <MegaPanel menu={active} onNavigate={close} />
        </div>
      )}

      {/* Mobile menu: the same links as accordions */}
      {mobileOpen && (
        <nav className="max-h-[calc(100vh-72px)] overflow-y-auto border-t border-border-light px-4 py-3 lg:hidden" aria-label="Mobile">
          {NAV.map((item) =>
            item.kind === "menu" ? (
              <MobileSection
                key={item.menu.id}
                menu={item.menu}
                open={mobileSection === item.menu.id}
                onToggle={() => setMobileSection((cur) => (cur === item.menu.id ? null : item.menu.id))}
                onNavigate={close}
              />
            ) : (
              <Link
                key={item.to}
                to={item.to}
                className="block rounded-md px-2 py-3 text-[15px] font-medium text-text-secondary hover:bg-surface-1"
              >
                {item.label}
              </Link>
            ),
          )}
          <Link
            to="/login"
            className="block rounded-md px-2 py-3 text-[15px] font-medium text-text-secondary hover:bg-surface-1"
          >
            Log in
          </Link>
        </nav>
      )}
    </header>
  );
}

function MobileSection({
  menu,
  open,
  onToggle,
  onNavigate,
}: {
  menu: MegaMenu;
  open: boolean;
  onToggle: () => void;
  onNavigate: () => void;
}): ReactNode {
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-center justify-between rounded-md px-2 py-3 text-[15px] font-medium text-text-secondary hover:bg-surface-1"
      >
        {menu.label}
        <Icon icon={ArrowDown01Icon} size={16} className={cn("transition", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-4 pb-3 pl-2">
          {menu.columns.map((column) => (
            <div key={column.title}>
              <p className="px-2 pt-1 text-xs font-bold uppercase tracking-[0.1em] text-text-tertiary">{column.title}</p>
              <ul className="mt-1">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <MenuItemLink link={link} onNavigate={onNavigate} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {menu.footer && (
            <Link to={menu.footer.to} onClick={onNavigate} className="block px-2 text-sm font-semibold text-brand-600 dark:text-brand-300">
              {menu.footer.label} →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
