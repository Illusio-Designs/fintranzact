import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Add01Icon,
  ArrowRight01Icon,
  ArrowUpRight01Icon,
  CheckmarkCircle02Icon,
  CloudUploadIcon,
  ComputerIcon,
  Database01Icon,
  Download04Icon,
  Invoice01Icon,
  PackageIcon,
  QrCodeIcon,
  SecurityCheckIcon,
  SmartPhone01Icon,
  Tick02Icon,
  UserGroupIcon,
  CreditCardIcon,
  ChartBarLineIcon,
} from "@hugeicons/core-free-icons";
import { MarketingLayout, CONTACT_EMAIL } from "@/components/marketing/MarketingLayout";
import { Icon, type IconSvgElement } from "@/components/ui/Icon";
import { Logo } from "@/components/ui/Logo";
import { EYEBROW, FaqAccordion, HEADING, PricingCards } from "@/components/marketing/sections";
import { cn } from "@/lib/utils";

/**
 * Public landing page shown at "/" to visitors who are not signed in.
 * Sign-up and sign-in happen on /login; this page only links there.
 * Figures in the product previews are illustrative sample data.
 */

const NAVY = "bg-[#0f1b3d]";

const INDUSTRIES = [
  "Retail & kirana",
  "Wholesale & distribution",
  "Manufacturing",
  "Services & agencies",
  "Pharmacy",
  "Restaurants & cafés",
  "Electronics",
  "Apparel & textiles",
];

type TabId = "invoicing" | "gst" | "stock" | "payments" | "reports";

const TABS: Array<{
  id: TabId;
  label: string;
  title: string;
  body: string;
  points: Array<{ name: string; body: string }>;
}> = [
  {
    id: "invoicing",
    label: "Invoicing",
    title: "Professional GST invoices in seconds",
    body: "Pick a party, add items and Fintranzact works out CGST, SGST, IGST and cess for you — ready to print, download or share.",
    points: [
      { name: "GST invoices", body: "sale and purchase invoices with HSN/SAC and tax worked out." },
      { name: "Quotations & proforma", body: "send estimates, then convert them to invoices in one click." },
      { name: "Recurring invoices", body: "automate monthly billing for retainers and subscriptions." },
      { name: "Point of sale", body: "a fast checkout screen for walk-in customers." },
    ],
  },
  {
    id: "gst",
    label: "GST & e-Invoice",
    title: "Stay GST-compliant without the busywork",
    body: "Returns are built from your transactions as you bill, and e-Invoices and e-Way Bills come straight from your invoices.",
    points: [
      { name: "e-Invoicing", body: "generate IRN and signed QR codes directly from invoices." },
      { name: "e-Way bills", body: "create and track e-way bills for goods in transit." },
      { name: "GSTR-1 & GSTR-3B", body: "file-ready return summaries from your data." },
      { name: "GSTR-2B reconciliation", body: "match supplier data against your purchases." },
    ],
  },
  {
    id: "stock",
    label: "Inventory",
    title: "Always know what's in stock",
    body: "Stock updates itself as you buy and sell, across items, variants and warehouses.",
    points: [
      { name: "Items & variants", body: "units, variants, pricing and tax rates per item." },
      { name: "Stock tracking", body: "levels update automatically with every sale and purchase." },
      { name: "Shipments", body: "track dispatches and deliveries for your orders." },
      { name: "Online store", body: "publish a storefront and receive orders into your books." },
    ],
  },
  {
    id: "payments",
    label: "Payments & banking",
    title: "Get paid faster and keep banks in sync",
    body: "See who owes you, record receipts in any mode and reconcile bank statements against your books.",
    points: [
      { name: "Payments", body: "record receipts and payments against invoices." },
      { name: "Cash & bank", body: "manage every cash and bank account in one place." },
      { name: "Bank reconciliation", body: "import statements and match them to your books." },
      { name: "Expenses", body: "log expenses by category, with GST where it applies." },
    ],
  },
  {
    id: "reports",
    label: "Reports",
    title: "Your numbers, always up to date",
    body: "Financial statements and tax reports are ready the moment you need them — no year-end scramble.",
    points: [
      { name: "Profit & loss", body: "see margins by month, quarter or financial year." },
      { name: "Balance sheet", body: "assets, liabilities and equity at any date." },
      { name: "Day book & ledgers", body: "every entry, party by party." },
      { name: "Stock & tax reports", body: "stock valuation, ITC and GST summaries." },
    ],
  },
];

const TILES: Array<[string, string, string]> = [
  ["QP", "Quotations & proforma", "Estimates that turn into invoices in one click."],
  ["DC", "Delivery challans", "Move goods now and invoice them later."],
  ["RI", "Recurring invoices", "Monthly billing on autopilot."],
  ["POS", "Point of sale", "Fast checkout for walk-in customers."],
  ["EWB", "e-Way bills", "Create and track bills for goods in transit."],
  ["BR", "Bank reconciliation", "Match statements to your books."],
  ["OS", "Online store", "Take orders straight into your books."],
  ["MB", "Multiple businesses", "Several GSTINs under one login."],
  ["RP", "Roles & permissions", "The right access for staff and accountants."],
  ["API", "API & integrations", "Connect your own tools and workflows."],
  ["IB", "Import & backup", "Bring data in, take it out any time."],
  ["EX", "Expenses", "Track spend by category with GST."],
];

const TILE_TONES = [
  "bg-brand-50 text-brand-600 dark:bg-brand-900/50 dark:text-brand-200",
  "bg-[#f1f4fb] text-brand-700 dark:bg-brand-900/40 dark:text-brand-100",
  "bg-[#e3eaf7] text-brand-900 dark:bg-brand-950 dark:text-brand-300",
  "bg-[#dde5f5] text-brand-600 dark:bg-brand-800/40 dark:text-brand-200",
];

const FAQS = [
  {
    q: "Is the free plan really free forever?",
    a: "Yes. The Forever Free plan has no time limit, no invoice cap and no Fintranzact branding on your documents.",
  },
  {
    q: "Do I need a credit card to sign up?",
    a: "No. Create an account with your email or phone number and start billing straight away.",
  },
  {
    q: "Does Fintranzact handle e-Invoicing and e-Way Bills?",
    a: "Yes. Generate IRN, signed QR codes and e-way bills directly from your invoices, and get file-ready GSTR-1 and GSTR-3B summaries.",
  },
  {
    q: "Can I bring my existing data?",
    a: "Yes. Import parties and items from spreadsheets, or bring in exports from your previous billing software.",
  },
  {
    q: "Can my accountant and staff use it too?",
    a: "Yes. Invite your team and your accountant with role-based access, across as many businesses as you run.",
  },
  {
    q: "How is Pro and Business pricing decided?",
    a: "Paid plans are priced to your team size and needs. Contact us and we'll send a quote.",
  },
];

export function LandingPage() {
  return (
    <MarketingLayout
      description="GST billing, inventory and accounting for Indian businesses. Send GST invoices, generate e-invoices and e-way bills, track stock and file returns from web, desktop or mobile."
      announcement={
        <span className="inline-flex flex-wrap items-center justify-center gap-2.5">
          <span className="rounded-full bg-brand-600 px-2 py-0.5 text-[11px] font-bold tracking-wide text-white">NEW</span>
          <span>e-Invoicing and e-Way Bills are built into every plan.</span>
          <Link to="/features" className="inline-flex items-center gap-0.5 font-semibold text-white hover:underline">
            See how
            <Icon icon={ArrowRight01Icon} size={14} strokeWidth={2} />
          </Link>
        </span>
      }
    >
      <Hero />
      <Industries />
      <FeatureTabs />
      <FeatureGrid />
      <Steps />
      <AnywhereAndData />
      <Pricing />
      <Faq />
      <FinalCta />
    </MarketingLayout>
  );
}

// ─── Hero ─────────────────────────────────────────────────────────────────────

function Hero() {
  return (
    <section className="landing-dots overflow-hidden border-b border-border-light bg-[#f4f7fd] dark:bg-[#0d1530]">
      <div className="mx-auto grid max-w-6xl items-center gap-14 px-4 pb-24 pt-16 md:px-6 lg:grid-cols-2 lg:pb-28 lg:pt-24">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-[#dde4f2] bg-white py-1.5 pl-2 pr-3.5 text-[13px] text-slate-700 shadow-sm dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
            <span className="h-2 w-2 rounded-full bg-brand-600 ring-4 ring-brand-600/20 dark:bg-brand-300 dark:ring-brand-300/20" />
            Billing &amp; accounting for Indian businesses
          </span>
          <h1 className={cn(HEADING, "mt-6 text-4xl leading-[1.08] sm:text-5xl lg:text-[58px]")}>
            GST billing, stock and books —{" "}
            <span className="text-brand-600 dark:text-brand-300">done right.</span>
          </h1>
          <p className="mt-5 max-w-lg text-lg leading-relaxed text-slate-600 dark:text-slate-300">
            Create GST invoices in seconds, generate e-Invoices and e-Way Bills, track stock and payments, and get
            file-ready returns — in one app your whole team can use.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to="/register"
              className="inline-flex h-[54px] items-center gap-2 rounded-xl bg-brand-600 px-6 text-base font-bold text-white shadow-[0_12px_28px_-10px_rgba(59,94,170,.7)] transition hover:bg-brand-700"
            >
              Start free — no card needed
              <Icon icon={ArrowRight01Icon} size={18} strokeWidth={2} />
            </Link>
            <Link
              to="/features"
              className="inline-flex h-[54px] items-center rounded-xl border border-[#cfd8ea] bg-white px-6 text-base font-semibold text-[#0f1b3d] transition hover:border-brand-300 dark:border-white/15 dark:bg-white/5 dark:text-white"
            >
              See it in action
            </Link>
          </div>
          <ul className="mt-7 flex flex-wrap gap-x-6 gap-y-2.5 text-sm text-slate-600 dark:text-slate-300">
            {["Forever-free plan", "Unlimited invoices", "Web, desktop & mobile"].map((t) => (
              <li key={t} className="flex items-center gap-2">
                <Icon icon={CheckmarkCircle02Icon} size={18} className="text-brand-600 dark:text-brand-300" />
                {t}
              </li>
            ))}
          </ul>
        </div>
        <HeroPreview />
      </div>
    </section>
  );
}

const PILL = {
  paid: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  partial: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  overdue: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
};

function HeroPreview() {
  const bars = [
    [52, 40],
    [64, 50],
    [58, 54],
    [72, 58],
    [80, 66],
    [88, 74],
  ];
  const recent = [
    { initials: "ST", party: "Sharma Traders", no: "INV-0045", amount: "₹1,18,000", status: "Paid", tone: PILL.paid },
    { initials: "MS", party: "Mehta & Sons", no: "INV-0044", amount: "₹42,480", status: "Partial", tone: PILL.partial },
    { initials: "PR", party: "Patel Retail", no: "INV-0043", amount: "₹76,700", status: "Overdue", tone: PILL.overdue },
  ];
  return (
    <div className="relative hidden lg:block" aria-hidden="true">
      <div className="overflow-hidden rounded-[18px] bg-white shadow-[0_40px_80px_-30px_rgba(15,27,61,.35)] ring-1 ring-[#e3e8f2] dark:bg-[#141c2f] dark:ring-white/10">
        <div className="flex h-[38px] items-center gap-[7px] border-b border-border-light bg-[#f1f4f9] px-3.5 dark:bg-[#1b2438]">
          {[0, 1, 2].map((i) => (
            <span key={i} className="h-2.5 w-2.5 rounded-full bg-slate-300 dark:bg-slate-600" />
          ))}
          <span className="ml-3.5 flex h-[22px] flex-1 items-center rounded-md border border-border-light bg-white px-2.5 text-[11px] text-slate-500 dark:bg-[#141c2f] dark:text-slate-400">
            app.fintranzact.com/dashboard
          </span>
        </div>
        <div className="flex">
          <div className={cn(NAVY, "flex w-[52px] shrink-0 flex-col items-center gap-3.5 py-3.5 text-[#8fa3cf]")}>
            <Logo className="h-[26px] w-[26px]" />
            {[ChartBarLineIcon, Invoice01Icon, PackageIcon, CreditCardIcon, UserGroupIcon].map((ic, i) => (
              <span
                key={i}
                className={cn("flex h-8 w-8 items-center justify-center rounded-[9px]", i === 0 && "bg-white/10 text-white")}
              >
                <Icon icon={ic} size={16} />
              </span>
            ))}
          </div>
          <div className="flex flex-1 flex-col gap-3.5 bg-[#f7f8fb] p-5 pt-[18px] dark:bg-[#0f172a]">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">Good morning</p>
                <p className="text-[15px] font-bold text-slate-900 dark:text-white">Acme Trading Co</p>
              </div>
              <span className="flex h-[30px] items-center gap-1 rounded-lg bg-brand-600 px-3 text-xs font-semibold text-white">
                <Icon icon={Add01Icon} size={13} strokeWidth={2.25} />
                New invoice
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2.5">
              {[
                ["Sales · Sep", "₹12,00,000", "▲ 12% vs Aug", "text-emerald-700 dark:text-emerald-300"],
                ["Receivable", "₹2,16,000", "11 invoices due", "text-amber-700 dark:text-amber-300"],
                ["Cash & bank", "₹4,02,500", "3 accounts", "text-slate-600 dark:text-slate-300"],
              ].map(([l, v, n, c]) => (
                <div key={l} className="rounded-[11px] border border-border-light bg-white px-3 py-2.5 dark:bg-[#141c2f]">
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">{l}</p>
                  <p className="mt-0.5 text-base font-bold text-slate-900 dark:text-white">{v}</p>
                  <p className={cn("mt-0.5 text-[10px] font-semibold", c)}>{n}</p>
                </div>
              ))}
            </div>
            <div className="rounded-[11px] border border-border-light bg-white px-3.5 py-3 dark:bg-[#141c2f]">
              <div className="flex justify-between text-[11px]">
                <span className="font-bold text-slate-900 dark:text-white">Sales &amp; collections</span>
                <span className="text-slate-500 dark:text-slate-400">Last 6 months</span>
              </div>
              <div className="mt-2.5 flex h-[92px] items-end gap-3.5 border-b border-border-light px-1.5">
                {bars.map(([s, c], i) => (
                  <div key={i} className="flex flex-1 items-end justify-center gap-1">
                    <div className="w-3 rounded-t bg-brand-600 dark:bg-brand-400" style={{ height: s }} />
                    <div className="w-3 rounded-t bg-[#a9bde6] dark:bg-brand-800" style={{ height: c }} />
                  </div>
                ))}
              </div>
            </div>
            <div className="overflow-hidden rounded-[11px] border border-border-light bg-white dark:bg-[#141c2f]">
              {recent.map((r) => (
                <div key={r.no} className="flex items-center gap-2.5 border-t border-border-light px-3.5 py-2 text-xs first:border-t-0">
                  <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-brand-50 text-[10px] font-bold text-brand-600 dark:bg-brand-900/50 dark:text-brand-200">
                    {r.initials}
                  </span>
                  <span className="flex-1 text-slate-900 dark:text-white">
                    <span className="font-semibold">{r.party}</span>
                    <span className="text-slate-400"> · {r.no}</span>
                  </span>
                  <span className="font-semibold text-slate-900 dark:text-white">{r.amount}</span>
                  <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", r.tone)}>{r.status}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="absolute -bottom-2 -left-9 flex w-[260px] items-center gap-3 rounded-[14px] bg-white p-4 shadow-[0_24px_50px_-20px_rgba(15,27,61,.35)] ring-1 ring-[#e8ecf3] dark:bg-[#141c2f] dark:ring-white/10">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
          <Icon icon={QrCodeIcon} size={20} />
        </span>
        <div>
          <p className="text-[13px] font-bold text-slate-900 dark:text-white">e-Invoice generated</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">IRN &amp; signed QR added to INV-0045</p>
        </div>
      </div>
      <div className="absolute -right-7 -top-5 w-[224px] rounded-[14px] bg-white p-4 shadow-[0_24px_50px_-20px_rgba(15,27,61,.35)] ring-1 ring-[#e8ecf3] dark:bg-[#141c2f] dark:ring-white/10">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-bold text-slate-900 dark:text-white">GSTR-1 · Sep</span>
          <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-bold text-brand-600 dark:bg-brand-900/50 dark:text-brand-200">
            Ready to file
          </span>
        </div>
        <div className="mt-2.5 h-1.5 rounded bg-brand-600 dark:bg-brand-400" />
        <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">128 invoices · tax worked out for you</p>
      </div>
    </div>
  );
}

// ─── Industries ───────────────────────────────────────────────────────────────

function Industries() {
  return (
    <section id="industries" className="scroll-mt-24 border-b border-border-light bg-surface-1">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-5 px-4 py-10 md:px-6">
        <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-text-tertiary">
          Built for every kind of Indian business
        </p>
        <div className="flex flex-wrap justify-center gap-2.5">
          {INDUSTRIES.map((i) => (
            <span
              key={i}
              className="rounded-full border border-border-light bg-surface-0 px-4 py-2 text-sm font-medium text-text-secondary"
            >
              {i}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Feature tabs ─────────────────────────────────────────────────────────────

function FeatureTabs() {
  const [tab, setTab] = useState<TabId>("invoicing");
  const cur = TABS.find((t) => t.id === tab)!;
  return (
    <section>
      <div className="mx-auto max-w-6xl px-4 py-24 md:px-6 lg:py-28">
        <p className={cn(EYEBROW, "text-center")}>One app for your whole back office</p>
        <h2 className={cn(HEADING, "mx-auto mt-3.5 max-w-3xl text-center text-3xl leading-tight md:text-[44px]")}>
          Everything from the first quote to the final return
        </h2>
        <div
          role="tablist"
          aria-label="Product areas"
          className="mx-auto mt-10 flex w-full max-w-max gap-1.5 overflow-x-auto rounded-full bg-surface-2 p-1.5"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={t.id === tab}
              onClick={() => setTab(t.id)}
              className={cn(
                "h-11 shrink-0 rounded-full px-5 text-[15px] font-semibold transition",
                t.id === tab
                  ? "bg-surface-0 text-[#0f1b3d] shadow-[0_4px_12px_-4px_rgba(15,27,61,.2)] dark:text-white"
                  : "text-text-tertiary hover:text-text-primary",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div role="tabpanel" className="mt-11 grid items-center gap-14 lg:grid-cols-2">
          <div>
            <h3 className={cn(HEADING, "text-[30px] leading-tight")}>{cur.title}</h3>
            <p className="mt-3.5 text-[17px] leading-relaxed text-text-secondary">{cur.body}</p>
            <ul className="mt-6 space-y-3.5">
              {cur.points.map((p) => (
                <li key={p.name} className="flex gap-3 text-[15px] leading-normal text-text-secondary">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-900/50 dark:text-brand-200">
                    <Icon icon={Tick02Icon} size={14} strokeWidth={2.5} />
                  </span>
                  <span>
                    <strong className="text-text-primary">{p.name}</strong> — {p.body}
                  </span>
                </li>
              ))}
            </ul>
            <Link
              to="/features"
              className="mt-7 inline-flex items-center gap-1 text-[15px] font-bold text-brand-600 hover:text-brand-800 dark:text-brand-300 dark:hover:text-brand-100"
            >
              Explore all features
              <Icon icon={ArrowRight01Icon} size={16} strokeWidth={2} />
            </Link>
          </div>
          <div className="flex min-h-[460px] items-center justify-center rounded-3xl bg-brand-50 p-6 sm:p-8 dark:bg-[#1a2547]" aria-hidden="true">
            <TabPreview id={tab} />
          </div>
        </div>
      </div>
    </section>
  );
}

const CARD = "w-full rounded-[14px] bg-white shadow-[0_20px_44px_-22px_rgba(15,27,61,.35)] dark:bg-[#141c2f]";

function TabPreview({ id }: { id: TabId }) {
  if (id === "gst") {
    return (
      <div className="flex w-full flex-col gap-3.5">
        <div className={cn(CARD, "p-5 text-[13px]")}>
          <div className="flex items-center justify-between">
            <span className="font-display text-base font-extrabold text-[#0f1b3d] dark:text-white">GSTR-1 · September 2026</span>
            <span className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-bold", PILL.paid)}>Ready to file</span>
          </div>
          {[
            ["B2B", "86 invoices", "₹1,42,300"],
            ["B2C large", "4 invoices", "₹18,900"],
            ["B2C small", "32 invoices", "₹24,650"],
            ["Credit notes", "6 notes", "−₹5,400"],
          ].map(([k, n, t]) => (
            <div key={k} className="mt-2.5 grid grid-cols-3 border-t border-border-light py-2 text-text-primary">
              <span className="font-semibold">{k}</span>
              <span className="text-text-tertiary">{n}</span>
              <span className="text-right font-semibold">{t}</span>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3.5">
          <div className={cn(CARD, "p-4")}>
            <p className="text-xs text-text-tertiary">e-Invoice</p>
            <p className="mt-1 text-sm font-bold text-text-primary">IRN generated</p>
            <p className="mt-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">Signed QR on INV-0045</p>
          </div>
          <div className={cn(CARD, "p-4")}>
            <p className="text-xs text-text-tertiary">e-Way Bill</p>
            <p className="mt-1 text-sm font-bold text-text-primary">EWB active</p>
            <p className="mt-1 text-[11px] font-semibold text-brand-600 dark:text-brand-300">Valid till 1 Oct 2026</p>
          </div>
        </div>
      </div>
    );
  }
  if (id === "stock") {
    const stock = [
      ["Cotton shirts", "420 pcs", 84, false],
      ["Denim jeans", "265 pcs", 60, false],
      ["Kurta sets", "140 pcs", 38, false],
      ["Silk sarees", "18 pcs · Low", 9, true],
      ["Accessories", "610 pcs", 92, false],
    ] as const;
    return (
      <div className={cn(CARD, "p-5")}>
        <div className="flex items-center justify-between">
          <span className="font-display text-base font-extrabold text-[#0f1b3d] dark:text-white">Stock</span>
          <span className="text-xs text-text-tertiary">Main warehouse</span>
        </div>
        {stock.map(([name, qty, pct, low]) => (
          <div key={name} className="mt-3.5">
            <div className="flex justify-between text-[13px]">
              <span className="font-semibold text-text-primary">{name}</span>
              <span className={cn("font-semibold", low ? "text-amber-700 dark:text-amber-300" : "text-brand-600 dark:text-brand-300")}>
                {qty}
              </span>
            </div>
            <div className="mt-1.5 h-[7px] rounded bg-surface-2">
              <div
                className={cn("h-[7px] rounded", low ? "bg-amber-600 dark:bg-amber-400" : "bg-brand-600 dark:bg-brand-400")}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (id === "payments") {
    return (
      <div className="flex w-full flex-col gap-3.5">
        <div className={cn(CARD, "p-5")}>
          <p className="text-xs text-text-tertiary">Collected this month</p>
          <p className="mt-1 font-display text-3xl font-extrabold text-[#0f1b3d] dark:text-white">₹9,84,000</p>
          <div className="mt-3.5 flex h-3 gap-0.5 overflow-hidden rounded-md">
            <div className="w-[46%] bg-brand-600 dark:bg-brand-400" />
            <div className="w-[28%] bg-[#6583c3]" />
            <div className="w-[16%] bg-[#a9bde6] dark:bg-brand-800" />
            <div className="w-[10%] bg-slate-300 dark:bg-slate-600" />
          </div>
          <div className="mt-3 grid grid-cols-4 text-xs text-text-secondary">
            <span>UPI 46%</span>
            <span>Bank 28%</span>
            <span>Cash 16%</span>
            <span>Cheque 10%</span>
          </div>
        </div>
        <div className={cn(CARD, "flex items-center justify-between px-5 py-4")}>
          <div>
            <p className="text-sm font-bold text-text-primary">Bank reconciliation · HDFC</p>
            <p className="mt-0.5 text-xs text-text-tertiary">42 of 45 statement lines matched</p>
          </div>
          <span className="rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-bold text-brand-600 dark:bg-brand-900/50 dark:text-brand-200">
            3 to review
          </span>
        </div>
      </div>
    );
  }
  if (id === "reports") {
    const lines = [
      ["Sales", "₹68,40,000", "text-text-secondary"],
      ["Cost of goods sold", "₹41,20,000", "text-text-secondary"],
      ["Gross profit", "₹27,20,000", "font-bold text-text-primary"],
      ["Expenses", "₹6,85,000", "text-text-secondary"],
      ["Net profit", "₹20,35,000", "font-extrabold text-emerald-700 dark:text-emerald-300"],
    ];
    return (
      <div className={cn(CARD, "p-5 text-[13px]")}>
        <div className="flex items-center justify-between">
          <span className="font-display text-base font-extrabold text-[#0f1b3d] dark:text-white">Profit &amp; loss</span>
          <span className="text-xs text-text-tertiary">Apr–Sep 2026</span>
        </div>
        {lines.map(([k, v, c]) => (
          <div key={k} className={cn("flex justify-between border-t border-border-light py-2.5", c)}>
            <span>{k}</span>
            <span>{v}</span>
          </div>
        ))}
        <div className="mt-2 flex flex-wrap gap-2">
          {["Balance sheet", "Day book", "Party ledgers", "Stock report"].map((r) => (
            <span key={r} className="rounded-full bg-surface-2 px-2.5 py-1 text-xs text-text-secondary">
              {r}
            </span>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className={cn(CARD, "px-6 py-5 text-xs text-text-primary")}>
      <div className="flex items-start justify-between">
        <div>
          <p className="font-display text-base font-extrabold text-[#0f1b3d] dark:text-white">TAX INVOICE</p>
          <p className="mt-1 text-text-tertiary">INV-0046 · 29 Sep 2026</p>
        </div>
        <div className="text-right">
          <p className="font-bold">Acme Trading Co</p>
          <p className="mt-0.5 text-text-tertiary">GSTIN 27AABCU9603R1ZM</p>
        </div>
      </div>
      <div className="mt-3.5 rounded-lg bg-surface-1 px-3 py-2.5">
        <span className="text-text-tertiary">Bill to</span> <strong>Sharma Traders</strong>{" "}
        <span className="text-text-tertiary">· Mumbai, Maharashtra</span>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-1.5 border-b border-border-light py-2 font-semibold text-text-tertiary">
        <span>Item</span>
        <span className="text-right">Qty</span>
        <span className="text-right">Rate</span>
        <span className="text-right">Amount</span>
      </div>
      {[
        ["Cotton shirts", "40", "₹1,250", "₹50,000"],
        ["Denim jeans", "25", "₹2,000", "₹50,000"],
      ].map((r) => (
        <div key={r[0]} className="grid grid-cols-4 gap-1.5 border-b border-border-light py-2">
          <span>{r[0]}</span>
          <span className="text-right">{r[1]}</span>
          <span className="text-right">{r[2]}</span>
          <span className="text-right">{r[3]}</span>
        </div>
      ))}
      <div className="ml-auto mt-2.5 flex w-56 flex-col gap-1.5">
        {[
          ["Taxable value", "₹1,00,000"],
          ["CGST 9%", "₹9,000"],
          ["SGST 9%", "₹9,000"],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between text-text-tertiary">
            <span>{k}</span>
            <span>{v}</span>
          </div>
        ))}
        <div className="flex justify-between border-t border-border-light pt-1.5 text-sm font-extrabold text-[#0f1b3d] dark:text-white">
          <span>Total</span>
          <span>₹1,18,000</span>
        </div>
      </div>
    </div>
  );
}

// ─── Feature grid ─────────────────────────────────────────────────────────────

function FeatureGrid() {
  return (
    <section className="bg-surface-1">
      <div className="mx-auto max-w-6xl px-4 py-24 md:px-6 lg:py-28">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className={EYEBROW}>And much more</p>
            <h2 className={cn(HEADING, "mt-3 max-w-xl text-3xl leading-tight md:text-[40px]")}>
              Tools that grow with your business
            </h2>
          </div>
          <Link
            to="/features"
            className="inline-flex h-12 items-center gap-1.5 rounded-xl border border-[#d5dcea] bg-surface-0 px-5 text-[15px] font-semibold text-[#0f1b3d] transition hover:border-brand-300 dark:border-white/15 dark:text-white"
          >
            See all features
            <Icon icon={ArrowUpRight01Icon} size={16} />
          </Link>
        </div>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {TILES.map(([mark, name, body], i) => (
            <article
              key={name}
              className="rounded-2xl border border-border-light bg-surface-0 p-5 transition duration-200 hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-[0_18px_40px_-18px_rgba(15,27,61,.28)] dark:hover:border-brand-800"
            >
              <span
                className={cn(
                  "flex h-11 w-11 items-center justify-center rounded-full font-display text-[15px] font-extrabold",
                  TILE_TONES[i % TILE_TONES.length],
                )}
              >
                {mark}
              </span>
              <h3 className="mt-4 text-base font-bold text-text-primary">{name}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-text-tertiary">{body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Steps ────────────────────────────────────────────────────────────────────

function Steps() {
  const steps = [
    ["Create your free account", "Sign up with your email or phone number. No credit card, no trial clock."],
    ["Add your business", "Enter your GSTIN and we fill in your PAN and state. Import parties and items from a spreadsheet."],
    ["Send your first invoice", "Pick a party, add items and share a GST-ready invoice — tax is worked out for you."],
  ];
  return (
    <section>
      <div className="mx-auto max-w-6xl px-4 py-24 md:px-6">
        <p className={cn(EYEBROW, "text-center")}>Get started in minutes</p>
        <h2 className={cn(HEADING, "mt-3 text-center text-3xl md:text-[40px]")}>
          From sign-up to first invoice in three steps
        </h2>
        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {steps.map(([title, body], i) => (
            <div key={title} className="rounded-[20px] border border-border-light p-7">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-600 font-display text-xl font-extrabold text-white">
                {i + 1}
              </span>
              <h3 className="mt-5 text-[19px] font-bold text-text-primary">{title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-text-tertiary">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Anywhere + your data ─────────────────────────────────────────────────────

function AnywhereAndData() {
  const places: Array<[IconSvgElement, string, string]> = [
    [Database01Icon, "In your browser", "Nothing to install — sign in and start billing"],
    [ComputerIcon, "Desktop app", "A fast, dedicated app for the billing counter"],
    [SmartPhone01Icon, "On your phone", "Check dues and send invoices on the go"],
  ];
  const data: Array<[IconSvgElement, string, string]> = [
    [SecurityCheckIcon, "Roles & permissions", "Invite staff and your accountant with the right access."],
    [Download04Icon, "Export anytime", "Download your full data whenever you want. No lock-in."],
    [CloudUploadIcon, "Backup & restore", "Take a full backup and restore it in one step."],
    [Database01Icon, "Separate books", "Each business keeps its own books, fully apart."],
  ];
  return (
    <section>
      <div className="mx-auto max-w-6xl px-4 pb-24 md:px-6">
        <div
          className={cn(
            NAVY,
            "landing-dots-dark grid gap-14 rounded-[28px] p-8 text-white ring-1 ring-transparent sm:p-14 lg:grid-cols-2 dark:bg-[#16213f] dark:ring-[#2a3a63]",
          )}
        >
          <div>
            <h2 className="font-display text-[34px] font-extrabold leading-tight tracking-[-0.02em]">Work from anywhere</h2>
            <p className="mt-3 text-base leading-relaxed text-[#b9c6e4]">
              Your books stay in sync across every device your team uses.
            </p>
            <div className="mt-7 space-y-3">
              {places.map(([ic, t, b]) => (
                <div key={t} className="flex items-center gap-3.5 rounded-[14px] border border-white/10 bg-white/[0.06] px-[18px] py-4">
                  <span className="flex h-[42px] w-[42px] items-center justify-center rounded-full bg-[#a9bde6]/15 text-[#c7d4ef]">
                    <Icon icon={ic} size={20} />
                  </span>
                  <div>
                    <p className="font-bold">{t}</p>
                    <p className="mt-0.5 text-[13px] text-[#9fb0d6]">{b}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h2 className="font-display text-[34px] font-extrabold leading-tight tracking-[-0.02em]">Your data stays yours</h2>
            <p className="mt-3 text-base leading-relaxed text-[#b9c6e4]">
              Control who sees what, and take your data with you whenever you like.
            </p>
            <div className="mt-7 grid gap-3 sm:grid-cols-2">
              {data.map(([ic, t, b]) => (
                <div key={t} className="rounded-[14px] border border-white/10 bg-white/[0.06] p-[18px]">
                  <Icon icon={ic} size={22} className="text-[#a9bde6]" />
                  <p className="mt-3 font-bold">{t}</p>
                  <p className="mt-1 text-[13px] leading-normal text-[#9fb0d6]">{b}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Pricing ──────────────────────────────────────────────────────────────────

function Pricing() {
  return (
    <section id="pricing" className="bg-surface-1">
      <div className="mx-auto max-w-6xl px-4 py-24 md:px-6">
        <p className={cn(EYEBROW, "text-center")}>Pricing</p>
        <h2 className={cn(HEADING, "mt-3 text-center text-3xl md:text-[40px]")}>
          Start free. Upgrade when your team grows.
        </h2>
        <PricingCards className="mt-12" />
      </div>
    </section>
  );
}

// ─── FAQ ──────────────────────────────────────────────────────────────────────

function Faq() {
  return (
    <section>
      <div className="mx-auto grid max-w-6xl gap-14 px-4 py-24 md:px-6 lg:grid-cols-3">
        <div>
          <p className={EYEBROW}>FAQ</p>
          <h2 className={cn(HEADING, "mt-3 text-3xl leading-tight md:text-[38px]")}>Questions, answered</h2>
          <p className="mt-3.5 text-[15px] leading-relaxed text-text-tertiary">
            Can&apos;t find what you need? Write to{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold text-brand-600 hover:underline dark:text-brand-300">
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </div>
        <div className="lg:col-span-2">
          <FaqAccordion items={FAQS} />
        </div>
      </div>
    </section>
  );
}

// ─── Final CTA ────────────────────────────────────────────────────────────────

function FinalCta() {
  return (
    <section>
      <div className="mx-auto max-w-6xl px-4 pb-24 md:px-6">
        <div className="landing-dots-dark flex flex-col items-center rounded-[28px] bg-brand-600 px-6 py-16 text-center text-white sm:px-14 sm:py-[72px]">
          <h2 className="max-w-3xl font-display text-3xl font-extrabold leading-tight tracking-[-0.025em] md:text-[44px]">
            Run your business on Fintranzact — free, forever.
          </h2>
          <p className="mt-4 max-w-xl text-[17px] leading-relaxed text-[#dbe4f5]">
            Set up in minutes. Unlimited invoices, parties and team members from day one.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link
              to="/register"
              className="inline-flex h-[54px] items-center rounded-xl bg-white px-7 text-base font-bold text-brand-900 transition hover:bg-brand-50"
            >
              Create free account
            </Link>
            <Link
              to="/contact"
              className="inline-flex h-[54px] items-center rounded-xl border border-white/40 px-6 text-base font-semibold text-white transition hover:bg-white/10"
            >
              Talk to us
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
