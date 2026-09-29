import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight01Icon,
  BankIcon,
  Book02Icon,
  Building03Icon,
  ChartBarLineIcon,
  ChartIncreaseIcon,
  CloudUploadIcon,
  Coins01Icon,
  ComputerIcon,
  CreditCardIcon,
  DeliveryTruck01Icon,
  FileEditIcon,
  GitCompareIcon,
  Invoice01Icon,
  Link01Icon,
  PackageIcon,
  QrCodeIcon,
  RepeatIcon,
  ReturnRequestIcon,
  SecurityCheckIcon,
  ShoppingBag01Icon,
  Store01Icon,
  TaxesIcon,
  Tick02Icon,
  UserGroupIcon,
  Wallet01Icon,
} from "@hugeicons/core-free-icons";
import { Icon, IconCircle, type IconSvgElement } from "@/components/ui/Icon";
import { cn } from "@/lib/utils";
import {
  CtaBand,
  MarketingLayout,
  PageHero,
} from "@/components/marketing/MarketingLayout";

export const Route = createFileRoute("/features")({
  component: FeaturesPage,
});

const FEATURE_GROUPS: Array<{
  title: string;
  intro: string;
  items: Array<{ name: string; body: string }>;
}> = [
  {
    title: "Sales & billing",
    intro: "Every document a sale needs, from first quote to final payment.",
    items: [
      { name: "GST invoices", body: "Sale and purchase invoices with HSN/SAC, CGST/SGST/IGST and cess worked out for you." },
      { name: "Quotations & proforma", body: "Send estimates and proforma invoices, then convert them to invoices in one click." },
      { name: "Delivery challans", body: "Move goods without a sale and invoice them later." },
      { name: "Credit notes & returns", body: "Handle sales returns and adjustments with correct tax reversal." },
      { name: "Recurring invoices", body: "Automate monthly and periodic billing for retainers and subscriptions." },
      { name: "Point of sale", body: "A fast checkout screen for walk-in customers, with keyboard shortcuts." },
    ],
  },
  {
    title: "GST compliance",
    intro: "Stay ready for filing without exporting to spreadsheets.",
    items: [
      { name: "e-Invoicing", body: "Generate IRN and signed QR codes directly from your invoices." },
      { name: "e-Way bills", body: "Create and track e-way bills for goods in transit." },
      { name: "GSTR-1 & GSTR-3B", body: "File-ready return summaries built from your transactions." },
      { name: "GSTR-2B reconciliation", body: "Match supplier data against your purchases and spot mismatches." },
      { name: "Input tax credit", body: "Track eligible, claimed and pending ITC across periods." },
    ],
  },
  {
    title: "Accounting & banking",
    intro: "Clean books that are always up to date.",
    items: [
      { name: "Payments", body: "Record receipts and payments against invoices and track outstanding balances." },
      { name: "Expenses", body: "Log business expenses by category, with GST where it applies." },
      { name: "Cash & bank", body: "Manage multiple cash and bank accounts in one place." },
      { name: "Bank reconciliation", body: "Import statements and match them against your books." },
      { name: "Journal entries", body: "Post manual adjustments with full double-entry support." },
      { name: "Reports", body: "Profit & loss, balance sheet, day book, party ledgers, stock and tax reports." },
    ],
  },
  {
    title: "Inventory & fulfilment",
    intro: "Know what you have and where it is going.",
    items: [
      { name: "Items & variants", body: "Products and services with units, variants, pricing and tax rates." },
      { name: "Stock tracking", body: "Stock levels update automatically as you buy and sell." },
      { name: "Shipments", body: "Track dispatches and deliveries for your orders." },
      { name: "Online store", body: "Publish a storefront for your items and receive orders straight into your books." },
    ],
  },
  {
    title: "Teams & platform",
    intro: "Grows with you from one shop to many branches.",
    items: [
      { name: "Multiple businesses", body: "Run several GSTINs and businesses under one organization." },
      { name: "Roles & permissions", body: "Invite your team and your accountant with role-based access." },
      { name: "Web, desktop & mobile", body: "Use Fintranzact in the browser, as a desktop app or on your phone." },
      { name: "API & integrations", body: "Connect your own tools through the API, CLI and AI assistant integrations." },
      { name: "Data import & backup", body: "Bring in parties and items from spreadsheets and export your data any time." },
    ],
  },
];

const GROUP_ICONS: Record<string, IconSvgElement> = {
  "Sales & billing": Invoice01Icon,
  "GST compliance": TaxesIcon,
  "Accounting & banking": BankIcon,
  "Inventory & fulfilment": PackageIcon,
  "Teams & platform": UserGroupIcon,
};

const ITEM_ICONS: Record<string, IconSvgElement> = {
  "GST invoices": Invoice01Icon,
  "Quotations & proforma": FileEditIcon,
  "Delivery challans": DeliveryTruck01Icon,
  "Credit notes & returns": ReturnRequestIcon,
  "Recurring invoices": RepeatIcon,
  "Point of sale": Store01Icon,
  "e-Invoicing": QrCodeIcon,
  "e-Way bills": DeliveryTruck01Icon,
  "GSTR-1 & GSTR-3B": TaxesIcon,
  "GSTR-2B reconciliation": GitCompareIcon,
  "Input tax credit": Coins01Icon,
  Payments: CreditCardIcon,
  Expenses: Wallet01Icon,
  "Cash & bank": BankIcon,
  "Bank reconciliation": GitCompareIcon,
  "Journal entries": Book02Icon,
  Reports: ChartBarLineIcon,
  "Items & variants": PackageIcon,
  "Stock tracking": ChartIncreaseIcon,
  Shipments: DeliveryTruck01Icon,
  "Online store": ShoppingBag01Icon,
  "Multiple businesses": Building03Icon,
  "Roles & permissions": SecurityCheckIcon,
  "Web, desktop & mobile": ComputerIcon,
  "API & integrations": Link01Icon,
  "Data import & backup": CloudUploadIcon,
};

const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-");

function FeaturesPage() {
  return (
    <MarketingLayout title="Features">
      <PageHero
        eyebrow="Features"
        title="Everything you need to bill, file and grow"
        subtitle="Invoicing, GST compliance, accounting and inventory in one connected system, built for Indian businesses."
      >
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            to="/register"
            className="inline-flex h-[52px] items-center gap-2 rounded-xl bg-brand-600 px-6 text-base font-bold text-white shadow-[0_12px_28px_-10px_rgba(59,94,170,.7)] transition hover:bg-brand-700"
          >
            Start free — no card needed
            <Icon icon={ArrowRight01Icon} size={18} strokeWidth={2} />
          </Link>
          <Link
            to="/pricing"
            className="inline-flex h-[52px] items-center rounded-xl border border-[#cfd8ea] bg-white px-6 text-base font-semibold text-[#0f1b3d] transition hover:border-brand-300 dark:border-white/15 dark:bg-white/5 dark:text-white"
          >
            See pricing
          </Link>
        </div>
      </PageHero>

      <nav
        aria-label="Feature areas"
        className="sticky top-[72px] z-10 border-b border-border-light bg-surface-0/90 backdrop-blur"
      >
        <div className="mx-auto flex max-w-6xl gap-2 overflow-x-auto px-4 py-3 md:px-6">
          {FEATURE_GROUPS.map((group) => (
            <a
              key={group.title}
              href={`#${slug(group.title)}`}
              className="inline-flex shrink-0 items-center gap-2 rounded-full border border-border-light bg-surface-0 px-4 py-2 text-sm font-semibold text-text-secondary transition hover:border-brand-300 hover:text-text-primary"
            >
              <Icon icon={GROUP_ICONS[group.title] ?? Invoice01Icon} size={16} className="text-brand-600 dark:text-brand-300" />
              {group.title}
            </a>
          ))}
        </div>
      </nav>

      {FEATURE_GROUPS.map((group, gi) => (
        <section
          key={group.title}
          id={slug(group.title)}
          className={cn("scroll-mt-32", gi % 2 === 1 && "bg-surface-1")}
        >
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-20 md:px-6 lg:grid-cols-3 lg:py-24">
            <div className="lg:sticky lg:top-40 lg:self-start">
              <IconCircle icon={GROUP_ICONS[group.title] ?? Invoice01Icon} size="lg" />
              <h2 className="mt-5 font-display text-3xl font-extrabold tracking-[-0.025em] text-[#0f1b3d] dark:text-white">
                {group.title}
              </h2>
              <p className="mt-3 text-base leading-relaxed text-text-secondary">{group.intro}</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:col-span-2">
              {group.items.map((item) => (
                <article
                  key={item.name}
                  className="rounded-2xl border border-border-light bg-surface-0 p-6 transition duration-200 hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-[0_18px_40px_-18px_rgba(15,27,61,.28)] dark:hover:border-brand-800"
                >
                  <IconCircle icon={ITEM_ICONS[item.name] ?? Tick02Icon} size="md" />
                  <h3 className="mt-4 text-base font-bold text-text-primary">{item.name}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-text-tertiary">{item.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      ))}

      <CtaBand />
    </MarketingLayout>
  );
}
